# ADR-0002：侧车采用本机 HTTP，上游适配器单独隔离

- 状态：已实现（真实上游接通）
- 日期：2026-11-08

## 背景

番茄正文是加密的，`fqapi_core.dll` 只导出 flutter_rust_bridge 胶水符号，没有可独立启动的
C 入口（28 个导出全是 `frb_*` + 3 个媒体函数），薄壳加载不可行。

## 决定

1. 侧车是独立进程，只监听 `127.0.0.1`；插件分配端口、生成随机 token 经 `FQ_TOKEN` 传入。
2. 插件只认本地契约（`/health` `/search` `/resolve` `/book/*` `/chapter/*` `/shutdown`）。
3. 上游实现复用 vendored `fqapp` 的 `fqapi_core`（GPL-3.0），
   由 `sidecar-upstream` 做路由翻译与 JSON 归一化；设备注册、签名、解密留在上游核心里。
   侧车、适配层与 vendored 源码在独立仓库
   [`ex-libris-sidecar`](https://github.com/Yolkbun/ex-libris-sidecar)，
   插件仓库不包含二进制与解密源码。
4. 生命周期按规格 6.2 逐条实现：端口预分配、200ms 轮询 `/health`、stdin EOF、
   父进程 10s 存活检查、闲置 5 分钟退出、卸载时 `POST /shutdown` → 1.5s → `taskkill /T /F`。
5. 另保留 `sidecar/`（零依赖）作为契约参考与离线样章（`-Demo` 构建）。

## 实现映射

| 本地 | fqapi_core | 上游 |
|---|---|---|
| `/search` | `/api/v1/search` | `bookapi/search/tab` |
| `/book/<id>` | `/api/v1/books/<id>` | `bookapi/detail` |
| `/book/<id>/chapters` | `/api/v1/books/<id>/directory` | `directory/all_items` |
| `/chapter/<id>` | `/api/v1/chapters/<id>` | `reader/full` + AES 解密 |
| `/book/<id>/comments` | `/api/v1/books/<id>/comments` | `novel_comment/book`（书评） |

正文 HTML 在适配层转成纯文本段落；书评字段归一化；目录取 `item_data_list`。

## 后果

- 侧车没启动时，书架/豆瓣/摘录/进度全部照常，只有番茄入口降级。
- 上游接通后不需要改插件；换上游只需在侧车仓库更新 `vendor/fqapp` 与适配层。
- 引入 `fqapi_core` 的依赖树（tokio/axum/reqwest），但仍是单文件 exe、无运行时依赖。
- 不引入 `electron-rebuild` 原生模块。
