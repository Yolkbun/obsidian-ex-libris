import { App, Menu, Modal, Notice } from "obsidian";
import { DoubanError, searchDouban, type DoubanItem, type DoubanKind } from "../library/douban";
import { describeError } from "./add-from-url";

/**
 * 豆瓣搜索：书 / 影·剧（音乐接口目前为空，不列）。
 * 选中后加入书架；不需要侧车，失败时明确提示限流。
 */
export class DoubanSearchModal extends Modal {
  private kind: DoubanKind = "book";
  private input: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private footerEl: HTMLButtonElement | null = null;
  private results: DoubanItem[] = [];
  private selected = new Set<string>();
  private busy = false;
  private kindButtons: HTMLButtonElement[] = [];

  constructor(
    app: App,
    private readonly addSelected: (items: DoubanItem[]) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const doc = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    this.contentEl.addClass("ex-libris-search-modal");

    const title = doc.createElement("h3");
    title.textContent = "搜索豆瓣";
    this.contentEl.append(title);

    const kinds = doc.createElement("div");
    kinds.className = "ex-libris-kinds";
    for (const [kind, label] of [
      ["book", "书"],
      ["screen", "影 · 剧"],
    ] as Array<[DoubanKind, string]>) {
      const button = doc.createElement("button");
      button.className = "ex-libris-chip";
      button.textContent = label;
      if (kind === this.kind) button.classList.add("is-active");
      button.addEventListener("click", () => {
        if (kind === this.kind) return;
        this.kind = kind;
        this.results = [];
        this.selected.clear();
        this.renderKindButtons();
        if (this.listEl) this.listEl.replaceChildren();
        this.updateFooter();
        this.setStatus("输入关键词后搜索。");
        this.input?.focus();
      });
      this.kindButtons.push(button);
      kinds.append(button);
    }
    this.contentEl.append(kinds);

    const bar = doc.createElement("div");
    bar.className = "ex-libris-search-bar";
    this.input = doc.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "书名 / 电影名 / 剧名";
    this.input.setCssStyles({ flex: "1 1 auto" });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.search();
      }
    });
    const button = doc.createElement("button");
    button.className = "mod-cta";
    button.textContent = "搜索";
    button.addEventListener("click", () => void this.search());
    bar.append(this.input, button);
    this.contentEl.append(bar);

    this.statusEl = doc.createElement("div");
    this.statusEl.className = "ex-libris-search-empty";
    this.statusEl.textContent = "豆瓣搜索为公开页面抓取，可能限流；失败时稍后再试。";
    this.contentEl.append(this.statusEl);

    this.listEl = doc.createElement("div");
    this.listEl.className = "ex-libris-search-list";
    this.contentEl.append(this.listEl);

    this.footerEl = doc.createElement("button");
    this.footerEl.className = "mod-cta";
    this.footerEl.textContent = "加入选中的 0 项";
    this.footerEl.disabled = true;
    this.footerEl.setCssStyles({ marginTop: "10px" });
    this.footerEl.addEventListener("click", () => void this.join());
    this.contentEl.append(this.footerEl);

    this.input.focus();
  }

  private renderKindButtons(): void {
    this.kindButtons.forEach((button, index) => {
      button.classList.toggle("is-active", (index === 0 ? "book" : "screen") === this.kind);
    });
  }

  private async search(): Promise<void> {
    const query = this.input?.value.trim() ?? "";
    if (!query || this.busy) return;
    this.busy = true;
    this.setStatus("搜索中…");
    try {
      this.results = await searchDouban(this.kind, query);
      this.selected.clear();
      this.renderResults();
      this.setStatus(
        this.results.length === 0 ? "没有找到结果（或豆瓣暂时限流）。" : `找到 ${this.results.length} 条`,
      );
    } catch (err) {
      this.results = [];
      this.renderResults();
      this.setStatus(err instanceof DoubanError ? err.message : `搜索失败：${describeError(err)}`);
    } finally {
      this.busy = false;
      this.updateFooter();
    }
  }

  private renderResults(): void {
    if (!this.listEl) return;
    this.listEl.replaceChildren();
    for (const item of this.results) {
      this.listEl.append(this.renderRow(item));
    }
  }

  private renderRow(item: DoubanItem): HTMLElement {
    const doc = this.listEl!.ownerDocument;
    const row = doc.createElement("label");
    row.className = "ex-libris-search-row";

    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.selected.has(item.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(item.id);
      else this.selected.delete(item.id);
      this.updateFooter();
    });

    const text = doc.createElement("div");
    const title = doc.createElement("div");
    title.className = "ex-libris-search-title";
    title.textContent = item.title;
    const meta = doc.createElement("div");
    meta.className = "ex-libris-search-author";
    meta.textContent = [item.author, item.year, item.type === "book" ? "书" : item.type === "tv" ? "剧" : "电影"]
      .filter(Boolean)
      .join(" · ");
    text.append(title, meta);
    row.append(checkbox, text);

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = new Menu();
      menu.addItem((entry) =>
        entry
          .setTitle("加入书架")
          .setIcon("plus")
          .onClick(() => void this.joinItems([item])),
      );
      menu.showAtMouseEvent(event);
    });

    return row;
  }

  private updateFooter(): void {
    if (!this.footerEl) return;
    this.footerEl.textContent = `加入选中的 ${this.selected.size} 项`;
    this.footerEl.disabled = this.selected.size === 0;
  }

  private async join(): Promise<void> {
    await this.joinItems(this.results.filter((item) => this.selected.has(item.id)));
  }

  private async joinItems(items: DoubanItem[]): Promise<void> {
    if (items.length === 0) return;
    this.setStatus(`正在加入 ${items.length} 项…`);
    try {
      await this.addSelected(items);
      this.selected.clear();
      this.updateFooter();
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
