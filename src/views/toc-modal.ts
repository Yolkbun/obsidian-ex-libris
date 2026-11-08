import { App, Modal } from "obsidian";
import type { ChapterMeta } from "../domain/types";

/**
 * 番茄章节目录。1496 章也直接渲染；搜索框按标题过滤，当前章高亮并自动滚到可见处。
 */
export class TocModal extends Modal {
  private query = "";
  private listEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly bookTitle: string,
    private readonly chapters: ChapterMeta[],
    private readonly currentId: string | undefined,
    private readonly onSelect: (chapterId: string) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const doc = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    this.contentEl.addClass("ex-libris-toc-modal");

    const title = doc.createElement("h3");
    title.textContent = `目录 · 《${this.bookTitle}》`;
    this.contentEl.append(title);

    const bar = doc.createElement("div");
    bar.className = "ex-libris-toc-bar";
    const input = doc.createElement("input");
    input.type = "text";
    input.placeholder = "搜索章节标题…";
    input.addEventListener("input", () => {
      this.query = input.value.trim().toLowerCase();
      this.renderList();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const first = this.filtered()[0];
      if (first) this.pick(first.id);
    });
    this.countEl = doc.createElement("span");
    this.countEl.className = "ex-libris-toc-count";
    bar.append(input, this.countEl);
    this.contentEl.append(bar);

    this.listEl = doc.createElement("div");
    this.listEl.className = "ex-libris-toc-list";
    this.listEl.setAttribute("role", "list");
    this.contentEl.append(this.listEl);

    this.renderList();
    input.focus();
  }

  private filtered(): ChapterMeta[] {
    if (!this.query) return this.chapters;
    return this.chapters.filter((chapter) =>
      chapter.title.toLowerCase().includes(this.query),
    );
  }

  private renderList(): void {
    if (!this.listEl) return;
    const items = this.filtered();
    if (this.countEl) {
      this.countEl.textContent = this.query
        ? `${items.length} / ${this.chapters.length} 章`
        : `共 ${this.chapters.length} 章`;
    }

    const fragment = this.listEl.ownerDocument.createDocumentFragment();
    for (const chapter of items) {
      const row = this.listEl.ownerDocument.createElement("button");
      row.type = "button";
      row.className = "ex-libris-toc-row";
      row.setAttribute("role", "listitem");
      if (chapter.id === this.currentId) {
        row.classList.add("is-current");
        row.setAttribute("aria-current", "true");
      }
      const index = this.listEl.ownerDocument.createElement("span");
      index.className = "ex-libris-toc-index";
      index.textContent = String(chapter.index + 1).padStart(4, "0");
      const name = this.listEl.ownerDocument.createElement("span");
      name.className = "ex-libris-toc-title";
      name.textContent = chapter.title;
      row.append(index, name);
      row.addEventListener("click", () => this.pick(chapter.id));
      fragment.append(row);
    }
    this.listEl.replaceChildren(fragment);

    const current = this.listEl.querySelector(".is-current");
    if (typeof current?.scrollIntoView === "function") {
      current.scrollIntoView({ block: "center" });
    }
  }

  private pick(chapterId: string): void {
    this.close();
    this.onSelect(chapterId);
  }

  override onClose(): void {
    this.contentEl.replaceChildren();
  }
}
