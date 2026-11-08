import { ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { Chapter, ChapterMeta, ShelfItem } from "../domain/types";
import type { SidecarClient } from "../sidecar/client";
import { SidecarError } from "../sidecar/client";
import type { ProgressStore } from "../progress/store";
import type { EntryIndex } from "../library/entries";
import { CommentsPanel } from "./comments-panel";
import { TocModal } from "./toc-modal";
import type { AnnotationColor, AnnotationKind, AnnotationStore } from "../annotations/store";
import type { AnnotationNoteInput } from "../library/annotation-note";

export const VIEW_TYPE_READER = "ex-libris-reader";

export interface ReadingSummary {
  bookId: string;
  chapterTitle: string;
  chapterIndex: number;
  total: number;
  percent: number;
  at: string;
}

export interface ExcerptPayload {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  text: string;
}

export interface ReaderDeps {
  client: SidecarClient;
  progress: ProgressStore;
  entries: EntryIndex;
  /** 番茄轻笔记的文件名（找不到时回落到 bookId） */
  noteTitle: (bookId: string) => string | undefined;
  writeSummary: (summary: ReadingSummary) => Promise<void>;
  exportChapter: (bookId: string, chapterId: string) => Promise<void>;
  requestExcerpt: (payload: ExcerptPayload) => Promise<void>;
  annotations: AnnotationStore;
  writeAnnotation: (input: AnnotationNoteInput) => Promise<void>;
}

export interface ReaderState {
  bookId: string;
  chapterId?: string;
}

/**
 * 阅读器：虚拟视图，正文永不进 vault。
 * 状态只存 bookId / chapterId；位置进 progress.json。
 */
export class ReaderView extends ItemView {
  private pending: ReaderState | null = null;
  private bookId = "";
  private bookTitle = "";
  private toc: ChapterMeta[] = [];
  private current: Chapter | null = null;
  private currentIndex = -1;
  private loadToken = 0;
  private destroyed = false;

  private rootEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private pendingRange: Range | null = null;
  private pendingParagraph: HTMLParagraphElement | null = null;
  private bookLabelEl: HTMLElement | null = null;
  private chapterLabelEl: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private footerLabelEl: HTMLElement | null = null;
  private prevButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private comments: CommentsPanel | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: ReaderDeps,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_READER;
  }

  override getDisplayText(): string {
    return this.bookTitle ? `${this.bookTitle} · Ex Libris` : "Ex Libris 阅读器";
  }

  override getIcon(): string {
    return "book-open";
  }

  override getState(): Record<string, unknown> {
    return { bookId: this.bookId, chapterId: this.current?.id };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const next = state as Partial<ReaderState> | null;
    if (next && typeof next.bookId === "string" && next.bookId.trim()) {
      this.pending = {
        bookId: next.bookId,
        ...(typeof next.chapterId === "string" && next.chapterId
          ? { chapterId: next.chapterId }
          : {}),
      };
      if (this.rootEl) {
      await this.openBook(this.pending.bookId, this.pending.chapterId);
    } else {
      // 某些布局恢复路径下 Obsidian 只调 setState、不调 onOpen；
      // contentEl 已经存在，直接补建布局，避免出现空白页。
      this.buildLayout();
      await this.openBook(this.pending.bookId, this.pending.chapterId);
    }
    }
    await super.setState(state, result);
  }


  override async onOpen(): Promise<void> {
    try {
      this.buildLayout();
    } catch (err) {
      throw err;
    }
    if (this.pending) {
      const pending = this.pending;
      await this.openBook(pending.bookId, pending.chapterId);
    }
    this.registerDomEvent(document, "keydown", (event) => this.handleKey(event));
    this.registerDomEvent(document, "mouseup", (event) => this.handleSelection(event));
    this.registerDomEvent(document, "selectionchange", () => {
      const selection = this.pageEl?.ownerDocument.getSelection();
      if (!selection || selection.isCollapsed) this.hideToolbar(false);
    });
  }

  override async onClose(): Promise<void> {
    this.destroyed = true;
    this.loadToken++;
    await this.persistSummary();
    await this.deps.progress.flush();
    this.comments?.destroy();
    this.comments = null;
    this.hideToolbar();
    this.toolbarEl?.remove();
    this.toolbarEl = null;
    this.rootEl = null;
    await this.deps.annotations.flush();
  }

  /** 供命令 / 回跳协议调用。 */
  async openBook(bookId: string, chapterId?: string): Promise<void> {
    if (!this.rootEl) {
      this.pending = { bookId, ...(chapterId ? { chapterId } : {}) };
      return;
    }
    this.bookId = bookId;
    this.bookTitle = this.deps.noteTitle(bookId) ?? bookId;
    this.setLabels({ book: this.bookTitle, chapter: "载入中…" });
    this.setBusy("正在读取目录…");

    try {
      const toc = await this.deps.client.chapters(bookId);
      this.toc = toc.items;
      if (this.toc.length === 0) {
        this.showError("这本书还没有目录。", false);
        return;
      }
      const record = this.deps.progress.get(bookId);
      let target = chapterId;
      if (!target && record) {
        const inToc = this.toc.some((item) => item.id === record.chapterId);
        if (inToc) {
          target = record.chapterId;
          // JSON 是位置的唯一真相：同时纠正 frontmatter 摘要
          void this.persistSummary();
        }
      }
      if (!target) target = this.toc[0]!.id;
      await this.loadChapter(target, { restore: target === record?.chapterId });
    } catch (err) {
      this.showSidecarError(err);
    }
  }

  private buildLayout(): void {
    if (this.rootEl) return;
    const doc = this.contentEl.ownerDocument;
    this.contentEl.classList.add("ex-libris-reader-host");

    const root = doc.createElement("div");
    root.className = "ex-libris-reader";
    this.rootEl = root;

    const header = doc.createElement("header");
    header.className = "ex-libris-reader-header";
    this.bookLabelEl = doc.createElement("span");
    this.bookLabelEl.className = "ex-libris-reader-book";
    const sep = doc.createElement("span");
    sep.className = "ex-libris-reader-sep";
    sep.textContent = "·";
    this.chapterLabelEl = doc.createElement("span");
    this.chapterLabelEl.className = "ex-libris-reader-chapter";

    const actions = doc.createElement("div");
    actions.className = "ex-libris-reader-actions";
    const tocButton = doc.createElement("button");
    tocButton.className = "ex-libris-icon-button";
    tocButton.textContent = "目录";
    tocButton.title = "章节目录（T）";
    tocButton.addEventListener("click", () => this.openToc());
    const exportButton = doc.createElement("button");
    exportButton.className = "ex-libris-icon-button";
    exportButton.textContent = "导出本章";
    exportButton.title = "Ctrl+E";
    exportButton.addEventListener("click", () => void this.exportCurrent());
    const commentsButton = doc.createElement("button");
    commentsButton.className = "ex-libris-icon-button";
    commentsButton.textContent = "书评";
    commentsButton.title = "本书读者评论（只读）";
    commentsButton.addEventListener("click", () => void this.toggleComments());
    actions.append(tocButton, exportButton, commentsButton);
    header.append(this.bookLabelEl, sep, this.chapterLabelEl, actions);

    const main = doc.createElement("main");
    main.className = "ex-libris-reader-main";
    this.scrollEl = doc.createElement("div");
    this.scrollEl.className = "ex-libris-reader-scroll";
    this.pageEl = doc.createElement("article");
    this.pageEl.className = "ex-libris-reader-page";
    this.scrollEl.append(this.pageEl);
    main.append(this.scrollEl);

    this.comments = new CommentsPanel(doc, (bookId, chapterId, page) =>
      this.deps.client.comments(bookId, chapterId, page),
    );
    main.append(this.comments.el);

    const footer = doc.createElement("footer");
    footer.className = "ex-libris-reader-footer";
    this.prevButton = doc.createElement("button");
    this.prevButton.textContent = "← 上一章";
    this.prevButton.addEventListener("click", () => void this.go(-1));
    this.nextButton = doc.createElement("button");
    this.nextButton.textContent = "下一章 →";
    this.nextButton.addEventListener("click", () => void this.go(1));
    const nav = doc.createElement("div");
    nav.className = "ex-libris-reader-nav";
    nav.append(this.prevButton, this.nextButton);
    this.footerLabelEl = doc.createElement("span");
    this.footerLabelEl.className = "ex-libris-reader-position";
    footer.append(nav, this.footerLabelEl);

    root.append(header, main, footer);
    this.contentEl.append(root);

    this.toolbarEl = this.buildAnnotationToolbar(doc);
    doc.body.append(this.toolbarEl);

    this.scrollEl.addEventListener("scroll", () => {
      this.hideToolbar(false);
      this.handleScroll();
    });
  }

  private setLabels(labels: { book: string; chapter: string }): void {
    if (this.bookLabelEl) this.bookLabelEl.textContent = labels.book;
    if (this.chapterLabelEl) this.chapterLabelEl.textContent = labels.chapter;
  }

  private setBusy(message: string): void {
    if (!this.pageEl) return;
    this.pageEl.replaceChildren();
    const waiting = this.pageEl.ownerDocument.createElement("div");
    waiting.className = "ex-libris-reader-loading";
    waiting.textContent = message;
    this.pageEl.append(waiting);
  }

  private showError(message: string, retryable: boolean): void {
    if (!this.pageEl) return;
    this.pageEl.replaceChildren();
    const box = this.pageEl.ownerDocument.createElement("div");
    box.className = "ex-libris-reader-error";
    box.textContent = message;
    if (retryable) {
      const retry = this.pageEl.ownerDocument.createElement("button");
      retry.className = "ex-libris-icon-button";
      retry.textContent = "重试";
      retry.setCssStyles({ marginTop: "12px" });
      retry.addEventListener("click", () => void this.openBook(this.bookId));
      box.append(retry);
    }
    this.pageEl.append(box);
  }

  private showSidecarError(err: unknown): void {
    if (err instanceof SidecarError) {
      switch (err.code) {
        case "SIDECAR_UNAVAILABLE":
          this.showError("番茄侧车未运行，暂时无法阅读。书架与摘录不受影响。", true);
          return;
        case "NOT_FOUND":
          this.showError("这一章在番茄上找不到了。", true);
          return;
        case "UPSTREAM_TIMEOUT":
          this.showError("番茄响应超时，请稍后重试。", true);
          return;
        case "DECRYPT_FAILED":
          this.showError("正文解密失败，可能是上游改版。", true);
          return;
        case "RATE_LIMITED":
          this.showError("请求被上游限流，等一会儿再试。", true);
          return;
        default:
          this.showError(`读取失败：${err.message}`, true);
          return;
      }
    }
    this.showError(`读取失败：${String(err)}`, true);
  }

  /** 打开章节目录（阅读器按钮 / T / 命令面板）。 */
  openToc(): void {
    if (!this.toc.length) {
      new Notice("目录还没加载好，稍后再试。");
      return;
    }
    new TocModal(
      this.app,
      this.bookTitle,
      this.toc,
      this.current?.id ?? this.toc[this.currentIndex]?.id,
      (chapterId) => void this.loadChapter(chapterId),
    ).open();
  }

  private buildAnnotationToolbar(doc: Document): HTMLElement {
    const bar = doc.createElement("div");
    bar.className = "ex-libris-annotate-toolbar";
    bar.addEventListener("mousedown", (event) => event.preventDefault());

    const highlight = doc.createElement("button");
    highlight.type = "button";
    highlight.className = "ex-libris-annotate-action";
    highlight.textContent = "高亮";
    highlight.title = "高亮选中文字并导出批注";
    highlight.addEventListener("click", () => void this.applyAnnotation("highlight", "yellow"));
    bar.append(highlight);

    for (const [color, label] of [
      ["red", "红"],
      ["blue", "蓝"],
      ["green", "绿"],
    ] as Array<[AnnotationColor, string]>) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = `ex-libris-annotate-color is-${color}`;
      button.textContent = "●";
      button.title = `字体颜色：${label}`;
      button.setAttribute("aria-label", `字体颜色：${label}`);
      button.addEventListener("click", () => void this.applyAnnotation("color", color));
      bar.append(button);
    }

    const copy = doc.createElement("button");
    copy.type = "button";
    copy.className = "ex-libris-annotate-action";
    copy.textContent = "复制";
    copy.title = "复制选中文字（不导出）";
    copy.addEventListener("click", () => void this.copySelection());
    bar.append(copy);
    return bar;
  }

  private handleSelection(_event: MouseEvent): void {
    if (!this.pageEl) return;
    const doc = this.pageEl.ownerDocument;
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.hideToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!this.pageEl.contains(range.commonAncestorContainer)) return;
    const start = this.paragraphOf(range.startContainer);
    const end = this.paragraphOf(range.endContainer);
    if (!start || start !== end || !range.toString().trim()) {
      this.hideToolbar();
      return;
    }
    this.pendingRange = range.cloneRange();
    this.pendingParagraph = start;
    this.showToolbar(range.getBoundingClientRect());
  }

  private paragraphOf(node: Node): HTMLParagraphElement | null {
    const element =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement;
    const paragraph = element?.closest("p");
    return (paragraph as HTMLParagraphElement | null) ?? null;
  }

  private showToolbar(rect: DOMRect): void {
    if (!this.toolbarEl) return;
    const win = this.toolbarEl.ownerDocument.defaultView;
    const width = win?.innerWidth ?? 1200;
    const center = rect.left + rect.width / 2;
    const left = Math.min(Math.max(center, 130), Math.max(130, width - 130));
    const top = Math.max(rect.top - 46, 8);
    this.toolbarEl.setCssStyles({
      display: "flex",
      left: `${left}px`,
      top: `${top}px`,
    });
  }

  private hideToolbar(clear = true): void {
    if (this.toolbarEl) this.toolbarEl.setCssStyles({ display: "none" });
    if (clear) {
      this.pendingRange = null;
      this.pendingParagraph = null;
    }
  }

  private async applyAnnotation(kind: AnnotationKind, color: AnnotationColor): Promise<void> {
    const range = this.pendingRange;
    const paragraph = this.pendingParagraph;
    if (!range || !paragraph || !this.current) return;
    const text = range.toString().trim();
    if (!text) return;

    const doc = this.pageEl?.ownerDocument;
    if (!doc) return;
    const span = doc.createElement("span");
    span.className =
      kind === "highlight" ? `ex-annotation ex-hl-${color}` : `ex-annotation ex-fg-${color}`;
    try {
      range.surroundContents(span);
    } catch {
      new Notice("请在同一段内选择连续文字，再高亮或改色。");
      return;
    }

    const paragraphIndex = this.pageEl
      ? Array.from(this.pageEl.querySelectorAll("p")).indexOf(paragraph)
      : -1;
    const record = await this.deps.annotations.add(this.bookId, this.current.id, {
      text,
      paragraph: paragraph.textContent ?? "",
      paragraphIndex,
      kind,
      color,
    });
    this.hideToolbar();
    doc.getSelection()?.removeAllRanges();
    new Notice(kind === "highlight" ? "已高亮，并导出批注笔记" : "已改色，并导出批注笔记");
    try {
      await this.deps.writeAnnotation({
        bookId: this.bookId,
        bookTitle: this.bookTitle,
        chapterId: this.current.id,
        chapterTitle: this.current.title,
        chapterIndex: this.currentIndex,
        record,
      });
    } catch (err) {
      new Notice(`批注笔记写入失败：${String(err)}`);
    }
  }

  private async copySelection(): Promise<void> {
    const text = this.pendingRange?.toString() ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      new Notice("已复制选中文字（未导出）");
    } catch {
      new Notice("复制失败，请用 Ctrl+C。");
    }
    this.hideToolbar(false);
  }

  private applyStoredAnnotations(): void {
    if (!this.pageEl || !this.current) return;
    const paragraphs = Array.from(this.pageEl.querySelectorAll("p"));
    for (const record of this.deps.annotations.list(this.bookId, this.current.id)) {
      const paragraph = paragraphs[record.paragraphIndex];
      if (!paragraph || paragraph.textContent !== record.paragraph) continue;
      this.wrapText(paragraph, record);
    }
  }

  private wrapText(
    paragraph: HTMLElement,
    record: { text: string; kind: AnnotationKind; color: AnnotationColor; id: string },
  ): void {
    const doc = paragraph.ownerDocument;
    const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue ?? "";
      const index = value.indexOf(record.text);
      if (index < 0) continue;
      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + record.text.length);
      const span = doc.createElement("span");
      span.className =
        record.kind === "highlight"
          ? `ex-annotation ex-hl-${record.color}`
          : `ex-annotation ex-fg-${record.color}`;
      span.dataset.annotationId = record.id;
      try {
        range.surroundContents(span);
      } catch {
        /* 已经跨节点，跳过 */
      }
      return;
    }
  }

  /** 强制重新拉取目录（命令“刷新当前书目录”使用）。 */
  async refreshToc(): Promise<number> {
    if (!this.rootEl || !this.bookId) return 0;
    const toc = await this.deps.client.chapters(this.bookId, true);
    this.toc = toc.items;
    const currentId = this.current?.id;
    const index = currentId ? this.toc.findIndex((item) => item.id === currentId) : -1;
    if (index >= 0) {
      this.currentIndex = index;
      this.updateNav();
    } else if (this.toc[0]) {
      await this.loadChapter(this.toc[0].id);
    }
    return this.toc.length;
  }

  private async loadChapter(
    chapterId: string,
    options: { restore?: boolean } = {},
  ): Promise<void> {
    const token = ++this.loadToken;
    this.hideToolbar();
    const index = this.toc.findIndex((item) => item.id === chapterId);
    const meta = index >= 0 ? this.toc[index] : undefined;
    this.setLabels({
      book: this.bookTitle,
      chapter: meta?.title ?? `载入中…`,
    });
    this.setBusy("正在读取正文…");

    try {
      const chapter = await this.deps.client.chapter(this.bookId, chapterId);
      if (token !== this.loadToken || this.destroyed) return;
      this.current = chapter;
      this.currentIndex = index >= 0 ? index : chapter.index;
      this.renderChapter(chapter, meta);
      this.updateNav();
      const offset = options.restore ? (this.deps.progress.get(this.bookId)?.offset ?? 0) : 0;
      this.restoreScroll(offset);
      this.deps.progress.set(this.bookId, chapterId, this.currentIndex, offset);
      await this.persistSummary();
      if (this.comments?.isVisible) {
        await this.comments.show(this.bookId, chapterId);
      }
    } catch (err) {
      if (token !== this.loadToken) return;
      this.showSidecarError(err);
    }
  }

  private renderChapter(chapter: Chapter, meta: ChapterMeta | undefined): void {
    if (!this.pageEl) return;
    const doc = this.pageEl.ownerDocument;
    this.pageEl.replaceChildren();
    const heading = doc.createElement("h1");
    heading.textContent = meta?.title || chapter.title || "无标题";
    this.pageEl.append(heading);
    for (const paragraph of chapter.paragraphs) {
      const p = doc.createElement("p");
      p.textContent = paragraph;
      this.pageEl.append(p);
    }
    this.applyStoredAnnotations();
    this.setLabels({ book: this.bookTitle, chapter: heading.textContent ?? "" });
  }

  private updateNav(): void {
    const total = this.toc.length;
    const position = this.currentIndex + 1;
    if (this.footerLabelEl) {
      this.footerLabelEl.textContent = `第 ${Math.max(1, position)} / ${total} 章`;
    }
    if (this.prevButton) this.prevButton.disabled = this.currentIndex <= 0;
    if (this.nextButton) this.nextButton.disabled = this.currentIndex < 0 || this.currentIndex >= total - 1;
  }

  private restoreScroll(offset: number): void {
    if (!this.scrollEl) return;
    const apply = (): void => {
      if (!this.scrollEl) return;
      const max = Math.max(0, this.scrollEl.scrollHeight - this.scrollEl.clientHeight);
      this.scrollEl.scrollTop = Math.min(Math.max(0, offset), max);
    };
    apply();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
  }

  private handleScroll(): void {
    if (!this.current || !this.scrollEl) return;
    this.deps.progress.set(this.bookId, this.current.id, this.currentIndex, this.scrollEl.scrollTop);
  }

  private async go(direction: -1 | 1): Promise<void> {
    const nextIndex = this.currentIndex + direction;
    const next = this.toc[nextIndex];
    if (!next) return;
    await this.loadChapter(next.id);
  }

  private async exportCurrent(): Promise<void> {
    if (!this.current) {
      new Notice("还没有载入章节。");
      return;
    }
    try {
      await this.deps.exportChapter(this.bookId, this.current.id);
    } catch (err) {
      new Notice(`导出失败：${String(err)}`);
    }
  }

  private async toggleComments(): Promise<void> {
    if (!this.comments || !this.current) return;
    if (this.comments.isVisible) {
      this.comments.hide();
      return;
    }
    await this.comments.show(this.bookId, this.current.id);
  }

  private getSelectedText(): string {
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || !this.pageEl) return "";
    const range = selection.getRangeAt(0);
    if (!this.pageEl.contains(range.commonAncestorContainer)) return "";
    return selection.toString().trim();
  }

  private async excerptCurrent(): Promise<void> {
    const text = this.getSelectedText();
    if (!text) {
      new Notice("先在正文里选中要摘录的文字。");
      return;
    }
    if (!this.current) return;
    try {
      await this.deps.requestExcerpt({
        bookId: this.bookId,
        bookTitle: this.bookTitle,
        chapterId: this.current.id,
        chapterTitle: this.toc[this.currentIndex]?.title ?? this.current.title,
        chapterIndex: this.currentIndex,
        text,
      });
    } catch (err) {
      new Notice(`摘录失败：${String(err)}`);
    }
  }

  private handleKey(event: KeyboardEvent): void {
    if (!this.rootEl || this.destroyed) return;
    if (this.app.workspace.activeLeaf?.view !== this) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }
    if (event.key === "Escape") {
      this.hideToolbar();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        if (event.shiftKey) void this.excerptCurrent();
        else void this.exportCurrent();
      }
      return;
    }
    switch (event.key) {
      case "ArrowLeft":
      case "k":
        event.preventDefault();
        void this.go(-1);
        break;
      case "ArrowRight":
      case "j":
        event.preventDefault();
        void this.go(1);
        break;
      case "t":
      case "T":
        event.preventDefault();
        this.openToc();
        break;
      default:
        break;
    }
  }

  private async persistSummary(): Promise<void> {
    if (!this.bookId || this.toc.length === 0) return;
    const index = Math.max(0, this.currentIndex);
    const total = this.toc.length;
    const percent = Math.round((index / Math.max(1, total)) * 100);
    try {
      await this.deps.writeSummary({
        bookId: this.bookId,
        chapterTitle: this.toc[index]?.title ?? this.current?.title ?? "",
        chapterIndex: index,
        total,
        percent,
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("[ex-libris] 写入阅读摘要失败", err);
    }
  }
}

/** 从条目找阅读器需要的 bookId；没有就返回 null。 */
export function readerTarget(item: ShelfItem): string | null {
  return item.bookId ?? null;
}

/** 协议里 chapter 参数可能是章序号、章节 id，或省略。 */
export function resolveChapterParam(
  param: string | undefined,
  toc: ChapterMeta[],
): string | undefined {
  if (!param) return undefined;
  const numeric = Number(param);
  if (Number.isFinite(numeric)) {
    // 我们自己的回跳链接写的是 1 基章序号，优先按序号定位。
    const byOrdinal = toc[numeric - 1];
    if (byOrdinal) return byOrdinal.id;
  }
  if (toc.some((item) => item.id === param)) return param;
  if (!Number.isFinite(numeric)) return undefined;
  return toc.find((item) => item.index === numeric)?.id;
}
