/**
 * 领域层唯一对外契约。
 *
 * 视图层（Bases 视图 / 书架 ItemView / 阅读器）只能吃这里的类型，
 * 不允许直接 fetch 侧车、不允许碰 `app.metadataCache` 的内部结构。
 */

export type EntryType = "book" | "novel" | "movie" | "tv" | "music";
export type EntrySource = "douban" | "fanqie" | "both";

export type CoverRef =
  | { kind: "vault"; value: string }
  | { kind: "remote"; value: string };

/** 书架上的一个条目。同一份数据可以渲染成多种书架。 */
export interface ShelfItem {
  /** vault 内路径，用于打开 */
  path: string;
  title: string;
  type: EntryType;
  source: EntrySource;
  cover: CoverRef | null;
  /** 0–100，null 表示没有可显示的进度 */
  progress: number | null;
  /** 例如 "未读 3" */
  badge: string | null;
  status: string;
  /** 以下为可选附加信息，仅供渲染第二行弱化文字 */
  author?: string;
  year?: string;
  /** 番茄书 id，存在时表示是重条目 */
  bookId?: string;
  /** frontmatter tags，自定义预设可按 tag 过滤 */
  tags?: string[];
  /** 最近活动时间（毫秒），用于排序 */
  timestamp?: number;
}

export interface BookBrief {
  id: string;
  title: string;
  author: string;
  cover_url: string;
  word_count: number | null;
  serial_status: string;
  category?: string;
  intro?: string;
}

export interface BookDetail extends BookBrief {
  book_id?: string;
  last_chapter_title?: string;
  chapter_total?: number;
}

export interface ChapterMeta {
  id: string;
  title: string;
  index: number;
}

export interface Chapter {
  id: string;
  book_id: string;
  title: string;
  index: number;
  paragraphs: string[];
  prev: string | null;
  next: string | null;
}

export interface ChapterComment {
  user: string;
  avatar: string;
  content: string;
  likes: number;
  time: string;
}

export interface CommentPage {
  total: number;
  items: ChapterComment[];
}

export interface ProgressRecord {
  chapterId: string;
  /** 章序号（0 基），用于换算百分比 */
  chapterIndex?: number;
  /** 正文滚动位置（px） */
  offset: number;
  updatedAt: string;
}

export interface ProgressMap {
  [bookId: string]: ProgressRecord;
}

export type ShelfPresetKind =
  | "all"
  | "reading"
  | "finished-this-year"
  | "want"
  | "custom";

export interface ShelfPreset {
  id: string;
  name: string;
  kind: ShelfPresetKind;
  /** 自定义预设使用：字段 + 值 */
  field?: "status" | "type" | "source" | "tag";
  value?: string;
}

export type TypeFilter = EntryType | "all";

export interface ShelfState {
  preset: string;
  filter: TypeFilter;
}
