import type { DataAdapter } from "obsidian";
import type { AtomicJsonStore } from "../util/atomic-json";
import { joinPath } from "../util/paths";

export interface MetaData {
  lastCleanup: number;
  presets?: unknown;
  sidecarLogTail?: string[];
  /** 最近一次启动时间，用于诊断“插件是否真的加载了” */
  lastBootAt?: number;
  lastBootVersion?: string;
  sidecarState?: string;
  sidecarReason?: string | null;
  basesRegistered?: boolean;
}

export interface CleanSummary {
  files: number;
  bytes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 缓存清理。清理绝不动 data/、vault 笔记与封面附件（规格 8.6）。
 */
export class CacheCleaner {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly cacheDir: string,
    private readonly meta: AtomicJsonStore<MetaData>,
    private readonly retentionDays: () => number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** 启动时调用：超过保留期才清。返回是否真的清了。 */
  async maybeCleanupOnStartup(): Promise<boolean> {
    const days = this.retentionDays();
    if (days <= 0) return false;
    const last = Number(this.meta.get().lastCleanup ?? 0);
    const stale = !Number.isFinite(last) || last <= 0 || this.now() - last > days * DAY_MS;
    if (!stale) return false;
    await this.clearChaptersAndCovers();
    this.meta.update((value) => {
      value.lastCleanup = this.now();
    });
    await this.meta.save();
    return true;
  }

  /** 手动清理：章节、封面、目录缓存全部清掉。 */
  async clearAll(): Promise<CleanSummary> {
    const summary = await this.clearChapterCoversAndToc();
    this.meta.update((value) => {
      value.lastCleanup = this.now();
    });
    await this.meta.save();
    return summary;
  }

  /** 7 天自动清理只清章节与封面（规格 8.6）。 */
  async clearChaptersAndCovers(): Promise<CleanSummary> {
    const summary: CleanSummary = { files: 0, bytes: 0 };
    await this.removeTree(joinPath(this.cacheDir, "chapters"), summary);
    await this.removeTree(joinPath(this.cacheDir, "covers"), summary);
    return summary;
  }

  private async clearChapterCoversAndToc(): Promise<CleanSummary> {
    const summary: CleanSummary = { files: 0, bytes: 0 };
    for (const child of ["chapters", "covers", "toc"]) {
      await this.removeTree(joinPath(this.cacheDir, child), summary);
    }
    return summary;
  }

  private async removeTree(path: string, summary: CleanSummary): Promise<void> {
    if (!(await this.adapter.exists(path))) return;
    try {
      const stat = await this.adapter.stat(path);
      if (stat?.type === "file") {
        summary.files++;
        summary.bytes += stat.size;
        await this.adapter.remove(path);
        return;
      }
      const listing = await this.adapter.list(path);
      for (const folder of listing.folders) await this.removeTree(folder, summary);
      for (const file of listing.files) {
        const fileStat = await this.adapter.stat(file);
        summary.files++;
        summary.bytes += fileStat?.size ?? 0;
        await this.adapter.remove(file);
      }
      await this.adapter.rmdir(path, true).catch(() => undefined);
    } catch (err) {
      console.warn(`[ex-libris] 清理 ${path} 失败`, err);
    }
  }

  async size(): Promise<number> {
    return this.sizeOf(this.cacheDir);
  }

  private async sizeOf(path: string): Promise<number> {
    if (!(await this.adapter.exists(path))) return 0;
    let total = 0;
    try {
      const stat = await this.adapter.stat(path);
      if (stat?.type === "file") return stat.size;
      const listing = await this.adapter.list(path);
      for (const file of listing.files) {
        const fileStat = await this.adapter.stat(file);
        total += fileStat?.size ?? 0;
      }
      for (const folder of listing.folders) total += await this.sizeOf(folder);
    } catch {
      return total;
    }
    return total;
  }
}
