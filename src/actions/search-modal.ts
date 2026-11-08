import { App, Menu, Modal, Notice } from "obsidian";
import type { BookBrief } from "../domain/types";
import type { SidecarClient } from "../sidecar/client";
import { describeError } from "./add-from-url";

/**
 * 搜索番茄并通过复选框批量加入书架（规格 8.1）。
 * 单本也可右键加入。
 */
export class FanqieSearchModal extends Modal {
  private input: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private footerEl: HTMLButtonElement | null = null;
  private results: BookBrief[] = [];
  private selected = new Set<string>();
  private page = 1;
  private total = 0;
  private busy = false;

  constructor(
    app: App,
    private readonly client: SidecarClient,
    private readonly addSelected: (books: BookBrief[]) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const doc = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    const title = doc.createElement("h3");
    title.textContent = "搜索番茄小说";
    this.contentEl.append(title);

    const bar = doc.createElement("div");
    bar.setCssStyles({ display: "flex", gap: "8px" });
    this.input = doc.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "书名或作者";
    this.input.setCssStyles({ flex: "1 1 auto" });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.search(1);
      }
    });
    const button = doc.createElement("button");
    button.className = "mod-cta";
    button.textContent = "搜索";
    button.addEventListener("click", () => void this.search(1));
    bar.append(this.input, button);
    this.contentEl.append(bar);

    this.statusEl = doc.createElement("div");
    this.statusEl.className = "ex-libris-search-empty";
    this.statusEl.textContent = "输入书名后回车。侧车未启动时这里会提示不可用。";
    this.contentEl.append(this.statusEl);

    this.listEl = doc.createElement("div");
    this.listEl.className = "ex-libris-search-list";
    this.contentEl.append(this.listEl);

    this.footerEl = doc.createElement("button");
    this.footerEl.className = "mod-cta";
    this.footerEl.textContent = "加入选中的 0 本";
    this.footerEl.disabled = true;
    this.footerEl.setCssStyles({ marginTop: "10px" });
    this.footerEl.addEventListener("click", () => void this.join());
    this.contentEl.append(this.footerEl);

    this.input.focus();
  }

  private async search(page: number): Promise<void> {
    const query = this.input?.value.trim() ?? "";
    if (!query) return;
    if (this.busy) return;
    this.busy = true;
    this.setStatus("搜索中…");
    try {
      const result = await this.client.search(query, page, 20);
      this.total = result.total;
      this.page = page;
      this.results = page === 1 ? result.items : [...this.results, ...result.items];
      this.renderResults(page === 1);
      this.setStatus(
        result.total === 0 ? "没有找到结果。" : `共 ${result.total} 条，已显示 ${this.results.length} 条`,
      );
    } catch (err) {
      this.setStatus(`搜索失败：${describeError(err)}`);
    } finally {
      this.busy = false;
    }
  }

  private renderedCount = 0;

  private renderResults(reset: boolean): void {
    if (!this.listEl) return;
    if (reset) {
      this.listEl.replaceChildren();
      this.renderedCount = 0;
    }
    const previousMore = this.listEl.querySelector(".ex-libris-load-more");
    previousMore?.remove();

    for (let i = this.renderedCount; i < this.results.length; i++) {
      this.listEl.append(this.renderRow(this.results[i]!));
    }
    this.renderedCount = this.results.length;

    if (this.results.length < this.total) {
      const more = this.listEl.ownerDocument.createElement("button");
      more.className = "ex-libris-chip ex-libris-load-more";
      more.textContent = "加载更多";
      more.addEventListener("click", () => {
        void this.search(this.page + 1);
      });
      this.listEl.append(more);
    }
  }

  private renderRow(book: BookBrief): HTMLElement {
    const doc = this.listEl!.ownerDocument;
    const row = doc.createElement("label");
    row.className = "ex-libris-search-row";

    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.selected.has(book.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(book.id);
      else this.selected.delete(book.id);
      this.updateFooter();
    });

    const text = doc.createElement("div");
    const title = doc.createElement("div");
    title.className = "ex-libris-search-title";
    title.textContent = book.title;
    const meta = doc.createElement("div");
    meta.className = "ex-libris-search-author";
    meta.textContent = [book.author, book.serial_status, formatWordCount(book.word_count)]
      .filter(Boolean)
      .join(" · ");
    text.append(title, meta);

    row.append(checkbox, text);

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("加入书架")
          .setIcon("plus")
          .onClick(() => void this.joinBooks([book])),
      );
      menu.showAtMouseEvent(event);
    });

    return row;
  }

  private updateFooter(): void {
    if (!this.footerEl) return;
    this.footerEl.textContent = `加入选中的 ${this.selected.size} 本`;
    this.footerEl.disabled = this.selected.size === 0;
  }

  private async join(): Promise<void> {
    const books = this.results.filter((book) => this.selected.has(book.id));
    await this.joinBooks(books);
  }

  private async joinBooks(books: BookBrief[]): Promise<void> {
    if (books.length === 0) return;
    this.setStatus(`正在加入 ${books.length} 本…`);
    try {
      await this.addSelected(books);
      this.selected.clear();
      this.updateFooter();
      this.setStatus("已加入书架。");
      this.close();
    } catch (err) {
      new Notice(`加入失败：${describeError(err)}`);
      this.setStatus(`加入失败：${describeError(err)}`);
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }
}

function formatWordCount(count: number | null): string {
  if (typeof count !== "number" || count <= 0) return "";
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)} 万字`;
  return `${count} 字`;
}
