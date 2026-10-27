use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{
        FromRequestParts, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderValue, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
};
use futures_util::{SinkExt, StreamExt};
use nudge_bridge_experiment::*;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::mpsc;
#[derive(Clone)]
struct Agent {
    value: Value,
    last: Instant,
    /// Roster join order. Like the JavaScript Map, a heartbeat for an existing
    /// key keeps its position; an expired and rejoined key moves to the end.
    joined: u64,
}
struct Client {
    tx: mpsc::Sender<Value>,
    url: String,
    source: Value,
}
struct Document {
    source: Value,
    client: Option<usize>,
    retired: HashSet<String>,
}
struct Capture {
    id: String,
    source: Value,
    client: usize,
    expires: Instant,
}
struct Completed {
    id: String,
    source: Value,
    digest: String,
    expires: Instant,
}
struct App {
    store: Store,
    agents: HashMap<String, Agent>,
    chosen: HashMap<String, String>,
    clients: HashMap<usize, Client>,
    documents: HashMap<String, Document>,
    pending: HashMap<String, Capture>,
    completed: HashMap<String, Completed>,
    next: usize,
    joined: u64,
    roster_sig: String,
}
type Shared = Arc<Mutex<App>>;
fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn tab(v: &Value) -> String {
    json!([v["browser"], v["session"], v["tab"]]).to_string()
}
fn key(v: &Value) -> String {
    if !s(&v["session"]).is_empty() {
        format!("s:{}", s(&v["session"]))
    } else {
        format!("p:{}", v["pid"])
    }
}
/// Newest armed session in join order: `reduce((a, b) => b.since >= a.since ? b : a)`,
/// so equal `since` values elect the session that joined last.
fn newest<'a>(agents: impl Iterator<Item = &'a Value>) -> Option<&'a Value> {
    let since = |v: &Value| v["since"].as_f64().unwrap_or(0.);
    agents.reduce(|a, b| if since(b) >= since(a) { b } else { a })
}
impl App {
    fn fresh(&self) -> Vec<Value> {
        let mut a = self
            .agents
            .values()
            .filter(|a| a.last.elapsed() < Duration::from_secs(12))
            .collect::<Vec<_>>();
        a.sort_by_key(|a| a.joined);
        a.into_iter().map(|a| a.value.clone()).collect()
    }
    fn owner(&self, host: &str) -> Value {
        let a = self.fresh();
        let picked = self.chosen.get(host).or(self.chosen.get("*"));
        if let Some(k) = picked {
            if let Some(v) = a.iter().find(|a| key(a) == *k) {
                return v.clone();
            }
        }
        let eligible = a
            .iter()
            .filter(|a| {
                host.is_empty()
                    || a["hosts"]
                        .as_array()
                        .is_some_and(|h| h.iter().any(|v| s(v) == host))
            })
            .collect::<Vec<_>>();
        if let Some(v) = newest(eligible.into_iter()) {
            return v.clone();
        }
        newest(a.iter().filter(|a| a["hosts"].is_null()))
            .cloned()
            .unwrap_or(Value::Null)
    }
    fn stamp(&self, host: &str) -> Value {
        let o = self.owner(host);
        if o.is_null() {
            Value::Null
        } else {
            json!({"label":o["label"],"session":o["session"]})
        }
    }
    fn agents(&self, host: &str) -> Value {
        let o = self.owner(host);
        json!(
            self.fresh()
                .into_iter()
                .map(|mut a| {
                    a["owner"] = json!(!o.is_null() && a["pid"] == o["pid"]);
                    a
                })
                .collect::<Vec<_>>()
        )
    }
    fn owns(&self, a: &Value) -> bool {
        let k = key(a);
        self.chosen.values().any(|p| p == &k)
            || key(&self.owner("")) == k
            || a["hosts"]
                .as_array()
                .is_some_and(|h| h.iter().any(|h| key(&self.owner(s(h))) == k))
    }
    fn sig(&self) -> String {
        let mut chosen = self.chosen.iter().collect::<Vec<_>>();
        chosen.sort();
        let a = self
            .fresh()
            .into_iter()
            .map(|mut a| {
                a.as_object_mut().unwrap().remove("lastSeen");
                a
            })
            .collect::<Vec<_>>();
        json!([a, chosen]).to_string()
    }
    fn eligible(&self, id: usize, p: &Value) -> bool {
        let Some(c) = self.clients.get(&id) else {
            return false;
        };
        if c.source.is_null() || source(&p["browserSource"]).is_null() {
            return false;
        }
        self.documents
            .get(&tab(&c.source))
            .is_some_and(|d| d.client == Some(id) && d.source == c.source)
            && tab(&c.source) == tab(&p["browserSource"])
            && route(s(&p["url"])).is_some()
            && route(s(&p["url"])) == route(&c.url)
    }
    fn evidence(&self, p: &Value) -> Value {
        if p["screenshot"].is_null() || p["status"] != "resolved" {
            return Value::Null;
        }
        if !p["screenshotAfter"].is_null() {
            return json!({"status":"captured","provenance":if p["afterBrowserSource"].is_null(){"legacy_unverified"}else{"source_bound"}});
        }
        let reason = if p["browserSource"].is_null() {
            return json!({"status":"pending","reason":"legacy_unbound","provenance":"legacy_unverified"});
        } else {
            match self.documents.get(&tab(&p["browserSource"])) {
                None => "source_unavailable",
                Some(d) => match d.client {
                    None => "source_unavailable",
                    Some(id) if !self.eligible(id, p) => "source_route_changed",
                    _ => "awaiting_source_capture",
                },
            }
        };
        json!({"status":"pending","reason":reason})
    }
    fn client_pin(&self, p: &Value) -> Value {
        let mut v = json!({"id":p["id"],"label":label(s(&p["id"])),"status":p["status"],"author":p["author"],"owner":p["owner"],"text":p["text"],"url":p["url"],"createdAt":p["createdAt"],"isRegion":p["annotations"].as_array().is_some_and(|a|a.iter().any(|x|x["type"]=="lasso")),"target":{"selector":p["target"]["selector"],"rect":p["target"]["rect"],"innerText":opt(&p["target"]["innerText"],80)}});
        for k in [
            "resolvedAt",
            "amendments",
            "screenshot",
            "screenshotAfter",
            "browserSource",
            "targets",
        ] {
            if !p[k].is_null() {
                v[k] = p[k].clone()
            }
        }
        let e = self.evidence(p);
        if !e.is_null() {
            v["afterEvidence"] = e
        }
        v
    }
    fn snapshot(&self, host: &str) -> Value {
        let owner = self.owner(host);
        let all = self.store.data["pins"].as_array().unwrap();
        let open = all.iter().filter(|p| p["status"] == "open");
        let done = all
            .iter()
            .filter(|p| p["status"] != "open")
            .collect::<Vec<_>>();
        let tail = done.len().saturating_sub(40);
        let pins = open
            .chain(done.into_iter().skip(tail))
            .map(|p| self.client_pin(p))
            .collect::<Vec<_>>();
        json!({"type":"pins","capabilities":{"sourceBoundEvidence":1,"submissionIdempotency":1},"agentLive":!owner.is_null(),"agentLabel":owner["label"],"agentWake":owner["wake"],"agents":self.agents(host),"pins":pins})
    }
    fn broadcast(&mut self) {
        self.roster_sig = self.sig();
        let frames = self
            .clients
            .iter()
            .map(|(id, c)| (*id, self.snapshot(&host(&c.url))))
            .collect::<Vec<_>>();
        for (id, frame) in frames {
            self.send(id, frame);
        }
    }
    fn send(&mut self, id: usize, v: Value) {
        if self
            .clients
            .get(&id)
            .is_some_and(|c| c.tx.try_send(v).is_err())
        {
            self.clients.remove(&id);
            for d in self.documents.values_mut() {
                if d.client == Some(id) {
                    d.client = None
                }
            }
            self.pending.retain(|_, r| r.client != id);
        }
    }
    fn all(&mut self, v: Value) {
        let ids = self.clients.keys().copied().collect::<Vec<_>>();
        for id in ids {
            self.send(id, v.clone());
        }
    }
    fn register(&mut self, id: usize, h: &Value) {
        self.pending.retain(|_, r| r.client != id);
        let src = source(&h["browserSource"]);
        let url = cap(&h["url"], 2000);
        if let Some(c) = self.clients.get_mut(&id) {
            c.url = url.clone();
            c.source = Value::Null
        } else {
            return;
        }
        if src.is_null() || route(&url).is_none() {
            return;
        }
        let k = tab(&src);
        let mut retired = HashSet::new();
        if let Some(d) = self.documents.get(&k) {
            if d.retired.contains(s(&src["document"])) {
                return;
            }
            retired = d.retired.clone();
            if d.source["document"] != src["document"] {
                retired.insert(s(&d.source["document"]).to_string());
            }
            if let Some(old) = d.client {
                self.pending.retain(|_, r| r.client != old);
            }
        }
        if let Some(c) = self.clients.get_mut(&id) {
            c.source = src.clone()
        }
        self.documents.insert(
            k,
            Document {
                source: src,
                client: Some(id),
                retired,
            },
        );
    }
    fn request_evidence(&mut self, id: usize) {
        let Some(c) = self.clients.get(&id) else {
            return;
        };
        if c.source.is_null() {
            return;
        }
        let src = c.source.clone();
        let pins = self.store.data["pins"].as_array().unwrap().clone();
        for p in pins {
            if p["status"] != "resolved"
                || p["screenshot"].is_null()
                || !p["screenshotAfter"].is_null()
                || !self.eligible(id, &p)
            {
                continue;
            }
            let pin = s(&p["id"]).to_string();
            if self
                .pending
                .values()
                .any(|r| r.id == pin && r.client == id && r.expires >= Instant::now())
            {
                continue;
            }
            self.pending.retain(|_, r| r.id != pin);
            let token = uuid::Uuid::new_v4().simple().to_string();
            self.pending.insert(
                token.clone(),
                Capture {
                    id: pin.clone(),
                    source: src.clone(),
                    client: id,
                    expires: Instant::now() + Duration::from_secs(30),
                },
            );
            self.send(
                id,
                json!({"type":"capture-after-v2","id":pin,"requestId":token,"browserSource":src}),
            );
        }
    }
    fn identity(&self, host_q: &str) -> Value {
        let owner = self.owner(host_q);
        let mut hosts = self
            .clients
            .values()
            .map(|c| host(&c.url))
            .filter(|h| !h.is_empty())
            .collect::<Vec<_>>();
        hosts.sort();
        hosts.dedup();
        let routes=hosts.into_iter().map(|h|{let o=self.owner(&h);let picked=self.chosen.get(&h).or(self.chosen.get("*")).is_some_and(|k|self.fresh().iter().any(|a|key(a)==*k));let claimed=o["hosts"].as_array().is_some_and(|a|a.iter().any(|v|s(v)==h));json!({"host":h,"owner":if o.is_null(){Value::Null}else{json!({"label":o["label"],"session":o["session"],"wake":o["wake"]})},"viaFallback":!picked&&!claimed,"via":if picked{"selection"}else if claimed{"worktree"}else{"fallback"}})}).collect::<Vec<_>>();
        let tabs = self
            .clients
            .values()
            .filter(|c| !c.url.is_empty())
            .map(|c| json!({"url":c.url,"browserSource":c.source}))
            .collect::<Vec<_>>();
        let mut chosen = self.chosen.iter().collect::<Vec<_>>();
        chosen.sort();
        json!({"app":"groundworks-nudge","version":"0.20.1","implementation":"rust-experiment","capabilities":{"sourceBoundEvidence":1,"submissionIdempotency":1,"lifecycleIdentity":1},"store":self.store.dir,"workspace":self.store.dir.parent(),"agentLive":!owner.is_null(),"agentLabel":owner["label"],"agentWake":owner["wake"],"agents":self.agents(host_q),"owners":chosen,"routes":routes,"tabs":tabs})
    }
    fn selection(&mut self, p: &Value) -> (u16, Value) {
        let path = self.store.dir.join("selection.json");
        let prev: Value = fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Value::Null);
        let src = source(&p["browserSource"]);
        let generation = token(&p["selectionGeneration"], 128);
        let bound = !p["browserSource"].is_null() || !p["selectionGeneration"].is_null();
        let prior = !prev["browserSource"].is_null() || !prev["selectionGeneration"].is_null();
        let same_route =
            route(s(&p["url"])).is_some() && route(s(&p["url"])) == route(s(&prev["url"]));
        let same = bound
            && prior
            && same_route
            && src == prev["browserSource"]
            && generation == prev["selectionGeneration"];
        if !p.is_object()
            || (bound
                && (src.is_null()
                    || generation.is_null()
                    || s(&p["url"]).len() > 2000
                    || route(s(&p["url"])).is_none()))
            || (p["keepShot"] != false && (if bound { !same } else { prior }))
        {
            return (409, json!({"error":"selection_conflict"}));
        }
        let t = if p["target"].is_object() {
            &p["target"]
        } else {
            p
        };
        let mut sel = json!({"at":now(),"url":cap(&p["url"],2000),"title":cap(&p["title"],300),"selector":cap(&t["selector"],500),"source":opt(&t["source"],500),"xpath":opt(&t["xpath"],500),"innerText":cap(&t["innerText"],300),"outerHTML":cap(&t["outerHTML"],1200),"styles":styles(&t["styles"]),"rect":rect(&t["rect"]),"viewport":rect(&p["viewport"]),"targets":targets(&p["targets"]),"browserSource":src,"selectionGeneration":generation});
        for (field, suffix) in [("screenshot", ""), ("screenshotFull", "_full")] {
            if !p[field].is_null() && p[field] != "" {
                match self.store.save_image("selection", suffix, &p[field]) {
                    Ok(Some(v)) => sel[field] = json!(v),
                    _ => return (409, json!({"error":"invalid_selection_image"})),
                }
            }
            if sel[field].is_null()
                && p["keepShot"] != false
                && (same || (!bound && !prior && same_route))
                && !prev[field].is_null()
            {
                sel[field] = prev[field].clone();
            }
        }
        let result = serde_json::to_vec_pretty(&sel)
            .map_err(std::io::Error::other)
            .and_then(|b| fs::write(path.with_extension("json.tmp"), b))
            .and_then(|_| fs::rename(path.with_extension("json.tmp"), &path));
        if result.is_err() {
            return (400, json!({"error":"selection write failed"}));
        }
        (200, json!({"ok":true,"at":sel["at"]}))
    }
    fn after(&mut self, id: &str, p: &Value) -> (u16, Value) {
        let Some(pin) = self.store.pin(id).cloned() else {
            return (409, json!({"error":"not_eligible"}));
        };
        if pin["status"] != "resolved" || pin["screenshot"].is_null() {
            return (409, json!({"error":"not_eligible"}));
        }
        let bound = !pin["browserSource"].is_null();
        let src = source(&p["browserSource"]);
        let token = s(&p["requestId"]);
        let hash = digest(s(&p["screenshot"]));
        if bound {
            if self.completed.get(token).is_some_and(|c| {
                c.id == id && c.source == src && c.digest == hash && c.expires >= Instant::now()
            }) && !pin["screenshotAfter"].is_null()
            {
                return (200, json!({"ok":true,"duplicate":true}));
            }
            if !self.pending.get(token).is_some_and(|r| {
                r.id == id
                    && r.expires >= Instant::now()
                    && r.source == src
                    && self.eligible(r.client, &pin)
            }) {
                return (409, json!({"error":"capture_request_conflict"}));
            }
        }
        let Some(bytes) = image(&p["screenshot"]) else {
            return (409, json!({"error":"invalid_image"}));
        };
        if !pin["screenshotAfter"].is_null() {
            let legacy = !bound
                && pin["afterImageHash"].is_null()
                && s(&pin["screenshotAfter"]) == format!("shots/{id}_after.png")
                && fs::read(self.store.dir.join(s(&pin["screenshotAfter"])))
                    .is_ok_and(|b| b == bytes);
            return if pin["afterImageHash"] == hash || legacy {
                (200, json!({"ok":true,"duplicate":true}))
            } else {
                (409, json!({"error":"evidence_conflict"}))
            };
        }
        let saved = match self.store.save_image(id, "_after", &p["screenshot"]) {
            Ok(v) => v,
            Err(_) => return (400, json!({"error":"image write failed"})),
        };
        let mut next = self.store.data.clone();
        let stored = next["pins"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|p| p["id"] == id)
            .unwrap();
        stored["screenshotAfter"] = json!(saved);
        stored["afterImageHash"] = json!(hash);
        if bound {
            stored["afterBrowserSource"] = src.clone()
        }
        let updated = stored.clone();
        if self.store.commit(next).is_err() {
            return (400, json!({"error":"commit failed"}));
        }
        let _ = self.store.mirror(&updated, false);
        if bound {
            self.pending.remove(token);
            self.completed.insert(
                token.into(),
                Completed {
                    id: id.into(),
                    source: src,
                    digest: hash,
                    expires: Instant::now() + Duration::from_secs(30),
                },
            );
        }
        self.broadcast();
        (200, json!({"ok":true,"duplicate":false}))
    }
}
fn response(code: u16, v: Value, origin: Option<&str>) -> Response {
    let mut r = (StatusCode::from_u16(code).unwrap(), axum::Json(v)).into_response();
    if let Some(o) = origin {
        if local_origin(o) {
            let h = r.headers_mut();
            h.insert(
                "access-control-allow-origin",
                HeaderValue::from_str(o).unwrap(),
            );
            h.insert(
                "access-control-allow-methods",
                HeaderValue::from_static("GET, POST, DELETE, OPTIONS"),
            );
            h.insert(
                "access-control-allow-headers",
                HeaderValue::from_static("Content-Type"),
            );
            h.insert("vary", HeaderValue::from_static("Origin"));
        }
    }
    r
}
async fn handler(State(shared): State<Shared>, req: Request<Body>) -> Response {
    let (method, uri, headers) = (
        req.method().clone(),
        req.uri().clone(),
        req.headers().clone(),
    );
    let origin = headers.get("origin").and_then(|h| h.to_str().ok());
    let host_header = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let valid_host = regex::Regex::new(r"(?i)^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$")
        .unwrap()
        .captures(host_header)
        .is_some_and(|m| {
            m.get(2)
                .is_none_or(|p| p.as_str().parse::<u16>().is_ok_and(|n| n > 0))
        });
    let websocket = headers
        .get("upgrade")
        .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket"));
    let invalid_origin = headers.get_all("origin").iter().count() > 1
        || (headers.contains_key("origin") && origin.is_none());
    if invalid_origin
        || !valid_host
        || headers.get_all("host").iter().count() != 1
        || uri.scheme().is_some()
        || !uri.path().starts_with('/')
        || uri.path().starts_with("//")
        || uri.to_string().contains(['\\', '#'])
        || origin.is_some_and(|o| !local_origin(o))
    {
        return response(
            if websocket { 401 } else { 403 },
            json!({"error":"foreign or malformed request rejected"}),
            None,
        );
    }
    if websocket {
        let (mut parts, _) = req.into_parts();
        return match WebSocketUpgrade::from_request_parts(&mut parts, &shared).await {
            Ok(ws) => ws
                .max_message_size(65536)
                .max_frame_size(65536)
                .on_upgrade(move |socket| connection(socket, shared))
                .into_response(),
            Err(e) => e.into_response(),
        };
    }
    if method == "OPTIONS" {
        return response(204, Value::Null, origin);
    }
    let path = uri.path().to_string();
    let mut raw = None;
    let payload = if method == "POST" && !path.ends_with("/resolve") {
        let max = std::env::var("NUDGE_MAX_BODY")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(40000000);
        match tokio::time::timeout(Duration::from_secs(8), to_bytes(req.into_body(), max)).await {
            Ok(Ok(b)) => match parse_json(&b) {
                Some(p) => {
                    raw = Some(b);
                    p
                }
                None => return response(400, json!({"error":"invalid JSON or UTF-8"}), origin),
            },
            Ok(Err(_)) => return response(413, json!({"error":"body too large"}), origin),
            Err(_) => return response(408, json!({"error":"body deadline"}), origin),
        }
    } else {
        Value::Null
    };
    let mut a = shared.lock().unwrap();
    if (path == "/comments" || path == "/selection")
        && method == "POST"
        && !payload["browserSource"].is_null()
        && source(&payload["browserSource"]).is_null()
    {
        return response(400, json!({"error":"invalid_browser_source"}), origin);
    }
    let (code, body) = match (method.as_str(), path.as_str()) {
        ("GET", "/.identity") => {
            let q = url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
                .find(|(k, _)| k == "host")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default();
            (200, a.identity(&q))
        }
        ("POST", "/agent/heartbeat") => {
            if !payload["pid"].is_number() || !payload["since"].is_number() {
                return response(
                    400,
                    json!({"error":"heartbeat needs numeric pid and since"}),
                    origin,
                );
            }
            let k = key(&payload);
            if a.agents.get(&k).is_some_and(|old| {
                old.value["pid"] != payload["pid"]
                    && old.value["since"].as_f64().unwrap_or(0.)
                        > payload["since"].as_f64().unwrap_or(0.)
            }) {
                return response(
                    200,
                    json!({"ok":true,"owner":false,"replaced":true}),
                    origin,
                );
            }
            let hosts = if let Some(h) = payload.get("hosts") {
                let valid = h.as_array().is_some_and(|arr| {
                    arr.len() <= 64
                        && arr.iter().all(|v| {
                            let text = s(v);
                            !text.is_empty()
                                && text.len() <= 259
                                && route(&format!("http://{text}")).is_some()
                                && host(&format!("http://{text}"))
                                    == text.replacen("127.0.0.1", "localhost", 1)
                        })
                });
                if !valid {
                    return response(400, json!({"error":"invalid local app host"}), origin);
                }
                h.clone()
            } else {
                a.agents
                    .get(&k)
                    .filter(|old| old.value["pid"] == payload["pid"])
                    .map(|old| old.value["hosts"].clone())
                    .unwrap_or(Value::Null)
            };
            let mut v = json!({"label":opt(&payload["label"],60),"pid":payload["pid"],"since":payload["since"],"session":opt(&payload["session"],128),"wake":if payload["wake"]=="push"{"push"}else{"pull"},"hosts":hosts,"lastSeen":chrono::Utc::now().timestamp_millis()});
            for (k, n) in [
                ("project", 60),
                ("branch", 60),
                ("host", 20),
                ("runtime", 20),
                ("surface", 20),
                ("firstMsg", 90),
            ] {
                v[k] = opt(&payload[k], n)
            }
            let joined = match a.agents.get(&k) {
                Some(old) => old.joined,
                None => {
                    a.joined += 1;
                    a.joined
                }
            };
            a.agents.insert(
                k,
                Agent {
                    value: v.clone(),
                    last: Instant::now(),
                    joined,
                },
            );
            let owns = a.owns(&v);
            if a.sig() != a.roster_sig {
                a.broadcast()
            }
            (200, json!({"ok":true,"owner":owns}))
        }
        ("POST", "/agent/owner") => {
            let target = a.fresh().into_iter().find(|v| {
                (!payload["session"].is_null() && v["session"] == payload["session"])
                    || (!payload["pid"].is_null() && v["pid"] == payload["pid"])
            });
            if let Some(t) = target {
                let h = if s(&payload["host"]).is_empty() {
                    "*".to_string()
                } else {
                    cap(&payload["host"], 259).replacen("127.0.0.1", "localhost", 1)
                };
                a.chosen.insert(h.clone(), key(&t));
                a.broadcast();
                (200, json!({"ok":true,"owner":t["label"],"host":h}))
            } else {
                (404, json!({"error":"no such live agent"}))
            }
        }
        ("GET", "/comments") => {
            let pins=a.store.data["pins"].as_array().unwrap().iter().map(|p|{let mut v=json!({"id":p["id"],"label":label(s(&p["id"])),"status":p["status"],"author":p["author"],"text":p["text"],"url":p["url"],"hasConsole":p["console"].as_array().is_some_and(|v|!v.is_empty()),"hasEvidence":!p["screenshotAfter"].is_null(),"createdAt":p["createdAt"]});for k in ["amendments","browserSource","afterBrowserSource"]{if !p[k].is_null(){v[k]=p[k].clone()}}if !p["owner"].is_null(){v["owner"]=p["owner"]["label"].clone()}for k in ["selector","source"]{if !p["target"][k].is_null(){v[k]=p["target"][k].clone()}}if let Some(t)=p["targets"].as_array(){v["targets"]=json!(t.len())}let e=a.evidence(p);if !e.is_null(){v["afterEvidence"]=e}v}).collect::<Vec<_>>();
            (200, json!(pins))
        }
        ("POST", "/comments") => {
            let owner = a.stamp(&host(s(&payload["url"])));
            // Sign the exact request units so a JavaScript-written receipt
            // replays even when the browser sent an unpaired surrogate.
            let sig = raw
                .as_deref()
                .and_then(parse_js)
                .map_or_else(|| signature(&payload), |j| signature_js(&j));
            match a.store.submit_signed(&payload, &sig, owner) {
                Ok((code, v)) => {
                    if code == 201 {
                        a.broadcast()
                    }
                    (code, v)
                }
                Err(e) => (400, json!({"error":e})),
            }
        }
        ("GET", "/selection") => {
            let v = fs::read(a.store.dir.join("selection.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .filter(Value::is_object)
                .unwrap_or(json!({}));
            (200, v)
        }
        ("POST", "/selection") => a.selection(&payload),
        ("GET", "/demo") => {
            let file = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bridge/demo.html");
            return match fs::read(file) {
                Ok(b) => ([("content-type", "text/html; charset=utf-8")], b).into_response(),
                Err(_) => response(404, json!({"error":"demo missing"}), origin),
            };
        }
        _ => {
            let parts = path.split('/').collect::<Vec<_>>();
            let id = parts.get(2).copied().unwrap_or("");
            let valid = regex::Regex::new(r"^(pin|nudge)_[0-9]+$")
                .unwrap()
                .is_match(id);
            if parts.len() == 3
                && parts[1] == "shots"
                && method == "GET"
                && regex::Regex::new(r"^[\w.-]+\.(png|jpg)$")
                    .unwrap()
                    .is_match(id)
            {
                return match fs::read(a.store.dir.join("shots").join(id)) {
                    Ok(b) => {
                        let mut r = (
                            [(
                                "content-type",
                                if id.ends_with(".jpg") {
                                    "image/jpeg"
                                } else {
                                    "image/png"
                                },
                            )],
                            b,
                        )
                            .into_response();
                        if let Some(o) = origin {
                            r.headers_mut().insert(
                                "access-control-allow-origin",
                                HeaderValue::from_str(o).unwrap(),
                            );
                        }
                        r
                    }
                    Err(_) => response(404, json!({"error":"not found"}), origin),
                };
            }
            if parts.get(1) == Some(&"comments")
                && valid
                && ((method == "POST" && parts.len() == 4)
                    || (method == "DELETE" && parts.len() == 3))
            {
                let action = if method == "DELETE" {
                    "delete"
                } else {
                    parts[3]
                };
                if action == "after" {
                    a.after(id, &payload)
                } else {
                    let old = a.store.pin(id).cloned().unwrap_or(Value::Null);
                    let owner = a.stamp(&host(s(&old["url"])));
                    let recipient = a.fresh().into_iter().find(|o| {
                        !old["owner"]["session"].is_null()
                            && o["session"] == old["owner"]["session"]
                    });
                    match a.store.mutate(id, action, &payload, owner) {
                        Ok((code, mut body, pin)) => {
                            if let Some(pin) = pin {
                                a.broadcast();
                                if action == "resolve" && !pin["screenshot"].is_null() {
                                    if pin["browserSource"].is_null() {
                                        let projection = a.client_pin(&pin);
                                        a.all(json!({"type":"capture-after","pin":projection}));
                                    } else {
                                        for id in a.clients.keys().copied().collect::<Vec<_>>() {
                                            a.request_evidence(id);
                                        }
                                    }
                                }
                                if action == "delete" {
                                    let notified = recipient.is_some() && pin["status"] == "open";
                                    body = json!({"ok":true,"notified":notified,"agent":if notified{recipient.as_ref().unwrap()["label"].clone()}else{Value::Null},"wake":if notified{recipient.as_ref().unwrap()["wake"].clone()}else{Value::Null}});
                                    if pin["status"] == "open" {
                                        a.all(json!({"type":"withdrawn","id":pin["id"],"label":label(id),"url":pin["url"],"owner":pin["owner"],"at":pin["withdrawnAt"]}));
                                    }
                                }
                            }
                            (code, body)
                        }
                        Err(e) => (400, json!({"error":e})),
                    }
                }
            } else {
                (404, json!({"error":"not found"}))
            }
        }
    };
    response(code, body, origin)
}
async fn connection(socket: WebSocket, shared: Shared) {
    let (tx, mut rx) = mpsc::channel(32);
    let id = {
        let mut a = shared.lock().unwrap();
        a.next += 1;
        let id = a.next;
        a.clients.insert(
            id,
            Client {
                tx,
                url: String::new(),
                source: Value::Null,
            },
        );
        let initial = a.snapshot("");
        a.send(id, initial);
        id
    };
    let (mut sink, mut stream) = socket.split();
    let ping_ms = std::env::var("NUDGE_WS_PING")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(30000)
        .max(1);
    let mut tick = tokio::time::interval(Duration::from_millis(ping_ms));
    tick.tick().await;
    let mut alive = true;
    loop {
        tokio::select! {
                 frame=rx.recv()=>{let Some(frame)=frame else{break};if !matches!(tokio::time::timeout(Duration::from_secs(8),sink.send(Message::Text(frame.to_string().into()))).await,Ok(Ok(_))){break}},
                 _=tick.tick()=>{if !alive{break}alive=false;if sink.send(Message::Ping(vec![].into())).await.is_err(){break}},
                 frame=stream.next()=>{match frame{Some(Ok(Message::Pong(_)))=>alive=true,Some(Ok(Message::Text(text)))=>{if let Ok(h)=serde_json::from_str::<Value>(&text){if h["type"]=="hello"{let mut a=shared.lock().unwrap();if h["role"]!="agent"{a.register(id,&h)}let host=a.clients.get(&id).map(|c|host(&c.url)).unwrap_or_default();let snapshot=a.snapshot(&host);a.send(id,snapshot);if h["role"]!="agent"{a.request_evidence(id);}}}},Some(Ok(Message::Ping(data)))=>{if sink.send(Message::Pong(data)).await.is_err(){break}},Some(Err(error))=>{
         let inner = error.into_inner();
         let code = match inner.downcast_ref::<tokio_tungstenite::tungstenite::Error>() {
          Some(tokio_tungstenite::tungstenite::Error::Utf8(_)) => 1007,
          Some(tokio_tungstenite::tungstenite::Error::Capacity(_)) => 1009,
          _ => 1002,
         };
         let _ = sink.send(Message::Close(Some(axum::extract::ws::CloseFrame{code, reason:"invalid client frame".into()}))).await;
         break
        },Some(Ok(Message::Close(_)))|None=>break,_=>{}}
                 }
                }
    }
    let mut a = shared.lock().unwrap();
    a.clients.remove(&id);
    a.pending.retain(|_, r| r.client != id);
    for d in a.documents.values_mut() {
        if d.client == Some(id) {
            d.client = None
        }
    }
    a.broadcast();
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("NUDGE_PORT")?.parse::<u16>()?;
    if port == 4700 || port == 0 {
        return Err("experiment refuses default/live port".into());
    }
    let dir = PathBuf::from(std::env::var("NUDGE_STORE")?);
    fs::create_dir_all(&dir)?;
    let dir = std::path::absolute(dir)?;
    let _lease = Lease::acquire(&dir)?;
    let mut store = Store::open(dir)?;
    store.maintain()?;
    let shared = Arc::new(Mutex::new(App {
        store,
        agents: HashMap::new(),
        chosen: HashMap::new(),
        clients: HashMap::new(),
        documents: HashMap::new(),
        pending: HashMap::new(),
        completed: HashMap::new(),
        next: 0,
        joined: 0,
        roster_sig: String::new(),
    }));
    let sweep = shared.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(5));
        loop {
            tick.tick().await;
            let mut a = sweep.lock().unwrap();
            a.agents
                .retain(|_, v| v.last.elapsed() < Duration::from_secs(60));
            let keys = a.fresh().iter().map(key).collect::<HashSet<_>>();
            a.chosen.retain(|_, k| keys.contains(k));
            a.pending.retain(|_, r| r.expires >= Instant::now());
            a.completed.retain(|_, r| r.expires >= Instant::now());
            if a.sig() != a.roster_sig {
                a.broadcast()
            }
        }
    });
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    eprintln!("experimental Rust bridge listening on isolated port {port}");
    let router = Router::new().fallback(any(handler)).with_state(shared);
    serve(listener, router).await;
    Ok(())
}
/// HTTP/1.1 accept loop. Like Node's HTTP server it answers a request whose
/// client already half-closed its write side, and disables Nagle's algorithm.
/// `axum::serve` drops such responses and exposes neither option.
async fn serve(listener: tokio::net::TcpListener, router: Router) {
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let mut connections = tokio::task::JoinSet::new();
    let mut shutdown = std::pin::pin!(shutdown_signal());
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                let _ = stream.set_nodelay(true);
                let service = hyper_util::service::TowerToHyperService::new(router.clone());
                let mut stop = stop_rx.clone();
                connections.spawn(async move {
                    let connection = hyper::server::conn::http1::Builder::new()
                        .half_close(true)
                        .serve_connection(hyper_util::rt::TokioIo::new(stream), service)
                        .with_upgrades();
                    let mut connection = std::pin::pin!(connection);
                    tokio::select! {
                        _ = connection.as_mut() => {}
                        _ = stop.changed() => {
                            connection.as_mut().graceful_shutdown();
                            let _ = connection.await;
                        }
                    }
                });
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
            _ = &mut shutdown => break,
        }
    }
    drop(listener);
    let _ = stop_tx.send(true);
    // Every commit is written before its response; in-flight responses get a
    // bounded grace period, never an unbounded wait on a slow peer.
    let _ = tokio::time::timeout(Duration::from_secs(1), async {
        while connections.join_next().await.is_some() {}
    })
    .await;
}
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=term.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
