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
pub fn cap(v: &Value, n: usize) -> String {
    let s = match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    };
    String::from_utf16_lossy(&s.encode_utf16().take(n).collect::<Vec<_>>())
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
pub fn signature(p: &Value) -> String {
    digest(&json!({"text":cap(&p["text"],4000),"url":cap(&p["url"],2000),"author":cap(&p["author"],80),"target":target(&p["target"]),"targets":targets(&p["targets"]),"browserSource":source(&p["browserSource"]),"submissionCreatedAt":p.get("submissionCreatedAt").cloned().unwrap_or(Value::Null),"selectionGeneration":token(&p["selectionGeneration"],128),"title":cap(&p["title"],300),"ua":cap(&p["ua"],300),"viewport":rect(&p["viewport"]),"annotations":p.get("annotations").cloned().unwrap_or(Value::Null),"console":p.get("console").cloned().unwrap_or(Value::Null),"screenshot":p.get("screenshot").cloned().unwrap_or(Value::Null),"screenshotFull":p.get("screenshotFull").cloned().unwrap_or(Value::Null)}).to_string())
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
impl Store {
    pub fn open(dir: PathBuf) -> io::Result<Self> {
        let file = dir.join("store.json");
        let parsed = fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
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
                if prior["signature"] != signature(p) {
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
        let mut pin = json!({"id":id,"status":"open","createdAt":now(),"author":opt(&p["author"],80),"text":cap(&p["text"],4000),"url":cap(&p["url"],2000),"title":cap(&p["title"],300),"ua":opt(&p["ua"],300),"owner":owner,"browserSource":source(&p["browserSource"]),"selectionGeneration":token(&p["selectionGeneration"],128),"submissionId":sid,"submissionCreatedAt":if modern{opt(&p["submissionCreatedAt"],40)}else{Value::Null},"viewport":rect(&p["viewport"]),"target":target(&p["target"]),"targets":targets(&p["targets"]),"annotations":p.get("annotations").cloned().unwrap_or(Value::Null),"console":p["console"].as_array().map(|a|a.iter().skip(a.len().saturating_sub(20)).map(|l|json!(cap(l,500))).collect::<Vec<_>>())});
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
            next["receipts"].as_array_mut().unwrap().push(json!({"submissionId":sid,"signature":signature(p),"signatureVersion":2,"createdAt":p["submissionCreatedAt"],"withdrawn":false,"id":id}));
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
