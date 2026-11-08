/**
 * 通过 Obsidian 的 remote debugging 抓真实界面截图。
 * 仅开发/文档用，不参与插件运行。
 */
import fs from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.argv[2] ?? 9222);
const OUT = "D:/Ex Libris/docs/screenshots";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json`);
  return response.json();
}

const list = await targets();
const page = list.find((target) => target.type === "page" && target.url.startsWith("app://"));
if (!page) {
  console.error("no obsidian page target", list.map((t) => `${t.type} ${t.url}`));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let seq = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
};

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `${result.exceptionDetails.text}: ${result.exceptionDetails.exception?.description ?? ""}`,
    );
  }
  return result.result.value;
}

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, name);
  await fs.writeFile(file, Buffer.from(data, "base64"));
  console.log("saved", file);
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false,
});

// 1. 书架
await evaluate("app.commands.executeCommandById('ex-libris:open-shelf')");
await sleep(1500);
await shot("ui-shelf.png");

// 2. 从链接加入
await evaluate("app.commands.executeCommandById('ex-libris:add-from-url')");
await sleep(800);
await shot("ui-add-url.png");
await evaluate("document.querySelector('.modal-close-button')?.click() ?? document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
await sleep(400);

// 3. 搜索番茄
await evaluate("app.commands.executeCommandById('ex-libris:search-fanqie')");
await sleep(700);
await evaluate(`(() => {
  const input = document.querySelector('.modal input[type="text"]');
  if (!input) return 'no input';
  input.value = '十日终焉';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const button = [...document.querySelectorAll('.modal button')].find((b) => b.textContent?.includes('搜索'));
  button?.click();
  return 'searched';
})()`);
await sleep(5000);
await shot("ui-search.png");
await evaluate("document.querySelector('.modal-close-button')?.click() ?? document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
await sleep(400);

// 4. 阅读器
await evaluate("app.plugins.plugins['ex-libris'].activateReader('7143038691944959011')");
await sleep(5000);
await shot("ui-reader.png");

// 5. 摘录（直接调用插件自己的摘录流程，目标固定到摘录本）
await evaluate(`(async () => {
  const plugin = app.plugins.plugins['ex-libris'];
  const file = app.vault.getAbstractFileByPath('Notes/摘录本.md');
  plugin.chooseExcerptTargetNote = async () => file;
  await plugin.handleExcerpt({
    bookId: '7143038691944959011',
    bookTitle: '十日终焉',
    chapterId: '7173216089122439711',
    chapterTitle: '第1章 空屋',
    chapterIndex: 0,
    text: '一个老旧的钨丝灯被黑色的电线悬在屋子中央，闪烁着昏暗的光芒。'
  });
  await app.workspace.getLeaf('tab').openFile(file);
  return 'ok';
})()`);
await sleep(1200);
await shot("ui-excerpt.png");

// 6. 设置页
await evaluate("app.setting.open(); app.setting.openTabById('ex-libris')");
await sleep(1200);
await shot("ui-settings.png");

ws.close();
console.log("done");
