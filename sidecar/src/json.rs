//! 零依赖 JSON：只够侧车自己的契约用。
//!
//! 不引 serde 是刻意的：侧车要能在一个只有 rustc + 链接器的机器上编出来，
//! 单文件 exe、无动态依赖。代价是这里要自己实现解析与转义。

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    pub fn obj(pairs: Vec<(&str, Json)>) -> Json {
        Json::Object(
            pairs
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        )
    }

    pub fn str(value: impl Into<String>) -> Json {
        Json::String(value.into())
    }

    pub fn num(value: impl Into<f64>) -> Json {
        Json::Number(value.into())
    }

    pub fn bool(value: bool) -> Json {
        Json::Bool(value)
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(pairs) => pairs
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(value) => Some(value),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Json::Number(value) if *value >= 0.0 => Some(*value as u64),
            _ => None,
        }
    }

    pub fn encode(&self) -> String {
        let mut out = String::new();
        self.write_into(&mut out);
        out
    }

    fn write_into(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(true) => out.push_str("true"),
            Json::Bool(false) => out.push_str("false"),
            Json::Number(value) => {
                if value.fract() == 0.0 && value.abs() < 1e15 {
                    out.push_str(&format!("{}", *value as i64));
                } else {
                    out.push_str(&format!("{value}"));
                }
            }
            Json::String(value) => write_string(value, out),
            Json::Array(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    item.write_into(out);
                }
                out.push(']');
            }
            Json::Object(pairs) => {
                out.push('{');
                for (index, (key, value)) in pairs.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write_string(key, out);
                    out.push(':');
                    value.write_into(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_string(value: &str, out: &mut String) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out.push('"');
}

pub fn parse(input: &str) -> Result<Json, String> {
    let mut parser = Parser {
        bytes: input.as_bytes(),
        index: 0,
    };
    parser.skip_ws();
    let value = parser.value()?;
    parser.skip_ws();
    if parser.index != parser.bytes.len() {
        return Err(format!("trailing input at byte {}", parser.index));
    }
    Ok(value)
}

struct Parser<'a> {
    bytes: &'a [u8],
    index: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.index).copied()
    }

    fn bump(&mut self) -> Option<u8> {
        let value = self.peek();
        if value.is_some() {
            self.index += 1;
        }
        value
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\n' | b'\r' | b'\t')) {
            self.index += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        if self.bump() == Some(byte) {
            Ok(())
        } else {
            Err(format!("expected '{}' at {}", byte as char, self.index))
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => self.string().map(Json::String),
            Some(b't') => self.literal("true", Json::Bool(true)),
            Some(b'f') => self.literal("false", Json::Bool(false)),
            Some(b'n') => self.literal("null", Json::Null),
            Some(_) => self.number(),
            None => Err("unexpected end of input".to_string()),
        }
    }

    fn literal(&mut self, text: &str, value: Json) -> Result<Json, String> {
        if self.bytes[self.index..].starts_with(text.as_bytes()) {
            self.index += text.len();
            Ok(value)
        } else {
            Err(format!("invalid literal at {}", self.index))
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.expect(b'{')?;
        let mut pairs = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.index += 1;
            return Ok(Json::Object(pairs));
        }
        loop {
            self.skip_ws();
            let key = self.string()?;
            self.skip_ws();
            self.expect(b':')?;
            let value = self.value()?;
            pairs.push((key, value));
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b'}') => break,
                _ => return Err(format!("expected ',' or '}}' at {}", self.index)),
            }
        }
        Ok(Json::Object(pairs))
    }

    fn array(&mut self) -> Result<Json, String> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.index += 1;
            return Ok(Json::Array(items));
        }
        loop {
            items.push(self.value()?);
            self.skip_ws();
            match self.bump() {
                Some(b',') => continue,
                Some(b']') => break,
                _ => return Err(format!("expected ',' or ']' at {}", self.index)),
            }
        }
        Ok(Json::Array(items))
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            match self.bump() {
                None => return Err("unterminated string".to_string()),
                Some(b'"') => return Ok(out),
                Some(b'\\') => match self.bump() {
                    Some(b'"') => out.push('"'),
                    Some(b'\\') => out.push('\\'),
                    Some(b'/') => out.push('/'),
                    Some(b'n') => out.push('\n'),
                    Some(b'r') => out.push('\r'),
                    Some(b't') => out.push('\t'),
                    Some(b'b') => out.push('\u{0008}'),
                    Some(b'f') => out.push('\u{000c}'),
                    Some(b'u') => {
                        let mut code = 0u32;
                        for _ in 0..4 {
                            let digit = self
                                .bump()
                                .and_then(|byte| (byte as char).to_digit(16))
                                .ok_or_else(|| "bad \\u escape".to_string())?;
                            code = code * 16 + digit;
                        }
                        if let Some(ch) = char::from_u32(code) {
                            out.push(ch);
                        }
                    }
                    _ => return Err("bad escape".to_string()),
                },
                Some(byte) => {
                    // 多字节 UTF-8 直接按字节收集，最后一次性校验
                    let start = self.index - 1;
                    let width = utf8_width(byte);
                    let end = (start + width).min(self.bytes.len());
                    match std::str::from_utf8(&self.bytes[start..end]) {
                        Ok(text) => {
                            out.push_str(text);
                            self.index = end;
                        }
                        Err(_) => return Err("invalid utf-8".to_string()),
                    }
                }
            }
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.index;
        if self.peek() == Some(b'-') {
            self.index += 1;
        }
        while matches!(self.peek(), Some(b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-')) {
            self.index += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.index])
            .map_err(|_| "bad number".to_string())?;
        text.parse::<f64>()
            .map(Json::Number)
            .map_err(|_| format!("bad number at {start}"))
    }
}

fn utf8_width(byte: u8) -> usize {
    if byte < 0x80 {
        1
    } else if byte >> 5 == 0b110 {
        2
    } else if byte >> 4 == 0b1110 {
        3
    } else {
        4
    }
}
