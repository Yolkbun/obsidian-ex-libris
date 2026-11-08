import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { access } from "node:fs/promises";
import * as net from "net";
import { requestUrl } from "obsidian";

export interface SpawnRequest {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface ProcessHandle {
  readonly pid: number | null;
  onStdout(listener: (line: string) => void): void;
  onStderr(listener: (line: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  closeStdin(): void;
  terminate(): void;
}

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  text: string;
  json<T>(): T;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * 进程与网络操作的平台边界。
 * Windows 实现在本文件；将来加 macOS 只需要再写一个 host，manager 与 client 不动。
 */
export interface SidecarHost {
  readonly platform: string;
  allocatePort(): Promise<number>;
  exists(absolutePath: string): Promise<boolean>;
  spawn(request: SpawnRequest): Promise<ProcessHandle>;
  forceKill(pid: number): Promise<void>;
  transport: HttpTransport;
}

export function requestUrlTransport(): HttpTransport {
  return async (request) => {
    const timeout = request.timeoutMs ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const overtime = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${timeout}ms`)), timeout);
    });
    try {
      const response = await Promise.race([
        requestUrl({
          url: request.url,
          method: request.method ?? "GET",
          headers: request.headers,
          body: request.body,
          throw: false,
        }),
        overtime,
      ]);
      return {
        status: response.status,
        text: response.text,
        json: <T>() => response.json as T,
      };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };
}

const isWindows = process.platform === "win32";

export class DesktopSidecarHost implements SidecarHost {
  readonly platform = process.platform;
  readonly transport: HttpTransport = requestUrlTransport();

  async allocatePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          server.close();
          reject(new Error("无法分配端口"));
          return;
        }
        const port = address.port;
        server.close(() => resolve(port));
      });
    });
  }

  async exists(absolutePath: string): Promise<boolean> {
    try {
      await access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async spawn(request: SpawnRequest): Promise<ProcessHandle> {
    const child: ChildProcess = spawn(request.command, request.args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...request.env },
      cwd: request.cwd,
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        child.off("spawn", onSpawned);
        reject(err);
      };
      const onSpawned = (): void => {
        child.off("error", onError);
        resolve();
      };
      child.once("error", onError);
      child.once("spawn", onSpawned);
    });

    const stdoutListeners: Array<(line: string) => void> = [];
    const stderrListeners: Array<(line: string) => void> = [];
    const exitListeners: Array<(code: number | null) => void> = [];
    let bufferOut = "";
    let bufferErr = "";

    const split = (
      chunk: string,
      buffer: string,
      listeners: Array<(line: string) => void>,
    ): string => {
      const combined = buffer + chunk;
      const lines = combined.split(/\r?\n/);
      const rest = lines.pop() ?? "";
      for (const line of lines) {
        for (const listener of listeners) listener(line);
      }
      return rest;
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      bufferOut = split(chunk, bufferOut, stdoutListeners);
    });
    child.stderr?.on("data", (chunk: string) => {
      bufferErr = split(chunk, bufferErr, stderrListeners);
    });
    child.on("exit", (code) => {
      for (const listener of exitListeners) listener(code);
    });

    return {
      pid: child.pid ?? null,
      onStdout: (listener) => stdoutListeners.push(listener),
      onStderr: (listener) => stderrListeners.push(listener),
      onExit: (listener) => exitListeners.push(listener),
      closeStdin: () => {
        try {
          child.stdin?.end();
        } catch {
          /* ignore */
        }
      },
      terminate: () => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      },
    };
  }

  async forceKill(pid: number): Promise<void> {
    if (!isWindows) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
      return;
    }
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  }
}

export function createSidecarHost(): SidecarHost {
  return new DesktopSidecarHost();
}
