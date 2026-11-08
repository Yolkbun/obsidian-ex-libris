/**
 * 测试用的最小 Obsidian API 仿真实现在这里。
 * 只实现插件真正用到的成员；行为尽量贴近 1.10+（Bases）与 ItemView 生命周期。
 */

export type EventRef = { off: () => void };

export class Emitter {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(name: string, callback: (...args: unknown[]) => void): EventRef {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(callback);
    return {
      off: () => {
        set?.delete(callback);
      },
    };
  }

  offref(ref: EventRef): void {
    ref.off();
  }

  trigger(name: string, ...args: unknown[]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const callback of [...set]) callback(...args);
  }

  clear(): void {
    this.listeners.clear();
  }
}

export class TAbstractFile {
  vault: Vault;
  path: string;
  name: string;
  parent: TFolder | null = null;

  constructor(vault: Vault, path: string) {
    this.vault = vault;
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class TFile extends TAbstractFile {
  basename: string;
  extension: string;
  stat: { ctime: number; mtime: number; size: number; type: "file" };

  constructor(vault: Vault, path: string, stat?: { ctime: number; mtime: number; size: number }) {
    super(vault, path);
    const dot = this.name.lastIndexOf(".");
    this.extension = dot >= 0 ? this.name.slice(dot + 1) : "";
    this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
    this.stat = {
      ctime: stat?.ctime ?? Date.now(),
      mtime: stat?.mtime ?? Date.now(),
      size: stat?.size ?? 0,
      type: "file",
    };
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  isRoot(): boolean {
    return this.path === "/" || this.path === "";
  }
}

export class Component {
  protected _disposers: Array<() => void> = [];

  register(callback: () => void): void {
    this._disposers.push(callback);
  }

  registerEvent(ref: EventRef | { off?: () => void } | null): void {
    if (ref && typeof (ref as EventRef).off === "function") {
      this._disposers.push(() => (ref as EventRef).off());
    }
  }

  registerDomEvent(el: EventTarget, type: string, callback: EventListener): void {
    el.addEventListener(type, callback);
    this._disposers.push(() => el.removeEventListener(type, callback));
  }

  registerInterval(id: ReturnType<typeof setInterval>): ReturnType<typeof setInterval> {
    this._disposers.push(() => clearInterval(id));
    return id;
  }

  addChild<T extends Component>(child: T): T {
    return child;
  }

  onload(): void {
    /* noop */
  }

  onunload(): void {
    /* noop */
  }

  unload(): void {
    for (const dispose of this._disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
  }
}

export class App {
  vault!: Vault;
  metadataCache!: MetadataCache;
  workspace!: Workspace;
  fileManager: { processFrontMatter: (file: TFile, fn: (fm: Record<string, unknown>) => void) => Promise<void> } = {
    processFrontMatter: async () => undefined,
  };
  commands: Array<{ id: string; name: string; callback?: () => void; checkCallback?: (checking: boolean) => boolean }> = [];
  notices: Array<{ message: string; timeout?: number; hidden: boolean }> = [];
  menus: Menu[] = [];
  protocolHandlers = new Map<string, (params: Record<string, string>) => void>();
  basesViews = new Map<string, BasesViewRegistration>();
  viewFactories = new Map<string, (leaf: WorkspaceLeaf) => View>();
  dataStore = new Map<string, unknown>();
  settingTab: PluginSettingTab | null = null;
  private pluginInstances: Plugin[] = [];

  addPlugin(plugin: Plugin): void {
    this.pluginInstances.push(plugin);
  }

  getPlugins(): Plugin[] {
    return [...this.pluginInstances];
  }
}

export class Vault extends Emitter {
  adapter!: DataAdapter;
  files = new Map<string, TFile>();
  folders = new Map<string, TFolder>();
  configDir = ".obsidian";

  constructor(adapter: DataAdapter) {
    super();
    this.adapter = adapter;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  getFiles(): TFile[] {
    return [...this.files.values()];
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const normalized = normalizePath(path);
    return this.files.get(normalized) ?? this.folders.get(normalized) ?? null;
  }

  async read(file: TFile): Promise<string> {
    return this.adapter.read(file.path);
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async create(path: string, content: string): Promise<TFile> {
    const normalized = normalizePath(path);
    await this.adapter.write(normalized, content);
    const file = new TFile(this, normalized, { ctime: Date.now(), mtime: Date.now(), size: content.length });
    this.files.set(normalized, file);
    this.trigger("create", file);
    return file;
  }

  async createFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    await this.adapter.mkdir(normalized);
    this.folders.set(normalized, new TFolder(this, normalized));
  }

  async modify(file: TFile, content: string): Promise<void> {
    await this.adapter.write(file.path, content);
    file.stat.mtime = Date.now();
    file.stat.size = content.length;
    this.trigger("modify", file);
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const data = await this.read(file);
    const next = fn(data);
    if (next !== data) await this.modify(file, next);
    return next;
  }

  async delete(file: TAbstractFile): Promise<void> {
    await this.adapter.remove(file.path);
    this.files.delete(file.path);
    this.trigger("delete", file);
  }

  /** 测试辅助：扫描适配器上已有的 md 文件。 */
  async rescan(): Promise<void> {
    const walk = async (dir: string): Promise<void> => {
      const listing = await this.adapter.list(dir);
      for (const filePath of listing.files) {
        if (!filePath.endsWith(".md")) continue;
        if (this.files.has(filePath)) continue;
        const stat = await this.adapter.stat(filePath);
        this.files.set(
          filePath,
          new TFile(this, filePath, {
            ctime: stat?.ctime ?? Date.now(),
            mtime: stat?.mtime ?? Date.now(),
            size: stat?.size ?? 0,
          }),
        );
      }
      for (const folder of listing.folders) await walk(folder);
    };
    await walk("");
  }

  override on(name: string, callback: (...args: unknown[]) => void): EventRef {
    return super.on(name, callback);
  }
}

export class MetadataCache extends Emitter {
  constructor(private readonly vault: Vault) {
    super();
  }

  getFileCache(file: TFile): { frontmatter: Record<string, unknown>; position: unknown } | null {
    if (!this.vault.files.has(file.path)) return null;
    const raw = readFileSyncSafe(this.vault, file.path);
    if (raw === null) return null;
    const parsed = parseFrontmatterYaml(raw);
    if (!parsed) return null;
    return { frontmatter: parsed, position: {} };
  }

  getFirstLinkpathDest(linkpath: string): TFile | null {
    for (const file of this.vault.files.values()) {
      if (file.basename === linkpath || file.path === linkpath) return file;
    }
    return null;
  }

  override on(name: string, callback: (...args: unknown[]) => void): EventRef {
    return super.on(name, callback);
  }
}

// 同步读盘仅用于测试仿真；真实 Obsidian 的 metadataCache 也是同步接口。
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readFileSyncSafe(vault: Vault, path: string): string | null {
  try {
    const adapter = vault.adapter as unknown as { getBasePath(): string };
    return readFileSync(join(adapter.getBasePath(), path), "utf8");
  } catch {
    return null;
  }
}

export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/^\/+/, "");
  if (normalized.endsWith("/") && normalized.length > 1) normalized = normalized.slice(0, -1);
  return normalized;
}

export interface DataAdapter {
  getBasePath(): string;
  getResourcePath(path: string): string;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ type: "file" | "folder"; size: number; ctime: number; mtime: number } | null>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  process(path: string, fn: (data: string) => string): Promise<string>;
}

export class WorkspaceLeaf {
  app: App;
  view: View | null = null;
  active = false;

  constructor(app: App) {
    this.app = app;
  }

  async setViewState(state: { type: string; state?: unknown; active?: boolean }): Promise<void> {
    const factory = this.app.viewFactories.get(state.type);
    if (!factory) throw new Error(`no view factory for ${state.type}`);
    if (this.view && this.view.getViewType() === state.type) {
      if (state.state) await this.view.setState(state.state, {} as never);
      return;
    }
    if (this.view) await this.view.onClose();
    const view = factory(this);
    this.view = view;
    (this.app.workspace as unknown as { attachLeaf: (leaf: WorkspaceLeaf) => void }).attachLeaf(this);
    await view.onOpen();
    if (state.state) await view.setState(state.state, {} as never);
  }

  getViewState(): { type: string; state: unknown } {
    return { type: this.view?.getViewType() ?? "", state: this.view?.getState() ?? {} };
  }

  async openFile(file: TFile): Promise<void> {
    this.app.workspace.lastOpenedFile = file;
  }

  detach(): void {
    this.view = null;
  }
}

export class Workspace extends Emitter {
  activeLeaf: WorkspaceLeaf | null = null;
  lastOpenedFile: TFile | null = null;
  private leaves: WorkspaceLeaf[] = [];
  private layoutCallbacks: Array<() => void> = [];
  layoutReady = false;

  constructor(private readonly app: App) {
    super();
  }

  attachLeaf(leaf: WorkspaceLeaf): void {
    if (!this.leaves.includes(leaf)) this.leaves.push(leaf);
    this.activeLeaf = leaf;
    // jsdom 的 Selection 需要节点在文档里；真实 Obsidian 也把 leaf 挂到 DOM 上。
    if (leaf.view && !leaf.view.containerEl.isConnected) {
      document.body.append(leaf.view.containerEl);
    }
  }

  getLeaf(newLeaf?: boolean | "tab" | "split"): WorkspaceLeaf {
    if (newLeaf === false && this.activeLeaf) return this.activeLeaf;
    const leaf = new WorkspaceLeaf(this.app);
    this.leaves.push(leaf);
    this.activeLeaf = leaf;
    return leaf;
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.view?.getViewType() === type);
  }

  revealLeaf(leaf: WorkspaceLeaf): void {
    this.activeLeaf = leaf;
  }

  detachLeavesOfType(type: string): void {
    this.leaves = this.leaves.filter((leaf) => leaf.view?.getViewType() !== type);
  }

  getActiveViewOfType<T extends View>(type: abstract new (...args: never[]) => T): T | null {
    const view = this.activeLeaf?.view;
    return view instanceof type ? view : null;
  }

  getActiveFile(): TFile | null {
    return this.lastOpenedFile;
  }

  onLayoutReady(callback: () => void): void {
    if (this.layoutReady) callback();
    else this.layoutCallbacks.push(callback);
  }

  triggerLayoutReady(): void {
    this.layoutReady = true;
    for (const callback of this.layoutCallbacks.splice(0)) callback();
  }

  override on(name: string, callback: (...args: unknown[]) => void): EventRef {
    return super.on(name, callback);
  }
}

export abstract class View extends Component {
  app: App;
  leaf: WorkspaceLeaf;
  containerEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = document.createElement("div");
    this.containerEl.className = "workspace-leaf-content";
    this.contentEl = document.createElement("div");
    this.contentEl.className = "view-content";
    this.containerEl.append(this.contentEl);
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;

  getIcon(): string {
    return "document";
  }

  getState(): Record<string, unknown> {
    return {};
  }

  async setState(_state: unknown, _result: unknown): Promise<void> {
    /* noop */
  }

  async onOpen(): Promise<void> {
    /* noop */
  }

  async onClose(): Promise<void> {
    /* noop */
  }
}

export abstract class ItemView extends View {}

export class Plugin extends Component {
  app: App;
  manifest: { id: string; name: string; version: string; dir?: string; minAppVersion: string };
  settings?: unknown;

  constructor(app: App, manifest: Plugin["manifest"]) {
    super();
    this.app = app;
    this.manifest = manifest;
    app.addPlugin(this);
  }

  async loadData(): Promise<unknown> {
    return this.app.dataStore.get(this.manifest.id) ?? null;
  }

  async saveData(data: unknown): Promise<void> {
    this.app.dataStore.set(this.manifest.id, JSON.parse(JSON.stringify(data)));
  }

  addCommand(command: {
    id: string;
    name: string;
    callback?: () => void;
    checkCallback?: (checking: boolean) => boolean;
  }): void {
    this.app.commands.push(command);
  }

  addRibbonIcon(_icon: string, title: string, callback: () => void): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("aria-label", title);
    el.addEventListener("click", callback);
    return el;
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.app.settingTab = tab;
  }

  registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void {
    this.app.viewFactories.set(type, factory);
  }

  registerBasesView(id: string, registration: BasesViewRegistration): boolean {
    this.app.basesViews.set(id, registration);
    return true;
  }

  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => void): void {
    this.app.protocolHandlers.set(action, handler);
  }

  override registerEvent(ref: EventRef | null): void {
    super.registerEvent(ref);
  }

  override registerDomEvent(el: EventTarget, type: string, callback: EventListener): void {
    super.registerDomEvent(el, type, callback);
  }
}

export class PluginSettingTab {
  app: App;
  containerEl: HTMLElement;

  constructor(app: App, _plugin: Plugin) {
    this.app = app;
    this.containerEl = document.createElement("div");
  }

  display(): void {
    /* noop */
  }

  hide(): void {
    /* noop */
  }
}

export class Notice {
  message: string;
  timeout?: number;
  hidden = false;

  constructor(message: string, timeout?: number) {
    this.message = message;
    this.timeout = timeout;
    const app = activeApp();
    if (app) app.notices.push(this);
    noticesFallback.push(this);
  }

  setMessage(message: string): this {
    this.message = message;
    return this;
  }

  hide(): void {
    this.hidden = true;
  }
}

const noticesFallback: Notice[] = [];
export function allNotices(): Notice[] {
  return noticesFallback;
}

let appRef: App | null = null;
export function setActiveApp(app: App): void {
  appRef = app;
}
function activeApp(): App | null {
  return appRef;
}

export class MenuItem {
  title = "";
  clickHandler: (() => void) | null = null;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(_icon: string): this {
    return this;
  }

  onClick(callback: () => void): this {
    this.clickHandler = callback;
    return this;
  }
}

export class Menu {
  items: MenuItem[] = [];
  shownAt: { x: number; y: number } | null = null;

  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  showAtMouseEvent(event: MouseEvent): this {
    this.shownAt = { x: event.clientX, y: event.clientY };
    const app = activeApp();
    if (app) app.menus.push(this);
    return this;
  }
}

export class Modal {
  app: App;
  contentEl: HTMLElement;
  modalEl: HTMLElement;
  closed = false;

  constructor(app: App) {
    this.app = app;
    this.modalEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.modalEl.append(this.contentEl);
  }

  open(): void {
    this.onOpen();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  onOpen(): void {
    /* noop */
  }

  onClose(): void {
    /* noop */
  }
}

export class FuzzySuggestModal<T> extends Modal {
  placeholder = "";

  setPlaceholder(placeholder: string): void {
    this.placeholder = placeholder;
  }

  getItems(): T[] {
    return [];
  }

  getItemText(_item: T): string {
    return "";
  }

  onChooseItem(_item: T, _evt?: unknown): void {
    /* noop */
  }

  override onOpen(): void {
    /* noop */
  }
}

export class BasesViewConfig {
  private values = new Map<string, unknown>();

  get(key: string): unknown {
    return this.values.get(key);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  getAsPropertyId(): string | null {
    return null;
  }

  getOrder(): string[] {
    return [];
  }

  getSort(): unknown[] {
    return [];
  }

  getDisplayName(): string {
    return "";
  }
}

export abstract class BasesView extends Component {
  app: App;
  config: BasesViewConfig;
  data: unknown = { data: [] };
  allProperties: string[] = [];
  abstract type: string;

  constructor(controller: { app: App; config?: BasesViewConfig; data?: unknown }) {
    super();
    this.app = controller.app;
    this.config = controller.config ?? new BasesViewConfig();
    if (controller.data !== undefined) this.data = controller.data;
  }

  abstract onDataUpdated(): void;

  async createFileForView(): Promise<void> {
    /* noop */
  }
}

export type QueryController = { app: App; config?: BasesViewConfig; data?: unknown };

export interface BasesViewRegistration {
  name: string;
  icon: string;
  factory: (controller: QueryController, containerEl: HTMLElement) => BasesView;
  options?: (config: BasesViewConfig) => unknown[];
}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.controlEl = document.createElement("div");
    this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
    containerEl.append(this.settingEl);
  }

  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }

  setHeading(_text?: string): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }

  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }

  addText(callback: (component: TextComponent) => void): this {
    callback(new TextComponent(this.controlEl));
    return this;
  }

  addSlider(callback: (component: SliderComponent) => void): this {
    callback(new SliderComponent(this.controlEl));
    return this;
  }

  addToggle(callback: (component: ToggleComponent) => void): this {
    callback(new ToggleComponent(this.controlEl));
    return this;
  }

  addButton(callback: (component: ButtonComponent) => void): this {
    callback(new ButtonComponent(this.controlEl));
    return this;
  }
}

class BaseComponent {
  el: HTMLElement;
  changeHandler: ((value: never) => void) | null = null;

  constructor(containerEl: HTMLElement, tag = "input") {
    this.el = document.createElement(tag);
    containerEl.append(this.el);
  }
}

export class TextComponent extends BaseComponent {
  value = "";

  setPlaceholder(placeholder: string): this {
    this.el.setAttribute("placeholder", placeholder);
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  getValue(): string {
    return this.value;
  }

  onChange(callback: (value: string) => void): this {
    this.changeHandler = callback as (value: never) => void;
    return this;
  }
}

export class SliderComponent extends BaseComponent {
  value = 0;

  setLimits(_min: number, _max: number, _step: number): this {
    return this;
  }

  setValue(value: number): this {
    this.value = value;
    return this;
  }

  setDynamicTooltip(): this {
    return this;
  }

  onChange(callback: (value: number) => void): this {
    this.changeHandler = callback as (value: never) => void;
    return this;
  }
}

export class ToggleComponent extends BaseComponent {
  value = false;

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    this.changeHandler = callback as (value: never) => void;
    return this;
  }
}

export class ButtonComponent extends BaseComponent {
  clickHandler: (() => void) | null = null;

  constructor(containerEl: HTMLElement) {
    super(containerEl, "button");
  }

  setButtonText(text: string): this {
    this.el.textContent = text;
    return this;
  }

  setCta(): this {
    return this;
  }

  onClick(callback: () => void): this {
    this.clickHandler = callback;
    return this;
  }
}

export function requestUrl(request: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}): Promise<{
  status: number;
  text: string;
  json: unknown;
  arrayBuffer: ArrayBuffer;
  headers: Record<string, string>;
}> {
  return (async () => {
    const response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body: request.body,
    });
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(buffer);
    let json: unknown = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const result = { status: response.status, text, json, arrayBuffer: buffer, headers };
    if (request.throw !== false && !response.ok) {
      throw Object.assign(new Error(`Request failed ${response.status}`), result);
    }
    return result;
  })();
}

export function setIcon(el: HTMLElement, icon: string): void {
  el.setAttribute("data-icon", icon);
}

export function installDomHelpers(win: Window): void {
  const proto = (win as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.createEl) return;

  interface DomOptions {
    text?: string;
    cls?: string | string[];
    attr?: Record<string, string>;
    title?: string;
    type?: string;
    placeholder?: string;
    value?: string;
    href?: string;
  }

  proto.empty = function (this: HTMLElement) {
    this.replaceChildren();
  };
  proto.createEl = function (this: HTMLElement, tag: string, options: DomOptions = {}) {
    const el = this.ownerDocument.createElement(tag);
    if (options.text) el.textContent = options.text;
    if (options.cls) {
      const classes = Array.isArray(options.cls) ? options.cls : [options.cls];
      el.classList.add(...classes);
    }
    if (options.title) el.setAttribute("title", options.title);
    if (options.type) el.setAttribute("type", options.type);
    if (options.placeholder) el.setAttribute("placeholder", options.placeholder);
    if (options.value !== undefined) (el as HTMLInputElement).value = options.value;
    if (options.href) (el as HTMLAnchorElement).href = options.href;
    if (options.attr) {
      for (const [key, value] of Object.entries(options.attr)) el.setAttribute(key, value);
    }
    this.append(el);
    return el;
  };
  proto.createDiv = function (this: HTMLElement, options: DomOptions = {}) {
    return (this as unknown as { createEl: (tag: string, options?: DomOptions) => HTMLElement }).createEl("div", options);
  };
  proto.createSpan = function (this: HTMLElement, options: DomOptions = {}) {
    return (this as unknown as { createEl: (tag: string, options?: DomOptions) => HTMLElement }).createEl("span", options);
  };
  proto.setText = function (this: HTMLElement, text: string) {
    this.textContent = text;
  };
  proto.addClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes);
  };
  proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
    this.classList.remove(...classes);
  };
  proto.toggleClass = function (this: HTMLElement, cls: string, value: boolean) {
    this.classList.toggle(cls, value);
  };
  proto.setAttr = function (this: HTMLElement, key: string, value: string) {
    this.setAttribute(key, value);
  };
  proto.detach = function (this: HTMLElement) {
    this.remove();
  };
  proto.setCssStyles = function (this: HTMLElement, styles: Record<string, string | number>) {
    for (const [key, value] of Object.entries(styles)) {
      if (value === undefined || value === null) continue;
      (this.style as unknown as Record<string, string>)[key] = String(value);
    }
  };
  proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) {
      this.style.setProperty(key, value);
    }
  };
}

/** 极简 YAML frontmatter 解析，够测试夹具使用（扁平标量、内联数组、一层嵌套）。 */
export function parseFrontmatterYaml(text: string): Record<string, unknown> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const lines = match[1]!.split(/\r?\n/);
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentObject: Record<string, unknown> | null = null;
  let currentList: unknown[] | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indented = /^\s+/.test(rawLine);
    const line = rawLine.trim();

    if (indented) {
      const listMatch = /^-\s*(.*)$/.exec(line);
      if (listMatch && currentList) {
        currentList.push(parseScalar(listMatch[1]!));
        continue;
      }
      const nested = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
      if (nested && currentObject) {
        currentObject[nested[1]!] = parseScalar(nested[2]!);
        continue;
      }
      continue;
    }

    currentKey = null;
    currentObject = null;
    currentList = null;

    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    if (value === "") {
      currentKey = key;
      const nextLines = lines.slice(lines.indexOf(rawLine) + 1).filter((l) => l.trim());
      const isList = nextLines.length > 0 && /^\s*-\s+/.test(nextLines[0]!);
      if (isList) {
        currentList = [];
        result[key] = currentList;
      } else {
        currentObject = {};
        result[key] = currentObject;
      }
      continue;
    }
    result[key] = parseScalar(value);
  }
  return currentKey && !result[currentKey] ? result : result;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item.trim()))
      .filter((item) => item !== "");
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed;
  return trimmed;
}
