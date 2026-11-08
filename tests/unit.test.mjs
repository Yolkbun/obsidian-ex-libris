import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { api, makeRoot, cleanupRoots, fanqieFixture } from "./harness.mjs";

test.after(cleanupRoots);

test("YAML 标量与 frontmatter 补写", () => {
  assert.equal(api.yamlScalar("7143038691944959011"), '"7143038691944959011"');
  assert.equal(api.yamlScalar("爱潜水的乌贼"), "爱潜水的乌贼");
  assert.equal(api.yamlScalar("a: b"), '"a: b"');
  assert.equal(api.yamlScalar(""), '""');
  assert.equal(api.yamlScalar(0), "0");
});

test("buildFrontmatter 按指定顺序输出并支持数组", () => {
  const text = api.buildFrontmatter(
    { title: "书", tags: ["book", "fanqie"], fq_book_id: "123", type: "book" },
    ["type", "title", "fq_book_id", "tags"],
  );
  const lines = text.trim().split("\n");
  assert.equal(lines[0], "---");
  assert.equal(lines[1], "type: book");
  assert.equal(lines[2], "title: 书");
  assert.equal(lines[3], 'fq_book_id: "123"');
  assert.equal(lines[4], "tags: [book, fanqie]");
});

test("patchFrontmatter 只改指定键，保留未知键、注释和正文", () => {
  const original = `---
title: 书
# 用户的注释
status: 在追
custom: 保留我
---

正文第一行

## 摘录
`;
  const patched = api.patchFrontmatter(original, {
    status: "读完",
    fq_progress: 42,
    fq_reading_chapter: "第 3 章",
  });
  assert.match(patched, /status: 读完/);
  assert.match(patched, /fq_progress: 42/);
  assert.match(patched, /fq_reading_chapter: 第 3 章/);
  assert.match(patched, /# 用户的注释/);
  assert.match(patched, /custom: 保留我/);
  assert.ok(patched.endsWith("正文第一行\n\n## 摘录\n"));
  assert.equal(patched.match(/^---$/gm).length, 2);
});

test("没有 frontmatter 时 patch 会补一块", () => {
  const patched = api.patchFrontmatter("# 纯文本\n", { fq_progress: 1 });
  assert.match(patched, /^---\nfq_progress: 1\n---\n# 纯文本/);
});

test("splitFrontmatter 与截断", () => {
  const split = api.splitFrontmatter("---\na: 1\n---\n\nbody");
  assert.equal(split.frontmatter, "a: 1");
  assert.equal(split.body, "\nbody");
  const truncated = api.truncateText("😀".repeat(10), 5);
  assert.equal(truncated.truncated, true);
  assert.equal([...truncated.text].length, 5);
});

test("renderShelf：封面、书脊、进度、徽标与点击", () => {
  const host = document.createElement("div");
  const items = [
    {
      path: "A.md",
      title: "诡秘之主",
      type: "book",
      source: "both",
      cover: null,
      progress: 42,
      badge: "未读 3",
      status: "在追",
      author: "爱潜水的乌贼",
      year: "2018",
    },
    {
      path: "B.md",
      title: "没有封面的电影",
      type: "movie",
      source: "douban",
      cover: { kind: "remote", value: "https://example.test/x.jpg" },
      progress: null,
      badge: null,
      status: "看过",
    },
  ];
  let opened = null;
  api.renderShelf(host, items, {
    coverWidth: 160,
    showProgress: true,
    gap: 20,
    lazy: false,
    resolveCover: (cover) => (cover.kind === "vault" ? `vault:${cover.value}` : cover.value),
    onOpen: (item) => {
      opened = item.path;
    },
  });

  const books = host.querySelectorAll(".ex-libris-book");
  assert.equal(books.length, 2);
  assert.ok(host.querySelector(".ex-libris-grid").style.gridTemplateColumns.includes("160px"));
  assert.equal(host.querySelectorAll(".ex-libris-spine").length, 2);
  assert.ok(host.querySelector(".ex-libris-source-both"));
  assert.equal(host.querySelector(".ex-libris-badge").textContent, "未读 3");
  assert.equal(host.querySelector(".ex-libris-progress-fill").style.width, "42%");
  assert.equal(books[1].querySelector("img").getAttribute("src"), "https://example.test/x.jpg");

  // 占位首字与稳定色
  const placeholder = books[1].querySelector(".ex-libris-placeholder-initial") ?? books[0].querySelector(".ex-libris-placeholder-initial");
  assert.ok(placeholder, "无封面时应有占位块");
  assert.equal(placeholder.textContent, "诡");

  books[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(opened, "A.md");
});

test("renderShelf：空态与固定列数", () => {
  const host = document.createElement("div");
  api.renderShelf(host, [], { emptyText: "没有书" });
  assert.equal(host.querySelector(".ex-libris-empty-title").textContent, "没有书");

  const host2 = document.createElement("div");
  api.renderShelf(
    host2,
    [{ path: "a", title: "a", type: "book", source: "fanqie", cover: null, progress: null, badge: null, status: "" }],
    { columns: 5 },
  );
  assert.ok(host2.querySelector(".ex-libris-grid").style.gridTemplateColumns.includes("repeat(5"));
});

test("书架预设与筛选", () => {
  const now = new Date("2026-11-08T12:00:00+08:00");
  const items = [
    { path: "1", title: "在读", type: "book", source: "fanqie", cover: null, progress: 20, badge: null, status: "在读", timestamp: now.getTime(), tags: ["科幻"] },
    { path: "2", title: "读完", type: "book", source: "douban", cover: null, progress: null, badge: null, status: "读完", timestamp: now.getTime() },
    { path: "3", title: "想读", type: "movie", source: "douban", cover: null, progress: null, badge: null, status: "想读", timestamp: 0 },
    { path: "4", title: "去年读完", type: "book", source: "douban", cover: null, progress: null, badge: null, status: "读完", timestamp: new Date("2024-01-01").getTime() },
  ];
  const presets = [
    { id: "all", name: "全部", kind: "all" },
    { id: "reading", name: "在读", kind: "reading" },
    { id: "finished-this-year", name: "今年读完", kind: "finished-this-year" },
    { id: "want", name: "想读", kind: "want" },
    { id: "scifi", name: "科幻", kind: "custom", field: "tag", value: "科幻" },
  ];
  const counts = api.presetCounts(items, presets, now);
  assert.equal(counts.all, 4);
  assert.equal(counts.reading, 1);
  assert.equal(counts["finished-this-year"], 1);
  assert.equal(counts.want, 1);
  assert.equal(counts.scifi, 1);

  assert.deepEqual(
    api.filterShelf(items, "finished-this-year", "all", presets, now).map((item) => item.path),
    ["2"],
  );
  assert.deepEqual(
    api.filterShelf(items, "all", "movie", presets, now).map((item) => item.path),
    ["3"],
  );
  assert.equal(api.typeCounts(items).book, 3);

  // 番茄默认状态是“在追”，也必须算在读（否则书架预设与未读数都会漏掉它）
  const chasing = {
    path: "5",
    title: "在追",
    type: "book",
    source: "fanqie",
    cover: null,
    progress: 0,
    badge: "未读 3",
    status: "在追",
    timestamp: now.getTime(),
  };
  assert.deepEqual(
    api.filterShelf([chasing], "reading", "all", presets, now).map((item) => item.path),
    ["5"],
  );
});

test("摘录块：多行引用、出处、回跳、800 字截断", () => {
  const block = api.buildExcerptBlock({
    text: "第一段\n第二段",
    bookTitle: "诡秘之主",
    chapterTitle: "第 58 章 值夜者",
    bookId: "7143038691944959011",
    chapterIndex: 57,
  });
  assert.equal(block.truncated, false);
  assert.equal(
    block.markdown,
    [
      "> [!quote] 摘录",
      "> 第一段",
      "> 第二段",
      "> — 《诡秘之主》· 第 58 章 值夜者 · [回跳](obsidian://ex-libris?book=7143038691944959011&chapter=58)",
    ].join("\n"),
  );
  assert.equal(api.excerptLink("1", 0), "obsidian://ex-libris?book=1&chapter=1");

  const long = api.buildExcerptBlock({
    text: "字".repeat(1000),
    bookTitle: "书",
    chapterTitle: "章",
    bookId: "1",
    chapterIndex: 0,
  });
  assert.equal(long.truncated, true);
  assert.ok(long.markdown.includes("已截断"));
  assert.ok(long.markdown.length < 1100);
});

test("摘录插到 ## 摘录 下；没有标题时新建", () => {
  const withHeading = "# 笔记\n\n## 摘录\n\n旧的\n";
  const merged = api.appendUnderExcerptHeading(withHeading, "> [!quote] 摘录\n> 新");
  assert.ok(merged.indexOf("> [!quote]") < merged.indexOf("旧的"));
  assert.ok(merged.indexOf("## 摘录") < merged.indexOf("> [!quote]"));

  const withoutHeading = "# 笔记\n\n一些正文\n";
  const created = api.appendUnderExcerptHeading(withoutHeading, "> [!quote] 摘录\n> 新");
  assert.ok(created.includes("## 摘录"));
  assert.ok(created.indexOf("## 摘录") < created.indexOf("> [!quote]"));
  assert.ok(created.indexOf("一些正文") < created.indexOf("## 摘录"));
});

test("章节文件路径、正文拼接与链接解析", () => {
  const settings = {
    libraryRoot: "Library",
    exportFolder: "Library/exports",
  };
  const chapter = { id: "9", book_id: "1", title: "第一章 值夜者", index: 57, paragraphs: ["a", "b"], prev: null, next: null };
  const filePath = api.chapterFilePath(settings, "诡秘之主", chapter, { id: "9", title: "第 58 章 值夜者", index: 57 });
  assert.equal(filePath, "Library/exports/诡秘之主/0058 - 第 58 章 值夜者.md");
  assert.equal(api.chapterBody("第 58 章 值夜者", ["a", "b"]), "# 第 58 章 值夜者\n\na\n\nb\n");

  const toc = [
    { id: "x1", title: "第一章", index: 0 },
    { id: "x2", title: "第二章", index: 1 },
  ];
  assert.equal(api.resolveChapterParam("x2", toc), "x2");
  assert.equal(api.resolveChapterParam("2", toc), "x2");
  assert.equal(api.resolveChapterParam("99", toc), undefined);
  assert.equal(api.resolveChapterParam(undefined, toc), undefined);

  assert.equal(api.extractUrl("看这个 https://fanqienovel.com/page/123 谢谢"), "https://fanqienovel.com/page/123");
  assert.equal(api.extractUrl("没有链接"), null);
});

test("番茄笔记路径会清洗非法字符", () => {
  const settings = { libraryRoot: "Library" };
  assert.equal(api.fanqieNotePath(settings, 'a/b:c*?"<>|#^[]'), "Library/book/a b c.md");
  assert.equal(api.fanqieNotePath(settings, "   "), "Library/book/未命名.md");
});

test("AtomicJsonStore 原子写不留 .tmp", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root });
  const store = new api.AtomicJsonStore(app.vault.adapter, "data/test.json", () => ({ n: 0 }));
  await store.load();
  store.update((value) => {
    value.n = 7;
  });
  await store.flush();
  const content = JSON.parse(await readFile(path.join(root, "data/test.json"), "utf8"));
  assert.equal(content.n, 7);
  const entries = await readdir(path.join(root, "data"));
  assert.deepEqual(entries, ["test.json"]);
});

test("CacheCleaner 只清 cache，不碰 data", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root });
  const adapter = app.vault.adapter;
  await adapter.write("cache/chapters/1/2.txt", "正文");
  await adapter.write("cache/covers/abc.jpg", "img");
  await adapter.write("data/progress.json", "{}");

  const meta = new api.AtomicJsonStore(adapter, "data/meta.json", () => ({ lastCleanup: 0 }));
  await meta.load();
  const cleaner = new api.CacheCleaner(adapter, "cache", meta, () => 7);

  const size = await cleaner.size();
  assert.ok(size > 0);

  const cleared = await cleaner.maybeCleanupOnStartup();
  assert.equal(cleared, true);
  assert.equal(await adapter.exists("cache/chapters/1/2.txt"), false);
  assert.equal(await adapter.exists("cache/covers/abc.jpg"), false);
  assert.equal(await adapter.exists("data/progress.json"), true, "data 不能被清理");
  assert.ok(meta.get().lastCleanup > 0);

  // 未过期时不会再清
  await adapter.write("cache/chapters/1/3.txt", "x");
  assert.equal(await cleaner.maybeCleanupOnStartup(), false);
  assert.equal(await adapter.exists("cache/chapters/1/3.txt"), true);
});

test("ProgressStore 节流落盘与读取", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root });
  const store = new api.ProgressStore(app.vault.adapter, "data/progress.json");
  await store.init();
  store.set("book", "chapter", 2, 123.4);
  const record = store.get("book");
  assert.equal(record.chapterId, "chapter");
  assert.equal(record.chapterIndex, 2);
  assert.equal(record.offset, 123);
  await store.flush();
  const raw = JSON.parse(await readFile(path.join(root, "data/progress.json"), "utf8"));
  assert.equal(raw.book.chapterId, "chapter");
  assert.equal(raw.book.offset, 123);
});

test("侧车缓存拒绝路径穿越，并缓存章节与目录", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root });
  const cache = new api.SidecarCache(app.vault.adapter, "cache");

  assert.equal(cache.chapterPath("../x", "1"), null);
  assert.equal(cache.chapterPath("1", "../../x"), null);
  await cache.writeChapter("../x", "1", ["no"]);
  assert.equal(await app.vault.adapter.exists("cache/chapters/../x/1.txt"), false);

  await cache.writeChapter("book", "ch", ["a", "b"]);
  assert.deepEqual(await cache.readChapter("book", "ch"), ["a", "b"]);

  await cache.writeToc("book", [{ id: "ch", title: "第一章", index: 0 }]);
  const toc = await cache.readToc("book");
  assert.equal(toc.items[0].id, "ch");
  assert.ok(toc.fetchedAt > 0);
});

test("断网时远程封面走本地缓存", async () => {
  const root = await makeRoot();
  const { app, adapter } = await api.createTestApp({
    root,
    files: {
      "Books/旧书摊.md": `---\ntitle: 旧书摊\ntype: book\nid: "1"\nmyState: 读过\nimageData:\n  large: https://img.example.test/old-book.jpg\n---\n\n# 旧书摊\n`,
      ".obsidian/plugins/ex-libris/cache/covers/index.json": JSON.stringify({
        "https://img.example.test/old-book.jpg": "abc123.jpg",
      }),
      ".obsidian/plugins/ex-libris/cache/covers/abc123.jpg": "fake-bytes",
    },
  });

  const resolver = new api.CoverResolver(
    app,
    ".obsidian/plugins/ex-libris/cache/covers",
    ".obsidian/plugins/ex-libris/cache/covers/index.json",
  );
  await resolver.init();
  const cover = resolver.resolve(
    { imageData: { large: "https://img.example.test/old-book.jpg" } },
    "Books/旧书摊.md",
  );
  assert.deepEqual(cover, {
    kind: "vault",
    value: ".obsidian/plugins/ex-libris/cache/covers/abc123.jpg",
  });
  assert.ok((await adapter.exists(cover.value)) === true);

  // 索引缺失/文件被删后回退远程 URL
  await adapter.remove(cover.value);
  await resolver.init();
  const fallback = resolver.resolve(
    { imageData: { large: "https://img.example.test/old-book.jpg" } },
    "Books/旧书摊.md",
  );
  assert.deepEqual(fallback, {
    kind: "remote",
    value: "https://img.example.test/old-book.jpg",
  });
});

test("frontmatter 夹具能被 EntryIndex 识别为番茄条目", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({
    root,
    files: { "Library/book/藏书票样章.md": fanqieFixture() },
  });
  const coverMock = { resolve: () => null };
  const index = new api.EntryIndex(app, coverMock);
  await index.init();
  const item = index.byBookId("7143038691944959011");
  assert.ok(item);
  assert.equal(item.bookId, "7143038691944959011");
  assert.equal(item.source, "fanqie");
  assert.equal(item.type, "novel");
});

test("豆瓣条目：生成 frontmatter、重复跳过", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root });
  const covers = { downloadTo: async () => false };
  const settings = { libraryRoot: "Library" };
  const item = {
    id: "36573581",
    title: "十日终焉·囚笼",
    author: "杀虫队队员",
    year: "2023",
    coverUrl: "",
    type: "book",
  };
  const first = await api.createDoubanNote(app, settings, covers, item);
  assert.equal(first.created, true);
  const text = await app.vault.read(first.file);
  assert.ok(text.includes("type: book"));
  assert.ok(text.includes('id: "36573581"'));
  assert.ok(text.includes("myState: 想读"));
  assert.ok(text.includes("datePublished:"));
  assert.ok(text.includes("2023"));

  const again = await api.createDoubanNote(app, settings, covers, item);
  assert.equal(again.created, false);
  assert.equal(again.skipped, true);
  assert.equal(api.doubanNotePath(settings, item.title), "Library/douban/十日终焉·囚笼.md");
});

test("豆瓣搜索：解析书籍 JSON、影剧类型识别、非 JSON 报错", async () => {
  globalThis.__requestUrlHandler = async (request) => {
    assert.ok(request.url.startsWith("https://book.douban.com/j/subject_suggest"));
    return {
      status: 200,
      text: JSON.stringify([
        { id: "36573581", title: "十日终焉·囚笼", author_name: "杀虫队队员", year: "2023", pic: "https://img.example/1.jpg", type: "b" },
      ]),
      json: null,
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    };
  };
  const books = await api.searchDouban("book", "十日终焉");
  assert.equal(books.length, 1);
  assert.equal(books[0].type, "book");
  assert.equal(books[0].author, "杀虫队队员");

  globalThis.__requestUrlHandler = async () => ({
    status: 200,
    text: JSON.stringify([
      { id: "36675856", title: "十日终焉", year: "2027", img: "https://img.example/2.jpg", type: "movie", episode: "24" },
    ]),
    json: null,
    arrayBuffer: new ArrayBuffer(0),
    headers: {},
  });
  const screen = await api.searchDouban("screen", "十日终焉");
  assert.equal(screen[0].type, "tv");

  globalThis.__requestUrlHandler = async () => ({
    status: 200,
    text: "<html>captcha</html>",
    json: null,
    arrayBuffer: new ArrayBuffer(0),
    headers: {},
  });
  await assert.rejects(() => api.searchDouban("book", "x"), /非 JSON/);
  delete globalThis.__requestUrlHandler;
});

test("联动开关：关闭时隐藏外部豆瓣条目，保留内建条目", async () => {
  const root = await makeRoot();
  const external = `---
type: book
id: "ext-1"
title: 外部豆瓣
myState: 想读
---
`;
  const internal = `---
type: book
id: "int-1"
ex_libris: douban-search
title: 内建豆瓣
myState: 想读
---
`;
  const { app } = await api.createTestApp({
    root,
    files: { "Books/external.md": external, "Library/douban/internal.md": internal },
  });
  const covers = { resolve: () => null };
  const off = new api.EntryIndex(app, covers, { includeDouban: () => false });
  await off.init();
  assert.equal(off.all().length, 1);
  assert.equal(off.all()[0].title, "内建豆瓣");

  const on = new api.EntryIndex(app, covers, { includeDouban: () => true });
  await on.init();
  assert.equal(on.all().length, 2);
});

test("豆瓣封面：换大图并带 Referer 下载", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root });
  const resolver = new api.CoverResolver(app, "cache/covers", "cache/covers.json");
  let seen = null;
  globalThis.__requestUrlHandler = async (request) => {
    seen = request;
    return {
      status: 200,
      text: "",
      json: null,
      arrayBuffer: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
      headers: { "content-type": "image/jpeg" },
    };
  };
  const small = "https://img3.doubanio.com/view/subject/s/public/s34766539.jpg";
  const large = api.doubanCoverUrl(small);
  assert.ok(large.includes("/view/subject/l/public/"));
  assert.equal(api.coverHeaders(large).Referer, "https://book.douban.com/");
  const ok = await resolver.downloadTo(large, "Library/assets/covers/douban-36573581.jpg");
  assert.equal(ok, true);
  assert.equal(seen.headers.Referer, "https://book.douban.com/");
  assert.ok(await app.vault.adapter.exists("Library/assets/covers/douban-36573581.jpg"));
  delete globalThis.__requestUrlHandler;
});

test("豆瓣音乐：解析 search page 的 window.__DATA__", async () => {
  const html = `<script>window.__DATA__ = {"error_info":"","items":[{"id":1403307,"title":"范特西 / Fantasy","abstract":"周杰伦 / 2001-09-14 / 专辑 / CD / 流行","cover_url":"https://img3.doubanio.com/view/subject/m/public/s35019288.jpg","tpl_name":"search_subject"},{"id":1,"title":"艺术家","tpl_name":"search_common"}],"total":2};</script>`;
  globalThis.__requestUrlHandler = async (request) => {
    assert.ok(request.url.startsWith("https://search.douban.com/music/subject_search"));
    return {
      status: 200,
      text: html,
      json: null,
      arrayBuffer: new ArrayBuffer(0),
      headers: {},
    };
  };
  const items = await api.searchDouban("music", "范特西");
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "music");
  assert.equal(items[0].title, "范特西 / Fantasy");
  assert.equal(items[0].author, "周杰伦");
  assert.equal(items[0].year, "2001");
  assert.ok(api.doubanCoverUrl(items[0].coverUrl).includes("/view/subject/l/public/"));
  delete globalThis.__requestUrlHandler;
});

test("章节目录：列表、当前章、搜索与跳转", async () => {
  const { app } = await api.createTestApp({ root: await makeRoot() });
  const chapters = [
    { id: "c1", title: "第一章 空屋", index: 0 },
    { id: "c2", title: "第二章 来客", index: 1 },
    { id: "c3", title: "第三章 夜行", index: 2 },
  ];
  let picked = "";
  const modal = new api.TocModal(app, "十日终焉", chapters, "c2", (id) => { picked = id; });
  modal.open();
  assert.equal(modal.contentEl.querySelectorAll(".ex-libris-toc-row").length, 3);
  assert.ok(modal.contentEl.querySelector(".ex-libris-toc-row.is-current").textContent.includes("第二章"));
  const input = modal.contentEl.querySelector("input");
  input.value = "夜";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(modal.contentEl.querySelectorAll(".ex-libris-toc-row").length, 1);
  modal.contentEl.querySelector(".ex-libris-toc-row").click();
  assert.equal(picked, "c3");
});

test("批注：只在高亮/改色时写笔记，选中文字与所在段落都导出", async () => {
  const root = await makeRoot();
  const { app } = await api.createTestApp({ root });
  const store = new api.AnnotationStore(app.vault.adapter, "data/annotations.json");
  await store.init();
  const record = await store.add("book-1", "chapter-1", {
    text: "这句被高亮",
    paragraph: "这是整段文字，这句被高亮，后面还有内容。",
    paragraphIndex: 2,
    kind: "highlight",
    color: "yellow",
  });
  assert.equal(store.list("book-1", "chapter-1").length, 1);
  const first = await api.appendAnnotationNote(app, { libraryRoot: "Library" }, {
    bookId: "book-1",
    bookTitle: "十日终焉",
    chapterId: "chapter-1",
    chapterTitle: "第 1 章 空屋",
    chapterIndex: 0,
    record,
  });
  let text = await app.vault.read(first);
  assert.ok(text.includes("高亮（黄色）"));
  assert.ok(text.includes("这句被高亮"));
  assert.ok(text.includes("这是整段文字"));
  assert.ok(!text.includes("fq_book_id"));

  await api.appendAnnotationNote(app, { libraryRoot: "Library" }, {
    bookId: "book-1",
    bookTitle: "十日终焉",
    chapterId: "chapter-1",
    chapterTitle: "第 1 章 空屋",
    chapterIndex: 0,
    record: { ...record, id: "r2", kind: "color", color: "red", text: "后面还有内容" },
  });
  text = await app.vault.read(first);
  assert.ok(text.includes("字体颜色（红色）"));
  assert.ok(text.includes("后面还有内容"));
});
