import type { DataAdapter } from "obsidian";
import type { ChapterMeta } from "../domain/types";
import { ensureDir, joinPath } from "../util/paths";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

interface TocCacheFile {
  fetchedAt: number;
  items: ChapterMeta[];
}

/**
 * 章节正文与目录缓存。
 * 章节正文只进 cache/，永不进 vault 笔记（规格 8.2 / 10）。
 */
export class SidecarCache {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly cacheDir: string,
  ) {}

  chapterPath(bookId: string, chapterId: string): string | null {
    if (!SAFE_ID.test(bookId) || !SAFE_ID.test(chapterId)) return null;
    return joinPath(this.cacheDir, "chapters", bookId, `${chapterId}.txt`);
  }

  async readChapter(bookId: string, chapterId: string): Promise<string[] | null> {
    const path = this.chapterPath(bookId, chapterId);
    if (!path) return null;
    try {
      if (!(await this.adapter.exists(path))) return null;
      const raw = await this.adapter.read(path);
      const paragraphs = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      return paragraphs.length > 0 ? paragraphs : null;
    } catch {
      return null;
    }
  }

  async writeChapter(bookId: string, chapterId: string, paragraphs: string[]): Promise<void> {
    const path = this.chapterPath(bookId, chapterId);
    if (!path) return;
    try {
      await ensureDir(this.adapter, joinPath(this.cacheDir, "chapters", bookId));
      await this.adapter.write(path, paragraphs.join("\n\n"));
    } catch (err) {
      console.warn("[ex-libris] 写章节缓存失败", err);
    }
  }

  private tocPath(bookId: string): string | null {
    if (!SAFE_ID.test(bookId)) return null;
    return joinPath(this.cacheDir, "toc", `${bookId}.json`);
  }

  async readToc(bookId: string): Promise<TocCacheFile | null> {
    const path = this.tocPath(bookId);
    if (!path) return null;
    try {
      if (!(await this.adapter.exists(path))) return null;
      const parsed = JSON.parse(await this.adapter.read(path)) as TocCacheFile;
      if (!Array.isArray(parsed.items) || typeof parsed.fetchedAt !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async writeToc(bookId: string, items: ChapterMeta[]): Promise<void> {
    const path = this.tocPath(bookId);
    if (!path) return;
    try {
      await ensureDir(this.adapter, joinPath(this.cacheDir, "toc"));
      const payload: TocCacheFile = { fetchedAt: Date.now(), items };
      await this.adapter.write(path, JSON.stringify(payload));
    } catch (err) {
      console.warn("[ex-libris] 写目录缓存失败", err);
    }
  }

  async clear(): Promise<void> {
    await this.adapter.rmdir(this.cacheDir, true).catch(() => undefined);
  }
}
