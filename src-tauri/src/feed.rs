//! warframe.market's live feed of new orders, for cheap-buy alerts the moment a listing goes up.
//!
//! The same WebSocket the site uses (`@wfm|cmd/subscribe/newOrders`), no sign-in needed: every
//! order anyone posts on PC arrives as one `@wfm|event/subscriptions/newOrder` frame, about one a
//! second. Sell orders from players who are online are passed on to the page as `market-order`
//! events; the page keeps the ones for things you're after. Reconnects when the connection drops,
//! waiting longer each time it fails.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const SOCKET: &str = "wss://ws.warframe.market/socket";
const SUBPROTOCOL: &str = "wfm";
pub const ORDER_EVENT: &str = "market-order";
/// No frame for this long (the feed sends one a second or so): the connection is gone.
const SILENT_FOR: Duration = Duration::from_secs(90);

#[derive(Clone, Debug, Default, Serialize)]
pub struct FeedState {
    pub running: bool,
    pub connected: bool,
    /// Orders seen since the feed started.
    pub received: u64,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Feed {
    state: Arc<Mutex<FeedState>>,
    /// Bumped on every start and stop: a running loop whose number is stale ends.
    generation: Arc<AtomicU64>,
    started: AtomicBool,
}

impl Feed {
    pub fn state(&self) -> FeedState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Starts the feed (once), or stops it.
    pub fn set(&self, app: tauri::AppHandle, on: bool) {
        if !on {
            self.generation.fetch_add(1, Ordering::SeqCst);
            self.started.store(false, Ordering::SeqCst);
            if let Ok(mut s) = self.state.lock() {
                *s = FeedState::default();
            }
            return;
        }
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let generation = self.generation.clone();
        let state = self.state.clone();
        if let Ok(mut s) = state.lock() {
            s.running = true;
        }
        std::thread::spawn(move || {
            let mut pause = Duration::from_secs(5);
            while generation.load(Ordering::SeqCst) == gen {
                let began = Instant::now();
                let why = run(&app, &state, &generation, gen);
                if generation.load(Ordering::SeqCst) != gen {
                    break;
                }
                if let Ok(mut s) = state.lock() {
                    s.connected = false;
                    s.error = Some(why);
                }
                // A connection that lasted a while starts the waits over.
                if began.elapsed() > Duration::from_secs(120) {
                    pause = Duration::from_secs(5);
                }
                let until = Instant::now() + pause;
                while Instant::now() < until && generation.load(Ordering::SeqCst) == gen {
                    std::thread::sleep(Duration::from_millis(250));
                }
                pause = (pause * 2).min(Duration::from_secs(300));
            }
        });
    }
}

/// One connection: until it drops (the reason) or the feed is stopped.
fn run(app: &tauri::AppHandle, state: &Mutex<FeedState>, generation: &AtomicU64, gen: u64) -> String {
    use tungstenite::{client::IntoClientRequest, Message};
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut request = match SOCKET.into_client_request() {
        Ok(r) => r,
        Err(e) => return e.to_string(),
    };
    request.headers_mut().insert("Sec-WebSocket-Protocol", tungstenite::http::HeaderValue::from_static(SUBPROTOCOL));
    request.headers_mut().insert("User-Agent", tungstenite::http::HeaderValue::from_static(crate::market::USER_AGENT));
    let (mut ws, _) = match tungstenite::connect(request) {
        Ok(c) => c,
        Err(e) => return format!("Couldn't reach warframe.market's live feed ({e})"),
    };
    if let tungstenite::stream::MaybeTlsStream::Rustls(s) = ws.get_mut() {
        let _ = s.sock.set_read_timeout(Some(Duration::from_secs(1)));
    }
    let subscribe = serde_json::json!({ "route": "@wfm|cmd/subscribe/newOrders", "payload": { "platform": crate::market::platform(), "crossplay": true } });
    if let Err(e) = ws.send(Message::Text(subscribe.to_string().into())) {
        return e.to_string();
    }
    let mut heard = Instant::now();
    let mut pinged = Instant::now();
    loop {
        if generation.load(Ordering::SeqCst) != gen {
            let _ = ws.close(None);
            let _ = ws.flush();
            return "stopped".into();
        }
        if heard.elapsed() > SILENT_FOR {
            return "warframe.market's live feed went quiet; reconnecting".into();
        }
        if pinged.elapsed() > Duration::from_secs(30) {
            if let Err(e) = ws.send(Message::Ping(Vec::new().into())) {
                return e.to_string();
            }
            pinged = Instant::now();
        }
        let text = match ws.read() {
            Ok(Message::Text(t)) => {
                heard = Instant::now();
                t.to_string()
            }
            Ok(Message::Close(_)) => return "warframe.market closed the live feed; reconnecting".into(),
            Ok(_) => {
                heard = Instant::now();
                continue;
            }
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return format!("Lost warframe.market's live feed ({e}); reconnecting"),
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        match v["route"].as_str() {
            Some("@wfm|cmd/subscribe/newOrders:ok") => {
                if let Ok(mut s) = state.lock() {
                    s.connected = true;
                    s.error = None;
                }
            }
            Some("@wfm|event/subscriptions/newOrder") => {
                if let Ok(mut s) = state.lock() {
                    s.received += 1;
                }
                if worth_passing_on(&v["payload"]) {
                    let _ = app.emit(ORDER_EVENT, &v["payload"]);
                }
            }
            _ => {}
        }
    }
}

/// A sell order from someone you could whisper now: the only kind a cheap-buy alert is about.
pub fn worth_passing_on(order: &serde_json::Value) -> bool {
    order["type"] == "sell" && order["visible"] != false && matches!(order["user"]["status"].as_str(), Some("ingame") | Some("online"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_on_sell_orders_from_players_who_are_on() {
        let o: serde_json::Value = serde_json::from_str(r#"{"id":"ffffffffffffffffffffffff","type":"sell","platinum":20,"quantity":1,"perTrade":1,"visible":true,"itemId":"67acd8fa125398d92c8bb4df","user":{"ingameName":"Seller2","status":"ingame"}}"#).unwrap();
        assert!(worth_passing_on(&o));
        let mut buy = o.clone();
        buy["type"] = "buy".into();
        assert!(!worth_passing_on(&buy));
        let mut away = o.clone();
        away["user"]["status"] = "offline".into();
        assert!(!worth_passing_on(&away));
    }
}
