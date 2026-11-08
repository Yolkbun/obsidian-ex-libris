import type { ShelfItem, ShelfPreset, TypeFilter } from "../domain/types";
import { isFinished, isReading, isWant } from "../library/entries";

/**
 * 预设与筛选片的纯函数。Bases 视图不经过这里（Bases 自己负责查询），
 * ItemView 与测试用它。
 */
export function matchesPreset(item: ShelfItem, preset: ShelfPreset, now = new Date()): boolean {
  switch (preset.kind) {
    case "all":
      return true;
    case "reading":
      return (
        isReading(item.status) ||
        (item.progress !== null && item.progress > 0 && item.progress < 100)
      );
    case "finished-this-year": {
      if (!isFinished(item.status)) return false;
      const timestamp = item.timestamp ?? 0;
      if (timestamp <= 0) return false;
      return new Date(timestamp).getFullYear() === now.getFullYear();
    }
    case "want":
      return isWant(item.status);
    case "custom":
      return matchesCustom(item, preset);
    default:
      return true;
  }
}

function matchesCustom(item: ShelfItem, preset: ShelfPreset): boolean {
  const value = (preset.value ?? "").trim();
  if (!preset.field || !value) return false;
  switch (preset.field) {
    case "status":
      return item.status.toLowerCase() === value.toLowerCase();
    case "type":
      return item.type === value.toLowerCase();
    case "source":
      return item.source === value.toLowerCase();
    case "tag":
      return (item.tags ?? []).some((tag) => tag.toLowerCase() === value.toLowerCase());
    default:
      return false;
  }
}

export function applyTypeFilter(items: ShelfItem[], filter: TypeFilter): ShelfItem[] {
  if (filter === "all") return items;
  return items.filter((item) => item.type === filter);
}

export function filterShelf(
  items: ShelfItem[],
  presetId: string,
  typeFilter: TypeFilter,
  presets: ShelfPreset[],
  now = new Date(),
): ShelfItem[] {
  const preset = presets.find((candidate) => candidate.id === presetId) ?? presets[0];
  const byPreset = preset
    ? items.filter((item) => matchesPreset(item, preset, now))
    : items.slice();
  return applyTypeFilter(byPreset, typeFilter);
}

export function presetCounts(
  items: ShelfItem[],
  presets: ShelfPreset[],
  now = new Date(),
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const preset of presets) {
    counts[preset.id] = items.filter((item) => matchesPreset(item, preset, now)).length;
  }
  return counts;
}

export function typeCounts(items: ShelfItem[]): Record<TypeFilter, number> {
  return {
    all: items.length,
    book: items.filter((item) => item.type === "book").length,
    novel: items.filter((item) => item.type === "novel").length,
    movie: items.filter((item) => item.type === "movie").length,
    tv: items.filter((item) => item.type === "tv").length,
    music: items.filter((item) => item.type === "music").length,
  };
}
