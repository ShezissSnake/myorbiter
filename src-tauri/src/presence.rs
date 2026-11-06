//! Your status on warframe.market: invisible, online, or online in game.
//!
//! warframe.market keeps status on a WebSocket, not as a setting: a client connects, signs in with
//! the account's token and says which status it holds, and the status lasts as long as that
//! connection. When the last connection closes, the account shows as offline (and its listings
//! are hidden from buyers). So orbiter holds one connection open while you have a status chosen,
//! reconnects when it drops, and closes it when you quit.
//!
//! TennoScope can hold its own connection for the same account. While orbiter holds yours it
//! writes `orbiter-presence.json` to the shared runtime folder every few seconds; a TennoScope
//! with orbiter's patch sees it, closes its own connection and refuses status changes, so the
//! two never fight over what buyers see.

use serde::Serialize;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const SOCKET: &str = "wss://ws.warframe.market/socket";
/// The server refuses connections that don't ask for this subprotocol.
const SUBPROTOCOL: &str = "wfm";
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
    /// What you chose; `None`: no connection held (offline, as far as orbiter is concerned).
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
                log::warn!(target: "orbiter::presence", "{why}");
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

/// Opens a WebSocket with time limits: `tungstenite::connect` has none, so a connection or TLS
/// handshake that never answers (a captive portal, a stuck proxy) would hang its thread for good.
pub(crate) fn connect(
    request: tungstenite::handshake::client::Request,
) -> Result<tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>, tungstenite::Error> {
    use std::net::{TcpStream, ToSocketAddrs};
    const LIMIT: Duration = Duration::from_secs(10);
    let uri = request.uri();
    let host = uri.host().unwrap_or_default().to_string();
    let port = uri.port_u16().unwrap_or(if uri.scheme_str() == Some("ws") { 80 } else { 443 });
    let mut last = std::io::Error::new(std::io::ErrorKind::NotFound, format!("no address for {host}"));
    let mut stream = None;
    for addr in (host.as_str(), port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, LIMIT) {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(e) => last = e,
        }
    }
    let stream = stream.ok_or(last)?;
    stream.set_read_timeout(Some(LIMIT))?;
    stream.set_write_timeout(Some(LIMIT))?;
    match tungstenite::client_tls_with_config(request, stream, None, None) {
        Ok((ws, _)) => Ok(ws),
        Err(tungstenite::HandshakeError::Failure(e)) => Err(e),
        // A read timed out mid-handshake.
        Err(tungstenite::HandshakeError::Interrupted(_)) => Err(tungstenite::Error::Io(std::io::Error::new(std::io::ErrorKind::TimedOut, "the handshake timed out"))),
    }
}

fn session(id: u64, token: &str, wanted: &mut Status, rx: &Receiver<Cmd>, state: &Mutex<State>) -> Ended {
    use tungstenite::{client::IntoClientRequest, Message};
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut request = match SOCKET.into_client_request() {
        Ok(r) => r,
        Err(e) => return Ended::Dropped(e.to_string()),
    };
    request.headers_mut().insert("Sec-WebSocket-Protocol", tungstenite::http::HeaderValue::from_static(SUBPROTOCOL));
    // The same name orbiter gives on the API: a connection that says nothing about itself is
    // turned away (403) before it can sign in.
    request.headers_mut().insert("User-Agent", tungstenite::http::HeaderValue::from_static(crate::market::USER_AGENT));
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
    // third time in ten minutes, orbiter stops putting it back for ten minutes rather than fight.
    let mut overrides: Vec<Instant> = Vec::new();
    let mut hold_until: Option<Instant> = None;
    // The first heartbeat goes out at once. Not `now - HEARTBEAT`: on Windows an Instant counts from
    // boot, and a subtraction that goes below it panics (and a panic closes the app).
    let mut last_beat = Instant::now().checked_sub(HEARTBEAT).unwrap_or_else(Instant::now);
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
        if signed_in && last_beat.elapsed() >= HEARTBEAT {
            write_heartbeat(id, *wanted);
            last_beat = Instant::now();
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
                        log::warn!(target: "orbiter::presence", "something else keeps changing the status: holding off for 10 minutes");
                        s.error = Some("Something else keeps changing your warframe.market status (the website or another app), so orbiter leaves it for 10 minutes. Pick a status to take it back now.".into());
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

    /// Hits the network: `cargo test -p orbiter -- --ignored`. Only the handshake, no sign-in.
    #[test]
    #[ignore]
    fn connects_with_time_limits() {
        use tungstenite::client::IntoClientRequest;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut request = SOCKET.into_client_request().unwrap();
        request.headers_mut().insert("Sec-WebSocket-Protocol", tungstenite::http::HeaderValue::from_static(SUBPROTOCOL));
        request.headers_mut().insert("User-Agent", tungstenite::http::HeaderValue::from_static(crate::market::USER_AGENT));
        let mut ws = connect(request).expect("connected");
        let _ = ws.close(None);
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
