import { ItemView, Menu, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import type { ShelfItem, ShelfPreset, TypeFilter } from "../domain/types";
import { renderShelf } from "./shelf-render";
import { filterShelf, presetCounts, typeCounts } from "./shelf-filter";
import type { ShelfUiDeps } from "./deps";

export const VIEW_TYPE_SHELF = "ex-libris-shelf";

const TYPE_CHIPS: Array<{ key: TypeFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "book", label: "书" },
  { key: "movie", label: "影" },
  { key: "tv", label: "剧" },
  { key: "music", label: "音" },
];

interface ShelfViewState {
  preset: string;
  filter: TypeFilter;
}

export class LibraryView extends ItemView {
  private shelfState: ShelfViewState = { preset: "all", filter: "all" };
  private rootEl: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastUnreadRefresh = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: ShelfUiDeps,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_SHELF;
  }

  override getDisplayText(): string {
    return "Ex Libris 书架";
  }

  override getIcon(): string {
    return "library";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.classList.add("ex-libris-library-host");
    this.render();
    this.unsubscribe = this.deps.entries.onChange(() => this.render());
    void this.deps.refreshUnread?.().catch((err) => console.warn("[ex-libris] 未读数刷新失败", err));
    this.lastUnreadRefresh = Date.now();
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.rootEl = null;
  }

  override getState(): Record<string, unknown> {
    return { ...this.shelfState };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const next = (state ?? {}) as Partial<ShelfViewState>;
    const presets = this.deps.presets();
    const presetId =
      typeof next.preset === "string" && presets.some((preset) => preset.id === next.preset)
        ? next.preset
        : presets[0]?.id ?? "all";
    const filter = TYPE_CHIPS.some((chip) => chip.key === next.filter)
      ? (next.filter as TypeFilter)
      : "all";
    this.shelfState = { preset: presetId, filter };
    await super.setState(state, result);
    if (this.rootEl) this.render();
  }

  /** 设置变更、侧车状态变化后由插件调用。 */
  refresh(): void {
    if (this.rootEl) this.render();
    const now = Date.now();
    if (now - this.lastUnreadRefresh > 5 * 60_000) {
      this.lastUnreadRefresh = now;
      void this.deps.refreshUnread?.().catch(() => undefined);
    }
  }

  private render(): void {
    const doc = this.contentEl.ownerDocument;
    if (this.rootEl) this.rootEl.remove();
    const root = doc.createElement("div");
    root.className = "ex-libris-library";
    this.rootEl = root;

    const items = this.deps.entries.all();
    const presets = this.deps.presets();
    const counts = presetCounts(items, presets);
    const visible = filterShelf(items, this.shelfState.preset, this.shelfState.filter, presets);
    const typeTally = typeCounts(items);

    root.append(this.renderPresets(doc, presets, counts));
    root.append(this.renderMain(doc, items, visible, typeTally));

    this.contentEl.append(root);
  }

  private renderPresets(
    doc: Document,
    presets: ShelfPreset[],
    counts: Record<string, number>,
  ): HTMLElement {
    const aside = doc.createElement("aside");
    aside.className = "ex-libris-presets";

    for (const preset of presets) {
      const row = doc.createElement("div");
      row.className = "ex-libris-preset";
      if (preset.id === this.shelfState.preset) row.classList.add("is-active");
      row.dataset.preset = preset.id;
      row.setAttribute("role", "tab");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-selected", String(preset.id === this.shelfState.preset));

      const name = doc.createElement("span");
      name.className = "ex-libris-preset-name";
      name.textContent = preset.name;
      const count = doc.createElement("span");
      count.className = "ex-libris-preset-count";
      count.textContent = String(counts[preset.id] ?? 0);
      row.append(name, count);

      const select = (): void => {
        this.shelfState = { ...this.shelfState, preset: preset.id };
        this.render();
      };
      row.addEventListener("click", select);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
      if (preset.kind === "custom") {
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const menu = new Menu();
          menu.addItem((entry) =>
            entry
              .setTitle("删除预设")
              .setIcon("trash")
              .onClick(() => {
                void this.deps.removePreset(preset.id).then(() => this.render());
              }),
          );
          menu.showAtMouseEvent(event);
        });
      }
      aside.append(row);
    }

    const add = doc.createElement("div");
    add.className = "ex-libris-preset-add";
    add.textContent = "+ 新增预设";
    add.setAttribute("role", "button");
    add.setAttribute("tabindex", "0");
    const addPreset = (): void => {
      void this.deps
        .addPreset()
        .then(() => this.render())
        .catch((err) => console.warn("[ex-libris] 新增预设失败", err));
    };
    add.addEventListener("click", addPreset);
    add.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        addPreset();
      }
    });
    aside.append(add);
    return aside;
  }

  private renderMain(
    doc: Document,
    allItems: ShelfItem[],
    visible: ShelfItem[],
    typeTally: Record<TypeFilter, number>,
  ): HTMLElement {
    const main = doc.createElement("section");
    main.className = "ex-libris-library-main";

    const toolbar = doc.createElement("div");
    toolbar.className = "ex-libris-toolbar";

    const chips = doc.createElement("div");
    chips.className = "ex-libris-chips";
    for (const chip of TYPE_CHIPS) {
      const button = doc.createElement("button");
      button.className = "ex-libris-chip";
      if (chip.key === this.shelfState.filter) button.classList.add("is-active");
      button.textContent = `${chip.label} ${typeTally[chip.key] ?? 0}`;
      button.addEventListener("click", () => {
        this.shelfState = { ...this.shelfState, filter: chip.key };
        this.render();
      });
      chips.append(button);
    }

    const spacer = doc.createElement("div");
    spacer.className = "ex-libris-toolbar-spacer";

    const count = doc.createElement("div");
    count.className = "ex-libris-count";
    count.textContent = `${visible.length} / ${allItems.length} 项`;

    toolbar.append(chips, spacer, count);
    main.append(toolbar);

    if (!this.deps.isSidecarReady()) {
      const banner = doc.createElement("div");
      banner.className = "ex-libris-degraded";
      const text = doc.createElement("span");
      text.textContent = `番茄侧车不可用：${this.deps.sidecarText()} 书架与豆瓣部分不受影响。`;
      const retry = doc.createElement("button");
      retry.className = "ex-libris-chip";
      retry.textContent = "重启侧车";
      retry.setCssStyles({ marginLeft: "10px" });
      retry.addEventListener("click", () => {
        void this.deps
          .restartSidecar()
          .then(() => this.render())
          .catch((err) => console.warn("[ex-libris] 重启侧车失败", err));
      });
      banner.append(text, retry);
      main.append(banner);
    }

    const body = doc.createElement("div");
    body.className = "ex-libris-library-body";
    main.append(body);

    const settings = this.deps.settings();
    renderShelf(body, visible, {
      coverWidth: settings.coverWidth,
      showProgress: settings.showProgress,
      gap: settings.gap,
      emptyText:
        this.shelfState.preset === "all" && this.shelfState.filter === "all"
          ? "书架还是空的"
          : "这个筛选下还没有条目",
      resolveCover: (cover) =>
        cover.kind === "vault" ? this.deps.covers.resourcePath(cover.value) : cover.value,
      onOpen: (item) => this.deps.openItem(item),
      onContextMenu: (item, event) => this.showContextMenu(item, event),
    });

    return main;
  }

  private showContextMenu(item: ShelfItem, event: MouseEvent): void {
    const menu = new Menu();
    if (item.bookId) {
      menu.addItem((entry) =>
        entry
          .setTitle("打开阅读器")
          .setIcon("book-open")
          .onClick(() => {
            if (!this.deps.isSidecarReady()) {
              new Notice("番茄侧车未运行，无法打开阅读器。");
              return;
            }
            void this.deps.openReader(item.bookId as string);
          }),
      );
    }
    menu.addItem((entry) =>
      entry
        .setTitle("打开笔记")
        .setIcon("file-text")
        .onClick(() => void this.deps.openNote(item)),
    );
    menu.addItem((entry) =>
      entry
        .setTitle("关联豆瓣条目")
        .setIcon("link")
        .onClick(() => void this.deps.linkDouban(item)),
    );
    menu.showAtMouseEvent(event);
  }
}
