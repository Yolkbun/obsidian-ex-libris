# Changelog

All notable changes to **Ex Libris Bookplate** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions use [SemVer](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-11-08

### Added

- Reader text annotations: highlight, font color (red/blue/green) and copy from a selection toolbar.
- Highlight/color edits auto-export the selected text and its paragraph to `annotations/<book>/<chapter>.md`, with `data/annotations.json` for restoring visuals.
- Copy and normal reading still write nothing; full-chapter export stays separate.

## [0.2.1] - 2026-11-08

### Added

- Fanqie chapter TOC: reader **目录** button, `T` shortcut and command palette entry, with searchable list and current-chapter highlight.

## [0.2.0] - 2026-11-08

### Added

- Built-in Douban music search (albums/artists) with batch add, `music` type and `想听` default.
- Douban search modal now has 书 / 影·剧 / 音 tabs.

## [0.1.9] - 2026-11-08

### Added

- Fanqie entries use `type: novel`, separate from Douban books (`book`); new **小说** type filter and counts.
- Existing Fanqie notes are normalized when read, no migration required.

## [0.1.8] - 2026-11-08

### Fixed

- Douban covers: send `Referer`/`User-Agent` (418 without it), upgrade search thumbnails to large images, and store `imageData` as a fallback.


## [0.1.7] - 2026-11-08

### Added

- Optional linkage with `obsidian-douban`: a setting to read (or ignore) entries it imports.
- `CHANGELOG.md`, per-version release notes, and a release-notes check in `scripts/make-release.ps1`.

### Changed

- README redesign: banner, badges, table of contents, screenshot gallery, optional-integration guide.
- Douban-search notes are marked with `ex_libris: douban-search` so they stay visible when external linkage is off.

### Docs

- Guide section for the optional `obsidian-douban` linkage, including field mapping and coexistence rules.

## [0.1.6] - 2026-11-08

### Added

- Built-in Douban search and add: books, movies and TV, without `obsidian-douban` or the sidecar.
- Shelf toolbar **＋ 豆瓣** and command **Search Douban and add**.

### Changed

- Douban requests use the public suggest endpoint; failures report rate limiting instead of silent errors.

## [0.1.5] - 2026-11-08

### Added

- Shelf toolbar **＋ 添加番茄书**, opening the existing Fanqie search/batch-add flow.

### Docs

- How to add a Douban-compatible note by hand when `obsidian-douban` is not installed.

## [0.1.4] - 2026-11-08

### Added

- Setting **目录刷新间隔** (0 = refresh on every open).
- Command **刷新当前书目录**, forcing a TOC refresh for the current or selected book.

## [0.1.3] - 2026-11-08

### Fixed

- Community review findings: lockfile, inline styles (`setCssStyles`/`setCssProps`), settings headings, English README, unsupported CSS.

### Changed

- `manifest.json` display name is now **Ex Libris Bookplate** (Basic Latin requirement).

## [0.1.2] - 2026-11-08

### Fixed

- Renamed the manifest display name away from Chinese characters so the community directory accepts it.

## [0.1.1] - 2026-11-08

### Added

- First-run, dismissible sidecar installation guide.
- Split packaging: plugin release contains only the three Obsidian files; the sidecar is a separate release.

## [0.1.0] - 2026-11-08

### Added

- iBooks-style shelf, Bases view, Douban frontmatter reading, Fanqie search/read/excerpt/export, sidecar.

[Unreleased]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.3.0...HEAD
[0.3.0]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.2.1...0.3.0
[0.2.1]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.9...0.2.0
[0.1.9]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.8...0.1.9
[0.1.8]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.7...0.1.8
[0.1.7]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.6...0.1.7
[0.1.6]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.5...0.1.6
[0.1.5]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.4...0.1.5
[0.1.4]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.3...0.1.4
[0.1.3]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/Yolkbun/obsidian-ex-libris/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/Yolkbun/obsidian-ex-libris/releases/tag/0.1.0
