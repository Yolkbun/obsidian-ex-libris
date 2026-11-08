import { App, normalizePath, TFile } from "obsidian";
import type { Chapter, ChapterMeta } from "../domain/types";
import type { ExLibrisSettings } from "../settings";
import { ensureDir, joinPath, sanitizeFilename } from "../util/paths";
import { buildFrontmatter } from "../util/text";

const EXPORT_FIELD_ORDER = [
  "type",
  "source",
  "title",
  "author",
  "book_title",
  "fq_book_id",
  "fq_chapter_id",
  "fq_chapter_index",
  "exported",
  "tags",
];

export function chapterBody(chapterTitle: string, paragraphs: string[]): string {
  const heading = `# ${chapterTitle}\n`;
  const paragraphsText = paragraphs
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n\n");
  return `${heading}\n${paragraphsText}\n`;
}

export function chapterFilePath(
  settings: ExLibrisSettings,
  bookTitle: string,
  chapter: Chapter,
  meta: ChapterMeta | undefined,
): string {
  const index = typeof chapter.index === "number" && chapter.index >= 0 ? chapter.index : meta?.index ?? 0;
  const title = meta?.title || chapter.title || `第 ${index + 1} 章`;
  const ordinal = String(index + 1).padStart(4, "0");
  return normalizePath(
    joinPath(
      settings.exportFolder,
      sanitizeFilename(bookTitle),
      `${ordinal} - ${sanitizeFilename(title)}.md`,
    ),
  );
}

/** 显式导出：正文才允许落盘（红线 3）。 */
export async function exportChapterFile(
  app: App,
  settings: ExLibrisSettings,
  bookTitle: string,
  bookId: string,
  chapter: Chapter,
  meta: ChapterMeta | undefined,
): Promise<TFile> {
  const path = chapterFilePath(settings, bookTitle, chapter, meta);
  const frontmatter = buildFrontmatter(
    {
      type: "book",
      source: "fanqie-export",
      title: meta?.title || chapter.title || "",
      author: "",
      book_title: bookTitle,
      fq_book_id: bookId,
      fq_chapter_id: chapter.id,
      fq_chapter_index: typeof chapter.index === "number" ? chapter.index : meta?.index ?? 0,
      exported: new Date().toISOString(),
      tags: ["book", "fanqie"],
    },
    EXPORT_FIELD_ORDER,
  );
  const content = frontmatter + chapterBody(meta?.title || chapter.title, chapter.paragraphs);

  await ensureDir(app.vault.adapter, path.slice(0, Math.max(0, path.lastIndexOf("/"))));
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
    return existing;
  }
  return app.vault.create(path, content);
}
