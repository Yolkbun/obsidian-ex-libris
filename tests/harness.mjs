/**
 * 无头测试入口：jsdom + 用 esbuild 把插件与 obsidian mock 打成一个 CJS bundle。
 * 这样插件源码里的 `import ... from "obsidian"` 会解析到 tests/mock/obsidian.ts。
 */
import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "app://obsidian.md/",
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
globalThis.HTMLImageElement = dom.window.HTMLImageElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
globalThis.DocumentFragment = dom.window.DocumentFragment;
globalThis.Event = dom.window.Event;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;

// 每个测试进程独立 bundle，避免并行测试同时写同一个文件（esbuild 写入不是原子的）。
const bundlePath = path.join(tmpdir(), `ex-libris-bundle-${process.pid}.cjs`);
await esbuild.build({
  entryPoints: [path.join(ROOT, "tests", "entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: bundlePath,
  alias: { obsidian: path.join(ROOT, "tests", "mock", "obsidian.ts") },
  external: ["jsdom"],
  logLevel: "warning",
});

export const api = require(bundlePath);
api.installDomHelpers(globalThis.window);

export const TMP_ROOTS = [];

export async function makeRoot() {
  const dir = await mkdtemp(path.join(tmpdir(), "ex-libris-test-"));
  TMP_ROOTS.push(dir);
  return dir;
}

export async function cleanupRoots() {
  for (const dir of TMP_ROOTS.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function waitFor(predicate, { timeout = 4000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export function fanqieFixture() {
  return `---
type: book
source: fanqie
title: 藏书票样章
author: Ex Libris
status: 在读
cover: ""
fq_book_id: "7143038691944959011"
fq_cover_url: ""
fq_serial_status: 完结
fq_word_count: 12600
fq_chapter_total: 3
fq_reading_chapter: 第一章 纸片与印章
fq_progress: 0
fq_unread_count: 3
fq_last_read_at: 2026-11-01T10:00:00+08:00
fq_related: ""
created: 2026-11-01
tags: [book, fanqie]
---

# 藏书票样章
`;
}

export function doubanBookFixture(overrides = {}) {
  const fields = {
    id: "1001",
    title: "旧书摊",
    type: "book",
    score: 8.6,
    imageData: JSON.stringify({ large: "https://img.example.test/old-book.jpg" }),
    myState: "读过",
    myRating: 4,
    datePublished: "2018-05-01",
    myCollectionDate: "2025-03-02",
    publisher: "纸上出版社",
    ...overrides,
  };
  const lines = Object.entries(fields).map(
    ([key, value]) => `${key}: ${typeof value === "string" && !/^[\d.]+$/.test(value) ? value : JSON.stringify(value)}`,
  );
  return `---\n${lines.join("\n")}\ntags: [book, douban]\n---\n\n# ${fields.title}\n`;
}
