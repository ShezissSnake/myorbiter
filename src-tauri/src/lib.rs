use serde_json::Value;
use std::fs;
mod applog;
mod bridge;
mod companion;
mod desktop;
mod feed;
mod folder;
mod link;
mod presence;
mod images;
mod market;
mod fissures;
mod noxsframe;
mod recipes;
mod relicdata;
mod updates;
mod rendering;
mod datamove;

use myorbiter_data::ee_log::{find_ee_log, LogFollower, MissionState};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const WORLDSTATE: &str = "https://api.warframestat.us/pc";
/// MyOrbiter's home: named in every User-Agent, so the sites it reads know where to find out more.
pub(crate) const REPO_URL: &str = "https://github.com/ShezissSnake/myorbiter";

/// The version this build carries, set once at start from Tauri's package info. A release build
/// gets its version (0.2.<n>) through Tauri's config at build time, which `CARGO_PKG_VERSION`
/// (Cargo.toml's 0.1.0) never sees; that one is only the fallback, for tests.
static VERSION: OnceLock<String> = OnceLock::new();

pub(crate) fn set_version(version: String) {
    let _ = VERSION.set(version);
}

pub(crate) fn version() -> &'static str {
    VERSION.get().map_or(env!("CARGO_PKG_VERSION"), String::as_str)
}

/// Who's asking, and where to find out more: `MyOrbiter/<version> (+<REPO_URL>)`, on every
/// request MyOrbiter makes (warframe.market's rules ask for exactly this).
pub(crate) fn user_agent() -> String {
    user_agent_for(version())
}

fn user_agent_for(version: &str) -> String {
    format!("MyOrbiter/{version} (+{REPO_URL})")
}

/// TennoScope's data folder: the one from Settings, or where TennoScope keeps it. A folder from
/// Settings must be a full path without `..` (MyOrbiter only reads TennoScope's own files in it).
fn data_dir(dir: Option<String>) -> Result<PathBuf, String> {
    match dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => checked_path(&d),
        None => myorbiter_data::default_tennoscope_dir().ok_or_else(|| "The system doesn't say where programs keep their data (APPDATA, or HOME on Linux), so TennoScope's folder cannot be found".to_string()),
    }
}

/// A path the page sent: full, and without `..`.
fn checked_path(p: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(p.trim());
    if !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(format!("{}: give a full path", path.display()));
    }
    if !local_path(&path) {
        return Err(format!("{}: give a folder on this computer (a drive letter), not a network one", path.display()));
    }
    Ok(path)
}

/// On this computer: on Windows, a path that starts with a drive letter (`C:\…`, `\\?\C:\…`).
/// A network one (`\\host\share\…`) would have Windows connect to that host, sign-in and all,
/// just to look at it; MyOrbiter's folders, TennoScope's and the game's are all on a drive.
pub(crate) fn local_path(path: &std::path::Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        return matches!(path.components().next(), Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)));
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

/// Warframe's log from Settings: a full path to a file named EE.log (any case), which is all MyOrbiter
/// reads there (and EE.cfg beside it). None: find it in the Steam libraries.
fn ee_log_from(path: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(p) = path.filter(|p| !p.trim().is_empty()) else { return Ok(None) };
    let path = checked_path(&p)?;
    if !path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.eq_ignore_ascii_case("EE.log")) {
        return Err(format!("{}: Warframe's log is a file named EE.log", path.display()));
    }
    Ok(Some(path))
}

/// Linux's Yama setting for one program reading another's memory (`/proc/sys/kernel/yama/ptrace_scope`):
/// above 0, TennoScope can't read the game (it isn't the game's parent). None without Yama, or
/// off Linux.
#[tauri::command]
fn ptrace_scope() -> Option<u8> {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/sys/kernel/yama/ptrace_scope").ok()?.trim().parse().ok()
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Which platform's warframe.market to use (Settings → Platform).
#[tauri::command]
fn market_platform(platform: String) -> Result<(), String> {
    market::set_platform(&platform)
}

#[tauri::command]
fn default_data_dir() -> Option<String> {
    myorbiter_data::default_tennoscope_dir().map(|p| p.display().to_string())
}

/// Reads TennoScope's database (read-only) and prices, with the revision of its catalog files: the
/// part of the data that changes on every reload (about 1 MB of JSON). Off the UI thread.
#[tauri::command]
async fn load_collection(dir: Option<String>) -> Result<myorbiter_data::Collection, String> {
    let dir = data_dir(dir)?;
    tauri::async_runtime::spawn_blocking(move || myorbiter_data::load_collection(&dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// The slimmed item catalog and relic table (about 6 MB of JSON, from ~80 MB of files), which the
/// page asks for only when `load_collection`'s `catalog_rev` differs from the one it holds.
#[tauri::command]
async fn load_catalogs(dir: Option<String>) -> Result<myorbiter_data::Catalogs, String> {
    let dir = data_dir(dir)?;
    tauri::async_runtime::spawn_blocking(move || myorbiter_data::load_catalogs(&dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Last change to TennoScope's database (or its catalogs), so the window can reload when it
/// re-reads the game. Off the main thread, like every command that touches the disk.
#[tauri::command(async)]
fn data_stamp(dir: Option<String>) -> Result<u64, String> {
    let dir = data_dir(dir)?;
    let stamp = |name: &str| {
        fs::metadata(dir.join(name))
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            // Milliseconds: two writes in the same second are two changes (the page only
            // compares stamps for equality).
            .map_or(0, |d| d.as_millis() as u64)
    };
    Ok(stamp("tennoscope.sqlite3")
        .max(stamp("tennoscope.sqlite3-wal"))
        .max(stamp("collection-prices.json"))
        .max(stamp("catalog/catalog-generation.json"))
        .max(stamp("catalog/relic-generation.json")))
}

/// One HTTP client for the whole app: connections (and TLS sessions) are kept and reused, and
/// the system's certificates are loaded once instead of on every request. Honours ALL_PROXY,
/// HTTPS_PROXY and HTTP_PROXY as they were at startup (ureq doesn't read NO_PROXY); tests, which
/// only talk to this machine, use none. Only `request` uses it, so no request leaves without the
/// User-Agent.
fn http_agent() -> ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().try_proxy_from_env(!cfg!(test)).build()).clone()
}

/// Every HTTP request MyOrbiter makes starts here, already carrying `user_agent()`.
pub(crate) fn request(method: &str, url: &str) -> ureq::Request {
    http_agent().request(method, url).set("User-Agent", &user_agent())
}

/// Writes `bytes` to a temp file beside `path`, flushes it to disk and renames it into place, so
/// a crash or power cut leaves the old file or the new one, never half of one. `private`: only
/// this user can read it (the temp file is created that way, so it never is readable by others).
pub(crate) fn write_atomic(path: &Path, bytes: &[u8], private: bool) -> std::io::Result<()> {
    use std::io::Write;
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let dir = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{name}.{}.{}.tmp", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        if private {
            options.mode(0o600);
        }
    }
    #[cfg(not(unix))]
    let _ = private;
    let result = options.open(&tmp).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    let result = result.and_then(|()| rename_replacing(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// `fs::rename` over a file that may exist. On Windows a scanner or a backup tool can hold the
/// target open for a moment (access denied, or a sharing violation): tried again a few times over
/// about a second before giving up, rather than losing the save.
pub(crate) fn rename_replacing(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let mut wait = Duration::from_millis(50);
        for _ in 0..5 {
            match fs::rename(from, to) {
                Ok(()) => return Ok(()),
                // 5: access denied; 32: in use by another process; 33: part of it locked.
                Err(e) if matches!(e.raw_os_error(), Some(5 | 32 | 33)) => {
                    std::thread::sleep(wait);
                    wait *= 2;
                }
                Err(e) => return Err(e),
            }
        }
    }
    fs::rename(from, to)
}

enum Unavailable {
    /// The API answered, just not with this part.
    Refused,
    /// No answer at all (offline, DNS, timeout).
    Unreachable,
}

/// One part of the worldstate ("fissures"), or all of it (an empty path).
fn get_json(path: &str) -> Result<Value, Unavailable> {
    let url = if path.is_empty() { WORLDSTATE.to_string() } else { format!("{WORLDSTATE}/{path}") };
    match request("GET", &url)
        .query("language", "en")
        .timeout(Duration::from_secs(10))
        .call()
    {
        Ok(resp) => resp.into_json::<Value>().map_err(|_| Unavailable::Refused),
        Err(ureq::Error::Status(..)) => Err(Unavailable::Refused),
        Err(ureq::Error::Transport(_)) => Err(Unavailable::Unreachable),
    }
}

const WORLDSTATE_PARTS: &[&str] = &[
    "fissures", "vaultTrader", "voidTrader", "invasions", "nightwave", "sortie", "archonHunt",
    "steelPath", "duviriCycle", "earthCycle", "cetusCycle", "vallisCycle", "cambionCycle",
    "zarimanCycle", "alerts", "dailyDeals", "syndicateMissions", "events", "archimedeas",
    "calendar", "descendia",
];

/// Each worldstate part asked for on its own, `null` where it isn't given. Once the API can't be
/// reached at all (or `reachable` is false: the whole worldstate couldn't be), the other parts
/// won't fare better: they aren't asked, rather than waiting out a timeout for each of them.
fn each_part(mut get: impl FnMut(&str) -> Result<Value, Unavailable>, mut reachable: bool) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    for part in WORLDSTATE_PARTS {
        let value = if reachable {
            match get(part) {
                Ok(v) => Some(v),
                Err(Unavailable::Refused) => None,
                Err(Unavailable::Unreachable) => {
                    reachable = false;
                    None
                }
            }
        } else {
            None
        };
        out.insert((*part).to_string(), value.unwrap_or(Value::Null));
    }
    out
}

/// Active void fissures and Varzia's Prime Resurgence stock. Failures come back as `null` per
/// field so the rest of the app keeps working offline.
#[tauri::command]
async fn worldstate(app: tauri::AppHandle) -> Value {
    let dir = app.path().app_config_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = serde_json::Map::new();
        // The whole worldstate in one request (the same parts as asking for each); one at a time
        // only if that's refused.
        let whole = get_json("");
        if let Ok(Value::Object(all)) = &whole {
            for part in WORLDSTATE_PARTS {
                out.insert((*part).to_string(), all.get(*part).cloned().unwrap_or(Value::Null));
            }
        }
        if out.is_empty() {
            out = each_part(get_json, !matches!(whole, Err(Unavailable::Unreachable)));
        }
        // api.warframestat.us down or behind the game: what it couldn't give, from the game's own file.
        const FROM_GAME: [&str; 10] = ["fissures", "voidTrader", "vaultTrader", "earthCycle", "cetusCycle", "vallisCycle", "cambionCycle", "sortie", "archonHunt", "syndicateMissions"];
        let missing = |out: &serde_json::Map<String, Value>, k: &str| match out.get(k) {
            None | Some(Value::Null) => true,
            Some(Value::Array(a)) => a.is_empty(),
            _ => false,
        };
        if FROM_GAME.iter().any(|k| missing(&out, k)) {
            let no_fissures = missing(&out, "fissures");
            if let Some(game) = dir.as_deref().and_then(|d| fissures::from_game(d).ok()) {
                for k in FROM_GAME {
                    if missing(&out, k) {
                        if let Some(v) = game.get(k) {
                            out.insert(k.into(), v.clone());
                        }
                    }
                }
                // Said on Home only when the API gave no fissures at all, not for one part it refused.
                out.insert("fromGame".into(), Value::Bool(no_fissures));
            }
        }
        Value::Object(out)
    })
    .await
    .unwrap_or(Value::Null)
}

/// The relic data from the official drop tables (see relicdata.rs): cached for half a day, or
/// checked now with `force`.
#[tauri::command]
async fn relic_data(app: tauri::AppHandle, force: Option<bool>) -> Result<Value, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let data = relicdata::relic_data(&dir, force.unwrap_or(false)).map_err(|e| {
            log::warn!(target: "myorbiter::relics", "drop tables couldn't be read: {e}");
            e
        })?;
        // TennoScope's reward reader goes by these too (see bridge.rs, RELICS_FILE).
        if let Some(rt) = bridge::runtime_dir() {
            match bridge::write_relics_in(&rt, &data) {
                Ok(()) => log::info!(target: "myorbiter::relics", "drop tables {} ({} relics) written for TennoScope", data["hash"].as_str().unwrap_or("?"), data["relics"].as_array().map_or(0, Vec::len)),
                Err(e) => log::warn!(target: "myorbiter::relics", "writing the drop tables for TennoScope failed: {e}"),
            }
        }
        Ok(data)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Saves an export (CSV) in your Downloads folder as `myorbiter-<what>-<date>.csv`, never over an
/// existing file. Returns where it went. Off the main thread, as file writes here all are: the
/// window's event loop runs there, and a slow disk would hold up its painting.
#[tauri::command(async)]
fn export_file(app: tauri::AppHandle, what: String, text: String, day: Option<String>) -> Result<String, String> {
    if what.is_empty() || !what.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') {
        return Err("bad export name".into());
    }
    let dir = app.path().download_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
    // The page's own date (local time, so a file saved after midnight isn't named for yesterday);
    // today in UTC if it sent none or something that isn't a date.
    let day = day.filter(|d| is_day(d)).unwrap_or_else(chrono_day);
    if text.len() > MAX_EXPORT_BYTES {
        return Err("that export is too large".into());
    }
    // Always a new file: `create_new` never writes through a link already lying there under the
    // name, or over a file, and a name taken means the next number.
    for n in 1..1000 {
        let path = if n == 1 { dir.join(format!("myorbiter-{what}-{day}.csv")) } else { dir.join(format!("myorbiter-{what}-{day}-{n}.csv")) };
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(f) => {
                write_whole(&path, f, text.as_bytes()).map_err(|e| e.to_string())?;
                return Ok(path.display().to_string());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("too many exports of that name today".into())
}

/// Writes all of `bytes` to `out`, the file just made at `path`, or removes the file: a disk that
/// fills up partway leaves no half a CSV behind.
fn write_whole(path: &Path, mut out: impl std::io::Write, bytes: &[u8]) -> std::io::Result<()> {
    let result = out.write_all(bytes).and_then(|()| out.flush());
    // Closed before it's removed (Windows deletes an open file only once it's closed).
    drop(out);
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

/// The largest CSV export: a year of sales or trades is well under a megabyte.
const MAX_EXPORT_BYTES: usize = 16 << 20;

/// "2026-11-02": four digits, two, two.
fn is_day(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

/// Today's date (UTC) as YYYY-MM-DD, without a date library.
fn chrono_day() -> String {
    civil_day(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400) as i64)
}

/// Days since 1970-01-01 as YYYY-MM-DD (Howard Hinnant's civil-from-days).
fn civil_day(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// A Discord webhook address, nothing else (the page checks too): MyOrbiter posts only to these.
fn discord_webhook(url: &str) -> bool {
    let rest = ["https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/", "https://ptb.discord.com/api/webhooks/", "https://canary.discord.com/api/webhooks/"]
        .iter()
        .find_map(|p| url.strip_prefix(p));
    let Some((id, token)) = rest.and_then(|r| r.split_once('/')) else { return false };
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) && !token.is_empty() && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Posts a notification to your Discord webhook (Settings → notifications), for when you're away.
/// Only to the address confirmed outside the page (`discord_confirm`): the page names the address
/// it posts to, so a page gone wrong could otherwise send anything anywhere on Discord. Never asks
/// itself: a notification may go out while the player is away, and nothing should wait on a
/// dialog then.
#[tauri::command]
async fn discord_post(app: tauri::AppHandle, url: String, content: String) -> Result<(), String> {
    if !discord_webhook(&url) {
        return Err("not a Discord webhook address".into());
    }
    if discord_kept(&app)?.1.as_deref() != Some(url.as_str()) {
        return Err("not sent: that Discord address isn't confirmed (Notifications, Choose, Discord)".into());
    }
    // Notifications come a few at a time: more than this in a minute isn't MyOrbiter's own use, and
    // a page gone wrong mustn't post the log or chats out by the hundred.
    {
        let mut sent = DISCORD_SENT.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        sent.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
        if sent.len() >= DISCORD_PER_MINUTE {
            return Err("too many Discord posts this minute".into());
        }
        sent.push(now);
    }
    let content: String = content.chars().take(1900).collect();
    tauri::async_runtime::spawn_blocking(move || {
        request("POST", &url)
            .timeout(Duration::from_secs(10))
            .send_json(serde_json::json!({ "username": "MyOrbiter", "content": content, "allowed_mentions": { "parse": [] } }))
            .map(|_| ())
            // Never the error's own text: it carries the webhook address, token and all.
            .map_err(|e| match e {
                ureq::Error::Status(code, _) => format!("Discord answered {code}"),
                ureq::Error::Transport(_) => "couldn't reach Discord".to_string(),
            })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Discord posts in the last minute, and the most there may be (see discord_post).
static DISCORD_SENT: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
const DISCORD_PER_MINUTE: usize = 20;

/// Whether the player said no to a new address since MyOrbiter started: then no new address is
/// asked about again until a restart, so a page gone wrong can't wear the player down with one
/// confirmation after another.
static DISCORD_DECLINED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// One confirmation at a time.
static DISCORD_ASKING: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());

#[derive(Debug, PartialEq)]
enum DiscordAddress {
    /// The one confirmed before.
    Kept,
    /// New, but the player turned one down since MyOrbiter started: not asked.
    Declined,
    /// New: ask.
    Ask,
}

fn discord_address(kept: Option<&str>, declined_one: bool, url: &str) -> DiscordAddress {
    if kept == Some(url) {
        DiscordAddress::Kept
    } else if declined_one {
        DiscordAddress::Declined
    } else {
        DiscordAddress::Ask
    }
}

/// The confirmed Discord address's file in the config folder (written by `write_atomic`).
pub(crate) const DISCORD_FILE: &str = "discord-webhook";

/// The address confirmed before, from MyOrbiter's config folder (`discord-webhook`).
fn discord_kept(app: &tauri::AppHandle) -> Result<(PathBuf, Option<String>), String> {
    let file = app.path().app_config_dir().map_err(|e| e.to_string())?.join(DISCORD_FILE);
    let kept = fs::read_to_string(&file).ok().map(|k| k.trim().to_owned());
    Ok((file, kept))
}

/// Notifications → Choose → Discord: whether `url` is the address the player confirmed, asking
/// when it's new. The page calls this while the player is there: when an address is pasted, and
/// once as MyOrbiter starts for one saved before (`discord_post` never asks). A new address is
/// confirmed in a native dialog over MyOrbiter's window (not in the page), which names the webhook
/// (never its token); a yes keeps it in MyOrbiter's config folder (`discord-webhook`), which the
/// page can't write, in place of the one before. While a dialog is open, another new address is
/// refused rather than queued.
#[tauri::command]
async fn discord_confirm(app: tauri::AppHandle, url: String) -> Result<bool, String> {
    if !discord_webhook(&url) {
        return Err("not a Discord webhook address".into());
    }
    if discord_kept(&app)?.1.as_deref() == Some(url.as_str()) {
        return Ok(true);
    }
    let Ok(_one) = DISCORD_ASKING.try_lock() else { return Ok(false) };
    let url = url.as_str();
    let app = &app;
    // Read again under the lock: a dialog may have confirmed this address since the first read.
    let (file, kept) = discord_kept(app)?;
    match discord_address(kept.as_deref(), DISCORD_DECLINED.load(Ordering::SeqCst), url) {
        DiscordAddress::Kept => return Ok(true),
        DiscordAddress::Declined => return Err("MyOrbiter asks about one new Discord address at a time and stops after a no: restart MyOrbiter to be asked again".into()),
        DiscordAddress::Ask => {}
    }
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let id = url.trim_end_matches('/').rsplit('/').nth(1).unwrap_or("").to_owned();
    let host = url.split('/').nth(2).unwrap_or("discord.com").to_owned();
    let text = format!(
        "Send MyOrbiter's notifications to Discord webhook {id} on {host}?\n\nMyOrbiter posts the kinds of notification you picked there.{} Say yes only if you pasted this address yourself.",
        if kept.as_deref().is_some_and(|k| !k.is_empty()) { " It replaces the webhook MyOrbiter posted to before." } else { "" }
    );
    let ask = app.clone();
    let yes = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = ask.dialog().message(text).title("A new Discord webhook").kind(MessageDialogKind::Info).buttons(MessageDialogButtons::OkCancelCustom("Send to this webhook".into(), "Don't send".into()));
        if let Some(window) = ask.get_webview_window("main") {
            dialog = dialog.parent(&window);
        }
        dialog.blocking_show()
    })
    .await
    // A dialog that couldn't be shown isn't a no: asked again next time.
    .map_err(|e| format!("couldn't ask about the Discord address: {e}"))?;
    if yes {
        write_atomic(&file, url.as_bytes(), true).map_err(|e| format!("couldn't keep the Discord address: {e}"))?;
        log::info!(target: "myorbiter::notify", "Discord webhook {id} confirmed");
    } else {
        DISCORD_DECLINED.store(true, Ordering::SeqCst);
        log::info!(target: "myorbiter::notify", "Discord webhook {id} turned down; no other new one is asked about until MyOrbiter restarts");
    }
    Ok(yes)
}

/// Every Foundry recipe, parts' own blueprints included (see recipes.rs): cached for a week.
#[tauri::command]
async fn recipe_data(app: tauri::AppHandle) -> Result<Value, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || recipes::recipe_data(&dir))
        .await
        .map_err(|e| e.to_string())?
}

/// Where `find_ee_log` last found the log, and when: it reads Steam's library list and checks
/// every library, which needn't happen on every 2-second poll.
static FOUND_LOG: Mutex<Option<(PathBuf, Instant)>> = Mutex::new(None);
const FIND_AGAIN: Duration = Duration::from_secs(60);

fn ee_log_path() -> Option<PathBuf> {
    let mut found = FOUND_LOG.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((path, at)) = found.as_ref() {
        if at.elapsed() < FIND_AGAIN && path.is_file() {
            return Some(path.clone());
        }
    }
    let path = find_ee_log();
    let before = found.as_ref().map(|(p, _)| p.clone());
    // Said once when MyOrbiter starts looking, then whenever it changes.
    static SAID: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if path != before || !SAID.swap(true, std::sync::atomic::Ordering::Relaxed) {
        match &path {
            Some(p) => log::info!(target: "myorbiter::ee_log", "found at {}", p.display()),
            None => log::warn!(target: "myorbiter::ee_log", "not found in any Steam library (set its path in Settings)"),
        }
    }
    *found = path.clone().map(|p| (p, Instant::now()));
    path
}

/// Warframe's display mode from its EE.cfg, beside the log ("MODE_BORDERLESS", "MODE_FULLSCREEN",
/// "MODE_WINDOWED"). On Windows an overlay can't draw over exclusive fullscreen, so MyOrbiter says so.
#[tauri::command(async)]
fn warframe_window_mode(path: Option<String>) -> Option<String> {
    let log = ee_log_from(path).ok()?.or_else(ee_log_path)?;
    let text = fs::read_to_string(log.parent()?.join("EE.cfg")).ok()?;
    window_mode(&text)
}

fn window_mode(cfg: &str) -> Option<String> {
    cfg.lines()
        .find_map(|l| l.trim().strip_prefix("Graphics.WindowMode="))
        .map(|v| v.trim().to_string())
        .filter(|v| v.starts_with("MODE_") && v.len() < 40 && v.bytes().all(|b| b.is_ascii_uppercase() || b == b'_'))
}

/// What Warframe's EE.log says about the current fissure: the squad's relics, the reward screen.
/// `None` when the log can't be found (game never run under this Steam, or a custom path is wrong).
#[tauri::command]
async fn mission_state(app: tauri::AppHandle, path: Option<String>) -> Result<Option<MissionState>, String> {
    // The first read of a long session's log can be large; keep it off the async workers.
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = ee_log_from(path)?.or_else(ee_log_path) else { return Ok(None) };
        let follower = app.state::<Mutex<LogFollower>>();
        // A panic mid-read leaves the follower at a line boundary at worst; keep going.
        let mut follower = follower.lock().unwrap_or_else(|e| e.into_inner());
        match follower.poll(&path) {
            Ok(state) => Ok(Some(state.clone())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("{}: {e}", path.display())),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Every relic reward screen TennoScope has read, from its own log files (the current one and
/// the ones it rotated out), oldest first: the history behind Stats' relic runs.
#[tauri::command]
async fn reward_screens(dir: Option<String>) -> Result<Vec<myorbiter_data::reward_log::LoggedScreen>, String> {
    let dir = data_dir(dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        myorbiter_data::reward_log::read_reward_logs(&myorbiter_data::reward_log::reward_log_dirs(&dir))
    })
    .await
    .map_err(|e| e.to_string())
}

/// The last time TennoScope's log says it failed to start, and why: MyOrbiter says so when the
/// TennoScope it starts keeps stopping.
#[tauri::command]
async fn tennoscope_failure(dir: Option<String>) -> Result<Option<myorbiter_data::reward_log::StartFailure>, String> {
    let dir = data_dir(dir)?;
    tauri::async_runtime::spawn_blocking(move || myorbiter_data::reward_log::last_start_failure(&myorbiter_data::reward_log::reward_log_dirs(&dir)))
        .await
        .map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ warframe.market

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, market::MarketError> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct MarketAccount {
    linked: bool,
    backing: &'static str,
    profile: Option<market::Profile>,
    error: Option<String>,
}

/// The keyring is asked over D-Bus (and may wait for you to unlock it), so all of this runs on a
/// blocking thread.
#[tauri::command]
async fn market_account(app: tauri::AppHandle) -> Result<MarketAccount, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = app.state::<market::Client>();
        if !client.linked() {
            return MarketAccount { linked: false, backing: client.store.backing(), profile: None, error: None };
        }
        let me = client.me().map_err(|e| e.to_string());
        let backing = client.store.backing();
        match me {
            Ok(p) => MarketAccount { linked: true, backing, profile: Some(p), error: None },
            Err(e) => MarketAccount { linked: true, backing, profile: None, error: Some(e) },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_sign_in(app: tauri::AppHandle, email: String, password: String) -> Result<market::Profile, String> {
    blocking(move || app.state::<market::Client>().sign_in(&email, &password)).await
}

#[tauri::command]
async fn market_use_token(app: tauri::AppHandle, token: String) -> Result<market::Profile, String> {
    blocking(move || app.state::<market::Client>().use_token(&token)).await
}

#[tauri::command]
async fn market_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    // Signed out: the status connection signed in with that account goes too.
    app.state::<presence::Presence>().close();
    // Clearing the keyring entry waits on D-Bus.
    tauri::async_runtime::spawn_blocking(move || app.state::<market::Client>().sign_out())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_items(app: tauri::AppHandle) -> Result<Value, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    blocking(move || market::items(&cache)).await
}

/// An item's top builds on Nox's Frame (noxsframe.rs): read when its builds are opened, kept a week.
#[tauri::command]
async fn nox_item_builds(app: tauri::AppHandle, item: String, refresh: Option<bool>) -> Result<Value, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || noxsframe::item_builds(&cache, &item, refresh == Some(true))).await.map_err(|e| e.to_string())?
}

/// One Nox's Frame build, read when it's opened and kept a week. `cachedOnly`: null when not kept.
#[tauri::command]
async fn nox_build(app: tauri::AppHandle, path: String, refresh: Option<bool>, cached_only: Option<bool>) -> Result<Value, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || noxsframe::build(&cache, &path, refresh == Some(true), cached_only == Some(true))).await.map_err(|e| e.to_string())?
}

/// A pasted Nox's Frame build code, unpacked (no network).
#[tauri::command]
fn nox_decode_code(code: String) -> Result<Value, String> {
    if code.len() > 64 * 1024 {
        return Err("that's too long for a build code".into());
    }
    noxsframe::decode_code(&code)
}

#[tauri::command]
async fn market_riven_meta(app: tauri::AppHandle) -> Result<Value, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    blocking(move || market::riven_meta(&cache)).await
}

/// What MyOrbiter last read from the network and keeps for its next start, so pages show it at once
/// and update as new reads come in. Each is one JSON file in the cache folder; what's in it, and
/// when it stops counting, is the page's business (see src/lib/saved.ts).
const SAVED: [&str; 3] = ["riven-prices", "worldstate", "riven-trades"];

fn saved_path(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    if !SAVED.contains(&name) {
        return Err(format!("nothing is saved as {name}"));
    }
    Ok(app.path().app_cache_dir().map_err(|e| e.to_string())?.join(format!("{name}.json")))
}

/// What was saved as `name`; null when there's nothing (yet), or it can't be read.
#[tauri::command(async)]
fn saved_read(app: tauri::AppHandle, name: String) -> Value {
    saved_path(&app, &name)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null)
}

#[tauri::command(async)]
fn saved_write(app: tauri::AppHandle, name: String, value: Value) -> Result<(), String> {
    let path = saved_path(&app, &name)?;
    let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    write_atomic(&path, &bytes, false).map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_riven_auctions(app: tauri::AppHandle, weapon: String, positive: Vec<String>, negative: Option<String>) -> Result<Value, String> {
    blocking(move || app.state::<market::Client>().riven_auctions(&weapon, &positive, negative.as_deref())).await
}

#[tauri::command]
async fn market_my_orders(app: tauri::AppHandle) -> Result<Vec<market::Order>, String> {
    blocking(move || app.state::<market::Client>().my_orders()).await
}

#[tauri::command]
async fn market_order_book(app: tauri::AppHandle, slug: String) -> Result<Vec<market::BookOrder>, String> {
    blocking(move || app.state::<market::Client>().order_book(&slug)).await
}

/// warframe.market's live feed of new orders (cheap-buy alerts): on or off, and how it's doing.
#[tauri::command]
fn market_feed(app: tauri::AppHandle, on: bool) -> feed::FeedState {
    let f = app.state::<feed::Feed>();
    f.set(app.clone(), on);
    f.state()
}

/// How the live feed is doing. Async, on a blocking thread: the page asks every 30 s, and a
/// synchronous command runs on the main thread, where a wait for the feed's lock would hold up
/// the window.
#[tauri::command]
async fn market_feed_state(app: tauri::AppHandle) -> Result<feed::FeedState, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<feed::Feed>().state()).await.map_err(|e| e.to_string())
}

/// A player's closed orders on warframe.market (yours, for importing sales).
#[tauri::command]
async fn market_closed_orders(app: tauri::AppHandle, name: String) -> Result<Vec<market::ClosedOrder>, String> {
    blocking(move || app.state::<market::Client>().closed_orders(&name)).await
}

/// Your riven auctions on warframe.market.
#[tauri::command]
async fn market_my_auctions(app: tauri::AppHandle) -> Result<Value, String> {
    blocking(move || app.state::<market::Client>().my_auctions()).await
}

/// Puts a riven up for auction.
#[tauri::command]
async fn market_create_auction(app: tauri::AppHandle, auction: Value) -> Result<Value, String> {
    blocking(move || app.state::<market::Client>().create_auction(&auction)).await
}

/// Changes an auction's prices or note.
#[tauri::command]
async fn market_update_auction(app: tauri::AppHandle, id: String, change: Value) -> Result<Value, String> {
    blocking(move || app.state::<market::Client>().update_auction(&id, &change)).await
}

/// Takes an auction down.
#[tauri::command]
async fn market_close_auction(app: tauri::AppHandle, id: String) -> Result<(), String> {
    blocking(move || app.state::<market::Client>().close_auction(&id)).await
}

/// An item's daily closed trades on warframe.market, last 90 days.
#[tauri::command]
async fn market_item_history(app: tauri::AppHandle, slug: String) -> Result<Vec<market::PricePoint>, String> {
    blocking(move || app.state::<market::Client>().item_history(&slug)).await
}

/// Your chats on warframe.market's messenger.
#[tauri::command]
async fn market_chats(app: tauri::AppHandle) -> Result<Vec<market::ChatSummary>, String> {
    blocking(move || app.state::<market::Client>().chats()).await
}

/// A trade partner's warframe.market profile (None: no account under that name).
#[tauri::command]
async fn market_user(app: tauri::AppHandle, name: String) -> Result<Option<market::MarketUser>, String> {
    blocking(move || app.state::<market::Client>().user(&name)).await
}

/// The review you've left a player on warframe.market: 1 for +rep, -1 for a report, None for none.
#[tauri::command]
async fn market_my_review(app: tauri::AppHandle, name: String) -> Result<Option<i64>, String> {
    blocking(move || app.state::<market::Client>().my_review_of(&name)).await
}

/// +rep for a trade partner: a positive review with your message, from your account.
#[tauri::command]
async fn market_give_rep(app: tauri::AppHandle, name: String, text: String) -> Result<(), String> {
    blocking(move || app.state::<market::Client>().give_rep(&name, &text)).await
}

#[tauri::command]
async fn market_create(app: tauri::AppHandle, order: market::NewOrder) -> Result<market::Order, String> {
    blocking(move || app.state::<market::Client>().create(&order)).await
}

#[tauri::command]
async fn market_update(app: tauri::AppHandle, id: String, change: market::OrderChange) -> Result<(), String> {
    blocking(move || app.state::<market::Client>().update(&id, &change)).await
}

#[tauri::command]
async fn market_close(app: tauri::AppHandle, id: String, quantity: u32) -> Result<(), String> {
    blocking(move || app.state::<market::Client>().close(&id, quantity)).await
}

#[tauri::command]
async fn market_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    blocking(move || app.state::<market::Client>().delete(&id)).await
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// The settings as saved, and the page token the page sends back with each save (see `SaveGate`).
#[derive(serde::Serialize)]
struct LoadedSettings {
    settings: Value,
    page: u64,
}

/// One token per process: the window's page calls this once as it starts (`loadSettings` in
/// backend.ts, from App.svelte), and each call makes saves with an older token fail. A second
/// caller would stop the first page saving; tests/settingsToken.test.ts fails if one appears.
#[tauri::command(async)]
fn load_settings(app: tauri::AppHandle) -> Result<LoadedSettings, String> {
    let path = settings_path(&app)?;
    // Read under the save lock: a save from the page before is either on disk by now or dropped.
    let mut gate = SETTINGS_GATE.lock().unwrap_or_else(|e| e.into_inner());
    let page = gate.page_loaded();
    let settings = read_settings(&path)?;
    Ok(LoadedSettings { settings, page })
}

fn read_settings(path: &Path) -> Result<Value, String> {
    // No file yet: a first run. Any other failure (a file held by an antivirus or a backup, no
    // permission) is an error, so the page doesn't start from defaults and save them over it.
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(e) => return Err(format!("couldn't read {}: {e}", path.display())),
    };
    Ok(match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            // Keep a damaged file (floors, tiers...) instead of letting the defaults overwrite it.
            // If it can't be moved aside (held by an antivirus or a backup), say so: starting from
            // the defaults would save them over the only copy.
            let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let aside = path.with_extension(format!("json.broken-{stamp}"));
            rename_replacing(path, &aside).map_err(|e| format!("{} is damaged and couldn't be moved aside: {e}", path.display()))?;
            Value::Null
        }
    })
}

#[tauri::command(async)]
fn tennoscope_status(companion: tauri::State<'_, companion::Companion>) -> companion::Status {
    companion.status()
}

/// Settings → TennoScope → Program → Choose: the program MyOrbiter starts as TennoScope, picked in
/// a native file dialog opened here. The page can't name a program: it can only open the dialog,
/// or have MyOrbiter find TennoScope again (`tennoscope_forget_program`). Only an existing file
/// named like TennoScope is kept (`companion::check_custom`), in MyOrbiter's config folder. None:
/// the dialog was closed without a choice.
#[tauri::command]
async fn tennoscope_choose_program(app: tauri::AppHandle) -> Result<Option<companion::Status>, String> {
    use tauri_plugin_dialog::DialogExt;
    // One dialog at a time, however often the page asks.
    static OPEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if OPEN.swap(true, Ordering::SeqCst) {
        return Ok(None);
    }
    struct Shut;
    impl Drop for Shut {
        fn drop(&mut self) {
            OPEN.store(false, Ordering::SeqCst);
        }
    }
    let _shut = Shut;
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            let mut dialog = app.dialog().file().set_title("The TennoScope program MyOrbiter starts");
            if let Some(window) = app.get_webview_window("main") {
                dialog = dialog.set_parent(&window);
            }
            #[cfg(windows)]
            let dialog = dialog.add_filter("TennoScope", &["exe"]);
            // Blocks this thread, not the main one, until the dialog closes.
            dialog.blocking_pick_file()
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let companion = app.state::<companion::Companion>();
    companion.set_custom(Some(&path.display().to_string()))?;
    Ok(Some(companion.status()))
}

/// Settings → TennoScope → Program → Find it: MyOrbiter finds TennoScope again (the copy inside
/// MyOrbiter, then an installed one), forgetting the program chosen in the dialog.
#[tauri::command(async)]
fn tennoscope_forget_program(companion: tauri::State<'_, companion::Companion>) -> Result<companion::Status, String> {
    companion.set_custom(None)?;
    Ok(companion.status())
}

/// Starts TennoScope in the background, unless one is running already.
#[tauri::command(async)]
fn tennoscope_start(companion: tauri::State<'_, companion::Companion>) -> Result<companion::Status, String> {
    companion.start()
}

/// Passes a request (sync, screen-capture permission) to the running TennoScope.
#[tauri::command(async)]
fn tennoscope_ask(companion: tauri::State<'_, companion::Companion>, ask: String) -> Result<(), String> {
    companion.ask(&ask)
}

/// Whether the TennoScope MyOrbiter starts draws its overlay on a solid background (Windows: a
/// transparent one can come out invisible with some drivers). From its next start.
#[tauri::command]
fn tennoscope_opaque_overlay(on: bool) {
    companion::set_opaque_overlay(on);
}

/// Brings up TennoScope's own window.
#[tauri::command(async)]
fn tennoscope_show(companion: tauri::State<'_, companion::Companion>) -> Result<(), String> {
    companion.show()
}

/// Your warframe.market status as MyOrbiter holds it. Async, on a blocking thread, as
/// `market_feed_state`: the page asks every 3 s.
#[tauri::command]
async fn presence_state(app: tauri::AppHandle) -> Result<presence::State, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<presence::Presence>().state()).await.map_err(|e| e.to_string())
}

/// Hold a status (online, ingame, invisible), or "offline" to close the connection. The token
/// may have to come from the keyring, so this runs on a blocking thread.
#[tauri::command]
async fn presence_set(app: tauri::AppHandle, status: String) -> Result<presence::State, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let held = app.state::<presence::Presence>();
        match presence::Status::parse(&status) {
            Some(s) => {
                // Read again on every reconnect: warframe.market renews the token as it's used.
                let handle = app.clone();
                held.set(s, move || handle.state::<market::Client>().token())?
            }
            None if status == "offline" => held.close(),
            None => return Err(format!("Unknown status {status}")),
        }
        Ok(held.state())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A desktop notification (the page only sends one while MyOrbiter's window isn't focused). `id`:
/// its entry in the page's history, so a click on it opens what it's about. `actions`: buttons of
/// its own, as [action, label] (a sale's "Give +rep"), told to the page as `notice-action`.
#[tauri::command]
fn notify(app: tauri::AppHandle, summary: String, body: String, id: Option<String>, actions: Option<Vec<(String, String)>>) {
    desktop::notify(app, summary, body, id, actions.unwrap_or_default());
}

/// Ctrl+Q, and the window's X once the page has saved: quit, stopping the TennoScope MyOrbiter
/// started (see `RunEvent::Exit` in `run`).
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    log::info!(target: "myorbiter::app", "quitting");
    app.exit(0);
}

/// A line for MyOrbiter's log from the window: its errors, and what it tells you (see applog.rs).
/// Off the main thread: it writes to the file (and may move it aside).
#[tauri::command(async)]
fn log_line(level: String, area: String, message: String) {
    applog::from_ui(&level, &area, &message);
}

/// Where the logs are: MyOrbiter's, and TennoScope's (the first of its log folders that exists).
#[derive(serde::Serialize)]
struct LogFolders {
    myorbiter: Option<String>,
    tennoscope: Option<String>,
}

#[tauri::command(async)]
fn log_folders(dir: Option<String>) -> LogFolders {
    let tennoscope = data_dir(dir).ok().and_then(|d| tennoscope_log_dir(&d));
    LogFolders { myorbiter: applog::dir().map(|p| p.display().to_string()), tennoscope: tennoscope.map(|p| p.display().to_string()) }
}

/// The first of TennoScope's log folders under its data folder `data` that exists.
fn tennoscope_log_dir(data: &Path) -> Option<PathBuf> {
    myorbiter_data::reward_log::reward_log_dirs(data).into_iter().find(|p| p.is_dir())
}

/// A log folder the page may ask to open: these two names and nothing else. Anything else the page
/// sends (a path among them) fails as the command's arguments are read, before anything runs.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum LogFolder {
    Myorbiter,
    Tennoscope,
}

/// Opens a log folder in the file manager (`folder::open`). The page names which one; where it is
/// is decided here alone: MyOrbiter's log folder, or TennoScope's under the data folder the saved
/// settings name (`saved_data_dir`). It waits for the opener's answer, so on a blocking thread,
/// not one of the async runtime's few.
#[tauri::command]
async fn open_log_folder(app: tauri::AppHandle, which: LogFolder) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = log_folder_path(which, applog::dir(), || saved_data_dir(&app))?;
        folder::open(&app, &path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Where `which` is: MyOrbiter's log folder (`myorbiter`, once its log is open), or TennoScope's
/// first existing log folder under the data folder `data` gives.
fn log_folder_path(which: LogFolder, myorbiter: Option<PathBuf>, data: impl FnOnce() -> Result<PathBuf, String>) -> Result<PathBuf, String> {
    match which {
        LogFolder::Myorbiter => myorbiter.ok_or_else(|| "MyOrbiter's log isn't open, so it has no folder to show".to_string()),
        LogFolder::Tennoscope => tennoscope_log_dir(&data()?).ok_or_else(|| "TennoScope hasn't written a log here yet".to_string()),
    }
}

/// TennoScope's data folder as the saved settings name it (`dataDir`; its default when they name
/// none), checked as a path the page sent is (`data_dir`). Read only: a damaged settings file is an
/// error here, not moved aside (`read_settings` does that, once, as the page starts).
fn saved_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = settings_path(app)?;
    let bytes = match fs::read(&path) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("couldn't read {}: {e}", path.display())),
    };
    data_dir(settings_data_dir(bytes.as_deref())?)
}

/// `dataDir` from the saved settings' bytes (none saved: None).
fn settings_data_dir(bytes: Option<&[u8]>) -> Result<Option<String>, String> {
    let Some(bytes) = bytes else { return Ok(None) };
    let settings: Value = serde_json::from_slice(bytes).map_err(|_| "MyOrbiter's saved settings can't be read".to_string())?;
    Ok(settings.get("dataDir").and_then(Value::as_str).map(str::to_owned))
}

/// Opens a link in the browser (`link::open`): https links to MyOrbiter's sites only, checked here
/// again. On Linux it waits for the opener's answer, so on a blocking thread.
#[tauri::command]
async fn open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || link::open(&app, &url)).await.map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------- bug reports

/// The last lines of MyOrbiter's log for a bug report, redacted (applog::tail). Read only when the
/// player opens Report a bug; the page shows them before anything is sent.
#[tauri::command(async)]
fn log_tail(lines: usize) -> Vec<String> {
    applog::tail(lines)
}

/// What a bug report says about this copy: its version and the system it runs on.
#[derive(serde::Serialize)]
struct ReportEnv {
    version: String,
    os: &'static str,
    arch: &'static str,
}

/// The version is the app's (0.2.<build> in a CI build, set through tauri.conf.json), not the
/// crate's, which stays 0.1.0.
#[tauri::command]
fn report_env(app: tauri::AppHandle) -> ReportEnv {
    ReportEnv { version: app.package_info().version.to_string(), os: std::env::consts::OS, arch: std::env::consts::ARCH }
}

/// Sent to the page when the window's X is clicked: it saves what is waiting to be saved (the last
/// 300 ms of changes) and calls `quit`, as Ctrl+Q does.
const QUIT_REQUESTED: &str = "quit-requested";
/// Sent when a contract request waits for warframe.market's 10-a-minute budget: when it goes (unix ms).
const MARKET_SEARCH_WAIT: &str = "market-search-wait";
/// A page that doesn't call `quit` within this (hung, or still loading) is not waited for.
const QUIT_GRACE: Duration = Duration::from_secs(2);

/// The window's X: instead of closing at once, ask the page to save and quit, and quit anyway
/// after `QUIT_GRACE`.
fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    use tauri::Emitter;
    use std::sync::atomic::AtomicBool;
    static ASKED: AtomicBool = AtomicBool::new(false);
    api.prevent_close();
    // Clicked again while waiting: the first request and its deadline stand.
    if ASKED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = window.app_handle().clone();
    if window.emit(QUIT_REQUESTED, ()).is_err() {
        app.exit(0);
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_GRACE);
        app.exit(0);
    });
}

/// The reward cards a patched TennoScope read off the screen, if it wrote any.
#[tauri::command(async)]
fn reward_cards() -> Option<bridge::ScreenCards> {
    bridge::read_cards_in(&bridge::runtime_dir()?)
}

/// MyOrbiter's pick for those cards, for TennoScope's overlay to show.
#[tauri::command(async)]
fn write_reward_pick(pick: Value) -> Result<(), String> {
    bridge::write_pick_in(&bridge::runtime_dir().ok_or("No private folder for the reward pick")?, &pick)
}

/// Sets the riven key ("Ctrl+Shift+R", "F9"…), or none. Pressed anywhere, even in game, it tells the
/// page, which asks TennoScope to read the inventory: a riven waiting for keep-or-take then shows
/// on the overlay. Refused when the key can't be had (taken by another app, or a desktop that
/// doesn't let apps have keys).
#[tauri::command]
fn set_riven_key(app: tauri::AppHandle, key: Option<String>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    static HELD: Mutex<Option<String>> = Mutex::new(None);
    let mut held = HELD.lock().map_err(|e| e.to_string())?;
    let wanted = key.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(str::to_owned);
    if *held == wanted {
        return Ok(());
    }
    let shortcuts = app.global_shortcut();
    if let Some(k) = &wanted {
        riven_key_allowed(k)?;
        // The new key first: if it can't be had, the one that worked stays.
        shortcuts.register(k.as_str()).map_err(|e| format!("{k}: {e}"))?;
    }
    if let Some(old) = held.take() {
        let _ = shortcuts.unregister(old.as_str());
    }
    *held = wanted;
    Ok(())
}

/// A key held for MyOrbiter is taken from every app, the game too: never a bare letter the game
/// uses (R reloads), only a function key or a key with Ctrl, Alt, Shift or Super.
fn riven_key_allowed(key: &str) -> Result<(), String> {
    let parts: Vec<String> = key.split('+').map(|p| p.trim().to_ascii_lowercase()).collect();
    let modified = parts.len() > 1 && parts[..parts.len() - 1].iter().all(|p| matches!(p.as_str(), "ctrl" | "control" | "alt" | "option" | "shift" | "super" | "meta" | "cmd" | "command" | "commandorcontrol" | "cmdorctrl"));
    let last = parts.last().map(String::as_str).unwrap_or("");
    let function = last.len() >= 2 && last.starts_with('f') && last[1..].parse::<u8>().is_ok_and(|n| (1..=24).contains(&n));
    if modified || (parts.len() == 1 && function) {
        Ok(())
    } else {
        Err(format!("{key}: use a function key (F9) or a key with Ctrl, Alt, Shift or Super (Ctrl+Shift+R): a bare key would be taken from the game"))
    }
}

/// A riven cycle to show over the game (both rolls, which to keep), for TennoScope's overlay.
#[tauri::command(async)]
fn write_riven_cycle(cycle: Value) -> Result<(), String> {
    bridge::write_riven_in(&bridge::runtime_dir().ok_or("No private folder for the riven overlay")?, &cycle)
}

/// Your overlay settings, for TennoScope: which overlays show and what the reward cards show.
/// Off the main thread: the write waits on the disk (see `write_atomic`). The page sends one at a
/// time (`writeOverlayPrefs` in backend.ts), so an older one can't land after a newer one.
#[tauri::command(async)]
fn write_overlay_prefs(prefs: Value) -> Result<(), String> {
    bridge::write_overlay_in(&bridge::runtime_dir().ok_or("No private folder for the overlay settings")?, &prefs)
}

/// Which saves may be written. Each page load (the first, or a reload) gets a new page token from
/// `load_settings`, and the page numbers its saves from 1 within it. A save from an older page is
/// dropped: the page loaded since has the settings as they were on disk, and its own saves follow.
/// Within a page, a save that lost the race to a newer one is dropped instead of overwriting it.
#[derive(Debug, Default)]
struct SaveGate {
    /// The page that loaded last.
    page: u64,
    /// The newest save written: (page, number).
    written: (u64, u64),
}

impl SaveGate {
    const fn new() -> Self {
        SaveGate { page: 0, written: (0, 0) }
    }

    /// A page loaded the settings: its token.
    fn page_loaded(&mut self) -> u64 {
        self.page += 1;
        self.page
    }

    /// Whether save `rev` from page `page` may be written: Ok(false) for one that lost the race to
    /// a newer save of the same page, an error for a page that isn't the one loaded last (a token
    /// no load handed out, or a page that has since reloaded), so a page still open says so.
    fn may_write(&self, page: u64, rev: u64) -> Result<bool, String> {
        if page == 0 {
            return Err("the settings weren't loaded, so they aren't saved; restart MyOrbiter".into());
        }
        if page != self.page {
            return Err("the settings were loaded again since this page loaded them; restart MyOrbiter to save".into());
        }
        Ok(page > self.written.0 || rev >= self.written.1)
    }

    fn wrote(&mut self, page: u64, rev: u64) {
        self.written = (page, rev);
    }
}

static SETTINGS_GATE: Mutex<SaveGate> = Mutex::new(SaveGate::new());

/// Written whole to a temp file, flushed to disk and renamed (see `write_atomic`), so a crash
/// never leaves half a settings file. The flush waits on the disk, so not on the main thread.
/// `page` is the token `load_settings` gave the page; `rev` numbers the page's saves, since async
/// commands can start out of order.
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Value, page: u64, rev: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = settings_path(&app)?;
        let text = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
        let mut gate = SETTINGS_GATE.lock().unwrap_or_else(|e| e.into_inner());
        if !gate.may_write(page, rev)? {
            return Ok(());
        }
        // Only you need to read it.
        write_atomic(&path, &text, true).map_err(|e| {
            log::error!(target: "myorbiter::settings", "saving settings to {} failed: {e}", path.display());
            e.to_string()
        })?;
        gate.wrote(page, rev);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The variables MyOrbiter set for its own window at start (see `rendering::apply`),
/// which a TennoScope it starts must not inherit.
static ENV_SET_BY_MYORBITER: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();

/// Held by a test that sets this process's environment (`APPDIR`), so two such tests don't run at once.
#[cfg(test)]
pub(crate) static TEST_ENV: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn env_set_by_myorbiter() -> &'static [&'static str] {
    ENV_SET_BY_MYORBITER.get().map(Vec::as_slice).unwrap_or(&[])
}

/// How WebKitGTK draws the window (rendering.rs): set before anything else starts.
#[cfg(target_os = "linux")]
fn tune_webkit_for_this_machine() {
    let _ = ENV_SET_BY_MYORBITER.set(rendering::apply());
}

/// On a screen smaller than the window's first size (a Steam Deck's 1280×800, a small laptop),
/// the window is fitted to the screen instead of opening past its edges. Once it's on screen: the
/// size only exists then, and by then the window-state plugin has put back the size you left it
/// at, which fits and is kept.
fn fit_first_window(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else { return };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        let Some(monitor) = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten()) else { return };
        let scale = monitor.scale_factor();
        let screen = monitor.size().to_logical::<f64>(scale);
        let Ok(size) = window.outer_size() else { return };
        let size = size.to_logical::<f64>(scale);
        if size.width > screen.width + 1.0 || size.height > screen.height + 1.0 {
            // Sized to the screen first: maximising is up to the window manager, and not every
            // session has one that does it.
            let _ = window.set_size(tauri::LogicalSize::new(size.width.min(screen.width), size.height.min(screen.height)));
            let _ = window.set_position(tauri::LogicalPosition::new(0.0, 0.0));
            let _ = window.maximize();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything opens the app's folders: the ones under the old identifier are copied over once.
    datamove::run();
    #[cfg(target_os = "linux")]
    tune_webkit_for_this_machine();

    tauri::Builder::default()
        // First, so a second launch only brings the open window forward and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // Native file and message dialogs, opened only from Rust: the page has no dialog
        // permission (capabilities/default.json).
        .plugin(tauri_plugin_dialog::init())
        // Updates (updates.rs), and the restart that follows one.
        .plugin(updates::plugin())
        .plugin(tauri_plugin_process::init())
        // The riven key (see `set_riven_key`): pressed in game, the page asks TennoScope to read the inventory.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = app.emit("riven-key", ());
                    }
                })
                .build(),
        )
        .manage(Mutex::new(LogFollower::default()))
        .manage(presence::Presence::default())
        .manage(feed::Feed::default())
        .manage(updates::Pending::default())
        .manage({
            let c = companion::Companion::default();
            c.adopt();
            c
        })
        .setup(|app| {
            // First, so nothing can go out naming another version.
            set_version(app.package_info().version.to_string());
            if let Ok(dir) = app.path().app_log_dir() {
                applog::init(&dir);
            }
            datamove::log_outcome();
            log::info!(target: "myorbiter::app", "MyOrbiter {} started on {} {}", app.package_info().version, std::env::consts::OS, std::env::consts::ARCH);
            rendering::started();
            // Ctrl+C in a terminal, logout, `kill`: close the TennoScope MyOrbiter started, then exit
            // (Ctrl+Q and the window's X go through `quit` and RunEvent::Exit below instead).
            #[cfg(unix)]
            {
                use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
                if let Ok(mut signals) = signal_hook::iterator::Signals::new([SIGINT, SIGTERM, SIGHUP]) {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        if signals.forever().next().is_some() {
                            rendering::stood_up();
                            handle.state::<presence::Presence>().close();
                            handle.state::<companion::Companion>().stop();
                            std::process::exit(0);
                        }
                    });
                }
            }
            let config = app.path().app_config_dir()?;
            // Before TennoScope is started: the relic tables its reward reader should go by, from
            // the last read (the page reads them again later and writes them anew if they changed).
            if let (Some(rt), Some(data)) = (bridge::runtime_dir(), relicdata::cached(&config)) {
                if let Err(e) = bridge::write_relics_in(&rt, &data) {
                    log::warn!(target: "myorbiter::relics", "writing the cached drop tables for TennoScope failed: {e}");
                }
            }
            app.manage(market::Client::new(market::TokenStore::new(&config)));
            // A riven search waiting for warframe.market's contract budget: the page says so on the
            // control that asked, until the time given (unix ms).
            let handle = app.handle().clone();
            market::on_contract_wait(move |until| {
                let _ = handle.emit(MARKET_SEARCH_WAIT, until);
            });
            // The TennoScope this build carries, if it carries one (release builds do).
            let bundled = app.path().resource_dir().ok().map(|d| d.join(companion::BUNDLED));
            app.state::<companion::Companion>().set_bundled(bundled);
            // The program chosen in Settings' file dialog, kept beside the settings.
            app.state::<companion::Companion>().load_custom(config.join("tennoscope-program"));
            fit_first_window(app);
            updates::setup(app.handle());
            Ok(())
        })
        // Item artwork, cached locally (see images.rs). Fetches run off the main thread.
        .register_asynchronous_uri_scheme_protocol("img", |ctx, request, responder| {
            let cache = ctx
                .app_handle()
                .path()
                .app_cache_dir()
                .map(|d| d.join("img"))
                .unwrap_or_else(|_| std::env::temp_dir().join("myorbiter-img"));
            let path = request.uri().path().to_string();
            // The blocking pool reuses its threads (and caps them), where a thread per image
            // would start hundreds at once for a long table.
            tauri::async_runtime::spawn_blocking(move || responder.respond(images::respond(&cache, &path)));
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                on_close_requested(window, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            tennoscope_status,
            tennoscope_choose_program,
            tennoscope_forget_program,
            tennoscope_start,
            tennoscope_show,
            tennoscope_ask,
            log_line,
            log_folders,
            open_log_folder,
            open_link,
            log_tail,
            report_env,
            tennoscope_failure,
            reward_cards,
            notify,
            quit,
            presence_state,
            presence_set,
            write_reward_pick,
            write_overlay_prefs,
            write_riven_cycle,
            set_riven_key,
            default_data_dir,
            market_platform,
            ptrace_scope,
            load_collection,
            load_catalogs,
            data_stamp,
            worldstate,
            relic_data,
            recipe_data,
            export_file,
            discord_post,
            discord_confirm,
            load_settings,
            save_settings,
            mission_state,
            warframe_window_mode,
            tennoscope_opaque_overlay,
            reward_screens,
            market_account,
            market_sign_in,
            market_use_token,
            market_sign_out,
            market_items,
            market_my_orders,
            market_riven_meta,
            nox_item_builds,
            nox_build,
            nox_decode_code,
            market_riven_auctions,
            saved_read,
            saved_write,
            market_order_book,
            market_user,
            market_closed_orders,
            market_chats,
            market_my_auctions,
            market_create_auction,
            market_update_auction,
            market_close_auction,
            market_item_history,
            market_feed,
            market_feed_state,
            market_my_review,
            market_give_rep,
            market_create,
            market_update,
            market_close,
            market_delete,
            updates::updates_info,
            updates::updates_check,
            updates::updates_install,
            rendering::rendering_state,
            rendering::set_compat_rendering
        ])
        .build(updates::context(tauri::generate_context!()))
        .expect("error while starting MyOrbiter")
        .run(|app, event| {
            // Closing MyOrbiter closes the TennoScope it started (never one you started yourself).
            // On Windows this also runs inside WM_ENDSESSION while the session ends (tao exits the
            // loop there): nothing here may start a program, which would fail with 0xc0000142.
            if let tauri::RunEvent::Exit = event {
                rendering::stood_up();
                // Quitting closes the status connection: warframe.market then shows you offline.
                app.state::<presence::Presence>().close();
                app.state::<companion::Companion>().stop();
            }
        });
}

/// A server on 127.0.0.1 that answers one request, for tests that look at what MyOrbiter sends.
/// Nothing leaves the machine.
#[cfg(test)]
pub(crate) mod test_http {
    use std::io::{Read, Write};

    /// Listens on a free port; `answer` is the JSON body of the reply. Gives the address
    /// (`http://127.0.0.1:<port>`) and a handle that yields the request's head (request line and
    /// headers) once it has been answered.
    pub fn serve_once(answer: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a local port");
        let addr = format!("http://{}", listener.local_addr().expect("its address"));
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("a request");
            stream.set_read_timeout(Some(std::time::Duration::from_secs(10))).ok();
            let mut seen = Vec::new();
            let mut buf = [0u8; 4096];
            while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => seen.extend_from_slice(&buf[..n]),
                }
            }
            let end = seen.windows(4).position(|w| w == b"\r\n\r\n").map_or(seen.len(), |i| i);
            let head = String::from_utf8_lossy(&seen[..end]).into_owned();
            // Whatever body came with it is read too, so the reply never meets a half-sent request.
            let wanted = header(&head, "content-length").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
            let mut body = seen.len().saturating_sub(end + 4);
            while body < wanted {
                match stream.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => body += n,
                }
            }
            let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}", answer.len());
            let _ = stream.write_all(reply.as_bytes());
            head
        });
        (addr, handle)
    }

    /// A header's value in a request head, its name in any case. Sent twice is a failure.
    pub fn header(head: &str, name: &str) -> Option<String> {
        let found: Vec<String> = head
            .lines()
            .skip(1)
            .filter_map(|l| {
                let (n, v) = l.split_once(':')?;
                n.trim().eq_ignore_ascii_case(name).then(|| v.trim().to_string())
            })
            .collect();
        assert!(found.len() <= 1, "{name} sent {} times: {head}", found.len());
        found.into_iter().next()
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn the_riven_key_is_a_function_key_or_has_a_modifier() {
        for ok in ["F9", "f12", "Ctrl+Shift+R", "Alt+K", "Super+F1", "CmdOrCtrl+R"] {
            assert!(riven_key_allowed(ok).is_ok(), "{ok}");
        }
        for bad in ["R", "Space", "F25", "Ctrl", "Shift+Foo+R"] {
            assert!(riven_key_allowed(bad).is_err(), "{bad}");
        }
    }

    use super::*;

    /// The page names a log folder; it can't name a path. Only the two names pass, and TennoScope's
    /// folder comes from the saved settings, never from the page.
    #[test]
    fn a_log_folder_is_named_never_given_as_a_path() {
        assert_eq!(serde_json::from_str::<LogFolder>("\"myorbiter\"").unwrap(), LogFolder::Myorbiter);
        assert_eq!(serde_json::from_str::<LogFolder>("\"tennoscope\"").unwrap(), LogFolder::Tennoscope);
        for stray in ["\"/etc\"", "\"/home/user\"", "\"../../etc\"", "\"C:\\\\Windows\"", "\"MyOrbiter\"", "\"\"", "null", "{\"dir\":\"/etc\"}"] {
            assert!(serde_json::from_str::<LogFolder>(stray).is_err(), "{stray} refused");
        }
        // The command's arguments are the window's handle and the name: no folder from the page.
        let src = include_str!("lib.rs");
        let sig = src.split("async fn open_log_folder(").nth(1).unwrap().split(')').next().unwrap();
        assert_eq!(sig, "app: tauri::AppHandle, which: LogFolder");

        let base = std::env::temp_dir().join(format!("myorbiter-logs-{}", std::process::id()));
        let logs = myorbiter_data::reward_log::reward_log_dirs(&base).into_iter().next().unwrap();
        fs::create_dir_all(&logs).unwrap();
        let mine = base.join("myorbiter-log");
        assert_eq!(log_folder_path(LogFolder::Myorbiter, Some(mine.clone()), || panic!("not read for MyOrbiter's")), Ok(mine));
        assert_eq!(log_folder_path(LogFolder::Tennoscope, None, || Ok(base.clone())), Ok(logs));
        assert!(log_folder_path(LogFolder::Myorbiter, None, || Ok(base.clone())).is_err());
        assert_eq!(log_folder_path(LogFolder::Tennoscope, None, || Err("unreadable settings".into())), Err("unreadable settings".into()), "the settings' error is the answer");
        fs::remove_dir_all(&base).unwrap();

        // The saved settings' data folder, checked as any path is: a relative one is refused.
        assert_eq!(settings_data_dir(None), Ok(None));
        assert_eq!(settings_data_dir(Some(br#"{"dataDir":"/home/user/TennoScope"}"#)), Ok(Some("/home/user/TennoScope".into())));
        assert_eq!(settings_data_dir(Some(br#"{"tab":"home"}"#)), Ok(None));
        assert!(settings_data_dir(Some(b"{damaged")).is_err());
        assert!(data_dir(settings_data_dir(Some(br#"{"dataDir":"../../etc"}"#)).unwrap()).is_err());
    }

    #[test]
    fn the_user_agent_names_myorbiter_its_version_and_its_home() {
        assert_eq!(user_agent_for("0.2.101"), "MyOrbiter/0.2.101 (+https://github.com/ShezissSnake/myorbiter)");
        assert_eq!(user_agent(), format!("MyOrbiter/{} (+https://github.com/ShezissSnake/myorbiter)", version()));
        // The updater's first address is this same repository's releases.
        assert_eq!(REPO_URL, format!("https://github.com/{}", crate::updates::GITHUB_REPO));
    }

    #[test]
    fn every_request_carries_the_user_agent() {
        let (addr, served) = test_http::serve_once("{}");
        request("GET", &format!("{addr}/x")).call().expect("answered");
        let head = served.join().unwrap();
        assert_eq!(test_http::header(&head, "user-agent"), Some(user_agent()), "{head}");
    }

    /// Every request goes through `request` (and every warframe.market socket through
    /// `market::socket_request`), which set the User-Agent: a request built any other way fails
    /// here, so none can go out without it.
    #[test]
    fn no_request_is_built_around_the_user_agent() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = Vec::new();
        let mut todo = vec![dir.clone()];
        while let Some(d) = todo.pop() {
            for entry in fs::read_dir(&d).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    todo.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    files.push(path);
                }
            }
        }
        assert!(files.len() > 10, "found the sources in {}", dir.display());
        let count = |text: &str, what: &str| text.matches(what).count();
        for path in files {
            let all = fs::read_to_string(&path).unwrap();
            // The code, without its test modules (everything else is scanned, test-only
            // functions too). Names in any case: "user-agent" is the same header.
            let code = without_test_modules(&all).to_ascii_lowercase();
            let code = code.as_str();
            let name = path.strip_prefix(&dir).unwrap().to_string_lossy().replace('\\', "/");
            let at = |what: &str, allowed: usize| {
                assert_eq!(count(code, what), allowed, "{name}: `{what}` outside the request helpers");
            };
            match name.as_str() {
                // `fn http_agent()` and its one use, in `request`; the one agent built.
                "lib.rs" => {
                    at("http_agent()", 2);
                    at("agentbuilder", 1);
                    at("\"user-agent\"", 1);
                }
                "market.rs" => {
                    at("http_agent()", 0);
                    at("into_client_request", 1);
                    at("\"user-agent\"", 1);
                }
                // Nox's Frame names MyOrbiter its own way (never warframe.market's address).
                "noxsframe.rs" => {
                    at("http_agent()", 0);
                    at("into_client_request", 0);
                    at("\"user-agent\"", 1);
                    at("warframe.market", 0);
                }
                _ => {
                    at("http_agent()", 0);
                    at("into_client_request", 0);
                    at("\"user-agent\"", 0);
                }
            }
            // `presence::connect` opens a socket from a request it's given (market::socket_request).
            at("client_tls", usize::from(name == "presence.rs"));
            if name != "lib.rs" {
                at("agentbuilder", 0);
            }
            for what in [
                "ureq::get(",
                "ureq::post(",
                "ureq::put(",
                "ureq::patch(",
                "ureq::delete(",
                "ureq::head(",
                "ureq::request(",
                "ureq::request_url(",
                "ureq::agent(",
                "ureq::builder(",
                "agent::new(",
                "use ureq::{",
                "request::builder(",
                "tungstenite::connect(",
                "tungstenite::client::connect",
                "tungstenite::client::client(",
                "reqwest::",
                "hyper::",
                "isahc",
                "curl::",
            ] {
                at(what, 0);
            }
        }
    }

    /// `src` without its `#[cfg(test)] mod` blocks (the braces in the tests' strings pair up; the
    /// ones here are written as escapes, so this module's own braces do too).
    fn without_test_modules(src: &str) -> String {
        let mut out = String::with_capacity(src.len());
        let mut rest = src;
        while let Some(at) = rest.find("#[cfg(test)]") {
            let after = &rest[at + "#[cfg(test)]".len()..];
            let item = after.trim_start();
            let is_mod = item.starts_with("mod ") || item.starts_with("pub mod ") || item.starts_with("pub(crate) mod ");
            out.push_str(&rest[..at]);
            if !is_mod {
                out.push_str("#[cfg(test)]");
                rest = after;
                continue;
            }
            let open = after.find('\x7b').expect("a module body");
            let mut depth = 0usize;
            let mut end = after.len();
            for (i, c) in after[open..].char_indices() {
                match c {
                    '\x7b' => depth += 1,
                    '\x7d' => {
                        depth -= 1;
                        if depth == 0 {
                            end = open + i + 1;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            rest = &after[end..];
        }
        out.push_str(rest);
        out
    }

    #[test]
    fn only_discord_webhooks() {
        assert!(discord_webhook("https://discord.com/api/webhooks/123456/abc_DEF-9"));
        assert!(!discord_webhook("https://discord.com/api/webhooks/123456/"));
        assert!(!discord_webhook("https://evil.example/api/webhooks/1/x"));
        assert!(!discord_webhook("https://discord.com/api/webhooks/12a/x"));
        assert!(!discord_webhook("https://discord.com.evil.example/api/webhooks/1/x"));
    }

    #[test]
    fn only_a_confirmed_discord_address_is_posted_to_and_after_a_no_nothing_new_is_asked() {
        let a = "https://discord.com/api/webhooks/1/aaa";
        let b = "https://discord.com/api/webhooks/2/bbb";
        let c = "https://discord.com/api/webhooks/3/ccc";
        // Nothing confirmed yet: ask.
        assert_eq!(discord_address(None, false, a), DiscordAddress::Ask);
        assert_eq!(discord_address(Some(""), false, a), DiscordAddress::Ask);
        // Confirmed: posted to without asking. Another address, even one a page saved: ask.
        assert_eq!(discord_address(Some(a), false, a), DiscordAddress::Kept);
        assert_eq!(discord_address(Some(a), false, b), DiscordAddress::Ask);
        // After a no, until MyOrbiter restarts: no new address is asked about, whichever it is, and
        // the confirmed one still goes through.
        assert_eq!(discord_address(Some(a), true, b), DiscordAddress::Declined);
        assert_eq!(discord_address(Some(a), true, c), DiscordAddress::Declined);
        assert_eq!(discord_address(Some(a), true, a), DiscordAddress::Kept);
    }

    #[test]
    fn export_dates() {
        assert_eq!(civil_day(0), "1970-01-01");
        assert_eq!(civil_day(20_758), "2026-11-01");
        assert_eq!(civil_day(19_782), "2024-02-29");
        assert!(is_day("2026-11-02"));
        assert!(!is_day("2026-11-2") && !is_day("../../x.csv") && !is_day("2026/11/02"));
    }

    /// A file on a disk with room for `room` more bytes.
    struct FillsUp {
        file: fs::File,
        room: usize,
    }

    impl std::io::Write for FillsUp {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if self.room == 0 {
                return Err(std::io::Error::new(std::io::ErrorKind::StorageFull, "no space left on device"));
            }
            let n = self.file.write(&buf[..buf.len().min(self.room)])?;
            self.room -= n;
            Ok(n)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            self.file.flush()
        }
    }

    #[test]
    fn an_export_that_fills_the_disk_leaves_no_half_file() {
        let dir = std::env::temp_dir().join(format!("myorbiter-export-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let text = "item,price\n".repeat(1000);

        let path = dir.join("myorbiter-sales-2026-11-02.csv");
        let file = fs::OpenOptions::new().write(true).create_new(true).open(&path).unwrap();
        let err = write_whole(&path, FillsUp { file, room: 4096 }, text.as_bytes()).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::StorageFull);
        assert!(!path.exists(), "the half-written file is removed");

        let path = dir.join("myorbiter-sales-2026-11-02-2.csv");
        let file = fs::OpenOptions::new().write(true).create_new(true).open(&path).unwrap();
        write_whole(&path, file, text.as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), text, "a whole one stays");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn page_paths_are_checked() {
        let abs = if cfg!(windows) { "C:\\Users\\me\\data" } else { "/home/me/data" };
        assert!(data_dir(Some(abs.into())).is_ok());
        assert!(data_dir(Some("relative/dir".into())).is_err());
        assert!(data_dir(Some(format!("{abs}/../../etc"))).is_err());
        assert!(data_dir(Some("  ".into())).is_ok() || std::env::var_os("HOME").is_none(), "empty: TennoScope's own folder");
        let log = if cfg!(windows) { "C:\\Users\\me\\AppData\\Local\\Warframe\\EE.log" } else { "/home/me/.steam/Warframe/EE.log" };
        assert_eq!(ee_log_from(Some(log.into())), Ok(Some(PathBuf::from(log))));
        assert_eq!(ee_log_from(Some(log.replace("EE.log", "ee.LOG"))).map(|p| p.is_some()), Ok(true));
        assert!(ee_log_from(Some(log.replace("EE.log", "id_rsa"))).is_err(), "only a file named EE.log");
        assert!(ee_log_from(Some("EE.log".into())).is_err());
        assert_eq!(ee_log_from(None), Ok(None));
        assert_eq!(ee_log_from(Some(String::new())), Ok(None));
    }

    #[test]
    fn stops_asking_for_parts_once_the_api_cant_be_reached() {
        let mut asked = Vec::new();
        let out = each_part(|p| { asked.push(p.to_string()); Err(Unavailable::Unreachable) }, true);
        assert_eq!(asked, ["fissures"], "the first unreachable part ends the asking");
        assert_eq!(out.len(), WORLDSTATE_PARTS.len());
        assert!(out.values().all(Value::is_null));

        let mut asked = 0;
        let out = each_part(|_| { asked += 1; Err(Unavailable::Unreachable) }, false);
        assert_eq!(asked, 0, "the whole worldstate couldn't be reached: no part is asked");
        assert!(out.len() == WORLDSTATE_PARTS.len() && out.values().all(Value::is_null));

        // A part the API refuses (a 404) says nothing about the others.
        let mut asked = 0;
        let out = each_part(|p| { asked += 1; if p == "fissures" { Err(Unavailable::Refused) } else { Ok(Value::Bool(true)) } }, true);
        assert_eq!(asked, WORLDSTATE_PARTS.len());
        assert_eq!(out["fissures"], Value::Null);
        assert_eq!(out["descendia"], Value::Bool(true));
    }

    #[test]
    fn reads_the_window_mode_from_ee_cfg() {
        assert_eq!(window_mode("Graphics.DisplayAspectRatio=DAR_WIDESCREEN_16x9\r\nGraphics.WindowMode=MODE_BORDERLESS\r\n").as_deref(), Some("MODE_BORDERLESS"));
        assert_eq!(window_mode("Graphics.WindowMode=MODE_FULLSCREEN").as_deref(), Some("MODE_FULLSCREEN"));
        assert_eq!(window_mode("Graphics.WindowMode=<script>"), None);
        assert_eq!(window_mode("nothing here"), None);
    }

    #[test]
    fn a_reload_s_saves_are_written_and_the_old_page_s_late_save_is_dropped() {
        let mut gate = SaveGate::new();
        let old = gate.page_loaded();
        for rev in 1..=5 {
            assert_eq!(gate.may_write(old, rev), Ok(true));
            gate.wrote(old, rev);
        }
        // The page reloads: its saves start again at 1, below the old page's 5, and still go in.
        let new = gate.page_loaded();
        assert!(new > old);
        // A save the old page sent just before the reload, arriving after the new page loaded: the
        // new page didn't read it, so it's refused rather than written under the new page's feet.
        assert!(gate.may_write(old, 6).is_err());
        assert_eq!(gate.may_write(new, 1), Ok(true));
        gate.wrote(new, 1);
        assert!(gate.may_write(old, 7).is_err());
        assert_eq!(gate.may_write(new, 2), Ok(true));
    }

    #[test]
    fn within_a_page_an_older_save_never_overwrites_a_newer_one() {
        let mut gate = SaveGate::new();
        let page = gate.page_loaded();
        gate.wrote(page, 3);
        assert_eq!(gate.may_write(page, 2), Ok(false));
        // The same number again (a save tried twice) still goes in.
        assert_eq!(gate.may_write(page, 3), Ok(true));
        assert_eq!(gate.may_write(page, 4), Ok(true));
    }

    #[test]
    fn a_save_without_a_page_that_loaded_is_refused() {
        let mut gate = SaveGate::new();
        // Nothing loaded yet: no token is good.
        assert_eq!(gate.may_write(0, 1), Err("the settings weren't loaded, so they aren't saved; restart MyOrbiter".into()));
        assert!(gate.may_write(1, 1).is_err());
        let page = gate.page_loaded();
        // A token no load handed out.
        assert!(gate.may_write(page + 1, 1).is_err());
        assert_eq!(gate.may_write(page, 1), Ok(true));
    }
}

#[cfg(all(test, windows))]
mod local_path_tests {
    use super::{checked_path, local_path};
    use std::path::Path;

    #[test]
    fn network_paths_are_refused() {
        assert!(local_path(Path::new(r"C:\Users\x\AppData")));
        assert!(local_path(Path::new(r"\\?\C:\Users\x")));
        for p in [r"\\host\share\x", r"\\?\UNC\host\share\x", r"\\.\pipe\x"] {
            assert!(!local_path(Path::new(p)), "{p}");
            assert!(checked_path(p).is_err(), "{p}");
        }
    }
}
