import type { DataAdapter } from "obsidian";
import { ensureDir } from "./paths";

/**
 * 单文件 JSON 存储，原子写（写 `.tmp` 再 rename）。
 *
 * 为什么不用 sqlite：插件不允许引入需要 electron-rebuild 的原生模块。
 * 数据量是"一个人的书架"，没有必要。
 */
export class AtomicJsonStore<T> {
  private data: T | null = null;
  private loaded = false;
  private dirty = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: DataAdapter,
    readonly path: string,
    private readonly defaults: () => T,
  ) {}

  async load(): Promise<T> {
    if (this.loaded) return this.data as T;
    let parsed: T | null = null;
    try {
      if (await this.adapter.exists(this.path)) {
        const raw = await this.adapter.read(this.path);
        parsed = JSON.parse(raw) as T;
      }
    } catch (err) {
      console.warn(`[ex-libris] 读取 ${this.path} 失败，使用默认值`, err);
    }
    this.data = parsed ?? this.defaults();
    this.loaded = true;
    return this.data;
  }

  get(): T {
    if (!this.loaded) {
      this.data = this.defaults();
      this.loaded = true;
    }
    return this.data as T;
  }

  set(value: T): void {
    this.data = value;
    this.loaded = true;
    this.dirty = true;
  }

  /** 修改后调用；不等待落盘也不会丢，卸载时会 flush。 */
  update(mutator: (value: T) => void): void {
    const value = this.get();
    mutator(value);
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const snapshot = JSON.stringify(this.data ?? this.defaults(), null, 2);
    this.chain = this.chain.then(() => this.writeAtomic(snapshot)).catch((err) => {
      console.error(`[ex-libris] 写入 ${this.path} 失败`, err);
      this.dirty = true;
    });
    return this.chain;
  }

  async flush(): Promise<void> {
    await this.save();
    await this.chain;
  }

  private async writeAtomic(content: string): Promise<void> {
    const dir = this.path.slice(0, Math.max(0, this.path.lastIndexOf("/")));
    if (dir) await ensureDir(this.adapter, dir);
    const tmp = `${this.path}.tmp`;
    await this.adapter.write(tmp, content);
    try {
      // Windows 的 rename 会覆盖目标；先直接 rename，失败再退化成删除后重命名。
      await this.adapter.rename(tmp, this.path);
    } catch (renameErr) {
      try {
        if (await this.adapter.exists(this.path)) await this.adapter.remove(this.path);
        await this.adapter.rename(tmp, this.path);
      } catch {
        await this.adapter.write(this.path, content);
        try {
          await this.adapter.remove(tmp);
        } catch {
          /* ignore */
        }
        console.warn(`[ex-libris] ${this.path} 原子重命名失败，已直接写入`, renameErr);
      }
    }
  }
}
