//! MyOrbiter's own log, `myorbiter.log` in the app's log folder (Linux: `~/.local/share/dev.myorbiter.app/logs`,
//! Windows: `%LOCALAPPDATA%\dev.myorbiter.app\logs`). One line per event, in UTC, the way TennoScope
//! writes its own so the two read side by side:
//!
//! ```text
//! [2026-11-02][21:28:20][market][WARN] POST /v2/order: 429, slowing down
//! ```
//!
//! What goes in: starting up, TennoScope started, stopped or failing, every warframe.market change
//! and every request that failed (the method and path, never the sign-in), the drop tables and
//! EE.log being read, and errors from the window. Never a token: anything shaped like one is cut
//! out before it's written. Never the home folder's name either: it is written `~` (`tilde`), so a
//! log passed on to someone doesn't carry the player's user name in its paths. At 2 MB the file moves to `myorbiter.1.log` (the one before that goes), so
//! the two stay under 4 MB; when it can't move, it starts over empty.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const FILE: &str = "myorbiter.log";
pub const OLD_FILE: &str = "myorbiter.1.log";
const MAX_BYTES: u64 = 2 * 1024 * 1024;

struct Sink {
    path: PathBuf,
    file: File,
    size: u64,
}

struct Logger {
    sink: Mutex<Option<Sink>>,
    /// The window's last line and how many times it came again since: one error repeating every
    /// second shouldn't fill the file.
    last_ui: Mutex<(String, u64, u32)>,
}

static LOGGER: Logger = Logger { sink: Mutex::new(None), last_ui: Mutex::new((String::new(), 0, 0)) };
static DIR: OnceLock<PathBuf> = OnceLock::new();
/// The home folder as the system names it, read once (`home`).
static HOME: OnceLock<Option<String>> = OnceLock::new();

/// Where the log is, once it's open.
pub fn dir() -> Option<PathBuf> {
    DIR.get().cloned()
}

/// Opens the log in `dir` and makes it the `log` crate's logger; a panic is logged too. Without a
/// writable folder MyOrbiter runs on, logging to the terminal only.
pub fn init(dir: &Path) {
    let opened = fs::create_dir_all(dir).ok().and_then(|_| open(&dir.join(FILE), false));
    if opened.is_some() {
        let _ = DIR.set(dir.to_path_buf());
    }
    *LOGGER.sink.lock().unwrap_or_else(|e| e.into_inner()) = opened;
    if log::set_logger(&LOGGER).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!(target: "myorbiter::panic", "{info}");
        previous(info);
    }));
}

/// Only you can read it (0600 on Unix, an existing file made so too): it names your trades and
/// partners. `fresh` empties a file already there instead of adding to it.
fn open(path: &Path, fresh: bool) -> Option<Sink> {
    let mut options = OpenOptions::new();
    if fresh {
        options.create(true).write(true).truncate(true);
    } else {
        options.create(true).append(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    }
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    Some(Sink { path: path.to_path_buf(), file, size })
}

impl log::Log for Logger {
    /// MyOrbiter's own lines from Info up; the libraries' (the web view, HTTP, TLS) only warnings and
    /// errors. The update plugin's are left out: it logs an error for every check that can't reach
    /// its manifest, and updates.rs already writes one line per check and per install.
    fn enabled(&self, m: &log::Metadata) -> bool {
        if m.target().starts_with("tauri_plugin_updater") {
            return false;
        }
        m.level() <= if m.target().starts_with("myorbiter") { log::Level::Info } else { log::Level::Warn }
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let area = record.target().strip_prefix("myorbiter_lib::").or_else(|| record.target().strip_prefix("myorbiter::")).unwrap_or(record.target());
        let line = format!("{}[{area}][{}] {}\n", stamp(now()), record.level(), private(&record.args().to_string()));
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        let mut guard = self.sink.lock().unwrap_or_else(|e| e.into_inner());
        let Some(sink) = guard.as_mut() else { return };
        if sink.size + line.len() as u64 > MAX_BYTES {
            // When the file can't move aside (on Windows, while another program holds
            // `myorbiter.1.log` open), it starts over empty instead: its lines go, but the cap holds.
            let moved = fs::rename(&sink.path, sink.path.with_file_name(OLD_FILE)).is_ok();
            // If it can't even be emptied (held without write sharing), it goes on as it was, past
            // the cap, rather than the log stopping for the rest of the session.
            match open(&sink.path, !moved).or_else(|| open(&sink.path, false)) {
                Some(fresh) => *sink = fresh,
                None => {
                    *guard = None;
                    return;
                }
            }
        }
        if sink.file.write_all(line.as_bytes()).is_ok() {
            sink.size += line.len() as u64;
        }
    }

    fn flush(&self) {
        if let Some(sink) = self.sink.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            let _ = sink.file.flush();
        }
    }
}

/// A line from the window (`area`: the page or part of it). The same line again within a minute
/// is counted rather than written, and the count goes in with the next different line.
pub fn from_ui(level: &str, area: &str, message: &str) {
    let level = match level {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        _ => log::Level::Info,
    };
    // One line in the log, whatever the page sent: a line break or other control character would
    // let it write lines that look like MyOrbiter's own (and those go into bug reports).
    let message: String = message.chars().take(2000).map(|c| if c.is_control() { ' ' } else { c }).collect();
    let now = now();
    let repeats = {
        let mut last = LOGGER.last_ui.lock().unwrap_or_else(|e| e.into_inner());
        let key = format!("{area}|{message}");
        if last.0 == key && now.saturating_sub(last.1) < 60 {
            last.2 += 1;
            return;
        }
        let repeats = last.2;
        *last = (key, now, 0);
        repeats
    };
    if repeats > 0 {
        log::info!(target: "myorbiter::ui", "(the line before came {repeats} more time{} within a minute)", if repeats == 1 { "" } else { "s" });
    }
    log::log!(target: &ui_target(area), level, "{message}");
}

/// The log target of a line from the window in `area`: `ui`, or `ui-<area>` (`[ui-notice]` in the
/// file). Never one of the Rust side's own (`market`, `updates`): the page can't write a line that
/// reads as what MyOrbiter did on warframe.market.
fn ui_target(area: &str) -> String {
    let area: String = area.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(24).collect();
    if area.is_empty() || area == "ui" {
        "myorbiter::ui".to_string()
    } else {
        format!("myorbiter::ui-{area}")
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// `[2026-11-02][21:28:20]`, in UTC.
pub fn stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!("[{y:04}-{m:02}-{d:02}][{:02}:{:02}:{:02}]", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// What every line goes through before it's written, and again before it goes into a report (a
/// line written before a rule that reads one line was added is covered too; a report reads the
/// file a line at a time, so a JSON value over several lines that an older build wrote is cut to
/// its first line's end): no sign-in (`redact`), no home folder's name (`tilde`).
fn private(line: &str) -> String {
    let line = redact(line);
    match home() {
        Some(h) => tilde(&line, h),
        None => line,
    }
}

/// The home folder: `HOME` on Linux and macOS, `USERPROFILE` on Windows. None when unset, or too
/// short to be one (`/`, `C:\`), so nothing is replaced by mistake.
fn home() -> Option<&'static str> {
    HOME.get_or_init(|| {
        let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        std::env::var(var).ok().map(|h| h.trim_end_matches(['/', '\\']).to_string()).filter(|h| h.len() > 3)
    })
    .as_deref()
}

/// `line` with the home folder written `~`: `/home/name/.local/share/…` becomes `~/.local/share/…`,
/// `C:\Users\Name\AppData\…` becomes `~\AppData\…`. Also the forms the same folder takes in other
/// programs' messages: with the other kind of slash, with doubled backslashes (JSON), and, for a
/// Linux home, as Wine and Proton write it (`Z:\home\name\…`). Only the whole folder: `/home/name`
/// leaves `/home/names` alone. Windows paths (and Wine's) match in any case, as Windows treats them.
pub fn tilde(line: &str, home: &str) -> String {
    let home = home.trim_end_matches(['/', '\\']);
    if home.len() <= 3 {
        return line.to_string();
    }
    // Each form, and whether it matches in any case.
    let mut forms: Vec<(String, bool)> = Vec::new();
    if home.starts_with('/') {
        forms.push((home.to_string(), false));
        let wine = format!("Z:{}", home.replace('/', "\\"));
        forms.push((wine.replace('\\', "\\\\"), true));
        forms.push((wine, true));
    } else {
        let back = home.replace('/', "\\");
        forms.push((back.replace('\\', "\\\\"), true));
        forms.push((home.replace('\\', "/"), true));
        forms.push((back, true));
    }
    let mut out = line.to_string();
    for (form, any_case) in forms {
        out = replace_folder(&out, &form, any_case);
    }
    out
}

/// Every `folder` in `s` that ends there (followed by a slash, a backslash, or anything that can't
/// carry on a folder's name) becomes `~`.
fn replace_folder(s: &str, folder: &str, any_case: bool) -> String {
    let fold = |t: &str| if any_case { t.to_ascii_lowercase() } else { t.to_string() };
    // ASCII lowercasing keeps every byte where it was, so positions found in `hay` hold in `s`.
    let hay = fold(s);
    let needle = fold(folder);
    let mut out = String::with_capacity(s.len());
    let mut from = 0;
    while let Some(i) = hay[from..].find(&needle).map(|i| i + from) {
        let end = i + needle.len();
        let next = s[end..].chars().next();
        let ends = next.map_or(true, |c| !(c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '~' | '$')));
        // Not the middle of a longer path either (`/srv/home/name`, `/home/name` inside `/x/home/name`).
        let starts = i == 0 || !s[..i].ends_with(|c: char| c.is_alphanumeric() || matches!(c, '/' | '\\' | '-' | '_' | '.'));
        // A file address names the folder too: file:///home/name/…, file:///C:/Users/name/….
        let before = s[..i].to_ascii_lowercase();
        let starts = starts || before.ends_with("file://") || before.ends_with("file:///");
        out.push_str(&s[from..i]);
        out.push_str(if ends && starts { "~" } else { &s[i..end] });
        from = end;
    }
    out.push_str(&s[from..]);
    out
}

/// Cuts out anything shaped like a sign-in: a JWT (three dot-separated base64 runs starting
/// "eyJ"), whatever follows "Bearer", "JWT" or "token", every pair in a Cookie header, the value
/// of a `key=value` or JSON pair whose key names a secret (`secret_pair`, `json_pairs`), and a
/// Discord webhook address (its id and token are all it takes to post as it).
pub fn redact(s: &str) -> String {
    let json = json_pairs(s);
    let s = json.as_str();
    let mut out = String::with_capacity(s.len());
    let mut hide_next = false;
    // After "Cookie:" or "Set-Cookie:" the header's first word is hidden, and so is each
    // `name=value` word after one that ends in `;`.
    let mut cookie_header = false;
    let mut cookie_more = false;
    // Words between any whitespace (a tab or a line break hides nothing), the whitespace kept.
    let mut rest = s;
    while !rest.is_empty() {
        let gap = rest.len() - rest.trim_start().len();
        out.push_str(&rest[..gap]);
        rest = &rest[gap..];
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let start = s.len() - rest.len();
        let (word, after) = rest.split_at(end);
        rest = after;
        if word.is_empty() {
            continue;
        }
        if std::mem::take(&mut cookie_more) && word.contains('=') {
            out.push_str("[redacted]");
            cookie_more = word.ends_with(';');
            continue;
        }
        let bare = word.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        let lower = bare.to_ascii_lowercase();
        // A JWT, whole or cut short after its second part (a line cut at its length limit).
        let is_jwt = |w: &str| w.find("eyJ").is_some_and(|i| w[i..].contains('.'));
        let jwt = is_jwt(word);
        // A word a head hides (after "Bearer", "Authorization:", a Cookie header) goes whole below,
        // the address with it, so it isn't read for one here.
        if let Some(at) = webhook_at(word).filter(|_| !hide_next && word.to_ascii_lowercase().contains("discord")) {
            let start = word[..at].rfind("http").unwrap_or(0);
            // A secret pair or a JWT before the address in the same word goes by its own rule
            // below, which takes the address with it.
            let before = &word[..start];
            if secret_pair(before).is_none() && !is_jwt(before) {
                out.push_str(before);
                out.push_str("[redacted webhook]");
                continue;
            }
        }
        // Punctuation on its own ("token : x") hides nothing and passes the hiding on.
        if bare.is_empty() {
            out.push_str(word);
            continue;
        }
        // "Authorization: Bearer x": the scheme stays readable, the token after it goes.
        let scheme = matches!(lower.as_str(), "bearer" | "jwt" | "token" | "basic");
        if hide_next && scheme {
            out.push_str(word);
            continue;
        }
        if hide_next || jwt {
            out.push_str("[redacted]");
            hide_next = false;
            cookie_more = std::mem::take(&mut cookie_header) && word.ends_with(';');
            continue;
        }
        if let Some((at, in_query)) = secret_pair(word) {
            out.push_str(&word[..at]);
            let v = start + at;
            let line_end = |from: usize| s[from..].find('\n').map_or(s.len(), |e| from + e);
            match s[v..].chars().next().filter(|&c| c == '"' || c == '\'') {
                // A quoted value, to its closing quote (or the line's end).
                Some(q) => {
                    out.push(q);
                    out.push_str("[redacted]");
                    match closing_on_line(s.as_bytes(), v + 1, q as u8) {
                        Some(c) => {
                            out.push(q);
                            rest = &s[c + 1..];
                        }
                        None => rest = &s[line_end(v)..],
                    }
                }
                // After `?`, `&` or `;` (a query, or pairs in one word) a value holds no space: to
                // the word's end.
                None if in_query => out.push_str(if at == word.len() { "" } else { "[redacted]" }),
                // In running text nothing marks where a value with a space ends: to the line's end.
                None if s[v..line_end(v)].trim().is_empty() => rest = &s[line_end(v)..],
                None => {
                    out.push_str("[redacted]");
                    rest = &s[line_end(v)..];
                }
            }
            continue;
        }
        // The word before a secret: a scheme, a header naming one ("Authorization:Bearer" too).
        let last = lower.rsplit(':').next().unwrap_or("");
        cookie_header = matches!(lower.as_str(), "cookie" | "set-cookie");
        hide_next = scheme || cookie_header || matches!(last, "bearer" | "jwt" | "token") || matches!(lower.as_str(), "authorization" | "proxy-authorization");
        out.push_str(word);
    }
    out
}

/// In a word, the place right after the `=` of the first pair whose key names a secret
/// (`secret_key`), and whether that pair comes after a `?`, `&` or `;`. The key of the word's
/// first `=` is all that comes before it (`/auth/token?code=x`, a path naming the secret); a
/// later pair's starts after the `?`, `&` or `;` before it.
fn secret_pair(word: &str) -> Option<(usize, bool)> {
    if let Some(eq) = word.find('=').filter(|&eq| secret_key(&word[..eq])) {
        return Some((eq + 1, word[..eq].contains(['?', '&', ';'])));
    }
    let mut from = 0;
    for (i, c) in word.char_indices().chain([(word.len(), '&')]) {
        if matches!(c, '?' | '&' | ';') {
            let pair = &word[from..i];
            if let Some(eq) = pair.find('=').filter(|&eq| secret_key(&pair[..eq])) {
                return Some((from + eq + 1, from > 0));
            }
            from = i + 1;
        }
    }
    None
}

/// The index of the `q` that closes a quoted value, looking from `b[from]` to the line's end: the
/// first one no backslash escapes.
fn closing_on_line(b: &[u8], from: usize, q: u8) -> Option<usize> {
    (from..b.len()).take_while(|&i| b[i] != b'\n').find(|&i| b[i] == q && backslashes_before(&b[from..], i - from) % 2 == 0)
}

/// The longest JSON key `json_pairs` reads: a longer run between two quotes is text, not a key.
const KEY_MAX: usize = 64;

/// `s` with the value of every JSON pair whose key names a secret (`secret_key`) cut out whole:
/// `{"password":"[redacted]"}`, whatever the spaces around the colon or inside the value; JSON
/// written inside a string (`{\"password\":\"[redacted]\"}`); a key and its value side by side in
/// a list (`["password","[redacted]"]`); an object or a list to its closing bracket, on whatever
/// line (`bare_value_end`); and a string the line cuts short, to the next quote of its kind on a
/// later line or, with none, to the line's end.
fn json_pairs(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::new();
    let mut copied = 0;
    let mut from = 0;
    while let Some(q) = s[from..].find('"').map(|q| q + from) {
        from = q + 1;
        // How deep the quote is escaped: `"` 0, `\"` 1 (JSON inside a string), and so on.
        let depth = backslashes_before(b, q);
        let Some(close) = closing_quote(b, q + 1, depth) else { continue };
        let key = &s[q + 1..close - depth];
        if key.len() > KEY_MAX || !secret_key(key) {
            continue;
        }
        let in_list = matches!(s[..q - depth].trim_end().as_bytes().last(), Some(b'[' | b','));
        let mut v = skip_space(b, close + 1);
        match b.get(v) {
            Some(b':') => v = skip_space(b, v + 1),
            // In a list, only a string after the key is its value.
            Some(b',') if in_list && quote_at(b, skip_space(b, v + 1), depth) => v = skip_space(b, v + 1),
            _ => continue,
        }
        let (start, end, resume) = if quote_at(b, v, depth) {
            let open = v + depth;
            match closing_quote(b, open + 1, depth) {
                Some(c) => (open + 1, c - depth, c + 1),
                None => {
                    let end = s[open + 1..].find('\n').map_or(s.len(), |e| open + 1 + e);
                    (open + 1, end, end)
                }
            }
        } else {
            let end = bare_value_end(b, v, depth);
            (v, end, end)
        };
        if end <= start {
            continue;
        }
        out.push_str(&s[copied..start]);
        out.push_str("[redacted]");
        copied = end;
        from = resume;
    }
    if copied == 0 {
        return s.to_string();
    }
    out.push_str(&s[copied..]);
    out
}

/// How many backslashes come right before `b[i]`.
fn backslashes_before(b: &[u8], i: usize) -> usize {
    b[..i].iter().rev().take_while(|&&c| c == b'\\').count()
}

/// Whether a quote escaped `depth` deep (`depth` backslashes, then `"`) starts at `b[i]`.
fn quote_at(b: &[u8], i: usize, depth: usize) -> bool {
    b.get(i..i + depth).is_some_and(|run| run.iter().all(|&c| c == b'\\')) && b.get(i + depth) == Some(&b'"')
}

/// The index of the `"` that closes a string opened by a quote escaped `depth` deep, looking from
/// `b[from]` on: the first one escaped exactly as deep (at depth 0, any one not escaped).
fn closing_quote(b: &[u8], from: usize, depth: usize) -> Option<usize> {
    (from..b.len()).find(|&i| {
        b[i] == b'"' && {
            let n = backslashes_before(&b[from..], i - from);
            if depth == 0 { n % 2 == 0 } else { n == depth }
        }
    })
}

fn skip_space(b: &[u8], mut i: usize) -> usize {
    while b.get(i).is_some_and(|c| c.is_ascii_whitespace()) {
        i += 1;
    }
    i
}

/// Where a JSON value that isn't a string ends: a number or a word at the next `,`, `}`, `]`,
/// quote, backslash or space; an object or a list after its closing bracket, even on a later line
/// (JSON written over several lines), a bracket inside one of its strings (quoted `depth` deep, as
/// the pair is) not counted. With no closing bracket (a record cut short), at the text's end:
/// `json_pairs` then reads no further, so a run of unclosed ones is read once, not once each.
fn bare_value_end(b: &[u8], v: usize, depth: usize) -> usize {
    if matches!(b.get(v), Some(b'{' | b'[')) {
        let mut level = 0usize;
        let mut i = v;
        while i < b.len() {
            match b[i] {
                b'{' | b'[' => level += 1,
                b'}' | b']' => {
                    level -= 1;
                    if level == 0 {
                        return i + 1;
                    }
                }
                b'"' if backslashes_before(b, i) == depth => match closing_quote(b, i + 1, depth) {
                    Some(c) => i = c,
                    None => return b.len(),
                },
                _ => {}
            }
            i += 1;
        }
        return b.len();
    }
    (v..b.len()).find(|&i| matches!(b[i], b',' | b'}' | b']' | b'"' | b'\\') || b[i].is_ascii_whitespace()).unwrap_or(b.len())
}

/// Where a webhook address's path starts in `word`: `/api/webhooks/`, or with an API version
/// (`/api/v10/webhooks/`, `/api/vX/webhooks/`), in any case, its slashes escaped as JSON may write
/// them (`\/api\/webhooks\/`) or not.
fn webhook_at(word: &str) -> Option<usize> {
    // The word in lower case with `\/` read as `/`, each byte's place in `word` kept.
    let b = word.as_bytes();
    let (mut lower, mut place) = (Vec::with_capacity(b.len()), Vec::with_capacity(b.len()));
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && b.get(i + 1) == Some(&b'/') {
            i += 1;
        }
        lower.push(b[i].to_ascii_lowercase());
        place.push(i);
        i += 1;
    }
    (0..lower.len()).find(|&i| {
        let Some(rest) = lower[i..].strip_prefix(b"/api/") else { return false };
        rest.starts_with(b"webhooks/") || rest.iter().position(|&c| c == b'/').is_some_and(|j| rest[0] == b'v' && rest[j + 1..].starts_with(b"webhooks/"))
    }).map(|i| place[i])
}

/// A key in `key=value` whose value is a sign-in or a session: a token, password, secret, cookie,
/// session id, nonce or JWT.
fn secret_key(k: &str) -> bool {
    let k = k.to_ascii_lowercase();
    ["token", "password", "passwd", "secret", "cookie", "session", "nonce", "jwt"].iter().any(|s| k.contains(s))
}

// ---------------------------------------------------------------- for a bug report

/// The last `lines` lines of MyOrbiter's log, oldest first, each passed through `redact` again (a
/// line written before a rule that reads one line was added is covered too). When the current file holds fewer, the
/// rest come from the end of the one before it. The page redacts them further before showing them
/// in a report (src/lib/core/redact.ts), and nothing leaves the computer unless the player sends it.
pub fn tail(lines: usize) -> Vec<String> {
    dir().map(|d| tail_in(&d, lines)).unwrap_or_default()
}

fn tail_in(dir: &Path, lines: usize) -> Vec<String> {
    let lines = lines.min(500);
    let read = |name: &str| -> Vec<String> {
        fs::read(dir.join(name)).map(|b| String::from_utf8_lossy(&b).lines().map(str::to_string).collect()).unwrap_or_default()
    };
    let mut out = read(FILE);
    if out.len() < lines {
        let mut older = read(OLD_FILE);
        let keep = older.len().saturating_sub(lines - out.len());
        older.drain(..keep);
        older.append(&mut out);
        out = older;
    }
    let skip = out.len().saturating_sub(lines);
    out.into_iter().skip(skip).map(|l| private(&l.chars().take(2000).collect::<String>())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_are_utc_dates() {
        assert_eq!(stamp(0), "[1970-01-01][00:00:00]");
        assert_eq!(stamp(1_793_654_900), "[2026-11-02][21:28:20]");
        assert_eq!(stamp(951_782_400), "[2000-02-29][00:00:00]");
    }

    #[test]
    fn sign_ins_never_reach_the_log() {
        assert_eq!(redact("Authorization: Bearer abc.def"), "Authorization: Bearer [redacted]");
        assert_eq!(redact("got eyJhbGciOi.eyJzdWIi.sig back"), "got [redacted] back");
        assert_eq!(redact("url ?token=secret&x=1 done"), "url ?token=[redacted] done");
        assert_eq!(redact("posting to https://discord.com/api/webhooks/123/abc_DEF failed"), "posting to [redacted webhook] failed");
        assert_eq!(redact("(https://discordapp.com/api/webhooks/1/x)"), "([redacted webhook]");
        assert_eq!(redact("see https://example.com/api/webhooks/1/x"), "see https://example.com/api/webhooks/1/x", "only Discord's");
        assert_eq!(redact("POST /v2/order: 429"), "POST /v2/order: 429");
        assert_eq!(redact("Cookie: JWT=abc; other"), "Cookie: [redacted] other");
        // In running text a value runs to the line's end (it may hold a space).
        assert_eq!(redact("got password=hunter2 and sessionid=xyz and nonce=12"), "got password=[redacted]");
        assert_eq!(redact("got sessionid=xyz\nnonce=12"), "got sessionid=[redacted]\nnonce=[redacted]");
        assert_eq!(redact("drop tables 3f2a (812 relics)"), "drop tables 3f2a (812 relics)");
    }

    /// docs/privacy.md: "Before a line is written, these are cut out: … the value of a `key=value`
    /// pair (…), or of a JSON pair …; and a Discord webhook address, …"
    #[test]
    fn any_webhook_address_and_a_json_password_are_cut_out() {
        // A webhook address of any API version.
        assert_eq!(redact("https://discord.com/api/v10/webhooks/1/abc"), "[redacted webhook]");
        assert_eq!(redact("posting to https://discord.com/api/v9/webhooks/123/abc_DEF failed"), "posting to [redacted webhook] failed");
        assert_eq!(redact("(https://ptb.discord.com/api/v10/webhooks/1/x)"), "([redacted webhook]");
        assert_eq!(redact("see https://example.com/api/v10/webhooks/1/x"), "see https://example.com/api/v10/webhooks/1/x", "only Discord's");
        assert_eq!(redact("https://discord.com/api/v10/users/1"), "https://discord.com/api/v10/users/1", "not a webhook");
        // A JSON pair with no space, and with one.
        let r = redact(r#"{"password":"hunter2"}"#);
        assert_ne!(r, r#"{"password":"hunter2"}"#);
        assert!(!r.contains("hunter2"), "{r}");
        assert_eq!(r, r#"{"password":"[redacted]"}"#);
        assert_eq!(redact(r#"body {"email":"a@example.invalid","password":"p\"w,d}","remember":true}"#), r#"body {"email":"a@example.invalid","password":"[redacted]","remember":true}"#);
        assert_eq!(redact(r#"{"token":12345,"x":1}"#), r#"{"token":[redacted],"x":1}"#);
        let r = redact(r#"{"password": "hunter2"}"#);
        assert!(!r.contains("hunter2"), "{r}");
        // Other pairs stay.
        assert_eq!(redact(r#"{"name":"Mesa Prime Set","platinum":120}"#), r#"{"name":"Mesa Prime Set","platinum":120}"#);
    }

    /// `redact`, checked to leave no word of `secret` in what it writes.
    fn cut_whole(input: &str, secret: &str) -> String {
        let r = redact(input);
        for part in secret.split_whitespace() {
            assert!(!r.contains(part), "{input:?} gave {r:?}");
        }
        r
    }

    #[test]
    fn a_secret_pair_with_a_space_before_its_colon_is_cut_out() {
        assert_eq!(cut_whole(r#"{"password" : "hunter2"}"#, "hunter2"), r#"{"password" : "[redacted]"}"#);
        cut_whole(r#"{"password"  :"hunter2"}"#, "hunter2");
    }

    #[test]
    fn a_secret_key_and_its_value_side_by_side_in_a_list_are_cut_out() {
        assert_eq!(cut_whole(r#"["password","hunter2"]"#, "hunter2"), r#"["password","[redacted]"]"#);
        cut_whole(r#"["user", "password", "hunter2"]"#, "hunter2");
        // A list of names alone stays.
        assert_eq!(redact(r#"["user","email","x"]"#), r#"["user","email","x"]"#);
    }

    #[test]
    fn a_secret_value_with_spaces_in_it_is_cut_out_whole() {
        assert_eq!(cut_whole(r#"{"password":"hun ter2 x"}"#, "hun ter2 x"), r#"{"password":"[redacted]"}"#);
        assert_eq!(cut_whole(r#"{"password": "hun ter2", "remember": true}"#, "hun ter2"), r#"{"password": "[redacted]", "remember": true}"#);
        // JSON escaped inside a string.
        assert_eq!(cut_whole(r#"body "{\"password\":\"hun ter2\",\"x\":1}""#, "hun ter2"), r#"body "{\"password\":\"[redacted]\",\"x\":1}""#);
        // A value the line cuts short.
        cut_whole(r#"{"password":"hun ter2"#, "hun ter2");
        // A string that only mentions one stays.
        assert_eq!(redact(r#"{"note":"no password here","x":"y"}"#), r#"{"note":"no password here","x":"y"}"#);
    }

    #[test]
    fn a_webhook_address_in_any_spelling_is_cut_out() {
        for url in ["https://discord.com/API/webhooks/1/hunter2", "https://Discord.com/Api/Webhooks/1/hunter2", "https://discord.com/api/vX/webhooks/1/hunter2", "https://discord.com/api/v/webhooks/1/hunter2", "https://DISCORDAPP.COM/api/v6/webhooks/1/hunter2"] {
            assert_eq!(cut_whole(url, "hunter2"), "[redacted webhook]");
        }
        assert_eq!(redact("https://discord.com/api/v10/users/1"), "https://discord.com/api/v10/users/1");
    }

    /// `cut_whole`, and the line passed through `redact` again (as `tail_in` does) comes out the same.
    fn cut_once(input: &str, secret: &str) -> String {
        let r = cut_whole(input, secret);
        assert_eq!(redact(&r), r, "{input:?} again");
        r
    }

    #[test]
    fn a_secret_pair_after_another_in_one_word_is_cut_out() {
        assert_eq!(cut_once("GET /v2/x?x=1&token=abc123 done", "abc123"), "GET /v2/x?x=1&token=[redacted] done");
        assert_eq!(cut_once("a=1;session=abc123 done", "abc123"), "a=1;session=[redacted] done");
        assert_eq!(cut_once("next=/x?nonce=abc123 done", "abc123"), "next=/x?nonce=[redacted] done");
        // A secret word anywhere before the word's first `=`, as in a path.
        assert_eq!(cut_once("POST /auth/token?code=abc123 done", "abc123"), "POST /auth/token?code=[redacted] done");
        assert_eq!(cut_once("GET /session/x;id=abc123 done", "abc123"), "GET /session/x;id=[redacted] done");
        // Pairs with other keys stay.
        assert_eq!(redact("GET /v2/items?x=1&y=2 done"), "GET /v2/items?x=1&y=2 done");
    }

    #[test]
    fn a_quoted_secret_value_is_cut_out_to_its_closing_quote() {
        assert_eq!(cut_once(r#"login password="hun ter2" ok"#, "hun ter2"), r#"login password="[redacted]" ok"#);
        assert_eq!(cut_once("login password='hun ter2' ok", "hun ter2"), "login password='[redacted]' ok");
        assert_eq!(cut_once(r#"login password="hun\" ter2" ok"#, "hun ter2"), r#"login password="[redacted]" ok"#);
        assert_eq!(cut_once("x ?token=\"hun ter2\" ok", "hun ter2"), "x ?token=\"[redacted]\" ok");
        // With no closing quote, to the line's end.
        assert_eq!(cut_once("login password=\"hun ter2\nnext line", "hun ter2"), "login password=\"[redacted]\nnext line");
    }

    #[test]
    fn a_secret_value_in_running_text_is_cut_out_to_the_lines_end() {
        // Nothing marks where a value with a space ends, so the rest of the line goes with it.
        assert_eq!(cut_once("login password=hun ter2 ok\nnext line", "hun ter2"), "login password=[redacted]\nnext line");
        assert_eq!(cut_once("login password= hun ter2", "hun ter2"), "login password=[redacted]");
        // An empty value at the line's end has nothing to cut.
        assert_eq!(redact("password=\nnext"), "password=\nnext");
    }

    #[test]
    fn an_object_value_with_a_bracket_inside_a_string_is_cut_out_whole() {
        assert_eq!(cut_once(r#"x {"session":{"a":"}","b":"s3cr3t"}} y"#, "s3cr3t"), r#"x {"session":[redacted]} y"#);
        assert_eq!(cut_once(r#"x {"session":["]","s3cr3t"]} y"#, "s3cr3t"), r#"x {"session":[redacted]} y"#);
        // JSON escaped inside a string.
        assert_eq!(cut_once(r#"body "{\"session\":{\"a\":\"}\",\"b\":\"s3cr3t\"},\"x\":1}""#, "s3cr3t"), r#"body "{\"session\":[redacted],\"x\":1}""#);
    }

    #[test]
    fn a_webhook_address_with_escaped_slashes_is_cut_out() {
        assert_eq!(cut_once(r#"{"url":"https:\/\/discord.com\/api\/webhooks\/123\/abc123"}"#, "abc123"), r#"{"url":"[redacted webhook]"#);
        assert_eq!(cut_once(r"https:\/\/discord.com\/api\/v10\/webhooks\/1\/abc123", "abc123"), "[redacted webhook]");
        assert_eq!(redact(r#"{"url":"https:\/\/example.com\/api\/webhooks\/1\/x"}"#), r#"{"url":"https:\/\/example.com\/api\/webhooks\/1\/x"}"#, "only Discord's");
    }

    #[test]
    fn every_pair_in_a_cookie_header_is_cut_out() {
        assert_eq!(cut_once("Cookie: a=abc123; sid=def456; c=ghi789", "abc123 def456 ghi789"), "Cookie: [redacted] [redacted] [redacted]");
        assert_eq!(cut_once("Set-Cookie: sid=abc123; Path=/; HttpOnly", "abc123"), "Set-Cookie: [redacted] [redacted] HttpOnly");
        // A word after the last pair stays.
        assert_eq!(redact("Cookie: JWT=abc; other"), "Cookie: [redacted] other");
    }

    #[test]
    fn a_secret_before_a_webhook_address_in_the_same_word_is_cut_out() {
        // The pair's own rule: in running text, to the line's end (the address goes with it).
        assert_eq!(cut_once("x token=abc123,https://discord.com/api/webhooks/1/zzz999 y", "abc123 zzz999"), "x token=[redacted]");
        assert_eq!(cut_once("x ?token=abc123&u=https://discord.com/api/webhooks/1/zzz999 y", "abc123 zzz999"), "x ?token=[redacted] y");
        assert_eq!(cut_once("eyJabc.def,https://discord.com/api/webhooks/1/zzz999 y", "eyJabc zzz999"), "[redacted] y");
        // Text with no secret before the address stays.
        assert_eq!(redact("(see https://discord.com/api/webhooks/1/zzz999)"), "(see [redacted webhook]");
        assert_eq!(redact("url=https://discord.com/api/webhooks/1/zzz999"), "url=[redacted webhook]");
    }

    #[test]
    fn a_webhook_address_in_the_word_after_a_head_goes_with_that_word() {
        // The word after "Bearer", "Authorization:" or a Cookie header is hidden whole, address and
        // all, and a Cookie header's later pairs after it.
        assert_eq!(cut_once("Bearer abc123,https://discord.com/api/webhooks/1/zzz999", "abc123 zzz999"), "Bearer [redacted]");
        assert_eq!(cut_once("Authorization: abc123,https://discord.com/api/webhooks/1/zzz999", "abc123 zzz999"), "Authorization: [redacted]");
        assert_eq!(cut_once("Authorization: Bearer abc123,https://discord.com/api/webhooks/1/zzz999 y", "abc123 zzz999"), "Authorization: Bearer [redacted] y");
        assert_eq!(cut_once("Bearer https://discord.com/api/webhooks/1/zzz999", "zzz999"), "Bearer [redacted]");
        assert_eq!(cut_once("Cookie: hook=https://discord.com/api/webhooks/1/zzz999; sid=def456", "zzz999 def456"), "Cookie: [redacted] [redacted]");
        assert_eq!(cut_once("Cookie: a=abc123,https://discord.com/api/webhooks/1/zzz999; sid=def456", "abc123 zzz999 def456"), "Cookie: [redacted] [redacted]");
        // An address in a later pair goes with its pair, as before.
        assert_eq!(cut_once("Cookie: a=1; b=https://discord.com/api/webhooks/1/zzz999; c=3", "zzz999"), "Cookie: [redacted] [redacted] [redacted]");
        // A quote mark inside the address ends the quoted value there, as before.
        assert_eq!(cut_once("x token='a,https://discord.com/api/webhooks/1/zz'z99 y", "discord"), "x token='[redacted]'z99 y");
    }

    #[test]
    fn an_object_or_list_over_several_lines_under_a_secret_key_is_cut_out_whole() {
        assert_eq!(cut_once("body {\"session\":{\n  \"id\":\"abc123\"\n}} end", "abc123"), "body {\"session\":[redacted]} end");
        assert_eq!(cut_once("{\"tokens\":[\n\"abc123\",\n\"def456\"\n]}", "abc123 def456"), "{\"tokens\":[redacted]}");
        // A bracket inside a string on a later line isn't counted.
        assert_eq!(cut_once("{\"session\":{\n\"a\":\"}\",\n\"b\":\"abc123\"\n}, \"x\":1}", "abc123"), "{\"session\":[redacted], \"x\":1}");
        // With no closing bracket anywhere (a record cut short), to the record's end.
        assert_eq!(cut_once("{\"session\":{\"id\":\"abc123\"\n\"x\":\"def456\"", "abc123 def456"), "{\"session\":[redacted]");
        // Many of them still take one pass: the first unclosed one ends the reading.
        let many = "{\"session\":{\n".repeat(20_000);
        let t0 = std::time::Instant::now();
        assert_eq!(redact(&many), "{\"session\":[redacted]");
        assert!(t0.elapsed() < std::time::Duration::from_secs(1), "{:?}", t0.elapsed());
    }

    #[test]
    fn the_windows_lines_never_pass_for_the_rust_sides_own() {
        // `from_ui("info", "market", "x")` must not log under `myorbiter::market`, where the Rust
        // side writes what it did on warframe.market.
        assert_ne!(ui_target("market"), "myorbiter::market");
        for area in ["market", "updates", "app", "tennoscope", "notify", "panic", "ee_log"] {
            assert_eq!(ui_target(area), format!("myorbiter::ui-{area}"));
        }
        assert_eq!(ui_target(""), "myorbiter::ui");
        assert_eq!(ui_target("ui"), "myorbiter::ui");
        assert_eq!(ui_target("[market][INFO]\n"), "myorbiter::ui-marketINFO");
        assert_eq!(ui_target("::"), "myorbiter::ui");
    }

    #[test]
    fn the_home_folder_is_written_as_a_tilde() {
        let home = "/home/examplehome";
        assert_eq!(tilde("found EE.log at /home/examplehome/.local/share/Steam/steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log", home), "found EE.log at ~/.local/share/Steam/steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log");
        assert_eq!(tilde("started /home/examplehome/Apps/MyOrbiter.AppImage (pid 7)", home), "started ~/Apps/MyOrbiter.AppImage (pid 7)");
        assert_eq!(tilde("folder /home/examplehome", home), "folder ~");
        assert_eq!(tilde("(/home/examplehome/x) and \"/home/examplehome/y\"", home), "(~/x) and \"~/y\"");
        assert_eq!(tilde("two: /home/examplehome/a /home/examplehome/b", home), "two: ~/a ~/b");
        // Only that folder, whole.
        assert_eq!(tilde("/home/examplehomes/a", home), "/home/examplehomes/a");
        assert_eq!(tilde("/home/examplehome.old/a", home), "/home/examplehome.old/a");
        assert_eq!(tilde("/srv/home/examplehome/a", home), "/srv/home/examplehome/a");
        // In a file address too.
        assert_eq!(tilde("opened file:///home/examplehome/x.html", home), "opened file://~/x.html");
        assert_eq!(tilde("opened FILE:///C:/Users/Example Player/x.html", r"C:\Users\Example Player"), "opened FILE:///~/x.html");
        assert_eq!(tilde("/HOME/EXAMPLEHOME/a", home), "/HOME/EXAMPLEHOME/a", "Linux paths match in their case only");
        // As Wine and Proton write the same folder, also inside JSON.
        assert_eq!(tilde(r"log at Z:\home\examplehome\Games\EE.log", home), r"log at ~\Games\EE.log");
        assert_eq!(tilde(r#"{"path":"z:\\home\\examplehome\\x"}"#, home), r#"{"path":"~\\x"}"#);
        // Windows: any case, either slash, doubled backslashes.
        let win = r"C:\Users\Example Player";
        assert_eq!(tilde(r"read C:\Users\Example Player\AppData\Local\Warframe\EE.log", win), r"read ~\AppData\Local\Warframe\EE.log");
        assert_eq!(tilde(r"read c:\users\example player\x", win), r"read ~\x");
        assert_eq!(tilde("read C:/Users/Example Player/x", win), "read ~/x");
        assert_eq!(tilde(r#"{"p":"C:\\Users\\Example Player\\x"}"#, win), r#"{"p":"~\\x"}"#);
        assert_eq!(tilde(r"C:\Users\Example Players\x", win), r"C:\Users\Example Players\x");
        // A home too short to be one replaces nothing.
        assert_eq!(tilde("/a/b", "/"), "/a/b");
        assert_eq!(tilde(r"C:\x", r"C:\"), r"C:\x");
        // Nothing else changes.
        assert_eq!(tilde("POST /v2/order: 429", home), "POST /v2/order: 429");
    }

    #[test]
    fn a_report_takes_the_last_lines_across_both_files() {
        let dir = std::env::temp_dir().join(format!("myorbiter-log-tail-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert!(tail_in(&dir, 50).is_empty(), "no log yet");
        fs::write(dir.join(OLD_FILE), "old 1\nold 2\nold 3\n").unwrap();
        fs::write(dir.join(FILE), "new 1\nnew 2 token=abc\n").unwrap();
        assert_eq!(tail_in(&dir, 3), ["old 3", "new 1", "new 2 token=[redacted]"]);
        assert_eq!(tail_in(&dir, 1), ["new 2 token=[redacted]"]);
        assert_eq!(tail_in(&dir, 50).len(), 5);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn only_you_can_read_the_log() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("myorbiter-log-mode-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        fs::write(&path, b"old\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        let _sink = open(&path, false).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600, "an existing log is made private");
        fs::remove_file(&path).unwrap();
        let _sink = open(&path, false).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600, "a new one starts private");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_file_moves_aside_at_its_limit() {
        let dir = std::env::temp_dir().join(format!("myorbiter-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut sink = open(&dir.join(FILE), false).unwrap();
        sink.size = MAX_BYTES; // as if full
        let logger = Logger { sink: Mutex::new(Some(sink)), last_ui: Mutex::new((String::new(), 0, 0)) };
        let record = log::Record::builder().target("myorbiter::test").level(log::Level::Info).args(format_args!("hello")).build();
        log::Log::log(&logger, &record);
        assert!(dir.join(OLD_FILE).is_file());
        assert!(fs::read_to_string(dir.join(FILE)).unwrap().ends_with("[test][INFO] hello\n"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_file_starts_over_when_it_cant_move_aside() {
        let dir = std::env::temp_dir().join(format!("myorbiter-log-held-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        // A folder under the old file's name: the rename fails, the way it does on Windows while
        // another program holds `myorbiter.1.log` open.
        fs::create_dir_all(dir.join(OLD_FILE).join("held")).unwrap();
        fs::write(dir.join(FILE), "an old line\n").unwrap();
        let mut sink = open(&dir.join(FILE), false).unwrap();
        sink.size = MAX_BYTES; // as if full
        let logger = Logger { sink: Mutex::new(Some(sink)), last_ui: Mutex::new((String::new(), 0, 0)) };
        let record = log::Record::builder().target("myorbiter::test").level(log::Level::Info).args(format_args!("hello")).build();
        log::Log::log(&logger, &record);
        log::Log::log(&logger, &record);
        let text = fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!text.contains("an old line"), "emptied rather than grown past the cap: {text:?}");
        assert_eq!(text.lines().count(), 2, "{text:?}");
        assert!(text.ends_with("[test][INFO] hello\n"));
        let size = logger.sink.lock().unwrap().as_ref().unwrap().size;
        assert_eq!(size, text.len() as u64, "counted from empty");
        let _ = fs::remove_dir_all(&dir);
    }
}

/// Fuzzing the log's own redaction: sign-ins planted in random text, separated by any whitespace
/// and punctuation. None may reach the log file.
#[cfg(test)]
mod fuzz {
    use super::*;

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
        fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
            xs[self.below(xs.len())]
        }
        fn word(&mut self, n: usize) -> String {
            (0..n).map(|_| b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789_-"[self.below(48)] as char).collect()
        }
    }

    #[test]
    fn planted_sign_ins_never_reach_the_log() {
        for seed in 0..3000u64 {
            let mut r = Rng(0x5EED_0000 + seed * 7919);
            let secret = format!("S3cr{}", r.word(16));
            let jwt = format!("eyJ{}.{}.{}", r.word(10), r.word(20), r.word(12));
            let half_jwt = format!("eyJ{}.{}", r.word(10), secret);
            let gap = |r: &mut Rng| r.pick(&[" ", "  ", "\t", " \t ", "\n", ": ", " : "]).to_string();
            let space = |r: &mut Rng| r.pick(&["", " ", "  ", "\t", "\n"]).to_string();
            let planted = [
                format!("Bearer{}{secret}", gap(&mut r)),
                format!("Authorization:{}Bearer{}{secret}", gap(&mut r), gap(&mut r)),
                format!("token{}{secret}", gap(&mut r)),
                format!("token={secret}"),
                format!("\"session={secret}\""),
                jwt.clone(),
                half_jwt.clone(),
                format!("https://discord.com/api/webhooks/123/{secret}"),
                format!("https://discord.com/api/v10/webhooks/123/{secret}"),
                format!("{{\"password\":\"{secret}\"}}"),
                format!("{{\"email\":\"x\",\"token\":\"{secret}\"}}"),
                format!("{{\"password\": \"{secret}\"}}"),
                format!("{{\"password\"{}:{}\"{secret}\"}}", space(&mut r), space(&mut r)),
                format!("[\"password\",{}\"{secret}\"]", space(&mut r)),
                format!("{{\"password\":\"{}{}{secret}\"}}", r.word(4), gap(&mut r)),
                format!("\"{{\\\"token\\\":\\\"{}{}{secret}\\\"}}\"", r.word(4), gap(&mut r)),
                format!("https://Discord.com/API/v{}/webhooks/123/{secret}", r.word(2)),
                format!("/v2/x?{}=1&token={secret}", r.word(3)),
                format!("{}=1;session={secret}", r.word(3)),
                format!("/auth/token?{}={secret}", r.word(3)),
                format!("token={secret},https://discord.com/api/webhooks/1/{}", r.word(6)),
                format!("{{\"session\":{{{}\"id\":\"{secret}\"{}}}}}", gap(&mut r), gap(&mut r)),
                format!("password=\"{} {secret}\"", r.word(4)),
                format!("password='{}{}{secret}'", r.word(4), space(&mut r).replace('\n', " ")),
                format!("password={} {secret}", r.word(4)),
                format!("{{\"session\":{{\"a\":\"}}]\",\"b\":\"{secret}\"}}}}"),
                format!("https:\\/\\/discord.com\\/api\\/webhooks\\/123\\/{secret}"),
                format!("Cookie:{}a={}; sid={secret}", gap(&mut r).replace('\n', " "), r.word(4)),
                format!("Bearer{}{secret},https://discord.com/api/webhooks/1/{}", gap(&mut r), r.word(6)),
                format!("Cookie:{}hook=https://discord.com/api/webhooks/1/{}; sid={secret}", gap(&mut r).replace('\n', " "), r.word(6)),
            ];
            let mut text = String::new();
            for _ in 0..r.below(4) {
                text.push_str(r.pick(&["listed Khra", "ok", "(", "):", "sold to", "x"]));
                text.push_str(&gap(&mut r));
            }
            let which = r.below(planted.len());
            text.push_str(&planted[which]);
            text.push_str(r.pick(&["", " ", ".", ")", "\n tail"]));
            let out = redact(&text);
            for must in [secret.as_str(), &jwt[..20]] {
                assert!(!out.contains(must), "seed {seed}: {must:?} survived in {out:?} (from {text:?})");
            }
            // A report passes the written line through again: it comes out the same.
            assert_eq!(redact(&out), out, "seed {seed}, from {text:?}");
        }
    }
}
