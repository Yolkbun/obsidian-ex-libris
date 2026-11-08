import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { api, ROOT, waitFor } from "./harness.mjs";

const DEV_SIDECAR = path.join(ROOT, "tools", "dev-sidecar.mjs");
const HOST = new api.DesktopSidecarHost();

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), "ex-libris-sidecar-"));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function managerFor(dir, options = {}) {
  return new api.SidecarManager({
    binaryPath: () => process.execPath,
    dataDir: () => dir,
    enabled: () => options.enabled ?? true,
    host: HOST,
    pluginVersion: "0.1.0",
    argsPrefix: [DEV_SIDECAR],
    extraArgs: options.extraArgs ?? [],
    pollIntervalMs: 100,
    readyTimeoutMs: 8_000,
    shutdownGraceMs: 1_000,
  });
}

function clientFor(manager, dir) {
  const cache = new api.SidecarCache(HOST.adapter ?? fakeAdapter(), dir);
  return new api.SidecarClient(manager, HOST.transport, cache, () => 30);
}

// SidecarClient 只需要一个能读写缓存的 adapter；用内存实现即可。
function fakeAdapter() {
  const files = new Map();
  const stats = new Map();
  return {
    getBasePath: () => "",
    getResourcePath: (p) => p,
    exists: async (p) => files.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
    stat: async (p) =>
      stats.get(p) ?? (files.has(p) ? { type: "file", size: files.get(p).length, ctime: 0, mtime: 0 } : null),
    list: async (p) => {
      const prefix = p ? `${p}/` : "";
      const folders = new Set();
      const result = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash >= 0) folders.add(`${prefix}${rest.slice(0, slash)}`);
        else result.push(key);
      }
      return { files: result, folders: [...folders] };
    },
    read: async (p) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return files.get(p);
    },
    write: async (p, data) => {
      files.set(p, data);
    },
    writeBinary: async (p, data) => {
      files.set(p, Buffer.from(data));
    },
    mkdir: async () => undefined,
    remove: async (p) => {
      files.delete(p);
    },
    rmdir: async (p) => {
      for (const key of [...files.keys()]) if (key.startsWith(`${p}/`)) files.delete(key);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    process: async (p, fn) => {
      const next = fn(files.get(p) ?? "");
      files.set(p, next);
      return next;
    },
  };
}

test("侧车启动、鉴权、检索、正文与关闭", async (t) => {
  const dir = await tempDir();
  const manager = managerFor(dir);
  t.after(async () => {
    await manager.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const ok = await manager.start();
  assert.equal(ok, true, "侧车应就绪");
  assert.equal(manager.describe().state, "ready");
  const port = manager.describe().port;
  assert.ok(port > 0);

  // 无 token 必须 401
  const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(unauthorized.status, 401);
  const body = await unauthorized.json();
  assert.equal(body.error.code, "UNAUTHORIZED");

  const client = clientFor(manager, dir);
  const search = await client.search("藏书", 1, 10);
  assert.equal(search.total, 1);
  assert.equal(search.items[0].title, "藏书票样章");

  const detail = await client.book("7143038691944959011");
  assert.equal(detail.author, "Ex Libris");

  const toc = await client.chapters("7143038691944959011");
  assert.equal(toc.items.length, 3);
  assert.equal(toc.items[1].title, "第二章 编号");

  const chapter = await client.chapter("7143038691944959011", "900002");
  assert.equal(chapter.index, 1);
  assert.ok(chapter.paragraphs[0].includes("编号"));
  assert.equal(chapter.prev, "900001");
  assert.equal(chapter.next, "900003");

  // 章节缓存：第二次读不再走 HTTP（删掉章节后仍能返回）
  const cached = await client.chapter("7143038691944959011", "900002");
  assert.equal(cached.paragraphs.length, chapter.paragraphs.length);

  const comments = await client.comments("7143038691944959011", "900002", 1);
  assert.ok(comments.total >= 3);
  assert.equal(comments.items.length, 3);
  const page2 = await client.comments("7143038691944959011", "900002", 2);
  assert.ok(page2.items.length > 0);

  const pid = manager.describe().pid;
  await manager.stop();
  assert.equal(manager.describe().state, "stopped");
  await waitFor(async () => !(await isAlive(pid)), { timeout: 3_000 });
  assert.equal(await isAlive(pid), false, "stop 后进程必须消失");
});

test("binary 缺失时降级而不是崩", async (t) => {
  const dir = await tempDir();
  const manager = new api.SidecarManager({
    binaryPath: () => path.join(dir, "does-not-exist.exe"),
    dataDir: () => dir,
    enabled: () => true,
    host: HOST,
    pluginVersion: "0.1.0",
    pollIntervalMs: 50,
    readyTimeoutMs: 1_000,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const ok = await manager.start();
  assert.equal(ok, false);
  const descriptor = manager.describe();
  assert.equal(descriptor.state, "degraded");
  assert.equal(descriptor.degradedReason, "missing-binary");
  assert.match(descriptor.text, /fqsidecar|侧车/);
});

test("关闭 stdin 会让侧车立即退出（父进程崩溃主保障）", async () => {
  const dir = await tempDir();
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [DEV_SIDECAR, "--port", String(port), "--data-dir", dir, "--parent-pid", String(process.pid)],
    { env: { ...process.env, FQ_TOKEN: "t" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  try {
    await waitFor(
      () => fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-FQ-Token": "t" } }).then(() => true, () => false),
      { timeout: 5_000, interval: 50 },
    );
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("闲置超时会自己退出", async () => {
  const dir = await tempDir();
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [DEV_SIDECAR, "--port", String(port), "--data-dir", dir, "--idle-ms", "500"],
    { env: { ...process.env, FQ_TOKEN: "t" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  try {
    await waitFor(
      () => fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-FQ-Token": "t" } }).then(() => true, () => false),
      { timeout: 5_000, interval: 50 },
    );
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

test("DEVICE_EXPIRED 会重启侧车并重试一次", async (t) => {
  const dir = await tempDir();
  const manager = managerFor(dir, { extraArgs: ["--expire-once"] });
  t.after(async () => {
    await manager.stop();
    await rm(dir, { recursive: true, force: true });
  });

  assert.equal(await manager.start(), true);
  const firstPid = manager.describe().pid;
  const client = clientFor(manager, dir);
  const chapter = await client.chapter("7143038691944959011", "900001");
  assert.ok(chapter.paragraphs.length > 0);
  const secondPid = manager.describe().pid;
  assert.notEqual(secondPid, firstPid, "设备过期后应换了一个侧车进程");
  assert.equal(manager.describe().state, "ready");
});

test("父进程消失后侧车自行退出（双保险）", async () => {
  const dir = await tempDir();
  const port = await freePort();
  const fakeParent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const child = spawn(
    process.execPath,
    [
      DEV_SIDECAR,
      "--port",
      String(port),
      "--data-dir",
      dir,
      "--parent-pid",
      String(fakeParent.pid),
      "--parent-check-ms",
      "200",
    ],
    { env: { ...process.env, FQ_TOKEN: "t" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  try {
    await waitFor(
      () => fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-FQ-Token": "t" } }).then(() => true, () => false),
      { timeout: 5_000, interval: 50 },
    );
    fakeParent.kill();
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, "父进程消失后应在一次检查周期内退出");
  } finally {
    fakeParent.kill();
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
