import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { api, makeRoot, cleanupRoots, fanqieFixture, waitFor, ROOT } from "./harness.mjs";

test.after(cleanupRoots);

const DEV_SIDECAR = path.join(ROOT, "tools", "dev-sidecar.mjs");

const DETAIL = {
  id: "7143038691944959011",
  title: "藏书票样章",
  author: "Ex Libris",
  cover_url: "",
  word_count: 12600,
  serial_status: "完结",
  category: "示例",
  intro: "",
  chapter_total: 3,
};

async function boot(files = {}) {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root, files });
  app.dataStore.set("ex-libris", { sidecarEnabled: false, cacheRemoteCovers: false });
  const plugin = new api.ExLibrisPlugin(app, {
    id: "ex-libris",
    name: "Ex Libris 藏书票",
    version: "0.1.0",
    minAppVersion: "1.10.0",
    dir: ".obsidian/plugins/ex-libris",
  });
  await plugin.onload();
  api.openLayout(app);
  await plugin.initialized;
  return { app, plugin, root };
}

test("建立番茄轻笔记：frontmatter 齐全、正文不落盘", async (t) => {
  const { app, plugin, root } = await boot();
  t.after(() => plugin.dispose());

  const result = await api.createFanqieNote(app, plugin.settings, plugin.covers, DETAIL);
  assert.equal(result.created, true);
  assert.equal(result.file.path, "Library/book/藏书票样章.md");

  const content = await readFile(path.join(root, "Library/book/藏书票样章.md"), "utf8");
  assert.match(content, /^---\nfq_book_id|^---\ntype: novel/);
  assert.match(content, /type: novel/);
  assert.match(content, /source: fanqie/);
  assert.match(content, /title: 藏书票样章/);
  assert.match(content, /author: Ex Libris/);
  assert.match(content, /status: 在追/);
  assert.match(content, /fq_book_id: "7143038691944959011"/);
  assert.match(content, /fq_word_count: 12600/);
  assert.match(content, /fq_chapter_total: 3/);
  assert.match(content, /tags: \[novel, fanqie\]/);
  assert.match(content, /fq_progress: 0/);
  assert.ok(!content.includes("旧书摊"), "正文不能写进笔记");

  // 已存在时默认跳过，且不改动
  const second = await api.createFanqieNote(app, plugin.settings, plugin.covers, DETAIL);
  assert.equal(second.skipped, true);
  assert.equal(second.created, false);
});

test("更新元信息时保留阅读状态和自定义字段", async (t) => {
  const { app, plugin, root } = await boot();
  t.after(() => plugin.dispose());

  await api.createFanqieNote(app, plugin.settings, plugin.covers, DETAIL);
  const file = app.vault.getAbstractFileByPath("Library/book/藏书票样章.md");
  await app.vault.process(file, (data) =>
    data.replace("status: 在追", "status: 归档").replace("fq_related: \"\"", 'fq_related: "[[旧书摊]]"'),
  );

  await api.createFanqieNote(app, plugin.settings, plugin.covers, { ...DETAIL, author: "改过的作者" }, {
    updateExisting: true,
  });
  const content = await readFile(path.join(root, "Library/book/藏书票样章.md"), "utf8");
  assert.match(content, /author: 改过的作者/);
  assert.match(content, /status: 归档/, "用户改过的 status 不能被覆盖");
  assert.match(content, /fq_related: "\[\[旧书摊\]\]"/);
});

test("同名不同书会加后缀，不覆盖已有笔记", async (t) => {
  const { app, plugin } = await boot();
  t.after(() => plugin.dispose());

  const first = await api.createFanqieNote(app, plugin.settings, plugin.covers, DETAIL);
  const second = await api.createFanqieNote(app, plugin.settings, plugin.covers, {
    ...DETAIL,
    id: "8888888888",
    title: "藏书票样章",
  });
  assert.equal(first.file.path, "Library/book/藏书票样章.md");
  assert.match(second.file.path, /藏书票样章-8888\.md$/);
});

test("写阅读摘要只动 fq_ 字段", async (t) => {
  const { app, plugin, root } = await boot();
  t.after(() => plugin.dispose());

  const { file } = await api.createFanqieNote(app, plugin.settings, plugin.covers, DETAIL);
  await api.writeReadingSummary(app, file, {
    chapterTitle: "第二章 编号",
    chapterIndex: 1,
    total: 3,
    percent: 33,
    at: "2026-11-08T15:20:00+08:00",
    unread: 1,
  });

  const content = await readFile(path.join(root, "Library/book/藏书票样章.md"), "utf8");
  assert.match(content, /fq_reading_chapter: 第二章 编号/);
  assert.match(content, /fq_progress: 33/);
  assert.match(content, /fq_unread_count: 1/);
  assert.match(content, /fq_last_read_at: 2026-11-08T15:20:00\+08:00/);
  assert.match(content, /status: 在追/, "其他字段保持不变");
});

test("打开书架会刷新未读章数", async (t) => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({
    root,
    files: {
      "Library/book/藏书票样章.md": fanqieFixture(),
      ".obsidian/plugins/ex-libris/data/progress.json": JSON.stringify({
        "7143038691944959011": {
          chapterId: "900001",
          chapterIndex: 0,
          offset: 0,
          updatedAt: "2026-11-01T10:00:00+08:00",
        },
      }),
    },
  });
  app.dataStore.set("ex-libris", {
    sidecarEnabled: true,
    sidecarPath: process.execPath,
    cacheRemoteCovers: false,
  });
  const plugin = new api.ExLibrisPlugin(app, {
    id: "ex-libris",
    name: "Ex Libris 藏书票",
    version: "0.1.0",
    minAppVersion: "1.10.0",
    dir: ".obsidian/plugins/ex-libris",
  });
  plugin.sidecarArgsPrefix = [DEV_SIDECAR];
  await plugin.onload();
  api.openLayout(app);
  await plugin.initialized;
  await waitFor(() => plugin.sidecar.isReady, { timeout: 10_000 });
  t.after(() => plugin.dispose());

  await plugin.activateShelf();
  await waitFor(
    async () => {
      const content = await readFile(path.join(root, "Library/book/藏书票样章.md"), "utf8");
      return /fq_unread_count: 2/.test(content);
    },
    { timeout: 8_000 },
  );
});
