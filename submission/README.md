# 发布到 GitHub / Obsidian 社区目录

## 仓库结构（两个仓库）

| 仓库 | 用途 | 是否提交社区 |
|---|---|---|
| `Yolkbun/obsidian-ex-libris` | 纯插件：`src/`、测试、README | ✅ 提交这个 |
| `Yolkbun/ex-libris-sidecar` | GPL 侧车：fqapp 适配层、vendored 源码、exe | ❌ 不提交 |

## 插件 Release（0.2.0）

只上传 Obsidian 安装器认的三个文件：

- `main.js`
- `manifest.json`
- `styles.css`

**不要**把 `fqsidecar.exe` 放进插件 release。侧车的 release 在另一个仓库：

- `sidecar-0.1.0`（标记 Pre-release）
  - `fqsidecar.exe`
  - `ex-libris-full-0.2.0.zip`（插件三件套 + `bin/fqsidecar.exe`）
  - `SHA256SUMS.txt`

## 提交社区目录

1. 打开 <https://community.obsidian.md>，用 Obsidian 账号登录。
2. 关联 GitHub 账号（验证仓库所有权）。
3. 添加插件，仓库地址填：

   ```
   https://github.com/Yolkbun/obsidian-ex-libris
   ```

4. 目录会读取默认分支 `main` 的 `manifest.json`（当前 `0.2.0`）。
5. 自动审查；有问题按提示改，然后发新的插件 release 并递增版本。

## 必须写进 README 的披露（已写）

- 侧车是可选组件，需手动从另一个 release 下载并放到 `bin/`；插件不自动下载/安装/更新。
- 首次运行缺少侧车时会弹一次安装引导（可勾选不再提示）。
- 网络使用：侧车请求番茄上游；封面从图床下载；无遥测。
- 访问 vault 外文件：仅在用户覆盖侧车路径时。
- GPL-3.0 与 fqapp 署名（侧车仓库提供完整对应源码）。

## 审核风险

1. 插件会 `spawn` 一个外部 exe（侧车）。README 已说明是手动安装的可选组件，但审核员仍可能追问。
2. 侧车包含上游正文解密实现。插件仓库本身不含该代码，但插件功能依赖它；仍可能因第三方服务条款被拒/下架。
3. 社区安装器不安装侧车，因此“社区版”番茄功能需要用户额外操作，体验上不完整。

## 检查清单

- [x] `manifest.json` 的 `id=ex-libris`，不含 `obsidian`
- [x] `minAppVersion=1.10.0`
- [x] `isDesktopOnly=true`
- [x] 命令 id 不含插件前缀
- [x] README 有 LICENSE、网络披露、侧车手动安装说明、免责声明
- [x] 插件 release `0.2.0` 只含三件套
- [x] 侧车 release 独立仓库、Pre-release
- [x] `versions.json` 已提交
- [x] `release-notes/<version>.md` 已写，并作为 GitHub release body
- [x] `CHANGELOG.md` 已更新
