# ADR-0003：私有数据用单文件 JSON + 原子写，不用 sqlite

- 状态：接受
- 日期：2026-11-08

## 背景

阅读位置、清理时间戳、书架预设都是小数据；而 `better-sqlite3` 一类原生模块需要
`electron-rebuild`，在 Obsidian 插件里维护成本极高。

## 决定

- `data/progress.json`：`{ "<bookId>": { chapterId, chapterIndex, offset, updatedAt } }`
- `data/meta.json`：`{ lastCleanup, presets, sidecarLogTail }`
- 统一走 `AtomicJsonStore`：写 `.tmp` → `rename`；rename 失败时删除目标再 rename，
  仍失败就直接写，保证不丢数据。
- 滚动位置在内存里更新，5 秒节流落盘；卸载时 `flush()`。

## 后果

- 单人 vault 的数据量（几千条）完全够用。
- 没有崩溃后会损坏的 B-tree。
- 原子性依赖 Windows 的 rename 语义；已用测试覆盖“不留 `.tmp`”。
- token 不进 `meta.json`：每次启动随机生成，只在内存与子进程环境变量里。
