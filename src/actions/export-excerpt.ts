import { App, FuzzySuggestModal, TFile } from "obsidian";
import { truncateText } from "../util/text";

export const EXCERPT_HEADING = "## 摘录";
export const EXCERPT_MAX_CHARS = 800;

export interface ExcerptInput {
  text: string;
  bookTitle: string;
  chapterTitle: string;
  bookId: string;
  /** 0 基章序号；写进链接时用 1 基，便于人读 */
  chapterIndex: number;
}

export function excerptLink(bookId: string, chapterIndex: number): string {
  const ordinal = Math.max(1, chapterIndex + 1);
  return `obsidian://ex-libris?book=${encodeURIComponent(bookId)}&chapter=${ordinal}`;
}

/**
 * 摘录固定的 callout 形状（规格 8.3）：
 *   > [!quote] 摘录
 *   > 正文……
 *   > — 《书》· 第 58 章 章名 · [回跳](obsidian://...)
 */
export function buildExcerptBlock(input: ExcerptInput): { markdown: string; truncated: boolean } {
  const { text, truncated } = truncateText(input.text.trim(), EXCERPT_MAX_CHARS);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const ordinal = Math.max(1, input.chapterIndex + 1);
  const cleanedTitle = input.chapterTitle.replace(/^第\s*[0-9一二三四五六七八九十百千]+\s*章[\s:：·-]*/, "").trim();
  const chapterLabel = cleanedTitle
    ? `第 ${ordinal} 章 ${cleanedTitle}`
    : `第 ${ordinal} 章`;
  const attribution = `— 《${input.bookTitle}》· ${chapterLabel} · [回跳](${excerptLink(
    input.bookId,
    input.chapterIndex,
  )})`;

  const bodyLines = [...lines, truncated ? "…（摘录已截断）" : "", attribution].filter(
    (line) => line.length > 0,
  );
  const markdown = ["> [!quote] 摘录", ...bodyLines.map((line) => `> ${line}`)].join("\n");
  return { markdown, truncated };
}

/** 有 `## 摘录` 就插到它下面，否则在文末新建一节。 */
export function appendUnderExcerptHeading(contents: string, block: string): string {
  const headingPattern = /^##[ \t]+摘录[ \t]*$/m;
  const match = headingPattern.exec(contents);
  if (!match) {
    const base = contents.replace(/\s+$/, "");
    return `${base ? `${base}\n\n` : ""}${EXCERPT_HEADING}\n\n${block}\n`;
  }
  const insertAt = match.index + match[0].length;
  const before = contents.slice(0, insertAt).replace(/\s+$/, "");
  const after = contents.slice(insertAt).replace(/^\s+/, "");
  const head = `${before}\n\n${block}\n`;
  return after ? `${head}\n${after}` : head;
}

export async function insertExcerpt(app: App, file: TFile, block: string): Promise<void> {
  await app.vault.process(file, (data) => appendUnderExcerptHeading(data, block));
}

/** 选中摘录目标笔记的模糊搜索。 */
export class ExcerptTargetModal extends FuzzySuggestModal<TFile> {
  private settled = false;

  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly resolve: (file: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder("插到哪条笔记？输入名称筛选…");
  }

  override getItems(): TFile[] {
    return this.files;
  }

  override getItemText(item: TFile): string {
    return item.path;
  }

  override onChooseItem(item: TFile): void {
    this.settled = true;
    this.resolve(item);
  }

  override onClose(): void {
    super.onClose();
    if (!this.settled) this.resolve(null);
  }
}

export function chooseExcerptTarget(app: App): Promise<TFile | null> {
  const files = app.vault
    .getMarkdownFiles()
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
  return new Promise<TFile | null>((resolve) => {
    new ExcerptTargetModal(app, files, resolve).open();
  });
}
