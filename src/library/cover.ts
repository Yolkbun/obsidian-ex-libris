import { App, requestUrl, TFile } from "obsidian";
import type { CoverRef } from "../domain/types";
import { ensureDir, joinPath, parentDir } from "../util/paths";
import { sha1Hex } from "../util/hash";

interface CoverIndex {
  [url: string]: string;
}

const COVER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

/** 豆瓣图床会校验 Referer；缺了会返回 418，而不是 403。 */
export function coverHeaders(url: string): Record<string, string> | undefined {
  try {
    const host = new URL(url).hostname;
    if (host === "douban.com" || host.endsWith(".douban.com") || host.endsWith(".doubanio.com")) {
      return {
        "User-Agent": COVER_UA,
        Referer: "https://book.douban.com/",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      };
    }
  } catch {
    // 非法 URL 交给 requestUrl 报错
  }
  return undefined;
}

/**
 * 封面解析优先级（规格 7.3）：
 *   1. frontmatter cover 是 vault 内路径且文件存在 → 资源路径
 *   2. 远程 URL（imageData / fq_cover_url）→ 若已缓存则用缓存，否则远程
 *   3. 都没有 → null（渲染层画占位块）
 * 远程加载失败不回退，避免风暴；占位块由渲染层负责。
 */
export class CoverResolver {
  private index: CoverIndex = {};
  private existing = new Set<string>();

  constructor(
    private readonly app: App,
    private readonly cacheDir: string,
    private readonly indexStorePath: string,
  ) {}

  async init(): Promise<void> {
    this.existing.clear();
    try {
      if (await this.app.vault.adapter.exists(this.indexStorePath)) {
        const raw = await this.app.vault.adapter.read(this.indexStorePath);
        const parsed = JSON.parse(raw) as CoverIndex;
        this.index = parsed && typeof parsed === "object" ? parsed : {};
      }
    } catch (err) {
      console.warn("[ex-libris] 封面索引损坏，已重建", err);
      this.index = {};
    }
    for (const filename of Object.values(this.index)) {
      const path = joinPath(this.cacheDir, filename);
      if (await this.app.vault.adapter.exists(path)) this.existing.add(path);
    }
  }

  resolve(fm: Record<string, unknown>, notePath: string): CoverRef | null {
    const local = this.resolveLocalCover(fm.cover, notePath);
    if (local) return { kind: "vault", value: local };

    const url = this.remoteUrlOf(fm);
    if (!url) return null;
    const cached = this.index[url];
    if (cached) {
      const path = joinPath(this.cacheDir, cached);
      if (this.existing.has(path)) return { kind: "vault", value: path };
    }
    return { kind: "remote", value: url };
  }

  private resolveLocalCover(raw: unknown, notePath: string): string | null {
    if (typeof raw !== "string") return null;
    const cleaned = raw.trim().replace(/^\.\//, "").replace(/^\/+/, "");
    if (!cleaned) return null;
    const candidates = [cleaned, joinPath(parentDir(notePath), cleaned)];
    for (const candidate of candidates) {
      if (this.isVaultFile(candidate)) return candidate;
    }
    return null;
  }

  private isVaultFile(path: string): boolean {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile;
  }

  private remoteUrlOf(fm: Record<string, unknown>): string | null {
    const fqCover = fm.fq_cover_url;
    if (typeof fqCover === "string" && /^https?:\/\//.test(fqCover)) return fqCover;

    let imageData: unknown = fm.imageData;
    if (typeof imageData === "string") {
      const raw = imageData;
      if (/^https?:\/\//.test(raw)) return raw;
      try {
        imageData = JSON.parse(raw);
      } catch {
        imageData = null;
      }
    }
    if (imageData && typeof imageData === "object") {
      const record = imageData as Record<string, unknown>;
      for (const key of ["large", "medium", "url", "small"]) {
        const value = record[key];
        if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
      }
    }
    const image = fm.image;
    if (typeof image === "string" && /^https?:\/\//.test(image)) return image;
    return null;
  }

  /** 下载到插件缓存，返回 vault 内路径；失败返回 null。 */
  async localize(url: string): Promise<string | null> {
    const cached = this.index[url];
    if (cached) {
      const path = joinPath(this.cacheDir, cached);
      if (this.existing.has(path)) return path;
    }
    try {
      const response = await requestUrl({ url, method: "GET", headers: coverHeaders(url) });
      if (response.status < 200 || response.status >= 300) return null;
      const filename = await this.filenameFor(url, response.headers?.["content-type"] ?? "");
      const path = joinPath(this.cacheDir, filename);
      await ensureDir(this.app.vault.adapter, this.cacheDir);
      await this.app.vault.adapter.writeBinary(path, response.arrayBuffer);
      this.index[url] = filename;
      this.existing.add(path);
      await this.saveIndex();
      return path;
    } catch (err) {
      console.warn(`[ex-libris] 封面下载失败：${url}`, err);
      return null;
    }
  }

  private async filenameFor(url: string, contentType: string): Promise<string> {
    const hash = await sha1Hex(url);
    const extension = contentType.includes("png")
      ? ".png"
      : contentType.includes("webp")
        ? ".webp"
        : /\.png(\?|$)/i.test(url)
          ? ".png"
          : ".jpg";
    return `${hash}${extension}`;
  }

  /** 把远程封面下载进 vault（用于番茄轻笔记的 cover 字段）。 */
  async downloadTo(url: string, targetPath: string): Promise<boolean> {
    try {
      const response = await requestUrl({ url, method: "GET", headers: coverHeaders(url) });
      if (response.status < 200 || response.status >= 300) return false;
      await ensureDir(this.app.vault.adapter, parentDir(targetPath));
      await this.app.vault.adapter.writeBinary(targetPath, response.arrayBuffer);
      return true;
    } catch (err) {
      console.warn(`[ex-libris] 封面写入失败：${targetPath}`, err);
      return false;
    }
  }

  /** 批量本地化，最多 2 个并发，避免对上游发起风暴。 */
  async localizeMany(urls: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
    const unique = [...new Set(urls)];
    let done = 0;
    let failures = 0;
    const queue = [...unique];
    const worker = async (): Promise<void> => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        const path = await this.localize(url);
        if (!path) failures++;
        done++;
        onProgress?.(done, unique.length);
      }
    };
    await Promise.all([worker(), worker()]);
    return failures;
  }

  resourcePath(vaultPath: string): string {
    return this.app.vault.adapter.getResourcePath(vaultPath);
  }

  private async saveIndex(): Promise<void> {
    try {
      await ensureDir(this.app.vault.adapter, parentDir(this.indexStorePath));
      await this.app.vault.adapter.write(this.indexStorePath, JSON.stringify(this.index, null, 2));
    } catch (err) {
      console.warn("[ex-libris] 写入封面索引失败", err);
    }
  }
}
