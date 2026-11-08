#!/usr/bin/env node
/**
 * 开发用侧车替身。
 *
 * 它与 Rust 侧车（sidecar/）遵守完全相同的本地 HTTP 契约与生命周期：
 *   --port、--data-dir、--parent-pid、FQ_TOKEN、stdin EOF 退出、
 *   父进程存活检查、闲置退出、POST /shutdown。
 *
 * 用途：在没有 Rust 工具链、或不想连上游时，跑通插件与侧车的端到端测试。
 * 它不是产品的一部分，也不读取任何上游账号/设备信息。
 */
import http from "node:http";
import process from "node:process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 0);
const token = process.env.FQ_TOKEN ?? "";
const idleMs = Number(args["idle-ms"] ?? 5 * 60_000);
const parentPid = args["parent-pid"] ? Number(args["parent-pid"]) : null;
const parentCheckMs = Number(args["parent-check-ms"] ?? 10_000);
const dataDir = args["data-dir"] ?? "";

if (!port) {
  process.stderr.write("fqsidecar: --port is required\n");
  process.exit(2);
}
if (!token) {
  process.stderr.write("fqsidecar: FQ_TOKEN is required\n");
  process.exit(2);
}
if (args["fail-start"]) {
  process.stderr.write("fqsidecar: simulated startup failure\n");
  process.exit(3);
}

if (dataDir) {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "device.json"), JSON.stringify({ device_ready: true, provider: "demo" }));
  } catch {
    /* 数据目录不可写也不影响只读接口 */
  }
}

const BOOK = {
  id: "7143038691944959011",
  title: "藏书票样章",
  author: "Ex Libris",
  cover_url: "",
  word_count: 12600,
  serial_status: "完结",
  category: "示例",
  intro: "侧车自检用的离线样章。它证明阅读器、进度、摘录与章评的链路是通的。",
  chapter_total: 3,
};

const CHAPTERS = [
  {
    id: "900001",
    title: "第一章 纸片与印章",
    paragraphs: [
      "旧书摊在巷口，木箱里摞着从上个世纪留下来的书。摊主说，翻到有书票的那一本，算你运气好。",
      "所谓书票，不过巴掌大的一张纸：上面有族徽、有拉丁文、有一句“从某人的藏书里来”。它贴在书封内侧，像一枚安静的印章。",
      "我把那张纸对着光看。纸很薄，边缘已经起毛，印上去的字却还清楚。那一刻我忽然明白，收藏不是占有，是替后来的读者保管一段时间。",
      "摊主收摊的时候，风把纸箱吹得发响。我买下那本书，也买下了书上那枚不属于我的印记。",
    ],
  },
  {
    id: "900002",
    title: "第二章 编号",
    paragraphs: [
      "回到家，我给书架上的每一本书编号。编号写在卡片上，卡片夹在书里，不写在书页上。",
      "有的书已经读过三遍，有的只翻过前言。编号不区分这些，它只记录一件事：这本书曾经被认真地放上过一次书架。",
      "夜里停电，我借着手机的光继续写卡片。写到第七本的时候，我发现自己已经记不清前三本的标题，于是又从头看了一遍。",
      "这大概就是书架的意义：它不替你记住，但它让你有机会重新遇见。",
    ],
  },
  {
    id: "900003",
    title: "第三章 回跳",
    paragraphs: [
      "摘录写进笔记之后，最要紧的是能跳回去。不能回跳的摘录，过几天就变成一句无主的话。",
      "所以我在每段摘录后面留一个链接：书名、章名、章序号。点开它，就该回到原来的那一页、那一行。",
      "有人觉得这样太麻烦。可一本书读到最后，真正留下的往往不是情节，而是某一句在当时恰好击中了你的话。",
      "为了让那句话随时可以回去，麻烦一点是值得的。",
    ],
  },
];

const COMMENTS = [
  { user: "夜航船", avatar: "", content: "这一章的开头很有旧书摊的味道。", likes: 12, time: "2026-11-01" },
  { user: "书页边", avatar: "", content: "藏书票这个说法第一次见，学到了。", likes: 7, time: "2026-11-02" },
  { user: "半山", avatar: "", content: "编号那一段让我想起自己贴标签的日子。", likes: 3, time: "2026-11-03" },
  { user: "无署名", avatar: "", content: "回跳确实是最实用的功能。", likes: 21, time: "2026-11-04" },
  { user: "晚风", avatar: "", content: "读到最后一句有点感动。", likes: 0, time: "2026-11-05" },
  { user: "白露", avatar: "", content: "希望作者多写一点书房的细节。", likes: 5, time: "2026-11-06" },
  { user: "纸箱", avatar: "", content: "摊主那句“算你运气好”很妙。", likes: 9, time: "2026-11-07" },
];

const state = {
  lastRequest: Date.now(),
  deviceReady: true,
};

const server = http.createServer(async (req, res) => {
  state.lastRequest = Date.now();
  try {
    if (req.headers["x-fq-token"] !== token) {
      return send(res, 401, { error: { code: "UNAUTHORIZED", message: "bad token" } });
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/health") {
      return send(res, 200, { ok: true, version: "0.1.0-dev", device_ready: state.deviceReady });
    }

    if (req.method === "POST" && path === "/shutdown") {
      send(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 30);
      return;
    }

    if (req.method === "GET" && path === "/search") {
      const query = (url.searchParams.get("q") ?? "").trim();
      const page = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const items = query && !"藏书票样章".includes(query) && !query.includes("藏书")
        ? [BOOK]
        : [BOOK];
      return send(res, 200, { total: items.length, items: items.slice((page - 1) * limit, page * limit) });
    }

    if (req.method === "POST" && path === "/resolve") {
      const body = await readJson(req);
      const match = /(\d{6,})/.exec(String(body.url ?? ""));
      return send(res, 200, { bookId: match ? match[1] : BOOK.id });
    }

    if (req.method === "GET" && path === "/book/" + BOOK.id) {
      return send(res, 200, { ...BOOK, book_id: BOOK.id });
    }

    if (req.method === "GET" && path === `/book/${BOOK.id}/chapters`) {
      return send(res, 200, {
        total: CHAPTERS.length,
        items: CHAPTERS.map((chapter, index) => ({ id: chapter.id, title: chapter.title, index })),
      });
    }

    if (req.method === "GET" && path === `/book/${BOOK.id}/comments`) {
      const page = Number(url.searchParams.get("page") ?? 1);
      const perPage = 3;
      const start = (page - 1) * perPage;
      return send(res, 200, {
        total: COMMENTS.length,
        items: COMMENTS.slice(start, start + perPage),
      });
    }

    const chapterMatch = /^\/chapter\/([^/]+)$/.exec(path);
    if (req.method === "GET" && chapterMatch) {
      // 测试用：第一次请求返回 DEVICE_EXPIRED，落一个标记；
      // 插件重启侧车后（同一个 data-dir）标记还在，第二次就能成功。
      if (args["expire-once"]) {
        const marker = join(dataDir || ".", "expired.marker");
        if (!existsSync(marker)) {
          writeFileSync(marker, "1");
          return send(res, 409, {
            error: { code: "DEVICE_EXPIRED", message: "simulated expired device" },
          });
        }
      }
      const chapter = CHAPTERS.find((candidate) => candidate.id === chapterMatch[1]);
      if (!chapter) {
        return send(res, 404, { error: { code: "NOT_FOUND", message: "chapter not found" } });
      }
      const index = CHAPTERS.indexOf(chapter);
      return send(res, 200, {
        id: chapter.id,
        book_id: BOOK.id,
        title: chapter.title,
        index,
        paragraphs: chapter.paragraphs,
        prev: index > 0 ? CHAPTERS[index - 1].id : null,
        next: index < CHAPTERS.length - 1 ? CHAPTERS[index + 1].id : null,
      });
    }

    return send(res, 404, { error: { code: "NOT_FOUND", message: `no route ${req.method} ${path}` } });
  } catch (err) {
    return send(res, 500, { error: { code: "UPSTREAM_TIMEOUT", message: String(err) } });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stderr.write(`fqsidecar(dev): listening on 127.0.0.1:${port}\n`);
});

// 三重退出保障之二：stdin EOF 立即退出。
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));

// 三重退出保障之三：父进程存活检查。
if (parentPid) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, parentCheckMs).unref();
}

// 闲置退出。
setInterval(() => {
  if (Date.now() - state.lastRequest > idleMs) process.exit(0);
}, Math.max(250, Math.min(5_000, idleMs))).unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => process.exit(0));
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
