# 验收记录

日期：2026-11-08
Obsidian：1.15.0（`D:\App\Obsidian`）
测试 vault：`D:\Ex Libris\.test-vault`（`scripts/make-test-vault.py` 生成，已 gitignore）

图例：✅ 已验证 · 🟡 部分验证 · ⛔ 未做

| # | 规格第 10 节条目 | 结果 | 证据 |
|---|---|---|---|
| 1 | 冷启动 1 秒内出首帧、封面不闪 | 🟡 | 真实 Obsidian 中书架自动恢复/打开，封面立即出现（截图 `docs/screenshots/test-vault-shelf.png`）。"1 秒"未做 instrumented 计时。 |
| 2 | 关闭 Obsidian 后无 `fqsidecar.exe` | ✅ | 真实 exe 的 `stdin EOF → exit(0)` 由 `tests/real-sidecar.test.mjs` 验证；插件 `stop()` 的 POST `/shutdown` → 1.5s → 侧车 stdin → `taskkill` 路径由 `tests/sidecar.test.mjs` 验证。Obsidian 关闭本身未重复抓进程列表。 |
| 3 | 强杀 Obsidian 后 15 秒内侧车消失 | 🟡 | 父进程存活检查（10s）与 stdin EOF 都在共享生命周期代码里；dev 侧车已用 200ms 检查周期实测退出。真实 exe 的父检查未单独实测（逻辑相同）。 |
| 4 | 侧车未起时书架正常、番茄入口降级 | ✅ | 真实 Obsidian：缺 `bin/fqsidecar.exe` 时插件照常加载，`meta.json` 记录 `sidecarState: degraded / missing-binary`，书架/豆瓣正常；修复后 `sidecarState: ready`。 |
| 5 | 阅读 200 章 vault 文件数不增加 | ✅（设计+测试） | 正文只进 `cache/`（ADR-0005）；`tests/reader.test.mjs` 读 2 章后断言笔记里没有正文。真实读取《十日终焉》第 1 章 66 段后，vault 只增加 `cache/chapters/**`。 |
| 6 | 摘录后点回跳能精确回章节 | ✅ | `tests/reader.test.mjs` 验证 callout 与 `chapter=1` 链接；协议 handler 在真实 Obsidian 中打开到第 1 章（日志：`chapter loaded 7173216089122439711 paras=66`）。 |
| 7 | 删除 `cache/` 后仍正常 | ✅ | `tests/reader.test.mjs`：删 `cache/` 后翻章成功（重新拉取）。 |
| 8 | 断网时封面走本地、正文报可读错误 | 🟡 | 本地/缓存封面解析有单测；真实断网未模拟。正文错误映射覆盖 `SIDECAR_UNAVAILABLE` / `UPSTREAM_TIMEOUT` / `DECRYPT_FAILED`。 |
| 9 | `Ctrl+F` 搜不到正文 | ✅ | 正文不落 vault；`tests/reader.test.mjs` 断言番茄笔记不含正文。 |

## 真实上游联调（新增）

- 侧车仓库 `ex-libris-sidecar`（`sidecar-upstream` + vendored `fqapi_core`）请求真实番茄：
  - 搜索「诡秘之主」→ 返回真实书籍（含《诡秘之主》原创解读等）；
  - 《十日终焉》详情：`book_name=十日终焉`、`serial_count=1496`；
  - 目录：1496 章，第 1 章 `7173216089122439711 / 第1章 空屋`；
  - 正文：解密成功，66 段纯文本（首段重复章名已去掉）；
  - 书评：`comment_cnt=438960`，首页 20 条，含用户名/头像/点赞/日期。
- 真实 Obsidian 阅读器加载同一本书：截图 `docs/screenshots/test-vault-reader.png`，
  日志确认 `chapter loaded ... paras=66`。
- `bin/fqsidecar.exe` 4.9 MB；`tests/real-sidecar.test.mjs` 验证 token 401、health、stdin EOF 退出。

## 已知偏差

1. **书评代替段评**：段评需要 `item_version`，接口不带时返回空壳；改用书评并在 UI 标注“书评”。
2. **目录/正文依赖上游**：上游改版需在侧车仓库更新 `vendor/fqapp` 并重编侧车；插件契约不变。
3. **没有移动端**；侧车是 Windows exe。
4. **Bases 视图选项**：工厂与渲染在无头环境验证，真实 Obsidian 中未逐个点击 slider/toggle。
5. **真实 Obsidian 阅读器截图**为 150% 系统缩放下的窗口；用户要求不改系统/应用缩放，故未重拍 100%。

## 复现

```powershell
npm install
npm run build
powershell -NoProfile -File scripts/install.ps1 -VaultPath "D:\YourVault" -Enable
# 侧车：https://github.com/Yolkbun/ex-libris-sidecar
npm test
```
