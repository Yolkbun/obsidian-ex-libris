import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ROOT, waitFor } from "./harness.mjs";

const EXE = path.join(ROOT, "bin", "fqsidecar.exe");

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

// 这个文件只测「真实产物」的生命周期，不触网；没有 exe 时整组跳过。
test("真实 fqsidecar.exe：鉴权、health、stdin EOF 退出", { skip: !existsSync(EXE) }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ex-libris-real-"));
  const port = await freePort();
  const token = "real-token";
  const child = spawn(EXE, ["--port", String(port), "--data-dir", dir], {
    env: { ...process.env, FQ_TOKEN: token },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  try {
    await waitFor(
      () =>
        fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-FQ-Token": token } })
          .then((response) => response.ok)
          .catch(() => false),
      { timeout: 15_000, interval: 100 },
    );

    const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(unauthorized.status, 401);

    const health = await (
      await fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-FQ-Token": token } })
    ).json();
    assert.equal(health.ok, true);
    assert.equal(health.provider, "fanqie");

    child.stdin.end();
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0, "stdin EOF 后应立即退出");
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
