"""生成测试 vault 的封面与笔记夹具。"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import shutil

root = Path(__file__).resolve().parent.parent
vault = root / ".test-vault"
if vault.exists():
    shutil.rmtree(vault)

(vault / ".obsidian/plugins/ex-libris").mkdir(parents=True)
(vault / "Library/book").mkdir(parents=True)
(vault / "Books").mkdir(parents=True)
(vault / "Notes").mkdir(parents=True)
(vault / "assets/covers").mkdir(parents=True)

# 覆盖层：直接复制构建产物
for name in ["main.js", "manifest.json", "styles.css"]:
    shutil.copy2(root / "dist" / name, vault / ".obsidian/plugins/ex-libris" / name)

plugin_dir = vault / ".obsidian/plugins/ex-libris"
(plugin_dir / "data.json").write_text(
    """{
  "openShelfOnStartup": true,
  "sidecarEnabled": false,
  "cacheRemoteCovers": false,
  "libraryRoot": "Library",
  "coverWidth": 148,
  "showProgress": true,
  "gap": 20
}
""",
    encoding="utf-8",
)

def cover(path: Path, top: str, bottom: str, label: str) -> None:
    image = Image.new("RGB", (600, 900))
    draw = ImageDraw.Draw(image)
    top_rgb = tuple(int(top[i : i + 2], 16) for i in (1, 3, 5))
    bottom_rgb = tuple(int(bottom[i : i + 2], 16) for i in (1, 3, 5))
    for y in range(900):
        ratio = y / 899
        color = tuple(int(top_rgb[i] * (1 - ratio) + bottom_rgb[i] * ratio) for i in range(3))
        draw.line([(0, y), (600, y)], fill=color)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 64)
        small = ImageFont.truetype("C:/Windows/Fonts/georgia.ttf", 30)
    except OSError:
        font = ImageFont.load_default()
        small = ImageFont.load_default()
    draw.text((60, 90), "EX LIBRIS", font=small, fill=(255, 250, 240))
    draw.text((60, 700), label, font=font, fill=(255, 250, 240))
    draw.line([(60, 660), (540, 660)], fill=(255, 250, 240), width=2)
    image.save(path, quality=92)

cover(vault / "assets/covers/old-book.png", "#3f5d52", "#1d2b26", "Old Books")
cover(vault / "assets/covers/night-ship.png", "#4a3f5d", "#221c2d", "Night Ship")
cover(vault / "assets/covers/ink-moon.png", "#5d3f3f", "#2b1d1d", "Ink Moon")

(vault / "Books/旧书摊.md").write_text(
    """---
id: "1001"
title: 旧书摊
type: book
score: 8.6
imageData:
  large: assets/covers/old-book.png
  url: assets/covers/old-book.png
cover: assets/covers/old-book.png
myState: 读过
myRating: 4
datePublished: 2018-05-01
myCollectionDate: 2025-03-02
publisher: 纸上出版社
myTags: [随笔, 旧书]
---

# 旧书摊

一本讲旧书摊与藏书票的随笔集。
""",
    encoding="utf-8",
)

(vault / "Books/夜航.md").write_text(
    """---
id: "1002"
title: 夜航
type: movie
score: 8.2
imageData:
  large: assets/covers/night-ship.png
cover: assets/covers/night-ship.png
myState: 想看
myCollectionDate: 2024-10-11
---

# 夜航

一部关于夜航船的电影。
""",
    encoding="utf-8",
)

(vault / "Books/墨月.md").write_text(
    """---
id: "1003"
title: 墨月
type: music
score: 7.9
imageData:
  large: assets/covers/ink-moon.png
cover: assets/covers/ink-moon.png
myState: 在听
myCollectionDate: 2026-01-20
---

# 墨月
""",
    encoding="utf-8",
)

(vault / "Library/book/藏书票样章.md").write_text(
    """---
type: book
source: fanqie
title: 藏书票样章
author: Ex Libris
status: 在追
cover: ""
fq_book_id: "7143038691944959011"
fq_cover_url: ""
fq_serial_status: 完结
fq_word_count: 12600
fq_chapter_total: 3
fq_reading_chapter: 第一章 纸片与印章
fq_progress: 0
fq_unread_count: 3
fq_last_read_at: 2026-11-01T10:00:00+08:00
fq_related: ""
created: 2026-11-01
tags: [book, fanqie]
---

# 藏书票样章

> Ex Libris · 完结
""",
    encoding="utf-8",
)

(vault / "Notes/摘录本.md").write_text(
    """# 摘录本

用来收集带出处的摘录。

## 摘录
""",
    encoding="utf-8",
)

(vault / "Library.base").write_text(
    """filters:
  and:
    - file.ext == "md"
views:
  - type: ex-libris-shelf
    name: Ex Libris 书架
    limit: 100
""",
    encoding="utf-8",
)

(vault / ".obsidian/community-plugins.json").write_text('["ex-libris"]\n', encoding="utf-8")
(vault / ".obsidian/core-plugins.json").write_text(
    """{
  "file-explorer": true,
  "global-search": true,
  "switcher": true,
  "graph": true,
  "backlink": true,
  "canvas": true,
  "outgoing-link": true,
  "tag-pane": true,
  "properties": true,
  "page-preview": true,
  "daily-notes": true,
  "templates": true,
  "note-composer": true,
  "command-palette": true,
  "editor-status": true,
  "bookmarks": true,
  "outline": true,
  "word-count": true,
  "file-recovery": true,
  "bases": true
}
""",
    encoding="utf-8",
)
(vault / ".obsidian/app.json").write_text('{"promptDelete": false}\n', encoding="utf-8")
(vault / ".obsidian/appearance.json").write_text('{"theme": "obsidian", "accentColor": "#a06a3c"}\n', encoding="utf-8")

print(f"test vault ready: {vault}")
