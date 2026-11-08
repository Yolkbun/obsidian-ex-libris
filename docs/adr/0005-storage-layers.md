# ADR-0005：章节位置 / 摘要 / 正文分三层存储

- 状态：接受
- 日期：2026-11-08

## 背景

三种数据写频率、隐私级别、失败代价完全不同：

| 数据 | 例子 | 写频率 | 放哪 |
|---|---|---|---|
| 位置 | 第 58 章 / 滚动 1234px | 滚动时 5 秒节流 | `data/progress.json` |
| 摘要 | 读到第几章、百分比、未读数 | 换章 / 退出 / 卸载 | 番茄笔记 frontmatter |
| 正文 | 段落文本 | 每次翻章 | `cache/chapters/**`（或显式导出） |

如果把滚动位置写进 frontmatter，会在阅读时疯狂触发 `metadataCache.changed`、
污染 vault 的版本历史；如果把正文写进笔记，`Ctrl+F` 会搜到小说内容，
违背“正文永不进 vault”。

## 决定

1. 位置只进 `progress.json`；`ProgressStore.set()` 节流 5s，换章/关闭时 `flush()`。
2. 摘要只在换章、退出阅读器、插件卸载时写 frontmatter：
   `fq_reading_chapter` `fq_progress` `fq_last_read_at`（必要时 `fq_unread_count`）。
3. 正文只进 `cache/chapters/<bookId>/<chapterId>.txt`，清理时整目录删除；
   只有 `Ex Libris: 导出…` 才写 vault。
4. 打开书时以 JSON 为准；与 frontmatter 不一致就纠正 frontmatter（规格 8.2）。

## 后果

- 阅读 200 章不会让 vault 多出 200 个文件。
- 断网时可读缓存章节。
- 删掉整个 `cache/` 后阅读器会重新拉取，功能不降级（已测）。
