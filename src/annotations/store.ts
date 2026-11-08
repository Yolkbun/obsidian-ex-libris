import type { DataAdapter } from "obsidian";
import { AtomicJsonStore } from "../util/atomic-json";

export type AnnotationKind = "highlight" | "color";
export type AnnotationColor = "yellow" | "red" | "blue" | "green";

export interface AnnotationRecord {
  id: string;
  text: string;
  /** 选中文字所在的整段，导出笔记时一起带上 */
  paragraph: string;
  paragraphIndex: number;
  kind: AnnotationKind;
  color: AnnotationColor;
  createdAt: string;
}

type AnnotationMap = Record<string, Record<string, AnnotationRecord[]>>;

/**
 * 批注记录只保存“确实发生编辑”的那部分；普通阅读/复制不写任何本地文件。
 * 笔记是给人看的，JSON 只是为了让重开章节还能恢复高亮。
 */
export class AnnotationStore {
  private readonly store: AtomicJsonStore<AnnotationMap>;
  private serialize: Promise<void> = Promise.resolve();

  constructor(
    adapter: DataAdapter,
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = new AtomicJsonStore<AnnotationMap>(adapter, path, () => ({}));
  }

  async init(): Promise<void> {
    await this.store.load();
  }

  list(bookId: string, chapterId: string): AnnotationRecord[] {
    return [...(this.store.get()[bookId]?.[chapterId] ?? [])];
  }

  async add(
    bookId: string,
    chapterId: string,
    record: Omit<AnnotationRecord, "id" | "createdAt">,
  ): Promise<AnnotationRecord> {
    const created: AnnotationRecord = {
      ...record,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: this.now().toISOString(),
    };
    this.store.update((map) => {
      const book = (map[bookId] ??= {});
      (book[chapterId] ??= []).push(created);
    });
    this.serialize = this.serialize.then(() => this.store.save());
    await this.serialize;
    return created;
  }

  async flush(): Promise<void> {
    this.serialize = this.serialize.then(() => this.store.flush());
    await this.serialize;
  }
}
