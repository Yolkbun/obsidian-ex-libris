import type { ShelfItem, ShelfPreset } from "../domain/types";
import type { ExLibrisSettings } from "../settings";
import type { CoverResolver } from "../library/cover";
import type { EntryIndex } from "../library/entries";

/** 视图层的依赖注入面。视图不认识 app，也不直接 fetch 侧车。 */
export interface ShelfUiDeps {
  entries: EntryIndex;
  covers: CoverResolver;
  settings: () => ExLibrisSettings;
  presets: () => ShelfPreset[];
  addPreset: () => Promise<void>;
  removePreset: (id: string) => Promise<void>;
  isSidecarReady: () => boolean;
  sidecarText: () => string;
  openItem: (item: ShelfItem) => void;
  openReader: (bookId: string, chapterId?: string) => Promise<void>;
  openNote: (item: ShelfItem) => void;
  linkDouban: (item: ShelfItem) => Promise<void>;
  restartSidecar: () => Promise<void>;
  refreshUnread?: () => Promise<void>;
}
