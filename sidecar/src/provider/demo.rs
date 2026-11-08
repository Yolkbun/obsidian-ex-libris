//! 离线样章提供者。用于：
//!   1. 没有上游账号/网络时自检整条链路；
//!   2. 端到端测试（与 tools/dev-sidecar.mjs 用同一份文字）。
//! 它不读任何真实书，也不假装能连上游。

use super::{
    ApiError, BookBrief, BookDetail, Chapter, ChapterMeta, Comment, Provider,
};

const BOOK_ID: &str = "7143038691944959011";

struct DemoChapter {
    id: &'static str,
    title: &'static str,
    paragraphs: &'static [&'static str],
}

const CHAPTERS: &[DemoChapter] = &[
    DemoChapter {
        id: "900001",
        title: "第一章 纸片与印章",
        paragraphs: &[
            "旧书摊在巷口，木箱里摞着从上个世纪留下来的书。摊主说，翻到有书票的那一本，算你运气好。",
            "所谓书票，不过巴掌大的一张纸：上面有族徽、有拉丁文、有一句“从某人的藏书里来”。它贴在书封内侧，像一枚安静的印章。",
            "我把那张纸对着光看。纸很薄，边缘已经起毛，印上去的字却还清楚。那一刻我忽然明白，收藏不是占有，是替后来的读者保管一段时间。",
            "摊主收摊的时候，风把纸箱吹得发响。我买下那本书，也买下了书上那枚不属于我的印记。",
        ],
    },
    DemoChapter {
        id: "900002",
        title: "第二章 编号",
        paragraphs: &[
            "回到家，我给书架上的每一本书编号。编号写在卡片上，卡片夹在书里，不写在书页上。",
            "有的书已经读过三遍，有的只翻过前言。编号不区分这些，它只记录一件事：这本书曾经被认真地放上过一次书架。",
            "夜里停电，我借着手机的光继续写卡片。写到第七本的时候，我发现自己已经记不清前三本的标题，于是又从头看了一遍。",
            "这大概就是书架的意义：它不替你记住，但它让你有机会重新遇见。",
        ],
    },
    DemoChapter {
        id: "900003",
        title: "第三章 回跳",
        paragraphs: &[
            "摘录写进笔记之后，最要紧的是能跳回去。不能回跳的摘录，过几天就变成一句无主的话。",
            "所以我在每段摘录后面留一个链接：书名、章名、章序号。点开它，就该回到原来的那一页、那一行。",
            "有人觉得这样太麻烦。可一本书读到最后，真正留下的往往不是情节，而是某一句在当时恰好击中了你的话。",
            "为了让那句话随时可以回去，麻烦一点是值得的。",
        ],
    },
];

struct DemoComment {
    user: &'static str,
    content: &'static str,
    likes: u64,
    time: &'static str,
}

const COMMENTS: &[DemoComment] = &[
    DemoComment { user: "夜航船", content: "这一章的开头很有旧书摊的味道。", likes: 12, time: "2026-11-01" },
    DemoComment { user: "书页边", content: "藏书票这个说法第一次见，学到了。", likes: 7, time: "2026-11-02" },
    DemoComment { user: "半山", content: "编号那一段让我想起自己贴标签的日子。", likes: 3, time: "2026-11-03" },
    DemoComment { user: "无署名", content: "回跳确实是最实用的功能。", likes: 21, time: "2026-11-04" },
    DemoComment { user: "晚风", content: "读到最后一句有点感动。", likes: 0, time: "2026-11-05" },
    DemoComment { user: "白露", content: "希望作者多写一点书房的细节。", likes: 5, time: "2026-11-06" },
    DemoComment { user: "纸箱", content: "摊主那句“算你运气好”很妙。", likes: 9, time: "2026-11-07" },
];

pub struct DemoProvider;

impl DemoProvider {
    fn brief(&self) -> BookBrief {
        BookBrief {
            id: BOOK_ID.to_string(),
            title: "藏书票样章".to_string(),
            author: "Ex Libris".to_string(),
            cover_url: String::new(),
            word_count: 12_600,
            serial_status: "完结".to_string(),
            category: "示例".to_string(),
            intro: "侧车自检用的离线样章。它证明阅读器、进度、摘录与章评的链路是通的。".to_string(),
        }
    }
}

impl Provider for DemoProvider {
    fn name(&self) -> &'static str {
        "demo"
    }

    fn device_ready(&self) -> bool {
        true
    }

    fn search(&self, _query: &str, page: u64, limit: u64) -> Result<Vec<BookBrief>, ApiError> {
        if page > 1 || limit == 0 {
            return Ok(Vec::new());
        }
        Ok(vec![self.brief()])
    }

    fn resolve(&self, url: &str) -> Result<String, ApiError> {
        let digits: String = url.chars().filter(|ch| ch.is_ascii_digit()).collect();
        if digits.len() >= 6 {
            Ok(digits)
        } else {
            Ok(BOOK_ID.to_string())
        }
    }

    fn book(&self, book_id: &str) -> Result<BookDetail, ApiError> {
        if book_id != BOOK_ID {
            return Err(ApiError::not_found("demo 提供者只有一本样章"));
        }
        Ok(BookDetail {
            brief: self.brief(),
            last_chapter_title: CHAPTERS[CHAPTERS.len() - 1].title.to_string(),
            chapter_total: CHAPTERS.len() as u64,
        })
    }

    fn chapters(&self, book_id: &str) -> Result<Vec<ChapterMeta>, ApiError> {
        if book_id != BOOK_ID {
            return Err(ApiError::not_found("没有这本书"));
        }
        Ok(CHAPTERS
            .iter()
            .enumerate()
            .map(|(index, chapter)| ChapterMeta {
                id: chapter.id.to_string(),
                title: chapter.title.to_string(),
                index: index as u64,
            })
            .collect())
    }

    fn chapter(&self, chapter_id: &str) -> Result<Chapter, ApiError> {
        let position = CHAPTERS
            .iter()
            .position(|chapter| chapter.id == chapter_id)
            .ok_or_else(|| ApiError::not_found("没有这一章"))?;
        let chapter = &CHAPTERS[position];
        Ok(Chapter {
            id: chapter.id.to_string(),
            book_id: BOOK_ID.to_string(),
            title: chapter.title.to_string(),
            index: position as u64,
            paragraphs: chapter.paragraphs.iter().map(|p| p.to_string()).collect(),
            prev: if position > 0 {
                Some(CHAPTERS[position - 1].id.to_string())
            } else {
                None
            },
            next: CHAPTERS.get(position + 1).map(|next| next.id.to_string()),
        })
    }

    fn comments(
        &self,
        _book_id: &str,
        _chapter_id: &str,
        page: u64,
    ) -> Result<(u64, Vec<Comment>), ApiError> {
        let per_page = 3u64;
        let start = page.saturating_sub(1) * per_page;
        let items: Vec<Comment> = COMMENTS
            .iter()
            .skip(start as usize)
            .take(per_page as usize)
            .map(|comment| Comment {
                user: comment.user.to_string(),
                avatar: String::new(),
                content: comment.content.to_string(),
                likes: comment.likes,
                time: comment.time.to_string(),
            })
            .collect();
        Ok((COMMENTS.len() as u64, items))
    }
}
