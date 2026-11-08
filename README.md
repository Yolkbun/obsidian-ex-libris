<div align="center">

<img src="docs/assets/banner.svg" alt="Ex Libris Bookplate" width="100%" />

**把豆瓣与番茄收进一面 iBooks 风格书架**
An iBooks-style bookshelf for Obsidian

[![Release](https://img.shields.io/github/v/release/Yolkbun/obsidian-ex-libris?style=flat-square&label=release)](https://github.com/Yolkbun/obsidian-ex-libris/releases/latest)
[![License](https://img.shields.io/github/license/Yolkbun/obsidian-ex-libris?style=flat-square)](LICENSE)
![Obsidian](https://img.shields.io/badge/Obsidian-1.10%2B-7c3aed?style=flat-square)
![Windows](https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square)
![Tests](https://img.shields.io/badge/tests-41%20passing-2ea44f?style=flat-square)

</div>

<details open>
<summary><b>目录 / Contents</b></summary>

- [English](#english) · [中文](#中文)
- [界面 / Screenshots](#界面)
- [现在能做什么](#现在能做什么)
- [安装](#安装)
- [使用](#使用)
- [豆瓣联动（可选）](#豆瓣联动可选)
- [架构](#架构)
- [数据与隐私](#数据与隐私)
- [开发与测试](#开发与测试)
- [常见问题](#常见问题)
- [许可证与来源](#许可证与来源)
- [更新日志 / Changelog](CHANGELOG.md)

</details>

---

## English

**Ex Libris Bookplate** turns Douban and Fanqie notes into an iBooks-style bookshelf inside Obsidian.

- Search Douban (books, movies, TV) and add entries directly, without `obsidian-douban`
- Optional linkage: read entries imported by `obsidian-douban` (toggle in settings, read-only)
- iBooks-style shelf and a registered Bases view (`ex-libris-shelf`), with covers, progress, presets and type filters
- Read Fanqie chapters inside Obsidian, with per-chapter progress and resume
- Select text → `Ctrl+Shift+E` → insert a quote with source and an `obsidian://ex-libris?...` back-jump link
- Export a chapter or a whole book; chapter text never enters your vault unless you export it

### Install

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/Yolkbun/obsidian-ex-libris/releases/latest).
2. Put them in `<vault>/.obsidian/plugins/ex-libris/`.
3. Enable **Ex Libris Bookplate** in Settings → Community plugins, then restart Obsidian.

Fanqie reading needs an optional local sidecar because Obsidian's installer only installs those three files:

- Download `fqsidecar.exe` from the [sidecar release](https://github.com/Yolkbun/ex-libris-sidecar/releases/tag/sidecar-0.1.0).
- Put it at `<vault>/.obsidian/plugins/ex-libris/bin/fqsidecar.exe`.
- Settings → Ex Libris → **Restart and check**.

The plugin never downloads, installs, or updates the sidecar automatically. If it is missing on first run, a dismissible guide explains the manual steps. The shelf, Douban entries, excerpts and reading progress work without it.

### Network and file access

- **Network**: the sidecar calls the Fanqie upstream from `127.0.0.1`; Douban search uses Douban's public suggest endpoint; covers are fetched from Douban/Fanqie image hosts. No telemetry, no analytics.
- **Filesystem / shell**: the plugin checks whether `bin/fqsidecar.exe` exists and spawns it with `child_process` on loopback. A user-configured sidecar path may point outside the vault.
- **Vault enumeration**: the shelf is built by reading frontmatter of Markdown files through Obsidian's metadata cache; read-only.

### License and disclaimer

GPL-3.0-or-later. Not affiliated with ByteDance / Fanqie, Douban, Obsidian, or Clarivate / Ex Libris. For personal study and research only; you are responsible for complying with local laws and the terms of any service you use. See [NOTICE](NOTICE) and the full disclaimer below.

## 中文

> Ex Libris 是拉丁语“某某的藏书中”，指贴在自己书封内侧的那张小纸片——藏书票。
> 这个插件做的事就是同一件：把散落在豆瓣和番茄里的东西，一张一张盖上“我的”印章，收进自己的书架。

Obsidian 桌面插件（Windows）。把 `obsidian-douban` 导入的书影音和番茄小说聚合成一个
iBooks 风格书架，并在 Obsidian 内直接阅读番茄章节、把摘录带出处地送回笔记、点回跳回到原文位置。

**下载安装**：[GitHub Releases](https://github.com/Yolkbun/obsidian-ex-libris/releases/latest)

> 只想看怎么用？看 [**使用指南**](docs/使用指南.md)（安装、书架、阅读、摘录、设置、常见问题）。

## 界面

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/ui-shelf.png" alt="书架" /><br /><sub><b>iBooks 风格书架</b></sub></td>
    <td width="50%"><img src="docs/screenshots/ui-search.png" alt="番茄搜索" /><br /><sub><b>番茄搜索 / 批量加入</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/ui-add-url.png" alt="从链接加入" /><br /><sub><b>从链接加入</b></sub></td>
    <td><img src="docs/screenshots/ui-reader.png" alt="阅读器" /><br /><sub><b>阅读器（真实番茄正文）</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/ui-excerpt.png" alt="摘录" /><br /><sub><b>摘录带出处与回跳</b></sub></td>
    <td><img src="docs/screenshots/ui-settings.png" alt="设置" /><br /><sub><b>设置与侧车状态</b></sub></td>
  </tr>
</table>

截图来自测试 vault（Obsidian 1.15.0，Windows，100% 缩放）。截图中的标签仍显示旧中文名；`0.1.2` 起社区显示名改为 **Ex Libris Bookplate**（Obsidian 要求 Basic Latin）。

首次运行且没有侧车时，会弹一次安装引导（可勾选“不再提示”，也可以在设置里重新打开）：

![侧车安装引导](docs/screenshots/ui-sidecar-guide.png)

---

## 现在能做什么

| 能力 | 状态 |
|---|---|
| 从 `obsidian-douban` 的 frontmatter 读书影音条目 | ✅ 只读，不改写豆瓣笔记 |
| iBooks 质感封面墙（2:3、书脊、悬停、来源徽标、占位封面、进度条） | ✅ |
| Bases 自定义视图 `ex-libris-shelf`（1.10+ API，失败降级） | ✅ |
| 书架 ItemView：全部 / 在读 / 今年读完 / 想读 + 类型筛选 + 自定义预设 | ✅ |
| 远程封面本地化、7 天自动清理、缓存体积、手动清理 | ✅ |
| **番茄真实上游**：搜索、详情、1496 章目录、加密正文解密、书评 | ✅ 复用 fqapp core |
| 番茄轻笔记（frontmatter 为主，正文不落盘） | ✅ |
| 侧车生命周期：端口自选、token、健康轮询、三重退出、闲置退出 | ✅ 真实 exe 已验证 |
| 阅读器：38em 单栏、翻章、断点续读、快捷键、书评面板 | ✅ |
| 进度三层存储：JSON 位置 / frontmatter 摘要 / cache 正文 | ✅ |
| 摘录 → `## 摘录` → 回跳链接 → 协议定位 | ✅ |
| 导出单章 / 整本（唯一会落盘正文的路径） | ✅ |
| 从链接加入、搜索批量加入、手动挂靠豆瓣 | ✅ |

实测样本：《十日终焉》1496 章，目录、第 1 章 66 段正文、书评 43 万条、封面全部正常。

## 边界（有意为之，不是 bug）

1. **书评而不是段评。** 番茄的段评（`idea_list`）需要正文的 `item_version` 才返回内容，
   拿不到时是空壳；这里用同一 App 的书评接口（只读，`comment_cnt` 真实），
   UI 明确写“书评”。它不会伪装成“本章评论”。
2. **不登录番茄。** 官方 App 的书架、收藏、阅读历史需要账号，本项目不碰；
   书只能手动加（链接 / 搜索 / 批量勾选）。
3. **只支持 Windows 桌面。** 侧车是 exe，不做移动端。
4. **上游改版会坏。** 所有上游调用集中在侧车仓库
   [`ex-libris-sidecar`](https://github.com/Yolkbun/ex-libris-sidecar)（`sidecar-upstream` +
   vendored `fqapp` core），接口变了只改那里；插件侧契约不变。插件仓库本身不含侧车源码。

## 安装

### 方式 A：从 GitHub Release 安装（推荐）

**插件本体**（[最新 Release](https://github.com/Yolkbun/obsidian-ex-libris/releases/latest)）提供三个文件（另附一个纯插件 zip）：

| 文件 | 放到 |
|---|---|
| `main.js` | `<vault>/.obsidian/plugins/ex-libris/` |
| `manifest.json` | 同上 |
| `styles.css` | 同上 |

**侧车**是单独的可选组件，在
[`sidecar-0.1.0` Release](https://github.com/Yolkbun/ex-libris-sidecar/releases/tag/sidecar-0.1.0)
里下载 `fqsidecar.exe`，放到：

```
<vault>/.obsidian/plugins/ex-libris/bin/fqsidecar.exe
```

最终结构：

```
<vault>/.obsidian/plugins/ex-libris/
  main.js
  manifest.json
  styles.css
  bin/fqsidecar.exe        # 可选
```

然后在 Obsidian → 设置 → 第三方插件启用 **Ex Libris 藏书票**，重启 Obsidian。

> 插件**不会**自动下载、自动安装或自动更新侧车。它只会在首次运行时弹一次安装引导，
> 告诉你去哪个 Release 下载、放到哪个路径；勾选“不再提示”后不再自动弹出。
>
> 不装侧车也能用：书架、豆瓣、摘录、进度、打开笔记都正常，只有番茄阅读提示不可用。
> Obsidian 社区目录的安装器只会下载前三个文件，侧车永远需要手动放。

### 方式 B：从源码构建

```powershell
npm install
npm run build
powershell -NoProfile -File scripts/install.ps1 -VaultPath "D:\YourVault" -Enable
```

`scripts/install.ps1` 会把 `dist/` 复制进 vault；如果 `bin/fqsidecar.exe` 存在，也会一起复制。

### 构建侧车（可选，独立仓库）

侧车源码、fqapp 适配层和编译脚本都在
[`Yolkbun/ex-libris-sidecar`](https://github.com/Yolkbun/ex-libris-sidecar)，
按那边的 README 构建即可；本仓库不包含侧车源码和二进制。

> Windows SmartScreen 可能拦截首次运行：本地编译、未签名的自用 exe，选“更多信息 → 仍要运行”。
> 不做代码签名。

## 使用

### 添加新书

- **有链接**：`Ctrl+P` → **从链接加入书架**，粘贴 `fanqienovel.com/page/<id>`（整段分享文案也可以）。
- **只知道书名**：书架工具栏 **＋ 添加番茄书**，或 `Ctrl+P` → **搜索番茄小说并加入**；勾选后批量加入，或右键单本加入。
- **豆瓣**：书架工具栏 **＋ 豆瓣**，或 `Ctrl+P` → **搜索豆瓣并加入**；支持书/影/剧，不需要 `obsidian-douban`，也不需要侧车。
- 已经用 `obsidian-douban` 导入的条目仍会被识别，两种方式可以共存。

加完若书架没显示，执行 **重建书架缓存**。详细步骤、重复处理、失败排查见
[使用指南 §3 添加内容](docs/使用指南.md#3-添加内容)。

### 命令

| 命令 | 作用 |
|---|---|
| `打开书架` | 打开书架视图 |
| `从链接加入书架` | 粘贴 `fanqienovel.com/page/<id>` |
| `搜索番茄小说并加入` | 搜索 + 复选框批量 + 右键单本 |
| `导出当前章节` / `导出整本番茄书` | 唯一会落盘正文的路径 |
| `把番茄书挂靠到豆瓣条目` | 只写 `fq_related` |
| `添加书架预设` | 状态/类型/来源/标签 |
| `重启番茄侧车` | 显示 `/health` 结果 |
| `刷新当前书目录` | 立即重新拉取当前/选中番茄书的目录 |
| `搜索豆瓣并加入` | 搜索豆瓣书/影/剧并加入书架 |
| `本地化所有远程封面` | 断网可读 |
| `清理章节与封面缓存` / `重建书架缓存` | 维护 |

### 阅读器快捷键

`←` / `→`、`j` / `k` 翻章，`Ctrl+E` 导出本章，`Ctrl+Shift+E` 摘录选中文字。

### 摘录格式

```markdown
> [!quote] 摘录
> 正文一段……
> — 《十日终焉》· 第 1 章 空屋 · [回跳](obsidian://ex-libris?book=7143038691944959011&chapter=1)
```

有 `## 摘录` 就插到它下面，否则文末新建；超过 800 字截断并提示。

### Bases

`.base` 里视图类型选 **Ex Libris 书架**；选项有 `coverWidth`（100–220）与 `showProgress`。
示例见 [`examples/Library.base`](examples/Library.base)。

## 豆瓣联动（可选）

两种豆瓣方式可以二选一，也可以共存：

| | 内建豆瓣搜索 | 联动 `obsidian-douban` |
|---|---|---|
| 登录豆瓣 | 不需要 | 需要 |
| 数据来源 | 公开搜索（书/影/剧） | 你标记过的书影音 |
| 状态/评分 | 默认 `想读` / `想看` | 保留你原来的 `myState` / `myRating` |
| 网络 | 搜索时访问豆瓣 | 导入时由 douban 插件访问 |
| 写入 | 新建轻笔记 | **只读**，不改豆瓣笔记 |

开启方式：设置 → Ex Libris → **联动 obsidian-douban**（默认开启）。关闭后只显示番茄条目和
内建豆瓣搜索添加的条目（带 `ex_libris: douban-search`）。

完整步骤、字段映射、重复条目处理见
[使用指南 §3.3c](docs/使用指南.md#333c-联动-obsidian-douban可选)。

## 架构

```
视图层（Bases / 书架 / 阅读器 / 书评 / 设置）
        │ ShelfItem[]（唯一内部契约）
领域层（entries / cover / exporter / progress / cache）
        │ HTTP 127.0.0.1 + X-FQ-Token
fqsidecar.exe（独立仓库 ex-libris-sidecar）
        │ 本进程内调用
fqapi_core（vendor/fqapp，GPL-3.0）：设备注册、签名、拉取、解密
```

三条硬边界：视图不直连侧车；领域层没有 DOM；侧车不知道 Obsidian。

设计取舍见 [`docs/adr/`](docs/adr/)；上游适配与侧车构建见 [ex-libris-sidecar](https://github.com/Yolkbun/ex-libris-sidecar)。

## 数据与隐私

```
<vault>/.obsidian/plugins/ex-libris/
  bin/fqsidecar.exe
  data/progress.json        # 阅读位置，5s 节流原子写
  data/meta.json            # lastCleanup / presets / 侧车状态与 stderr 尾巴
  data/device_pool.json     # 侧车自己的设备池（不写笔记、不写日志）
  cache/chapters/**         # 正文缓存，可整目录删除
  cache/toc/*.json
  cache/covers/*.jpg
```

- token 每次启动随机生成，只走环境变量 `FQ_TOKEN`，不落盘；日志里会被替换成 `***`。
- 插件本身不联网（无遥测、无更新检查）；只有打开番茄、加入书架、本地化封面时才请求。
- 正文只进 `cache/` 与显式导出目录，笔记里只有 frontmatter；`Ctrl+F` 搜不到正文。
- 侧车只监听 `127.0.0.1`，无窗口、无托盘、不写注册表。

### 网络使用披露

| 场景 | 请求目标 | 内容 |
|---|---|---|
| 打开/搜索/加入番茄书 | 侧车 `127.0.0.1` | 侧车再请求番茄上游（搜索、目录、正文、书评） |
| 封面显示 | 豆瓣/番茄图床 | 只下载封面图片；可关闭本地化，或让它缓存到本机 |
| 豆瓣条目 | 无 | 只读 vault 里的 frontmatter |

没有客户端遥测；不会上传笔记、书架或阅读记录。侧车启动时会匿名注册一个设备 id，
存放在插件目录的 `data/device_pool.json`，不同步、不上传。

### 访问 vault 之外的文件

插件默认只读写 `<vault>/.obsidian/plugins/ex-libris/`。设置里的“侧车路径覆盖”
允许你指向别的 exe 路径（例如开发目录），此时会读取并启动该文件；不设置时不会。

## 开发与测试

```powershell
npm run dev        # esbuild watch
npm run build      # bundle + tsc --noEmit
npm test           # 38 个无头测试（jsdom + mock Obsidian + 真实子进程）
npm run sidecar    # 编译侧车
```

测试覆盖：渲染纯函数、frontmatter 补写、筛选、摘录块、缓存清理、原子写、路径穿越；
插件加载/视图注册/Bases/书架渲染；侧车的 token 401、检索、正文、书评、`stop()` 后进程消失、
stdin EOF 退出、闲置退出、父进程消失退出、`DEVICE_EXPIRED` 重启重试；
阅读器翻章、`progress.json`、frontmatter 摘要、断点续读、回跳、摘录、删除 cache 后恢复；
以及真实 `bin/fqsidecar.exe` 的生命周期。

2026-11-08：`38 passed / 0 failed`。真实 Obsidian 1.15.0 中已验证书架与阅读器
（截图见文首），真实番茄接口跑通搜索/详情/1496 章目录/正文解密。

## 免责声明与商标

- 本项目与 **ByteDance / 番茄小说**、**豆瓣**、**Obsidian**、**Clarivate / Ex Libris**
  均无关联，也未获得其授权或背书。
- 插件仅用于个人学习与研究，处理**你有权访问**的内容；不提供、不托管、不分发任何书籍正文。
  正文只以缓存形式留在你自己的 vault 插件目录，供离线阅读。
- 侧车的上游实现来自开源项目 [ch6vip/fqapp](https://github.com/ch6vip/fqapp)（GPL-3.0）。
  对上游接口的访问可能受番茄小说的服务条款与当地法律限制；是否使用、如何使用由使用者自行判断，
  作者不对使用后果承担责任。
- 本项目不绕过付费墙，也不鼓励批量下载或二次分发内容。
- “Ex Libris”一词取自拉丁语“某某的藏书中”，与 Clarivate 旗下 Ex Libris 产品无关。
- 如权利人认为本项目侵犯其权益，请通过 GitHub Issues 联系，我们会及时处理。

## 更新日志

每个版本都有独立 release notes，汇总见 [**CHANGELOG.md**](CHANGELOG.md)；
发布记录在 [GitHub Releases](https://github.com/Yolkbun/obsidian-ex-libris/releases)。

## 许可证与来源

- 本插件：**GPL-3.0-or-later**，见 [`LICENSE`](LICENSE)。
- 侧车、fqapp 适配层与 vendored 源码：
  [`Yolkbun/ex-libris-sidecar`](https://github.com/Yolkbun/ex-libris-sidecar)（GPL-3.0，
  含 [ch6vip/fqapp](https://github.com/ch6vip/fqapp) 的完整对应源码与署名）。
- 豆瓣数据由 [Wanxp/obsidian-douban](https://github.com/Wanxp/obsidian-douban) 生产，本项目只读。
- 详见 [`NOTICE`](NOTICE)。

## 常见问题

**书架是空的？** 只认 frontmatter：豆瓣用 obsidian-douban 导入，番茄用“从链接加入”。

**番茄入口灰的？** 设置页看“重启并检查”，会显示侧车状态与 stderr 最后 20 行。

**为什么搜不到正文？** 设计如此：正文只在 `cache/` 与显式导出目录。

**阅读器空白/标题只有“Ex Libris 阅读器”？** 从命令面板或书架点书打开；
直接改 `workspace.json` 塞 reader 状态不被 Obsidian 支持。

**上游改版了？** 见 [ex-libris-sidecar](https://github.com/Yolkbun/ex-libris-sidecar)：更新 `vendor/fqapp` 后重编侧车并换 `fqsidecar.exe`，插件不用动。
