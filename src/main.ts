import {
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import {
  DEFAULT_PRESETS,
  DEFAULT_SETTINGS,
  ExLibrisSettingTab,
  type ExLibrisSettings,
} from "./settings";
import type { BookBrief, ShelfItem, ShelfPreset } from "./domain/types";
import { AtomicJsonStore } from "./util/atomic-json";
import { joinPath } from "./util/paths";
import { CacheCleaner, type MetaData } from "./cache/cleaner";
import { CoverResolver } from "./library/cover";
import { EntryIndex, isReading } from "./library/entries";
import {
  createFanqieNote,
  findNoteFile,
  writeReadingSummary,
  writeUnreadCount,
} from "./library/fanqie-note";
import { exportChapterFile } from "./library/exporter";
import { ProgressStore } from "./progress/store";
import { createSidecarHost, type SidecarHost } from "./sidecar/host";
import { SidecarClient, SidecarError } from "./sidecar/client";
import { SidecarCache } from "./sidecar/cache";
import { SidecarManager } from "./sidecar/manager";
import { LibraryView, VIEW_TYPE_SHELF } from "./views/library-view";
import { ReaderView, VIEW_TYPE_READER, resolveChapterParam, type ExcerptPayload, type ReadingSummary } from "./views/reader-view";
import { registerBasesShelf } from "./views/bases-view";
import type { ShelfUiDeps } from "./views/deps";
import { AddFromUrlModal, describeError } from "./actions/add-from-url";
import { FanqieSearchModal } from "./actions/search-modal";
import { PresetModal } from "./actions/note-picker";
import { pickNote } from "./actions/note-picker";
import {
  buildExcerptBlock,
  chooseExcerptTarget,
  EXCERPT_MAX_CHARS,
  insertExcerpt,
} from "./actions/export-excerpt";
import { linkDouban } from "./actions/link-douban";

export default class ExLibrisPlugin extends Plugin {
  override settings: ExLibrisSettings = { ...DEFAULT_SETTINGS };
  /** 首次启动的异步初始化；测试可以 await，界面不用等。 */
  initialized: Promise<void> = Promise.resolve();
  meta!: AtomicJsonStore<MetaData>;
  covers!: CoverResolver;
  entries!: EntryIndex;
  progress!: ProgressStore;
  cacheCleaner!: CacheCleaner;
  sidecar!: SidecarManager;
  client!: SidecarClient;

  private metaStore!: AtomicJsonStore<MetaData>;
  private sidecarCache!: SidecarCache;
  private sidecarHost: SidecarHost = createSidecarHost();
  /** 仅测试/开发：用 node 跑 tools/dev-sidecar.mjs 时插入的参数 */
  sidecarArgsPrefix: string[] = [];
  private bootstrapped = false;
  private basesRegistered = false;
  private lastWarm = 0;
  private lastUnread = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposers: Array<() => void> = [];

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.ensureStores();
    this.registerViews();
    this.registerCommands();
    this.addRibbonIcon("library", "Ex Libris 书架", () => void this.activateShelf());
    this.addSettingTab(new ExLibrisSettingTab(this.app, this));

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile && file.extension === "md") this.entries.refreshFile(file);
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("deleted", (file) => {
        if (file instanceof TFile) this.entries.removeFile(file.path);
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        void this.entries.rebuild().catch((err) => console.warn("[ex-libris] 重建书架失败", err));
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.scheduleRefresh()),
    );

    this.registerObsidianProtocolHandler("ex-libris", (params) => {
      void this.handleProtocol(params).catch((err) => {
        console.warn("[ex-libris] 回跳失败", err);
        new Notice(`回跳失败：${describeError(err)}`);
      });
    });

    this.app.workspace.onLayoutReady(() => {
      this.initialized = this.bootstrap();
    });
  }

  override onunload(): void {
    void this.dispose();
  }

  /** 测试与卸载共用：刷盘、停侧车、撤监听。 */
  async dispose(): Promise<void> {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    try {
      await this.progress?.flush();
    } catch {
      /* ignore */
    }
    try {
      const descriptor = this.sidecar?.describe();
      if (descriptor && descriptor.stderrTail.length > 0) {
        this.metaStore.update((value) => {
          value.sidecarLogTail = descriptor.stderrTail.slice(-20);
        });
        await this.metaStore.save();
      }
    } catch {
      /* ignore */
    }
    try {
      await this.sidecar?.stop();
    } catch {
      /* ignore */
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<ExLibrisSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded ?? {}) };
    this.settings.libraryRoot = this.settings.libraryRoot?.trim() || "Library";
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private ensureStores(): void {
    const base = this.pluginDirRelative();
    const dataDir = joinPath(base, "data");
    const cacheDir = joinPath(base, "cache");
    const dataDirAbsolute = joinPath(this.pluginDirAbsolute(), "data");

    this.metaStore = new AtomicJsonStore<MetaData>(
      this.app.vault.adapter,
      joinPath(dataDir, "meta.json"),
      () => ({ lastCleanup: 0, presets: DEFAULT_PRESETS.map((preset) => ({ ...preset })) }),
    );
    this.meta = this.metaStore;

    this.covers = new CoverResolver(
      this.app,
      joinPath(cacheDir, "covers"),
      joinPath(cacheDir, "covers", "index.json"),
    );
    this.entries = new EntryIndex(this.app, this.covers);
    this.progress = new ProgressStore(
      this.app.vault.adapter,
      joinPath(dataDir, "progress.json"),
    );
    this.cacheCleaner = new CacheCleaner(
      this.app.vault.adapter,
      cacheDir,
      this.metaStore,
      () => this.settings.cacheDays,
    );
    this.sidecarCache = new SidecarCache(this.app.vault.adapter, cacheDir);
    this.sidecar = new SidecarManager({
      binaryPath: () => this.sidecarBinary(),
      dataDir: () => dataDirAbsolute,
      enabled: () => this.settings.sidecarEnabled,
      host: this.sidecarHost,
      pluginVersion: this.manifest.version,
      argsPrefix: this.sidecarArgsPrefix,
    });
    this.client = new SidecarClient(
      this.sidecar,
      this.sidecarHost.transport,
      this.sidecarCache,
      () => this.settings.tocRefreshMinutes,
    );
    this.disposers.push(
      this.sidecar.onChange(() => {
        this.refreshShelves();
        const descriptor = this.sidecar.describe();
        this.metaStore.update((value) => {
          value.sidecarState = descriptor.state;
          value.sidecarReason = descriptor.degradedReason;
          if (descriptor.stderrTail.length > 0) {
            value.sidecarLogTail = descriptor.stderrTail.slice(-20);
          }
        });
        void this.metaStore.save().catch(() => undefined);
      }),
    );
  }

  private async bootstrap(): Promise<void> {
    if (this.bootstrapped) return;
    this.bootstrapped = true;
    try {
      await this.metaStore.load();
      await this.covers.init();
      await this.progress.init();
      await this.entries.init();
      await this.cacheCleaner.maybeCleanupOnStartup();
      await this.covers.init();
      this.refreshShelves();
      if (this.settings.sidecarEnabled) {
        void this.sidecar
          .start()
          .then(() => {
            this.refreshShelves();
            return this.refreshUnreadCounts();
          })
          .catch((err) => console.warn("[ex-libris] 侧车启动流程失败", err));
      }
      if (this.settings.openShelfOnStartup) {
        await this.activateShelf();
      }
      this.metaStore.update((value) => {
        value.lastBootAt = Date.now();
        value.lastBootVersion = this.manifest.version;
        value.basesRegistered = this.basesRegistered;
        value.sidecarState = this.sidecar.describe().state;
        value.sidecarReason = this.sidecar.describe().degradedReason;
      });
      await this.metaStore.save();
      void this.warmCovers();
    } catch (err) {
      console.error("[ex-libris] 初始化失败", err);
      new Notice("Ex Libris 初始化失败，详见控制台。");
    }
  }

  private registerViews(): void {
    this.registerView(VIEW_TYPE_SHELF, (leaf) => new LibraryView(leaf, this.shelfDeps()));
    this.registerView(
      VIEW_TYPE_READER,
      (leaf) =>
        new ReaderView(leaf, {
          client: this.client,
          progress: this.progress,
          entries: this.entries,
          noteTitle: (bookId) => this.entries.byBookId(bookId)?.title,
          writeSummary: (summary) => this.writeSummary(summary),
          exportChapter: (bookId, chapterId) => this.exportChapterById(bookId, chapterId),
          requestExcerpt: (payload) => this.handleExcerpt(payload),
        }),
    );

    this.basesRegistered = registerBasesShelf(this, {
      entries: this.entries,
      covers: this.covers,
      settings: () => this.settings,
      onOpen: (item) => void this.openItem(item),
    });
  }

  private shelfDeps(): ShelfUiDeps {
    return {
      entries: this.entries,
      covers: this.covers,
      settings: () => this.settings,
      presets: () => this.presets(),
      addPreset: () => this.promptAddPreset(),
      removePreset: (id) => this.removePreset(id),
      isSidecarReady: () => this.sidecar.isReady,
      sidecarText: () => this.sidecar.describe().text,
      openItem: (item) =>
        void this.openItem(item).catch((err) => {
          console.warn("[ex-libris] 打开条目失败", err);
          new Notice(`打开失败：${describeError(err)}`);
        }),
      openReader: (bookId, chapterId) => this.activateReader(bookId, chapterId),
      openNote: (item) =>
        void this.openNote(item).catch((err) => {
          console.warn("[ex-libris] 打开笔记失败", err);
          new Notice(`打开失败：${describeError(err)}`);
        }),
      linkDouban: (item) => linkDouban(this.app, this.entries, item),
      restartSidecar: () => this.restartAndReport(),
      refreshUnread: () => this.refreshUnreadCounts(),
    };
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-shelf",
      name: "打开书架",
      callback: () => void this.activateShelf(),
    });

    this.addCommand({
      id: "add-from-url",
      name: "从链接加入书架",
      callback: () => {
        new AddFromUrlModal(this.app, (url) => this.addFromUrl(url)).open();
      },
    });

    this.addCommand({
      id: "search-fanqie",
      name: "搜索番茄小说并加入",
      callback: () => {
        new FanqieSearchModal(this.app, this.client, (books) => this.addBooks(books)).open();
      },
    });

    this.addCommand({
      id: "export-chapter",
      name: "导出当前章节",
      checkCallback: (checking) => {
        const view = this.activeReader();
        if (!view) return false;
        if (!checking) void this.exportActiveChapter(view);
        return true;
      },
    });

    this.addCommand({
      id: "export-book",
      name: "导出整本番茄书",
      callback: () => void this.promptExportBook(),
    });

    this.addCommand({
      id: "link-douban",
      name: "把番茄书挂靠到豆瓣条目",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const item = this.entries.get(file.path);
        if (!item?.bookId) return false;
        if (!checking) void linkDouban(this.app, this.entries, item);
        return true;
      },
    });

    this.addCommand({
      id: "add-preset",
      name: "添加书架预设",
      callback: () => void this.promptAddPreset(),
    });

    this.addCommand({
      id: "restart-sidecar",
      name: "重启番茄侧车",
      callback: () => void this.restartAndReport(),
    });

    this.addCommand({
      id: "localize-covers",
      name: "本地化所有远程封面",
      callback: () => void this.localizeAllCovers(),
    });

    this.addCommand({
      id: "clear-cache",
      name: "清理章节与封面缓存",
      callback: () => void this.clearCache(),
    });

    this.addCommand({
      id: "rebuild-shelf",
      name: "重建书架缓存",
      callback: () => void this.rebuildShelf(),
    });
  }

  presets(): ShelfPreset[] {
    const stored = this.metaStore.get().presets;
    if (!Array.isArray(stored) || stored.length === 0) {
      return DEFAULT_PRESETS.map((preset) => ({ ...preset }));
    }
    const valid = stored.filter(
      (preset): preset is ShelfPreset =>
        Boolean(preset) &&
        typeof (preset as ShelfPreset).id === "string" &&
        typeof (preset as ShelfPreset).name === "string",
    );
    return valid.length > 0 ? valid : DEFAULT_PRESETS.map((preset) => ({ ...preset }));
  }

  private async promptAddPreset(): Promise<void> {
    await new Promise<void>((resolve) => {
      new PresetModal(this.app, (draft) => {
        const preset: ShelfPreset = {
          id: `custom-${Date.now().toString(36)}`,
          name: draft.name,
          kind: "custom",
          field: draft.field,
          value: draft.value,
        };
        this.metaStore.update((value) => {
          value.presets = [...this.presets(), preset];
        });
        void this.metaStore
          .save()
          .catch((err) => console.warn("[ex-libris] 保存预设失败", err));
        this.refreshShelves();
        resolve();
      }).open();
    });
  }

  /** 只允许删自定义预设；内置四个始终保留。 */
  async removePreset(id: string): Promise<void> {
    const preset = this.presets().find((candidate) => candidate.id === id);
    if (!preset || preset.kind !== "custom") return;
    this.metaStore.update((value) => {
      value.presets = this.presets().filter((candidate) => candidate.id !== id);
    });
    await this.metaStore.save();
    this.refreshShelves();
  }

  refreshShelves(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SHELF)) {
      const view = leaf.view;
      if (view instanceof LibraryView) view.refresh();
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.entries
        .rebuild()
        .then(() => this.refreshShelves())
        .catch((err) => console.warn("[ex-libris] 重建书架失败", err));
    }, 400);
  }

  private pluginDirRelative(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/ex-libris`;
  }

  private pluginDirAbsolute(): string {
    const adapter = this.app.vault.adapter as unknown as { getBasePath?: () => string };
    const base = adapter.getBasePath ? adapter.getBasePath() : "";
    return joinPath(base, this.pluginDirRelative());
  }

  private sidecarBinary(): string {
    if (this.settings.sidecarPath.trim()) return this.settings.sidecarPath.trim();
    return joinPath(this.pluginDirAbsolute(), "bin", "fqsidecar.exe");
  }

  private activeReader(): ReaderView | null {
    const view = this.app.workspace.getActiveViewOfType(ReaderView);
    return view instanceof ReaderView ? view : null;
  }

  // ---------------------------------------------------------------------
  // 打开 / 导航
  // ---------------------------------------------------------------------

  async activateShelf(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SHELF);
    const leaf = leaves[0] ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_SHELF,
      active: true,
      state: { preset: this.settings.lastShelf.preset, filter: this.settings.lastShelf.filter },
    });
    this.app.workspace.revealLeaf(leaf);
  }


  async activateReader(bookId: string, chapterId?: string): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_READER);
    const leaf = leaves[0] ?? this.app.workspace.getLeaf("tab");
    const state: Record<string, string> = { bookId };
    if (chapterId) state.chapterId = chapterId;
    await leaf.setViewState({ type: VIEW_TYPE_READER, active: true, state });
    this.app.workspace.revealLeaf(leaf);
  }

  async openItem(item: ShelfItem): Promise<void> {
    if (item.bookId) {
      if (!this.sidecar.isReady) {
        new Notice("番茄侧车未运行，先打开笔记；阅读器暂不可用。");
        await this.openNote(item);
        return;
      }
      await this.activateReader(item.bookId);
      return;
    }
    await this.openNote(item);
  }

  async openNote(item: ShelfItem): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) {
      new Notice("找不到对应的笔记文件。");
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  private async handleProtocol(params: Record<string, string>): Promise<void> {
    const book = (params.book ?? "").trim();
    if (!book) {
      new Notice("回跳链接缺少 book 参数。");
      return;
    }
    let chapterId: string | undefined;
    const chapterParam = params.chapter;
    if (chapterParam) {
      try {
        const toc = await this.client.chapters(book);
        chapterId = resolveChapterParam(chapterParam, toc.items);
      } catch (err) {
        new Notice(`无法定位章节：${describeError(err)}`);
        return;
      }
      if (!chapterId) {
        new Notice("链接里的章节在目录里找不到，已打开书籍第一页。");
      }
    }
    await this.activateReader(book, chapterId);
  }

  // ---------------------------------------------------------------------
  // 加入书架
  // ---------------------------------------------------------------------

  private async addFromUrl(url: string): Promise<void> {
    const resolved = await this.client.resolve(url);
    if (!resolved.bookId) throw new Error("没有解析出书籍 id");
    if (this.entries.hasBookId(resolved.bookId)) {
      new Notice("这本书已经在书架上了，没有覆盖。");
      return;
    }
    const detail = await this.client.book(resolved.bookId);
    const result = await createFanqieNote(this.app, this.settings, this.covers, detail);
    if (result.skipped) {
      new Notice("这本书已经在书架上了，没有覆盖。");
      return;
    }
    await this.entries.rebuild();
    this.refreshShelves();
    new Notice(`已加入《${detail.title}》。`);
  }

  private async addBooks(books: BookBrief[]): Promise<void> {
    let added = 0;
    let skipped = 0;
    let failed = 0;
    for (const brief of books) {
      if (this.entries.hasBookId(brief.id)) {
        skipped++;
        continue;
      }
      try {
        const detail = await this.client.book(brief.id);
        const result = await createFanqieNote(this.app, this.settings, this.covers, detail);
        if (result.skipped) skipped++;
        else added++;
      } catch (err) {
        failed++;
        console.warn(`[ex-libris] 加入《${brief.title}》失败`, err);
      }
    }
    await this.entries.rebuild();
    this.refreshShelves();
    const parts = [`新增 ${added} 本`];
    if (skipped > 0) parts.push(`跳过 ${skipped} 本（已在书架）`);
    if (failed > 0) parts.push(`失败 ${failed} 本`);
    new Notice(parts.join("，"));
  }

  // ---------------------------------------------------------------------
  // 阅读进度 / 摘要
  // ---------------------------------------------------------------------

  private async writeSummary(summary: ReadingSummary): Promise<void> {
    const file = findNoteFile(this.app, this.entries, summary.bookId);
    if (!file) return;
    await writeReadingSummary(this.app, file, {
      chapterTitle: summary.chapterTitle,
      chapterIndex: summary.chapterIndex,
      total: summary.total,
      percent: summary.percent,
      at: summary.at,
    });
    this.entries.refreshFile(file);
  }

  private async refreshUnreadCounts(): Promise<void> {
    if (!this.sidecar.isReady) return;
    const now = Date.now();
    if (now - this.lastUnread < 60_000) return;
    this.lastUnread = now;

    const fanqie = this.entries
      .all()
      .filter((item) => item.bookId && isReading(item.status) && item.type === "book")
      .slice(0, 20);

    for (const item of fanqie) {
      const bookId = item.bookId as string;
      try {
        const toc = await this.client.chapters(bookId);
        if (toc.items.length === 0) continue;
        const record = this.progress.get(bookId);
        let position = -1;
        if (record) {
          position = toc.items.findIndex((chapter) => chapter.id === record.chapterId);
          if (position < 0 && typeof record.chapterIndex === "number") position = record.chapterIndex;
        }
        const unread = position < 0 ? toc.items.length : Math.max(0, toc.items.length - position - 1);
        if (item.badge !== `未读 ${unread}`) {
          const file = this.app.vault.getAbstractFileByPath(item.path);
          if (file instanceof TFile) {
            await writeUnreadCount(this.app, file, unread);
            this.entries.refreshFile(file);
          }
        }
      } catch (err) {
        if (err instanceof SidecarError && err.code === "SIDECAR_UNAVAILABLE") return;
        console.warn(`[ex-libris] 刷新《${item.title}》未读数失败`, err);
      }
    }
  }

  // ---------------------------------------------------------------------
  // 摘录 / 导出
  // ---------------------------------------------------------------------

  /** 测试可覆盖的选择器（正常路径用 FuzzySuggestModal）。 */
  chooseExcerptTargetNote(): Promise<TFile | null> {
    return chooseExcerptTarget(this.app);
  }

  private async handleExcerpt(payload: ExcerptPayload): Promise<void> {
    const { markdown, truncated } = buildExcerptBlock({
      text: payload.text,
      bookTitle: payload.bookTitle,
      chapterTitle: payload.chapterTitle,
      bookId: payload.bookId,
      chapterIndex: payload.chapterIndex,
    });
    const target = await this.chooseExcerptTargetNote();
    if (!target) return;
    await insertExcerpt(this.app, target, markdown);
    if (truncated) {
      new Notice(`摘录超过 ${EXCERPT_MAX_CHARS} 字，已截断后插入。`);
    }
    new Notice(`摘录已写入《${target.basename}》。`);
  }

  private async exportActiveChapter(view: ReaderView): Promise<void> {
    const state = view.getState() as { bookId?: string; chapterId?: string };
    if (!state.bookId || !state.chapterId) {
      new Notice("阅读器里还没有打开章节。");
      return;
    }
    await this.exportChapterById(state.bookId, state.chapterId);
  }

  private async exportChapterById(bookId: string, chapterId: string): Promise<void> {
    const toc = await this.client.chapters(bookId);
    const meta = toc.items.find((chapter) => chapter.id === chapterId);
    const chapter = await this.client.chapter(bookId, chapterId);
    const bookTitle = this.entries.byBookId(bookId)?.title ?? `番茄书 ${bookId}`;
    const file = await exportChapterFile(
      this.app,
      this.settings,
      bookTitle,
      bookId,
      { ...chapter, title: meta?.title ?? chapter.title, index: meta?.index ?? chapter.index },
      meta,
    );
    new Notice(`已导出到 ${file.path}`);
  }

  private async promptExportBook(): Promise<void> {
    const fanqieFiles = this.entries
      .all()
      .filter((item) => item.bookId)
      .map((item) => this.app.vault.getAbstractFileByPath(item.path))
      .filter((file): file is TFile => file instanceof TFile);
    if (fanqieFiles.length === 0) {
      new Notice("书架里还没有番茄书。");
      return;
    }
    const target = await pickNote(this.app, fanqieFiles, "选择要导出的番茄书…");
    if (!target) return;
    const item = this.entries.get(target.path);
    if (!item?.bookId) return;
    await this.exportWholeBook(item.bookId, item.title);
  }

  private async exportWholeBook(bookId: string, title: string): Promise<void> {
    const toc = await this.client.chapters(bookId);
    const total = toc.items.length;
    if (total === 0) {
      new Notice("这本书没有目录，无法导出。");
      return;
    }
    const notice = new Notice(`正在导出《${title}》：0 / ${total}`, 0);
    let done = 0;
    let failed = 0;
    try {
      for (const meta of toc.items) {
        try {
          const chapter = await this.client.chapter(bookId, meta.id);
          await exportChapterFile(
            this.app,
            this.settings,
            title,
            bookId,
            { ...chapter, title: meta.title, index: meta.index },
            meta,
          );
        } catch (err) {
          failed++;
          console.warn(`[ex-libris] 导出《${meta.title}》失败`, err);
          if (err instanceof SidecarError && err.code === "SIDECAR_UNAVAILABLE") break;
        }
        done++;
        if (done % 5 === 0 || done === total) {
          notice.setMessage(`正在导出《${title}》：${done} / ${total}`);
        }
      }
    } finally {
      notice.hide();
    }
    new Notice(
      failed === 0
        ? `《${title}》导出完成，共 ${done} 章。`
        : `《${title}》导出结束：${done} 章，失败 ${failed} 章。`,
    );
  }

  // ---------------------------------------------------------------------
  // 封面 / 缓存 / 侧车
  // ---------------------------------------------------------------------

  async localizeAllCovers(): Promise<void> {
    if (!this.settings.cacheRemoteCovers) {
      new Notice("远程封面本地化已关闭。");
      return;
    }
    const urls = this.entries
      .all()
      .map((item) => (item.cover?.kind === "remote" ? item.cover.value : null))
      .filter((url): url is string => Boolean(url));
    if (urls.length === 0) {
      new Notice("没有需要本地化的远程封面。");
      return;
    }
    const notice = new Notice(`正在本地化封面：0 / ${urls.length}`, 0);
    try {
      const failures = await this.covers.localizeMany(urls, (done, total) => {
        if (done % 3 === 0 || done === total) {
          notice.setMessage(`正在本地化封面：${done} / ${total}`);
        }
      });
      await this.covers.init();
      this.refreshShelves();
      new Notice(failures === 0 ? "封面已全部本地化。" : `完成，${failures} 张失败。`);
    } finally {
      notice.hide();
    }
  }

  private async warmCovers(): Promise<void> {
    if (!this.settings.cacheRemoteCovers) return;
    const now = Date.now();
    if (now - this.lastWarm < 10 * 60_000) return;
    this.lastWarm = now;
    const urls = this.entries
      .all()
      .map((item) => (item.cover?.kind === "remote" ? item.cover.value : null))
      .filter((url): url is string => Boolean(url))
      .slice(0, 120);
    if (urls.length === 0) return;
    try {
      await this.covers.localizeMany(urls);
      await this.covers.init();
      this.refreshShelves();
    } catch (err) {
      console.warn("[ex-libris] 后台封面本地化失败", err);
    }
  }

  private async clearCache(): Promise<void> {
    const summary = await this.cacheCleaner.clearAll();
    await this.covers.init();
    this.refreshShelves();
    new Notice(`缓存已清理：${summary.files} 个文件。`);
  }

  private async rebuildShelf(): Promise<void> {
    await this.entries.rebuild();
    this.refreshShelves();
    new Notice(`书架已重建：${this.entries.all().length} 条。`);
  }

  async restartAndReport(): Promise<void> {
    const ok = await this.sidecar.restart();
    this.refreshShelves();
    if (ok) {
      const health = await this.sidecar.requestHealth();
      new Notice(
        health?.device_ready === false
          ? "侧车已就绪，但设备未注册（首次使用会尝试注册）。"
          : "侧车已就绪。",
      );
    } else {
      new Notice(`侧车不可用：${this.sidecar.describe().text}`);
    }
  }

  async restartSidecar(): Promise<void> {
    await this.sidecar.restart();
    this.refreshShelves();
  }

  async stopSidecar(): Promise<void> {
    await this.sidecar.stop();
    this.refreshShelves();
  }

  /** 设置页展示用。 */
  describeSidecar(): string {
    return this.sidecar.describe().text;
  }
}
