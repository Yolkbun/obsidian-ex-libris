//! fqsidecar — Ex Libris 的无界面本机侧车。
//!
//! 只监听 127.0.0.1，只认 HTTP + JSON，不认识 Obsidian。
//! 生命周期（规格 6.2）：
//!   - 端口由插件分配，通过 `--port` 传入；
//!   - `FQ_TOKEN` 环境变量传鉴权 token，每个请求必须带 `X-FQ-Token`；
//!   - stdin EOF → 立即退出（父进程崩溃时最可靠的一条）；
//!   - 每 10s 检查 `--parent-pid` 是否存活；
//!   - 连续 5 分钟无请求（可配）→ 退出。
//!
//! 构建：`cargo build --release`，或用仓库根的 scripts/build-sidecar.ps1。

use fqsidecar_core::{http, json, provider};

use std::collections::HashMap;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use json::Json;
use provider::{ApiError, Provider};

const VERSION: &str = "0.1.0";

struct Config {
    port: u16,
    data_dir: String,
    token: String,
    parent_pid: Option<u32>,
    idle_ms: u64,
    provider: String,
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

    if let Err(message) = run(config) {
        eprintln!("fqsidecar: {message}");
        std::process::exit(3);
    }
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
        let parent_pid = args
            .get("parent-pid")
            .and_then(|value| value.parse::<u32>().ok());
        let idle_ms = args
            .get("idle-ms")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(5 * 60_000);
        Ok(Self {
            port,
            data_dir: args.get("data-dir").cloned().unwrap_or_default(),
            token,
            parent_pid,
            idle_ms,
            provider: args
                .get("provider")
                .cloned()
                .unwrap_or_else(|| "fanqie".to_string()),
        })
    }
}

fn run(config: Config) -> Result<(), String> {
    if !config.data_dir.is_empty() {
        let _ = std::fs::create_dir_all(&config.data_dir);
    }

    let provider: Arc<dyn Provider> = match config.provider.as_str() {
        "demo" => Arc::new(provider::demo::DemoProvider),
        _ => Arc::new(provider::fanqie::FanqieProvider::new(config.data_dir.clone())),
    };

    let listener = TcpListener::bind(("127.0.0.1", config.port))
        .map_err(|err| format!("listen 127.0.0.1:{}: {err}", config.port))?;
    eprintln!(
        "fqsidecar: listening on 127.0.0.1:{} (provider={}, version={})",
        config.port,
        provider.name(),
        VERSION
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

fn handle_connection(
    mut stream: TcpStream,
    provider: Arc<dyn Provider>,
    token: Arc<String>,
    last_request: Arc<AtomicU64>,
) {
    last_request.store(now_ms(), Ordering::SeqCst);
    let request = match http::read_request(&mut stream) {
        Ok(request) => request,
        Err(err) => {
            let error = ApiError {
                code: "BAD_RESPONSE",
                message: err,
                status: 400,
            };
            let _ = http::write_json(&mut stream, 400, &error.to_json());
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
        let _ = http::write_json(&mut stream, 401, &error.to_json());
        return;
    }

    let (status, body) = route(&request, provider.as_ref(), last_request.as_ref());
    let _ = http::write_json(&mut stream, status, &body);

    if request.method == "POST" && request.path == "/shutdown" {
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(40));
            std::process::exit(0);
        });
    }
}

fn route(
    request: &http::Request,
    provider: &dyn Provider,
    last_request: &AtomicU64,
) -> (u16, Json) {
    if request.method != "GET" && request.method != "POST" {
        return (
            405,
            ApiError {
                code: "NOT_FOUND",
                message: format!("unsupported method {}", request.method),
                status: 405,
            }
            .to_json(),
        );
    }

    let segments: Vec<&str> = request
        .path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    let result: Result<Json, ApiError> = match (request.method.as_str(), segments.as_slice()) {
        ("GET", ["health"]) => Ok(Json::obj(vec![
            ("ok", Json::bool(true)),
            ("version", Json::str(VERSION)),
            ("device_ready", Json::bool(provider.device_ready())),
            ("provider", Json::str(provider.name())),
        ])),
        ("POST", ["shutdown"]) => Ok(Json::obj(vec![("ok", Json::bool(true))])),
        ("GET", ["search"]) => {
            let query = request.query_param("q").unwrap_or("").to_string();
            let page = parse_u64(request.query_param("page"), 1);
            let limit = parse_u64(request.query_param("limit"), 20).clamp(1, 50);
            match provider.search(&query, page, limit) {
                Ok(items) => Ok(Json::obj(vec![
                    ("total", Json::num(items.len() as f64)),
                    ("items", Json::Array(items.iter().map(|item| item.to_json()).collect())),
                ])),
                Err(error) => Err(error),
            }
        }
        ("POST", ["resolve"]) => match request.body_json() {
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
        ("GET", ["book"]) => Err(ApiError::not_found("缺少 book id")),
        ("GET", ["book", book_id]) => provider.book(book_id).map(|book| book.to_json()),
        ("GET", ["book", book_id, "chapters"]) => provider.chapters(book_id).map(|items| {
            Json::obj(vec![
                ("total", Json::num(items.len() as f64)),
                ("items", Json::Array(items.iter().map(|item| item.to_json()).collect())),
            ])
        }),
        ("GET", ["book", book_id, "comments"]) => {
            let chapter_id = request.query_param("chapterId").unwrap_or("").to_string();
            let page = parse_u64(request.query_param("page"), 1);
            provider
                .comments(book_id, &chapter_id, page)
                .map(|(total, items)| {
                    Json::obj(vec![
                        ("total", Json::num(total as f64)),
                        ("items", Json::Array(items.iter().map(|item| item.to_json()).collect())),
                    ])
                })
        }
        ("GET", ["chapter", chapter_id]) => provider.chapter(chapter_id).map(|chapter| chapter.to_json()),
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
    // Unix 上用 kill(pid, 0) 的等价物：/proc 存在即活。
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
