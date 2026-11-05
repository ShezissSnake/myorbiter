//! Builds from Nox's Frame (noxsframe.com), a fan-made build planner by Senjunox.
//!
//! It has no API. Its terms (Nov 2026) forbid only automated mass requests, and its robots.txt
//! allows the public pages orbiter reads (it disallows /api/, /builder, /account, /login and the
//! admin pages, which orbiter never touches). So orbiter reads two kinds of public page, on demand
//! and as gently as a person would:
//!
//! - `/builds?item=<unique name>`: an item's builds, top-voted first (the site's default order);
//! - `/builds/<id>-<slug>`: one build. Its loadout is the page's "build code" (`NFB1:` and
//!   base64url of zlib-packed JSON keyed by the game's unique names), with schema.org data for
//!   the title, author and dates, and the vote counter.
//!
//! Only GET, with an honest User-Agent, at most one request every three seconds across orbiter,
//! with timeouts. Each answer is cached for seven days in `<cache>/noxsframe/`; "refresh" asks
//! again under the same spacing. A "slow down", a refusal or a browser check stops all reads for
//! a while: orbiter never works around a protection. Mapping to orbiter's builds is the page's
//! business (src/lib/core/builds/noxsframe.ts).

use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SITE: &str = "https://noxsframe.com";
/// How orbiter introduces itself to Nox's Frame.
pub const USER_AGENT: &str = concat!("orbiter/", env!("CARGO_PKG_VERSION"), " (Warframe companion; build lookup; contact via noxsframe Discord)");
/// At most one request this often, across orbiter.
pub const GAP: Duration = Duration::from_secs(3);
/// How long an answer is kept before it's asked for again.
pub const KEEP_MS: u64 = 7 * 86_400_000;
/// After a "slow down", a refusal or a browser check: no reads for this long.
const COOL_OFF: Duration = Duration::from_secs(15 * 60);
/// Pages are about 0.3 to 0.9 MB; anything far larger isn't one of them.
const MAX_PAGE: u64 = 4 * 1024 * 1024;
/// A decoded build code is a few kB of JSON.
const MAX_CODE_JSON: u64 = 512 * 1024;
/// Builds read from one item's list (its first page, top-voted first).
const MAX_LISTED: usize = 10;

// ------------------------------------------------------------------ spacing

/// Keeps requests at least `gap` apart, start to start. Callers queue on the lock, so two pages
/// asking at once still go out one after the other.
pub struct Spacer {
    last: Mutex<Option<Instant>>,
    gap: Duration,
}

impl Spacer {
    pub const fn new(gap: Duration) -> Self {
        Spacer { last: Mutex::new(None), gap }
    }

    /// Waits for this request's turn, then marks it as taken.
    pub fn turn(&self) {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        let wait = wait_needed(*last, Instant::now(), self.gap);
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
        *last = Some(Instant::now());
    }
}

/// How long to wait before the next request, the last one having gone out at `last`.
pub fn wait_needed(last: Option<Instant>, now: Instant, gap: Duration) -> Duration {
    last.map_or(Duration::ZERO, |at| gap.saturating_sub(now.saturating_duration_since(at)))
}

static SPACER: Spacer = Spacer::new(GAP);
static COOL_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

fn cooling() -> Option<Duration> {
    let until = (*COOL_UNTIL.lock().unwrap_or_else(|e| e.into_inner()))?;
    until.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())
}

fn cool_off() {
    *COOL_UNTIL.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now() + COOL_OFF);
}

/// A reply that says "not like this": too many requests, a refusal, the site busy, or a browser
/// check (Cloudflare's "Just a moment", a captcha). orbiter stops asking for a while.
pub fn is_turned_away(status: u16, body: &str) -> bool {
    if matches!(status, 401 | 403 | 429 | 503) {
        return true;
    }
    let mut cut = body.len().min(20_000);
    while !body.is_char_boundary(cut) {
        cut -= 1;
    }
    let head = &body[..cut];
    let lower = head.to_ascii_lowercase();
    lower.contains("just a moment...") || lower.contains("cf-chl") || lower.contains("captcha") || lower.contains("challenge-platform")
}

// ------------------------------------------------------------------ fetching

/// One public page, as text. GET only, spaced, with a timeout and a size cap.
fn get_page(url: &str) -> Result<String, String> {
    if let Some(left) = cooling() {
        return Err(format!("Nox's Frame asked orbiter to wait; trying again in {} min", left.as_secs() / 60 + 1));
    }
    SPACER.turn();
    let resp = crate::http_agent()
        .get(url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "text/html")
        .set("Accept-Language", "en")
        .timeout(Duration::from_secs(20))
        .call();
    let path = url.strip_prefix(SITE).unwrap_or(url);
    match resp {
        Ok(r) => {
            let mut body = String::new();
            r.into_reader().take(MAX_PAGE).read_to_string(&mut body).map_err(|e| format!("Nox's Frame's page didn't arrive whole ({e})"))?;
            if is_turned_away(200, &body) {
                cool_off();
                log::warn!(target: "orbiter::noxsframe", "GET {path}: a browser check; not reading for a while");
                return Err("Nox's Frame showed a browser check; orbiter doesn't get past those, so it stops asking for a while".into());
            }
            Ok(body)
        }
        Err(ureq::Error::Status(code, r)) => {
            let body = r.into_string().unwrap_or_default();
            log::warn!(target: "orbiter::noxsframe", "GET {path}: {code}");
            if is_turned_away(code, &body) {
                cool_off();
                return Err(format!("Nox's Frame turned the request away ({code}); orbiter stops asking for a while"));
            }
            Err(format!("Nox's Frame answered {code}"))
        }
        Err(e) => {
            log::warn!(target: "orbiter::noxsframe", "GET {path}: {e}");
            Err(format!("Couldn't reach Nox's Frame ({e})"))
        }
    }
}

/// A game unique name, as orbiter will put it in a URL: `/Lotus/…`, letters, digits, `_` and `/`.
pub fn plain_unique_name(s: &str) -> bool {
    s.starts_with("/Lotus/") && s.len() < 200 && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-'))
}

/// A build's path segment (`<id>-<slug>`): letters, digits, `_` and `-` only.
pub fn plain_segment(s: &str) -> bool {
    !s.is_empty() && s.len() <= 160 && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

pub fn list_url(item: &str) -> String {
    format!("{SITE}/builds?item={}", item.replace('/', "%2F"))
}

pub fn build_url(segment: &str) -> String {
    format!("{SITE}/builds/{segment}")
}

// ------------------------------------------------------------------ reading pages

/// The Next.js data a page carries (`self.__next_f.push([1,"…"])` chunks), joined.
pub fn flight(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    while let Some(i) = rest.find("self.__next_f.push(") {
        rest = &rest[i + "self.__next_f.push(".len()..];
        let mut stream = serde_json::Deserializer::from_str(rest).into_iter::<Value>();
        if let Some(Ok(Value::Array(a))) = stream.next() {
            if let (Some(1), Some(Value::String(s))) = (a.first().and_then(Value::as_u64), a.get(1)) {
                out.push_str(s);
            }
        }
    }
    out
}

/// `&#x27;`, `&amp;` and the like, for text taken out of the page's HTML.
fn unescape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest.find(';').filter(|&e| e <= 10);
        let decoded = end.and_then(|e| match &rest[1..e] {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            n if n.starts_with("#x") || n.starts_with("#X") => u32::from_str_radix(&n[2..], 16).ok().and_then(char::from_u32),
            n if n.starts_with('#') => n[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        });
        match (decoded, end) {
            (Some(c), Some(e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The text of some HTML: tags and comments dropped, entities decoded, spaces collapsed.
fn text_of(html: &str) -> String {
    let mut out = String::new();
    let mut rest = html;
    loop {
        match rest.find('<') {
            Some(i) => {
                out.push_str(&rest[..i]);
                rest = &rest[i..];
                let end = if rest.starts_with("<!--") { rest.find("-->").map(|e| e + 3) } else { rest.find('>').map(|e| e + 1) };
                match end {
                    Some(e) => rest = &rest[e..],
                    None => break,
                }
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }
    unescape_html(&out).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The inside of the first element in `html` that starts with `open` and ends at `close`.
fn inner<'a>(html: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let i = html.find(open)?;
    let start = i + html[i..].find('>')? + 1;
    let end = start + html[start..].find(close)?;
    Some(&html[start..end])
}

/// "11/1/2026" (the site's English dates) as "2026-11-01".
pub fn us_date(s: &str) -> Option<String> {
    let mut it = s.split('/');
    let (m, d, y): (u32, u32, u32) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    (it.next().is_none() && (1..=12).contains(&m) && (1..=31).contains(&d) && (2000..3000).contains(&y)).then(|| format!("{y:04}-{m:02}-{d:02}"))
}

/// The points shown on a card (`title="12 points"`), and its date ("· 11/1/2026").
fn points_and_date(html: &str) -> (Option<i64>, Option<String>) {
    let mut points = None;
    if let Some(i) = html.find(" point\"").or_else(|| html.find(" points\"")) {
        let before = &html[..i];
        let start = before.rfind('"').map_or(0, |q| q + 1);
        points = before[start..].trim().parse().ok();
    }
    let text = text_of(html);
    let date = text.split('·').skip(1).filter_map(|p| p.split_whitespace().next()).find_map(us_date);
    (points, date)
}

/// An item's builds from its list page, top-voted first, as the site orders them.
pub fn read_list(html: &str) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("href=\"/builds/") {
        rest = &rest[i + "href=\"/builds/".len()..];
        let Some(q) = rest.find('"') else { break };
        let segment = &rest[..q];
        let Some(end) = rest.find("</a>") else { break };
        let card = &rest[..end];
        rest = &rest[end..];
        if !plain_segment(segment) || !card.contains("<h3") || out.iter().any(|v| v["path"] == segment) {
            continue;
        }
        let title = inner(card, "<h3", "</h3>").map(text_of).unwrap_or_default();
        let meta = inner(card, "<p class=\"truncate", "</p>").map(text_of).unwrap_or_default();
        let (item_name, by) = meta.split_once('·').map_or(("", meta.as_str()), |(a, b)| (a.trim(), b.trim()));
        let author = by.strip_prefix("by ").unwrap_or(by).trim();
        let tags: Vec<String> = inner(card, "<p class=\"flex flex-wrap", "</p>")
            .map(|p| p.split("</span>").map(text_of).filter(|t| !t.is_empty()).collect())
            .unwrap_or_default();
        // Points and date are in the card, or streamed in after it (a <template id="P:n"> whose
        // content arrives as <div hidden id="S:n">).
        let (mut points, mut date) = points_and_date(card);
        let mut t = card;
        while let Some(j) = t.find("<template id=\"P:") {
            t = &t[j + "<template id=\"P:".len()..];
            let id: String = t.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
            let open = format!("<div hidden id=\"S:{id}\">");
            if let Some(k) = html.find(&open) {
                let body = &html[k..];
                // Up to the part's end, or 20,000 bytes when it has none: stepped back to a
                // character boundary, since slicing inside one panics (and panics abort).
                let mut end = body.find("</div><script").unwrap_or(body.len().min(20_000));
                while !body.is_char_boundary(end) {
                    end -= 1;
                }
                let body = &body[..end];
                let (p, d) = points_and_date(body);
                points = points.or(p);
                date = date.or(d);
            }
        }
        out.push(json!({
            "path": segment, "url": build_url(segment), "title": title, "item": item_name,
            "author": author, "votes": points, "date": date, "tags": tags,
        }));
        if out.len() >= MAX_LISTED {
            break;
        }
    }
    out
}

/// The build code on a build page: a `code` prop, given inline or as a text row (`$a5` pointing
/// at `a5:T<hex length>,NFB1:…`).
pub fn code_in(flight: &str) -> Option<String> {
    let ok = |c: &str| c.starts_with("NFB") && c.len() > 8 && c.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b':'));
    let mut rest = flight;
    while let Some(i) = rest.find("\"code\":\"") {
        rest = &rest[i + "\"code\":\"".len()..];
        let Some(q) = rest.find('"') else { break };
        let v = &rest[..q];
        if ok(v) {
            return Some(v.to_string());
        }
        if let Some(row) = v.strip_prefix('$').filter(|r| !r.is_empty() && r.bytes().all(|b| b.is_ascii_hexdigit())) {
            if let Some(code) = text_row(flight, row, ok) {
                return Some(code.to_string());
            }
        }
    }
    None
}

/// A flight text row's content (`<row>:T<hex byte length>,<text>`; the next row follows with no
/// separator), the first such row whose text passes `ok`.
fn text_row<'a>(flight: &'a str, row: &str, ok: impl Fn(&str) -> bool) -> Option<&'a str> {
    let marker = format!("{row}:T");
    let mut from = 0;
    while let Some(i) = flight[from..].find(&marker).map(|i| i + from) {
        from = i + 1;
        let after = &flight[i + marker.len()..];
        let Some(comma) = after.find(',').filter(|&c| c > 0 && c <= 8) else { continue };
        let Ok(len) = usize::from_str_radix(&after[..comma], 16) else { continue };
        if let Some(text) = after.get(comma + 1..comma + 1 + len).filter(|t| ok(t)) {
            return Some(text);
        }
    }
    None
}

/// A build code's JSON. Only `NFB1:` (zlib, base64url) is known.
pub fn decode_code(code: &str) -> Result<Value, String> {
    use base64::Engine;
    let code = code.trim();
    let Some(body) = code.strip_prefix("NFB1:") else {
        return Err(if code.starts_with("NFB") { "a newer Nox's Frame build code than orbiter can read".into() } else { "not a Nox's Frame build code".into() });
    };
    let packed = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body.trim_end_matches('=')).map_err(|_| "the build code is cut short or changed".to_string())?;
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(&packed[..]).take(MAX_CODE_JSON).read_to_end(&mut raw).map_err(|_| "the build code is cut short or changed".to_string())?;
    let v: Value = serde_json::from_slice(&raw).map_err(|_| "the build code doesn't hold a build".to_string())?;
    if !v.is_object() {
        return Err("the build code doesn't hold a build".into());
    }
    Ok(v)
}

/// The game modes a build page tags it with (`<a title="Game mode" href="/builds?mode=steelpath">
/// Steel Path</a>`): their keys and their labels, in the page's order.
pub fn game_modes(html: &str) -> (Vec<String>, Vec<String>) {
    let (mut keys, mut labels) = (Vec::new(), Vec::new());
    let mut rest = html;
    while let Some(i) = rest.find("href=\"/builds?mode=") {
        let tag_start = rest[..i].rfind('<').unwrap_or(0);
        let after = &rest[i + "href=\"/builds?mode=".len()..];
        let key: String = after.chars().take_while(|c| c.is_ascii_lowercase()).collect();
        let tag_end = after.find('>').map_or(after.len(), |e| e + 1);
        let tag = &rest[tag_start..i + "href=\"/builds?mode=".len() + tag_end];
        let label = after[tag_end..].split('<').next().map(unescape_html).unwrap_or_default().trim().to_string();
        rest = &after[tag_end..];
        if tag.contains("title=\"Game mode\"") && !key.is_empty() && !label.is_empty() && !keys.contains(&key) {
            keys.push(key);
            labels.push(label);
        }
    }
    (keys, labels)
}

/// One build from its page: title, description, author and dates (schema.org data), the vote
/// counter, its game modes, and the decoded build code.
pub fn read_build(html: &str, segment: &str) -> Result<Value, String> {
    let mut meta = Value::Null;
    let mut rest = html;
    while let Some(i) = rest.find("<script type=\"application/ld+json\"") {
        rest = &rest[i..];
        let Some(start) = rest.find('>') else { break };
        let Some(end) = rest.find("</script>") else { break };
        // A tag whose first '>' is the one closing </script> has nothing between: get(), not a
        // slice that would panic.
        if let Some(Ok(v)) = rest.get(start + 1..end).map(serde_json::from_str::<Value>) {
            if v["@type"] == "CreativeWork" {
                meta = v;
                break;
            }
        }
        rest = &rest[end..];
    }
    let f = flight(html);
    let code = code_in(&f).ok_or("orbiter couldn't find the build on its page (the page may have changed)")?;
    let decoded = decode_code(&code)?;
    // The vote counter: {"id":"…","score":n,"up":n,"down":n,…}.
    let mut votes = Value::Null;
    let mut r = f.as_str();
    while let Some(i) = r.find(",\"score\":") {
        let open = r[..i].rfind('{');
        if let Some(o) = open.filter(|o| i - o < 80) {
            if let Some(Ok(v)) = serde_json::Deserializer::from_str(&r[o..]).into_iter::<Value>().next() {
                if v["id"].is_string() && v["score"].is_i64() {
                    votes = v;
                    break;
                }
            }
        }
        r = &r[i + 1..];
    }
    let (modes, tags) = game_modes(html);
    let id = votes["id"].as_str().map(str::to_string).unwrap_or_else(|| segment.chars().take(12).collect());
    let s = |v: &Value| v.as_str().map(|t| t.chars().take(4000).collect::<String>());
    Ok(json!({
        "id": id,
        "path": segment,
        // Always the page that was read, never the address the page names for itself: a link
        // orbiter opens is a build page on noxsframe.com and nothing else.
        "url": build_url(segment),
        "title": s(&meta["name"]).or_else(|| s(&decoded["name"])),
        "description": s(&meta["description"]),
        "author": s(&meta["author"]["name"]),
        "item": s(&meta["about"]["name"]),
        "published": s(&meta["datePublished"]),
        "modified": s(&meta["dateModified"]),
        "votes": votes.get("score").cloned().unwrap_or(Value::Null),
        "up": votes.get("up").cloned().unwrap_or(Value::Null),
        "down": votes.get("down").cloned().unwrap_or(Value::Null),
        "modes": modes,
        "tags": tags,
        "code": code,
        "build": decoded,
    }))
}

// ------------------------------------------------------------------ cache

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Whether an answer fetched at `at` still counts at `now` (and isn't from the future).
pub fn fresh(at: u64, now: u64) -> bool {
    at <= now + 86_400_000 && now.saturating_sub(at) < KEEP_MS
}

fn cache_file(dir: &Path, kind: &str, key: &str) -> PathBuf {
    let key: String = key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    dir.join(format!("{kind}-{key}.json"))
}

fn read_cache(path: &Path) -> Option<(u64, Value)> {
    let v: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    Some((v["fetchedAt"].as_u64()?, v.get("data")?.clone()))
}

fn write_cache(path: &Path, at: u64, data: &Value) {
    let bytes = serde_json::to_vec(&json!({ "fetchedAt": at, "data": data })).unwrap_or_default();
    if let Err(e) = crate::write_atomic(path, &bytes, false) {
        log::warn!(target: "orbiter::noxsframe", "keeping {}: {e}", path.display());
    }
}

/// An answer from the cache when it's fresh (or `refresh` is off and the network fails), else
/// from the network. `{fetchedAt, fromCache, stale, error?, data}`; `cached_only`: null when
/// nothing is kept, and never the network.
pub fn cached_or_fetch(path: &Path, refresh: bool, cached_only: bool, fetch: impl FnOnce() -> Result<Value, String>) -> Result<Value, String> {
    let kept = read_cache(path);
    let now = now_ms();
    if let Some((at, data)) = &kept {
        if cached_only || (!refresh && fresh(*at, now)) {
            return Ok(json!({ "fetchedAt": at, "fromCache": true, "stale": !fresh(*at, now), "data": data }));
        }
    }
    if cached_only {
        return Ok(Value::Null);
    }
    match fetch() {
        Ok(data) => {
            write_cache(path, now, &data);
            Ok(json!({ "fetchedAt": now, "fromCache": false, "stale": false, "data": data }))
        }
        // Offline or turned away: what was kept is better than nothing, said to be old.
        Err(e) => match kept {
            Some((at, data)) => Ok(json!({ "fetchedAt": at, "fromCache": true, "stale": true, "error": e, "data": data })),
            None => Err(e),
        },
    }
}

/// An item's top builds on Nox's Frame (see `read_list`).
pub fn item_builds(cache_dir: &Path, item: &str, refresh: bool) -> Result<Value, String> {
    if !plain_unique_name(item) {
        return Err("not an item orbiter looks up".into());
    }
    let path = cache_file(&cache_dir.join("noxsframe"), "list", item);
    cached_or_fetch(&path, refresh, false, || get_page(&list_url(item)).map(|html| Value::Array(read_list(&html))))
}

/// One build (see `read_build`).
pub fn build(cache_dir: &Path, segment: &str, refresh: bool, cached_only: bool) -> Result<Value, String> {
    if !plain_segment(segment) {
        return Err("not a Nox's Frame build".into());
    }
    let path = cache_file(&cache_dir.join("noxsframe"), "build", segment);
    cached_or_fetch(&path, refresh, cached_only, || get_page(&build_url(segment)).and_then(|html| read_build(&html, segment)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = include_str!("../../tests/fixtures/noxsframe/list.html");
    const MIRAGE: &str = include_str!("../../tests/fixtures/noxsframe/build-mirage.html");
    const NUKOR: &str = include_str!("../../tests/fixtures/noxsframe/build-nukor.html");

    #[test]
    fn requests_are_spaced() {
        let t0 = Instant::now();
        let gap = Duration::from_secs(3);
        assert_eq!(wait_needed(None, t0, gap), Duration::ZERO, "the first goes at once");
        assert_eq!(wait_needed(Some(t0), t0 + Duration::from_secs(1), gap), Duration::from_secs(2));
        assert_eq!(wait_needed(Some(t0), t0 + Duration::from_secs(5), gap), Duration::ZERO);
        // Three turns, from two threads at once: each starts at least a gap after the one before.
        let spacer = std::sync::Arc::new(Spacer::new(Duration::from_millis(60)));
        let times = std::sync::Arc::new(Mutex::new(Vec::new()));
        let handles: Vec<_> = (0..3)
            .map(|_| {
                let (s, t) = (spacer.clone(), times.clone());
                std::thread::spawn(move || {
                    s.turn();
                    t.lock().unwrap().push(Instant::now());
                })
            })
            .collect();
        handles.into_iter().for_each(|h| h.join().unwrap());
        let mut t = times.lock().unwrap().clone();
        t.sort();
        for w in t.windows(2) {
            assert!(w[1] - w[0] >= Duration::from_millis(55), "{:?}", w[1] - w[0]);
        }
    }

    #[test]
    fn a_refusal_or_a_browser_check_stops_reads() {
        assert!(is_turned_away(429, ""));
        assert!(is_turned_away(403, ""));
        assert!(is_turned_away(200, "<title>Just a moment...</title>"));
        assert!(is_turned_away(200, "<script src=\"/cdn-cgi/challenge-platform/h/b\"></script>"));
        assert!(!is_turned_away(200, MIRAGE));
        assert!(!is_turned_away(404, "Not found"));
    }

    #[test]
    fn only_plain_names_go_into_urls() {
        assert_eq!(list_url("/Lotus/Powersuits/Harlequin/MiragePrime"), "https://noxsframe.com/builds?item=%2FLotus%2FPowersuits%2FHarlequin%2FMiragePrime");
        assert!(plain_unique_name("/Lotus/Weapons/Tenno/Melee/Glaives/PrimeGlaive/PrimeGlaiveWeapon"));
        assert!(!plain_unique_name("/Lotus/x&page=2"));
        assert!(!plain_unique_name("https://example.com"));
        assert!(plain_segment("02OZ99LT_8kP-mirage-prime-glaive-prime-build"));
        assert!(!plain_segment("../api/x"));
        assert!(!plain_segment("x?y"));
    }

    #[test]
    fn reads_an_items_list() {
        let list = read_list(LIST);
        let paths: Vec<_> = list.iter().map(|v| v["path"].as_str().unwrap()).collect();
        assert_eq!(paths, ["Zt1qnzGVQA9c-rays-gloom-ember", "iTWopjQX-PiC-kuva-nukor-starkes-allrounder-build", "1yEfiJBGk9lB-dante-sterben-ist-keine-option", "02OZ99LT_8kP-mirage-prime-glaive-prime-build"]);
        // The first card's points and date are streamed in after it; the others carry them.
        assert_eq!(list[0]["votes"], 1);
        assert_eq!(list[0]["date"], "2026-10-31");
        assert_eq!(list[0]["author"], "Author Two");
        assert_eq!(list[0]["item"], "Ember Prime");
        assert_eq!(list[1]["votes"], 0);
        assert_eq!(list[1]["date"], "2026-11-01");
        assert_eq!(list[1]["title"], "Kuva Nukor - Starkes Allrounder Build");
        assert_eq!(list[1]["tags"], json!(["All-round", "Endurance", "Farming"]));
        assert_eq!(list[3]["url"], "https://noxsframe.com/builds/02OZ99LT_8kP-mirage-prime-glaive-prime-build");
    }

    #[test]
    fn reads_a_build_whose_code_is_a_text_row() {
        let b = read_build(MIRAGE, "02OZ99LT_8kP-mirage-prime-glaive-prime-build").unwrap();
        assert_eq!(b["id"], "02OZ99LT_8kP");
        assert_eq!(b["title"], "Mirage Prime - Glaive Prime Build");
        assert_eq!(b["author"], "Author One");
        assert_eq!(b["modified"], "2026-11-01T10:17:41.148Z");
        assert_eq!(b["votes"], 0);
        assert_eq!(b["modes"], json!(["allround", "steelpath", "archon", "farming"]));
        assert_eq!(b["tags"], json!(["All-round", "Steel Path", "Archon Hunt", "Farming"]));
        assert_eq!(b["build"]["warframe"]["itemId"], "/Lotus/Powersuits/Harlequin/MiragePrime");
        assert_eq!(b["build"]["melee"]["itemId"], "/Lotus/Weapons/Tenno/Melee/Glaives/PrimeGlaive/PrimeGlaiveWeapon");
        assert!(b["code"].as_str().unwrap().starts_with("NFB1:eNr"));
    }

    #[test]
    fn a_page_naming_another_address_still_links_to_itself() {
        let page = MIRAGE.replace(
            "\"url\":\"https://noxsframe.com/builds/02OZ99LT_8kP-mirage-prime-glaive-prime-build\"",
            "\"url\":\"https://noxsframe.com.evil.example/login\"",
        );
        assert_ne!(page, MIRAGE, "the fixture names its own address");
        let b = read_build(&page, "02OZ99LT_8kP-mirage-prime-glaive-prime-build").unwrap();
        assert_eq!(b["url"], "https://noxsframe.com/builds/02OZ99LT_8kP-mirage-prime-glaive-prime-build");
    }

    #[test]
    fn reads_a_build_whose_code_is_inline() {
        let b = read_build(NUKOR, "iTWopjQX-PiC-kuva-nukor-starkes-allrounder-build").unwrap();
        assert_eq!(b["id"], "iTWopjQX-PiC");
        assert_eq!(b["build"]["secondary"]["itemId"], "/Lotus/Weapons/Grineer/KuvaLich/Secondaries/Nukor/KuvaNukor");
        assert_eq!(b["build"]["secondary"]["rank"], 40);
        assert_eq!(b["description"], Value::Null);
        assert_eq!(b["tags"], json!(["All-round", "Endurance", "Farming"]));
        assert_eq!(game_modes("<a href=\"/builds?mode=farming\">Farming</a>"), (vec![], vec![]), "only the build's own Game mode chips");
    }

    /// The JSON the page side is tested with (tests/fixtures/noxsframe/read.json) is what this
    /// reads from the saved pages. `NOX_WRITE_FIXTURE=1 cargo test` writes it anew.
    #[test]
    fn matches_the_page_sides_fixtures() {
        let read = json!({
            "list": read_list(LIST),
            "mirage": read_build(MIRAGE, "02OZ99LT_8kP-mirage-prime-glaive-prime-build").unwrap(),
            "nukor": read_build(NUKOR, "iTWopjQX-PiC-kuva-nukor-starkes-allrounder-build").unwrap(),
        });
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/noxsframe/read.json");
        if std::env::var_os("NOX_WRITE_FIXTURE").is_some() {
            std::fs::write(&path, serde_json::to_string_pretty(&read).unwrap() + "\n").unwrap();
        }
        let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved, read);
    }

    #[test]
    fn build_codes() {
        let b = read_build(NUKOR, "iTWopjQX-PiC-x").unwrap();
        let code = b["code"].as_str().unwrap();
        assert_eq!(decode_code(code).unwrap(), b["build"]);
        assert_eq!(decode_code(&format!("  {code}\n")).unwrap(), b["build"], "pasted with spaces around");
        assert!(decode_code(&code[..code.len() - 40]).is_err(), "cut short");
        assert!(decode_code("NFB2:abc").unwrap_err().contains("newer"));
        assert!(decode_code("hello").unwrap_err().contains("not a Nox"));
    }

    #[test]
    fn the_cache_keeps_a_week_and_serves_old_answers_offline() {
        let now = now_ms();
        assert!(fresh(now - 6 * 86_400_000, now));
        assert!(!fresh(now - 8 * 86_400_000, now));
        assert!(!fresh(now + 3 * 86_400_000, now), "a date from the future doesn't count");

        let dir = std::env::temp_dir().join(format!("orbiter-nox-test-{}", std::process::id()));
        let path = cache_file(&dir, "list", "/Lotus/Powersuits/Harlequin/MiragePrime");
        assert!(path.file_name().unwrap().to_str().unwrap().starts_with("list-_Lotus_Powersuits"));
        let fetches = std::cell::Cell::new(0);
        let fetch = || {
            fetches.set(fetches.get() + 1);
            Ok(json!(["a"]))
        };
        assert_eq!(cached_or_fetch(&path, false, true, fetch).unwrap(), Value::Null, "cached only: nothing yet, and no fetch");
        assert_eq!(fetches.get(), 0);
        let first = cached_or_fetch(&path, false, false, fetch).unwrap();
        assert_eq!((first["fromCache"].as_bool(), fetches.get()), (Some(false), 1));
        let again = cached_or_fetch(&path, false, false, fetch).unwrap();
        assert_eq!((again["fromCache"].as_bool(), fetches.get()), (Some(true), 1), "within the week: no fetch");
        let refreshed = cached_or_fetch(&path, true, false, fetch).unwrap();
        assert_eq!((refreshed["fromCache"].as_bool(), fetches.get()), (Some(false), 2), "refresh asks again");
        // Old and offline: the old answer, marked stale, with the reason.
        write_cache(&path, now - 9 * 86_400_000, &json!(["old"]));
        let offline = cached_or_fetch(&path, false, false, || Err("Couldn't reach Nox's Frame".to_string())).unwrap();
        assert_eq!((offline["stale"].as_bool(), offline["data"].clone()), (Some(true), json!(["old"])));
        assert!(offline["error"].is_string());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn html_text() {
        assert_eq!(text_of("Mirage Prime<!-- --> · <svg/> <!-- -->by Nox"), "Mirage Prime · by Nox");
        assert_eq!(unescape_html("Xata&#x27;s &amp; &lt;b&gt; &bogus; &"), "Xata's & <b> &bogus; &");
        assert_eq!(us_date("11/1/2026").as_deref(), Some("2026-11-01"));
        assert_eq!(us_date("13/1/2026"), None);
    }
}

/// Fuzzing Nox's Frame pages: the saved pages cut short, spliced with junk and odd Unicode, and
/// streamed parts with no end. Never a panic, and every build link stays on Nox's Frame.
#[cfg(test)]
mod fuzz {
    use super::*;

    const PAGES: [&str; 3] = [
        include_str!("../../tests/fixtures/noxsframe/list.html"),
        include_str!("../../tests/fixtures/noxsframe/build-mirage.html"),
        include_str!("../../tests/fixtures/noxsframe/build-nukor.html"),
    ];

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() % n.max(1) as u64) as usize
        }
    }

    fn boundary(s: &str, mut at: usize) -> usize {
        at = at.min(s.len());
        while !s.is_char_boundary(at) {
            at -= 1;
        }
        at
    }

    fn mutate(r: &mut Rng, page: &str) -> String {
        let mut s = page.to_string();
        for _ in 0..r.below(6) {
            let junk = ["\u{00E9}", "\u{1F600}", "\u{202E}", "<", ">", "\"", "</a>", "<h3>", "href=\"/builds/x\"", "<template id=\"P:1f\">", "<div hidden id=\"S:1f\">", "NFB1:", "&amp;", "&#x", "\u{0000}", "</div><script"][r.below(16)];
            match r.below(3) {
                0 => {
                    let at = boundary(&s, r.below(s.len() + 1));
                    s.insert_str(at, junk);
                }
                1 => {
                    let at = boundary(&s, r.below(s.len() + 1));
                    s.truncate(at);
                }
                _ => {
                    let (a, b) = (boundary(&s, r.below(s.len() + 1)), boundary(&s, r.below(s.len() + 1)));
                    let (a, b) = (a.min(b), a.max(b));
                    s.replace_range(a..b, "");
                }
            }
        }
        s
    }

    fn check(html: &str, label: &str) {
        for b in read_list(html) {
            let url = b["url"].as_str().unwrap_or("");
            assert!(url.starts_with("https://www.noxsframe.com/builds/") || url.starts_with(&build_url("")), "{label}: {url}");
        }
        let f = flight(html);
        if let Some(code) = code_in(&f) {
            let _ = decode_code(&code);
        }
        let _ = read_build(html, "x");
        let _ = game_modes(html);
        let _ = text_of(html);
        let _ = unescape_html(html);
        let _ = points_and_date(html);
        for w in html.split_whitespace().take(200) {
            let _ = us_date(w);
        }
    }

    #[test]
    fn mutated_pages_never_panic_and_links_stay_on_the_site() {
        for seed in 0..1500u64 {
            let mut r = Rng(0x5EED_0000 + seed * 7919);
            let page = PAGES[r.below(PAGES.len())];
            check(&mutate(&mut r, page), &format!("seed {seed}"));
        }
    }

    #[test]
    fn a_streamed_part_with_no_end_and_wide_characters_never_panics() {
        // A card whose points arrive in a streamed part that never closes, with characters of
        // every width around the 20,000-byte mark where the reader stops looking.
        for pad in 0..8usize {
            // `pad` ASCII bytes first, so the 20,000th byte falls at every offset inside a
            // two- and a four-byte character.
            let filler: String = "x".repeat(pad) + &"é😀a".chars().cycle().take(20_000).collect::<String>();
            let html = format!(
                "<a href=\"/builds/abc-def\"><h3>Build</h3><template id=\"P:1f\"></template></a><div hidden id=\"S:1f\">{filler}"
            );
            check(&html, &format!("pad {pad}"));
            let _ = is_turned_away(200, &html);
        }
        // A script tag closed by its own </script>, with no '>' before it.
        check("<script type=\"application/ld+json\"</script>", "ld+json without a body");
    }
}
