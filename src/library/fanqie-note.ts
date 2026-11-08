import { App, normalizePath, TFile } from "obsidian";
import type { BookDetail } from "../domain/types";
import type { ExLibrisSettings } from "../settings";
import { ensureDir, joinPath, sanitizeFilename } from "../util/paths";
import { buildFrontmatter, parseFrontmatter, patchFrontmatter } from "../util/text";
import type { CoverResolver } from "./cover";
import type { EntryIndex } from "./entries";

export const FANQIE_FIELD_ORDER = [
  "type",
  "source",
  "title",
  "author",
  "status",
  "cover",
  "fq_book_id",
  "fq_cover_url",
  "fq_serial_status",
  "fq_word_count",
  "fq_chapter_total",
  "fq_reading_chapter",
  "fq_progress",
  "fq_unread_count",
  "fq_last_read_at",
  "fq_related",
  "created",
  "tags",
];

export interface FanqieNoteSummary {
  chapterTitle: string;
  chapterIndex: number;
  total: number;
  percent: number;
  at: string;
  unread?: number;
}

export function fanqieNoteFolder(settings: ExLibrisSettings): string {
  return normalizePath(joinPath(settings.libraryRoot, "book"));
}

export function fanqieNotePath(settings: ExLibrisSettings, title: string): string {
  return normalizePath(joinPath(fanqieNoteFolder(settings), `${sanitizeFilename(title)}.md`));
}

export function fanqieCoverPath(settings: ExLibrisSettings, bookId: string): string {
  return normalizePath(joinPath(settings.libraryRoot, "assets", "covers", `fanqie-${bookId}.jpg`));
}

export interface CreateNoteResult {
  file: TFile;
  created: boolean;
  skipped: boolean;
}

/**
 * 建番茄轻笔记：frontmatter 为主，正文不落盘（红线 3）。
 * 已存在同一本书时默认不覆盖；勾了「更新元信息」才刷新非阅读字段。
 */
export async function createFanqieNote(
  app: App,
  settings: ExLibrisSettings,
  covers: CoverResolver,
  detail: BookDetail,
  options: { updateExisting?: boolean } = {},
): Promise<CreateNoteResult> {
  const bookId = detail.id || detail.book_id || "";
  if (!bookId) throw new Error("侧车没有返回 book id");

  const folder = fanqieNoteFolder(settings);
  await ensureDir(app.vault.adapter, folder);

  let path = fanqieNotePath(settings, detail.title);
  let existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    const fields = parseFrontmatter(await app.vault.read(existing));
    if (fields.fq_book_id === bookId) {
      if (!options.updateExisting) {
        return { file: existing, created: false, skipped: true };
      }
      await updateMetadata(app, existing, detail);
      return { file: existing, created: false, skipped: false };
    }
    path = normalizePath(
      joinPath(folder, `${sanitizeFilename(detail.title)}-${bookId.slice(-4)}.md`),
    );
    existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      if (!options.updateExisting) return { file: existing, created: false, skipped: true };
      await updateMetadata(app, existing, detail);
      return { file: existing, created: false, skipped: false };
    }
  }

  const coverPath = fanqieCoverPath(settings, bookId);
  let coverValue = "";
  if (detail.cover_url) {
    const downloaded = await covers.downloadTo(detail.cover_url, coverPath);
    if (downloaded) coverValue = coverPath;
  }

  const frontmatter = buildFrontmatter(
    {
      type: "book",
      source: "fanqie",
      title: detail.title,
      author: detail.author || "",
      status: "在追",
      cover: coverValue,
      fq_book_id: bookId,
      fq_cover_url: detail.cover_url || "",
      fq_serial_status: detail.serial_status || "",
      fq_word_count: detail.word_count ?? 0,
      fq_chapter_total: detail.chapter_total ?? 0,
      fq_reading_chapter: "",
      fq_progress: 0,
      fq_unread_count: 0,
      fq_last_read_at: "",
      fq_related: "",
      created: new Date().toISOString().slice(0, 10),
      tags: ["book", "fanqie"],
    },
    FANQIE_FIELD_ORDER,
  );

  const body = `# ${detail.title}\n\n> ${detail.author || "佚名"}${detail.serial_status ? ` · ${detail.serial_status}` : ""}\n`;
  const file = await app.vault.create(path, frontmatter + body);
  return { file, created: true, skipped: false };
}

async function updateMetadata(app: App, file: TFile, detail: BookDetail): Promise<void> {
  await app.vault.process(file, (data) =>
    patchFrontmatter(data, {
      author: detail.author || "",
      fq_cover_url: detail.cover_url || "",
      fq_serial_status: detail.serial_status || "",
      fq_word_count: detail.word_count ?? 0,
      fq_chapter_total: detail.chapter_total ?? 0,
    }),
  );
}

/** 换章 / 退出阅读器时写摘要；滚动绝不触发（规格 8.5）。 */
export async function writeReadingSummary(
  app: App,
  file: TFile,
  summary: FanqieNoteSummary,
): Promise<void> {
  await app.vault.process(file, (data) =>
    patchFrontmatter(data, {
      fq_reading_chapter: summary.chapterTitle,
      fq_progress: summary.percent,
      ...(summary.unread === undefined ? {} : { fq_unread_count: summary.unread }),
      fq_last_read_at: summary.at,
    }),
  );
}

export async function writeUnreadCount(app: App, file: TFile, unread: number): Promise<void> {
  await app.vault.process(file, (data) => patchFrontmatter(data, { fq_unread_count: unread }));
}

export async function writeRelated(app: App, file: TFile, relatedLink: string): Promise<void> {
  await app.vault.process(file, (data) => patchFrontmatter(data, { fq_related: relatedLink }));
}

export function findNoteFile(app: App, entries: EntryIndex, bookId: string): TFile | null {
  const item = entries.byBookId(bookId);
  if (!item) return null;
  const file = app.vault.getAbstractFileByPath(item.path);
  return file instanceof TFile ? file : null;
}

/** 打开章节时若 frontmatter 与 JSON 不一致，以 JSON 为准纠正摘要。 */
export async function reconcileSummary(
  app: App,
  entries: EntryIndex,
  bookId: string,
  chapterTitle: string,
  chapterIndex: number,
  total: number,
  at: string,
): Promise<void> {
  const file = findNoteFile(app, entries, bookId);
  if (!file) return;
  const fields = parseFrontmatter(await app.vault.read(file));
  const percent = Math.round((chapterIndex / Math.max(1, total)) * 100);
  if (
    fields.fq_reading_chapter === chapterTitle &&
    Number(fields.fq_progress) === percent
  ) {
    return;
  }
  await writeReadingSummary(app, file, {
    chapterTitle,
    chapterIndex,
    total,
    percent,
    at,
  });
}
