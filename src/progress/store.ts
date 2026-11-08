import type { DataAdapter } from "obsidian";
import type { ProgressMap, ProgressRecord } from "../domain/types";
import { AtomicJsonStore } from "../util/atomic-json";

const SAVE_THROTTLE_MS = 5_000;

/**
 * 阅读位置只进 progress.json，绝不因滚动写 frontmatter（规格 8.5）。
 * 滚动时节流 5s 落盘；换章、退出、卸载时 flush。
 */
export class ProgressStore {
  private readonly store: AtomicJsonStore<ProgressMap>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private serialize: Promise<void> = Promise.resolve();

  constructor(
    adapter: DataAdapter,
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = new AtomicJsonStore<ProgressMap>(adapter, path, () => ({}));
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  get(bookId: string): ProgressRecord | undefined {
    const record = this.store.get()[bookId];
    return record ? { ...record } : undefined;
  }

  set(bookId: string, chapterId: string, chapterIndex: number | undefined, offset: number): void {
    this.store.update((map) => {
      const record: ProgressRecord = {
        chapterId,
        offset: Math.max(0, Math.round(offset)),
        updatedAt: this.now().toISOString(),
      };
      if (chapterIndex !== undefined) record.chapterIndex = chapterIndex;
      map[bookId] = record;
    });
    this.scheduleSave();
  }

  /** 只更新时间戳，不改变位置（例如打开书但还没滚动）。 */
  touch(bookId: string): void {
    this.store.update((map) => {
      const record = map[bookId];
      if (record) record.updatedAt = this.now().toISOString();
    });
  }

  private scheduleSave(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, SAVE_THROTTLE_MS);
  }

  async save(): Promise<void> {
    this.serialize = this.serialize.then(() => this.store.save());
    await this.serialize;
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.serialize = this.serialize.then(() => this.store.flush());
    await this.serialize;
  }
}
