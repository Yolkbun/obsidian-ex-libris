# ADR-0001：三层边界与唯一内部契约

- 状态：接受
- 日期：2026-11-08

## 背景

书架要同时服务 Bases 视图、书架 ItemView、阅读器与设置页。如果每个视图都自己去读
`metadataCache`、自己拼封面 URL、自己请求侧车，任何一处改动都会牵动四个视图。

## 决定

1. 视图层只吃 `ShelfItem[]`（`src/domain/types.ts`），不 import 侧车、不 import `metadataCache`。
2. 领域层（`library/`、`progress/`、`cache/`）负责把 vault 与侧车数据变成 `ShelfItem[]`，
   不出现任何 DOM。
3. 侧车只认 HTTP + JSON，不知道 Obsidian 的存在。
4. 渲染是纯函数 `renderShelf(el, items, opts)`：Bases 与 ItemView 都只调它。

## 后果

- 换渲染方式只改 `views/shelf-render.ts`。
- Bases API 变动只影响 `views/bases-view.ts`；返回 falsy 时只警告，不影响 ItemView。
- 测试可以在 jsdom 里直接调 `renderShelf`，不需要 Obsidian。
