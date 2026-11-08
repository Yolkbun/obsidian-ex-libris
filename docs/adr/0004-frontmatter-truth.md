# ADR-0004：元信息以笔记 frontmatter 为唯一真相

- 状态：接受
- 日期：2026-11-08

## 背景

如果插件再维护一份条目索引，就会出现“笔记改了、索引没改”的双写问题；
而 Obsidian 的 `metadataCache` 已经替我们解析并监听 frontmatter。

## 决定

- 书架条目来自 `app.vault.getMarkdownFiles()` + `metadataCache.getFileCache(file).frontmatter`。
- 不建全局索引文件。`EntryIndex` 只在内存里缓存 `ShelfItem`，`metadataCache` 的
  `changed` / `deleted` / `resolved` 事件驱动增量刷新。
- 豆瓣笔记只读，唯一允许的写操作是补 `cover`（本实现甚至完全不写，避免与上游冲突）。
- 番茄轻笔记的 `fq_*` 字段由本插件写；`status` 与豆瓣 `myState` 互不推断。
- 阅读位置不进 frontmatter，见 ADR-0005。

## 后果

- 用任何编辑器改 frontmatter，书架立刻反映。
- 不需要迁移脚本。
- 全库扫描是 O(笔记数)，对本项目规模足够；Bases 视图本身也走 Obsidian 查询。
