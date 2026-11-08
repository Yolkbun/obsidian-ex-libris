# 发布到 GitHub / Obsidian 社区目录

## 一、GitHub Release（安装包）

Obsidian 安装插件时只会下载 release 里的：

- `main.js`
- `manifest.json`
- `styles.css`

侧车 `fqsidecar.exe` **不会**被 Obsidian 自动安装，必须作为额外资产附在 release 里，
并在 README 里写清楚手动放置的位置（`.obsidian/plugins/ex-libris/bin/`）。

打包：

```powershell
powershell -NoProfile -File scripts/make-release.ps1 -Version 0.1.0
```

产物在 `release/0.1.0/`，同时生成 `release/ex-libris-0.1.0.zip`
（解压后是一个 `ex-libris/` 文件夹，适合手动安装）。

## 二、Obsidian 社区目录提交

1. 仓库必须是 **public**，根目录有 `README.md`、`LICENSE`、`manifest.json`。
2. `manifest.json` 的 `version` 必须是 `x.y.z`，且与 release 的 tag 完全一致。
3. 打开 <https://community.obsidian.md>，用 **Obsidian 账号**登录。
4. 关联 GitHub 账号（用于验证仓库所有权）。
5. 添加插件，填写仓库地址；目录会读取默认分支 HEAD 的 `manifest.json`。
6. 按自动审查结果修正问题，重新发 release 并递增版本。

## 三、必须写进 README 的披露（政策要求）

- **网络使用**：侧车请求番茄上游；封面从豆瓣/番茄图床下载；无遥测。
- **访问 vault 之外的文件**：侧车默认在插件目录内，但设置允许覆盖路径；
  启动子进程需要读取该 exe。
- **账号**：不需要番茄账号；不需要豆瓣账号（数据来自 obsidian-douban）。
- **开源许可**：GPL-3.0，包含 fqapp 的 GPL 代码与署名。

## 四、社区审核可能卡住的点

1. 插件会启动一个外部可执行文件（侧车）。政策只明确禁止“自动安装/更新依赖”，
   我们是让用户手动放 exe，但审核员仍可能要求说明或拒绝。
2. 侧车包含对上游加密正文的解密实现。Obsidian 的政策没有逐条禁止，但涉及
   第三方服务条款与版权，存在被下架的风险。
3. 侧车无法通过 Obsidian 安装器分发，社区版用户必须额外下载，体验不完整。

## 五、给提交者的检查清单

- [ ] `manifest.json` 的 `id` 是 `ex-libris`，不含 `obsidian`
- [ ] `minAppVersion` = `1.10.0`（Bases API）
- [ ] `isDesktopOnly` = `true`
- [ ] 命令 id 不含插件前缀
- [ ] README 有 LICENSE、网络披露、侧车手动安装说明、免责声明
- [ ] release tag = `0.1.0`，资产含 `main.js` / `manifest.json` / `styles.css`
- [ ] 额外资产 `fqsidecar.exe` 附在 release 里
- [ ] `versions.json` 已提交
