import type { BookBrief, BookDetail, Chapter, ChapterMeta, CommentPage } from "../domain/types";
import type { HttpTransport } from "./host";
import type { SidecarCache } from "./cache";
import type { SidecarManager } from "./manager";

export type SidecarErrorCode =
  | "NOT_FOUND"
  | "UPSTREAM_TIMEOUT"
  | "DECRYPT_FAILED"
  | "RATE_LIMITED"
  | "DEVICE_EXPIRED"
  | "UNAUTHORIZED"
  | "NETWORK"
  | "SIDECAR_UNAVAILABLE"
  | "BAD_RESPONSE";

export class SidecarError extends Error {
  constructor(
    readonly code: SidecarErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SidecarError";
  }
}

interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

const RETRY_DELAYS = [1_000, 2_000, 4_000];
const RETRYABLE: ReadonlySet<SidecarErrorCode> = new Set([
  "NETWORK",
  "UPSTREAM_TIMEOUT",
  "RATE_LIMITED",
]);

/** 同时对上游的请求不超过 3 个（规格 6.4、11.10）。 */
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export class SidecarClient {
  private readonly semaphore = new Semaphore(3);

  constructor(
    private readonly manager: SidecarManager,
    private readonly transport: HttpTransport,
    private readonly cache: SidecarCache,
    private readonly tocRefreshMinutes: () => number,
  ) {}

  async ping(): Promise<boolean> {
    return (await this.manager.requestHealth())?.ok === true;
  }

  async search(query: string, page = 1, limit = 20): Promise<{ total: number; items: BookBrief[] }> {
    const params = new URLSearchParams({ q: query, page: String(page), limit: String(limit) });
    return this.withRetry(() => this.call(`/search?${params.toString()}`));
  }

  async resolve(url: string): Promise<{ bookId: string }> {
    return this.withRetry(() => this.call("/resolve", { method: "POST", body: { url } }));
  }

  async book(bookId: string): Promise<BookDetail> {
    return this.withRetry(() => this.call(`/book/${encodeURIComponent(bookId)}`));
  }

  async chapters(bookId: string, force = false): Promise<{ total: number; items: ChapterMeta[] }> {
    const cached = await this.cache.readToc(bookId);
    const freshMs = this.tocRefreshMinutes() * 60_000;
    if (!force && cached && Date.now() - cached.fetchedAt < freshMs) {
      return { total: cached.items.length, items: cached.items };
    }
    const result = await this.withRetry(() =>
      this.call<{ total: number; items: ChapterMeta[] }>(`/book/${encodeURIComponent(bookId)}/chapters`),
    );
    if (Array.isArray(result.items) && result.items.length > 0) {
      await this.cache.writeToc(bookId, result.items);
    }
    return result;
  }

  async chapter(bookId: string, chapterId: string): Promise<Chapter> {
    const cached = await this.cache.readChapter(bookId, chapterId);
    if (cached) {
      return {
        id: chapterId,
        book_id: bookId,
        title: "",
        index: -1,
        paragraphs: cached,
        prev: null,
        next: null,
      };
    }
    const chapter = await this.withRetry(() =>
      this.call<Chapter>(`/chapter/${encodeURIComponent(chapterId)}`),
    );
    if (Array.isArray(chapter.paragraphs) && chapter.paragraphs.length > 0) {
      await this.cache.writeChapter(bookId, chapterId, chapter.paragraphs);
    }
    return chapter;
  }

  async comments(bookId: string, chapterId: string, page = 1): Promise<CommentPage> {
    const params = new URLSearchParams({ chapterId, page: String(page) });
    return this.withRetry(() =>
      this.call(`/book/${encodeURIComponent(bookId)}/comments?${params.toString()}`),
    );
  }

  async shutdown(): Promise<void> {
    const base = this.manager.baseUrl;
    if (!base) return;
    try {
      await this.transport({
        url: `${base}/shutdown`,
        method: "POST",
        headers: { "X-FQ-Token": this.manager.currentToken },
        timeoutMs: 1_000,
      });
    } catch {
      /* ignore */
    }
  }

  private async withRetry<T>(task: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let deviceRetried = false;
    for (;;) {
      try {
        return await this.semaphore.run(task);
      } catch (err) {
        if (!(err instanceof SidecarError)) throw err;
        if (err.code === "DEVICE_EXPIRED" && !deviceRetried) {
          deviceRetried = true;
          await this.manager.restart();
          continue;
        }
        const retryable = RETRYABLE.has(err.code) || (err.status ?? 0) >= 500;
        if (!retryable || attempt >= RETRY_DELAYS.length) throw err;
        await sleep(RETRY_DELAYS[attempt]!);
        attempt++;
      }
    }
  }

  private async call<T>(path: string, options: CallOptions = {}): Promise<T> {
    const ready = await this.manager.ensureReady();
    if (!ready) {
      throw new SidecarError(
        "SIDECAR_UNAVAILABLE",
        "番茄侧车未运行。书架与豆瓣部分不受影响。",
      );
    }
    const base = this.manager.baseUrl;
    if (!base) throw new SidecarError("SIDECAR_UNAVAILABLE", "侧车地址不可用");

    let response;
    try {
      response = await this.transport({
        url: `${base}${path}`,
        method: options.method ?? "GET",
        headers: {
          "X-FQ-Token": this.manager.currentToken,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        timeoutMs: options.timeoutMs ?? 30_000,
      });
    } catch (err) {
      throw new SidecarError("NETWORK", `无法连接侧车：${String(err)}`);
    }

    if (response.status === 401) {
      throw new SidecarError("UNAUTHORIZED", "侧车鉴权失败，请重启侧车。", 401);
    }

    let payload: unknown;
    try {
      payload = response.json<unknown>();
    } catch {
      if (response.status >= 200 && response.status < 300) {
        throw new SidecarError("BAD_RESPONSE", "侧车返回了无法解析的响应。", response.status);
      }
    }

    if (response.status >= 400) {
      const envelope = payload as { error?: { code?: string; message?: string } } | undefined;
      const code = (envelope?.error?.code ?? "BAD_RESPONSE") as SidecarErrorCode;
      throw new SidecarError(
        normalizeCode(code),
        envelope?.error?.message ?? `侧车请求失败（HTTP ${response.status}）`,
        response.status,
      );
    }

    return payload as T;
  }
}

function normalizeCode(code: string): SidecarErrorCode {
  const known: SidecarErrorCode[] = [
    "NOT_FOUND",
    "UPSTREAM_TIMEOUT",
    "DECRYPT_FAILED",
    "RATE_LIMITED",
    "DEVICE_EXPIRED",
    "UNAUTHORIZED",
    "NETWORK",
    "SIDECAR_UNAVAILABLE",
    "BAD_RESPONSE",
  ];
  return (known as string[]).includes(code) ? (code as SidecarErrorCode) : "BAD_RESPONSE";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
