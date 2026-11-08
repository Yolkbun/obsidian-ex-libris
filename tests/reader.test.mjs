import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { api, makeRoot, cleanupRoots, fanqieFixture, waitFor, ROOT } from "./harness.mjs";

test.after(cleanupRoots);

const DEV_SIDECAR = path.join(ROOT, "tools", "dev-sidecar.mjs");

async function bootReader() {
  const root = await makeRoot();
  await mkdir(path.join(root, "Notes"), { recursive: true });
  const { app } = await api.createTestApp({
    root,
    files: {
      "Library/book/藏书票样章.md": fanqieFixture(),
      "Notes/摘录本.md": "# 摘录本\n\n## 摘录\n\n旧的一条。\n",
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
  return { app, plugin, root };
}

test("阅读器：正文渲染、翻章、进度与摘要双写", async (t) => {
  const { app, plugin, root } = await bootReader();
  t.after(async () => {
    await plugin.dispose();
  });

  await plugin.activateReader("7143038691944959011");
  const leaf = app.workspace.getLeavesOfType("ex-libris-reader")[0];
  assert.ok(leaf?.view, "阅读器视图应存在");
  const view = leaf.view;

  await waitFor(() => view.contentEl.querySelector(".ex-libris-reader-page h1"), { timeout: 8_000 });
  const heading = view.contentEl.querySelector(".ex-libris-reader-page h1").textContent;
  assert.equal(heading, "第一章 纸片与印章");
  const paragraphs = view.contentEl.querySelectorAll(".ex-libris-reader-page p");
  assert.ok(paragraphs.length >= 4);
  assert.ok(paragraphs[0].textContent.includes("旧书摊"));

  // 键盘翻章
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await waitFor(
    () => view.contentEl.querySelector(".ex-libris-reader-page h1")?.textContent === "第二章 编号",
    { timeout: 8_000 },
  );

  // progress.json 里记的是第二章
  await plugin.progress.flush();
  const progressRaw = await readFile(
    path.join(root, ".obsidian/plugins/ex-libris/data/progress.json"),
    "utf8",
  );
  const progress = JSON.parse(progressRaw);
  assert.equal(progress["7143038691944959011"].chapterId, "900002");
  assert.equal(progress["7143038691944959011"].chapterIndex, 1);

  // frontmatter 摘要同步
  const note = await readFile(
    path.join(root, "Library/book/藏书票样章.md"),
    "utf8",
  );
  assert.match(note, /fq_reading_chapter: 第二章 编号/);
  assert.match(note, /fq_progress: 33/);

  // 重新打开：应断点续读到第二章
  await view.onClose();
  await plugin.activateReader("7143038691944959011");
  await waitFor(
    () => view.contentEl.querySelector(".ex-libris-reader-page h1")?.textContent === "第二章 编号",
    { timeout: 8_000 },
  );

  // 正文绝不进 vault（红线 3）
  const vaultText = await readFile(path.join(root, "Library/book/藏书票样章.md"), "utf8");
  assert.ok(!vaultText.includes("旧书摊在巷口"), "vault 里不能有正文");
});

test("回跳协议：chapter 参数定位到正确章节", async (t) => {
  const { app, plugin } = await bootReader();
  t.after(async () => {
    await plugin.dispose();
  });

  const handler = app.protocolHandlers.get("ex-libris");
  assert.ok(handler);
  handler({ book: "7143038691944959011", chapter: "3" });

  await waitFor(
    () =>
      app.workspace
        .getLeavesOfType("ex-libris-reader")[0]
        ?.view?.contentEl.querySelector(".ex-libris-reader-page h1")?.textContent === "第三章 回跳",
    { timeout: 8_000 },
  );
});

test("删掉整个 cache/ 后阅读仍正常", async (t) => {
  const { app, plugin, root } = await bootReader();
  t.after(async () => {
    await plugin.dispose();
  });

  await plugin.activateReader("7143038691944959011");
  const view = app.workspace.getLeavesOfType("ex-libris-reader")[0].view;
  await waitFor(() => view.contentEl.querySelector(".ex-libris-reader-page p"), { timeout: 8_000 });

  await rm(path.join(root, ".obsidian/plugins/ex-libris/cache"), { recursive: true, force: true });

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await waitFor(
    () => view.contentEl.querySelector(".ex-libris-reader-page h1")?.textContent === "第二章 编号",
    { timeout: 8_000 },
  );
});

test("摘录：插入 callout、带出处与回跳链接，并落在 ## 摘录 下", async (t) => {
  const { app, plugin, root } = await bootReader();
  t.after(async () => {
    await plugin.dispose();
  });

  const target = app.vault.getAbstractFileByPath("Notes/摘录本.md");
  plugin.chooseExcerptTargetNote = async () => target;

  await plugin.activateReader("7143038691944959011");
  const leaf = app.workspace.getLeavesOfType("ex-libris-reader")[0];
  const view = leaf.view;
  await waitFor(() => view.contentEl.querySelector(".ex-libris-reader-page p"), { timeout: 8_000 });

  const paragraph = view.contentEl.querySelector(".ex-libris-reader-page p");
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "e", ctrlKey: true, shiftKey: true, bubbles: true }),
  );

  await waitFor(async () => {
    const content = await app.vault.read(target);
    return content.includes("> [!quote] 摘录");
  });

  const content = await app.vault.read(target);
  assert.ok(content.includes("> [!quote] 摘录"));
  assert.ok(content.includes("《藏书票样章》· 第 1 章 纸片与印章"));
  assert.ok(
    content.includes("obsidian://ex-libris?book=7143038691944959011&chapter=1"),
    "回跳链接应带 1 基章序号",
  );
  assert.ok(content.indexOf("> [!quote]") > content.indexOf("## 摘录"), "应插在摘录标题下");
  assert.ok(content.includes("旧的一条。"));

  // 摘录超过 800 字会截断
  const long = await api.buildExcerptBlock({
    text: "字".repeat(1200),
    bookTitle: "书",
    chapterTitle: "章",
    bookId: "1",
    chapterIndex: 0,
  });
  assert.equal(long.truncated, true);
  assert.ok(long.markdown.includes("已截断"));
});
