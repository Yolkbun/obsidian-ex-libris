import test from "node:test";
import assert from "node:assert/strict";
import { api, makeRoot, cleanupRoots, fanqieFixture, doubanBookFixture } from "./harness.mjs";

test.after(cleanupRoots);

async function boot(files, options = {}) {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root, files });
  app.dataStore.set("ex-libris", {
    sidecarEnabled: false,
    cacheRemoteCovers: false,
    ...(options.settings ?? {}),
  });
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

test("插件加载后能从 frontmatter 建立书架条目", async () => {
  const { plugin } = await boot({
    "Library/book/藏书票样章.md": fanqieFixture(),
    "Books/旧书摊.md": doubanBookFixture(),
    "Notes/普通笔记.md": "# 只是一条笔记\n",
  });

  const items = plugin.entries.all();
  assert.equal(items.length, 2, "普通笔记不应进书架");

  const fanqie = items.find((item) => item.bookId === "7143038691944959011");
  assert.ok(fanqie, "应识别番茄条目");
  assert.equal(fanqie.source, "fanqie");
  assert.equal(fanqie.progress, 0);
  assert.equal(fanqie.badge, "未读 3");
  assert.equal(fanqie.title, "藏书票样章");

  const douban = items.find((item) => item.title === "旧书摊");
  assert.ok(douban, "应识别豆瓣条目");
  assert.equal(douban.source, "douban");
  assert.equal(douban.type, "book");
  assert.equal(douban.cover?.kind, "remote");
  assert.equal(douban.year, "2025");

  await plugin.dispose();
});

test("注册了视图、Bases、命令与回跳协议", async () => {
  const { app, plugin } = await boot({ "Library/book/藏书票样章.md": fanqieFixture() });

  assert.ok(app.viewFactories.has("ex-libris-shelf"));
  assert.ok(app.viewFactories.has("ex-libris-reader"));
  assert.ok(app.basesViews.has("ex-libris-shelf"));
  assert.ok(app.protocolHandlers.has("ex-libris"));
  assert.ok(app.commands.some((command) => command.id === "open-shelf"));
  assert.ok(app.commands.length >= 10);
  assert.equal(app.basesViews.get("ex-libris-shelf").name, "Ex Libris 书架");

  await plugin.dispose();
});

test("书架视图能渲染封面墙与来源徽标", async () => {
  const { app, plugin } = await boot({
    "Library/book/藏书票样章.md": fanqieFixture(),
    "Books/旧书摊.md": doubanBookFixture(),
  });

  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: "ex-libris-shelf", state: { preset: "all", filter: "all" } });

  const view = leaf.view;
  assert.ok(view, "视图应创建");
  const root = view.contentEl.querySelector(".ex-libris-library");
  assert.ok(root, "应有书架布局");
  assert.ok(root.querySelector(".ex-libris-presets"), "应有预设列表");
  assert.equal(root.querySelectorAll(".ex-libris-book").length, 2);
  assert.ok(root.querySelector(".ex-libris-source-fanqie"));
  assert.ok(root.querySelector(".ex-libris-source-douban"));
  assert.ok(root.querySelector(".ex-libris-progress"), "番茄条目应有进度条");

  await plugin.dispose();
});

test("Bases 视图工厂能渲染出同样的书架", async () => {
  const { app, plugin } = await boot({
    "Library/book/藏书票样章.md": fanqieFixture(),
    "Books/旧书摊.md": doubanBookFixture(),
  });

  const registration = app.basesViews.get("ex-libris-shelf");
  const container = document.createElement("div");
  const fakeController = {
    app,
    config: { get: () => undefined },
    data: { data: [] },
  };
  const view = registration.factory(fakeController, container);
  view.onDataUpdated();
  assert.equal(container.querySelectorAll(".ex-libris-book").length, 2);

  await plugin.dispose();
});
