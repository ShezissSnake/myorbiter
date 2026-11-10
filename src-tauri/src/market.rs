//! warframe.market account access: sign-in, your sell orders, order books.
//!
//! MyOrbiter keeps its own sign-in and never reads the token TennoScope stores. The token lives in
//! the system keyring (KWallet / GNOME Keyring through the Secret Service) and is renewed from
//! the `Authorization` header warframe.market sends back on use.
//!
//! Every request goes through one gate that keeps at least `MIN_GAP` between calls, so a long
//! repricing pass stays inside warframe.market's limit of about three requests a second. Contract
//! requests (riven auctions) also share a budget of `CONTRACTS_PER_MINUTE`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

const V1: &str = "https://api.warframe.market/v1";
const V2: &str = "https://api.warframe.market/v2";
pub(crate) const MIN_GAP: Duration = Duration::from_millis(400);
// The keyring entry goes by the bundle identifier. One kept under the identifier before the rename
// (dev.orbiter.app) isn't read: that sign-in is made once more.
const KEYRING_SERVICE: &str = crate::datamove::ID;
const KEYRING_USER: &str = "warframe.market";
/// The sign-in's file in the config folder, where there is no keyring (written by `write_atomic`,
/// by way of `.market-token.<pid>.<n>.tmp`).
pub const TOKEN_FILE: &str = "market-token";
/// warframe.market's WebSocket: the live feed of new orders (feed.rs) and your status (presence.rs).
const SOCKET: &str = "wss://ws.warframe.market/socket";
/// The socket refuses connections that don't ask for this subprotocol.
const SUBPROTOCOL: &str = "wfm";

/// Every HTTP request to warframe.market starts here: `crate::request`, which names MyOrbiter in
/// the User-Agent (`MyOrbiter/<version> (+<repository>)`), as warframe.market's rules ask.
fn request(method: &str, url: &str) -> ureq::Request {
    crate::request(method, url)
}

/// The request that opens warframe.market's socket, for the live feed and the status alike: its
/// subprotocol and the same User-Agent as the API. A connection that says nothing about itself is
/// turned away (403) before it can sign in.
pub(crate) fn socket_request() -> Result<tungstenite::handshake::client::Request, tungstenite::Error> {
    use tungstenite::client::IntoClientRequest;
    use tungstenite::http::HeaderValue;
    let mut request = SOCKET.into_client_request()?;
    request.headers_mut().insert("Sec-WebSocket-Protocol", HeaderValue::from_static(SUBPROTOCOL));
    let agent = HeaderValue::from_str(&crate::user_agent()).map_err(|e| tungstenite::Error::HttpFormat(e.into()))?;
    request.headers_mut().insert("User-Agent", agent);
    Ok(request)
}

static LAST_CALL: Mutex<Option<Instant>> = Mutex::new(None);

/// Which platform's market MyOrbiter reads and lists on: "pc", "xbox", "ps4", "switch" or "mobile"
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

/// The last step before a request goes: the general gap, then (with the turn held, so nothing
/// else goes meanwhile) warframe.market's deadline once more, since a request that waited
/// (for the gap, the change cap or a contract slot) may have done so past another's 429, and a
/// contract request's place in the budget by when it really goes.
fn wait_turn(contract: bool) -> Result<(), MarketError> {
    let slow = SLOW_UNTIL.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|t| Instant::now() < t);
    let gap = if slow { SLOW_GAP } else { MIN_GAP };
    let mut last = LAST_CALL.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(at) = *last {
        let since = at.elapsed();
        if since < gap {
            std::thread::sleep(gap - since);
        }
    }
    let deadline = *NOT_BEFORE.lock().unwrap_or_else(|e| e.into_inner());
    match deadline_wait(deadline, Instant::now()) {
        Err(t) => return Err(MarketError::Deferred(unix_ms(t))),
        Ok(w) if !w.is_zero() => std::thread::sleep(w),
        Ok(_) => {}
    }
    if contract {
        // The slot taken in contract_turn keeps the queue's order; this keeps the count exact:
        // no more than CONTRACTS_PER_MINUTE sent in any minute, by when each went.
        let mut sent = CONTRACTS_SENT.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        while sent.front().is_some_and(|t| now.saturating_duration_since(*t) >= CONTRACT_SENT_WINDOW) {
            sent.pop_front();
        }
        let wait = window_wait(&sent, CONTRACTS_PER_MINUTE, CONTRACT_SENT_WINDOW, now);
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
        sent.push_back(Instant::now());
    }
    *last = Some(Instant::now());
    Ok(())
}

/// At most this many changes (orders, auctions, +rep) in any minute: a page gone wrong can't
/// rewrite every listing at once. Above it, a change waits for its turn rather than failing; at
/// `MIN_GAP` apart a plan of 100 changes stays under it and finishes within the minute.
const WRITES_PER_MINUTE: usize = 120;
const WRITE_WINDOW: Duration = Duration::from_secs(60);
/// When the changes of the last minute went out, oldest first.
static WRITES: Mutex<std::collections::VecDeque<Instant>> = Mutex::new(std::collections::VecDeque::new());

/// How long a change at `now` waits, the recent changes having gone out at `sent` (oldest first;
/// it may still hold some older than a minute, which don't count).
fn write_wait(sent: &std::collections::VecDeque<Instant>, now: Instant) -> Duration {
    window_wait(sent, WRITES_PER_MINUTE, WRITE_WINDOW, now)
}

/// How long a request at `now` waits so that no `window` holds more than `cap` of them, the others
/// going (or due to go) at `sent`, oldest first.
fn window_wait(sent: &std::collections::VecDeque<Instant>, cap: usize, window: Duration, now: Instant) -> Duration {
    if sent.len() < cap {
        return Duration::ZERO;
    }
    // The one that has to leave the window first: `len - (cap - 1)` from the front.
    let oldest = sent[sent.len() - cap];
    (oldest + window).saturating_duration_since(now)
}

/// warframe.market's limit for contracts (riven auctions), from its terms of service
/// (warframe.market/tos, API): "Requests may not be made at a rate faster than 3 per second for
/// listings or 10 per minute for contracts." Its developer docs (docs.warframe.market, Rules)
/// expect contract search endpoints "to be limited to roughly 10 to 20 requests per minute"; the
/// lower figure is the one kept. Every request whose path has `/auctions` counts: searches (a
/// riven's price check, comparing, a riven alert, Search on Rivens), your own auctions, and
/// putting one up, changing or closing it.
const CONTRACTS_PER_MINUTE: usize = 10;
/// A contract request's slot is counted from when it's due to go; the general gap (`SLOW_GAP` at
/// most) can hold it a little longer, so the window is that much longer than a minute.
const CONTRACT_WINDOW: Duration = Duration::from_millis(61_500);

/// The contract requests sent, by when each went: the count wait_turn holds to, a minute exactly.
static CONTRACTS_SENT: Mutex<std::collections::VecDeque<Instant>> = Mutex::new(std::collections::VecDeque::new());
const CONTRACT_SENT_WINDOW: Duration = Duration::from_secs(60);

/// Whether a request is a contract request, by its path.
fn is_contract(url: &str) -> bool {
    log_path(url).contains("/auctions")
}

/// The contract requests of the last minute, by when each went or is due to go, oldest first. A
/// request takes its slot when it asks, so the ones after it queue behind it, in order.
static CONTRACTS: Mutex<std::collections::VecDeque<Instant>> = Mutex::new(std::collections::VecDeque::new());

/// Takes the next contract slot at `now`: how long to wait for it. Slots a minute past drop out.
fn contract_slot(sent: &mut std::collections::VecDeque<Instant>, now: Instant) -> Duration {
    while sent.front().is_some_and(|t| now.saturating_duration_since(*t) >= CONTRACT_WINDOW) {
        sent.pop_front();
    }
    let wait = window_wait(sent, CONTRACTS_PER_MINUTE, CONTRACT_WINDOW, now);
    sent.push_back(now + wait);
    wait
}

/// Told when a contract request has to wait for the budget, with when it will go (unix ms), so
/// the page can say so on the control that asked. Set once at startup (lib.rs).
static CONTRACT_WAIT: Mutex<Option<Box<dyn Fn(u64) + Send>>> = Mutex::new(None);

pub fn on_contract_wait(f: impl Fn(u64) + Send + 'static) {
    *CONTRACT_WAIT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(f));
}

/// A time to come as unix milliseconds, for the page.
fn unix_ms(at: Instant) -> u64 {
    let wall = std::time::SystemTime::now() + at.saturating_duration_since(Instant::now());
    wall.duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// A contract request waits for its slot in the budget; nothing is dropped.
fn contract_turn() {
    let wait = contract_slot(&mut CONTRACTS.lock().unwrap_or_else(|e| e.into_inner()), Instant::now());
    if wait.is_zero() {
        return;
    }
    log::info!(target: "myorbiter::market", "{CONTRACTS_PER_MINUTE} contract requests this minute: waiting {} s", wait.as_secs());
    if let Some(tell) = CONTRACT_WAIT.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        tell(unix_ms(Instant::now() + wait));
    }
    std::thread::sleep(wait);
}

/// Waits for a change's turn under the cap, then counts it.
fn write_turn() {
    let mut sent = WRITES.lock().unwrap_or_else(|e| e.into_inner());
    let wait = write_wait(&sent, Instant::now());
    if !wait.is_zero() {
        log::info!(target: "myorbiter::market", "{WRITES_PER_MINUTE} changes this minute: waiting {} s", wait.as_secs());
        std::thread::sleep(wait);
    }
    let now = Instant::now();
    while sent.front().is_some_and(|t| now.saturating_duration_since(*t) >= WRITE_WINDOW) {
        sent.pop_front();
    }
    sent.push_back(now);
}

/// warframe.market asked to slow down: every call goes out further apart for a while.
fn slow_down() {
    *SLOW_UNTIL.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now() + SLOW_FOR);
}

/// The time before which no request goes to warframe.market, after it answered "too many
/// requests" (429): now plus its Retry-After, in full. One deadline for every request (reads,
/// changes, contracts); it only ever moves later. Monotonic, so a clock change doesn't move it.
static NOT_BEFORE: Mutex<Option<Instant>> = Mutex::new(None);
/// A 429 that doesn't say how long (no Retry-After, or one that isn't a number of seconds).
const DEFAULT_RETRY_AFTER: Duration = Duration::from_secs(60);
/// The longest Retry-After taken as given.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(86_400);
/// How long a request waits for that deadline. A read or change that would wait longer isn't
/// sent: it comes back deferred, with the time, for the page to show ("warframe.market asked us
/// to wait until 14:05"); the page's own timers ask again later.
const MAX_WAIT: Duration = Duration::from_secs(10);

/// The deadline after a 429 at `now` that asked for `retry_after` (None: it didn't say). A later
/// deadline already set stays.
fn hold_off(current: Option<Instant>, now: Instant, retry_after: Option<Duration>) -> Instant {
    // A day at most: an absurd Retry-After can't overflow the clock (or stop MyOrbiter for good).
    let wait = retry_after.unwrap_or(DEFAULT_RETRY_AFTER).min(MAX_RETRY_AFTER);
    let until = now.checked_add(wait).unwrap_or(now);
    current.map_or(until, |t| t.max(until))
}

/// What a request at `now` does under the deadline: go after waiting this long, or not go at
/// all before the deadline (Err) when that's further off than `MAX_WAIT`.
fn deadline_wait(not_before: Option<Instant>, now: Instant) -> Result<Duration, Instant> {
    match not_before {
        Some(t) if t.saturating_duration_since(now) > MAX_WAIT => Err(t),
        Some(t) => Ok(t.saturating_duration_since(now)),
        None => Ok(Duration::ZERO),
    }
}

/// Retry-After as a number of seconds; warframe.market's (Cloudflare's) is one. Anything else
/// (an HTTP date) counts as not said.
fn retry_after_secs(v: Option<&str>) -> Option<Duration> {
    v.and_then(|v| v.trim().parse::<u64>().ok()).map(Duration::from_secs)
}

/// Waits for the deadline, if there is one and it's near; deferred if it's far.
fn deadline_turn() -> Result<(), MarketError> {
    loop {
        let wait = deadline_wait(*NOT_BEFORE.lock().unwrap_or_else(|e| e.into_inner()), Instant::now()).map_err(|t| MarketError::Deferred(unix_ms(t)))?;
        if wait.is_zero() {
            return Ok(());
        }
        // Looked at again after the wait: another request's 429 may have moved it meanwhile.
        std::thread::sleep(wait);
    }
}

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

/// Notes a "too many requests" reply: no request goes before its Retry-After is over, and calls
/// go out further apart for a while after. The request itself is deferred to that time.
fn rate_limited(resp: &ureq::Response) -> MarketError {
    let hint = retry_after_secs(resp.header("Retry-After"));
    let until = {
        let mut nb = NOT_BEFORE.lock().unwrap_or_else(|e| e.into_inner());
        let until = hold_off(*nb, Instant::now(), hint);
        *nb = Some(until);
        until
    };
    slow_down();
    log::warn!(target: "myorbiter::market", "warframe.market asked to wait {} s", until.saturating_duration_since(Instant::now()).as_secs());
    MarketError::Deferred(unix_ms(until))
}

/// A read: sent once the deadline allows (deferred when it's far off), and when warframe.market
/// turns it away for going too fast, tried again only after the full wait it asked for, and only
/// while that wait is short (`MAX_WAIT`), at most twice. Never sooner: a read that can't wait is
/// deferred. A change never goes through here: it's sent once (it may have gone through).
fn with_retries<T>(mut once: impl FnMut() -> Result<T, MarketError>) -> Result<T, MarketError> {
    let mut tries = 0u64;
    loop {
        deadline_turn()?;
        match once() {
            Err(MarketError::Deferred(_)) if tries < 2 && deadline_wait(*NOT_BEFORE.lock().unwrap_or_else(|e| e.into_inner()), Instant::now()).is_ok() => {
                tries += 1;
            }
            other => return other,
        }
    }
}

/// A request's path for the log: "/v2/order/abc", without the host.
fn log_path(url: &str) -> &str {
    url.split_once("warframe.market").map_or(url, |(_, rest)| rest)
}

/// A reply's body as JSON. Read whole first: failing to read it (a connection reset or cut off on
/// the way) is "unreachable"; a whole body that isn't JSON is "unexpected". ureq's own
/// `into_json` reports both as invalid data, so it can't tell them apart.
fn json_body(mut body: impl std::io::Read) -> Result<Value, MarketError> {
    // Bytes, not text: a whole body that isn't UTF-8 is an unexpected reply, not the network.
    let mut bytes = Vec::new();
    body.read_to_end(&mut bytes).map_err(|e| MarketError::Unreachable(e.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|e| MarketError::Unexpected(e.to_string()))
}

/// A plain read with no sign-in (the item list, riven names), with the same care for rate limits.
fn get_json(url: &str, timeout: u64) -> Result<Value, MarketError> {
    let result = get_json_once(url, timeout);
    if let Err(e) = &result {
        log::warn!(target: "myorbiter::market", "GET {}: {e}", log_path(url));
    }
    result
}

fn get_json_once(url: &str, timeout: u64) -> Result<Value, MarketError> {
    with_retries(|| {
        wait_turn(is_contract(url))?;
        match request("GET", url).set("Language", "en").timeout(Duration::from_secs(timeout)).call() {
            Ok(r) => json_body(r.into_reader()),
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
        Self { fallback: config_dir.join(TOKEN_FILE), backing: Mutex::new("file"), keyring: true }
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
    Rejected(String),
    Unreachable(String),
    /// warframe.market answered, but not in a shape MyOrbiter can read (a changed API, a block page
    /// served as 200): not the same as the site being down. Like every variant here it reaches
    /// the page as text (`blocking` in lib.rs); no code branches on Unreachable or Unexpected.
    Unexpected(String),
    /// Signed in, but the token couldn't be kept (no keyring and the config folder not writable).
    Storage(String),
    /// Not sent: warframe.market asked to wait (a 429's Retry-After) until this time, unix ms. The
    /// page shows it as the clock does (core/marketWait.ts reads these words).
    Deferred(u64),
}

impl std::fmt::Display for MarketError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MarketError::NotLinked => write!(f, "Not signed in to warframe.market"),
            MarketError::Unauthorized => write!(f, "warframe.market refused the sign-in; sign in again"),
            MarketError::Rejected(d) => write!(f, "warframe.market rejected the request: {d}"),
            MarketError::Unreachable(d) => write!(f, "warframe.market is unreachable: {d}"),
            MarketError::Unexpected(d) => write!(f, "warframe.market answered with something MyOrbiter couldn't read: {d}"),
            MarketError::Storage(d) => write!(f, "couldn't keep the warframe.market sign-in: {d}"),
            MarketError::Deferred(at) => write!(f, "warframe.market asked us to wait until {at}"),
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
    /// warframe.market turns away for going too fast is tried again after the wait it asked for
    /// (with_retries); a change isn't: it may have gone through.
    fn send(&self, method: &str, url: &str, body: Option<&Value>, token: Option<&str>) -> Result<(Value, Option<String>), MarketError> {
        let contract = is_contract(url);
        let result = if method == "GET" {
            with_retries(|| {
                if contract {
                    contract_turn();
                }
                self.send_once(method, url, body, token)
            })
        } else {
            // A change waits for warframe.market's deadline like a read (or isn't sent, deferred),
            // but is sent once: turned away, it isn't tried again on its own.
            write_turn();
            if contract {
                contract_turn();
            }
            deadline_turn().and_then(|()| self.send_once(method, url, body, token))
        };
        // The log: every change, and every request that failed (method and path, never the sign-in).
        match &result {
            Ok(_) if method != "GET" => log::info!(target: "myorbiter::market", "{method} {}: ok", log_path(url)),
            Ok(_) => {}
            Err(e) => log::warn!(target: "myorbiter::market", "{method} {}: {e}", log_path(url)),
        }
        result
    }

    fn send_once(&self, method: &str, url: &str, body: Option<&Value>, token: Option<&str>) -> Result<(Value, Option<String>), MarketError> {
        wait_turn(is_contract(url))?;
        let mut req = request(method, url)
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
                let value = serde_json::from_str(&text).map_err(|e| MarketError::Unexpected(e.to_string()))?;
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
        deadline_turn()?;
        wait_turn(false)?;
        let resp = request("POST", &format!("{V1}/auth/signin"))
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
        serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unexpected(e.to_string()))
    }

    /// Every visible order on an item, both sides, with each seller's status.
    pub fn order_book(&self, slug: &str) -> Result<Vec<BookOrder>, MarketError> {
        if slug.is_empty() || !slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err(MarketError::Rejected("bad item".into()));
        }
        let v = self.call("GET", &format!("{V2}/orders/item/{slug}"), None, false)?;
        serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unexpected(e.to_string()))
    }

    /// A player's public warframe.market profile, by their in-game name (the market's names are
    /// the game's), or None when nobody on warframe.market has that name.
    pub fn user(&self, name: &str) -> Result<Option<MarketUser>, MarketError> {
        let slug = user_slug(name).ok_or_else(|| MarketError::Rejected("bad name".into()))?;
        match self.call("GET", &format!("{V2}/user/{slug}"), None, false) {
            Ok(v) => serde_json::from_value(v["data"].clone()).map(Some).map_err(|e| MarketError::Unexpected(e.to_string())),
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
        let order: Order = serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unexpected(e.to_string()))?;
        // What went up, beside the request line: the window logs why ("[listing]" lines).
        log::info!(target: "myorbiter::market", "{}", created_line(&order.id, new, kind));
        Ok(order)
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
        self.call("PATCH", &format!("{V2}/order/{id}"), Some(&Value::Object(body)), true)?;
        log::info!(target: "myorbiter::market", "{}", changed_line(id, change));
        Ok(())
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

/// "order abc created: sell item 5dbe… rank 0, 2 at 7p, shown".
fn created_line(id: &str, new: &NewOrder, kind: &str) -> String {
    let rank = new.rank.map_or(String::new(), |r| format!(" rank {r}"));
    let subtype = new.subtype.as_deref().map_or(String::new(), |s| format!(" ({s})"));
    format!(
        "order {id} created: {kind} item {}{rank}{subtype}, {} at {}p, {}",
        new.item_id,
        new.quantity,
        new.platinum,
        if new.visible { "shown" } else { "hidden" }
    )
}

/// "order abc changed: quantity 3, shown".
fn changed_line(id: &str, change: &OrderChange) -> String {
    let mut parts = Vec::new();
    if let Some(p) = change.platinum {
        parts.push(format!("{p}p"));
    }
    if let Some(q) = change.quantity {
        parts.push(format!("quantity {q}"));
    }
    if let Some(v) = change.visible {
        parts.push(if v { "shown".to_string() } else { "hidden".to_string() });
    }
    format!("order {id} changed: {}", parts.join(", "))
}

fn profile_of(v: Value) -> Result<Profile, MarketError> {
    serde_json::from_value(v["data"].clone()).map_err(|e| MarketError::Unexpected(e.to_string()))
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
                // A rank or quantity that doesn't fit, or a price that isn't one, is no sale: the
                // order is left out rather than imported as a wrong one.
                rank: match o["mod_rank"].as_u64() {
                    Some(r) => Some(u32::try_from(r).ok().filter(|r| *r <= 30)?),
                    None => None,
                },
                quantity: u32::try_from(o["quantity"].as_u64().unwrap_or(1)).ok().filter(|q| (1..=10_000).contains(q))?,
                platinum: o["platinum"].as_f64().filter(|p| p.is_finite() && *p > 0.0 && *p <= 10_000_000.0)?,
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
    // Starting with a letter or digit: "." or ".." would turn the profile URL into another path.
    let ok = !name.is_empty() && name.len() <= 40 && name.starts_with(|c: char| c.is_ascii_alphanumeric()) && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
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
    /// The least a seller of a bulk item trades at once; the site's whisper names it ("x10").
    #[serde(default)]
    pub per_trade: Option<u32>,
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
 * MyOrbiter always gives: one per trade, so a buyer can take any number, and no stars, since
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

/// warframe.market's thumbnail for an item, as MyOrbiter's image cache names it ("wfm." and the file
/// name): only plain names under its thumbnail folder, else null.
fn thumb_name(v: &Value) -> Value {
    v.as_str()
        .and_then(|t| t.strip_prefix("items/images/en/thumbs/"))
        .filter(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'(' | b')')))
        .map_or(Value::Null, |f| Value::String(format!("wfm.{f}")))
}

/// `/v2/items`, trimmed to what MyOrbiter needs and cached for a day.
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
    /// no v2 equivalent yet). Trimmed to what MyOrbiter shows.
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
    fn a_listing_made_or_changed_is_logged_with_what_went_up() {
        let new = super::NewOrder { item_id: "5dbe9b097ea27b0ffe3ca26c".into(), platinum: 7, quantity: 2, rank: Some(0), subtype: None, visible: true, kind: None };
        assert_eq!(super::created_line("abc", &new, "sell"), "order abc created: sell item 5dbe9b097ea27b0ffe3ca26c rank 0, 2 at 7p, shown");
        let change = super::OrderChange { platinum: None, quantity: Some(3), visible: Some(true) };
        assert_eq!(super::changed_line("abc", &change), "order abc changed: quantity 3, shown");
    }

    #[test]
    fn a_reply_that_isnt_what_was_asked_for_is_unexpected_not_unreachable() {
        // A whole reply that isn't JSON (a block page served as 200), read as get_json reads one.
        let page = ureq::Response::new(200, "OK", "<html>checking your browser</html>").unwrap();
        assert!(matches!(json_body(page.into_reader()), Err(MarketError::Unexpected(_))));
        // A whole reply that stops halfway through its JSON: what was sent isn't JSON.
        assert!(matches!(json_body(&b"{\"data\":["[..]), Err(MarketError::Unexpected(_))));
        // A connection that drops while the body is read: the network, not the reply.
        struct Drops(bool);
        impl std::io::Read for Drops {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if std::mem::replace(&mut self.0, true) {
                    return Err(std::io::Error::new(std::io::ErrorKind::ConnectionReset, "reset"));
                }
                buf[..9].copy_from_slice(b"{\"data\":[");
                Ok(9)
            }
        }
        assert!(matches!(json_body(Drops(false)), Err(MarketError::Unreachable(_))));
        assert!(matches!(json_body(&b"{\"data\":[]}"[..]), Ok(_)));
        // A whole body that isn't UTF-8 (a page in another encoding): the reply, not the network.
        assert!(matches!(json_body(&b"\xff\xfe<html>"[..]), Err(MarketError::Unexpected(_))));
        // JSON, but not a profile.
        let e = profile_of(serde_json::json!({ "data": { "nothing": "like a profile" } })).unwrap_err();
        assert!(matches!(e, MarketError::Unexpected(_)));
        assert!(e.to_string().starts_with("warframe.market answered with something MyOrbiter couldn't read"));
    }

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
    fn changes_are_capped_at_120_a_minute_and_a_plan_of_100_still_finishes_within_it() {
        use std::collections::VecDeque;
        assert_eq!(WRITES_PER_MINUTE, 120);
        // A plan of 100 changes, MIN_GAP apart as the queue sends them: none waits, all in 40 s.
        let start = Instant::now();
        let mut sent = VecDeque::new();
        let mut at = start;
        for _ in 0..100 {
            assert_eq!(write_wait(&sent, at), Duration::ZERO);
            sent.push_back(at);
            at += MIN_GAP;
        }
        assert!(at - start < Duration::from_secs(60));
        // A burst past the cap: the 121st waits until the first is a minute old, and the minute
        // never holds more than 120.
        let mut sent: VecDeque<Instant> = (0..120).map(|i| start + Duration::from_millis(100 * i)).collect();
        let now = start + Duration::from_secs(13);
        assert_eq!(write_wait(&sent, now), Duration::from_secs(47));
        let next = now + write_wait(&sent, now);
        sent.pop_front();
        sent.push_back(next);
        assert_eq!(sent.iter().filter(|t| next.saturating_duration_since(**t) < WRITE_WINDOW).count(), 120);
        // A minute after the first, room again for one more: the second's turn.
        assert_eq!(write_wait(&sent, next), Duration::from_millis(100));
    }


    #[test]
    fn contract_requests_share_ten_a_minute_queued_in_order() {
        use std::collections::VecDeque;
        assert_eq!(CONTRACTS_PER_MINUTE, 10);
        let start = Instant::now();
        let mut slots = VecDeque::new();
        // Ten at once go at once (a page of price checks starts without waiting).
        for _ in 0..10 {
            assert_eq!(contract_slot(&mut slots, start), Duration::ZERO);
        }
        // The eleventh and twelfth queue for the first and second slots to leave the window, in
        // the order they asked; none is dropped.
        let w11 = contract_slot(&mut slots, start + Duration::from_secs(1));
        let w12 = contract_slot(&mut slots, start + Duration::from_secs(1));
        assert_eq!(w11, CONTRACT_WINDOW - Duration::from_secs(1));
        assert_eq!(w12, CONTRACT_WINDOW - Duration::from_secs(1));
        assert_eq!(slots.len(), 12);
        // Ten more at once a little later: queued behind those, ten of them a window after the
        // last ten's slots, never more than ten in any window.
        let mut at = Vec::new();
        for _ in 0..10 {
            let now = start + Duration::from_secs(2);
            at.push(now + contract_slot(&mut slots, now));
        }
        assert!(at.windows(2).all(|w| w[0] <= w[1]), "in the order they asked");
        let all: Vec<Instant> = slots.iter().copied().collect();
        for (i, a) in all.iter().enumerate() {
            let inside = all[i..].iter().filter(|b| b.saturating_duration_since(*a) < CONTRACT_WINDOW).count();
            assert!(inside <= CONTRACTS_PER_MINUTE, "{inside} in the window from slot {i}");
        }
        // Once a window has passed with nothing asked, slots are free again and the old ones go.
        let later = *all.last().unwrap() + CONTRACT_WINDOW;
        assert_eq!(contract_slot(&mut slots, later), Duration::ZERO);
        assert_eq!(slots.len(), 1);
        // The general gate is apart from it: 400 ms between any two requests.
        assert_eq!(MIN_GAP, Duration::from_millis(400));
    }

    #[test]
    fn retry_after_is_honoured_in_full_by_every_request() {
        let now = Instant::now();
        // A 429 asking for 120 s: nothing goes for 120 s, however long that is (no 10 s cap).
        let until = hold_off(None, now, retry_after_secs(Some(" 120 ")));
        assert_eq!(until, now + Duration::from_secs(120));
        // One deadline, only ever later: a shorter Retry-After after it doesn't bring it forward.
        assert_eq!(hold_off(Some(until), now + Duration::from_secs(1), Some(Duration::from_secs(5))), until);
        assert_eq!(hold_off(Some(until), now, Some(Duration::from_secs(300))), now + Duration::from_secs(300));
        // A Retry-After that isn't a number of seconds counts as not said: the default minute.
        assert_eq!(retry_after_secs(Some("Wed, 21 Oct 2026 07:28:00 GMT")), None);
        assert_eq!(hold_off(None, now, None), now + DEFAULT_RETRY_AFTER);
        // A request far from the deadline isn't sent: deferred to it, not retried early.
        assert_eq!(deadline_wait(Some(until), now), Err(until));
        assert_eq!(deadline_wait(Some(until), now + Duration::from_secs(100)), Err(until));
        // Near it, it waits the rest, and at or after it goes at once.
        assert_eq!(deadline_wait(Some(until), now + Duration::from_secs(112)), Ok(Duration::from_secs(8)));
        assert_eq!(deadline_wait(Some(until), until), Ok(Duration::ZERO));
        assert_eq!(deadline_wait(Some(until), until + Duration::from_secs(5)), Ok(Duration::ZERO));
        assert_eq!(deadline_wait(None, now), Ok(Duration::ZERO));
        assert_eq!(MAX_WAIT, Duration::from_secs(10));
        // An absurd Retry-After doesn't overflow: a day at most.
        assert_eq!(hold_off(None, now, retry_after_secs(Some("18446744073709551615"))), now + MAX_RETRY_AFTER);
    }

    #[test]
    fn a_deferred_request_says_until_when_in_words_the_page_reads() {
        // core/marketWait.ts finds the time in these words and shows it as the clock does.
        let text = MarketError::Deferred(1_794_220_000_000).to_string();
        assert_eq!(text, "warframe.market asked us to wait until 1794220000000");
        let json = serde_json::to_value(MarketError::Deferred(5)).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "deferred", "detail": 5 }));
    }

    #[test]
    fn contract_requests_are_told_by_their_path() {
        assert!(is_contract(&format!("{V1}/auctions/search?type=riven&weapon_url_name=rubico")));
        assert!(is_contract(&format!("{V1}/profile/auctions")));
        assert!(is_contract(&format!("{V1}/auctions/create")));
        assert!(is_contract(&format!("{V1}/auctions/entry/abc/close")));
        assert!(!is_contract(&format!("{V2}/orders/item/serration")));
        assert!(!is_contract(&format!("{V2}/riven/weapons")));
        assert!(!is_contract(&format!("{V2}/me")));
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

    /// warframe.market's rules ask every client to name itself: each way MyOrbiter reaches it
    /// (plain reads, signed-in calls and changes, the socket) carries the User-Agent. Against a
    /// server on this machine; nothing is sent to warframe.market.
    #[test]
    fn every_warframe_market_request_names_myorbiter() {
        let ua = Some(crate::user_agent());
        assert!(crate::user_agent().starts_with("MyOrbiter/") && crate::user_agent().ends_with(" (+https://github.com/ShezissSnake/myorbiter)"));

        let (addr, served) = crate::test_http::serve_once("{}");
        get_json(&format!("{addr}/v2/items"), 10).expect("read");
        let head = served.join().unwrap();
        assert_eq!(crate::test_http::header(&head, "user-agent"), ua, "{head}");

        let client = Client::offline();
        for method in ["GET", "PATCH"] {
            let (addr, served) = crate::test_http::serve_once("{}");
            let body = (method != "GET").then(|| serde_json::json!({ "platinum": 7 }));
            client.send(method, &format!("{addr}/v2/order/abc"), body.as_ref(), Some("token")).expect("answered");
            let head = served.join().unwrap();
            assert!(head.starts_with(&format!("{method} /v2/order/abc ")), "{head}");
            assert_eq!(crate::test_http::header(&head, "user-agent"), ua, "{method}: {head}");
        }

        let socket = socket_request().unwrap();
        assert_eq!(socket.uri().host(), Some("ws.warframe.market"));
        assert_eq!(socket.headers().get("User-Agent").and_then(|v| v.to_str().ok()).map(str::to_string), ua);
        assert_eq!(socket.headers().get("Sec-WebSocket-Protocol").and_then(|v| v.to_str().ok()), Some("wfm"));
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
        let dir = std::env::temp_dir().join(format!("myorbiter-renew-{}", std::process::id()));
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
        let dir = std::env::temp_dir().join(format!("myorbiter-token-{}", std::process::id()));
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

    /// Hits the network: `cargo test -p myorbiter -- --ignored`.
    #[test]
    #[ignore]
    fn fetches_a_live_order_book() {
        let c = Client::offline();
        let book = c.order_book("serration").expect("book");
        assert!(book.iter().any(|o| o.kind == "sell"));
    }
}

/// Fuzzing warframe.market's answers: random JSON, and real shapes with fields swapped for
/// junk, through every parser. Never a panic; a closed order (a sale MyOrbiter would import) only
/// with a real id, item, quantity and price.
#[cfg(test)]
mod fuzz {
    use super::*;
    use serde_json::json;

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

    fn junk(r: &mut Rng, depth: u32) -> Value {
        match r.below(if depth > 2 { 6 } else { 9 }) {
            0 => Value::Null,
            1 => json!(r.below(2) == 0),
            2 => json!([-1i64, 0, 1, 7, i64::MAX, i64::MIN][r.below(6)]),
            3 => json!([u64::MAX, 4_294_967_297u64, 1u64 << 40][r.below(3)]),
            4 => json!([0.5, -3.5, 1e308, -1e308, 1e-300][r.below(5)]),
            5 => json!(["", "x", "2026-10-27T09:00:00+00:00", "aaaaaaaaaaaaaaaaaaaaaaaa", "\u{202E}", "1e9", "-1"][r.below(7)]),
            6 => Value::Array((0..r.below(4)).map(|_| junk(r, depth + 1)).collect()),
            _ => {
                let keys = ["payload", "data", "closed_orders", "statistics_closed", "90days", "chats", "own_review", "item", "id", "quantity", "platinum", "messages"];
                Value::Object((0..r.below(5)).map(|_| (keys[r.below(keys.len())].to_string(), junk(r, depth + 1))).collect())
            }
        }
    }

    /// A real-looking answer with some of its fields swapped for junk.
    fn shaped(r: &mut Rng) -> Value {
        let mut v = json!({"payload": {
            "closed_orders": [{"id": "c1", "order_type": "sell", "quantity": 2, "platinum": 15, "mod_rank": 0, "closed_date": "2026-10-27T09:00:00+00:00", "item": {"url_name": "khra", "en": {"item_name": "Khra"}}}],
            "statistics_closed": {"90days": [{"datetime": "2026-10-27T00:00:00+00:00", "median": 9, "volume": 30, "min_price": 5, "max_price": 12, "mod_rank": 0}]},
            "chats": [{"id": "c1", "chat_name": "Tenno_Alpha", "unread_count": 1, "last_update": "2026-10-27T09:00:00+00:00", "messages": [{"send_date": "x", "raw_message": "hi"}]}],
            "own_review": {"review_type": 1}
        }, "data": {"id": "u1", "ingame_name": "ExamplePlayer", "slug": "exampleplayer"}});
        let spots = [
            "/payload/closed_orders/0/quantity",
            "/payload/closed_orders/0/platinum",
            "/payload/closed_orders/0/mod_rank",
            "/payload/statistics_closed/90days/0/volume",
            "/payload/chats/0/messages",
            "/data",
        ];
        for _ in 0..r.below(6) {
            let at = spots[r.below(spots.len())];
            let j = junk(r, 0);
            if let Some(spot) = v.pointer_mut(at) {
                *spot = j;
            }
        }
        v
    }

    #[test]
    fn random_answers_never_panic_and_never_make_a_wrong_sale() {
        for seed in 0..3000u64 {
            let mut r = Rng(0x5EED_0000 + seed * 7919);
            let v = if r.below(2) == 0 { junk(&mut r, 0) } else { shaped(&mut r) };
            for o in parse_closed_orders(&v) {
                assert!(!o.id.is_empty() && !o.slug.is_empty(), "seed {seed}: {o:?}");
                assert!((1..=10_000).contains(&o.quantity), "seed {seed}: quantity {}", o.quantity);
                assert!(o.platinum.is_finite() && o.platinum > 0.0, "seed {seed}: platinum {}", o.platinum);
                assert!(o.rank.map_or(true, |x| x <= 30), "seed {seed}: rank {:?}", o.rank);
            }
            let _ = parse_history(&v);
            let _ = parse_chats(&v);
            let _ = own_review_type(&v);
            let _ = profile_of(v.clone());
            let _ = check_auction(&v);
            let text = v.to_string();
            let _ = forbidden_means_signed_out(&text);
            let _ = needs_per_trade(&text);
            let _ = needs_stars(&text);
            let _ = token_from_header(&text);
            if let Some(s) = user_slug(&text) {
                assert!(s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-' | '.')), "seed {seed}: slug {s}");
            }
        }
    }
}

#[cfg(test)]
mod slug_tests {
    use super::user_slug;

    #[test]
    fn a_name_of_dots_is_no_name() {
        for bad in [".", "..", "...", ".hidden", "-x", "_x", "a/b", "a b", ""] {
            assert_eq!(user_slug(bad), None, "{bad:?}");
        }
        assert_eq!(user_slug("Tenno_Alpha"), Some("tenno_alpha".into()));
        assert_eq!(user_slug("x.y-z"), Some("x.y-z".into()));
    }
}
