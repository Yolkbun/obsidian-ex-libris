//! 真实上游适配器（P2 待移植）。
//!
//! 本文件保留完整的方法签名与错误语义，但不做任何网络请求：
//! 番茄正文是加密的，正确链路是
//!   注册设备 → `reading/crypt/registerkey` 换密钥 →
//!   `reading/reader/full` / `batch_full` → 本地解密
//! 这一段必须从 ch6vip/fqapp 的 core（GPL-3.0）移植过来，
//! 包括 TTEncrypt、Gorgon/Argus 签名与 registerkey 的解密。
//! 详见 docs/adr/0002-sidecar-upstream.md 与 README 的"已知缺口"。
//!
//! 在移植完成前，用 `--provider demo` 可以完整自检插件侧链路。

use super::{ApiError, BookBrief, BookDetail, Chapter, ChapterMeta, Comment, Provider};

pub struct FanqieProvider {
    #[allow(dead_code)]
    data_dir: String,
}

impl FanqieProvider {
    pub fn new(data_dir: impl Into<String>) -> Self {
        Self {
            data_dir: data_dir.into(),
        }
    }

    fn not_wired(&self) -> ApiError {
        ApiError::upstream(
            "上游适配器尚未接入：需要从 fqapp core 移植设备注册与正文解密（P2）。可先用 --provider demo 自检。",
        )
    }
}

impl Provider for FanqieProvider {
    fn name(&self) -> &'static str {
        "fanqie"
    }

    fn device_ready(&self) -> bool {
        false
    }

    fn search(&self, _query: &str, _page: u64, _limit: u64) -> Result<Vec<BookBrief>, ApiError> {
        Err(self.not_wired())
    }

    fn resolve(&self, url: &str) -> Result<String, ApiError> {
        // resolve 只做纯文本解析，可以先于上游接入工作。
        let digits: String = url
            .chars()
            .filter(|ch| ch.is_ascii_digit())
            .collect();
        if digits.len() >= 6 {
            Ok(digits)
        } else {
            Err(ApiError::not_found("链接里没有书籍 id"))
        }
    }

    fn book(&self, _book_id: &str) -> Result<BookDetail, ApiError> {
        Err(self.not_wired())
    }

    fn chapters(&self, _book_id: &str) -> Result<Vec<ChapterMeta>, ApiError> {
        Err(self.not_wired())
    }

    fn chapter(&self, _chapter_id: &str) -> Result<Chapter, ApiError> {
        Err(self.not_wired())
    }

    fn comments(
        &self,
        _book_id: &str,
        _chapter_id: &str,
        _page: u64,
    ) -> Result<(u64, Vec<Comment>), ApiError> {
        Err(self.not_wired())
    }
}
