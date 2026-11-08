import { App, Modal } from "obsidian";

export const SIDECAR_RELEASE_URL =
  "https://github.com/Yolkbun/ex-libris-sidecar/releases/tag/sidecar-0.1.0";

/**
 * 首次运行的侧车安装引导。
 *
 * 社区版插件只包含 main.js / manifest / styles，Obsidian 安装器不会安装侧车。
 * 这里只给出手动步骤与下载链接，绝不自动下载或执行安装（社区政策禁止自更新依赖）。
 */
export class SidecarGuideModal extends Modal {
  private dontShowAgain = false;

  constructor(
    app: App,
    private readonly pluginDir: string,
    private readonly done: (dontShowAgain: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const doc = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    this.contentEl.addClass("ex-libris-guide-modal");

    const title = doc.createElement("h3");
    title.textContent = "番茄阅读：需要手动安装侧车";

    const intro = doc.createElement("p");
    intro.textContent =
      "Obsidian 的插件安装器只会放 main.js、manifest.json、styles.css。侧车是独立的本机程序，需要你手动放一次。插件不会自动下载、也不会自动安装它。";

    const steps = doc.createElement("ol");
    steps.className = "ex-libris-guide-steps";
    const stepTexts = [
      "打开 Release 页面，下载 fqsidecar.exe（约 4.9 MB）。",
      "放进插件目录的 bin/ 子目录：",
      `${this.pluginDir}/bin/fqsidecar.exe`,
      "回到 设置 → Ex Libris，点“重启并检查”，显示“侧车就绪”即可。",
    ];
    for (const text of stepTexts) {
      const item = doc.createElement("li");
      const code = doc.createElement("code");
      code.textContent = text;
      item.append(code);
      steps.append(item);
    }

    const note = doc.createElement("p");
    note.className = "ex-libris-guide-note";
    note.textContent =
      "不装侧车也能用：书架、豆瓣条目、摘录、阅读进度都正常，只有番茄阅读会提示不可用。";

    const actions = doc.createElement("div");
    actions.className = "ex-libris-guide-actions";

    const download = doc.createElement("button");
    download.className = "mod-cta";
    download.textContent = "打开下载页";
    download.addEventListener("click", () => {
      window.open(SIDECAR_RELEASE_URL, "_blank");
    });

    const later = doc.createElement("button");
    later.textContent = "稍后";
    later.addEventListener("click", () => this.close());

    actions.append(download, later);

    const dismiss = doc.createElement("label");
    dismiss.className = "ex-libris-guide-dismiss";
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = false;
    checkbox.addEventListener("change", () => {
      this.dontShowAgain = checkbox.checked;
    });
    const dismissText = doc.createElement("span");
    dismissText.textContent = "不再提示（可在设置里重新打开）";
    dismiss.append(checkbox, dismissText);

    this.contentEl.append(title, intro, steps, note, actions, dismiss);
  }

  override onClose(): void {
    this.done(this.dontShowAgain);
  }
}
