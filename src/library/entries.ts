import type { App, TFile } from "obsidian";
import type { CoverRef, EntrySource, EntryType, ShelfItem } from "../domain/types";
import { parentDir } from "../util/paths";

const YEAR_FIELDS = ["myCollectionDate", "datePublished", "created", "fq_last_read_at"];

const READING_STATES = new Set(["在读", "在看", "在读中", "在追", "追更", "do", "doing", "reading"]);
const FINISHED_STATES = new Set(["读完", "看完", "读过", "collect", "done", "finished"]);
const WANT_STATES = new Set(["想读", "想看", "wish", "todo"]);

export function isFanqieFrontmatter(fm: Record<string, unknown>): boolean {
  return typeof fm.fq_book_id === "string" && fm.fq_book_id.trim() !== "";
}

export function isDoubanFrontmatter(fm: Record<string, unknown>): boolean {
  if (isFanqieFrontmatter(fm)) return false;
  const hasState = typeof fm.myState === "string" || typeof fm.myRating === "number";
  const hasId = fm.id !== undefined && fm.id !== null && fm.id !== "";
  return hasState || hasId;
}

export function normalizeType(raw: unknown): EntryType {
  switch (String(raw ?? "").toLowerCase()) {
    case "movie":
    case "film":
    case "电影":
      return "movie";
    case "tv":
    case "teleplay":
    case "drama":
    case "series":
    case "剧集":
    case "电视剧":
      return "tv";
    case "music":
    case "album":
    case "音乐":
      return "music";
    case "novel":
    case "webnovel":
    case "小说":
    case "网文":
      return "novel";
    default:
      return "book";
  }
}

export function isReading(status: string): boolean {
  return READING_STATES.has(status.trim().toLowerCase()) || status.trim() === "在读";
}

export function isFinished(status: string): boolean {
  return FINISHED_STATES.has(status.trim().toLowerCase()) || status.trim() === "读完";
}

export function isWant(status: string): boolean {
  return WANT_STATES.has(status.trim().toLowerCase()) || status.trim() === "想读";
}

export function statusOf(fm: Record<string, unknown>): string {
  const raw = fm.status ?? fm.myState;
  return typeof raw === "string" ? raw.trim() : "";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toYear(fm: Record<string, unknown>): string | undefined {
  for (const field of YEAR_FIELDS) {
    const raw = fm[field];
    if (typeof raw === "number") return String(raw);
    if (typeof raw === "string") {
      const match = /(\d{4})/.exec(raw);
      if (match) return match[1];
    }
  }
  return undefined;
}

function timestampOf(file: TFile, fm: Record<string, unknown>): number {
  const lastRead = typeof fm.fq_last_read_at === "string" ? Date.parse(fm.fq_last_read_at) : NaN;
  if (Number.isFinite(lastRead)) return lastRead;
  const created = typeof fm.created === "string" ? Date.parse(fm.created) : NaN;
  if (Number.isFinite(created)) return created;
  return file.stat?.mtime ?? 0;
}

export interface CoverLookup {
  resolve(fm: Record<string, unknown>, notePath: string): CoverRef | null;
}

/**
 * frontmatter → ShelfItem。只读，不写。
 * 返回 null 表示这条笔记不是书架条目（普通笔记）。
 */
export function toShelfItem(
  file: TFile,
  fields: Record<string, unknown>,
  covers: CoverLookup,
): ShelfItem | null {
  const fanqie = isFanqieFrontmatter(fields);
  const douban = isDoubanFrontmatter(fields);
  if (!fanqie && !douban) return null;

  const source: EntrySource = fanqie && douban ? "both" : fanqie ? "fanqie" : "douban";
  const title =
    typeof fields.title === "string" && fields.title.trim()
      ? fields.title.trim()
      : file.basename;

  const progress = fanqie ? toNumber(fields.fq_progress) : null;
  const unread = fanqie ? toNumber(fields.fq_unread_count) : null;

  const year = toYear(fields);
  const author =
    typeof fields.author === "string" && fields.author.trim()
      ? fields.author.trim()
      : typeof fields.publisher === "string" && fields.publisher.trim()
        ? fields.publisher.trim()
        : undefined;

  const item: ShelfItem = {
    path: file.path,
    title,
    type: fanqie ? "novel" : normalizeType(fields.type),
    source,
    cover: covers.resolve(fields, file.path),
    progress: progress === null ? null : clamp(progress, 0, 100),
    badge: unread !== null && unread > 0 ? `未读 ${Math.round(unread)}` : null,
    status: statusOf(fields),
    timestamp: timestampOf(file, fields),
  };
  if (author !== undefined) item.author = author;
  if (year !== undefined) item.year = year;
  if (fanqie && typeof fields.fq_book_id === "string") item.bookId = fields.fq_book_id;
  const tags = fields.tags;
  if (Array.isArray(tags)) {
    item.tags = tags.filter((tag): tag is string => typeof tag === "string");
  } else if (typeof tags === "string" && tags.trim()) {
    item.tags = tags
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return item;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 一张书架需要的全部条目。只读 metadataCache，不建全局索引文件。 */
export class EntryIndex {
  private byPath = new Map<string, ShelfItem>();
  private listeners = new Set<() => void>();
  private ready = false;

  constructor(
    private readonly app: App,
    private readonly covers: CoverLookup,
    private readonly options: { includeDouban?: () => boolean } = {},
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    await this.rebuild();
  }

  async rebuild(): Promise<void> {
    const next = new Map<string, ShelfItem>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const item = this.itemFor(file);
      if (item) next.set(file.path, item);
    }
    this.byPath = next;
    this.ready = true;
    this.emit();
  }

  itemFor(file: TFile): ShelfItem | null {
    const fields = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fields) return null;
    const plain: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (key !== "position") plain[key] = value;
    }
    const item = toShelfItem(file, plain, this.covers);
    if (
      item &&
      item.source === "douban" &&
      plain.ex_libris !== "douban-search" &&
      this.options.includeDouban &&
      !this.options.includeDouban()
    ) {
      return null;
    }
    return item;
  }

  /** 单个文件变化时增量更新，避免整库重扫。 */
  refreshFile(file: TFile): void {
    const item = this.itemFor(file);
    if (item) {
      this.byPath.set(file.path, item);
    } else {
      this.byPath.delete(file.path);
    }
    this.ready = true;
    this.emit();
  }

  removeFile(path: string): void {
    if (this.byPath.delete(path)) this.emit();
  }

  all(): ShelfItem[] {
    return [...this.byPath.values()].sort((a, b) => {
      const ta = a.timestamp ?? 0;
      const tb = b.timestamp ?? 0;
      if (tb !== ta) return tb - ta;
      return a.title.localeCompare(b.title, "zh-Hans-CN");
    });
  }

  get(path: string): ShelfItem | undefined {
    return this.byPath.get(path);
  }

  byBookId(bookId: string): ShelfItem | undefined {
    for (const item of this.byPath.values()) {
      if (item.bookId === bookId) return item;
    }
    return undefined;
  }

  /** 用于「从链接加入」时判断书是否已存在。 */
  hasBookId(bookId: string): boolean {
    return this.byBookId(bookId) !== undefined;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error("[ex-libris] 书架监听器出错", err);
      }
    }
  }
}

/** 豆瓣笔记不能改；番茄轻笔记的路径由 libraryRoot 决定。 */
export function noteFolderOf(path: string): string {
  return parentDir(path);
}
