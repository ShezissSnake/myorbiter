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

fn open(path: &Path) -> Option<Sink> {
    let file = OpenOptions::new().create(true).append(true).open(path).ok()?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
    Some(Sink { path: path.to_path_buf(), file, size })
}

impl log::Log for Logger {
    /// orbiter's own lines from Info up; the libraries' (the web view, HTTP, TLS) only warnings and errors.
    fn enabled(&self, m: &log::Metadata) -> bool {
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
    let message: String = message.chars().take(2000).collect();
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
/// "eyJ"), and whatever follows "Bearer", "JWT" or "token".
pub fn redact(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut hide_next = false;
    for (i, word) in s.split(' ').enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let bare = word.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        let jwt = word.contains("eyJ") && word.matches('.').count() >= 2;
        if hide_next || jwt {
            out.push_str("[redacted]");
            hide_next = false;
            continue;
        }
        if let Some((k, v)) = word.split_once('=').filter(|(k, _)| k.to_ascii_lowercase().contains("token")) {
            out.push_str(k);
            out.push_str(if v.is_empty() { "=" } else { "=[redacted]" });
            continue;
        }
        hide_next = matches!(bare.to_ascii_lowercase().as_str(), "bearer" | "jwt" | "token" | "token:");
        out.push_str(word);
    }
    out
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
        assert_eq!(redact("POST /v2/order: 429"), "POST /v2/order: 429");
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
