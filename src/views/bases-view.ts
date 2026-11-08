import { BasesView, Plugin, QueryController } from "obsidian";
import type { BasesViewConfig } from "obsidian";
import type { ShelfItem } from "../domain/types";
import type { CoverRef } from "../domain/types";
import type { EntryIndex } from "../library/entries";
import type { CoverResolver } from "../library/cover";
import { renderShelf, type ShelfRenderOptions } from "./shelf-render";

export const BASES_VIEW_TYPE = "ex-libris-shelf";

export interface BasesShelfContext {
  entries: EntryIndex;
  covers: CoverResolver;
  settings: () => { coverWidth: number; showProgress: boolean; gap: number };
  onOpen: (item: ShelfItem) => void;
}

export class ExLibrisBasesView extends BasesView {
  override type = BASES_VIEW_TYPE;
  private readonly root: HTMLElement;

  constructor(
    controller: QueryController,
    containerEl: HTMLElement,
    private readonly context: BasesShelfContext,
  ) {
    super(controller);
    this.root = containerEl.ownerDocument.createElement("div");
    this.root.className = "ex-libris-bases";
    containerEl.append(this.root);
    this.register(this.context.entries.onChange(() => this.onDataUpdated()));
  }

  override onDataUpdated(): void {
    try {
      const items = this.collectItems();
      const options = this.renderOptions();
      renderShelf(this.root, items, {
        ...options,
        onOpen: (item) => this.context.onOpen(item),
      });
    } catch (err) {
      console.warn("[ex-libris] Bases 视图渲染失败", err);
      this.root.replaceChildren();
      const message = this.root.ownerDocument.createElement("div");
      message.className = "ex-libris-empty";
      message.textContent = "书架渲染失败，详见控制台。";
      this.root.append(message);
    }
  }

  private collectItems(): ShelfItem[] {
    const result = this.data as unknown as { data?: Array<{ file?: { path: string } }> } | undefined;
    const rows = result?.data;
    if (!Array.isArray(rows) || rows.length === 0) {
      return this.context.entries.all();
    }
    const items: ShelfItem[] = [];
    for (const row of rows) {
      const path = row.file?.path;
      if (!path) continue;
      const item = this.context.entries.get(path);
      if (item) items.push(item);
    }
    return items;
  }

  private renderOptions(): ShelfRenderOptions {
    const settings = this.context.settings();
    const config = this.config as BasesViewConfig | undefined;
    const coverWidth = readNumber(config?.get("coverWidth"), settings.coverWidth);
    const showProgress = readBoolean(config?.get("showProgress"), settings.showProgress);
    return {
      coverWidth,
      showProgress,
      gap: settings.gap,
      resolveCover: (cover: CoverRef) =>
        cover.kind === "vault" ? this.context.covers.resourcePath(cover.value) : cover.value,
    };
  }
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

/**
 * Bases 1.10+ 的注册入口。API 变动时 registerBasesView 可能返回 falsy 或直接抛错，
 * 两种情况都只 console.warn，不让插件起不来。
 */
export function registerBasesShelf(plugin: Plugin, context: BasesShelfContext): boolean {
  try {
    const registered = plugin.registerBasesView(BASES_VIEW_TYPE, {
      name: "Ex Libris 书架",
      icon: "library",
      options: () => [
        {
          type: "slider",
          key: "coverWidth",
          displayName: "封面宽度",
          default: 140,
          min: 100,
          max: 220,
          step: 10,
        },
        {
          type: "toggle",
          key: "showProgress",
          displayName: "显示阅读进度",
          default: true,
        },
      ],
      factory: (controller, containerEl) =>
        new ExLibrisBasesView(controller, containerEl, context),
    });
    if (!registered) {
      console.warn("[ex-libris] registerBasesView 返回 false，Bases 视图不可用（书架视图照常）。");
    }
    return registered;
  } catch (err) {
    console.warn("[ex-libris] registerBasesView 失败，跳过 Bases 视图", err);
    return false;
  }
}
