import type { ChapterComment, CommentPage } from "../domain/types";

export type CommentLoader = (
  bookId: string,
  chapterId: string,
  page: number,
) => Promise<CommentPage>;

/**
 * 书评是只读的上游评论（不是"我的批注"），分页懒加载。
 * 拉取失败只显示"书评暂不可用"，不影响正文。
 */
export class CommentsPanel {
  readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private items: ChapterComment[] = [];
  private page = 0;
  private total = 0;
  private loading = false;
  private done = false;
  private token = 0;
  private bookId = "";
  private chapterId = "";
  private readonly onScroll: () => void;

  constructor(
    private readonly doc: Document,
    private readonly load: CommentLoader,
  ) {
    this.el = doc.createElement("aside");
    this.el.className = "ex-libris-comments is-hidden";

    const header = doc.createElement("div");
    header.className = "ex-libris-comments-header";
    this.titleEl = doc.createElement("span");
    this.titleEl.textContent = "书评 0 条";

    const close = doc.createElement("button");
    close.className = "ex-libris-icon-button";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭章评");
    close.addEventListener("click", () => this.hide());
    header.append(this.titleEl, close);

    this.listEl = doc.createElement("div");
    this.listEl.className = "ex-libris-comments-list";
    this.statusEl = doc.createElement("div");
    this.statusEl.className = "ex-libris-comments-status";

    this.el.append(header, this.statusEl, this.listEl);

    this.onScroll = () => {
      if (this.loading || this.done) return;
      const remaining = this.listEl.scrollHeight - this.listEl.scrollTop - this.listEl.clientHeight;
      if (remaining < 320) void this.loadNext();
    };
    this.listEl.addEventListener("scroll", this.onScroll);
  }

  get isVisible(): boolean {
    return !this.el.classList.contains("is-hidden");
  }

  async show(bookId: string, chapterId: string): Promise<void> {
    this.el.classList.remove("is-hidden");
    if (this.bookId !== bookId || this.chapterId !== chapterId) {
      await this.setChapter(bookId, chapterId);
    }
  }

  hide(): void {
    this.el.classList.add("is-hidden");
  }

  async setChapter(bookId: string, chapterId: string): Promise<void> {
    this.bookId = bookId;
    this.chapterId = chapterId;
    this.items = [];
    this.page = 0;
    this.total = 0;
    this.done = false;
    this.loading = false;
    this.token++;
    this.listEl.replaceChildren();
    this.titleEl.textContent = "书评 …";
    this.statusEl.textContent = "正在读取书评…";
    await this.loadNext();
  }

  private async loadNext(): Promise<void> {
    if (this.loading || this.done) return;
    this.loading = true;
    const token = this.token;
    const nextPage = this.page + 1;
    try {
      const result = await this.load(this.bookId, this.chapterId, nextPage);
      if (token !== this.token) return;
      this.total = result.total;
      this.page = nextPage;
      this.items.push(...result.items);
      this.titleEl.textContent = `书评 ${this.total} 条`;
      this.statusEl.textContent = this.items.length === 0 ? "本书还没有书评" : "";
      this.appendItems(result.items);
      if (this.items.length >= this.total || result.items.length === 0) {
        this.done = true;
        if (this.total > 0) {
          const end = this.doc.createElement("div");
          end.className = "ex-libris-comments-status";
          end.textContent = "—— 到底了 ——";
          this.listEl.append(end);
        }
      }
    } catch (err) {
      if (token !== this.token) return;
      this.statusEl.textContent = "书评暂不可用";
      this.done = true;
      console.warn("[ex-libris] 章评加载失败", err);
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  private appendItems(items: ChapterComment[]): void {
    for (const comment of items) {
      const row = this.doc.createElement("div");
      row.className = "ex-libris-comment";

      const avatar = this.doc.createElement("div");
      avatar.className = "ex-libris-comment-avatar";
      if (comment.avatar) {
        const img = this.doc.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        img.src = comment.avatar;
        img.addEventListener("error", () => img.remove());
        avatar.append(img);
      }

      const body = this.doc.createElement("div");
      body.className = "ex-libris-comment-body";
      const user = this.doc.createElement("div");
      user.className = "ex-libris-comment-user";
      user.textContent = comment.user || "匿名读者";
      const content = this.doc.createElement("div");
      content.className = "ex-libris-comment-content";
      content.textContent = comment.content;
      const meta = this.doc.createElement("div");
      meta.className = "ex-libris-comment-meta";
      meta.textContent = [comment.time, comment.likes > 0 ? `${comment.likes} 赞` : ""]
        .filter(Boolean)
        .join(" · ");

      body.append(user, content, meta);
      row.append(avatar, body);
      this.listEl.append(row);
    }
  }

  destroy(): void {
    this.listEl.removeEventListener("scroll", this.onScroll);
    this.el.remove();
  }
}
