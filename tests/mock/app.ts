import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  App,
  DataAdapter,
  MetadataCache,
  normalizePath,
  setActiveApp,
  TFolder,
  Vault,
  Workspace,
  installDomHelpers,
} from "./obsidian";

const SAFE_PATH = /^(?!\.\.(\/|$))[^\0]*$/;

export class NodeAdapter implements DataAdapter {
  constructor(private readonly base: string) {}

  getBasePath(): string {
    return this.base;
  }

  getResourcePath(path: string): string {
    const full = join(this.base, path).replace(/\\/g, "/");
    return `file:///${full.replace(/^\//, "")}`;
  }

  private resolve(path: string): string {
    const normalized = normalizePath(path);
    if (!SAFE_PATH.test(normalized)) throw new Error(`unsafe path: ${path}`);
    return join(this.base, normalized);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<{ type: "file" | "folder"; size: number; ctime: number; mtime: number } | null> {
    try {
      const info = await stat(this.resolve(path));
      return {
        type: info.isDirectory() ? "folder" : "file",
        size: info.size,
        ctime: info.ctimeMs,
        mtime: info.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const dir = this.resolve(path);
    const prefix = normalizePath(path);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      const folders: string[] = [];
      for (const entry of entries) {
        const child = normalizePath(prefix ? `${prefix}/${entry.name}` : entry.name);
        if (entry.isDirectory()) folders.push(child);
        else files.push(child);
      }
      return { files, folders };
    } catch {
      return { files: [], folders: [] };
    }
  }

  async read(path: string): Promise<string> {
    return readFile(this.resolve(path), "utf8");
  }

  async write(path: string, data: string): Promise<void> {
    const target = this.resolve(path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, data, "utf8");
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const target = this.resolve(path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, Buffer.from(data));
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(this.resolve(path), { recursive: true });
  }

  async remove(path: string): Promise<void> {
    await rm(this.resolve(path), { force: true, recursive: false });
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    await rm(this.resolve(path), { force: true, recursive });
  }

  async rename(from: string, to: string): Promise<void> {
    const target = this.resolve(to);
    await mkdir(join(target, ".."), { recursive: true });
    await rename(this.resolve(from), target);
  }

  async process(path: string, fn: (data: string) => string): Promise<string> {
    const current = await this.read(path);
    const next = fn(current);
    if (next !== current) await this.write(path, next);
    return next;
  }
}

export interface TestApp {
  app: App;
  vault: Vault;
  adapter: NodeAdapter;
  root: string;
}

export interface TestAppOptions {
  root: string;
  files?: Record<string, string>;
}

/** 在临时目录上创建一个近似 Obsidian 的 app。 */
export async function createTestApp(options: TestAppOptions): Promise<TestApp> {
  const adapter = new NodeAdapter(options.root);
  await mkdir(options.root, { recursive: true });

  const app = new App();
  const vault = new Vault(adapter);
  const metadataCache = new MetadataCache(vault);
  const workspace = new Workspace(app);

  app.vault = vault;
  app.metadataCache = metadataCache;
  app.workspace = workspace;

  vault.folders.set("", new TFolder(vault, ""));

  for (const [path, content] of Object.entries(options.files ?? {})) {
    const normalized = normalizePath(path);
    await adapter.write(normalized, content);
    const info = await adapter.stat(normalized);
    const { TFile } = await import("./obsidian");
    vault.files.set(
      normalized,
      new TFile(vault, normalized, {
        ctime: info?.ctime ?? Date.now(),
        mtime: info?.mtime ?? Date.now(),
        size: info?.size ?? content.length,
      }),
    );
  }

  installDomHelpers(window);
  setActiveApp(app);

  return { app, vault, adapter, root: options.root };
}

/** 触发 Obsidian 的 layout-ready 阶段。 */
export function openLayout(app: App): void {
  app.workspace.triggerLayoutReady();
}
