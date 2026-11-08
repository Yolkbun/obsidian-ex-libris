import { App, normalizePath, requestUrl, TFile } from "obsidian";
import type { ExLibrisSettings } from "../settings";
import { ensureDir, joinPath, sanitizeFilename } from "../util/paths";
import { buildFrontmatter, parseFrontmatter } from "../util/text";
import type { CoverResolver } from "./cover";

export type DoubanKind = "book" | "screen" | "music";
export type DoubanType = "book" | "movie" | "tv" | "music";

export interface DoubanItem {
  id: string;
  title: string;
  author: string;
  year: string;
  coverUrl: string;
  type: DoubanType;
}

export class DoubanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoubanError";
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

interface SuggestItem {
  id?: string;
  title?: string;
  author_name?: string;
  year?: string;
  pic?: string;
  img?: string;
  type?: string;
  sub_title?: string;
  episode?: string;
}

/**
 * 用豆瓣搜索建议接口（公开 JSON，无需登录）。
 * 这是页面抓取，不是官方 API：豆瓣可能限流或改版，失败时给可读错误，不重试风暴。
 */
function doubanHeaders(host: string): Record<string, string> {
  return {
    "User-Agent": UA,
    Referer: `${host}/`,
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
  };
}

async function getDouban(url: string, host: string): Promise<{ status: number; text: string }> {
  try {
    return await requestUrl({ url, headers: doubanHeaders(host) });
  } catch {
    // 某些 Electron 版本会拒绝自定义 User-Agent；退回默认请求头再试一次。
    try {
      return await requestUrl({ url });
    } catch (err) {
      throw new DoubanError(`豆瓣请求失败：${String(err)}`);
    }
  }
}

/** 从搜索页 HTML 里取 window.__DATA__（音乐搜索没有 subject_suggest）。 */
function parseWindowData(html: string): Record<string, unknown> {
  const marker = html.indexOf("window.__DATA__");
  if (marker < 0) throw new DoubanError("豆瓣搜索页没有返回数据（可能被风控/限流）。");
  const start = html.indexOf("{", marker);
  if (start < 0) throw new DoubanError("豆瓣搜索页数据格式异常。");
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new DoubanError("豆瓣搜索页数据不完整。");
  try {
    return JSON.parse(html.slice(start, end)) as Record<string, unknown>;
  } catch {
    throw new DoubanError("豆瓣搜索页数据解析失败（可能改版）。");
  }
}

interface SearchSubjectItem {
  id?: string | number;
  title?: string;
  abstract?: string;
  cover_url?: string;
  tpl_name?: string;
}

async function searchMusic(term: string): Promise<DoubanItem[]> {
  const host = "https://search.douban.com";
  const url = `${host}/music/subject_search?search_text=${encodeURIComponent(term)}`;
  const response = await getDouban(url, host);
  if (response.status < 200 || response.status >= 300) {
    throw new DoubanError(`豆瓣返回 HTTP ${response.status}（可能被限流）`);
  }
  const data = parseWindowData(response.text);
  const error = typeof data.error_info === "string" ? data.error_info.trim() : "";
  if (error) throw new DoubanError(error);
  const rawItems = Array.isArray(data.items) ? (data.items as SearchSubjectItem[]) : [];

  const items: DoubanItem[] = [];
  for (const raw of rawItems) {
    if (raw.tpl_name !== "search_subject") continue;
    const id = String(raw.id ?? "").trim();
    const title = raw.title?.trim();
    if (!id || !title) continue;
    const abstract = raw.abstract?.trim() ?? "";
    const parts = abstract.split(" / ").map((part) => part.trim());
    const yearMatch = /(?:19|20)\d{2}/.exec(abstract);
    items.push({
      id,
      title,
      author: parts[0] ?? "",
      year: yearMatch ? yearMatch[0] : "",
      coverUrl: (raw.cover_url ?? "").trim(),
      type: "music",
    });
  }
  return items;
}

export async function searchDouban(kind: DoubanKind, query: string): Promise<DoubanItem[]> {
  const term = query.trim();
  if (!term) return [];
  if (kind === "music") return searchMusic(term);

  const host = kind === "book" ? "https://book.douban.com" : "https://movie.douban.com";
  const url = `${host}/j/subject_suggest?q=${encodeURIComponent(term)}`;
  const response = await getDouban(url, host);
  if (response.status < 200 || response.status >= 300) {
    throw new DoubanError(`豆瓣返回 HTTP ${response.status}（可能被限流）`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new DoubanError("豆瓣返回了非 JSON（可能被风控/限流），稍后再试。");
  }
  if (!Array.isArray(parsed)) {
    throw new DoubanError("豆瓣搜索返回格式异常。");
  }

  const items: DoubanItem[] = [];
  for (const raw of parsed as SuggestItem[]) {
    const id = raw.id?.trim();
    const title = raw.title?.trim();
    if (!id || !title) continue;
    const type: DoubanType =
      kind === "book" ? "book" : raw.type === "tv" || raw.episode ? "tv" : "movie";
    items.push({
      id,
      title,
      author: (raw.author_name || raw.sub_title || "").trim(),
      year: (raw.year || "").trim(),
      coverUrl: (raw.pic || raw.img || "").trim(),
      type,
    });
  }
  return items;
}

/** 把搜索建议里的小图换成大图；失败时仍回退到原 URL。 */
export function doubanCoverUrl(url: string): string {
  return url
    .replace("/view/subject/s/public/", "/view/subject/l/public/")
    .replace("/view/subject/m/public/", "/view/subject/l/public/")
    .replace("/view/photo/s_ratio_poster/public/", "/view/photo/l_ratio_poster/public/");
}

export interface DoubanNoteResult {
  file: TFile;
  created: boolean;
  skipped: boolean;
}

export function doubanNotePath(settings: ExLibrisSettings, title: string): string {
  return normalizePath(
    joinPath(settings.libraryRoot, "douban", `${sanitizeFilename(title)}.md`),
  );
}

/** 建一条豆瓣条目笔记；只剩元信息，不写正文。 */
export async function createDoubanNote(
  app: App,
  settings: ExLibrisSettings,
  covers: CoverResolver,
  item: DoubanItem,
): Promise<DoubanNoteResult> {
  const folder = normalizePath(joinPath(settings.libraryRoot, "douban"));
  await ensureDir(app.vault.adapter, folder);

  let path = doubanNotePath(settings, item.title);
  let existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const fields = parseFrontmatter(await app.vault.read(existing));
    if (fields.id === item.id) {
      return { file: existing, created: false, skipped: true };
    }
    path = normalizePath(
      joinPath(folder, `${sanitizeFilename(item.title)}-${item.id.slice(-4)}.md`),
    );
    existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      return { file: existing, created: false, skipped: true };
    }
  }

  let coverPath = "";
  if (item.coverUrl) {
    const target = normalizePath(
      joinPath(settings.libraryRoot, "assets", "covers", `douban-${item.id}.jpg`),
    );
    if (await covers.downloadTo(doubanCoverUrl(item.coverUrl), target)) {
      coverPath = target;
    }
  }

  const want = item.type === "book" ? "想读" : item.type === "music" ? "想听" : "想看";
  const frontmatter = buildFrontmatter(
    {
      type: item.type,
      id: item.id,
      ex_libris: "douban-search",
      title: item.title,
      author: item.author,
      myState: want,
      cover: coverPath,
      ...(item.coverUrl ? { imageData: doubanCoverUrl(item.coverUrl) } : {}),
      datePublished: item.year,
      created: new Date().toISOString().slice(0, 10),
      tags: [item.type, "douban"],
    },
    ["type", "id", "ex_libris", "title", "author", "myState", "cover", "imageData", "datePublished", "created", "tags"],
  );
  const body = `# ${item.title}\n\n> ${item.author || "佚名"}${item.year ? ` · ${item.year}` : ""}\n`;
  const file = await app.vault.create(path, frontmatter + body);
  return { file, created: true, skipped: false };
}
