//! orbiter's own log, `orbiter.log` in the app's log folder (Linux: `~/.local/share/dev.orbiter.app/logs`,
//! Windows: `%LOCALAPPDATA%\dev.orbiter.app\logs`). One line per event, in UTC, the way TennoScope
//! writes its own so the two read side by side:
//!
//! ```text
//! [2026-11-02][21:28:20][market][WARN] POST /v2/order: 429, slowing down
//! ```
//!
//! What goes in: starting up, TennoScope started, stopped or failing, every warframe.market change
//! and every request that failed (the method and path, never the sign-in), the drop tables and
//! EE.log being read, and errors from the window. Never a token: anything shaped like one is cut
//! out before it's written. At 2 MB the file moves to `orbiter.1.log` (the one before that goes), so
//! the two stay under 4 MB.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const FILE: &str = "orbiter.log";
pub const OLD_FILE: &str = "orbiter.1.log";
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

/// Where the log is, once it's open.
pub fn dir() -> Option<PathBuf> {
    DIR.get().cloned()
}

/// Opens the log in `dir` and makes it the `log` crate's logger; a panic is logged too. Without a
/// writable folder orbiter runs on, logging to the terminal only.
pub fn init(dir: &Path) {
    let opened = fs::create_dir_all(dir).ok().and_then(|_| open(&dir.join(FILE)));
    if opened.is_some() {
        let _ = DIR.set(dir.to_path_buf());
    }
    *LOGGER.sink.lock().unwrap_or_else(|e| e.into_inner()) = opened;
    if log::set_logger(&LOGGER).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!(target: "orbiter::panic", "{info}");
        previous(info);
    }));
}

/// Only you can read it (0600 on Unix, an existing file made so too): it names your trades and
/// partners.
fn open(path: &Path) -> Option<Sink> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
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
    /// orbiter's own lines from Info up; the libraries' (the web view, HTTP, TLS) only warnings and
    /// errors. The update plugin's are left out: it logs an error for every check that can't reach
    /// its manifest, and updates.rs already writes one line per check and per install.
    fn enabled(&self, m: &log::Metadata) -> bool {
        if m.target().starts_with("tauri_plugin_updater") {
            return false;
        }
        m.level() <= if m.target().starts_with("orbiter") { log::Level::Info } else { log::Level::Warn }
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let area = record.target().strip_prefix("orbiter_lib::").or_else(|| record.target().strip_prefix("orbiter::")).unwrap_or(record.target());
        let line = format!("{}[{area}][{}] {}\n", stamp(now()), record.level(), redact(&record.args().to_string()));
        if cfg!(debug_assertions) {
            eprint!("{line}");
        }
        let mut guard = self.sink.lock().unwrap_or_else(|e| e.into_inner());
        let Some(sink) = guard.as_mut() else { return };
        if sink.size + line.len() as u64 > MAX_BYTES {
            let old = sink.path.with_file_name(OLD_FILE);
            let _ = fs::rename(&sink.path, old);
            match open(&sink.path) {
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
    // let it write lines that look like orbiter's own (and those go into bug reports).
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
        log::info!(target: "orbiter::ui", "(the line before came {repeats} more time{} within a minute)", if repeats == 1 { "" } else { "s" });
    }
    let area: String = area.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(24).collect();
    log::log!(target: &format!("orbiter::{}", if area.is_empty() { "ui" } else { &area }), level, "{message}");
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

/// Cuts out anything shaped like a sign-in: a JWT (three dot-separated base64 runs starting
/// "eyJ"), whatever follows "Bearer", "JWT" or "token", and a Discord webhook address (its id and
/// token are all it takes to post as it).
pub fn redact(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut hide_next = false;
    // Words between any whitespace (a tab or a line break hides nothing), the whitespace kept.
    let mut rest = s;
    while !rest.is_empty() {
        let gap = rest.len() - rest.trim_start().len();
        out.push_str(&rest[..gap]);
        rest = &rest[gap..];
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let (word, after) = rest.split_at(end);
        rest = after;
        if word.is_empty() {
            continue;
        }
        let bare = word.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        let lower = bare.to_ascii_lowercase();
        // A JWT, whole or cut short after its second part (a line cut at its length limit).
        let jwt = word.find("eyJ").is_some_and(|i| word[i..].contains('.'));
        if let Some(at) = word.find("/api/webhooks/").filter(|_| word.contains("discord")) {
            let start = word[..at].rfind("http").unwrap_or(0);
            out.push_str(&word[..start]);
            out.push_str("[redacted webhook]");
            hide_next = false;
            continue;
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
            continue;
        }
        if let Some((k, v)) = word.split_once('=').filter(|(k, _)| secret_key(k)) {
            out.push_str(k);
            out.push_str(if v.is_empty() { "=" } else { "=[redacted]" });
            continue;
        }
        // The word before a secret: a scheme, a header naming one ("Authorization:Bearer" too).
        let last = lower.rsplit(':').next().unwrap_or("");
        hide_next = scheme || matches!(last, "bearer" | "jwt" | "token") || matches!(lower.as_str(), "cookie" | "set-cookie" | "authorization" | "proxy-authorization");
        out.push_str(word);
    }
    out
}

/// A key in `key=value` whose value is a sign-in or a session: a token, password, secret, cookie,
/// session id, nonce or JWT.
fn secret_key(k: &str) -> bool {
    let k = k.to_ascii_lowercase();
    ["token", "password", "passwd", "secret", "cookie", "session", "nonce", "jwt"].iter().any(|s| k.contains(s))
}

// ---------------------------------------------------------------- for a bug report

/// The last `lines` lines of orbiter's log, oldest first, each passed through `redact` again (a
/// line written before a rule was added is covered too). When the current file holds fewer, the
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
    out.into_iter().skip(skip).map(|l| redact(&l.chars().take(2000).collect::<String>())).collect()
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
        assert_eq!(redact("got password=hunter2 and sessionid=xyz and nonce=12"), "got password=[redacted] and sessionid=[redacted] and nonce=[redacted]");
        assert_eq!(redact("drop tables 3f2a (812 relics)"), "drop tables 3f2a (812 relics)");
    }

    #[test]
    fn a_report_takes_the_last_lines_across_both_files() {
        let dir = std::env::temp_dir().join(format!("orbiter-log-tail-{}", std::process::id()));
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
        let dir = std::env::temp_dir().join(format!("orbiter-log-mode-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        fs::write(&path, b"old\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        let _sink = open(&path).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600, "an existing log is made private");
        fs::remove_file(&path).unwrap();
        let _sink = open(&path).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600, "a new one starts private");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_file_moves_aside_at_its_limit() {
        let dir = std::env::temp_dir().join(format!("orbiter-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut sink = open(&dir.join(FILE)).unwrap();
        sink.size = MAX_BYTES; // as if full
        let logger = Logger { sink: Mutex::new(Some(sink)), last_ui: Mutex::new((String::new(), 0, 0)) };
        let record = log::Record::builder().target("orbiter::test").level(log::Level::Info).args(format_args!("hello")).build();
        log::Log::log(&logger, &record);
        assert!(dir.join(OLD_FILE).is_file());
        assert!(fs::read_to_string(dir.join(FILE)).unwrap().ends_with("[test][INFO] hello\n"));
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
            let planted = [
                format!("Bearer{}{secret}", gap(&mut r)),
                format!("Authorization:{}Bearer{}{secret}", gap(&mut r), gap(&mut r)),
                format!("token{}{secret}", gap(&mut r)),
                format!("token={secret}"),
                format!("\"session={secret}\""),
                jwt.clone(),
                half_jwt.clone(),
                format!("https://discord.com/api/webhooks/123/{secret}"),
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
        }
    }
}
