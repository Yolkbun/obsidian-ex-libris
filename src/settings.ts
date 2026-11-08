import { App, PluginSettingTab, Setting } from "obsidian";
import type ExLibrisPlugin from "./main";
import type { ShelfPreset, TypeFilter } from "./domain/types";

export interface ExLibrisSettings {
  /** 书架条目根目录（番茄轻笔记写在这里） */
  libraryRoot: string;
  /** 封面默认宽度，px */
  coverWidth: number;
  showProgress: boolean;
  /** 网格间距，px */
  gap: number;
  /** 自动清理天数；0 表示不自动清理 */
  cacheDays: number;
  /** 是否启用番茄侧车 */
  sidecarEnabled: boolean;
  /** 自定义侧车可执行文件路径；空表示使用插件目录下 bin/fqsidecar.exe */
  sidecarPath: string;
  /** 目录刷新节流，分钟 */
  tocRefreshMinutes: number;
  /** 导出目录 */
  exportFolder: string;
  /** 豆瓣封面本地化开关（离线可读） */
  cacheRemoteCovers: boolean;
  /** 启动 Obsidian 后自动打开书架 */
  openShelfOnStartup: boolean;
  /** 用户是否关掉过“侧车安装引导” */
  sidecarGuideDismissed: boolean;
  /** 书架初始状态 */
  lastShelf: { preset: string; filter: TypeFilter };
}

export const DEFAULT_SETTINGS: ExLibrisSettings = {
  libraryRoot: "Library",
  coverWidth: 140,
  showProgress: true,
  gap: 18,
  cacheDays: 7,
  sidecarEnabled: true,
  sidecarPath: "",
  tocRefreshMinutes: 30,
  exportFolder: "Library/exports",
  cacheRemoteCovers: true,
  openShelfOnStartup: false,
  sidecarGuideDismissed: false,
  lastShelf: { preset: "all", filter: "all" },
};

export const DEFAULT_PRESETS: ShelfPreset[] = [
  { id: "all", name: "全部", kind: "all" },
  { id: "reading", name: "在读", kind: "reading" },
  { id: "finished-this-year", name: "今年读完", kind: "finished-this-year" },
  { id: "want", name: "想读", kind: "want" },
];

export class ExLibrisSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ExLibrisPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Ex Libris · 藏书票").setHeading();

    new Setting(containerEl)
      .setName("书架根目录")
      .setDesc("番茄轻笔记写到 <根目录>/book/<书名>.md；豆瓣笔记不动。")
      .addText((text) =>
        text
          .setPlaceholder("Library")
          .setValue(this.plugin.settings.libraryRoot)
          .onChange(async (value) => {
            this.plugin.settings.libraryRoot = value.trim() || "Library";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("封面宽度")
      .setDesc("书架和 Bases 视图的默认封面宽度（100–220 px）。")
      .addSlider((slider) =>
        slider
          .setLimits(100, 220, 10)
          .setValue(this.plugin.settings.coverWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.coverWidth = value;
            await this.plugin.saveSettings();
            this.plugin.refreshShelves();
          }),
      );

    new Setting(containerEl)
      .setName("显示阅读进度")
      .setDesc("在封面下方画一条 2px 进度条。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showProgress).onChange(async (value) => {
          this.plugin.settings.showProgress = value;
          await this.plugin.saveSettings();
          this.plugin.refreshShelves();
        }),
      );

    new Setting(containerEl)
      .setName("缓存自动清理")
      .setDesc("启动时若距上次清理超过设定天数，清空 cache/chapters 与 cache/covers。0 为关闭。")
      .addSlider((slider) =>
        slider
          .setLimits(0, 30, 1)
          .setValue(this.plugin.settings.cacheDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.cacheDays = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("远程封面本地化")
      .setDesc("把豆瓣/番茄的远程封面下载到插件缓存，断网也能显示。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.cacheRemoteCovers).onChange(async (value) => {
          this.plugin.settings.cacheRemoteCovers = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("导出目录")
      .setDesc("显式导出章节时正文才会落盘到这里。")
      .addText((text) =>
        text.setValue(this.plugin.settings.exportFolder).onChange(async (value) => {
          this.plugin.settings.exportFolder = value.trim() || "Library/exports";
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("书架").setHeading();

    new Setting(containerEl)
      .setName("启动时打开书架")
      .setDesc("Obsidian 启动完成后自动打开 Ex Libris 书架视图。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openShelfOnStartup).onChange(async (value) => {
          this.plugin.settings.openShelfOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("番茄侧车").setHeading();

    const status = containerEl.createDiv({ cls: "ex-libris-settings-status" });
    this.renderSidecarStatus(status);

    new Setting(containerEl)
      .setName("启用番茄侧车")
      .setDesc("无界面本机进程，只监听 127.0.0.1；不启动时书架照常可用，只影响番茄入口。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidecarEnabled).onChange(async (value) => {
          this.plugin.settings.sidecarEnabled = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.restartSidecar();
          else await this.plugin.stopSidecar();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("侧车路径覆盖")
      .setDesc("留空使用插件目录下 bin/fqsidecar.exe。")
      .addText((text) =>
        text.setValue(this.plugin.settings.sidecarPath).onChange(async (value) => {
          this.plugin.settings.sidecarPath = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("侧车安装引导")
      .setDesc("社区版不会自动安装侧车；这里可以重新查看手动安装步骤。")
      .addButton((button) =>
        button.setButtonText("查看指南").onClick(() => {
          this.plugin.showSidecarGuide(true);
        }),
      );

    new Setting(containerEl)
      .setName("不再自动提示安装侧车")
      .setDesc("首次运行且侧车缺失时会弹一次安装引导；勾选后不再自动弹出。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidecarGuideDismissed).onChange(async (value) => {
          this.plugin.settings.sidecarGuideDismissed = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("检查侧车")
      .setDesc("重启侧车并读取 /health。")
      .addButton((button) =>
        button.setButtonText("重启并检查").onClick(async () => {
          await this.plugin.restartSidecar();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("目录刷新间隔")
      .setDesc("同一本书的目录缓存有效时间；0 表示每次打开都重新拉取。")
      .addSlider((slider) =>
        slider
          .setLimits(0, 120, 5)
          .setValue(this.plugin.settings.tocRefreshMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.tocRefreshMinutes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("缓存").setHeading();

    const cacheInfo = containerEl.createDiv({ cls: "ex-libris-settings-status" });
    cacheInfo.setText("正在统计缓存体积…");
    void this.plugin.cacheCleaner
      .size()
      .then((bytes) => cacheInfo.setText(`当前缓存：${formatBytes(bytes)}`))
      .catch(() => cacheInfo.setText("缓存体积统计失败"));

    new Setting(containerEl)
      .setName("立即清理缓存")
      .setDesc("只清 cache/，绝不动 data/、笔记与封面附件。")
      .addButton((button) =>
        button.setButtonText("清理").onClick(async () => {
          await this.plugin.cacheCleaner.clearAll();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName("本地化所有远程封面")
      .setDesc("把书架上还没落地的远程封面下载到缓存。")
      .addButton((button) =>
        button.setButtonText("开始").onClick(async () => {
          await this.plugin.localizeAllCovers();
          this.display();
        }),
      );
  }

  private renderSidecarStatus(el: HTMLElement): void {
    const state = this.plugin.sidecar.describe();
    el.setText(state.text);
    if (state.stderrTail.length > 0) {
      const pre = el.createEl("pre", { cls: "ex-libris-sidecar-log" });
      pre.setText(state.stderrTail.join("\n"));
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
