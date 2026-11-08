import type { DataAdapter } from "obsidian";

/** 把相对路径拼成 vault 内规范路径（不依赖 obsidian.normalizePath，方便单测）。 */
export function joinPath(...parts: Array<string | null | undefined>): string {
  const segments = parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .flatMap((p) => p.split("/"))
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== ".");
  return segments.join("/");
}

/** 逐级创建目录，已存在时忽略。 */
export async function ensureDir(adapter: DataAdapter, dir: string): Promise<void> {
  const parts = dir.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      if (!(await adapter.exists(current))) {
        await adapter.mkdir(current);
      }
    } catch {
      // 并发创建或已存在：忽略
    }
  }
}

const ILLEGAL_FILENAME = /[\\/:*?"<>|#^[\]]/g;

/** 把书名等转成 Windows 与 Obsidian 都安全的文件名。 */
export function sanitizeFilename(name: string, fallback = "未命名"): string {
  const cleaned = name
    .replace(ILLEGAL_FILENAME, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  const truncated = cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
  return truncated.length > 0 ? truncated : fallback;
}

/** vault 内父目录；根目录返回空串。 */
export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "";
}

export function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 去掉 `.md` 后缀。 */
export function stripMd(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}
