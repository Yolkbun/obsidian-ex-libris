import { App, normalizePath, TFile } from "obsidian";
import type { ExLibrisSettings } from "../settings";
import type { AnnotationRecord } from "../annotations/store";
import { buildFrontmatter } from "../util/text";
import { ensureDir, joinPath, sanitizeFilename } from "../util/paths";

export interface AnnotationNoteInput {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  record: AnnotationRecord;
}

const COLOR_LABEL: Record<AnnotationRecord["color"], string> = {
  yellow: "黄色",
  red: "红色",
  blue: "蓝色",
  green: "绿色",
};

function blockquote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function blockOf(input: AnnotationNoteInput): string {
  const { record } = input;
  const kind =
    record.kind === "highlight"
      ? `高亮（${COLOR_LABEL[record.color]}）`
      : `字体颜色（${COLOR_LABEL[record.color]}）`;
  return [
    `> [!note] ${kind}`,
    blockquote(`**选中**：${record.text}`),
    ">",
    blockquote(`**所在段落**：${record.paragraph}`),
    ">",
    `> — ${record.createdAt}`,
  ].join("\n");
}

/**
 * 只有确实发生高亮/改色时才调用；把“选中文字 + 所在段落”追加到章节批注笔记。
 * 不写 fq_book_id / id / myState，避免被书架当成书。
 */
export async function appendAnnotationNote(
  app: App,
  settings: ExLibrisSettings,
  input: AnnotationNoteInput,
): Promise<TFile> {
  const folder = normalizePath(
    joinPath(
      settings.libraryRoot,
      "annotations",
      sanitizeFilename(input.bookTitle),
    ),
  );
  await ensureDir(app.vault.adapter, folder);

  const chapterName = sanitizeFilename(
    input.chapterTitle || `chapter-${input.chapterIndex + 1}`,
  );
  const path = normalizePath(
    joinPath(folder, `${String(input.chapterIndex + 1).padStart(4, "0")} - ${chapterName}.md`),
  );
  const block = blockOf(input);
  const existing = app.vault.getAbstractFileByPath(path);

  if (existing instanceof TFile) {
    let content = await app.vault.read(existing);
    if (!/^## 批注\s*$/m.test(content)) {
      content = `${content.trimEnd()}\n\n## 批注\n\n`;
    }
    await app.vault.modify(existing, `${content.trimEnd()}\n\n${block}\n`);
    return existing;
  }

  const frontmatter = buildFrontmatter(
    {
      type: "annotation",
      ex_book_id: input.bookId,
      ex_book_title: input.bookTitle,
      ex_chapter_id: input.chapterId,
      ex_chapter_title: input.chapterTitle,
      created: new Date().toISOString().slice(0, 10),
    },
    ["type", "ex_book_id", "ex_book_title", "ex_chapter_id", "ex_chapter_title", "created"],
  );
  const content = `${frontmatter}# 《${input.bookTitle}》· ${input.chapterTitle}\n\n## 批注\n\n${block}\n`;
  return await app.vault.create(path, content);
}
