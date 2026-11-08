//! 上游提供者接口。
//!
//! 插件只认本地 HTTP 契约；上游怎么变都收敛在这一层（规格 12）。
//! 当前仓库带两个实现：
//!   - `demo`：离线样章，用于自检与端到端测试；
//!   - `fanqie`：真实上游适配器占位（P2 待移植，见 README 与 ADR-0002）。

use crate::json::Json;

pub struct BookBrief {
    pub id: String,
    pub title: String,
    pub author: String,
    pub cover_url: String,
    pub word_count: u64,
    pub serial_status: String,
    pub category: String,
    pub intro: String,
}

impl BookBrief {
    pub fn to_json(&self) -> Json {
        Json::obj(vec![
            ("id", Json::str(self.id.clone())),
            ("title", Json::str(self.title.clone())),
            ("author", Json::str(self.author.clone())),
            ("cover_url", Json::str(self.cover_url.clone())),
            ("word_count", Json::num(self.word_count as f64)),
            ("serial_status", Json::str(self.serial_status.clone())),
            ("category", Json::str(self.category.clone())),
            ("intro", Json::str(self.intro.clone())),
        ])
    }
}

pub struct BookDetail {
    pub brief: BookBrief,
    pub last_chapter_title: String,
    pub chapter_total: u64,
}

impl BookDetail {
    pub fn to_json(&self) -> Json {
        let mut pairs = match self.brief.to_json() {
            Json::Object(pairs) => pairs,
            _ => Vec::new(),
        };
        pairs.push(("book_id".to_string(), Json::str(self.brief.id.clone())));
        pairs.push((
            "last_chapter_title".to_string(),
            Json::str(self.last_chapter_title.clone()),
        ));
        pairs.push((
            "chapter_total".to_string(),
            Json::num(self.chapter_total as f64),
        ));
        Json::Object(pairs)
    }
}

pub struct ChapterMeta {
    pub id: String,
    pub title: String,
    pub index: u64,
}

impl ChapterMeta {
    pub fn to_json(&self) -> Json {
        Json::obj(vec![
            ("id", Json::str(self.id.clone())),
            ("title", Json::str(self.title.clone())),
            ("index", Json::num(self.index as f64)),
        ])
    }
}

pub struct Chapter {
    pub id: String,
    pub book_id: String,
    pub title: String,
    pub index: u64,
    pub paragraphs: Vec<String>,
    pub prev: Option<String>,
    pub next: Option<String>,
}

impl Chapter {
    pub fn to_json(&self) -> Json {
        Json::obj(vec![
            ("id", Json::str(self.id.clone())),
            ("book_id", Json::str(self.book_id.clone())),
            ("title", Json::str(self.title.clone())),
            ("index", Json::num(self.index as f64)),
            (
                "paragraphs",
                Json::Array(self.paragraphs.iter().map(|p| Json::str(p.clone())).collect()),
            ),
            ("prev", option_string(&self.prev)),
            ("next", option_string(&self.next)),
        ])
    }
}

pub struct Comment {
    pub user: String,
    pub avatar: String,
    pub content: String,
    pub likes: u64,
    pub time: String,
}

impl Comment {
    pub fn to_json(&self) -> Json {
        Json::obj(vec![
            ("user", Json::str(self.user.clone())),
            ("avatar", Json::str(self.avatar.clone())),
            ("content", Json::str(self.content.clone())),
            ("likes", Json::num(self.likes as f64)),
            ("time", Json::str(self.time.clone())),
        ])
    }
}

fn option_string(value: &Option<String>) -> Json {
    match value {
        Some(text) => Json::str(text.clone()),
        None => Json::Null,
    }
}

#[derive(Debug, Clone)]
pub struct ApiError {
    pub code: &'static str,
    pub message: String,
    pub status: u16,
}

impl ApiError {
    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "NOT_FOUND",
            message: message.into(),
            status: 404,
        }
    }

    pub fn upstream(message: impl Into<String>) -> Self {
        Self {
            code: "UPSTREAM_TIMEOUT",
            message: message.into(),
            status: 502,
        }
    }

    #[allow(dead_code)]
    pub fn rate_limited(message: impl Into<String>) -> Self {
        Self {
            code: "RATE_LIMITED",
            message: message.into(),
            status: 429,
        }
    }

    #[allow(dead_code)]
    pub fn decrypt_failed(message: impl Into<String>) -> Self {
        Self {
            code: "DECRYPT_FAILED",
            message: message.into(),
            status: 500,
        }
    }

    pub fn to_json(&self) -> Json {
        Json::obj(vec![
            (
                "error",
                Json::obj(vec![
                    ("code", Json::str(self.code)),
                    ("message", Json::str(self.message.clone())),
                ]),
            ),
        ])
    }
}

pub trait Provider: Send + Sync {
    fn name(&self) -> &'static str;
    fn device_ready(&self) -> bool;
    fn search(&self, query: &str, page: u64, limit: u64) -> Result<Vec<BookBrief>, ApiError>;
    fn resolve(&self, url: &str) -> Result<String, ApiError>;
    fn book(&self, book_id: &str) -> Result<BookDetail, ApiError>;
    fn chapters(&self, book_id: &str) -> Result<Vec<ChapterMeta>, ApiError>;
    fn chapter(&self, chapter_id: &str) -> Result<Chapter, ApiError>;
    fn comments(
        &self,
        book_id: &str,
        chapter_id: &str,
        page: u64,
    ) -> Result<(u64, Vec<Comment>), ApiError>;
}

pub mod demo;
pub mod fanqie;
