//! Your status on warframe.market: invisible, online, or online in game.
//!
//! warframe.market keeps status on a WebSocket, not as a setting: a client connects, signs in with
//! the account's token and says which status it holds, and the status lasts as long as that
//! connection. When the last connection closes, the account shows as offline (and its listings
//! are hidden from buyers). So MyOrbiter holds one connection open while you have a status chosen,
//! reconnects when it drops, and closes it when you quit.
//!
//! TennoScope can hold its own connection for the same account. While MyOrbiter holds yours it
//! writes `orbiter-presence.json` to the shared runtime folder every few seconds; a TennoScope
//! with MyOrbiter's patch sees it, closes its own connection and refuses status changes, so the
//! two never fight over what buyers see.

use serde::Serialize;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The heartbeat TennoScope's patch reads (see the module docs).
pub const HELD_FILE: &str = "orbiter-presence.json";
const HEARTBEAT: Duration = Duration::from_secs(4);
/// Say the status again now and then: if another client set a different one, this puts yours back.
const REASSERT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Online,
    Ingame,
    Invisible,
}

impl Status {
    pub fn wire(self) -> &'static str {
        match self {
            Status::Online => "online",
            Status::Ingame => "ingame",
            Status::Invisible => "invisible",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "online" => Some(Status::Online),
            "ingame" => Some(Status::Ingame),
            "invisible" => Some(Status::Invisible),
            _ => None,
        }
    }
}

/// What the page shows.
#[derive(Clone, Debug, Default, Serialize)]
pub struct State {
    /// What you chose; `None`: no connection held (offline, as far as MyOrbiter is concerned).
    pub wanted: Option<Status>,
    /// What warframe.market confirmed, which is what buyers see.
    pub committed: Option<Status>,
    pub connected: bool,
    /// The last problem, in words, until the next success.
    pub error: Option<String>,
}

enum Cmd {
    Set(Status),
    Close,
}

/// The connection being held: how to reach its thread, and the state only it writes.
struct Link {
    tx: Sender<Cmd>,
    state: Arc<Mutex<State>>,
}

/// What `hold` asks each time it (re)connects: warframe.market renews the token as the API is
/// used, so the one from when the status was chosen may have been replaced since.
pub type TokenSource = Box<dyn Fn() -> Option<String> + Send>;

#[derive(Default)]
pub struct Presence {
    /// Each connection gets a state of its own: a thread that is closing can still write to its
    /// old one, but nobody reads that any more, so it can't undo a close or a newer connection.
    link: Mutex<Option<Link>>,
}

/// The connection allowed to write (and remove) the heartbeat file; 0: none. A connection that is
/// still winding down must not remove the file a newer one just wrote.
static ACTIVE: AtomicU64 = AtomicU64::new(0);
static NEXT: AtomicU64 = AtomicU64::new(1);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Presence {
    pub fn state(&self) -> State {
        match lock(&self.link).as_ref() {
            Some(link) => lock(&link.state).clone(),
            None => State::default(),
        }
    }

    /// Hold `status`, opening the connection if there isn't one. `token` is asked when it
    /// connects, and again on each reconnect.
    pub fn set(&self, status: Status, token: impl Fn() -> Option<String> + Send + 'static) -> Result<(), String> {
        if let Some(l) = lock(&self.link).as_ref() {
            if l.tx.send(Cmd::Set(status)).is_ok() {
                lock(&l.state).wanted = Some(status);
                return Ok(());
            }
        }
        // Not under the lock: the token may come from the keyring (D-Bus, perhaps an unlock
        // prompt), and the page reads `state` from the main thread meanwhile. Two sets racing
        // here both connect; the one replaced below sees its channel drop and closes.
        let first = token().ok_or("Sign in to warframe.market first (on Orders).")?;
        let mut link = lock(&self.link);
        let (tx, rx) = channel();
        let state = Arc::new(Mutex::new(State { wanted: Some(status), ..State::default() }));
        let shared = Arc::clone(&state);
        let source: TokenSource = Box::new(token);
        let id = NEXT.fetch_add(1, Ordering::SeqCst);
        ACTIVE.store(id, Ordering::SeqCst);
        std::thread::spawn(move || hold(id, first, source, status, rx, shared));
        *link = Some(Link { tx, state });
        Ok(())
    }

    /// Close the connection: warframe.market then shows you offline.
    pub fn close(&self) {
        let mut link = lock(&self.link);
        if let Some(l) = link.take() {
            let _ = l.tx.send(Cmd::Close);
        }
        ACTIVE.store(0, Ordering::SeqCst);
        clear_heartbeat_file();
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn write_heartbeat(id: u64, status: Status) {
    if ACTIVE.load(Ordering::SeqCst) != id {
        return;
    }
    let Some(dir) = crate::bridge::runtime_dir() else { return };
    let body = serde_json::json!({ "at": now_ms(), "pid": std::process::id(), "status": status.wire() });
    let tmp = dir.join(format!(".{HELD_FILE}.{}", std::process::id()));
    if std::fs::write(&tmp, body.to_string()).is_ok() {
        let _ = crate::rename_replacing(&tmp, &dir.join(HELD_FILE));
    }
}

/// Removes the heartbeat if connection `id` is still the one holding it.
fn clear_heartbeat(id: u64) {
    if ACTIVE.compare_exchange(id, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        clear_heartbeat_file();
    }
}

fn clear_heartbeat_file() {
    if let Some(dir) = crate::bridge::runtime_dir() {
        let _ = std::fs::remove_file(dir.join(HELD_FILE));
    }
}

fn frame(route: &str, payload: serde_json::Value) -> String {
    serde_json::json!({ "route": route, "payload": payload }).to_string()
}

/// A frame's route and, for status frames, the status it carries.
fn read_frame(text: &str) -> (Option<String>, Option<Status>) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return (None, None) };
    let route = v.get("route").and_then(|r| r.as_str()).map(str::to_owned);
    let status = match route.as_deref() {
        Some("@wfm|cmd/status/set:ok") | Some("@wfm|event/status/set") => {
            let p = v.get("payload");
            // Seen both as the bare string and as {"status": "..."}.
            p.and_then(|p| p.as_str()).or_else(|| p?.get("status")?.as_str()).and_then(Status::parse)
        }
        _ => None,
    };
    (route, status)
}

enum Ended {
    /// Closed on purpose (you went offline or quit), or the token was refused: don't reconnect.
    Done,
    /// Dropped or failed: reconnect.
    Dropped(String),
}

/// A ping this often, so a connection that died without a word (sleep, Wi-Fi drop) is noticed.
const PING_EVERY: Duration = Duration::from_secs(30);
/// Nothing at all from the server for this long: the connection is gone, reconnect.
const SILENT_FOR: Duration = Duration::from_secs(75);

/// The connection's thread: connect, hold, and reconnect with growing pauses until told to close.
fn hold(id: u64, first: String, token: TokenSource, initial: Status, rx: Receiver<Cmd>, state: Arc<Mutex<State>>) {
    let mut wanted = initial;
    let mut pause = Duration::from_secs(2);
    let mut current = Some(first);
    loop {
        let began = Instant::now();
        // Signed out meanwhile: nothing to sign in with, so stop.
        let Some(t) = current.take().or_else(&token) else {
            if let Ok(mut s) = state.lock() {
                *s = State { error: Some("Signed out of warframe.market.".into()), ..State::default() };
            }
            break;
        };
        match session(id, &t, &mut wanted, &rx, &state) {
            Ended::Done => break,
            Ended::Dropped(why) => {
                log::warn!(target: "myorbiter::presence", "{why}");
                // A connection that held for a while was a good one: start the waits over.
                if began.elapsed() > Duration::from_secs(60) {
                    pause = Duration::from_secs(2);
                }
                if let Ok(mut s) = state.lock() {
                    s.connected = false;
                    s.committed = None;
                    s.error = Some(why);
                }
            }
        }
        // Wait out the pause, but a close (or a new choice) still gets through.
        match rx.recv_timeout(pause) {
            Ok(Cmd::Close) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(Cmd::Set(s)) => wanted = s,
            Err(RecvTimeoutError::Timeout) => {}
        }
        pause = (pause * 2).min(Duration::from_secs(60));
    }
    clear_heartbeat(id);
}

/// How MyOrbiter reaches the network: straight, or through the proxy set in the environment. One
/// choice for the HTTP agent (`http_agent` in lib.rs) and the sockets, so they can't differ: from
/// ALL_PROXY, HTTPS_PROXY and HTTP_PROXY, upper case then lower (ureq's order); NO_PROXY isn't read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    Direct,
    /// An HTTP proxy, asked for a tunnel (CONNECT), with `user:password` if the address gives them.
    Http { host: String, port: u16, login: Option<String> },
    /// A proxy set that MyOrbiter can't use: nothing is sent, neither through it nor around it.
    /// The reason, as the log and the page give it (`unusable`).
    Unusable(String),
}

const PROXY_VARS: [&str; 6] = ["ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

/// Why an address set can't be used: a few fixed words, never the address itself (it may carry a
/// login).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Unfit {
    Https,
    Socks,
    NoPassword,
    Unreadable,
}

/// The reason a route stops on: the variable, what it holds, and what works instead.
fn unusable(name: &str, unfit: Unfit) -> String {
    let what = match unfit {
        Unfit::Https => "an https:// proxy",
        Unfit::Socks => "a SOCKS proxy",
        Unfit::NoPassword => "a proxy address with a user name but no password",
        Unfit::Unreadable => "an address MyOrbiter can't read as a proxy",
    };
    format!(
        "{name} is set to {what}, so MyOrbiter sends nothing: only an http:// proxy works (http://host:port, with user:password@ before the host if it asks for a sign-in). Change or remove {name}, then start MyOrbiter again."
    )
}

/// One address read as an HTTP proxy, or why it can't be used.
fn read_proxy(value: &str) -> Result<Route, Unfit> {
    let (scheme, rest) = match value.split_once("://") {
        Some((s, r)) => (Some(s.to_ascii_lowercase()), r),
        None => (None, value),
    };
    match scheme.as_deref() {
        None | Some("http") => {}
        Some("https") => return Err(Unfit::Https),
        Some("socks" | "socks4" | "socks4a" | "socks5" | "socks5h") => return Err(Unfit::Socks),
        Some(_) => return Err(Unfit::Unreadable),
    }
    let rest = rest.trim_end_matches('/');
    let (login, address) = match rest.rsplit_once('@') {
        // ureq sends a login only as `user:password`.
        Some((l, _)) if !l.contains(':') => return Err(Unfit::NoPassword),
        Some((l, a)) => (Some(l.to_string()), a),
        None => (None, rest),
    };
    let (host, port) = match address.split_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| Unfit::Unreadable)?),
        None => (address, 80),
    };
    if host.is_empty() || port == 0 || !host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return Err(Unfit::Unreadable);
    }
    Ok(Route::Http { host: host.to_string(), port, login })
}

/// The route from the environment's variables (`var` reads one; an empty value counts as not
/// set). The first usable HTTP proxy, as ureq took it before; a SOCKS one stops there, as it
/// did. Any other address set that can't be used (https://, one that doesn't read) is passed over
/// for a usable one that follows, but never for going straight: with none, the route stops on
/// the first.
pub(crate) fn route_from(var: impl Fn(&str) -> Option<String>) -> Route {
    let mut first_unfit = None;
    for name in PROXY_VARS {
        let Some(value) = var(name) else { continue };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match read_proxy(value) {
            Ok(route) => return route,
            Err(Unfit::Socks) => return Route::Unusable(unusable(name, Unfit::Socks)),
            Err(unfit) => {
                first_unfit.get_or_insert((name, unfit));
            }
        }
    }
    first_unfit.map_or(Route::Direct, |(name, unfit)| Route::Unusable(unusable(name, unfit)))
}

/// The route as the environment had it at start: the HTTP agent's and the sockets'.
pub(crate) fn route() -> Route {
    static ROUTE: std::sync::OnceLock<Route> = std::sync::OnceLock::new();
    // A value that isn't Unicode is set all the same: read as one that can't be used ("\0" never
    // reads as an address), not as none.
    ROUTE.get_or_init(|| route_from(|name| std::env::var_os(name).map(|v| v.into_string().unwrap_or_else(|_| "\0".into())))).clone()
}

/// Opens a WebSocket with time limits: `tungstenite::connect` has none, so a connection or TLS
/// handshake that never answers (a captive portal, a stuck proxy) would hang its thread for good.
/// Through the proxy, when one is set (`route`).
pub(crate) fn connect(
    request: tungstenite::handshake::client::Request,
) -> Result<tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>, tungstenite::Error> {
    connect_by(request, &route())
}

const LIMIT: Duration = Duration::from_secs(10);

/// A TCP connection to `host`, its time limits set.
fn reach(host: &str, port: u16) -> std::io::Result<std::net::TcpStream> {
    use std::net::{TcpStream, ToSocketAddrs};
    let mut last = std::io::Error::new(std::io::ErrorKind::NotFound, format!("no address for {host}"));
    for addr in (host, port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, LIMIT) {
            Ok(s) => {
                s.set_read_timeout(Some(LIMIT))?;
                s.set_write_timeout(Some(LIMIT))?;
                return Ok(s);
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Asks the proxy on `stream` for a tunnel to `target` (`host:port`, the name as given: the proxy
/// looks it up). The answer is read a byte at a time, so nothing of what follows it is taken.
fn tunnel(stream: &mut std::net::TcpStream, target: &str, agent: Option<&str>, login: Option<&str>) -> std::io::Result<()> {
    use base64::Engine;
    use std::io::{Error, ErrorKind, Read, Write};
    let mut ask = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some(a) = agent {
        ask.push_str(&format!("User-Agent: {a}\r\n"));
    }
    if let Some(l) = login {
        ask.push_str(&format!("Proxy-Authorization: Basic {}\r\n", base64::engine::general_purpose::STANDARD.encode(l)));
    }
    ask.push_str("\r\n");
    stream.write_all(ask.as_bytes())?;
    stream.flush()?;
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 8192 || stream.read(&mut byte)? == 0 {
            return Err(Error::new(ErrorKind::InvalidData, "the proxy's answer ended early"));
        }
        head.push(byte[0]);
    }
    let line = String::from_utf8_lossy(&head);
    let status = line.split_whitespace().nth(1).unwrap_or("?");
    if status != "200" {
        return Err(Error::other(format!("the proxy refused the connection ({status})")));
    }
    Ok(())
}

/// `connect` by the given route.
pub(crate) fn connect_by(
    request: tungstenite::handshake::client::Request,
    route: &Route,
) -> Result<tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>, tungstenite::Error> {
    let uri = request.uri();
    let host = uri.host().unwrap_or_default().to_string();
    let port = uri.port_u16().unwrap_or(if uri.scheme_str() == Some("ws") { 80 } else { 443 });
    let stream = match route {
        Route::Direct => reach(&host, port)?,
        Route::Http { host: proxy, port: proxy_port, login } => {
            let mut s = reach(proxy, *proxy_port)?;
            let agent = request.headers().get(tungstenite::http::header::USER_AGENT).and_then(|v| v.to_str().ok());
            tunnel(&mut s, &format!("{host}:{port}"), agent, login.as_deref())?;
            s
        }
        Route::Unusable(why) => return Err(tungstenite::Error::Io(std::io::Error::new(std::io::ErrorKind::Unsupported, why.clone()))),
    };
    match tungstenite::client_tls_with_config(request, stream, None, None) {
        Ok((ws, _)) => Ok(ws),
        Err(tungstenite::HandshakeError::Failure(e)) => Err(e),
        // A read timed out mid-handshake.
        Err(tungstenite::HandshakeError::Interrupted(_)) => Err(tungstenite::Error::Io(std::io::Error::new(std::io::ErrorKind::TimedOut, "the handshake timed out"))),
    }
}

fn session(id: u64, token: &str, wanted: &mut Status, rx: &Receiver<Cmd>, state: &Mutex<State>) -> Ended {
    use tungstenite::Message;
    let _ = rustls::crypto::ring::default_provider().install_default();
    // The same name MyOrbiter gives on the API (market::socket_request).
    let request = match crate::market::socket_request() {
        Ok(r) => r,
        Err(e) => return Ended::Dropped(e.to_string()),
    };
    let mut ws = match connect(request) {
        Ok(c) => c,
        Err(tungstenite::Error::Http(resp)) if resp.status().as_u16() == 403 => {
            return Ended::Dropped("warframe.market turned the status connection away (403 Forbidden); trying again".into())
        }
        Err(e) => return Ended::Dropped(format!("Couldn't reach warframe.market ({e}); trying again")),
    };
    // Reads wait at most a second, so a choice or a close is never stuck behind a quiet socket.
    if let tungstenite::stream::MaybeTlsStream::Rustls(s) = ws.get_mut() {
        let _ = s.sock.set_read_timeout(Some(Duration::from_secs(1)));
    }
    let send = |ws: &mut tungstenite::WebSocket<_>, text: String| ws.send(Message::Text(text.into())).map_err(|e| e.to_string());
    if let Err(e) = send(&mut ws, frame("@wfm|cmd/auth/signIn", serde_json::json!({ "token": token }))) {
        return Ended::Dropped(e);
    }

    let mut signed_in = false;
    let mut heard = Instant::now();
    let mut pinged = Instant::now();
    // The server said no to a status (set:error): don't keep asking every few seconds.
    let mut refused: Option<Status> = None;
    let mut last_sent: Option<Instant> = None;
    // Changed from elsewhere again and again (the website, another app holding it too): after the
    // third time in ten minutes, MyOrbiter stops putting it back for ten minutes rather than fight.
    let mut overrides: Vec<Instant> = Vec::new();
    let mut hold_until: Option<Instant> = None;
    // None: the first heartbeat goes out at once. Not `now - HEARTBEAT`: on Windows an Instant counts
    // from boot, and a subtraction that goes below it panics (and a panic closes the app).
    let mut last_beat: Option<Instant> = None;
    loop {
        // Your choices first.
        loop {
            match rx.try_recv() {
                Ok(Cmd::Set(s)) => {
                    *wanted = s;
                    refused = None;
                    hold_until = None;
                    overrides.clear();
                    if signed_in {
                        if let Err(e) = send(&mut ws, frame("@wfm|cmd/status/set", serde_json::json!({ "status": s.wire() }))) {
                            return Ended::Dropped(e);
                        }
                        last_sent = Some(Instant::now());
                    }
                }
                Ok(Cmd::Close) | Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    let _ = ws.close(None);
                    let _ = ws.flush();
                    return Ended::Done;
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
            }
        }
        if signed_in && last_beat.is_none_or(|t| t.elapsed() >= HEARTBEAT) {
            write_heartbeat(id, *wanted);
            last_beat = Some(Instant::now());
        }
        if heard.elapsed() > SILENT_FOR {
            return Ended::Dropped("No answer from warframe.market; reconnecting".into());
        }
        if pinged.elapsed() > PING_EVERY {
            if let Err(e) = ws.send(Message::Ping(Vec::new().into())) {
                return Ended::Dropped(e.to_string());
            }
            pinged = Instant::now();
        }
        let committed = state.lock().ok().and_then(|s| s.committed);
        // Not confirmed within a few seconds, or time to say it again: (re)send it.
        let unconfirmed = committed != Some(*wanted) && refused != Some(*wanted);
        let held = hold_until.is_some_and(|t| Instant::now() < t);
        let due = !held && match last_sent {
            None => signed_in,
            Some(t) => signed_in && ((unconfirmed && t.elapsed() > Duration::from_secs(4)) || t.elapsed() > REASSERT),
        };
        if due {
            if let Err(e) = send(&mut ws, frame("@wfm|cmd/status/set", serde_json::json!({ "status": wanted.wire() }))) {
                return Ended::Dropped(e);
            }
            last_sent = Some(Instant::now());
        }
        let text = match ws.read() {
            Ok(Message::Text(t)) => {
                heard = Instant::now();
                t.to_string()
            }
            Ok(Message::Close(_)) => return Ended::Dropped("warframe.market closed the connection; reconnecting".into()),
            Ok(_) => {
                // A pong (or any other frame): the connection is alive.
                heard = Instant::now();
                continue;
            }
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return Ended::Dropped(format!("Lost the connection to warframe.market ({e}); reconnecting")),
        };
        let (route, status) = read_frame(&text);
        match route.as_deref() {
            Some("@wfm|cmd/auth/signIn:ok") => {
                signed_in = true;
                if let Ok(mut s) = state.lock() {
                    s.connected = true;
                    s.error = None;
                }
            }
            Some("@wfm|cmd/status/set:error") => {
                refused = Some(*wanted);
                if let Ok(mut s) = state.lock() {
                    s.error = Some(format!("warframe.market didn't accept the status {}", wanted.wire()));
                }
            }
            Some("@wfm|cmd/auth/signIn:error") => {
                if let Ok(mut s) = state.lock() {
                    *s = State { error: Some("warframe.market refused the sign-in. Sign out on Orders, then sign in again.".into()), ..State::default() };
                }
                let _ = ws.close(None);
                return Ended::Done;
            }
            _ => {}
        }
        if let Some(st) = status {
            let holding = hold_until.is_some_and(|t| Instant::now() < t);
            if let Ok(mut s) = state.lock() {
                s.committed = Some(st);
                s.connected = true;
                // Holding off (see `overrides`): the note saying why stays.
                if !holding {
                    s.error = None;
                }
            }
            // Someone else (another app or the website) changed it: put yours back, unless that
            // keeps happening.
            if signed_in && st != *wanted && !hold_until.is_some_and(|t| Instant::now() < t) {
                overrides.retain(|t| t.elapsed() < Duration::from_secs(600));
                overrides.push(Instant::now());
                if overrides.len() >= 3 {
                    overrides.clear();
                    hold_until = Some(Instant::now() + Duration::from_secs(600));
                    if let Ok(mut s) = state.lock() {
                        log::warn!(target: "myorbiter::presence", "something else keeps changing the status: holding off for 10 minutes");
                        s.error = Some("Something else keeps changing your warframe.market status (the website or another app), so MyOrbiter leaves it for 10 minutes. Pick a status to take it back now.".into());
                    }
                } else {
                    // Due again at once (as if never sent; not `now - REASSERT`, see last_beat).
                    last_sent = None;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hits the network: `cargo test -p myorbiter -- --ignored`. Only the handshake, no sign-in.
    #[test]
    #[ignore]
    fn connects_with_time_limits() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut ws = connect(crate::market::socket_request().unwrap()).expect("connected");
        let _ = ws.close(None);
    }

    #[test]
    fn the_sockets_take_the_proxy_the_http_agent_takes() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |name: &str| pairs.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string());
        let http = |host: &str, port: u16, login: Option<&str>| Route::Http { host: host.into(), port, login: login.map(Into::into) };
        assert_eq!(route_from(env(&[])), Route::Direct);
        assert_eq!(route_from(env(&[("HTTPS_PROXY", "http://proxy.example:3128/")])), http("proxy.example", 3128, None));
        assert_eq!(route_from(env(&[("http_proxy", "proxy.example")])), http("proxy.example", 80, None), "no scheme: http, port 80");
        assert_eq!(route_from(env(&[("ALL_PROXY", "http://user:p@ss@proxy.example:8080")])), http("proxy.example", 8080, Some("user:p@ss")));
        // In ureq's order: ALL_PROXY first, upper case before lower.
        assert_eq!(route_from(env(&[("http_proxy", "http://c:3"), ("HTTPS_PROXY", "http://b:2"), ("all_proxy", "http://a:1")])), http("a", 1, None));
        // One ureq doesn't accept is passed over, as ureq passes it over.
        assert_eq!(route_from(env(&[("ALL_PROXY", "https://tls.example:443"), ("HTTPS_PROXY", "http://b:2")])), http("b", 2, None));
        assert_eq!(route_from(env(&[("ALL_PROXY", "http://nopassword@proxy.example:1"), ("HTTP_PROXY", "http://b:2")])), http("b", 2, None));
        // SOCKS: the agent can't use it, and the sockets don't go around it.
        let why = stops(route_from(env(&[("ALL_PROXY", "socks5://127.0.0.1:1080"), ("HTTPS_PROXY", "http://b:2")]))).expect("SOCKS stops");
        assert!(why.contains("ALL_PROXY") && why.contains("SOCKS"), "{why}");
    }

    /// The reason a route stops on, if it does.
    fn stops(route: Route) -> Option<String> {
        match route {
            Route::Unusable(why) => Some(why),
            _ => None,
        }
    }

    #[test]
    fn a_proxy_set_that_cant_be_used_stops_everything_and_says_why() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |name: &str| pairs.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string());
        // An https:// proxy (TLS to the proxy): neither the agent nor the sockets speak it.
        let why = stops(route_from(env(&[("HTTPS_PROXY", "https://tls.example:443")]))).expect("https:// stops");
        assert!(why.contains("HTTPS_PROXY") && why.contains("https://") && why.contains("http://host:port"), "{why}");
        // SOCKS with the name looked up by the proxy.
        let why = stops(route_from(env(&[("all_proxy", "socks5h://127.0.0.1:1080")]))).expect("socks5h:// stops");
        assert!(why.contains("all_proxy") && why.contains("SOCKS"), "{why}");
        // Addresses that don't read as a proxy: never taken as port 80, never passed over.
        for bad in ["http://", "proxy.example:notaport", "http://proxy.example:99999", "[::1]:3128", "ftp://proxy.example:21", "http://nopassword@proxy.example:1"] {
            let pairs: &'static [(&'static str, &'static str)] = Box::leak(Box::new([("HTTP_PROXY", bad)]));
            let why = stops(route_from(env(pairs))).unwrap_or_else(|| panic!("{bad} stops"));
            assert!(why.contains("HTTP_PROXY") && why.contains("http://host:port"), "{bad}: {why}");
        }
        // The login never shows, whether the address reads or not.
        for with_login in ["https://user:secret@tls.example:443", "socks5://user:secret@127.0.0.1:1080", "http://user:secret@proxy.example:port"] {
            let pairs: &'static [(&'static str, &'static str)] = Box::leak(Box::new([("HTTPS_PROXY", with_login)]));
            let why = stops(route_from(env(pairs))).unwrap_or_else(|| panic!("{with_login} stops"));
            assert!(!why.contains("secret"), "{why}");
        }
        // An empty value counts as not set.
        assert_eq!(route_from(env(&[("HTTPS_PROXY", "")])), Route::Direct);
        assert_eq!(route_from(env(&[("ALL_PROXY", ""), ("HTTP_PROXY", "http://b:2")])), Route::Http { host: "b".into(), port: 2, login: None });
    }

    /// A stand-in proxy on 127.0.0.1: answers each CONNECT with `answer` and, on 200, joins the
    /// connection to `target` (another listener on 127.0.0.1), whatever host the CONNECT named.
    /// Gives the heads of the CONNECTs it got.
    fn stand_in_proxy(answer: &'static str, target: u16) -> (u16, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut head = Vec::new();
            let mut b = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") && s.read(&mut b).unwrap_or(0) == 1 {
                head.push(b[0]);
            }
            s.write_all(answer.as_bytes()).unwrap();
            if answer.starts_with("HTTP/1.1 200") {
                let t = std::net::TcpStream::connect(("127.0.0.1", target)).unwrap();
                let (mut s2, mut t2) = (s.try_clone().unwrap(), t.try_clone().unwrap());
                let (mut s, mut t) = (s, t);
                let up = std::thread::spawn(move || std::io::copy(&mut s2, &mut t2));
                let _ = std::io::copy(&mut t, &mut s);
                let _ = up.join();
            }
            vec![String::from_utf8_lossy(&head).into_owned()]
        });
        (port, h)
    }

    /// A listener on 127.0.0.1 for a stand-in WebSocket server, and its port.
    fn socket_server() -> (u16, std::net::TcpListener) {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        (l.local_addr().unwrap().port(), l)
    }

    #[test]
    fn a_socket_goes_through_the_proxy_set() {
        let (target, server) = socket_server();
        let served = std::thread::spawn(move || {
            let (s, _) = server.accept().unwrap();
            let mut ws = tungstenite::accept(s).unwrap();
            let _ = ws.close(None);
            let _ = ws.flush();
        });
        let (proxy, asked) = stand_in_proxy("HTTP/1.1 200 Connection established\r\n\r\n", target);
        // A name nothing resolves: only the proxy may look it up, so going straight would fail.
        use tungstenite::client::IntoClientRequest;
        let mut request = format!("ws://ws.example.invalid:{target}/socket").into_client_request().unwrap();
        request.headers_mut().insert("User-Agent", tungstenite::http::HeaderValue::from_static("MyOrbiter/test"));
        let route = Route::Http { host: "127.0.0.1".into(), port: proxy, login: Some("user:secret".into()) };
        let ws = connect_by(request, &route);
        assert!(ws.is_ok(), "{:?}", ws.err());
        drop(ws);
        served.join().unwrap();
        let head = asked.join().unwrap().remove(0);
        assert!(head.starts_with(&format!("CONNECT ws.example.invalid:{target} HTTP/1.1\r\n")), "{head}");
        assert!(head.contains("\r\nUser-Agent: MyOrbiter/test\r\n"), "{head}");
        assert!(head.contains("\r\nProxy-Authorization: Basic dXNlcjpzZWNyZXQ=\r\n"), "{head}");
    }

    #[test]
    fn a_proxy_that_refuses_ends_the_attempt_and_nothing_goes_straight() {
        let (target, server) = socket_server();
        server.set_nonblocking(true).unwrap();
        let (proxy, asked) = stand_in_proxy("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n", target);
        use tungstenite::client::IntoClientRequest;
        let request = format!("ws://127.0.0.1:{target}/socket").into_client_request().unwrap();
        let route = Route::Http { host: "127.0.0.1".into(), port: proxy, login: Some("user:secret".into()) };
        let e = connect_by(request, &route).err().map(|e| e.to_string()).unwrap_or_default();
        assert!(e.contains("the proxy refused the connection (407)") && !e.contains("secret"), "{e}");
        assert_eq!(asked.join().unwrap().len(), 1);
        assert!(server.accept().is_err(), "nothing reached the target straight");
        // And a proxy MyOrbiter can't use: no connection at all.
        let request = format!("ws://127.0.0.1:{target}/socket").into_client_request().unwrap();
        let e = connect_by(request, &route_from(|name| (name == "HTTPS_PROXY").then(|| "https://127.0.0.1:1".to_string()))).err().map(|e| e.to_string()).unwrap_or_default();
        assert!(e.contains("HTTPS_PROXY is set to an https:// proxy"), "the reason, as given: {e}");
        assert!(server.accept().is_err());
    }

    #[test]
    fn reads_status_frames_in_both_shapes() {
        assert_eq!(read_frame(r#"{"route":"@wfm|cmd/status/set:ok","payload":"ingame"}"#).1, Some(Status::Ingame));
        assert_eq!(read_frame(r#"{"route":"@wfm|event/status/set","payload":{"status":"invisible"}}"#).1, Some(Status::Invisible));
        assert_eq!(read_frame(r#"{"route":"@wfm|cmd/auth/signIn:ok","payload":{}}"#), (Some("@wfm|cmd/auth/signIn:ok".into()), None));
        assert_eq!(read_frame("not json"), (None, None));
        assert_eq!(read_frame(r#"{"route":"@wfm|cmd/status/set:ok","payload":"offline"}"#).1, None);
    }

    /// Against the real server: a made-up token is refused, and the link says so and stops.
    #[test]
    #[ignore = "talks to ws.warframe.market"]
    fn live_server_refuses_a_bad_token() {
        let p = Presence::default();
        p.set(Status::Invisible, || Some("not-a-real-token".into())).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline && p.state().error.is_none() {
            std::thread::sleep(Duration::from_millis(200));
        }
        let s = p.state();
        eprintln!("{s:?}");
        assert!(s.error.as_deref().is_some_and(|e| e.contains("refused")), "{s:?}");
    }

    #[test]
    fn a_closed_connection_can_no_longer_change_what_the_page_shows() {
        let p = Presence::default();
        assert!(p.set(Status::Online, || None).is_err(), "no token: nothing to sign in with");
        assert!(p.state().wanted.is_none());
        // A connection as `set` makes one, without its thread.
        let (tx, _rx) = channel();
        let state = Arc::new(Mutex::new(State { wanted: Some(Status::Ingame), ..State::default() }));
        *lock(&p.link) = Some(Link { tx, state: Arc::clone(&state) });
        assert_eq!(p.state().wanted, Some(Status::Ingame));
        p.close();
        // Its thread, still winding down, reports one last confirmation.
        lock(&state).committed = Some(Status::Ingame);
        lock(&state).connected = true;
        let shown = p.state();
        assert!(shown.committed.is_none() && !shown.connected && shown.wanted.is_none(), "{shown:?}");
    }

    #[test]
    fn frames_are_json_whatever_the_token_holds() {
        let f = frame("@wfm|cmd/auth/signIn", serde_json::json!({ "token": "a\"b" }));
        let v: serde_json::Value = serde_json::from_str(&f).unwrap();
        assert_eq!(v["payload"]["token"], "a\"b");
    }
}
