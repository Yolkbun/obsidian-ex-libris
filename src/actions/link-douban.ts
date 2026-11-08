import { App, Notice, TFile } from "obsidian";
import type { ShelfItem } from "../domain/types";
import type { EntryIndex } from "../library/entries";
import { isDoubanFrontmatter } from "../library/entries";
import { writeRelated } from "../library/fanqie-note";
import { pickNote } from "./note-picker";

/**
 * 手动把番茄书挂靠到一条豆瓣笔记（红线 2：绝不自动匹配）。
 * 写入的是番茄笔记的 fq_related，豆瓣笔记一个字节都不改。
 */
export async function linkDouban(
  app: App,
  entries: EntryIndex,
  item: ShelfItem,
): Promise<void> {
  if (!item.bookId) {
    new Notice("只有番茄条目可以挂靠豆瓣。");
    return;
  }
  const fanqieFile = app.vault.getAbstractFileByPath(item.path);
  if (!(fanqieFile instanceof TFile)) {
    new Notice("找不到这条番茄笔记。");
    return;
  }

  const candidates = app.vault.getMarkdownFiles().filter((file) => {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    return fm ? isDoubanFrontmatter(fm as Record<string, unknown>) : false;
  });
  if (candidates.length === 0) {
    new Notice("vault 里还没有豆瓣条目（先运行 obsidian-douban 导入）。");
    return;
  }

  const target = await pickNote(app, candidates, "选择要挂靠的豆瓣条目…");
  if (!target) return;

  await writeRelated(app, fanqieFile, `[[${target.basename}]]`);
  new Notice(`已把《${item.title}》挂靠到《${target.basename}》。`);
  await entries.rebuild();
}
