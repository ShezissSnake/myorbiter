//! warframe.market account access: sign-in, your sell orders, order books.
//!
//! orbiter keeps its own sign-in and never reads the token TennoScope stores. The token lives in
//! the system keyring (KWallet / GNOME Keyring through the Secret Service) and is renewed from
//! the `Authorization` header warframe.market sends back on use.
//!
//! Every request goes through one gate that keeps at least `MIN_GAP` between calls, so a long
//! repricing pass stays inside warframe.market's limit of about three requests a second.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

const V1: &str = "https://api.warframe.market/v1";
const V2: &str = "https://api.warframe.market/v2";
const MIN_GAP: Duration = Duration::from_millis(400);
const KEYRING_SERVICE: &str = "dev.orbiter.app";
const KEYRING_USER: &str = "warframe.market";
/// How orbiter introduces itself to warframe.market, on the API and on the status socket alike.
pub const USER_AGENT: &str = concat!("orbiter/", env!("CARGO_PKG_VERSION"), " (personal order helper)");

static LAST_CALL: Mutex<Option<Instant>> = Mutex::new(None);

/// Which platform's market orbiter reads and lists on: "pc", "xbox", "ps4", "switch" or "mobile"
/// (warframe.market's names). Set from Settings, or from your signed-in profile.
static PLATFORM: std::sync::RwLock<&'static str> = std::sync::RwLock::new("pc");
pub const PLATFORMS: [&str; 5] = ["pc", "xbox", "ps4", "switch", "mobile"];

pub fn platform() -> &'static str {
    *PLATFORM.read().unwrap_or_else(|e| e.into_inner())
}

/// Switches platform; anything warframe.market doesn't know is refused.
pub fn set_platform(name: &str) -> Result<(), String> {
    let p = PLATFORMS.iter().find(|p| **p == name).ok_or_else(|| format!("Unknown platform {name}"))?;
    *PLATFORM.write().unwrap_or_else(|e| e.into_inner()) = p;
    Ok(())
}

/// After warframe.market says "too many requests": until then, calls go out further apart.
static SLOW_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// The gap while slowed down, and for how long after the last "too many requests".
const SLOW_GAP: Duration = Duration::from_millis(1500);
const SLOW_FOR: Duration = Duration::from_secs(90);

fn wait_turn() {
    let slow = SLOW_UNTIL.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|t| Instant::now() < t);
    let gap = if slow { SLOW_GAP } else { MIN_GAP };
    let mut last = LAST_CALL.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(at) = *last {
        let since = at.elapsed();
        if since < gap {
            std::thread::sleep(gap - since);
        }
    }
    *last = Some(Instant::now());
}

/// warframe.market asked to slow down: every call goes out further apart for a while.
fn slow_down() {
    *SLOW_UNTIL.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now() + SLOW_FOR);
}

/// How long the last "too many requests" said to wait (Retry-After), if it said.
static RETRY_AFTER: Mutex<Option<Duration>> = Mutex::new(None);

/// A 403 is a sign-out when it says nothing, or when warframe.market's error codes name the
/// sign-in (`app.auth…`, a token, unauthorized). One naming anything else (an order that isn't
/// yours, a limit), or a page that isn't JSON (a block page), is that one change refused.
fn forbidden_means_signed_out(body: &str) -> bool {
    if body.trim().is_empty() {
        return true;
    }
    let Ok(v) = serde_json::from_str::<Value>(body) else { return false };
    fn codes(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::String(s) => out.push(s.to_ascii_lowercase()),
            Value::Array(a) => a.iter().for_each(|x| codes(x, out)),
            Value::Object(o) => o.values().for_each(|x| codes(x, out)),
            _ => {}
        }
    }
    let mut found = Vec::new();
    codes(&v["error"], &mut found);
    found.iter().any(|c| c.starts_with("app.auth") || c.contains("token") || c.contains("unauthorized") || c.contains("jwt"))
}

/// Notes a "too many requests" reply: everything slows down, and its Retry-After is kept.
fn rate_limited(resp: &ureq::Response) -> MarketError {
    let hint = resp.header("Retry-After").and_then(|v| v.trim().parse::<u64>().ok()).map(Duration::from_secs);
    *RETRY_AFTER.lock().unwrap_or_else(|e| e.into_inner()) = hint;
    slow_down();
    MarketError::RateLimited
}

/// A read turned away for going too fast, tried again at most twice: after the wait the reply
/// asked for (up to 10 s), or 3 s and then 6 s. More would only hold up what's waiting behind it.
fn with_retries<T>(mut once: impl FnMut() -> Result<T, MarketError>) -> Result<T, MarketError> {
    let mut tries = 0u64;
    loop {
        match once() {
            Err(MarketError::RateLimited) if tries < 2 => {
                tries += 1;
                let hint = RETRY_AFTER.lock().unwrap_or_else(|e| e.into_inner()).take();
                std::thread::sleep(hint.map_or(Duration::from_secs(3 * tries), |h| h.min(Duration::from_secs(10))));
            }
            other => return other,
        }
    }
}

/// A request's path for the log: "/v2/order/abc", without the host.
fn log_path(url: &str) -> &str {
    url.split_once("warframe.market").map_or(url, |(_, rest)| rest)
}

/// A plain read with no sign-in (the item list, riven names), with the same care for rate limits.
fn get_json(url: &str, timeout: u64) -> Result<Value, MarketError> {
    let result = get_json_once(url, timeout);
    if let Err(e) = &result {
        log::warn!(target: "orbiter::market", "GET {}: {e}", log_path(url));
    }
    result
}

fn get_json_once(url: &str, timeout: u64) -> Result<Value, MarketError> {
    with_retries(|| {
        wait_turn();
        match crate::http_agent().get(url).set("User-Agent", USER_AGENT).set("Language", "en").timeout(Duration::from_secs(timeout)).call() {
            Ok(r) => r.into_json::<Value>().map_err(|e| MarketError::Unreachable(e.to_string())),
            Err(ureq::Error::Status(429, resp)) => Err(rate_limited(&resp)),
            Err(e) => Err(MarketError::Unreachable(e.to_string())),
        }
    })
}

// ------------------------------------------------------------------ token storage

/// Keyring first; if no Secret Service is running, a file only this user can read.
pub struct TokenStore {
    fallback: PathBuf,
    /// Where the token was last found or kept, so showing it needn't ask the keyring again.
    backing: Mutex<&'static str>,
    /// Off in tests, which must never touch your real keyring entry.
    keyring: bool,
}

impl TokenStore {
    pub fn new(config_dir: &Path) -> Self {
        Self { fallback: config_dir.join("market-token"), backing: Mutex::new("file"), keyring: true }
    }

    fn entry(&self) -> Option<keyring::Entry> {
        if !self.keyring {
            return None;
        }
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
    }

    fn set_backing(&self, b: &'static str) {
        *self.backing.lock().unwrap_or_else(|e| e.into_inner()) = b;
    }

    /// The token, and whether the answer is settled: false when the keyring couldn't be asked
    /// (its service not up yet at login, or the unlock prompt dismissed) and there's no file
    /// either, so it's worth asking again later rather than taking you for signed out.
    pub fn load_checked(&self) -> (Option<String>, bool) {
        let mut settled = true;
        if let Some(e) = self.entry() {
            match e.get_password() {
                Ok(t) => {
                    self.set_backing("keyring");
                    return (Some(t), true);
                }
                Err(keyring::Error::NoEntry) => {}
                Err(_) => settled = false,
            }
        }
        let t = std::fs::read_to_string(&self.fallback).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        self.set_backing("file");
        let settled = settled || t.is_some();
        (t, settled)
    }

    /// Returns where it was kept: "keyring" or "file".
    pub fn save(&self, token: &str) -> Result<&'static str, String> {
        if let Some(e) = self.entry() {
            if e.set_password(token).is_ok() {
                let _ = std::fs::remove_file(&self.fallback);
                self.set_backing("keyring");
                return Ok("keyring");
            }
        }
        // Created 0600 and renamed into place: never readable by others, never half written.
        crate::write_atomic(&self.fallback, token.as_bytes(), true).map_err(|e| e.to_string())?;
        self.set_backing("file");
        Ok("file")
    }

    pub fn clear(&self) {
        if let Some(e) = self.entry() {
            let _ = e.delete_credential();
        }
        let _ = std::fs::remove_file(&self.fallback);
        self.set_backing("file");
    }

    pub fn backing(&self) -> &'static str {
        *self.backing.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// ------------------------------------------------------------------ requests

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum MarketError {
    NotLinked,
    Unauthorized,
    RateLimited,
    Rejected(String),
    Unreachable(String),
    /// Signed in, but the token couldn't be kept (no keyring and the config folder not writable).
    Storage(String),
}

impl std::fmt::Display for MarketError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MarketError::NotLinked => write!(f, "Not signed in to warframe.market"),
            MarketError::Unauthorized => write!(f, "warframe.market refused the sign-in; sign in again"),
            MarketError::RateLimited => write!(f, "warframe.market asked to slow down; try again in a minute"),
            MarketError::Rejected(d) => write!(f, "warframe.market rejected the request: {d}"),
            MarketError::Unreachable(d) => write!(f, "warframe.market is unreachable: {d}"),
            MarketError::Storage(d) => write!(f, "couldn't keep the warframe.market sign-in: {d}"),
        }
    }
}

pub struct Client {
    pub store: TokenStore,
    token: Mutex<Option<String>>,
    /// The keyring is read on first use, not at startup: it is a D-Bus call that can wait for
    /// you to unlock the wallet, and startup runs on the main thread. Until it gives a settled
    /// answer, it's asked again at most once a minute.
    loaded: Mutex<Option<(bool, Instant)>>,
}

impl Client {
    pub fn new(store: TokenStore) -> Self {
        Self { store, token: Mutex::new(None), loaded: Mutex::new(None) }
    }

    /// The token slot, loaded from the store the first time.
    fn slot(&self) -> MutexGuard<'_, Option<String>> {
        {
            let mut loaded = self.loaded.lock().unwrap_or_else(|e| e.into_inner());
            let due = match *loaded {
                None => true,
                Some((settled, at)) => !settled && at.elapsed() >= Duration::from_secs(60),
            };
            if due {
                let (t, settled) = self.store.load_checked();
                let mut slot = self.token.lock().unwrap_or_else(|e| e.into_inner());
                // A token you signed in with meanwhile stays.
                if slot.is_none() {
                    *slot = t;
                }
                *loaded = Some((settled, Instant::now()));
            }
        }
        self.token.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn linked(&self) -> bool {
        self.slot().is_some()
    }

    /// The token, for the status connection (see `presence`), which signs in with the same one.
    pub fn token(&self) -> Option<String> {
        self.current()
    }

    fn current(&self) -> Option<String> {
        self.slot().clone()
    }

    /// One call with the current token if `auth`. A renewed token in the reply replaces the one
    /// used, unless you signed out (or in again) while the call was out.
    fn call(&self, method: &str, url: &str, body: Option<&Value>, auth: bool) -> Result<Value, MarketError> {
        let token = if auth { Some(self.current().ok_or(MarketError::NotLinked)?) } else { None };
        let (value, renewed) = self.send(method, url, body, token.as_deref())?;
        if let (Some(used), Some(renewed)) = (token, renewed) {
            self.renew(&used, renewed);
        }
        Ok(value)
    }

    /// Takes a renewed token, if the one it renews is still the one in use.
    fn renew(&self, used: &str, renewed: String) {
        let mut slot = self.slot();
        if slot.as_deref() == Some(used) && renewed != used {
            // Kept before it replaces the old one, under the lock: a sign-out waits for it and
            // then clears both.
            if self.store.save(&renewed).is_ok() {
                *slot = Some(renewed);
            }
        }
    }

    /// One request; `token` signs it. Returns the reply and any renewed token it carried. A read
    /// warframe.market turns away for going too fast is tried again (with_retries); a change
    /// isn't: it may have gone through.
    fn send(&self, method: &str, url: &str, body: Option<&Value>, token: Option<&str>) -> Result<(Value, Option<String>), MarketError> {
        let result = if method == "GET" {
            with_retries(|| self.send_once(method, url, body, token))
        } else {
            self.send_once(method, url, body, token)
        };
        // The log: every change, and every request that failed (method and path, never the sign-in).
        match &result {
            Ok(_) if method != "GET" => log::info!(target: "orbiter::market", "{method} {}: ok", log_path(url)),
            Ok(_) => {}
            Err(e) => log::warn!(target: "orbiter::market", "{method} {}: {e}", log_path(url)),
        }
        result
    }

    fn send_once(&self, method: &str, url: &str, body: Option<&Value>, token: Option<&str>) -> Result<(Value, Option<String>), MarketError> {
        wait_turn();
        let mut req = crate::http_agent()
            .request(method, url)
            .set("User-Agent", USER_AGENT)
            .set("Accept", "application/json")
            .set("Language", "en")
            .set("Platform", platform())
            // Warframe trades across platforms (both players with cross-play on), and the site
            // only shows other platforms' orders and sales when asked. Who can trade with whom is
            // sorted out per seller (market.ts, canTrade).
            .set("Crossplay", "true")
            .timeout(Duration::from_secs(20));
        if let Some(t) = &token {
            let scheme = if url.contains("/v1/") { "JWT" } else { "Bearer" };
            req = req.set("Authorization", &format!("{scheme} {t}"));
        }
        let result = match body {
            Some(b) => req.send_json(b.clone()),
            None => req.call(),
        };
        match result {
            Ok(resp) => {
                let renewed = token.and(resp.header("Authorization")).and_then(token_from_header);
                let text = resp.into_string().map_err(|e| MarketError::Unreachable(e.to_string()))?;
                if text.trim().is_empty() {
                    return Ok((Value::Null, renewed));
                }
                let value = serde_json::from_str(&text).map_err(|e| MarketError::Unreachable(e.to_string()))?;
                Ok((value, renewed))
            }
            Err(ureq::Error::Status(401, _)) => Err(MarketError::Unauthorized),
            // A 403 is a sign-out only when it says so; otherwise one change was refused, and the
            // account stays signed in.
            Err(ureq::Error::Status(403, resp)) => {
                let detail = resp.into_string().unwrap_or_default();
                if forbidden_means_signed_out(&detail) {
                    Err(MarketError::Unauthorized)
                } else {
                    Err(MarketError::Rejected(format!("403 {}", detail.chars().take(300).collect::<String>())))
                }
            }
            Err(ureq::Error::Status(429, resp)) => Err(rate_limited(&resp)),
            Err(ureq::Error::Status(code, resp)) => {
                let detail = resp.into_string().unwrap_or_default();
                Err(MarketError::Rejected(format!("{code} {}", detail.chars().take(300).collect::<String>())))
            }
            Err(e) => Err(MarketError::Unreachable(e.to_string())),
        }
    }

    // -------------------------------------------------------------- account

    /// v1 is the route that still hands tokens to third-party apps; the token works on v2.
    pub fn sign_in(&self, email: &str, password: &str) -> Result<Profile, MarketError> {
        wait_turn();
        let resp = crate::http_agent()
            .post(&format!("{V1}/auth/signin"))
            .set("User-Agent", USER_AGENT)
            .set("Authorization", "JWT")
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(20))
            .send_json(serde_json::json!({ "email": email, "password": password, "auth_type": "header" }));
        let resp = match resp {
            Ok(r) => r,
            Err(ureq::Error::Status(400 | 401 | 403, _)) => return Err(MarketError::Rejected("wrong email or password".into())),
            Err(ureq::Error::Status(429, resp)) => return Err(rate_limited(&resp)),
            Err(ureq::Error::Status(code, _)) => return Err(MarketError::Rejected(format!("sign-in returned {code}; paste a token instead"))),
            Err(e) => return Err(MarketError::Unreachable(e.to_string())),
        };
        let token = resp
            .header("Authorization")
            .and_then(token_from_header)
            .ok_or_else(|| MarketError::Rejected("no token in the reply; paste a token instead".into()))?;
        self.use_token(&token)
    }

    /// Checks a token against `/v2/me` before keeping it. Until it passes, every other request
    /// goes on with the token you had.
    pub fn use_token(&self, token: &str) -> Result<Profile, MarketError> {
        let token = token.trim().trim_start_matches("JWT ").trim_start_matches("Bearer ").trim().to_string();
        if token.is_empty() {
            return Err(MarketError::Rejected("empty token".into()));
        }
        let (v, renewed) = self.send("GET", &format!("{V2}/me"), None, Some(&token))?;
        let profile = profile_of(v)?;
        let token = renewed.unwrap_or(token);
        let mut slot = self.slot();
        self.store.save(&token).map_err(MarketError::Storage)?;
        *slot = Some(token);
        Ok(profile)
    }

    pub fn sign_out(&self) {
        // Forgotten first, under the lock, so a request still out can't put it back.
        let mut slot = self.slot();
        *slot = None;
        self.store.clear();
    }

    pub fn me(&self) -> Result<Profile, MarketError> {
        profile_of(self.call("GET", &format!("{V2}/me"), None, true)?)
    }

    // -------------------------------------------------------------- orders

    pub fn my_orders(&self) -> Result<Vec<Order>, MarketError> {
        let v = self.call("GET", &format!("{V2}/orders/my"), None, true)?;
        serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unreachable(e.to_string()))
    }

    /// Every visible order on an item, both sides, with each seller's status.
    pub fn order_book(&self, slug: &str) -> Result<Vec<BookOrder>, MarketError> {
        if slug.is_empty() || !slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err(MarketError::Rejected("bad item".into()));
        }
        let v = self.call("GET", &format!("{V2}/orders/item/{slug}"), None, false)?;
        serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unreachable(e.to_string()))
    }

    /// A player's public warframe.market profile, by their in-game name (the market's names are
    /// the game's), or None when nobody on warframe.market has that name.
    pub fn user(&self, name: &str) -> Result<Option<MarketUser>, MarketError> {
        let slug = user_slug(name).ok_or_else(|| MarketError::Rejected("bad name".into()))?;
        match self.call("GET", &format!("{V2}/user/{slug}"), None, false) {
            Ok(v) => serde_json::from_value(v["data"].clone()).map(Some).map_err(|e| MarketError::Unreachable(e.to_string())),
            Err(MarketError::Rejected(e)) if e.starts_with("404") => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// The review you've left a player, if any, as its type: 1 is +rep, -1 a report. Reputation on
    /// warframe.market is the count of positive reviews, one per reviewer. (The v1 profile API: v2
    /// has no reviews yet.)
    pub fn my_review_of(&self, name: &str) -> Result<Option<i64>, MarketError> {
        let slug = user_slug(name).ok_or_else(|| MarketError::Rejected("bad name".into()))?;
        let v = self.call("GET", &format!("{V1}/profile/{slug}/reviews/"), None, true)?;
        Ok(own_review_type(&v))
    }

    /// +rep: a positive review, with your text, on a player's warframe.market profile.
    pub fn give_rep(&self, name: &str, text: &str) -> Result<(), MarketError> {
        let slug = user_slug(name).ok_or_else(|| MarketError::Rejected("bad name".into()))?;
        let text = text.trim();
        if text.is_empty() || text.chars().count() > 300 {
            return Err(MarketError::Rejected("the message must be 1 to 300 characters".into()));
        }
        let body = serde_json::json!({ "text": text, "review_type": 1 });
        self.call("POST", &format!("{V1}/profile/{slug}/review"), Some(&body), true).map(|_| ())
    }

    /// The orders a player closed on warframe.market (marked sold or bought), newest first, as
    /// their public profile's statistics list them.
    pub fn closed_orders(&self, name: &str) -> Result<Vec<ClosedOrder>, MarketError> {
        let slug = user_slug(name).ok_or_else(|| MarketError::Rejected("bad name".into()))?;
        let v = self.call("GET", &format!("{V1}/profile/{slug}/statistics"), None, false)?;
        Ok(parse_closed_orders(&v))
    }

    // -------------------------------------------------------------- riven auctions (v1)

    /// Your auctions (rivens you're selling), open and closed, as warframe.market lists them.
    pub fn my_auctions(&self) -> Result<Value, MarketError> {
        let v = self.call("GET", &format!("{V1}/profile/auctions"), None, true)?;
        Ok(v["payload"]["auctions"].clone())
    }

    /// Puts a riven up for auction. `auction` is warframe.market's form: prices, minimum
    /// reputation, note, and the riven (`item`).
    pub fn create_auction(&self, auction: &Value) -> Result<Value, MarketError> {
        check_auction(auction)?;
        if auction["item"]["type"] != "riven" {
            return Err(MarketError::Rejected("only rivens".into()));
        }
        let v = self.call("POST", &format!("{V1}/auctions/create"), Some(auction), true)?;
        Ok(v["payload"]["auction"].clone())
    }

    /// Changes an auction's prices, minimum reputation or note.
    pub fn update_auction(&self, id: &str, change: &Value) -> Result<Value, MarketError> {
        check_id(id)?;
        check_auction(change)?;
        let v = self.call("PUT", &format!("{V1}/auctions/entry/{id}"), Some(change), true)?;
        Ok(v["payload"]["auction"].clone())
    }

    /// Takes an auction down (sold elsewhere, or you changed your mind).
    pub fn close_auction(&self, id: &str) -> Result<(), MarketError> {
        check_id(id)?;
        self.call("PUT", &format!("{V1}/auctions/entry/{id}/close"), Some(&serde_json::json!({})), true).map(|_| ())
    }

    /// An item's closed trades a day for the last 90 days, by rank and variant.
    pub fn item_history(&self, slug: &str) -> Result<Vec<PricePoint>, MarketError> {
        if slug.is_empty() || !slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err(MarketError::Rejected("bad item".into()));
        }
        let v = self.call("GET", &format!("{V1}/items/{slug}/statistics"), None, false)?;
        Ok(parse_history(&v))
    }

    /// Your chats on warframe.market's own messenger, with how many messages you haven't read.
    pub fn chats(&self) -> Result<Vec<ChatSummary>, MarketError> {
        let v = self.call("GET", &format!("{V1}/im/chats"), None, true)?;
        Ok(parse_chats(&v))
    }

    pub fn create(&self, new: &NewOrder) -> Result<Order, MarketError> {
        if !(1..=900_000).contains(&new.platinum) || !(1..=9_999).contains(&new.quantity) {
            return Err(MarketError::Rejected("price or quantity out of range".into()));
        }
        let kind = match new.kind.as_deref() {
            None | Some("sell") => "sell",
            Some("buy") => "buy",
            Some(_) => return Err(MarketError::Rejected("an order is to buy or to sell".into())),
        };
        let mut body = serde_json::json!({
            "itemId": new.item_id, "type": kind, "platinum": new.platinum,
            "quantity": new.quantity, "visible": new.visible,
        });
        if let Some(r) = new.rank {
            body["rank"] = r.into();
        }
        if let Some(s) = &new.subtype {
            body["subtype"] = s.clone().into();
        }
        let url = format!("{V2}/order");
        // Some items need fields others refuse, and warframe.market says which ones it wants:
        // bulk-tradable items (arcanes, Ayatan sculptures) how many go per trade, Ayatan
        // sculptures how many stars are socketed. Add what it asks for and try again; a
        // sculpture can ask for both at once, or one after the other.
        let mut tries = 0;
        let v = loop {
            match self.call("POST", &url, Some(&body), true) {
                Err(MarketError::Rejected(why)) if tries < 2 && fill_required(&mut body, &why) => tries += 1,
                other => break other?,
            }
        };
        serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unreachable(e.to_string()))
    }

    pub fn update(&self, id: &str, change: &OrderChange) -> Result<(), MarketError> {
        valid_id(id)?;
        let mut body = serde_json::Map::new();
        if let Some(p) = change.platinum {
            if !(1..=900_000).contains(&p) {
                return Err(MarketError::Rejected("price out of range".into()));
            }
            body.insert("platinum".into(), p.into());
        }
        if let Some(q) = change.quantity {
            if !(1..=9_999).contains(&q) {
                return Err(MarketError::Rejected("quantity out of range".into()));
            }
            body.insert("quantity".into(), q.into());
        }
        if let Some(v) = change.visible {
            body.insert("visible".into(), v.into());
        }
        self.call("PATCH", &format!("{V2}/order/{id}"), Some(&Value::Object(body)), true).map(|_| ())
    }

    /// Marks `quantity` of an order sold: warframe.market's own "Sold", which records the sale
    /// on your profile and lowers the order (or closes it when that was all of it).
    pub fn close(&self, id: &str, quantity: u32) -> Result<(), MarketError> {
        valid_id(id)?;
        if !(1..=9_999).contains(&quantity) {
            return Err(MarketError::Rejected("quantity out of range".into()));
        }
        let body = serde_json::json!({ "quantity": quantity });
        self.call("POST", &format!("{V2}/order/{id}/close"), Some(&body), true).map(|_| ())
    }

    pub fn delete(&self, id: &str) -> Result<(), MarketError> {
        valid_id(id)?;
        self.call("DELETE", &format!("{V2}/order/{id}"), None, true).map(|_| ())
    }
}

fn profile_of(v: Value) -> Result<Profile, MarketError> {
    serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unreachable(e.to_string()))
}

fn valid_id(id: &str) -> Result<(), MarketError> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(MarketError::Rejected("bad order id".into()));
    }
    Ok(())
}

fn token_from_header(h: &str) -> Option<String> {
    let t = h.strip_prefix("JWT ").or_else(|| h.strip_prefix("Bearer ")).unwrap_or(h).trim();
    (!t.is_empty() && t != "JWT" && t != "Bearer").then(|| t.to_string())
}

// ------------------------------------------------------------------ shapes (v2)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    #[serde(default)]
    pub ingame_name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub crossplay: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: String,
    pub item_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub platinum: u32,
    #[serde(default = "one")]
    pub quantity: u32,
    #[serde(default)]
    pub rank: Option<u32>,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
    /// An Ayatan sculpture's stars put in; none on anything else.
    #[serde(default)]
    pub amber_stars: Option<u32>,
    #[serde(default)]
    pub cyan_stars: Option<u32>,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookUser {
    pub id: String,
    #[serde(default)]
    pub ingame_name: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub crossplay: Option<bool>,
}

/// A player on warframe.market, as their public profile shows them.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarketUser {
    pub ingame_name: String,
    pub slug: String,
    #[serde(default)]
    pub reputation: i64,
    #[serde(default)]
    pub status: Option<String>,
}

/// One closed order from a profile's statistics.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClosedOrder {
    pub id: String,
    /// "sell" or "buy".
    pub kind: String,
    pub slug: String,
    pub name: String,
    pub rank: Option<u32>,
    pub quantity: u32,
    pub platinum: f64,
    pub closed_at: String,
}

fn parse_closed_orders(v: &Value) -> Vec<ClosedOrder> {
    let Some(list) = v["payload"]["closed_orders"].as_array() else { return Vec::new() };
    list.iter()
        .filter_map(|o| {
            let item = &o["item"];
            Some(ClosedOrder {
                id: o["id"].as_str()?.to_owned(),
                kind: o["order_type"].as_str().unwrap_or("sell").to_owned(),
                slug: item["url_name"].as_str()?.to_owned(),
                name: item["en"]["item_name"].as_str().unwrap_or_default().to_owned(),
                rank: o["mod_rank"].as_u64().map(|r| r as u32),
                quantity: o["quantity"].as_u64().unwrap_or(1) as u32,
                platinum: o["platinum"].as_f64()?,
                closed_at: o["closed_date"].as_str().or_else(|| o["updated_at"].as_str())?.to_owned(),
            })
        })
        .collect()
}

/// A warframe.market id: 24 hex digits.
fn check_id(id: &str) -> Result<(), MarketError> {
    if id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(MarketError::Rejected("bad id".into()))
    }
}

/// An auction's prices make sense: a starting price, and a buyout (if any) no lower than it.
fn check_auction(a: &Value) -> Result<(), MarketError> {
    let start = a["starting_price"].as_u64().unwrap_or(0);
    let buyout = a["buyout_price"].as_u64();
    if !(1..=1_000_000).contains(&start) || buyout.is_some_and(|b| b < start || b > 1_000_000) {
        return Err(MarketError::Rejected("prices must be 1 to 1,000,000, the buyout no lower than the starting price".into()));
    }
    Ok(())
}

/// One day of an item's closed trades.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PricePoint {
    /// The day, as warframe.market gives it (midnight UTC).
    pub at: String,
    pub median: f64,
    pub volume: u32,
    pub min: f64,
    pub max: f64,
    pub rank: Option<u32>,
    pub subtype: Option<String>,
}

fn parse_history(v: &Value) -> Vec<PricePoint> {
    let Some(days) = v["payload"]["statistics_closed"]["90days"].as_array() else { return Vec::new() };
    days.iter()
        .filter_map(|d| {
            Some(PricePoint {
                at: d["datetime"].as_str()?.to_owned(),
                median: d["median"].as_f64()?,
                volume: d["volume"].as_u64().unwrap_or(0) as u32,
                min: d["min_price"].as_f64().unwrap_or_default(),
                max: d["max_price"].as_f64().unwrap_or_default(),
                rank: d["mod_rank"].as_u64().map(|r| r as u32),
                subtype: d["subtype"].as_str().map(str::to_owned),
            })
        })
        .collect()
}

/// One chat on warframe.market's messenger.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    /// Who it's with (the chat's name is their in-game name).
    pub with: String,
    pub unread: u32,
    pub last_update: String,
    /// The newest message's text, when the reply carries it.
    pub last_message: Option<String>,
}

fn parse_chats(v: &Value) -> Vec<ChatSummary> {
    let Some(list) = v["payload"]["chats"].as_array() else { return Vec::new() };
    list.iter()
        .filter_map(|c| {
            let with = c["chat_name"].as_str().map(str::to_owned).or_else(|| c["chat_with"][0]["ingame_name"].as_str().map(str::to_owned))?;
            let last = c["messages"].as_array().and_then(|m| m.iter().max_by_key(|x| x["send_date"].as_str().unwrap_or_default().to_owned()));
            Some(ChatSummary {
                id: c["id"].as_str()?.to_owned(),
                with,
                unread: c["unread_count"].as_u64().unwrap_or(0) as u32,
                last_update: c["last_update"].as_str().unwrap_or_default().to_owned(),
                last_message: last.and_then(|m| m["raw_message"].as_str().or_else(|| m["message"].as_str())).map(str::to_owned),
            })
        })
        .collect()
}

/// `own_review` in a v1 reviews reply: the type of the review the signed-in user left, if any.
fn own_review_type(v: &Value) -> Option<i64> {
    let own = &v["payload"]["own_review"];
    own.is_object().then(|| own["review_type"].as_i64().or_else(|| own["review_type"].as_str().and_then(|s| s.parse().ok())).unwrap_or(1))
}

/// The market's profile slug for an in-game name: lower case. None for anything that isn't a name.
pub fn user_slug(name: &str) -> Option<String> {
    let name = name.trim();
    let ok = !name.is_empty() && name.len() <= 40 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    ok.then(|| name.to_ascii_lowercase())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookOrder {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub platinum: u32,
    #[serde(default = "one")]
    pub quantity: u32,
    #[serde(default)]
    pub rank: Option<u32>,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub visible: bool,
    #[serde(default)]
    pub amber_stars: Option<u32>,
    #[serde(default)]
    pub cyan_stars: Option<u32>,
    pub user: BookUser,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewOrder {
    pub item_id: String,
    pub platinum: u32,
    pub quantity: u32,
    #[serde(default)]
    pub rank: Option<u32>,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default = "yes")]
    pub visible: bool,
    /// "sell" (the default) or "buy".
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
}

/** warframe.market's answer when a listing for a bulk-tradable item leaves out `perTrade`. */
fn needs_per_trade(rejection: &str) -> bool {
    rejection.contains("\"perTrade\"") && rejection.contains("required")
}

/** warframe.market's answer when a listing for an Ayatan sculpture leaves out its stars. */
fn needs_stars(rejection: &str) -> bool {
    rejection.contains("\"amberStars\"") && rejection.contains("\"cyanStars\"") && rejection.contains("required")
}

/**
 * Adds to a new listing the fields warframe.market's rejection asks for, with the answers
 * orbiter always gives: one per trade, so a buyer can take any number, and no stars, since
 * the sculptures you sell spare come from missions empty (stars are listed on their own).
 * False when there was nothing new to add, so the rejection stands.
 */
fn fill_required(body: &mut Value, rejection: &str) -> bool {
    let mut added = false;
    if needs_per_trade(rejection) && body.get("perTrade").is_none() {
        body["perTrade"] = 1.into();
        added = true;
    }
    if needs_stars(rejection) && body.get("amberStars").is_none() {
        body["amberStars"] = 0.into();
        body["cyanStars"] = 0.into();
        added = true;
    }
    added
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct OrderChange {
    #[serde(default)]
    pub platinum: Option<u32>,
    #[serde(default)]
    pub quantity: Option<u32>,
    #[serde(default)]
    pub visible: Option<bool>,
}

// ------------------------------------------------------------------ item list (cached daily)

/// Caches a list whole (temp file and rename): a crash mid-write must not leave a cache that
/// fails to parse, since offline it's the only copy. An empty list (warframe.market answered,
/// but not with data) isn't worth keeping over a good one.
fn keep(path: &Path, value: &Value) {
    let empty = value.as_array().is_some_and(Vec::is_empty) || value.get("weapons").and_then(Value::as_array).is_some_and(Vec::is_empty);
    if empty {
        return;
    }
    if let Ok(bytes) = serde_json::to_vec(value) {
        let _ = crate::write_atomic(path, &bytes, false);
    }
}

/// warframe.market's thumbnail for an item, as orbiter's image cache names it ("wfm." and the file
/// name): only plain names under its thumbnail folder, else null.
fn thumb_name(v: &Value) -> Value {
    v.as_str()
        .and_then(|t| t.strip_prefix("items/images/en/thumbs/"))
        .filter(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'(' | b')')))
        .map_or(Value::Null, |f| Value::String(format!("wfm.{f}")))
}

/// `/v2/items`, trimmed to what orbiter needs and cached for a day.
pub fn items(cache_dir: &Path) -> Result<Value, MarketError> {
    let path = cache_dir.join("market-items.json");
    let fresh = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < Duration::from_secs(86_400));
    if fresh {
        // A list saved before it carried thumbnails is fetched again.
        if let Some(v) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).filter(|v| v[0].get("thumb").is_some()) {
            return Ok(v);
        }
    }
    let fetched = get_json(&format!("{V2}/items"), 30);
    match fetched {
        Ok(v) => {
            let slim: Vec<Value> = v["data"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .map(|i| {
                            serde_json::json!({
                                "id": i["id"], "slug": i["slug"], "gameRef": i["gameRef"],
                                "name": i["i18n"]["en"]["name"], "maxRank": i["maxRank"],
                                "subtypes": i["subtypes"], "tags": i["tags"],
                                "thumb": thumb_name(&i["i18n"]["en"]["thumb"]),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            let out = Value::Array(slim);
            keep(&path, &out);
            Ok(out)
        }
        // Offline: an old list is better than none.
        Err(e) => std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).ok_or(e),
    }
}

// ------------------------------------------------------------------ rivens

/// Only plain warframe.market slugs go into a riven search URL. One attribute has a slash in its
/// slug (`base_damage_/_melee_damage`); it's escaped where it's used.
/// A slug warframe.market uses for riven weapons and stats: lowercase words joined by `_`, with
/// `/` in a few stats (`base_damage_/_melee_damage`) and brackets in one weapon
/// (`dark_split_sword_(dual_swords)`). Nothing that could end the query or start another.
fn plain_slug(s: &str) -> bool {
    !s.is_empty() && s.len() < 80 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'/' | b'-' | b'(' | b')'))
}

/// A slug as a query value: `/` and the brackets percent-encoded, as the site's own links do.
fn query_value(s: &str) -> String {
    s.replace('/', "%2F").replace('(', "%28").replace(')', "%29")
}

/// Riven weapons and attributes (`/v2/riven/weapons`, `/v2/riven/attributes`), trimmed and cached
/// for a day. Each carries `gameRef`: the weapon path and the stat tag the game's own riven uses.
pub fn riven_meta(cache_dir: &Path) -> Result<Value, MarketError> {
    let path = cache_dir.join("market-rivens.json");
    let fresh = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|age| age < Duration::from_secs(86_400));
    if fresh {
        if let Some(v) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
            return Ok(v);
        }
    }
    let get = |what: &str| get_json(&format!("{V2}/riven/{what}"), 30);
    let fetched = get("weapons").and_then(|w| get("attributes").map(|a| (w, a)));
    match fetched {
        Ok((w, a)) => {
            let weapons: Vec<Value> = w["data"]
                .as_array()
                .map(|xs| xs.iter().map(|x| serde_json::json!({ "slug": x["slug"], "gameRef": x["gameRef"], "name": x["i18n"]["en"]["name"], "group": x["group"], "rivenType": x["rivenType"] })).collect())
                .unwrap_or_default();
            let attributes: Vec<Value> = a["data"]
                .as_array()
                .map(|xs| {
                    xs.iter()
                        .map(|x| serde_json::json!({
                            "slug": x["slug"], "gameRef": x["gameRef"], "name": x["i18n"]["en"]["name"], "unit": x["unit"],
                            "positiveOnly": x["positiveOnly"], "negativeOnly": x["negativeOnly"], "exclusiveTo": x["exclusiveTo"],
                        }))
                        .collect()
                })
                .unwrap_or_default();
            let out = serde_json::json!({ "weapons": weapons, "attributes": attributes });
            keep(&path, &out);
            Ok(out)
        }
        Err(e) => std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).ok_or(e),
    }
}

impl Client {
    /// Rivens for sale for a weapon with these stats, cheapest buyout first (v1 auctions: there's
    /// no v2 equivalent yet). Trimmed to what orbiter shows.
    pub fn riven_auctions(&self, weapon: &str, positive: &[String], negative: Option<&str>) -> Result<Value, MarketError> {
        if !plain_slug(weapon) || positive.iter().any(|p| !plain_slug(p)) || negative.is_some_and(|n| !plain_slug(n)) {
            return Err(MarketError::Rejected("not a riven search".into()));
        }
        let mut url = format!("{V1}/auctions/search?type=riven&weapon_url_name={}&buyout_policy=direct&sort_by=price_asc", query_value(weapon));
        if !positive.is_empty() {
            url.push_str(&format!("&positive_stats={}", query_value(&positive.join(","))));
        }
        if let Some(n) = negative {
            url.push_str(&format!("&negative_stats={}", query_value(n)));
        }
        let v = self.call("GET", &url, None, false)?;
        let list: Vec<Value> = v["payload"]["auctions"]
            .as_array()
            .map(|xs| {
                xs.iter()
                    .filter(|a| a["visible"].as_bool() != Some(false) && a["closed"].as_bool() != Some(true))
                    .take(60)
                    .map(|a| serde_json::json!({
                        "id": a["id"], "price": a["buyout_price"], "starting": a["starting_price"],
                        "name": a["item"]["name"], "rank": a["item"]["mod_rank"], "rerolls": a["item"]["re_rolls"],
                        "mr": a["item"]["mastery_level"], "polarity": a["item"]["polarity"], "attributes": a["item"]["attributes"],
                        "seller": a["owner"]["ingame_name"], "status": a["owner"]["status"], "platform": a["owner"]["platform"], "crossplay": a["owner"]["crossplay"],
                        "updated": a["updated"],
                    }))
                    .collect()
            })
            .unwrap_or_default();
        Ok(Value::Array(list))
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_403_is_a_sign_out_only_when_it_says_so() {
        assert!(forbidden_means_signed_out(""));
        assert!(forbidden_means_signed_out(r#"{"error":"invalid token"}"#));
        assert!(forbidden_means_signed_out(r#"{"error":{"request":["app.auth.required"]}}"#));
        assert!(!forbidden_means_signed_out(r#"{"error":{"request":["app.order.notOwned"]}}"#));
        assert!(!forbidden_means_signed_out(r#"{"error":{"inputs":{"author":"app.field.design"}}}"#));
        assert!(!forbidden_means_signed_out("<html>Access denied: sign in to your network</html>"));
    }


    #[test]
    fn platform_is_one_warframe_market_knows() {
        assert_eq!(platform(), "pc");
        set_platform("xbox").unwrap();
        assert_eq!(platform(), "xbox");
        assert!(set_platform("xbox360").is_err(), "unknown names are refused");
        assert_eq!(platform(), "xbox");
        set_platform("pc").unwrap();
    }
    #[test]
    fn reads_a_public_profile() {
        let v: serde_json::Value = serde_json::from_str(r#"{"apiVersion":"0.25.0","data":{"id":"aaaaaaaaaaaaaaaaaaaaaaaa","role":"user","tier":"none","ingameName":"Seller1","slug":"seller1","about":"<p>x</p>","reputation":15,"masteryRank":0,"status":"offline","platform":"pc","crossplay":true,"locale":"en"}}"#).unwrap();
        let u: MarketUser = serde_json::from_value(v["data"].clone()).unwrap();
        assert_eq!(u, MarketUser { ingame_name: "Seller1".into(), slug: "seller1".into(), reputation: 15, status: Some("offline".into()) });
    }

    #[test]
    fn reads_closed_orders() {
        let v: Value = serde_json::from_str(r#"{"payload": {"closed_orders": [{"order_type": "sell", "quantity": 1, "platinum": 26.0, "id": "cccccccccccccccccccccccc", "item": {"mod_max_rank": 5, "url_name": "arcane_agility", "en": {"item_name": "Arcane Agility"}}, "mod_rank": 5, "closed_date": "2026-09-17T21:14:52.081+00:00", "updated_at": "2026-09-17T21:14:52.081+00:00"}, {"order_type": "buy", "quantity": 2, "platinum": 7.0, "id": "x2", "item": {"url_name": "blind_rage", "en": {"item_name": "Blind Rage"}}, "updated_at": "2026-10-02T00:00:00+00:00"}]}}"#).unwrap();
        let o = parse_closed_orders(&v);
        assert_eq!(o.len(), 2);
        assert_eq!((o[0].name.as_str(), o[0].rank, o[0].platinum, o[0].kind.as_str()), ("Arcane Agility", Some(5), 26.0, "sell"));
        assert_eq!((o[1].quantity, o[1].rank, o[1].closed_at.as_str()), (2, None, "2026-10-02T00:00:00+00:00"));
    }

    #[test]
    fn reads_price_history() {
        let v: Value = serde_json::from_str(r#"{"payload": {"statistics_closed": {"48hours": [], "90days": [{"datetime": "2026-10-26T00:00:00.000+00:00", "volume": 123, "min_price": 5.0, "max_price": 9.0, "median": 7.0, "mod_rank": 0}, {"datetime": "2026-10-26T00:00:00.000+00:00", "volume": 3, "min_price": 110.0, "max_price": 130.0, "median": 120.0, "mod_rank": 5}]}}}"#).unwrap();
        let h = parse_history(&v);
        assert_eq!(h.len(), 2);
        assert_eq!((h[1].median, h[1].volume, h[1].rank), (120.0, 3, Some(5)));
    }

    #[test]
    fn auction_prices_are_checked() {
        assert!(check_auction(&serde_json::json!({ "starting_price": 100, "buyout_price": 150 })).is_ok());
        assert!(check_auction(&serde_json::json!({ "starting_price": 100, "buyout_price": null })).is_ok());
        assert!(check_auction(&serde_json::json!({ "starting_price": 200, "buyout_price": 150 })).is_err());
        assert!(check_auction(&serde_json::json!({ "starting_price": 0 })).is_err());
        assert!(check_id("dddddddddddddddddddddddd").is_ok());
        assert!(check_id("../x").is_err());
    }

    #[test]
    fn reads_chats() {
        let v: Value = serde_json::from_str(r#"{"payload": {"chats": [{"id": "c1", "last_update": "2026-10-27T09:00:00+00:00", "chat_with": [{"ingame_name": "Buyer"}], "messages": [{"id": "m1", "message": "<p>hi</p>", "raw_message": "hi", "message_from": "u", "send_date": "2026-10-27T08:59:00+00:00", "chat_id": "c1"}, {"id": "m2", "message": "wtb blind rage", "message_from": "u", "send_date": "2026-10-27T09:00:00+00:00", "chat_id": "c1"}], "unread_count": 2, "chat_name": "Buyer"}]}}"#).unwrap();
        assert_eq!(parse_chats(&v), vec![ChatSummary { id: "c1".into(), with: "Buyer".into(), unread: 2, last_update: "2026-10-27T09:00:00+00:00".into(), last_message: Some("wtb blind rage".into()) }]);
    }

    #[test]
    fn reads_your_own_review() {
        let none: Value = serde_json::from_str(r#"{"payload": {"reviews": [], "total_review_count": 0, "own_review": null}}"#).unwrap();
        assert_eq!(own_review_type(&none), None);
        let given: Value = serde_json::from_str(r#"{"payload": {"reviews": [], "own_review": {"id": "x", "review_type": 1, "text": "Smooth trade", "hidden": false, "date": "2026-10-27T10:00:00+00:00"}}}"#).unwrap();
        assert_eq!(own_review_type(&given), Some(1));
        let reported: Value = serde_json::from_str(r#"{"payload": {"own_review": {"review_type": "-1"}}}"#).unwrap();
        assert_eq!(own_review_type(&reported), Some(-1));
    }

    #[test]
    fn profile_slugs() {
        assert_eq!(user_slug(" Seller1 ").as_deref(), Some("seller1"));
        assert_eq!(user_slug("a/../b"), None);
        assert_eq!(user_slug(""), None);
    }

    use super::*;

    #[test]
    fn thumbnails_are_plain_names_under_the_thumbs_folder() {
        assert_eq!(thumb_name(&serde_json::json!("items/images/en/thumbs/serration.711b.128x128.png")), serde_json::json!("wfm.serration.711b.128x128.png"));
        assert_eq!(thumb_name(&serde_json::json!("items/images/en/thumbs/equilibrium_(steam_pinnacle_pack).0326.128x128.webp")), serde_json::json!("wfm.equilibrium_(steam_pinnacle_pack).0326.128x128.webp"));
        assert_eq!(thumb_name(&serde_json::json!("items/images/en/thumbs/../../x.png")), Value::Null);
        assert_eq!(thumb_name(&serde_json::json!("items/images/en/serration.png")), Value::Null);
        assert_eq!(thumb_name(&Value::Null), Value::Null);
    }

    impl Client {
        /// Signed out, never touching the keyring (a test must not read or overwrite your real
        /// token); a fallback file in `dir`.
        fn offline_in(dir: &Path) -> Self {
            let mut store = TokenStore::new(dir);
            store.keyring = false;
            let c = Client::new(store);
            *c.loaded.lock().unwrap() = Some((true, std::time::Instant::now()));
            c
        }
        fn offline() -> Self {
            Self::offline_in(Path::new("/nonexistent"))
        }
    }

    #[test]
    fn a_renewed_token_never_outlives_a_sign_out() {
        let dir = std::env::temp_dir().join(format!("orbiter-renew-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let c = Client::offline_in(&dir);
        c.store.save("old").unwrap();
        *c.slot() = Some("old".into());
        c.renew("old", "new".into());
        assert_eq!(c.token().as_deref(), Some("new"));
        assert_eq!(c.store.load_checked().0.as_deref(), Some("new"));
        // Signed out while a request was still out: its renewal must not sign you back in.
        c.sign_out();
        c.renew("new", "newer".into());
        assert!(!c.linked());
        assert_eq!(c.store.load_checked().0, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn the_fallback_token_file_is_private_and_whole() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("orbiter-token-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("market-token");
        // An old file others could read: replaced by a private one, not rewritten in place.
        std::fs::write(&path, "stale").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        crate::write_atomic(&path, b"secret", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "secret");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1, "no temp file left behind");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn riven_searches_take_only_plain_slugs() {
        assert!(plain_slug("rubico_prime"));
        assert!(plain_slug("damage_vs_corpus"));
        assert!(!plain_slug("rubico&x=1"));
        assert!(plain_slug("base_damage_/_melee_damage"));
        assert!(plain_slug("dark_split_sword_(dual_swords)"), "the one weapon with brackets");
        assert_eq!(query_value("dark_split_sword_(dual_swords)"), "dark_split_sword_%28dual_swords%29");
        assert_eq!(query_value("base_damage_/_melee_damage"), "base_damage_%2F_melee_damage");
        assert!(!plain_slug("hek prime"));
        assert!(!plain_slug("../me"));
        assert!(!plain_slug(""));
    }

    #[test]
    fn reads_tokens_from_either_scheme() {
        assert_eq!(token_from_header("JWT abc").as_deref(), Some("abc"));
        assert_eq!(token_from_header("Bearer xyz").as_deref(), Some("xyz"));
        assert_eq!(token_from_header("JWT"), None);
    }

    #[test]
    fn spots_the_per_trade_rejection() {
        let real = r#"400 {"apiVersion":"0.25.0","data":null,"error":{"inputs":{"perTrade":"app.field.required"}}}"#;
        assert!(needs_per_trade(real));
        assert!(!needs_per_trade(r#"400 {"error":{"inputs":{"platinum":"app.field.required"}}}"#));
        let sculpture = r#"warframe.market rejected the request: 400 {"apiVersion":"0.25.0","data":null,"error":{"inputs":{"amberStars":"app.field.required","cyanStars":"app.field.required"}}}"#;
        assert!(needs_stars(sculpture));
        assert!(!needs_stars(r#"400 {"error":{"inputs":{"platinum":"app.field.required"}}}"#));
    }

    #[test]
    fn a_sculpture_gets_every_field_it_asks_for() {
        let both = r#"400 {"error":{"inputs":{"perTrade":"app.field.required","amberStars":"app.field.required","cyanStars":"app.field.required"}}}"#;
        let mut body = serde_json::json!({ "itemId": "x", "platinum": 5 });
        assert!(fill_required(&mut body, both));
        assert_eq!((body["perTrade"].as_u64(), body["amberStars"].as_u64(), body["cyanStars"].as_u64()), (Some(1), Some(0), Some(0)));
        // Asked again for what it already has: nothing new, so the rejection stands.
        assert!(!fill_required(&mut body, both));
        // One after the other also ends with both.
        let mut body = serde_json::json!({ "itemId": "x" });
        assert!(fill_required(&mut body, r#"400 {"error":{"inputs":{"perTrade":"app.field.required"}}}"#));
        assert!(fill_required(&mut body, r#"400 {"error":{"inputs":{"amberStars":"app.field.required","cyanStars":"app.field.required"}}}"#));
        assert!(body["perTrade"].is_number() && body["amberStars"].is_number());
        assert!(!fill_required(&mut body, r#"400 {"error":{"inputs":{"platinum":"app.field.required"}}}"#));
    }

    #[test]
    fn order_ids_and_slugs_are_checked() {
        assert!(valid_id("eeeeeeeeeeeeeeeeeeeeeeee").is_ok());
        assert!(valid_id("../me").is_err());
        let c = Client::offline();
        assert!(matches!(c.order_book("a/b"), Err(MarketError::Rejected(_))));
        assert!(matches!(c.my_orders(), Err(MarketError::NotLinked)));
    }

    #[test]
    fn parses_a_real_order_book_entry() {
        let v: Vec<BookOrder> = serde_json::from_str(r#"[{"id":"bbbbbbbbbbbbbbbbbbbbbbbb","type":"sell","platinum":615,"quantity":1,"perTrade":1,"rank":3,"visible":true,"createdAt":"2023-06-14T11:42:57Z","updatedAt":"2026-10-08T16:27:04Z","itemId":"566751295dcbc186f0536bd1","user":{"id":"aaaaaaaaaaaaaaaaaaaaaaaa","ingameName":"Seller1","slug":"seller1","reputation":15,"platform":"pc","crossplay":true,"locale":"en","status":"ingame","activity":{"type":"UNKNOWN","details":"unknown"},"lastSeen":"2026-10-19T22:03:41Z"}}]"#).unwrap();
        assert_eq!(v[0].rank, Some(3));
        assert_eq!(v[0].user.status.as_deref(), Some("ingame"));
    }

    /// Hits the network: `cargo test -p orbiter -- --ignored`.
    #[test]
    #[ignore]
    fn fetches_a_live_order_book() {
        let c = Client::offline();
        let book = c.order_book("serration").expect("book");
        assert!(book.iter().any(|o| o.kind == "sell"));
    }
}
