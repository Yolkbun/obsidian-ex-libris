import { App, Modal, Notice } from "obsidian";

/**
 * 粘贴链接加入书架。解析交给侧车（/resolve），这里只负责输入与进度。
 */
export class AddFromUrlModal extends Modal {
  private input: HTMLInputElement | null = null;
  private statusEl: HTMLElement | null = null;
  private busy = false;

  constructor(
    app: App,
    private readonly submit: (url: string) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const doc = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    const title = doc.createElement("h3");
    title.textContent = "从链接加入书架";
    const hint = doc.createElement("p");
    hint.textContent = "粘贴 fanqienovel.com 的书籍链接，例如 https://fanqienovel.com/page/7143038691944959011";
    hint.setCssStyles({ fontSize: "0.82em", color: "var(--text-muted)" });

    this.input = doc.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "https://fanqienovel.com/page/…";
    this.input.setCssStyles({ width: "100%" });
    this.input.addEventListener("input", () => {
      if (this.input) this.url = this.input.value;
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.run();
      }
    });

    this.statusEl = doc.createElement("div");
    this.statusEl.setCssStyles({
      marginTop: "10px",
      fontSize: "0.82em",
      color: "var(--text-muted)",
    });

    const action = doc.createElement("button");
    action.className = "mod-cta";
    action.textContent = "解析并加入";
    action.setCssStyles({ marginTop: "12px" });
    action.addEventListener("click", () => void this.run());

    this.contentEl.append(title, hint, this.input, this.statusEl, action);
    this.input.focus();
  }

  private url = "";

  private async run(): Promise<void> {
    if (this.busy) return;
    const raw = (this.input?.value ?? this.url).trim();
    const url = extractUrl(raw);
    if (!url) {
      new Notice("链接格式不对，需要 http(s) 地址。");
      return;
    }
    this.busy = true;
    if (this.statusEl) this.statusEl.textContent = "正在向番茄解析…";
    try {
      await this.submit(url);
      this.close();
    } catch (err) {
      if (this.statusEl) this.statusEl.textContent = `加入失败：${describeError(err)}`;
      new Notice(`加入失败：${describeError(err)}`);
    } finally {
      this.busy = false;
    }
  }
}

export function extractUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/.exec(text.trim());
  return match ? match[0] : null;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
