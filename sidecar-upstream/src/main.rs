//! Ex Libris 侧车：真实番茄上游版本。
//!
//! 这里不重新实现设备注册/签名/解密，而是复用 vendored 的 fqapp core
//! （`vendor/fqapp/rust`，GPL-3.0，ch6vip）。本文件只做三件事：
//!   1. 把侧车的本地 HTTP 契约翻译成 fqapp core 的 `/api/v1/*` 调用；
//!   2. 把上游 JSON 归一化成插件的契约（BookBrief / Chapter / ...）；
//!   3. 维持与零依赖版本相同的生命周期（stdin EOF / 父进程 / 闲置退出）。
//!
//! 调试用 `--probe "/api/v1/..."` 直接打印上游原始 JSON。

use std::collections::HashMap;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fqsidecar_core::http::{read_request, write_json, Request};
use fqsidecar_core::json::Json;
use fqsidecar_core::provider::{
    ApiError, BookBrief, BookDetail, Chapter, ChapterMeta, Comment, Provider,
};
use serde_json::Value;

const VERSION: &str = "0.2.0-upstream";

struct Config {
    port: u16,
    data_dir: String,
    token: String,
    parent_pid: Option<u32>,
    idle_ms: u64,
    probe: Option<String>,
}

impl Config {
    fn from_args(args: &HashMap<String, String>) -> Result<Self, String> {
        let port = args
            .get("port")
            .ok_or_else(|| "--port is required".to_string())?
            .parse::<u16>()
            .map_err(|_| "--port must be a number".to_string())?;
        let token = std::env::var("FQ_TOKEN").map_err(|_| "FQ_TOKEN is required".to_string())?;
        if token.trim().is_empty() {
            return Err("FQ_TOKEN is empty".to_string());
        }
        Ok(Self {
            port,
            data_dir: args
                .get("data-dir")
                .cloned()
                .unwrap_or_else(|| ".".to_string()),
            token,
            parent_pid: args
                .get("parent-pid")
                .and_then(|value| value.parse::<u32>().ok()),
            idle_ms: args
                .get("idle-ms")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(5 * 60_000),
            probe: args.get("probe").cloned(),
        })
    }
}

fn main() {
    let args = parse_args();
    let config = match Config::from_args(&args) {
        Ok(config) => config,
        Err(message) => {
            eprintln!("fqsidecar: {message}");
            std::process::exit(2);
        }
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("fqsidecar: build runtime: {err}");
            std::process::exit(3);
        }
    };
    let handle = runtime.handle().clone();

    if let Err(message) = prepare_data_dir(&config.data_dir) {
        eprintln!("fqsidecar: {message}");
        std::process::exit(3);
    }

    let init = handle.block_on(fqapi_core::api::init(
        format!("{}/config.json", config.data_dir),
        format!("{}/device_pool.json", config.data_dir),
        format!("{}/filter.json", config.data_dir),
        config.data_dir.clone(),
        0,
        false,
        String::new(),
    ));
    if let Err(err) = init {
        eprintln!("fqsidecar: 上游核心初始化失败: {err}");
        std::process::exit(4);
    }

    if let Some(probe) = config.probe.clone() {
        probe_and_exit(&handle, &probe);
        return;
    }

    let provider = Arc::new(UpstreamProvider {
        handle,
        last_error: std::sync::Mutex::new(None),
    });

    if let Err(message) = serve(config, provider, &runtime) {
        eprintln!("fqsidecar: {message}");
        std::process::exit(3);
    }
}

fn serve(
    config: Config,
    provider: Arc<UpstreamProvider>,
    _runtime: &tokio::runtime::Runtime,
) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", config.port))
        .map_err(|err| format!("listen 127.0.0.1:{}: {err}", config.port))?;
    eprintln!(
        "fqsidecar: listening on 127.0.0.1:{} (provider=fanqie, version={VERSION})",
        config.port
    );

    let token = Arc::new(config.token.clone());
    let last_request = Arc::new(AtomicU64::new(now_ms()));
    spawn_stdin_watchdog();
    if let Some(parent_pid) = config.parent_pid {
        spawn_parent_watchdog(parent_pid);
    }
    spawn_idle_watchdog(Arc::clone(&last_request), config.idle_ms);

    for connection in listener.incoming() {
        let stream = match connection {
            Ok(stream) => stream,
            Err(err) => {
                eprintln!("fqsidecar: accept failed: {err}");
                continue;
            }
        };
        let provider = Arc::clone(&provider);
        let token = Arc::clone(&token);
        let last_request = Arc::clone(&last_request);
        std::thread::spawn(move || handle_connection(stream, provider, token, last_request));
    }
    Ok(())
}

fn probe_and_exit(handle: &tokio::runtime::Handle, target: &str) {
    // Git Bash / MSYS2 may rewrite a leading-slash argument into a Windows path;
    // accept both forms.
    let target = if target.starts_with('/') {
        target.to_string()
    } else {
        format!("/{target}")
    };
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target.as_str(), ""),
    };
    match handle.block_on(fqapi_core::api::request(
        String::new(),
        "GET".to_string(),
        path.to_string(),
        query.to_string(),
        Vec::new(),
        60_000,
    )) {
        Ok(response) => {
            println!("status={} content_type={}", response.status, response.content_type);
            println!("{}", String::from_utf8_lossy(&response.body));
            std::process::exit(0);
        }
        Err(err) => {
            eprintln!("probe failed: {err}");
            std::process::exit(5);
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    provider: Arc<UpstreamProvider>,
    token: Arc<String>,
    last_request: Arc<AtomicU64>,
) {
    last_request.store(now_ms(), Ordering::SeqCst);
    let request = match read_request(&mut stream) {
        Ok(request) => request,
        Err(err) => {
            let error = ApiError {
                code: "BAD_RESPONSE",
                message: err,
                status: 400,
            };
            let _ = write_json(&mut stream, 400, &error.to_json());
            return;
        }
    };

    let authorized = request
        .header("x-fq-token")
        .map(|value| value == token.as_str())
        .unwrap_or(false);
    if !authorized {
        let error = ApiError {
            code: "UNAUTHORIZED",
            message: "bad token".to_string(),
            status: 401,
        };
        let _ = write_json(&mut stream, 401, &error.to_json());
        return;
    }

    let (status, body) = route(&request, provider.as_ref(), &last_request);
    let _ = write_json(&mut stream, status, &body);

    if request.method == "POST" && request.path == "/shutdown" {
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(40));
            std::process::exit(0);
        });
    }
}

fn route(
    request: &Request,
    provider: &UpstreamProvider,
    last_request: &AtomicU64,
) -> (u16, Json) {
    let result: Result<Json, ApiError> = match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => Ok(Json::obj(vec![
            ("ok", Json::bool(true)),
            ("version", Json::str(VERSION)),
            ("device_ready", Json::bool(true)),
            ("provider", Json::str("fanqie")),
        ])),
        ("POST", "/shutdown") => Ok(Json::obj(vec![("ok", Json::bool(true))])),
        ("GET", "/search") => {
            let query = request.query_param("q").unwrap_or("").to_string();
            let page = parse_u64(request.query_param("page"), 1);
            let limit = parse_u64(request.query_param("limit"), 20).clamp(1, 50);
            provider.search(&query, page, limit).map(|items| {
                Json::obj(vec![
                    ("total", Json::num(items.len() as f64)),
                    ("items", Json::Array(items.iter().map(|item| item.to_json()).collect())),
                ])
            })
        }
        ("POST", "/resolve") => match request.body_json() {
            Ok(body) => {
                let url = body.get("url").and_then(|value| value.as_str()).unwrap_or("");
                provider
                    .resolve(url)
                    .map(|book_id| Json::obj(vec![("bookId", Json::str(book_id))]))
            }
            Err(err) => Err(ApiError {
                code: "BAD_RESPONSE",
                message: err,
                status: 400,
            }),
        },
        ("GET", path) if path.starts_with("/book/") => {
            let rest = path.trim_start_matches("/book/");
            let mut parts = rest.split('/');
            let book_id = parts.next().unwrap_or("").to_string();
            match parts.next() {
                None => provider.book(&book_id).map(|book| book.to_json()),
                Some("chapters") => provider.chapters(&book_id).map(|items| {
                    Json::obj(vec![
                        ("total", Json::num(items.len() as f64)),
                        ("items", Json::Array(items.iter().map(|item| item.to_json()).collect())),
                    ])
                }),
                Some("comments") => {
                    let chapter_id = request.query_param("chapterId").unwrap_or("").to_string();
                    let page = parse_u64(request.query_param("page"), 1);
                    provider
                        .comments(&book_id, &chapter_id, page)
                        .map(|(total, items)| {
                            Json::obj(vec![
                                ("total", Json::num(total as f64)),
                                ("items", Json::Array(items.iter().map(|item| item.to_json()).collect())),
                            ])
                        })
                }
                Some(_) => Err(ApiError::not_found("unknown book route")),
            }
        }
        ("GET", path) if path.starts_with("/chapter/") => {
            let chapter_id = path.trim_start_matches("/chapter/").to_string();
            provider.chapter(&chapter_id).map(|chapter| chapter.to_json())
        }
        _ => Err(ApiError::not_found(format!(
            "no route {} {}",
            request.method, request.path
        ))),
    };

    last_request.store(now_ms(), Ordering::SeqCst);
    match result {
        Ok(body) => (200, body),
        Err(error) => (error.status, error.to_json()),
    }
}

struct UpstreamProvider {
    handle: tokio::runtime::Handle,
    last_error: std::sync::Mutex<Option<String>>,
}

impl UpstreamProvider {
    fn call(&self, path: &str, query: &str) -> Result<Value, ApiError> {
        let response = self
            .handle
            .block_on(fqapi_core::api::request(
                String::new(),
                "GET".to_string(),
                path.to_string(),
                query.to_string(),
                Vec::new(),
                30_000,
            ))
            .map_err(|err| ApiError::upstream(format!("调用上游核心失败：{err}")))?;

        let text = String::from_utf8_lossy(&response.body).into_owned();
        let value: Value = serde_json::from_str(&text).map_err(|err| {
            ApiError::upstream(format!("上游返回非 JSON（{err}）：{}", head(&text, 160)))
        })?;

        if response.status >= 400 {
            let message = value
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("上游请求失败")
                .to_string();
            *self.last_error.lock().unwrap() = Some(message.clone());
            if response.status == 404 || message.contains("not found") {
                return Err(ApiError::not_found(message));
            }
            return Err(ApiError::upstream(message));
        }
        Ok(value)
    }
}

impl Provider for UpstreamProvider {
    fn name(&self) -> &'static str {
        "fanqie"
    }

    fn device_ready(&self) -> bool {
        true
    }

    fn search(&self, query: &str, page: u64, limit: u64) -> Result<Vec<BookBrief>, ApiError> {
        if query.trim().is_empty() {
            return Err(ApiError::not_found("搜索词为空"));
        }
        let offset = page.saturating_sub(1) * limit;
        let q = format!(
            "query={}&offset={}&count={}&search_source=1",
            percent_encode(query),
            offset,
            limit
        );
        let value = self.call("/api/v1/search", &q)?;
        let mut books = Vec::new();
        collect_books(&value, &mut books);
        Ok(books)
    }

    fn resolve(&self, url: &str) -> Result<String, ApiError> {
        let digits: String = url.chars().filter(|ch| ch.is_ascii_digit()).collect();
        if digits.len() >= 6 {
            Ok(digits)
        } else {
            Err(ApiError::not_found("链接里没有书籍 id"))
        }
    }

    fn book(&self, book_id: &str) -> Result<BookDetail, ApiError> {
        let value = self.call(&format!("/api/v1/books/{book_id}"), "")?;
        let mut books = Vec::new();
        collect_books(&value, &mut books);
        let brief = books
            .into_iter()
            .find(|book| book.id == book_id)
            .or_else(|| {
                let mut all = Vec::new();
                collect_books(&value, &mut all);
                all.into_iter().next()
            })
            .ok_or_else(|| ApiError::upstream("详情里没有书籍字段"))?;
        let total = find_first_u64(&value, &["chapter_total", "serial_count", "chapter_num"]).unwrap_or(0);
        Ok(BookDetail {
            brief,
            last_chapter_title: String::new(),
            chapter_total: total,
        })
    }

    fn chapters(&self, book_id: &str) -> Result<Vec<ChapterMeta>, ApiError> {
        let value = self.call(&format!("/api/v1/books/{book_id}/directory"), "")?;
        let mut chapters = extract_chapters(&value);
        if chapters.is_empty() {
            return Err(ApiError::upstream("目录为空或字段不认识"));
        }
        for (index, chapter) in chapters.iter_mut().enumerate() {
            chapter.index = index as u64;
        }
        Ok(chapters)
    }

    fn chapter(&self, chapter_id: &str) -> Result<Chapter, ApiError> {
        let value = self.call(&format!("/api/v1/chapters/{chapter_id}"), "")?;
        let content = find_string(
            &value,
            &[
                "content",
                "chapter_content",
                "text",
            ],
        )
        .unwrap_or_default();
        let mut paragraphs = html_to_paragraphs(&content);
        if let Some(first) = paragraphs.first() {
            let title_guess = find_string(&value, &["title", "chapter_title", "chapterTitle"])
                .unwrap_or_default();
            if !title_guess.is_empty() && first.trim() == title_guess.trim() {
                paragraphs.remove(0);
            }
        }
        if paragraphs.is_empty() {
            *self.last_error.lock().unwrap() = Some(format!("第 {chapter_id} 章没有正文"));
            return Err(ApiError::decrypt_failed("正文为空（可能解密失败或章节下架）"));
        }
        let title = find_string(&value, &["title", "chapter_title", "chapterTitle"]).unwrap_or_default();
        let book_id = find_string(&value, &["book_id", "bookId"]).unwrap_or_default();
        let index = find_first_u64(&value, &["index", "chapter_index"]).unwrap_or(0);
        Ok(Chapter {
            id: chapter_id.to_string(),
            book_id,
            title,
            index,
            paragraphs,
            prev: None,
            next: None,
        })
    }

    fn comments(
        &self,
        book_id: &str,
        _chapter_id: &str,
        page: u64,
    ) -> Result<(u64, Vec<Comment>), ApiError> {
        // 上游的段评（idea_list）要带 item_version 才有正文，拿不到时是空壳；
        // 书评接口（与 App 书评页同源）稳定返回 text + user_info，只读。
        let offset = page.saturating_sub(1) * 20;
        let value = self.call(
            &format!("/api/v1/books/{book_id}/comments"),
            &format!("count=20&offset={offset}"),
        )?;
        let total = value
            .get("data")
            .and_then(|data| data.get("comment_cnt"))
            .and_then(|count| count.as_u64())
            .unwrap_or(0);
        let comments = parse_book_comments(&value);
        Ok((total.max(comments.len() as u64), comments))
    }
}

fn collect_books(value: &Value, out: &mut Vec<BookBrief>) {
    match value {
        Value::Object(map) => {
            if let Some(id) = get_str(map, &["book_id", "bookId", "book_id_str", "id"]) {
                let title = get_str(map, &["book_name", "bookName", "title", "name"]);
                if title.is_some() {
                    let brief = BookBrief {
                        id,
                        title: title.unwrap_or_default(),
                        author: get_str(map, &["author", "author_name", "authorName"])
                            .unwrap_or_default(),
                        cover_url: get_str(
                            map,
                            &[
                                "thumb_url",
                                "thumbUrl",
                                "cover_url",
                                "coverUrl",
                                "image_url",
                                "book_cover",
                            ],
                        )
                        .unwrap_or_default(),
                        word_count: get_u64(map, &["word_number", "word_count", "wordNumber"])
                            .unwrap_or(0),
                        serial_status: serial_status_label(
                            get_str(
                                map,
                                &["creation_status", "serial_status", "serialStatus", "status"],
                            )
                            .unwrap_or_default()
                            .as_str(),
                        ),
                        category: get_str(map, &["category", "category_name"]).unwrap_or_default(),
                        intro: get_str(map, &["abstract", "description", "intro"])
                            .unwrap_or_default(),
                    };
                    if !out.iter().any(|existing| existing.id == brief.id) {
                        out.push(brief);
                    }
                    return;
                }
            }
            for child in map.values() {
                collect_books(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_books(child, out);
            }
        }
        _ => {}
    }
}

fn serial_status_label(raw: &str) -> String {
    match raw.trim() {
        "0" => "完结".to_string(),
        "1" => "连载".to_string(),
        "2" => "已下架".to_string(),
        other if other.is_empty() => String::new(),
        other => other.to_string(),
    }
}

fn extract_chapters(value: &Value) -> Vec<ChapterMeta> {
    let mut best: Vec<ChapterMeta> = Vec::new();
    find_chapter_array(value, &mut best);
    best
}

fn find_chapter_array(value: &Value, best: &mut Vec<ChapterMeta>) {
    match value {
        Value::Array(items) => {
            let mut chapters = Vec::new();
            for item in items {
                if let Value::Object(map) = item {
                    let id = get_str(map, &["itemId", "item_id", "chapter_id", "chapterId", "id"]);
                    let title = get_str(map, &["title", "chapter_title", "chapterTitle", "name"]);
                    if let (Some(id), Some(title)) = (id, title) {
                        chapters.push(ChapterMeta {
                            id,
                            title,
                            index: 0,
                        });
                    }
                }
            }
            if chapters.len() > best.len() {
                *best = chapters;
            }
            for item in items {
                find_chapter_array(item, best);
            }
        }
        Value::Object(map) => {
            for child in map.values() {
                find_chapter_array(child, best);
            }
        }
        _ => {}
    }
}

fn parse_book_comments(value: &Value) -> Vec<Comment> {
    let items = value
        .get("data")
        .and_then(|data| data.get("comment"))
        .and_then(|comment| comment.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in items {
        let Some(text) = item.get("text").and_then(|text| text.as_str()) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        let user = item.get("user_info");
        let user_name = user
            .and_then(|user| get_str_from(user, &["user_name", "name", "nickname"]))
            .unwrap_or_else(|| "匿名读者".to_string());
        let avatar = user
            .and_then(|user| {
                get_str_from(
                    user,
                    &["avatar_url", "expand_user_avatar", "user_avatar", "avatar"],
                )
            })
            .unwrap_or_default();
        let likes = item
            .get("digg_count")
            .and_then(|count| count.as_u64())
            .unwrap_or(0);
        let time = item
            .get("create_timestamp")
            .and_then(|stamp| stamp.as_u64())
            .map(format_unix_date)
            .unwrap_or_default();
        out.push(Comment {
            user: user_name,
            avatar,
            content: text.trim().to_string(),
            likes,
            time,
        });
    }
    out
}

fn format_unix_date(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Howard Hinnant's civil_from_days.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

fn get_str(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = map.get(*key) {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn get_str_from(value: &Value, keys: &[&str]) -> Option<String> {
    value
        .as_object()
        .and_then(|map| get_str(map, keys))
}

fn get_u64(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(value) = map.get(*key) {
            if let Some(number) = value.as_u64() {
                return Some(number);
            }
            if let Some(text) = value.as_str() {
                if let Ok(number) = text.parse::<u64>() {
                    return Some(number);
                }
            }
        }
    }
    None
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            if let Some(text) = get_str(map, keys) {
                return Some(text);
            }
            for child in map.values() {
                if let Some(found) = find_string(child, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_string(item, keys)),
        _ => None,
    }
}

fn find_first_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    match value {
        Value::Object(map) => {
            if let Some(number) = get_u64(map, keys) {
                return Some(number);
            }
            for child in map.values() {
                if let Some(found) = find_first_u64(child, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_first_u64(item, keys)),
        _ => None,
    }
}

fn html_to_paragraphs(content: &str) -> Vec<String> {
    let mut paragraphs = Vec::new();
    // 正文是 XHTML：<h1>章名</h1><p idx="...">段落</p>...
    for tag in ["h1", "p"] {
        for raw in collect_tag_text(content, tag) {
            let text = decode_entities(&strip_html(raw));
            for line in text.split('\n') {
                let line = line.trim();
                if line.is_empty() || is_ad_line(line) {
                    continue;
                }
                paragraphs.push(line.to_string());
            }
        }
    }
    if paragraphs.is_empty() {
        // 没有段落标签时退化成整段纯文本。
        let text = decode_entities(&strip_html(content));
        for line in text.split('\n') {
            let line = line.trim();
            if !line.is_empty() && !is_ad_line(line) {
                paragraphs.push(line.to_string());
            }
        }
    }
    paragraphs
}

fn collect_tag_text<'a>(content: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find(&open) {
        let after_open = &rest[start..];
        let Some(gt) = after_open.find('>') else { break };
        let body = &after_open[gt + 1..];
        let Some(end) = body.find(&close) else { break };
        out.push(&body[..end]);
        rest = &body[end + close.len()..];
    }
    out
}

fn is_ad_line(line: &str) -> bool {
    [
        "番茄小说",
        "本章未完",
        "点击下一页",
        "请收藏本站",
        "http://",
        "https://",
    ]
    .iter()
    .any(|needle| line.contains(needle))
}

fn strip_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn decode_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

fn head(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn percent_encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn prepare_data_dir(dir: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("create data dir {dir}: {err}"))?;
    let config = format!("{dir}/config.json");
    if !std::path::Path::new(&config).exists() {
        let body = r#"{
  "algorithm_type": "",
  "zwsm": "",
  "port": 0,
  "anti_crawler": { "enabled": false, "redirect_url": "" },
  "admin": { "token": "", "update_server_url": "" }
}"#;
        std::fs::write(&config, body).map_err(|err| format!("write config: {err}"))?;
    }
    Ok(())
}

fn parse_u64(value: Option<&str>, fallback: u64) -> u64 {
    value
        .and_then(|text| text.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn spawn_stdin_watchdog() {
    std::thread::spawn(|| {
        let mut buffer = [0u8; 1024];
        let stdin = std::io::stdin();
        let mut handle = stdin.lock();
        loop {
            match handle.read(&mut buffer) {
                Ok(0) => std::process::exit(0),
                Ok(_) => {}
                Err(_) => std::process::exit(0),
            }
        }
    });
}

fn spawn_parent_watchdog(parent_pid: u32) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(10));
        if !parent_alive(parent_pid) {
            std::process::exit(0);
        }
    });
}

fn spawn_idle_watchdog(last_request: Arc<AtomicU64>, idle_ms: u64) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1_000));
        let idle_for = now_ms().saturating_sub(last_request.load(Ordering::SeqCst));
        if idle_for > idle_ms {
            std::process::exit(0);
        }
    });
}

#[cfg(windows)]
fn parent_alive(pid: u32) -> bool {
    use std::ffi::c_void;

    type Handle = *mut c_void;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const WAIT_OBJECT_0: u32 = 0;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    unsafe {
        let handle = OpenProcess(SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let result = WaitForSingleObject(handle, 0);
        CloseHandle(handle);
        result != WAIT_OBJECT_0
    }
}

#[cfg(not(windows))]
fn parent_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

fn parse_args() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let key = match arg.strip_prefix("--") {
            Some(key) => key.to_string(),
            None => continue,
        };
        let value = match args.next() {
            Some(value) if !value.starts_with("--") => value,
            _ => "true".to_string(),
        };
        map.insert(key, value);
    }
    map
}

// 让未使用的 last_error 字段有明确的用途说明，同时避免 warning。
impl Drop for UpstreamProvider {
    fn drop(&mut self) {
        let _ = self.last_error.lock().map(|guard| guard.clone());
    }
}
