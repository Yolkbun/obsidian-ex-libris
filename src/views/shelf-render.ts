import type { CoverRef, ShelfItem } from "../domain/types";
import { hueForTitle, initialForTitle } from "../util/hash";

export interface ShelfRenderOptions {
  /** 封面宽度，px（100–220） */
  coverWidth?: number;
  showProgress?: boolean;
  /** 网格间距，px */
  gap?: number;
  /** 固定列数；不传则自适应 */
  columns?: number;
  onOpen?: (item: ShelfItem) => void;
  onContextMenu?: (item: ShelfItem, event: MouseEvent) => void;
  /** 把 CoverRef 转成可放进 <img src> 的地址；vault 封面由调用方转成资源路径 */
  resolveCover?: (cover: CoverRef, item: ShelfItem) => string;
  emptyText?: string;
  /** 测试里关掉 IntersectionObserver */
  lazy?: boolean;
}

/** 重渲染时先断开上一个观察者，避免旧 <img> 被一直观察着。 */
const observers = new WeakMap<HTMLElement, IntersectionObserver>();

/**
 * ShelfItem[] → DOM。纯函数：不读全局状态、不发请求、不碰 app。
 * Bases 视图与书架 ItemView 都只调它。
 */
export function renderShelf(el: HTMLElement, items: ShelfItem[], options: ShelfRenderOptions = {}): void {
  const coverWidth = clamp(options.coverWidth ?? 140, 100, 220);
  const gap = clamp(options.gap ?? 18, 0, 64);
  const doc = el.ownerDocument;

  el.replaceChildren();
  el.classList.add("ex-libris-shelf");

  observers.get(el)?.disconnect();
  observers.delete(el);

  if (items.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "ex-libris-empty";
    const title = doc.createElement("div");
    title.className = "ex-libris-empty-title";
    title.textContent = options.emptyText ?? "书架还是空的";
    const hint = doc.createElement("div");
    hint.className = "ex-libris-empty-hint";
    hint.textContent = "用「Ex Libris: 从链接加入书架」收第一本书，或先用 obsidian-douban 导入豆瓣条目。";
    empty.append(title, hint);
    el.append(empty);
    return;
  }

  const grid = doc.createElement("div");
  grid.className = "ex-libris-grid";
  grid.setCssStyles({
    gap: `${gap}px`,
    gridTemplateColumns: options.columns
      ? `repeat(${Math.max(1, options.columns)}, minmax(0, 1fr))`
      : `repeat(auto-fill, minmax(${coverWidth}px, 1fr))`,
  });

  const observer = createLazyObserver(options.lazy === false);
  if (observer) observers.set(el, observer);

  for (const item of items) {
    grid.append(renderItem(doc, item, { ...options, coverWidth }, observer));
  }

  el.append(grid);
}

function renderItem(
  doc: Document,
  item: ShelfItem,
  options: Required<Pick<ShelfRenderOptions, "coverWidth">> & ShelfRenderOptions,
  observer: IntersectionObserver | null,
): HTMLElement {
  const book = doc.createElement("div");
  book.className = "ex-libris-book";
  book.setAttribute("role", "button");
  book.setAttribute("tabindex", "0");
  book.setAttribute("aria-label", `${item.title}${item.author ? `，${item.author}` : ""}`);
  book.dataset.path = item.path;
  if (item.source !== "douban") book.dataset.fanqie = "true";

  const coverBox = doc.createElement("div");
  coverBox.className = "ex-libris-cover";
  coverBox.setCssProps({ "--ex-cover-width": `${options.coverWidth}px` });

  const url = item.cover ? options.resolveCover?.(item.cover, item) ?? null : null;
  if (url) {
    const img = doc.createElement("img");
    img.className = "ex-libris-cover-image";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    img.draggable = false;
    if (observer) {
      img.dataset.src = url;
      observer.observe(img);
    } else {
      img.src = url;
    }
    img.addEventListener("error", () => {
      if (observer) observer.unobserve(img);
      img.remove();
      coverBox.append(placeholderFor(doc, item.title));
      coverBox.classList.add("is-placeholder");
    });
    coverBox.append(img);
  } else {
    coverBox.classList.add("is-placeholder");
    coverBox.append(placeholderFor(doc, item.title));
  }

  const spine = doc.createElement("div");
  spine.className = "ex-libris-spine";
  coverBox.append(spine);

  const source = doc.createElement("div");
  source.className = `ex-libris-source ex-libris-source-${item.source}`;
  source.title =
    item.source === "douban" ? "豆瓣" : item.source === "fanqie" ? "番茄" : "豆瓣 + 番茄";
  coverBox.append(source);

  if (item.badge) {
    const badge = doc.createElement("div");
    badge.className = "ex-libris-badge";
    badge.textContent = item.badge;
    coverBox.append(badge);
  }

  const title = doc.createElement("div");
  title.className = "ex-libris-book-title";
  title.textContent = item.title;

  const meta = doc.createElement("div");
  meta.className = "ex-libris-book-meta";
  const parts = [item.author, item.year].filter((part): part is string => Boolean(part));
  meta.textContent = parts.join(" · ") || typeLabel(item.type);

  book.append(coverBox, title, meta);

  if (options.showProgress !== false && item.progress !== null) {
    const bar = doc.createElement("div");
    bar.className = "ex-libris-progress";
    const fill = doc.createElement("div");
    fill.className = "ex-libris-progress-fill";
    fill.setCssStyles({ width: `${clamp(item.progress, 0, 100)}%` });
    bar.append(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(item.progress)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    book.append(bar);
  }

  const activate = (): void => options.onOpen?.(item);
  book.addEventListener("click", (event) => {
    event.preventDefault();
    activate();
  });
  book.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  });
  book.addEventListener("contextmenu", (event) => {
    if (!options.onContextMenu) return;
    event.preventDefault();
    options.onContextMenu(item, event);
  });

  return book;
}

function placeholderFor(doc: Document, title: string): HTMLElement {
  const placeholder = doc.createElement("div");
  placeholder.className = "ex-libris-placeholder";
  const hue = hueForTitle(title);
  placeholder.setCssStyles({
    background: `linear-gradient(160deg, hsl(${hue} 30% 46%), hsl(${(hue + 28) % 360} 34% 32%))`,
  });
  const initial = doc.createElement("span");
  initial.className = "ex-libris-placeholder-initial";
  initial.textContent = initialForTitle(title);
  placeholder.append(initial);
  return placeholder;
}

function createLazyObserver(enabled: boolean): IntersectionObserver | null {
  if (!enabled) return null;
  if (typeof IntersectionObserver !== "function") return null;
  let observer: IntersectionObserver;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLImageElement;
        const src = target.dataset.src;
        if (src) {
          target.src = src;
          delete target.dataset.src;
        }
        observer.unobserve(target);
      }
    },
    { rootMargin: "300px" },
  );
  return observer;
}

function typeLabel(type: ShelfItem["type"]): string {
  switch (type) {
    case "movie":
      return "电影";
    case "tv":
      return "剧集";
    case "music":
      return "音乐";
    default:
      return "书";
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
