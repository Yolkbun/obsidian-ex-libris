import type { ProcessHandle, SidecarHost } from "./host";

export type SidecarState = "stopped" | "starting" | "ready" | "degraded" | "stopping";

export type DegradedReason =
  | "disabled"
  | "missing-binary"
  | "spawn-failed"
  | "timeout"
  | "exited"
  | "crashed";

export interface SidecarDescriptor {
  state: SidecarState;
  text: string;
  port: number | null;
  pid: number | null;
  degradedReason: DegradedReason | null;
  stderrTail: string[];
  deviceReady: boolean;
}

export interface SidecarManagerOptions {
  binaryPath: () => string;
  dataDir: () => string;
  enabled: () => boolean;
  host: SidecarHost;
  pluginVersion: string;
  /** 额外命令行参数，仅测试/开发使用 */
  extraArgs?: string[];
  /** 在标准参数之前插入的参数（测试里用 node 跑开发侧车） */
  argsPrefix?: string[];
  /** 就绪轮询间隔，默认 200ms */
  pollIntervalMs?: number;
  /** 就绪超时，默认 15s */
  readyTimeoutMs?: number;
  /** 关闭时等待退出时间，默认 1.5s */
  shutdownGraceMs?: number;
  /** 注入随机 token 生成器，测试用 */
  tokenFactory?: () => string;
}

export class SidecarManager {
  private state: SidecarState = "stopped";
  private handle: ProcessHandle | null = null;
  private startPromise: Promise<boolean> | null = null;
  private stopPromise: Promise<void> | null = null;
  private degradedReason: DegradedReason | null = null;
  private stderrTail: string[] = [];
  private port: number | null = null;
  private token = "";
  private deviceReady = false;
  private readonly listeners = new Set<(descriptor: SidecarDescriptor) => void>();

  constructor(private readonly options: SidecarManagerOptions) {}

  get currentToken(): string {
    return this.token;
  }

  get baseUrl(): string | null {
    return this.port === null ? null : `http://127.0.0.1:${this.port}`;
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  describe(): SidecarDescriptor {
    return {
      state: this.state,
      text: this.describeText(),
      port: this.port,
      pid: this.handle?.pid ?? null,
      degradedReason: this.degradedReason,
      stderrTail: [...this.stderrTail],
      deviceReady: this.deviceReady,
    };
  }

  onChange(listener: (descriptor: SidecarDescriptor) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<boolean> {
    if (this.startPromise) return this.startPromise;
    if (this.state === "ready") return true;
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<boolean> {
    if (!this.options.enabled()) {
      this.fail("disabled", "番茄侧车已关闭");
      return false;
    }
    const binary = this.options.binaryPath();
    if (!(await this.options.host.exists(binary))) {
      this.fail("missing-binary", `未找到侧车：${binary}。运行 scripts/build-sidecar.ps1 后重试。`);
      return false;
    }

    this.setState("starting");
    this.degradedReason = null;
    this.stderrTail = [];

    let port: number;
    try {
      port = await this.options.host.allocatePort();
    } catch (err) {
      this.fail("spawn-failed", `无法分配本机端口：${String(err)}`);
      return false;
    }
    this.port = port;
    this.token = this.options.tokenFactory ? this.options.tokenFactory() : randomToken();

    let handle: ProcessHandle;
    try {
      handle = await this.options.host.spawn({
        command: binary,
        args: [
          ...(this.options.argsPrefix ?? []),
          "--port",
          String(port),
          "--data-dir",
          this.options.dataDir(),
          "--parent-pid",
          String(process.pid),
          ...(this.options.extraArgs ?? []),
        ],
        env: { FQ_TOKEN: this.token },
      });
    } catch (err) {
      this.port = null;
      this.fail("spawn-failed", `侧车启动失败：${String(err)}`);
      return false;
    }

    this.handle = handle;
    handle.onStderr((line) => {
      this.stderrTail.push(this.redact(line));
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });
    handle.onExit((code) => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this.handle = null;
      this.port = null;
      this.fail("exited", `侧车已退出（code=${code ?? "null"}），番茄入口暂不可用。`);
    });

    const ready = await this.waitForHealth(port);
    if (!ready) {
      await this.terminate();
      this.fail(
        "timeout",
        `侧车在 ${(this.options.readyTimeoutMs ?? 15_000) / 1000}s 内未就绪，书架照常可用，番茄入口已置灰。`,
      );
      return false;
    }

    this.deviceReady = true;
    this.setState("ready");
    return true;
  }

  private async waitForHealth(port: number): Promise<boolean> {
    const interval = this.options.pollIntervalMs ?? 200;
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      if (this.state !== "starting") return false;
      try {
        const response = await this.options.host.transport({
          url: `http://127.0.0.1:${port}/health`,
          headers: { "X-FQ-Token": this.token },
          timeoutMs: 2_000,
        });
        if (response.status === 200) {
          try {
            const body = response.json<{ device_ready?: boolean; version?: string }>();
            this.deviceReady = body.device_ready !== false;
          } catch {
            this.deviceReady = true;
          }
          return true;
        }
      } catch {
        // 还没起来
      }
      await sleep(interval);
    }
    return false;
  }

  async ensureReady(): Promise<boolean> {
    if (this.state === "starting" && this.startPromise) return this.startPromise;
    if (this.state === "ready") {
      const alive = await this.ping();
      if (alive) return true;
      await this.terminate();
      this.handle = null;
      this.port = null;
      this.setState("stopped");
    }
    return this.start();
  }

  private async ping(): Promise<boolean> {
    if (this.port === null) return false;
    try {
      const response = await this.options.host.transport({
        url: `http://127.0.0.1:${this.port}/health`,
        headers: { "X-FQ-Token": this.token },
        timeoutMs: 1_500,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async requestHealth(): Promise<{ ok: boolean; device_ready: boolean } | null> {
    if (this.port === null) return null;
    try {
      const response = await this.options.host.transport({
        url: `http://127.0.0.1:${this.port}/health`,
        headers: { "X-FQ-Token": this.token },
        timeoutMs: 2_000,
      });
      if (response.status !== 200) return null;
      const body = response.json<{ ok: boolean; device_ready: boolean }>();
      return { ok: body.ok === true, device_ready: body.device_ready !== false };
    } catch {
      return null;
    }
  }

  async restart(): Promise<boolean> {
    await this.stop();
    return this.start();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.doStop().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    if (this.state === "starting" && this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        /* ignore */
      }
    }
    if (!this.handle) {
      this.port = null;
      this.token = "";
      this.setState("stopped");
      return;
    }
    this.setState("stopping");
    const handle = this.handle;
    const port = this.port;
    const token = this.token;

    if (port !== null) {
      try {
        await this.options.host.transport({
          url: `http://127.0.0.1:${port}/shutdown`,
          method: "POST",
          headers: { "X-FQ-Token": token },
          timeoutMs: 1_000,
        });
      } catch {
        // 侧车可能已经没了
      }
    }

    const exited = await this.waitForExit(handle, this.options.shutdownGraceMs ?? 1_500);
    if (!exited) {
      handle.closeStdin();
      const exitedAfterEof = await this.waitForExit(handle, 500);
      if (!exitedAfterEof && handle.pid !== null) {
        await this.options.host.forceKill(handle.pid);
        await this.waitForExit(handle, 500);
      }
    }

    this.handle = null;
    this.port = null;
    this.token = "";
    this.deviceReady = false;
    this.setState("stopped");
  }

  private waitForExit(handle: ProcessHandle, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      handle.onExit(() => done(true));
    });
  }

  /** 侧车自己崩了以后，把句柄清掉，不阻塞下一次启动。 */
  private async terminate(): Promise<void> {
    const handle = this.handle;
    if (!handle) return;
    handle.closeStdin();
    if (handle.pid !== null) await this.options.host.forceKill(handle.pid);
    this.handle = null;
  }

  private fail(reason: DegradedReason, text: string): void {
    this.degradedReason = reason;
    this.state = "degraded";
    this.lastError = text;
    this.emit();
  }

  private lastError = "";

  private setState(state: SidecarState): void {
    this.state = state;
    this.emit();
  }

  private describeText(): string {
    switch (this.state) {
      case "ready":
        return `侧车就绪 · 127.0.0.1:${this.port ?? "?"}${this.deviceReady ? "" : " · 设备未注册"}`;
      case "starting":
        return "侧车启动中…";
      case "stopping":
        return "侧车关闭中…";
      case "stopped":
        return "侧车未运行";
      case "degraded":
        return this.lastError || "侧车不可用";
    }
  }

  private emit(): void {
    const descriptor = this.describe();
    for (const listener of this.listeners) {
      try {
        listener(descriptor);
      } catch (err) {
        console.error("[ex-libris] sidecar 监听器出错", err);
      }
    }
  }

  private redact(line: string): string {
    return this.token ? line.split(this.token).join("***") : line;
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
