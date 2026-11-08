# fqsidecar

Ex Libris 的无界面本机侧车。只监听 `127.0.0.1`，只认 HTTP + JSON，不认识 Obsidian。

仓库里有两种构建：

| 目录 | 产物 | 说明 |
|---|---|---|
| `sidecar-upstream/` | **真实上游**（默认发货） | 复用 `vendor/fqapp` 的 `fqapi_core`：设备注册、Gorgon/Argus 签名、正文解密、书评 |
| `sidecar/` | 离线样章（`-Demo`） | 零依赖 Rust，只用 std，作为契约参考与无网自检 |

两者共用 `sidecar/src/lib.rs` 里的 HTTP server / JSON / Provider trait；生命周期代码相同。
真实产物约 4.9 MB，无窗口、无托盘、不写注册表。

## 构建

```powershell
# 真实上游（默认）
powershell -NoProfile -File scripts/build-sidecar.ps1

# 离线样章
powershell -NoProfile -File scripts/build-sidecar.ps1 -Demo
```

需要 Rust + GNU 链接器。推荐 MSYS2（体积小）：

```powershell
winget install --id MSYS2.MSYS2 -e
C:\msys64\usr\bin\bash.exe -lc "pacman -S --noconfirm mingw-w64-x86_64-rust mingw-w64-x86_64-gcc"
```

脚本会优先找 `<repo>\.tmp\msys64`、`C:\msys64` 的 cargo，找不到再用 PATH 里的。
rustup 的 msvc 工具链需要 Visual Studio 的 `link.exe`，没有时会给出提示。

## 运行

插件自动拉起：

```
fqsidecar.exe --port <p> --data-dir <abs dir> --parent-pid <obsidian pid>
```

环境变量 `FQ_TOKEN` 必须存在，之后每个请求带 `X-FQ-Token`。

| 参数 | 默认 | 说明 |
|---|---|---|
| `--provider` | fanqie | `demo` 走离线样章（`sidecar` 版本固定 demo） |
| `--idle-ms` | 300000 | 闲置退出阈值 |
| `--probe "/api/v1/books/<id>"` | — | 调试：初始化后直接打印上游原始 JSON 并退出 |

## 生命周期

1. 插件预分配端口（`listen(0)` 后关闭），通过 `--port` 传入。
2. 就绪后 `GET /health` 返回 200；插件每 200ms 轮询，15s 超时降级。
3. **三重退出**
   - `POST /shutdown` → 响应后退出；
   - stdin EOF → 立即 `exit(0)`（父进程崩溃时最可靠）；
   - 每 10s 检查 `--parent-pid`（Windows：`OpenProcess` + `WaitForSingleObject`）。
4. 连续 5 分钟无请求 → 退出。
5. 不写服务、不写注册表、不建托盘、不弹窗。

## HTTP 契约

错误统一 `{"error":{"code":"...","message":"..."}}`，
`code` ∈ `NOT_FOUND` `UPSTREAM_TIMEOUT` `DECRYPT_FAILED` `RATE_LIMITED` `DEVICE_EXPIRED`。

| 方法 | 路径 | 返回 |
|---|---|---|
| GET | `/health` | `{ok, version, device_ready, provider}` |
| GET | `/search?q=&page=1&limit=20` | `{total, items:[BookBrief]}` |
| POST | `/resolve` `{url}` | `{bookId}` |
| GET | `/book/<bookId>` | `BookDetail` |
| GET | `/book/<bookId>/chapters` | `{total, items:[{id,title,index}]}` |
| GET | `/chapter/<chapterId>` | `{id, book_id, title, index, paragraphs, prev, next}` |
| GET | `/book/<bookId>/comments?page=1` | `{total, items:[{user, avatar, content, likes, time}]}` |
| POST | `/shutdown` | `{ok:true}` |

`paragraphs` 是已剥 HTML、去广告尾巴的纯文本段落。

## 上游映射（sidecar-upstream）

| 本地接口 | fqapi_core 路由 | 上游 |
|---|---|---|
| `/search` | `/api/v1/search` | `bookapi/search/tab`（设备签名） |
| `/book/<id>` | `/api/v1/books/<id>` | `bookapi/detail` |
| `/book/<id>/chapters` | `/api/v1/books/<id>/directory` | `directory/all_items` |
| `/chapter/<id>` | `/api/v1/chapters/<id>` | `reading/reader/full` + AES-128-CBC 解密 |
| `/book/<id>/comments` | `/api/v1/books/<id>/comments` | `ugc/novel_comment/book`（书评，只读） |

适配层只做三件事：翻译路由、归一化 JSON、维持生命周期。设备注册/签名/解密全部留在 vendored core。

### 为什么是书评不是段评

段评走 `idea_list`，需要正文响应里的 `item_version` 才返回内容；不带时接口只给空壳。
书评接口稳定返回 `text + user_info + digg_count + create_timestamp`，所以 UI 明确标注“书评”，
不伪装成本章评论。
