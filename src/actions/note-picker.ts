import { App, FuzzySuggestModal, Modal, TFile } from "obsidian";

export class NotePickerModal extends FuzzySuggestModal<TFile> {
  private settled = false;

  constructor(
    app: App,
    private readonly files: TFile[],
    placeholder: string,
    private readonly resolve: (file: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  override getItems(): TFile[] {
    return this.files;
  }

  override getItemText(item: TFile): string {
    return item.path;
  }

  override onChooseItem(item: TFile): void {
    this.settled = true;
    this.resolve(item);
  }

  override onClose(): void {
    super.onClose();
    if (!this.settled) this.resolve(null);
  }
}

export function pickNote(
  app: App,
  files: TFile[],
  placeholder = "选择一条笔记…",
): Promise<TFile | null> {
  return new Promise<TFile | null>((resolve) => {
    new NotePickerModal(app, files, placeholder, resolve).open();
  });
}

export type PresetField = "status" | "type" | "source" | "tag";

export interface PresetDraft {
  name: string;
  field: PresetField;
  value: string;
}

/** 「新增预设」的小表单：名称 + 字段 + 值。 */
export class PresetModal extends Modal {
  private nameInput: HTMLInputElement | null = null;
  private fieldSelect: HTMLSelectElement | null = null;
  private valueInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly submit: (draft: PresetDraft) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    const doc = this.contentEl.ownerDocument;
    this.contentEl.replaceChildren();
    const title = doc.createElement("h3");
    title.textContent = "新增书架预设";

    const nameLabel = doc.createElement("label");
    nameLabel.textContent = "名称";
    nameLabel.style.display = "block";
    nameLabel.style.marginTop = "10px";
    this.nameInput = doc.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.placeholder = "例如：今年想读的科幻";
    this.nameInput.style.width = "100%";
    nameLabel.append(this.nameInput);

    const fieldLabel = doc.createElement("label");
    fieldLabel.textContent = "字段";
    fieldLabel.style.display = "block";
    fieldLabel.style.marginTop = "10px";
    this.fieldSelect = doc.createElement("select");
    this.fieldSelect.style.width = "100%";
    for (const [value, label] of [
      ["status", "状态"],
      ["type", "类型"],
      ["source", "来源"],
      ["tag", "标签"],
    ] as Array<[PresetField, string]>) {
      const option = doc.createElement("option");
      option.value = value;
      option.textContent = label;
      this.fieldSelect.append(option);
    }
    fieldLabel.append(this.fieldSelect);

    const valueLabel = doc.createElement("label");
    valueLabel.textContent = "值";
    valueLabel.style.display = "block";
    valueLabel.style.marginTop = "10px";
    this.valueInput = doc.createElement("input");
    this.valueInput.type = "text";
    this.valueInput.placeholder = "例如：在读 / book / douban / 科幻";
    this.valueInput.style.width = "100%";
    valueLabel.append(this.valueInput);

    const action = doc.createElement("button");
    action.className = "mod-cta";
    action.textContent = "保存";
    action.style.marginTop = "14px";
    action.addEventListener("click", () => this.commit());

    this.contentEl.append(title, nameLabel, fieldLabel, valueLabel, action);
    this.nameInput.focus();
  }

  private commit(): void {
    const name = this.nameInput?.value.trim() ?? "";
    const value = this.valueInput?.value.trim() ?? "";
    const field = (this.fieldSelect?.value ?? "status") as PresetField;
    if (!name || !value) return;
    this.submit({ name, field, value });
    this.close();
  }
}
