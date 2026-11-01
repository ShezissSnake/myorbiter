use serde_json::Value;
use std::fs;
mod bridge;
mod companion;
mod desktop;
mod feed;
mod presence;
mod images;
mod market;
mod fissures;
mod recipes;
mod relicdata;

use orbiter_data::ee_log::{find_ee_log, LogFollower, MissionState};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::Manager;

const WORLDSTATE: &str = "https://api.warframestat.us/pc";
const USER_AGENT: &str = concat!("orbiter/", env!("CARGO_PKG_VERSION"));

fn data_dir(dir: Option<String>) -> Result<PathBuf, String> {
    dir.filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .or_else(orbiter_data::default_tennoscope_dir)
        .ok_or_else(|| "HOME is not set, so TennoScope's folder cannot be found".to_string())
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
    orbiter_data::default_tennoscope_dir().map(|p| p.display().to_string())
}

/// Reads TennoScope's database (read-only) and prices, with the revision of its catalog files: the
/// part of the data that changes on every reload (about 1 MB of JSON). Off the UI thread.
#[tauri::command]
async fn load_collection(dir: Option<String>) -> Result<orbiter_data::Collection, String> {
    let dir = data_dir(dir)?;
    tauri::async_runtime::spawn_blocking(move || orbiter_data::load_collection(&dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// The slimmed item catalog and relic table (about 6 MB of JSON, from ~80 MB of files), which the
/// page asks for only when `load_collection`'s `catalog_rev` differs from the one it holds.
#[tauri::command]
async fn load_catalogs(dir: Option<String>) -> Result<orbiter_data::Catalogs, String> {
    let dir = data_dir(dir)?;
    tauri::async_runtime::spawn_blocking(move || orbiter_data::load_catalogs(&dir))
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
/// the system's certificates are loaded once instead of on every request. Honours HTTPS_PROXY /
/// NO_PROXY as they were at startup.
pub(crate) fn http_agent() -> ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| ureq::AgentBuilder::new().try_proxy_from_env(true).build()).clone()
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
    let result = result.and_then(|()| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

enum Unavailable {
    /// The API answered, just not with this part.
    Refused,
    /// No answer at all (offline, DNS, timeout).
    Unreachable,
}

fn get_json(path: &str) -> Result<Value, Unavailable> {
    match http_agent()
        .get(&format!("{WORLDSTATE}/{path}"))
        .set("User-Agent", USER_AGENT)
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
    "zarimanCycle", "alerts", "dailyDeals", "syndicateMissions",
];

/// Active void fissures and Varzia's Prime Resurgence stock. Failures come back as `null` per
/// field so the rest of the app keeps working offline.
#[tauri::command]
async fn worldstate(app: tauri::AppHandle) -> Value {
    let dir = app.path().app_config_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = serde_json::Map::new();
        // Once the API can't be reached at all, the other parts won't fare better: don't wait
        // out a timeout for each of them.
        let mut reachable = true;
        for part in WORLDSTATE_PARTS {
            let value = if reachable {
                match get_json(part) {
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
        // api.warframestat.us down or behind the game: what it couldn't give, from the game's own file.
        const FROM_GAME: [&str; 9] = ["fissures", "voidTrader", "vaultTrader", "earthCycle", "cetusCycle", "vallisCycle", "cambionCycle", "sortie", "archonHunt"];
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
    tauri::async_runtime::spawn_blocking(move || relicdata::relic_data(&dir, force.unwrap_or(false)))
        .await
        .map_err(|e| e.to_string())?
}

/// Saves an export (CSV) in your Downloads folder as `orbiter-<what>-<date>.csv`, never over an
/// existing file. Returns where it went.
#[tauri::command]
fn export_file(app: tauri::AppHandle, what: String, text: String) -> Result<String, String> {
    if what.is_empty() || !what.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') {
        return Err("bad export name".into());
    }
    let dir = app.path().download_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
    let day = chrono_day();
    let mut path = dir.join(format!("orbiter-{what}-{day}.csv"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("orbiter-{what}-{day}-{n}.csv"));
        n += 1;
    }
    fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
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

/// A Discord webhook address, nothing else (the page checks too): orbiter posts only to these.
fn discord_webhook(url: &str) -> bool {
    let rest = ["https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/", "https://ptb.discord.com/api/webhooks/", "https://canary.discord.com/api/webhooks/"]
        .iter()
        .find_map(|p| url.strip_prefix(p));
    let Some((id, token)) = rest.and_then(|r| r.split_once('/')) else { return false };
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) && !token.is_empty() && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Posts a notification to your Discord webhook (Settings → notifications), for when you're away.
#[tauri::command]
async fn discord_post(url: String, content: String) -> Result<(), String> {
    if !discord_webhook(&url) {
        return Err("not a Discord webhook address".into());
    }
    let content: String = content.chars().take(1900).collect();
    tauri::async_runtime::spawn_blocking(move || {
        http_agent()
            .post(&url)
            .set("User-Agent", USER_AGENT)
            .timeout(Duration::from_secs(10))
            .send_json(serde_json::json!({ "username": "orbiter", "content": content, "allowed_mentions": { "parse": [] } }))
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
    *found = path.clone().map(|p| (p, Instant::now()));
    path
}

/// Warframe's display mode from its EE.cfg, beside the log ("MODE_BORDERLESS", "MODE_FULLSCREEN",
/// "MODE_WINDOWED"). On Windows an overlay can't draw over exclusive fullscreen, so orbiter says so.
#[tauri::command(async)]
fn warframe_window_mode(path: Option<String>) -> Option<String> {
    let log = path.filter(|p| !p.trim().is_empty()).map(PathBuf::from).or_else(ee_log_path)?;
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
        let path = path
            .filter(|p| !p.trim().is_empty())
            .map(PathBuf::from)
            .or_else(ee_log_path);
        let Some(path) = path else { return Ok(None) };
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
async fn reward_screens(dir: Option<String>) -> Result<Vec<orbiter_data::reward_log::LoggedScreen>, String> {
    let dir = data_dir(dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        orbiter_data::reward_log::read_reward_logs(&orbiter_data::reward_log::reward_log_dirs(&dir))
    })
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

#[tauri::command]
async fn market_riven_meta(app: tauri::AppHandle) -> Result<Value, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    blocking(move || market::riven_meta(&cache)).await
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

#[tauri::command]
fn market_feed_state(app: tauri::AppHandle) -> feed::FeedState {
    app.state::<feed::Feed>().state()
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

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<Value, String> {
    let path = settings_path(&app)?;
    // No file yet: a first run. Any other failure (a file held by an antivirus or a backup, no
    // permission) is an error, so the page doesn't start from defaults and save them over it.
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(e) => return Err(format!("couldn't read {}: {e}", path.display())),
    };
    Ok(match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(_) => {
            // Keep a damaged file (floors, tiers...) instead of letting the defaults overwrite it.
            let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
            let _ = fs::rename(&path, path.with_extension(format!("json.broken-{stamp}")));
            Value::Null
        }
    })
}

#[tauri::command(async)]
fn tennoscope_status(companion: tauri::State<'_, companion::Companion>, path: Option<String>) -> companion::Status {
    companion.status(path.as_deref())
}

/// Starts TennoScope in the background, unless one is running already.
#[tauri::command(async)]
fn tennoscope_start(companion: tauri::State<'_, companion::Companion>, path: Option<String>) -> Result<companion::Status, String> {
    companion.start(path.as_deref())
}

/// Passes a request (sync, screen-capture permission) to the running TennoScope.
#[tauri::command(async)]
fn tennoscope_ask(companion: tauri::State<'_, companion::Companion>, path: Option<String>, ask: String) -> Result<(), String> {
    companion.ask(path.as_deref(), &ask)
}

/// Whether the TennoScope orbiter starts draws its overlay on a solid background (Windows: a
/// transparent one can come out invisible with some drivers). From its next start.
#[tauri::command]
fn tennoscope_opaque_overlay(on: bool) {
    companion::set_opaque_overlay(on);
}

/// Brings up TennoScope's own window.
#[tauri::command(async)]
fn tennoscope_show(companion: tauri::State<'_, companion::Companion>, path: Option<String>) -> Result<(), String> {
    companion.show(path.as_deref())
}

/// Your warframe.market status as orbiter holds it.
#[tauri::command]
fn presence_state(status: tauri::State<'_, presence::Presence>) -> presence::State {
    status.state()
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

/// A desktop notification (the page only sends one while orbiter's window isn't focused). `id`:
/// its entry in the page's history, so a click on it opens what it's about.
#[tauri::command]
fn notify(app: tauri::AppHandle, summary: String, body: String, id: Option<String>) {
    desktop::notify(app, summary, body, id);
}

/// Ctrl+Q, and the window's X once the page has saved: quit, stopping the TennoScope orbiter
/// started (see `RunEvent::Exit` in `run`).
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Sent to the page when the window's X is clicked: it saves what is waiting to be saved (the last
/// 300 ms of changes) and calls `quit`, as Ctrl+Q does.
const QUIT_REQUESTED: &str = "quit-requested";
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

/// orbiter's pick for those cards, for TennoScope's overlay to show.
#[tauri::command(async)]
fn write_reward_pick(pick: Value) -> Result<(), String> {
    bridge::write_pick_in(&bridge::runtime_dir().ok_or("No private folder for the reward pick")?, &pick)
}

/// Your overlay settings, for TennoScope: which overlays show and what the reward cards show.
#[tauri::command]
fn write_overlay_prefs(prefs: Value) -> Result<(), String> {
    bridge::write_overlay_in(&bridge::runtime_dir().ok_or("No private folder for the overlay settings")?, &prefs)
}

/// Saves in the order the page sent them: each save takes a number on arrival, and one that
/// lost the race to a newer save is dropped instead of overwriting it.
static SETTINGS_SENT: AtomicU64 = AtomicU64::new(0);
static SETTINGS_WRITTEN: Mutex<u64> = Mutex::new(0);

/// Written whole to a temp file, flushed to disk and renamed (see `write_atomic`), so a crash
/// never leaves half a settings file. The flush waits on the disk, so not on the main thread.
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Value, rev: Option<u64>) -> Result<(), String> {
    // The page numbers its saves (`rev`): async commands can start out of order, so numbering
    // them here could put an older save after a newer one. Without one, as they arrive.
    let seq = rev.unwrap_or_else(|| SETTINGS_SENT.fetch_add(1, Ordering::SeqCst) + 1);
    tauri::async_runtime::spawn_blocking(move || {
        let path = settings_path(&app)?;
        let text = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
        let mut written = SETTINGS_WRITTEN.lock().unwrap_or_else(|e| e.into_inner());
        if *written > seq {
            return Ok(());
        }
        // Only you need to read it.
        write_atomic(&path, &text, true).map_err(|e| e.to_string())?;
        *written = seq;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The variables orbiter set for its own window at start (see `tune_webkit_for_this_machine`),
/// which a TennoScope it starts must not inherit.
static ENV_SET_BY_ORBITER: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();

pub(crate) fn env_set_by_orbiter() -> &'static [&'static str] {
    ENV_SET_BY_ORBITER.get().map(Vec::as_slice).unwrap_or(&[])
}

/// A WebKitGTK workaround. Its DMA-BUF renderer crashes on the NVIDIA driver under
/// Wayland ("Error 71 (Protocol error) dispatching to Wayland display") or paints a blank window,
/// so it is switched off there. Anything already set in the environment wins.
#[cfg(target_os = "linux")]
fn tune_webkit_for_this_machine() {
    use std::path::Path;
    let mut set = Vec::new();
    let mut set_default = |key: &'static str, value: &str| {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
            set.push(key);
        }
    };
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let nvidia = Path::new("/proc/driver/nvidia/version").exists() || Path::new("/sys/module/nvidia").exists();
    if wayland {
        set_default("GDK_BACKEND", "wayland,x11");
    }
    if nvidia {
        set_default("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        set_default("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    } else if !wayland {
        set_default("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    let _ = ENV_SET_BY_ORBITER.set(set);
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
        .manage(Mutex::new(LogFollower::default()))
        .manage(presence::Presence::default())
        .manage(feed::Feed::default())
        .manage({
            let c = companion::Companion::default();
            c.adopt();
            c
        })
        .setup(|app| {
            // Ctrl+C in a terminal, logout, `kill`: close the TennoScope orbiter started, then exit
            // (Ctrl+Q and the window's X go through `quit` and RunEvent::Exit below instead).
            #[cfg(unix)]
            {
                use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
                if let Ok(mut signals) = signal_hook::iterator::Signals::new([SIGINT, SIGTERM, SIGHUP]) {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        if signals.forever().next().is_some() {
                            handle.state::<presence::Presence>().close();
                            handle.state::<companion::Companion>().stop();
                            std::process::exit(0);
                        }
                    });
                }
            }
            let config = app.path().app_config_dir()?;
            app.manage(market::Client::new(market::TokenStore::new(&config)));
            // The TennoScope this build carries, if it carries one (release builds do).
            let bundled = app.path().resource_dir().ok().map(|d| d.join(companion::BUNDLED));
            app.state::<companion::Companion>().set_bundled(bundled);
            fit_first_window(app);
            Ok(())
        })
        // Item artwork, cached locally (see images.rs). Fetches run off the main thread.
        .register_asynchronous_uri_scheme_protocol("img", |ctx, request, responder| {
            let cache = ctx
                .app_handle()
                .path()
                .app_cache_dir()
                .map(|d| d.join("img"))
                .unwrap_or_else(|_| std::env::temp_dir().join("orbiter-img"));
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
            tennoscope_start,
            tennoscope_show,
            tennoscope_ask,
            reward_cards,
            notify,
            quit,
            presence_state,
            presence_set,
            write_reward_pick,
            write_overlay_prefs,
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
            market_riven_auctions,
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
            market_delete
        ])
        .build(tauri::generate_context!())
        .expect("error while starting orbiter")
        .run(|app, event| {
            // Closing orbiter closes the TennoScope it started (never one you started yourself).
            if let tauri::RunEvent::Exit = event {
                // Quitting closes the status connection: warframe.market then shows you offline.
                app.state::<presence::Presence>().close();
                app.state::<companion::Companion>().stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_discord_webhooks() {
        assert!(discord_webhook("https://discord.com/api/webhooks/123456/abc_DEF-9"));
        assert!(!discord_webhook("https://discord.com/api/webhooks/123456/"));
        assert!(!discord_webhook("https://evil.example/api/webhooks/1/x"));
        assert!(!discord_webhook("https://discord.com/api/webhooks/12a/x"));
        assert!(!discord_webhook("https://discord.com.evil.example/api/webhooks/1/x"));
    }

    #[test]
    fn export_dates() {
        assert_eq!(civil_day(0), "1970-01-01");
        assert_eq!(civil_day(20_758), "2026-11-01");
        assert_eq!(civil_day(19_782), "2024-02-29");
    }

    #[test]
    fn reads_the_window_mode_from_ee_cfg() {
        assert_eq!(window_mode("Graphics.DisplayAspectRatio=DAR_WIDESCREEN_16x9\r\nGraphics.WindowMode=MODE_BORDERLESS\r\n").as_deref(), Some("MODE_BORDERLESS"));
        assert_eq!(window_mode("Graphics.WindowMode=MODE_FULLSCREEN").as_deref(), Some("MODE_FULLSCREEN"));
        assert_eq!(window_mode("Graphics.WindowMode=<script>"), None);
        assert_eq!(window_mode("nothing here"), None);
    }
}
