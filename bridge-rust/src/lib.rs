//! Experimental file-compatible bridge primitives. No Node process is embedded.
use base64::Engine;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
};
pub const HORIZON: i64 = 7 * 24 * 3600 * 1000;
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn millis(v: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(v.as_str()?)
        .ok()
        .map(|d| d.timestamp_millis())
}
pub fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub fn token(v: &Value, max: usize) -> Value {
    match v.as_str() {
        Some(s)
            if !s.is_empty()
                && s.len() <= max
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') =>
        {
            v.clone()
        }
        _ => Value::Null,
    }
}
/// ECMAScript `String(v ?? '')` for JSON values, so non-string fields are
/// stored exactly like the JavaScript bridge stores them.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|x| if x.is_null() { String::new() } else { js_string(x) })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}
/// ECMAScript Number::toString(10) for finite doubles (JSON has no NaN/Infinity).
pub fn js_number(x: f64) -> String {
    if x == 0.0 {
        return "0".into();
    }
    if x.is_nan() {
        return "NaN".into();
    }
    if x < 0.0 {
        return format!("-{}", js_number(-x));
    }
    // Rust's `{:e}` emits the shortest round-tripping digits, the same digit
    // string ECMAScript selects; only the placement rules differ.
    let e = format!("{x:e}");
    let (mantissa, exponent) = e.split_once('e').unwrap();
    let digits = mantissa.replace('.', "");
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().unwrap() + 1;
    if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let sign = if n - 1 < 0 { '-' } else { '+' };
        let rest = if k == 1 { String::new() } else { format!(".{}", &digits[1..]) };
        format!("{}{rest}e{sign}{}", &digits[..1], (n - 1).abs())
    }
}
fn cap_units(v: &Value, n: usize) -> Vec<u16> {
    js_string(v).encode_utf16().take(n).collect()
}
pub fn cap(v: &Value, n: usize) -> String {
    // A Rust string cannot hold the unpaired surrogate JavaScript may leave at
    // the cut; it is stored as U+FFFD. Signatures use the exact UTF-16 units.
    String::from_utf16_lossy(&cap_units(v, n))
}
pub fn opt(v: &Value, n: usize) -> Value {
    let s = cap(v, n);
    if s.is_empty() { Value::Null } else { json!(s) }
}
pub fn source(v: &Value) -> Value {
    if !v.is_object() {
        return Value::Null;
    }
    let b = token(&v["browser"], 32);
    let s = token(&v["session"], 128);
    let t = token(&v["tab"], 128);
    let d = token(&v["document"], 128);
    if [b.clone(), s.clone(), t.clone(), d.clone()]
        .iter()
        .any(Value::is_null)
    {
        Value::Null
    } else {
        json!({"browser":b,"session":s,"tab":t,"document":d})
    }
}
pub fn rect(v: &Value) -> Value {
    let mut r = serde_json::Map::new();
    for k in ["x", "y", "w", "h", "width", "height", "top", "left", "dpr"] {
        if v[k].is_number() {
            r.insert(k.into(), v[k].clone());
        }
    }
    if r.is_empty() {
        Value::Null
    } else {
        Value::Object(r)
    }
}
pub fn styles(v: &Value) -> Value {
    if (v.is_object() || v.is_array()) && v.to_string().len() <= 20000 {
        v.clone()
    } else {
        Value::Null
    }
}
pub fn target(v: &Value) -> Value {
    if !v.is_object() && !v.is_array() {
        return Value::Null;
    }
    json!({"selector":cap(&v["selector"],500),"source":opt(&v["source"],500),"xpath":opt(&v["xpath"],500),"innerText":cap(&v["innerText"],300),"outerHTML":cap(&v["outerHTML"],4000),"styles":styles(&v["styles"]),"rect":rect(&v["rect"])})
}
pub fn targets(v: &Value) -> Value {
    match v.as_array(){Some(a) if a.len()>=2=>json!(a.iter().take(12).map(|t|json!({"selector":cap(&t["selector"],500),"source":opt(&t["source"],500),"xpath":opt(&t["xpath"],500),"innerText":cap(&t["innerText"],300),"outerHTML":cap(&t["outerHTML"],1200),"styles":styles(&t["styles"])})).collect::<Vec<_>>()),_=>Value::Null}
}
/// A JSON value in ECMAScript terms: strings are UTF-16 code units, so an
/// unpaired surrogate, a cut pair and `Array.prototype.sort` key order stay exact.
pub enum Js {
    Null,
    Bool(bool),
    Num(f64),
    Str(Vec<u16>),
    Arr(Vec<Js>),
    Obj(Vec<(Vec<u16>, Js)>),
}
static JS_NULL: Js = Js::Null;
impl Js {
    pub fn from(v: &Value) -> Js {
        match v {
            Value::Null => Js::Null,
            Value::Bool(b) => Js::Bool(*b),
            Value::Number(n) => Js::Num(n.as_f64().unwrap_or(f64::NAN)),
            Value::String(s) => Js::Str(s.encode_utf16().collect()),
            Value::Array(a) => Js::Arr(a.iter().map(Js::from).collect()),
            Value::Object(o) => Js::Obj(
                o.iter()
                    .map(|(k, v)| (k.encode_utf16().collect(), Js::from(v)))
                    .collect(),
            ),
        }
    }
    fn obj(fields: Vec<(&str, Js)>) -> Js {
        Js::Obj(fields.into_iter().map(|(k, v)| (k.encode_utf16().collect(), v)).collect())
    }
    fn get(&self, key: &str) -> &Js {
        let key = key.encode_utf16().collect::<Vec<_>>();
        match self {
            Js::Obj(o) => o.iter().find(|(k, _)| *k == key).map_or(&JS_NULL, |(_, v)| v),
            _ => &JS_NULL,
        }
    }
    fn truthy(&self) -> bool {
        match self {
            Js::Null => false,
            Js::Bool(b) => *b,
            Js::Num(x) => *x != 0.0 && !x.is_nan(),
            Js::Str(u) => !u.is_empty(),
            _ => true,
        }
    }
    fn is_object(&self) -> bool {
        matches!(self, Js::Obj(_) | Js::Arr(_))
    }
    /// `String(v ?? '')`.
    fn string(&self) -> Vec<u16> {
        match self {
            Js::Null => vec![],
            Js::Bool(b) => b.to_string().encode_utf16().collect(),
            Js::Num(x) => js_number(*x).encode_utf16().collect(),
            Js::Str(u) => u.clone(),
            Js::Arr(a) => {
                let mut out = vec![];
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(b',' as u16)
                    }
                    out.extend(v.string())
                }
                out
            }
            Js::Obj(_) => "[object Object]".encode_utf16().collect(),
        }
    }
    fn clone_js(&self) -> Js {
        match self {
            Js::Null => Js::Null,
            Js::Bool(b) => Js::Bool(*b),
            Js::Num(x) => Js::Num(*x),
            Js::Str(u) => Js::Str(u.clone()),
            Js::Arr(a) => Js::Arr(a.iter().map(Js::clone_js).collect()),
            Js::Obj(o) => Js::Obj(o.iter().map(|(k, v)| (k.clone(), v.clone_js())).collect()),
        }
    }
    /// `JSON.stringify` with the store's sorted-key replacer.
    fn write(&self, out: &mut String) {
        match self {
            Js::Null => out.push_str("null"),
            Js::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Js::Num(x) => out.push_str(&if x.is_finite() { js_number(*x) } else { "null".into() }),
            Js::Str(u) => quote(u, out),
            Js::Arr(a) => {
                out.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',')
                    }
                    v.write(out)
                }
                out.push(']')
            }
            Js::Obj(o) => {
                let mut fields = o.iter().collect::<Vec<_>>();
                fields.sort_by(|a, b| a.0.cmp(&b.0));
                out.push('{');
                for (i, (k, v)) in fields.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',')
                    }
                    quote(k, out);
                    out.push(':');
                    v.write(out)
                }
                out.push('}')
            }
        }
    }
}
/// ECMAScript QuoteJSONString over UTF-16 units, including lone surrogates.
fn quote(units: &[u16], out: &mut String) {
    out.push('"');
    for c in char::decode_utf16(units.iter().copied()) {
        match c {
            Ok('"') => out.push_str("\\\""),
            Ok('\\') => out.push_str("\\\\"),
            Ok('\u{8}') => out.push_str("\\b"),
            Ok('\u{c}') => out.push_str("\\f"),
            Ok('\n') => out.push_str("\\n"),
            Ok('\r') => out.push_str("\\r"),
            Ok('\t') => out.push_str("\\t"),
            Ok(c) if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            Ok(c) => out.push(c),
            Err(e) => out.push_str(&format!("\\u{:04x}", e.unpaired_surrogate())),
        }
    }
    out.push('"');
}
/// Parse JSON that serde_json (or `parse_json`) already accepted into UTF-16
/// strings, keeping unpaired surrogate escapes exactly as `JSON.parse` does.
/// Grammar is not re-validated here; callers parse with serde first.
pub fn parse_js(bytes: &[u8]) -> Option<Js> {
    struct P<'a>(&'a [u8], usize);
    impl P<'_> {
        fn peek(&self) -> Option<u8> {
            self.0.get(self.1).copied()
        }
        fn ws(&mut self) {
            while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
                self.1 += 1
            }
        }
        fn lit(&mut self, word: &[u8], v: Js) -> Option<Js> {
            (self.0.get(self.1..self.1 + word.len())? == word).then(|| self.1 += word.len())?;
            Some(v)
        }
        fn string(&mut self) -> Option<Vec<u16>> {
            self.1 += 1;
            let mut out = vec![];
            loop {
                let start = self.1;
                while !matches!(self.peek()?, b'"' | b'\\') {
                    self.1 += 1
                }
                out.extend(std::str::from_utf8(&self.0[start..self.1]).ok()?.encode_utf16());
                if self.peek()? == b'"' {
                    self.1 += 1;
                    return Some(out);
                }
                let escape = *self.0.get(self.1 + 1)?;
                self.1 += 2;
                out.push(match escape {
                    b'"' => b'"' as u16,
                    b'\\' => b'\\' as u16,
                    b'/' => b'/' as u16,
                    b'b' => 8,
                    b'f' => 12,
                    b'n' => b'\n' as u16,
                    b'r' => b'\r' as u16,
                    b't' => b'\t' as u16,
                    b'u' => {
                        let hex = std::str::from_utf8(self.0.get(self.1..self.1 + 4)?).ok()?;
                        self.1 += 4;
                        u16::from_str_radix(hex, 16).ok()?
                    }
                    _ => return None,
                })
            }
        }
        fn value(&mut self) -> Option<Js> {
            self.ws();
            match self.peek()? {
                b'n' => self.lit(b"null", Js::Null),
                b't' => self.lit(b"true", Js::Bool(true)),
                b'f' => self.lit(b"false", Js::Bool(false)),
                b'"' => Some(Js::Str(self.string()?)),
                b'[' => {
                    self.1 += 1;
                    let mut items = vec![];
                    self.ws();
                    if self.peek()? == b']' {
                        self.1 += 1;
                        return Some(Js::Arr(items));
                    }
                    loop {
                        items.push(self.value()?);
                        self.ws();
                        match self.peek()? {
                            b',' => self.1 += 1,
                            b']' => {
                                self.1 += 1;
                                return Some(Js::Arr(items));
                            }
                            _ => return None,
                        }
                    }
                }
                b'{' => {
                    self.1 += 1;
                    let mut fields: Vec<(Vec<u16>, Js)> = vec![];
                    self.ws();
                    if self.peek()? == b'}' {
                        self.1 += 1;
                        return Some(Js::Obj(fields));
                    }
                    loop {
                        self.ws();
                        if self.peek()? != b'"' {
                            return None;
                        }
                        let key = self.string()?;
                        self.ws();
                        (self.peek()? == b':').then(|| self.1 += 1)?;
                        let v = self.value()?;
                        // JSON.parse: a repeated key keeps the last value.
                        match fields.iter_mut().find(|(k, _)| *k == key) {
                            Some(field) => field.1 = v,
                            None => fields.push((key, v)),
                        }
                        self.ws();
                        match self.peek()? {
                            b',' => self.1 += 1,
                            b'}' => {
                                self.1 += 1;
                                return Some(Js::Obj(fields));
                            }
                            _ => return None,
                        }
                    }
                }
                _ => {
                    let start = self.1;
                    while matches!(self.peek(), Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')) {
                        self.1 += 1
                    }
                    std::str::from_utf8(&self.0[start..self.1]).ok()?.parse::<f64>().ok().map(Js::Num)
                }
            }
        }
    }
    let mut p = P(bytes, 0);
    let v = p.value()?;
    p.ws();
    (p.1 == bytes.len()).then_some(v)
}
fn cap_js(v: &Js, n: usize) -> Vec<u16> {
    v.string().into_iter().take(n).collect()
}
fn js_cap(v: &Js, n: usize) -> Js {
    Js::Str(cap_js(v, n))
}
/// `capOrNull`: null/undefined stay null, an empty capped string becomes null.
fn js_cap_or_null(v: &Js, n: usize) -> Js {
    let units = cap_js(v, n);
    if matches!(v, Js::Null) || units.is_empty() { Js::Null } else { Js::Str(units) }
}
fn js_or_null(v: &Js) -> Js {
    if v.truthy() { v.clone_js() } else { Js::Null }
}
fn js_styles(v: &Js) -> Js {
    if !v.truthy() || !v.is_object() {
        return Js::Null;
    }
    let mut text = String::new();
    v.write(&mut text);
    // JSON.stringify(styles).length counts UTF-16 units; key order does not
    // change that length.
    if text.encode_utf16().count() > 20_000 { Js::Null } else { v.clone_js() }
}
fn js_rect(v: &Js) -> Js {
    if !v.truthy() || !v.is_object() {
        return Js::Null;
    }
    let fields = ["x", "y", "w", "h", "width", "height", "top", "left", "dpr"]
        .into_iter()
        .filter_map(|k| match v.get(k) {
            Js::Num(x) => Some((k, Js::Num(*x))),
            _ => None,
        })
        .collect::<Vec<_>>();
    if fields.is_empty() { Js::Null } else { Js::obj(fields) }
}
fn js_target(t: &Js) -> Js {
    if !t.truthy() || !t.is_object() {
        return Js::Null;
    }
    Js::obj(vec![
        ("selector", js_cap(t.get("selector"), 500)),
        ("source", js_cap_or_null(t.get("source"), 500)),
        ("xpath", js_cap_or_null(t.get("xpath"), 500)),
        ("innerText", js_cap(t.get("innerText"), 300)),
        ("outerHTML", js_cap(t.get("outerHTML"), 4000)),
        ("styles", js_styles(t.get("styles"))),
        ("rect", js_rect(t.get("rect"))),
    ])
}
fn js_targets(v: &Js) -> Js {
    match v {
        Js::Arr(a) if a.len() >= 2 => Js::Arr(
            a.iter()
                .take(12)
                .map(|t| {
                    let truthy_cap = |k: &str, n| if t.get(k).truthy() { js_cap(t.get(k), n) } else { Js::Null };
                    Js::obj(vec![
                        ("selector", js_cap(t.get("selector"), 500)),
                        ("source", truthy_cap("source", 500)),
                        ("xpath", truthy_cap("xpath", 500)),
                        ("innerText", js_cap(t.get("innerText"), 300)),
                        ("outerHTML", js_cap(t.get("outerHTML"), 1200)),
                        ("styles", js_styles(t.get("styles"))),
                    ])
                })
                .collect(),
        ),
        _ => Js::Null,
    }
}
fn identity_units(u: &[u16], max: usize) -> bool {
    !u.is_empty()
        && u.len() <= max
        && u.iter().all(|&c| c < 128 && ((c as u8).is_ascii_alphanumeric() || c == b'_' as u16 || c == b'-' as u16))
}
/// `sanitizeBrowserSource`: four strings matching the identity pattern.
fn js_source(v: &Js) -> Js {
    if !v.truthy() || !v.is_object() {
        return Js::Null;
    }
    let field = |k: &str, max| match v.get(k) {
        Js::Str(u) if identity_units(u, max) => Some(u.clone()),
        _ => None,
    };
    match (field("browser", 32), field("session", 128), field("tab", 128), field("document", 128)) {
        (Some(b), Some(s), Some(t), Some(d)) => Js::obj(vec![
            ("browser", Js::Str(b)),
            ("session", Js::Str(s)),
            ("tab", Js::Str(t)),
            ("document", Js::Str(d)),
        ]),
        _ => Js::Null,
    }
}
/// The store's `token(v)`: `String(v || '')` must match the identity pattern.
fn js_token_units(v: &Js) -> Js {
    let s = if v.truthy() { v.string() } else { vec![] };
    if identity_units(&s, 128) { Js::Str(s) } else { Js::Null }
}
pub fn js_token(v: &Value) -> Value {
    match js_token_units(&Js::from(v)) {
        Js::Str(u) => json!(String::from_utf16_lossy(&u)),
        _ => Value::Null,
    }
}
/// Version-2 receipt signature, byte-compatible with the JavaScript bridge's
/// `payloadSignature`: same sanitizers, `|| null` truthiness, ECMAScript number
/// spelling, UTF-16 key order and UTF-16 truncation.
pub fn signature_js(p: &Js) -> String {
    let canonical = Js::obj(vec![
        ("text", js_cap(p.get("text"), 4000)),
        ("url", js_cap(p.get("url"), 2000)),
        ("author", js_cap(p.get("author"), 80)),
        ("target", js_target(p.get("target"))),
        ("targets", js_targets(p.get("targets"))),
        ("browserSource", js_source(p.get("browserSource"))),
        ("submissionCreatedAt", js_or_null(p.get("submissionCreatedAt"))),
        ("selectionGeneration", js_token_units(p.get("selectionGeneration"))),
        ("title", js_cap(p.get("title"), 300)),
        ("ua", js_cap(p.get("ua"), 300)),
        ("viewport", js_rect(p.get("viewport"))),
        ("annotations", js_or_null(p.get("annotations"))),
        ("console", js_or_null(p.get("console"))),
        ("screenshot", js_or_null(p.get("screenshot"))),
        ("screenshotFull", js_or_null(p.get("screenshotFull"))),
    ]);
    let mut text = String::new();
    canonical.write(&mut text);
    digest(&text)
}
pub fn signature(p: &Value) -> String {
    signature_js(&Js::from(p))
}
pub fn annotations(v: &Value) -> bool {
    v.is_null()
        || v.as_array().is_some_and(|a| {
            a.len() <= 16
                && v.to_string().len() <= 100000
                && a.iter().all(|x| {
                    x["type"] == "lasso"
                        && x["points"].as_array().is_some_and(|p| {
                            !p.is_empty()
                                && p.len() <= 10000
                                && p.iter().all(|y| {
                                    y.as_array().is_some_and(|z| {
                                        z.len() == 2 && z.iter().all(Value::is_number)
                                    })
                                })
                        })
                })
        })
}
pub fn host(value: &str) -> String {
    url::Url::parse(value)
        .ok()
        .and_then(|u| {
            let h = u.host_str()?.replace("127.0.0.1", "localhost");
            Some(match u.port() {
                Some(p) => format!("{h}:{p}"),
                None => h,
            })
        })
        .unwrap_or_default()
}
pub fn local_origin(value: &str) -> bool {
    regex::Regex::new(r"^https?://(localhost|127\.0\.0\.1|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost)(:[0-9]+)?$").unwrap().is_match(value)
}
pub fn route(value: &str) -> Option<String> {
    let u = url::Url::parse(value).ok()?;
    if !local_origin(u.origin().ascii_serialization().as_str())
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return None;
    }
    Some(format!(
        "{}{}{}",
        u.origin().ascii_serialization(),
        u.path(),
        u.fragment().map(|f| format!("#{f}")).unwrap_or_default()
    ))
}
pub fn label(id: &str) -> u64 {
    id.rsplit('_')
        .next()
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .map(|n| (n - 1) % 999 + 1)
        .unwrap_or(0)
}

/// Decoded, bounded PNG admission. JPEG is admitted only by the overview path.
pub fn image(v: &Value) -> Option<Vec<u8>> {
    let s = v.as_str()?;
    let data = s.strip_prefix("data:image/png;base64,")?;
    if data.len() > 8 * 1024 * 1024 * 4 / 3 + 4 {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()?;
    if bytes.is_empty()
        || bytes.len() > 8 * 1024 * 1024
        || base64::engine::general_purpose::STANDARD.encode(&bytes) != data
    {
        return None;
    }
    let decoder = png::Decoder::new(std::io::Cursor::new(&bytes));
    let mut reader = decoder.read_info().ok()?;
    let info = reader.info();
    let (w, h) = (info.width, info.height);
    if w == 0
        || h == 0
        || w > 32768
        || h > 32768
        || w as u64 * h as u64 * 4 > 64 * 1024 * 1024
        || info.interlaced
    {
        return None;
    }
    let size = reader.output_buffer_size()?;
    if size > 64 * 1024 * 1024 {
        return None;
    }
    let mut buffer = vec![0; size];
    reader.next_frame(&mut buffer).ok()?;
    reader.finish().ok()?;
    // The decoder may stop at IEND: reject trailing bytes and all bad chunk CRCs.
    let mut at = 8usize;
    while at < bytes.len() {
        let length = u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize;
        let end = at.checked_add(length)?.checked_add(12)?;
        let chunk = bytes.get(at + 4..end - 4)?;
        let mut crc = 0xffffffffu32;
        for byte in chunk {
            crc ^= *byte as u32;
            for _ in 0..8 {
                crc = (crc >> 1) ^ if crc & 1 != 0 { 0xedb88320 } else { 0 };
            }
        }
        if crc ^ 0xffffffff != u32::from_be_bytes(bytes.get(end - 4..end)?.try_into().ok()?) {
            return None;
        }
        if &bytes[at + 4..at + 8] == b"IEND" && (length != 0 || end != bytes.len()) {
            return None;
        }
        at = end;
    }
    Some(bytes)
}

pub struct Lease {
    file: PathBuf,
    nonce: String,
}
impl Lease {
    pub fn acquire(dir: &Path) -> io::Result<Self> {
        fs::create_dir_all(dir)?;
        let file = dir.join(".bridge-writer-lease.json");
        let guard = dir.join(".bridge-writer-recovery.json");
        let nonce = uuid::Uuid::new_v4().to_string();
        let staged = dir.join(format!(".bridge-writer-{nonce}.tmp"));
        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)?;
        f.write_all(
            json!({"pid":std::process::id(),"nonce":nonce,"startedAt":now()})
                .to_string()
                .as_bytes(),
        )?;
        f.sync_all()?;
        let result = (|| match fs::hard_link(&staged, &file) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                fs::hard_link(&staged, &guard)?;
                let recovered = (|| {
                    let holder: Value =
                        serde_json::from_slice(&fs::read(&file)?).map_err(io::Error::other)?;
                    let pid = holder["pid"]
                        .as_i64()
                        .filter(|n| *n > 1 && *n <= i32::MAX as i64)
                        .ok_or_else(|| io::Error::other("ambiguous lease"))?;
                    let live = unsafe { libc::kill(pid as i32, 0) };
                    if live == 0 || io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
                        return Err(io::Error::other("store writer occupied or ambiguous"));
                    }
                    fs::remove_file(&file)?;
                    fs::hard_link(&staged, &file)
                })();
                let _ = fs::remove_file(&guard);
                recovered
            }
            Err(e) => Err(e),
        })();
        let _ = fs::remove_file(&staged);
        result?;
        Ok(Self { file, nonce })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(data) = fs::read(&self.file) {
            if let Ok(v) = serde_json::from_slice::<Value>(&data) {
                if v["pid"] == std::process::id() && v["nonce"] == self.nonce {
                    let _ = fs::remove_file(&self.file);
                }
            }
        }
    }
}

pub struct Store {
    pub dir: PathBuf,
    pub data: Value,
}
/// Parse store bytes. JavaScript's `JSON.stringify` writes an unpaired surrogate
/// (left by UTF-16 truncation) as a `\\udXXX` escape, which serde_json refuses.
/// Such a store is valid, not corrupt: only that unit becomes U+FFFD, matching
/// what this bridge stores for its own truncated prompts.
pub fn parse_json(bytes: &[u8]) -> Option<Value> {
    serde_json::from_slice::<Value>(bytes)
        .ok()
        .or_else(|| serde_json::from_slice::<Value>(&replace_lone_surrogates(bytes)?).ok())
}
fn replace_lone_surrogates(bytes: &[u8]) -> Option<Vec<u8>> {
    let hex = |at: usize| -> Option<u16> {
        let text = std::str::from_utf8(bytes.get(at..at + 4)?).ok()?;
        u16::from_str_radix(text, 16).ok()
    };
    let escape_at = |at: usize| -> Option<u16> {
        (bytes.get(at) == Some(&b'\\') && bytes.get(at + 1) == Some(&b'u')).then(|| hex(at + 2)).flatten()
    };
    let (mut out, mut i, mut in_string, mut changed) = (Vec::with_capacity(bytes.len()), 0, false, false);
    while i < bytes.len() {
        let b = bytes[i];
        if !in_string {
            in_string = b == b'"';
            out.push(b);
            i += 1;
            continue;
        }
        match b {
            b'"' => {
                in_string = false;
                out.push(b);
                i += 1
            }
            b'\\' => match escape_at(i) {
                Some(0xD800..=0xDBFF) if matches!(escape_at(i + 6), Some(0xDC00..=0xDFFF)) => {
                    out.extend_from_slice(&bytes[i..i + 12]);
                    i += 12
                }
                Some(0xD800..=0xDFFF) => {
                    out.extend_from_slice(b"\\ufffd");
                    changed = true;
                    i += 6
                }
                _ => {
                    out.extend_from_slice(bytes.get(i..i + 2)?);
                    i += 2
                }
            },
            _ => {
                out.push(b);
                i += 1
            }
        }
    }
    changed.then_some(out)
}
impl Store {
    pub fn open(dir: PathBuf) -> io::Result<Self> {
        let file = dir.join("store.json");
        let parsed = fs::read(&file).ok().and_then(|b| parse_json(&b));
        let mut data = match parsed {
            Some(v) if v.is_object() && v["pins"].is_array() && v["seq"].is_number() => v,
            _ => {
                if file.exists() {
                    fs::copy(
                        &file,
                        dir.join(format!(
                            "store.json.corrupt-{}",
                            chrono::Utc::now().timestamp_millis()
                        )),
                    )?;
                }
                let floor = fs::read_dir(dir.join("inbox"))
                    .ok()
                    .into_iter()
                    .flatten()
                    .filter_map(Result::ok)
                    .filter_map(|f| {
                        let n = f.file_name().to_string_lossy().to_string();
                        let n = n.strip_suffix(".md")?;
                        if n.starts_with("nudge_") || n.starts_with("pin_") {
                            n.rsplit('_').next()?.parse::<u64>().ok()
                        } else {
                            None
                        }
                    })
                    .max()
                    .unwrap_or(0);
                json!({"seq":floor,"pins":[],"receipts":[]})
            }
        };
        if !data["receipts"].is_array() {
            data["receipts"] = json!([])
        }
        Ok(Self { dir, data })
    }
    pub fn commit(&mut self, next: Value) -> io::Result<()> {
        let tmp = self.dir.join("store.json.tmp");
        barrier("write-start", &self.dir);
        fs::write(&tmp, serde_json::to_vec_pretty(&next)?)?;
        barrier("write-complete", &self.dir);
        barrier("pre-rename", &self.dir);
        fs::rename(&tmp, self.dir.join("store.json"))?;
        barrier("post-rename", &self.dir);
        self.data = next;
        Ok(())
    }
    pub fn maintain(&mut self) -> io::Result<()> {
        let current = chrono::Utc::now().timestamp_millis();
        let mut next = self.data.clone();
        let mut removed = Vec::new();
        next["pins"].as_array_mut().unwrap().retain(|p| {
            let old = p["status"] == "resolved"
                && millis(p.get("resolvedAt").unwrap_or(&p["createdAt"]))
                    .is_some_and(|at| at < current - HORIZON);
            if old {
                removed.push(p["id"].as_str().unwrap_or("").to_string());
            }
            !old
        });
        next["receipts"]
            .as_array_mut()
            .unwrap()
            .retain(|r| millis(&r["createdAt"]).is_none_or(|at| current <= at + HORIZON + 300000));
        if let Some(journal) = next.get_mut("withdrawals").and_then(Value::as_array_mut) {
            journal.retain(|p| millis(&p["withdrawnAt"]).is_none_or(|at| at >= current - 86400000));
        }
        if next != self.data {
            self.commit(next)?;
        }
        if let Some(journal) = self.data["withdrawals"].as_array() {
            for p in journal {
                let id = p["id"].as_str().unwrap_or("");
                if !regex::Regex::new(r"^(pin|nudge)_[0-9]+$")
                    .unwrap()
                    .is_match(id)
                {
                    continue;
                }
                self.mirror(p, true)?;
                let _ = fs::remove_file(self.dir.join("inbox").join(format!("{id}.md")));
                for suffix in [".png", "_full.jpg", "_full.png", "_after.png"] {
                    let _ = fs::remove_file(self.dir.join("shots").join(format!("{id}{suffix}")));
                }
            }
        }
        for id in removed {
            // Only canonical generated identifiers may become filesystem paths.
            if !regex::Regex::new(r"^(pin|nudge)_[0-9]+$")
                .unwrap()
                .is_match(&id)
            {
                continue;
            }
            for suffix in [".png", "_full.jpg", "_full.png", "_after.png"] {
                let _ = fs::remove_file(self.dir.join("shots").join(format!("{id}{suffix}")));
            }
            let _ = fs::remove_file(self.dir.join("inbox").join(format!("{id}.md")));
        }
        if let Ok(files) = fs::read_dir(self.dir.join("inbox")) {
            for file in files.filter_map(Result::ok) {
                if file
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".withdrawn.md")
                    && file
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|at| std::time::SystemTime::now().duration_since(at).ok())
                        .is_some_and(|age| age > std::time::Duration::from_secs(86400))
                {
                    let _ = fs::remove_file(file.path());
                }
            }
        }
        Ok(())
    }
    pub fn pin(&self, id: &str) -> Option<&Value> {
        self.data["pins"].as_array()?.iter().find(|p| p["id"] == id)
    }
    pub fn save_image(&self, id: &str, suffix: &str, v: &Value) -> io::Result<Option<String>> {
        if v.is_null() {
            return Ok(None);
        }
        let (kind, bytes) = if suffix == "_full" {
            overview(v)
        } else {
            image(v).map(|b| ("png", b))
        }
        .ok_or_else(|| io::Error::other("invalid image"))?;
        fs::create_dir_all(self.dir.join("shots"))?;
        let name = format!("{id}{suffix}.{kind}");
        fs::write(self.dir.join("shots").join(&name), bytes)?;
        Ok(Some(format!("shots/{name}")))
    }
    pub fn submit(&mut self, p: &Value, owner: Value) -> Result<(u16, Value), String> {
        self.submit_signed(p, &signature(p), owner)
    }
    /// Submit with the signature of the exact request bytes (see `parse_js`).
    pub fn submit_signed(&mut self, p: &Value, sig: &str, owner: Value) -> Result<(u16, Value), String> {
        if !p.is_object() {
            return Err("invalid_submission".into());
        }
        let modern = !p["submissionId"].is_null() || !p["submissionCreatedAt"].is_null();
        let sid = token(&p["submissionId"], 128);
        if modern {
            if sid.is_null() {
                return Err("invalid_submission_id".into());
            }
            let at = millis(&p["submissionCreatedAt"])
                .filter(|_| {
                    p["submissionCreatedAt"]
                        .as_str()
                        .is_some_and(|s| s.len() <= 40)
                })
                .ok_or("invalid_submission_time")?;
            let current = chrono::Utc::now().timestamp_millis();
            if at > current + 300000 || at < current - HORIZON {
                return Err("invalid_submission_time".into());
            }
            if let Some(prior) = self.data["receipts"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["submissionId"] == sid)
            {
                // Unknown historic signature algorithms are refused before mutation.
                if prior["signatureVersion"] != 2 {
                    return Err("unsupported_receipt_version".into());
                }
                if prior["signature"] != sig {
                    return Ok((409, json!({"error":"submission_conflict"})));
                }
                return Ok((
                    200,
                    json!({"id":prior["id"],"replay":true,"withdrawn":prior["withdrawn"].as_bool().unwrap_or(false)}),
                ));
            }
        }
        if !annotations(&p["annotations"]) {
            return Err("invalid_annotations".into());
        }
        for k in ["screenshot", "screenshotFull"] {
            if !p[k].is_null()
                && (if k == "screenshotFull" {
                    overview(&p[k]).is_none()
                } else {
                    image(&p[k]).is_none()
                })
            {
                return Err("invalid_submission_image".into());
            }
        }
        let mut next = self.data.clone();
        let seq = next["pins"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p["id"].as_str()?.rsplit('_').next()?.parse::<u64>().ok())
            .chain(next["seq"].as_u64())
            .max()
            .unwrap_or(0)
            + 1;
        let id = format!("nudge_{seq}");
        let mut pin = json!({"id":id,"status":"open","createdAt":now(),"author":opt(&p["author"],80),"text":cap(&p["text"],4000),"url":cap(&p["url"],2000),"title":cap(&p["title"],300),"ua":opt(&p["ua"],300),"owner":owner,"browserSource":source(&p["browserSource"]),"selectionGeneration":js_token(&p["selectionGeneration"]),"submissionId":sid,"submissionCreatedAt":if modern{opt(&p["submissionCreatedAt"],40)}else{Value::Null},"viewport":rect(&p["viewport"]),"target":target(&p["target"]),"targets":targets(&p["targets"]),"annotations":p.get("annotations").cloned().unwrap_or(Value::Null),"console":p["console"].as_array().map(|a|a.iter().skip(a.len().saturating_sub(20)).map(|l|json!(cap(l,500))).collect::<Vec<_>>())});
        for (field, suffix) in [("screenshot", ""), ("screenshotFull", "_full")] {
            if !p[field].is_null() {
                pin[field] = json!(
                    self.save_image(&id, suffix, &p[field])
                        .map_err(|e| e.to_string())?
                );
            }
        }
        next["seq"] = json!(seq);
        next["pins"].as_array_mut().unwrap().push(pin.clone());
        if modern {
            next["receipts"].as_array_mut().unwrap().push(json!({"submissionId":sid,"signature":sig,"signatureVersion":2,"createdAt":p["submissionCreatedAt"],"withdrawn":false,"id":id}));
        }
        self.commit(next).map_err(|e| e.to_string())?;
        let _ = self.mirror(&pin, false);
        Ok((
            201,
            if modern {
                json!({"id":id,"replay":false,"withdrawn":false})
            } else {
                json!({"id":id})
            },
        ))
    }
    pub fn mutate(
        &mut self,
        id: &str,
        action: &str,
        p: &Value,
        owner: Value,
    ) -> Result<(u16, Value, Option<Value>), String> {
        let mut next = self.data.clone();
        let pins = next["pins"].as_array_mut().unwrap();
        let Some(i) = pins.iter().position(|pin| pin["id"] == id) else {
            return Ok((404, json!({"error":"not found"}), None));
        };
        let mut pin = pins[i].clone();
        let mut response = json!({"ok":true});
        match action {
            "resolve" => {
                pin["status"] = json!("resolved");
                pin["resolvedAt"] = json!(now());
                if pin["owner"].is_null() {
                    pin["owner"] = owner
                }
                pins[i] = pin.clone();
            }
            "amend" => {
                if pin["status"] != "open" {
                    return Ok((409, json!({"error":"resolved"}), None));
                }
                let text = cap(&p["text"], 4000).trim().to_string();
                if text.is_empty() {
                    return Ok((400, json!({"error":"empty"}), None));
                }
                if !pin["amendments"].is_array() {
                    pin["amendments"] = json!([])
                }
                pin["amendments"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"text":text,"author":opt(&p["author"],80),"at":now()}));
                response["amendments"] = json!(pin["amendments"].as_array().unwrap().len());
                pins[i] = pin.clone();
            }
            "delete" => {
                pins.remove(i);
                pin["withdrawnAt"] = json!(now());
                if pin["status"] == "open" {
                    if next.get("withdrawals").is_some_and(|v| !v.is_array()) {
                        return Err("invalid withdrawal journal".into());
                    }
                    if next.get("withdrawals").is_none() {
                        next["withdrawals"] = json!([]);
                    }
                    next["withdrawals"].as_array_mut().unwrap().push(json!({"id":pin["id"],"status":"open","url":cap(&pin["url"],2000),"owner":pin["owner"],"createdAt":opt(&pin["createdAt"],40),"withdrawnAt":pin["withdrawnAt"],"target":{"selector":cap(&pin["target"]["selector"],500)}}));
                }
                for r in next["receipts"].as_array_mut().unwrap() {
                    if r["id"] == id {
                        r["withdrawn"] = json!(true)
                    }
                }
            }
            _ => return Ok((404, json!({"error":"not found"}), None)),
        }
        self.commit(next).map_err(|e| e.to_string())?;
        if action == "delete" {
            let _ = fs::remove_file(self.dir.join("inbox").join(format!("{id}.md")));
            if pin["status"] == "open" {
                let _ = self.mirror(&pin, true);
            }
            for suffix in [".png", "_full.jpg", "_full.png", "_after.png"] {
                let _ = fs::remove_file(self.dir.join("shots").join(format!("{id}{suffix}")));
            }
        } else {
            let _ = self.mirror(&pin, false);
        }
        Ok((200, response, Some(pin)))
    }
    pub fn mirror(&self, p: &Value, withdrawn: bool) -> io::Result<()> {
        fs::create_dir_all(self.dir.join("inbox"))?;
        let id = p["id"].as_str().unwrap_or("");
        let get = |v: &Value| v.as_str().unwrap_or("").to_string();
        let mut body = if withdrawn {
            format!(
                "# {id} (#{}) - withdrawn\n\nThe user withdrew this nudge. Stop work on it IMMEDIATELY, do not commit, do not resolve.\n\n- withdrawn: {}\n",
                label(id),
                get(&p["withdrawnAt"])
            )
        } else {
            format!(
                "# {id} (#{}) - {}\n\n> {}\n\n",
                label(id),
                get(&p["status"]),
                get(&p["text"])
            )
        };
        body += &format!(
            "- url: {}\n- selector: `{}`\n- created: {}\n",
            get(&p["url"]),
            get(&p["target"]["selector"]),
            get(&p["createdAt"])
        );
        if !p["owner"].is_null() {
            body += &format!(
                "- agent: {}\n- session: {}\n",
                get(&p["owner"]["label"]),
                get(&p["owner"]["session"])
            )
        }
        if !withdrawn {
            if let Some(a) = p["amendments"].as_array() {
                for item in a {
                    body += &format!("\n> **Amendment:** {}\n", get(&item["text"]))
                }
            }
            for (k, title) in [
                ("screenshot", "Screenshot"),
                ("screenshotAfter", "Evidence (after)"),
            ] {
                if let Some(s) = p[k].as_str() {
                    body += &format!("\n## {title}\n\n![image](../{s})\n")
                }
            }
            if !p["browserSource"].is_null() {
                body += &format!("\n- browser provenance: `{}`\n", p["browserSource"]);
            }
        }
        let file = self.dir.join("inbox").join(format!(
            "{id}{}.md",
            if withdrawn { ".withdrawn" } else { "" }
        ));
        let tmp = file.with_extension("md.tmp");
        fs::write(&tmp, body)?;
        fs::rename(tmp, &file)?;
        if withdrawn {
            if let Some(at) = millis(&p["withdrawnAt"]).filter(|at| *at >= 0) {
                let time = std::time::UNIX_EPOCH + std::time::Duration::from_millis(at as u64);
                fs::File::open(file)?.set_times(fs::FileTimes::new().set_modified(time))?;
            }
        }
        Ok(())
    }
}
#[cfg(feature = "fault-hooks")]
fn barrier(stage: &str, _dir: &Path) {
    if std::env::var("NUDGE_TEST_BARRIER").ok().as_deref() == Some(stage) {
        if let Ok(file) = std::env::var("NUDGE_TEST_SIGNAL") {
            let _ = fs::write(file, stage);
            loop {
                std::thread::park()
            }
        }
    }
}
#[cfg(not(feature = "fault-hooks"))]
fn barrier(_stage: &str, _dir: &Path) {}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_are_display_only() {
        assert_eq!(label("nudge_1000"), 1);
        assert_eq!(label("nudge_999"), 999);
        assert_eq!(label("bad"), 0)
    }
    #[test]
    fn signature_matches_reviewed_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../test/fixtures/bridge-comparison/signature.json"
        ))
        .unwrap();
        assert_eq!(signature(&fixture["input"]), fixture["sha256"]);
    }
    #[test]
    fn immutable_independent_signature_example() {
        let a = json!({"text":"Original","url":"http://localhost:5322/"});
        let b = json!({"url":"http://localhost:5322/","text":"Original"});
        assert_eq!(signature(&a), signature(&b));
        assert_ne!(
            signature(&a),
            signature(&json!({"text":"Changed","url":"http://localhost:5322/"}))
        );
    }
    #[test]
    fn source_requires_all_four_tokens() {
        assert!(source(&json!({"browser":"chrome","session":"a","tab":"b"})).is_null());
        assert!(
            !source(&json!({"browser":"chrome","session":"a","tab":"b","document":"c"})).is_null()
        );
    }
    #[test]
    fn route_is_exact_and_query_free() {
        assert_eq!(host("http://127.0.0.1:5322/a?port=99"), "localhost:5322");
        assert_eq!(
            route("http://alpha.localhost:5322/a?x=1#b"),
            Some("http://alpha.localhost:5322/a#b".into())
        );
        assert!(route("http://user@localhost/a").is_none());
        assert!(!local_origin("http://localhost.foreign.example"));
    }
    // Expected spellings are ECMAScript Number::toString results recorded from
    // Node, the reference engine, not values derived from this implementation.
    #[test]
    fn numbers_use_ecmascript_spelling() {
        for (x, expected) in [
            (1e21, "1e+21"),
            (1e-7, "1e-7"),
            (0.000001, "0.000001"),
            (123e-20, "1.23e-18"),
            (12345678901234567890.0, "12345678901234567000"),
            (-0.0, "0"),
            (100.0, "100"),
            (1.5, "1.5"),
            (9007199254740992.0, "9007199254740992"),
            (0.1, "0.1"),
            (-2.5e-7, "-2.5e-7"),
            (1e300, "1e+300"),
            (5e-324, "5e-324"),
            (123456789012345680000.0, "123456789012345680000"),
        ] {
            assert_eq!(js_number(x), expected, "{x:e}");
        }
        assert_eq!(js_string(&json!([1.0, null, [2, "b"], {"k": 1}])), "1,,2,b,[object Object]");
    }
    #[test]
    fn json_quoting_and_key_order_match_json_stringify() {
        let mut out = String::new();
        let units = |s: &str| s.encode_utf16().collect::<Vec<_>>();
        let mut lone = units("x\u{1F600}");
        lone.pop();
        Js::Arr(vec![
            Js::Str(units("a\u{1}\"\\\u{8}\u{c}\n\r\t\u{2028}")),
            Js::Str(lone),
            Js::from(&json!({"\u{ffff}":1,"\u{1F600}":2,"é":3,"Z":4,"a":5})),
        ])
        .write(&mut out);
        assert_eq!(
            out,
            "[\"a\\u0001\\\"\\\\\\b\\f\\n\\r\\t\u{2028}\",\"x\\ud83d\",{\"Z\":4,\"a\":5,\"é\":3,\"\u{1F600}\":2,\"\u{ffff}\":1}]"
        );
    }
    #[test]
    fn falsy_fields_hash_like_or_null() {
        let base = json!({"text":"Same","url":"http://localhost:5322/"});
        let mut empty = base.clone();
        empty["console"] = json!("");
        empty["annotations"] = json!(0);
        assert_eq!(signature(&base), signature(&empty));
        let mut number = base.clone();
        number["selectionGeneration"] = json!(12);
        let mut text = base.clone();
        text["selectionGeneration"] = json!("12");
        assert_eq!(signature(&number), signature(&text));
    }
    #[test]
    fn request_bytes_keep_unpaired_surrogates_for_signatures() {
        let body = br##"{"text":"Same","url":"http://localhost:5322/","target":{"selector":"#x","innerText":"cut\ud83d"},"text":"Last wins"}"##;
        let value = parse_json(body).unwrap();
        assert_eq!(value["target"]["innerText"], "cut\u{fffd}");
        let exact = signature_js(&parse_js(body).unwrap());
        assert_ne!(exact, signature(&value), "U+FFFD must not stand in for the JavaScript unit");
        let mut out = String::new();
        parse_js(body).unwrap().write(&mut out);
        assert_eq!(out, r##"{"target":{"innerText":"cut\ud83d","selector":"#x"},"text":"Last wins","url":"http://localhost:5322/"}"##);
    }
    #[test]
    fn javascript_lone_surrogate_store_is_valid_not_corrupt() {
        let written = br#"{"seq":1,"pins":[{"id":"nudge_1","text":"cut\ud83d","pair":"\ud83d\ude00","literal":"\\ud83d"}],"receipts":[]}"#;
        let parsed = parse_json(written).unwrap();
        assert_eq!(parsed["pins"][0]["text"], "cut\u{fffd}");
        assert_eq!(parsed["pins"][0]["pair"], "\u{1F600}");
        assert_eq!(parsed["pins"][0]["literal"], "\\ud83d");
        assert!(parse_json(b"{\"seq\":1,\"pins\":[").is_none());
    }
    #[test]
    fn malformed_images_and_geometry_are_refused() {
        assert!(image(&json!("data:image/png;base64,bm90cG5n")).is_none());
        assert_eq!(rect(&json!({"x":"wrong","width":3})), json!({"width":3}));
        assert!(!annotations(&json!([{"type":"lasso","points":[]}])));
    }
}

#[cfg(test)]
mod store_behavior {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!("nudge-rust-unit-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn open(&self) -> Store {
            Store::open(self.0.clone()).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn input(n: u64) -> Value {
        json!({"submissionId":format!("reference_test_{n}"),"submissionCreatedAt":now(),"text":format!("Expected {n}"),"url":"http://alpha.localhost:5322/"})
    }
    #[test]
    fn maintenance_does_not_insert_an_unsupported_null_journal() {
        let f = Fixture::new();
        let mut store = f.open();
        let before = store.data.clone();
        store.maintain().unwrap();
        assert_eq!(store.data, before);
        assert!(store.data.get("withdrawals").is_none());
        let (_, made) = store.submit(&input(1), Value::Null).unwrap();
        assert_eq!(
            store
                .mutate(
                    made["id"].as_str().unwrap(),
                    "delete",
                    &Value::Null,
                    Value::Null
                )
                .unwrap()
                .0,
            200
        );
    }
    #[test]
    fn failed_commit_keeps_disk_and_memory_authoritative() {
        let f = Fixture::new();
        let mut store = f.open();
        let a = input(1);
        let b = input(2);
        assert_eq!(store.submit(&a, Value::Null).unwrap().0, 201);
        let original = store.data.clone();
        fs::create_dir(f.0.join("store.json.tmp")).unwrap();
        assert!(store.submit(&b, Value::Null).is_err());
        assert_eq!(store.data, original);
        assert_eq!(f.open().data, original);
        fs::remove_dir(f.0.join("store.json.tmp")).unwrap();
        assert_eq!(store.submit(&b, Value::Null).unwrap().0, 201);
        assert_eq!(store.submit(&b, Value::Null).unwrap().0, 200);
        assert_eq!(store.data["pins"].as_array().unwrap().len(), 2);
    }
    #[test]
    fn withdrawal_restart_and_replay_cannot_recreate_work() {
        let f = Fixture::new();
        let mut store = f.open();
        let p = input(1);
        let (_, made) = store
            .submit(&p, json!({"label":"alpha","session":"session_alpha"}))
            .unwrap();
        let id = made["id"].as_str().unwrap();
        assert_eq!(id, "nudge_1");
        store
            .mutate(id, "delete", &Value::Null, Value::Null)
            .unwrap();
        let mut store = f.open();
        let (status, replay) = store.submit(&p, json!({"session":"session_beta"})).unwrap();
        assert_eq!(status, 200);
        assert_eq!(replay["id"], "nudge_1");
        assert_eq!(replay["withdrawn"], true);
        assert_eq!(store.data["pins"], json!([]));
        let marker = fs::read_to_string(f.0.join("inbox/nudge_1.withdrawn.md")).unwrap();
        assert!(marker.contains("session_alpha"));
        assert!(!marker.contains("Expected 1"));
        assert_eq!(
            store.submit(&input(2), Value::Null).unwrap().1["id"],
            "nudge_2"
        );
    }
    #[test]
    fn corrupt_bytes_are_preserved_and_inbox_prevents_identity_reuse() {
        let f = Fixture::new();
        fs::create_dir(f.0.join("inbox")).unwrap();
        fs::write(f.0.join("inbox/nudge_41.md"), "fixture").unwrap();
        fs::write(f.0.join("store.json"), b"{broken").unwrap();
        let mut store = f.open();
        assert_eq!(
            store.submit(&input(1), Value::Null).unwrap().1["id"],
            "nudge_42"
        );
        let backup = fs::read_dir(&f.0)
            .unwrap()
            .filter_map(Result::ok)
            .find(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("store.json.corrupt-")
            })
            .unwrap();
        assert_eq!(fs::read(backup.path()).unwrap(), b"{broken");
    }
    #[test]
    fn lease_cannot_be_stolen_or_release_replacement_ownership() {
        let f = Fixture::new();
        let lease = Lease::acquire(&f.0).unwrap();
        assert!(Lease::acquire(&f.0).is_err());
        fs::write(
            f.0.join(".bridge-writer-lease.json"),
            json!({"pid":std::process::id(),"nonce":"replacement"}).to_string(),
        )
        .unwrap();
        drop(lease);
        assert!(f.0.join(".bridge-writer-lease.json").exists());
    }
    #[test]
    fn independent_seeded_retries_conserve_order_and_identity() {
        let f = Fixture::new();
        let mut store = f.open();
        let mut expected = std::collections::BTreeMap::new();
        let mut order = vec![];
        let mut inputs = std::collections::BTreeMap::new();
        let mut seed = 19u32;
        for n in 0..100 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            let k = (seed % 12) as u64;
            let p = inputs.entry(k).or_insert_with(|| input(k));
            let (status, v) = store.submit(p, Value::Null).unwrap();
            if let Some(id) = expected.get(&k) {
                assert_eq!(status, 200);
                assert_eq!(&v["id"], id)
            } else {
                assert_eq!(status, 201);
                expected.insert(k, v["id"].clone());
                order.push(format!("Expected {k}"));
            }
            if n % 11 == 0 {
                store = f.open();
            }
        }
        assert_eq!(
            store.data["pins"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| p["text"].as_str().unwrap().to_string())
                .collect::<Vec<_>>(),
            order
        );
        assert_eq!(
            store.data["receipts"].as_array().unwrap().len(),
            expected.len()
        );
    }
}

/// JPEG auxiliary overview: structural admission only, matching its declared proof class.
pub fn overview(v: &Value) -> Option<(&'static str, Vec<u8>)> {
    if let Some(png) = image(v) {
        return Some(("png", png));
    }
    let input = v.as_str()?.strip_prefix("data:image/jpeg;base64,")?;
    if input.len() > 8 * 1024 * 1024 * 4 / 3 + 4 {
        return None;
    }
    let b = base64::engine::general_purpose::STANDARD
        .decode(input)
        .ok()?;
    if b.is_empty()
        || b.len() > 8 * 1024 * 1024
        || base64::engine::general_purpose::STANDARD.encode(&b) != input
        || b.get(..2)? != [255, 216]
    {
        return None;
    }
    let mut at = 2usize;
    let (mut frame, mut scans, mut quant, mut huffman) = (false, 0, false, false);
    while at < b.len() {
        if b[at] != 255 {
            return None;
        }
        at += 1;
        while *b.get(at)? == 255 {
            at += 1
        }
        let marker = *b.get(at)?;
        at += 1;
        if marker == 0xd9 {
            return if frame && scans > 0 && quant && huffman && at == b.len() {
                Some(("jpg", b))
            } else {
                None
            };
        }
        if marker == 0 || marker == 0xd8 || (0xd0..=0xd7).contains(&marker) {
            return None;
        }
        let len = u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?) as usize;
        let end = at.checked_add(len)?;
        if len < 2 {
            return None;
        }
        let d = b.get(at + 2..end)?;
        match marker {
            0xc0..=0xc2 => {
                if frame || d.len() < 6 || d[0] != 8 {
                    return None;
                }
                let h = u16::from_be_bytes([d[1], d[2]]) as u64;
                let w = u16::from_be_bytes([d[3], d[4]]) as u64;
                let n = d[5] as usize;
                if h == 0
                    || w == 0
                    || w * h * 4 > 64 * 1024 * 1024
                    || ![1, 3, 4].contains(&n)
                    || d.len() != 6 + n * 3
                {
                    return None;
                }
                frame = true
            }
            0xdb => {
                if d.is_empty() {
                    return None;
                }
                let mut p = 0;
                while p < d.len() {
                    let desc = d[p];
                    p += 1;
                    if desc >> 4 > 1 || desc & 15 > 3 {
                        return None;
                    }
                    p += 64 * ((desc >> 4) as usize + 1);
                    if p > d.len() {
                        return None;
                    }
                }
                quant = true
            }
            0xc4 => {
                if d.is_empty() {
                    return None;
                }
                let mut p = 0;
                while p < d.len() {
                    if p + 17 > d.len() || d[p] >> 4 > 1 || d[p] & 15 > 3 {
                        return None;
                    }
                    let n = d[p + 1..p + 17].iter().map(|v| *v as usize).sum::<usize>();
                    if n == 0 || n > 256 {
                        return None;
                    }
                    p += 17 + n;
                    if p > d.len() {
                        return None;
                    }
                }
                huffman = true
            }
            0xda => {
                if !frame
                    || d.len() < 6
                    || d[0] == 0
                    || d[0] > 4
                    || d.len() != 4 + 2 * d[0] as usize
                {
                    return None;
                }
                scans += 1;
                at = end;
                let start = at;
                while at < b.len() {
                    if b[at] != 255 {
                        at += 1;
                        continue;
                    }
                    let next = *b.get(at + 1)?;
                    if next == 0 || (0xd0..=0xd7).contains(&next) {
                        at += 2;
                        continue;
                    }
                    break;
                }
                if at == start {
                    return None;
                }
                continue;
            }
            0xdd => {
                if d.len() != 2 {
                    return None;
                }
            }
            0xe0..=0xef | 0xfe => {}
            _ => return None,
        }
        at = end;
    }
    None
}
