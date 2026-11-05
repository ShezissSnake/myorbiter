//! Follows Warframe's own log (`EE.log`) to see which relics the squad brought into a fissure.
//!
//! Read-only, and nothing but the log file: when a mission loads, the game logs a
//! `ResourceLoader (...)` line for every relic in the squad, by its projection path, which also
//! carries the refinement (`...Bronze` intact up to `...Platinum` radiant). The reward screen
//! opening and shutting down mark the end of a round.
//!
//! It also sees your trades: when you accept a trade the game logs the confirmation dialog with
//! everything on both sides ("You are offering: … and will receive from <name> the following: …
//! Platinum x 17"), then "The trade was successful!" once it goes through.

use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const PROJECTION_PREFIX: &str = "/Lotus/Types/Game/Projections/";
const REWARD_OPEN: &str = "OpenVoidProjectionRewardScreen";
const REWARD_CLOSED: &str = "Relic reward screen shut down";
const MISSION_NAME: &str = "ThemedSquadOverlay.lua: Mission name: ";
const GETS_REWARD: &str = " gets reward ";
const SESSION_CLOCK: &str = "Sys [Diag]: Current time: ";
/// A private chat opening: someone whispered you (or you them), e.g. after a warframe.market
/// "Hi! I want to buy…". `F` marks a private tab.
const CHAT_TAB: &str = "ChatRedux::AddTab: Adding tab with channel name: F";
const TRADE_ASK: &str = "Are you sure you want to accept this trade? You are offering";
const TRADE_DIVIDER: &str = "and will receive from ";
const TRADE_DIVIDER_END: &str = " the following:";
const TRADE_DONE: &str = "The trade was successful!";
const TRADE_FAILED: [&str; 3] = ["The trade failed", "The trade was cancelled", "OnTradeAccepted failed"];
/// A trade dialog is a few hundred bytes. One that keeps going past this without closing isn't a
/// trade: it's dropped (no sale) rather than held and grown for the rest of the session.
const MAX_DIALOG_BYTES: usize = 64 * 1024;

/// One thing on one side of a trade: `Condition Overload (RARE RANK 0)`, `Vitus Essence x 2`.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct TradeItem {
    pub name: String,
    pub rank: Option<u32>,
    pub count: u32,
}

/// A private chat that opened this session.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Whisper {
    pub name: String,
    pub uptime: f64,
    /// Unix seconds, when the log carried the session's clock.
    pub at: Option<i64>,
}

/// A trade that went through.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Trade {
    /// Engine uptime of the confirmation: with the session, what makes a trade unique.
    pub uptime: f64,
    /// Unix seconds, when the log carried the session's clock.
    pub at: Option<i64>,
    pub partner: String,
    pub offered: Vec<TradeItem>,
    pub received: Vec<TradeItem>,
    pub platinum_offered: u32,
    pub platinum_received: u32,
}

/// One mission of this game session, as the log tells it.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct MissionEntry {
    pub name: String,
    /// Unix seconds, when the log carried the session's UTC clock; otherwise null.
    pub started_at: Option<i64>,
    /// Engine uptime when it started.
    pub uptime: f64,
    /// Every relic loaded during it (a fissure if non-empty), first seen order.
    pub relics: Vec<String>,
    /// Reward screens that opened: one per fissure round.
    pub rounds: u32,
    /// Store paths of the relic rewards the log says you got.
    pub rewards: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct MissionState {
    /// The log being followed, once found.
    pub path: Option<String>,
    /// "Current time" line the game writes at the top of each log; changes when the game restarts.
    pub session: Option<String>,
    pub mission: Option<String>,
    /// Projection paths of the relics loaded for the current round, in load order.
    pub relics: Vec<String>,
    /// The round before, kept after the reward screen closes so it stays visible.
    pub last_relics: Vec<String>,
    pub reward_screen_open: bool,
    /// Store paths of rewards the log says someone got (the local player's pick among them).
    pub rewards_given: Vec<String>,
    /// Engine uptime (seconds) of the last line that changed this state.
    pub last_event: Option<f64>,
    /// Unix seconds the session's log started, from its `[UTC: ...]` clock.
    pub session_start: Option<i64>,
    /// This session's missions, oldest first.
    pub history: Vec<MissionEntry>,
    /// This session's trades that went through, oldest first.
    pub trades: Vec<Trade>,
    /// Private chats that opened this session, oldest first.
    pub whispers: Vec<Whisper>,
    /// The trade dialog being read (it spans several lines), then the trade waiting for its result.
    #[serde(skip)]
    trade_text: Option<(f64, String)>,
    #[serde(skip)]
    trade_pending: Option<Trade>,
}

impl MissionState {
    /// One physical log line. The game separates lines inside a dialog with a bare CR, and can
    /// glue the next entry onto the same line after one, so each CR-separated piece is a line.
    pub fn observe(&mut self, line: &str) {
        for piece in line.split('\r') {
            self.observe_line(piece);
        }
    }

    pub fn observe_line(&mut self, line: &str) {
        if self.observe_trade(line) {
            return;
        }
        if let Some(rest) = line.split_once(CHAT_TAB).map(|(_, r)| r) {
            let name = strip_glyphs(rest.split(" to index").next().unwrap_or("")).trim().to_string();
            if !name.is_empty() && !self.whispers.iter().any(|w| w.name == name) {
                let up = uptime_of(line).unwrap_or(0.0);
                self.whispers.push(Whisper { name, uptime: up, at: clock_at(self.session_start, up) });
            }
            return;
        }
        let uptime = uptime_of(line);
        let mut changed = true;
        // The clock line opens a session: only near its start (a stray one later on mustn't wipe
        // the session's missions and trades).
        if let Some(rest) = line.split_once(SESSION_CLOCK).map(|(_, r)| r).filter(|_| uptime.is_none_or(|u| u < 60.0)) {
            *self = MissionState {
                path: self.path.clone(),
                session: Some(rest.trim().to_string()),
                session_start: parse_utc_clock(rest),
                ..Default::default()
            };
        } else if let Some(name) = line.split_once(MISSION_NAME).map(|(_, r)| r.trim()) {
            // The overlay logs the name again during a mission (loading, squad changes), so the
            // same name only starts a new entry once the last one has had its reward screen:
            // running the same fissure again.
            let replay = self.history.last().is_some_and(|e| e.rounds > 0) && !self.reward_screen_open;
            if self.mission.as_deref() != Some(name) || replay {
                self.mission = Some(name.to_string());
                let up = uptime.unwrap_or(0.0);
                self.history.push(MissionEntry {
                    name: name.to_string(),
                    started_at: clock_at(self.session_start, up),
                    uptime: up,
                    ..Default::default()
                });
                if !self.relics.is_empty() {
                    self.last_relics = std::mem::take(&mut self.relics);
                }
                self.rewards_given.clear();
            } else {
                changed = false;
            }
        } else if let Some(path) = projection_path(line) {
            if self.relics.iter().any(|p| p == path) {
                changed = false;
            } else {
                if self.relics.is_empty() {
                    self.rewards_given.clear();
                }
                self.relics.push(path.to_string());
                if let Some(entry) = self.history.last_mut() {
                    if !entry.relics.iter().any(|p| p == path) {
                        entry.relics.push(path.to_string());
                    }
                }
            }
        } else if line.contains(REWARD_OPEN) {
            if !self.reward_screen_open {
                if let Some(entry) = self.history.last_mut() {
                    entry.rounds += 1;
                }
            }
            self.reward_screen_open = true;
        } else if line.contains(REWARD_CLOSED) {
            self.reward_screen_open = false;
            if !self.relics.is_empty() {
                self.last_relics = std::mem::take(&mut self.relics);
            }
        } else if let Some((_, path)) = line.split_once(GETS_REWARD) {
            let path = path.trim();
            if path.starts_with("/Lotus/") {
                self.rewards_given.push(path.to_string());
                if let Some(entry) = self.history.last_mut() {
                    entry.rewards.push(path.to_string());
                }
            } else {
                changed = false;
            }
        } else {
            changed = false;
        }
        if changed {
            self.last_event = uptime.or(self.last_event);
        }
    }
}

impl MissionState {
    /// Trade lines; true when the line was part of a trade (and nothing else needs it).
    fn observe_trade(&mut self, line: &str) -> bool {
        let stamped = starts_with_uptime(line);
        if let Some((at, text)) = self.trade_text.as_mut() {
            // Reading the dialog: until its closing arguments, or a new log entry.
            if !stamped {
                if let Some(end) = line.find("leftItem=").or_else(|| line.find(", title=")) {
                    let cut = line[..end].trim_end().trim_end_matches(", title=").trim_end_matches(',');
                    text.push('\n');
                    text.push_str(cut);
                    let (at, text) = (*at, std::mem::take(text));
                    self.trade_text = None;
                    self.trade_pending = Some(parse_trade(at, &text, self.session_start));
                } else if text.len() + line.len() >= MAX_DIALOG_BYTES {
                    self.trade_text = None;
                    self.trade_pending = None;
                } else {
                    text.push('\n');
                    text.push_str(line);
                }
                return true;
            }
            // A new entry before the dialog closed: take what was read.
            let (at, text) = (*at, std::mem::take(text));
            self.trade_text = None;
            self.trade_pending = Some(parse_trade(at, &text, self.session_start));
        }
        if let Some((_, rest)) = line.split_once(TRADE_ASK) {
            let up = uptime_of(line).unwrap_or(0.0);
            let rest = rest.trim_start_matches(':');
            // The whole dialog can come on one line.
            if let Some(end) = rest.find("leftItem=") {
                let cut = rest[..end].trim_end().trim_end_matches(", title=").trim_end_matches(',');
                self.trade_pending = Some(parse_trade(up, cut, self.session_start));
            } else {
                self.trade_text = Some((up, rest.to_string()));
            }
            return true;
        }
        if line.contains(TRADE_DONE) {
            if let Some(t) = self.trade_pending.take() {
                self.trades.push(t);
            }
            return true;
        }
        if TRADE_FAILED.iter().any(|f| line.contains(f)) {
            self.trade_pending = None;
            return true;
        }
        false
    }
}

/// The engine uptime a log line starts with (`2530.100`). Only plain decimals of a sane size:
/// `f64::from_str` also takes `inf`, `NaN` and `1e300`, which must not turn into a clock time.
fn uptime_of(line: &str) -> Option<f64> {
    let token = line.split_whitespace().next()?;
    if !token.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return None;
    }
    let up = token.parse::<f64>().ok()?;
    (up < 1e9).then_some(up)
}

/// Unix seconds of an uptime, from the session's start (never overflows on a garbled line).
fn clock_at(session_start: Option<i64>, uptime: f64) -> Option<i64> {
    session_start.map(|s| s.saturating_add(uptime as i64))
}

fn starts_with_uptime(line: &str) -> bool {
    let first = line.split_whitespace().next().unwrap_or("");
    !first.is_empty() && first.contains('.') && first.parse::<f64>().is_ok() && line.starts_with(first)
}

/// The dialog text after "You are offering": your items, the divider with the other player's
/// name, then theirs.
fn parse_trade(uptime: f64, text: &str, session_start: Option<i64>) -> Trade {
    let mut t = Trade { uptime, at: clock_at(session_start, uptime), ..Default::default() };
    let mut theirs = false;
    for raw in text.split(['\n', '\r']) {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.split_once(TRADE_DIVIDER).map(|(_, r)| r) {
            let name = rest.split(TRADE_DIVIDER_END).next().unwrap_or("");
            t.partner = strip_glyphs(name).trim().to_string();
            theirs = true;
            continue;
        }
        let Some(item) = parse_item(line) else { continue };
        if item.name.eq_ignore_ascii_case("Platinum") {
            if theirs {
                t.platinum_received = t.platinum_received.saturating_add(item.count);
            } else {
                t.platinum_offered = t.platinum_offered.saturating_add(item.count);
            }
            continue;
        }
        let side = if theirs { &mut t.received } else { &mut t.offered };
        match side.iter_mut().find(|x| x.name == item.name && x.rank == item.rank) {
            Some(x) => x.count = x.count.saturating_add(item.count),
            None => side.push(item),
        }
    }
    t
}

/// An arcane's rank in the trade dialog: one pip glyph per rank after its name, so a maxed
/// Primary Crux reads "Primary Crux" and five of them. The glyph differs between arcanes
/// (Primary Crux's is U+E0B9, Secondary Surge's U+E08D), so it's a run of one repeated glyph
/// from the game's icon range, not one particular character.
fn rank_pips(line: &str) -> u32 {
    let tail: Vec<char> = line.trim_end().chars().rev().skip_while(|c| c.is_whitespace() || *c == '\r').take_while(|c| ('\u{E080}'..='\u{E0FF}').contains(c)).collect();
    match tail.first() {
        Some(first) if tail.iter().all(|c| c == first) && tail.len() <= 10 => tail.len() as u32,
        _ => 0,
    }
}

/// `Condition Overload (RARE RANK 0)`, `Vitus Essence x 2`, `Platinum x 17`, `Axi A12 Relic`, and
/// arcanes with their rank as pips.
fn parse_item(line: &str) -> Option<TradeItem> {
    let pips = rank_pips(line);
    let line = strip_glyphs(line);
    let line = line.trim();
    if line.is_empty() || line.contains("[Info]") || line.contains(".lua") {
        return None;
    }
    let (body, count) = match line.rsplit_once(" x ").and_then(|(name, n)| Some((name, count_of(n)?))) {
        Some((name, n)) => (name.trim(), n),
        _ => (line, 1),
    };
    let (name, rank) = match body.rsplit_once(" (") {
        Some((name, tag)) if tag.ends_with(')') && tag.contains("RANK") => {
            let rank = tag.trim_end_matches(')').split_whitespace().find_map(|w| w.parse::<u32>().ok());
            (name.trim(), rank)
        }
        _ => (body, (pips > 0).then_some(pips)),
    };
    (!name.is_empty()).then(|| TradeItem { name: name.to_string(), rank, count: count.max(1) })
}

/// A count as the game writes it, thousands separated or not: "12", "1,500", "1.500", "1 500"
/// (a plain or a narrow no-break space too). None for anything else.
fn count_of(s: &str) -> Option<u32> {
    let s = s.trim();
    if s.is_empty() || !s.chars().next()?.is_ascii_digit() {
        return None;
    }
    let digits: String = s.chars().filter(|c| !matches!(c, ',' | '.' | ' ' | '\u{00A0}' | '\u{202F}')).collect();
    if !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Platform and other glyphs from the private-use area, which the game puts after names.
fn strip_glyphs(s: &str) -> String {
    s.chars().filter(|c| !('\u{E000}'..='\u{F8FF}').contains(c) && *c != '\u{FFFD}').collect()
}

/// `Thu Oct 22 19:05:36 2026 [UTC: Thu Oct 22 17:05:36 2026]` → unix seconds of the UTC part.
fn parse_utc_clock(rest: &str) -> Option<i64> {
    let utc = rest.split_once("[UTC:")?.1.trim_end().trim_end_matches(']').trim();
    let mut it = utc.split_whitespace().skip(1); // weekday
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let month_name = it.next()?;
    let month = MONTHS.iter().position(|m| month_name.starts_with(m))? as i64 + 1;
    let day: i64 = it.next()?.parse().ok()?;
    let mut hms = it.next()?.split(':').map(|x| x.parse::<i64>().ok());
    let (h, mi, se) = (hms.next()??, hms.next()??, hms.next()??);
    let year: i64 = it.next()?.parse().ok()?;
    // A garbled clock gives no time rather than a wrong one (or an overflow).
    if !(1970..=9999).contains(&year) || !(1..=31).contains(&day) || !(0..24).contains(&h) || !(0..60).contains(&mi) || !(0..=60).contains(&se) {
        return None;
    }
    // Days from civil (Hinnant).
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + h * 3600 + mi * 60 + se)
}

fn projection_path(line: &str) -> Option<&str> {
    let start = line.find(PROJECTION_PREFIX)?;
    let rest = &line[start..];
    let end = rest.find(|c: char| c == ')' || c.is_ascii_whitespace()).unwrap_or(rest.len());
    let path = &rest[..end];
    // Only the relics themselves, which always end in their refinement.
    ["Bronze", "Silver", "Gold", "Platinum"].iter().any(|r| path.ends_with(r)).then_some(path)
}

/// How much of the log's start identifies it. Warframe opens every log with the same few lines
/// (command line, build, user and computer name: ~350 bytes) before the line with the session's
/// clock, so the identity has to reach past that line to tell two launches apart.
const HEAD_BYTES: usize = 4096;
/// Read at most this much per step, so the first read of a long session's log (tens of MB) never
/// sits in memory whole.
const CHUNK_BYTES: u64 = 1 << 20;
/// A "line" longer than this without a newline isn't one; drop it rather than grow forever.
const MAX_LINE_BYTES: usize = 1 << 20;

/// Keeps a read offset so each poll only reads what the game appended.
#[derive(Default)]
pub struct LogFollower {
    path: Option<PathBuf>,
    offset: u64,
    /// The log's first bytes (up to `HEAD_BYTES`); when they change, the game has started a new log.
    head: Vec<u8>,
    /// Device and inode, where the platform has them: a log deleted and made anew is a new log
    /// even if it starts the same.
    id: Option<(u64, u64)>,
    carry: Vec<u8>,
    /// Inside a line too long to keep: drop bytes up to its newline.
    skipping: bool,
    pub state: MissionState,
}

#[cfg(unix)]
fn file_id(meta: &std::fs::Metadata) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    Some((meta.dev(), meta.ino()))
}
#[cfg(not(unix))]
fn file_id(_meta: &std::fs::Metadata) -> Option<(u64, u64)> {
    None
}

impl LogFollower {
    fn reset(&mut self, path: &Path) {
        *self = LogFollower { path: Some(path.to_path_buf()), ..Default::default() };
        self.state.path = Some(path.display().to_string());
    }

    pub fn poll(&mut self, path: &Path) -> std::io::Result<&MissionState> {
        if self.path.as_deref() != Some(path) {
            self.reset(path);
        }
        let mut file = File::open(path)?;
        let meta = file.metadata()?;
        let len = meta.len();
        let id = file_id(&meta);
        // A new game session writes a new log. It can already be longer than where we were, so
        // compare its opening bytes (through the session clock) and its identity as well as its
        // length. `take` rather than `read_exact`: the game may truncate it between the two calls.
        let mut head = Vec::new();
        (&mut file).take(HEAD_BYTES as u64).read_to_end(&mut head)?;
        let common = self.head.len().min(head.len());
        let restarted = len < self.offset
            || (self.id.is_some() && id != self.id)
            || self.head[..common] != head[..common];
        if restarted {
            self.reset(path);
        }
        self.id = id;
        if self.head.len() < head.len() {
            self.head = head;
        }
        file.seek(SeekFrom::Start(self.offset))?;
        loop {
            let read = (&mut file).take(CHUNK_BYTES).read_to_end(&mut self.carry)?;
            if read == 0 {
                break;
            }
            self.offset += read as u64;
            self.take_lines();
        }
        Ok(&self.state)
    }

    /// Hands every complete line in `carry` to the state, keeping the unfinished tail.
    fn take_lines(&mut self) {
        // The rest of a line too long to keep: dropped up to its end, never read as a line.
        if self.skipping {
            match self.carry.iter().position(|b| *b == b'\n') {
                Some(i) => {
                    self.carry.drain(..=i);
                    self.skipping = false;
                }
                None => {
                    self.carry.clear();
                    return;
                }
            }
        }
        let Some(end) = self.carry.iter().rposition(|b| *b == b'\n') else {
            if self.carry.len() > MAX_LINE_BYTES {
                self.carry.clear();
                self.skipping = true;
            }
            return;
        };
        for raw in self.carry[..end].split(|b| *b == b'\n') {
            let raw = raw.strip_suffix(b"\r").unwrap_or(raw);
            self.state.observe(&String::from_utf8_lossy(raw));
        }
        self.carry.drain(..=end);
    }
}

/// Where Warframe writes its log. On Windows the game keeps it in `%LOCALAPPDATA%\Warframe`.
#[cfg(windows)]
pub fn find_ee_log() -> Option<PathBuf> {
    let path = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Warframe").join("EE.log");
    path.is_file().then_some(path)
}

/// Where Warframe writes its log on a Mac: the native game keeps its data under Application
/// Support, the Steam copy under Steam's own folder. Whichever was written last. If it isn't in
/// either, the path can be set in Settings.
#[cfg(target_os = "macos")]
pub fn find_ee_log() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    [
        "Library/Application Support/Warframe/EE.log",
        "Library/Application Support/Steam/steamapps/common/Warframe/EE.log",
        "Library/Logs/Warframe/EE.log",
    ]
    .iter()
    .map(|p| home.join(p))
    .filter(|p| p.is_file())
    .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

/// Where Steam keeps Warframe's log under Proton, for every Steam library on this machine (a
/// Steam Deck's SD card included: it's one of the libraries Steam lists).
#[cfg(not(any(windows, target_os = "macos")))]
pub fn find_ee_log() -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    let steam_roots = [
        home.join(".local/share/Steam"),
        home.join(".steam/steam"),
        home.join(".steam/root"),
        home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
    ];
    let mut libraries: Vec<PathBuf> = Vec::new();
    for root in &steam_roots {
        libraries.push(root.clone());
        if let Ok(vdf) = std::fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
            for line in vdf.lines() {
                let mut parts = line.split('"').filter(|s| !s.trim().is_empty());
                if parts.next() == Some("path") {
                    if let Some(p) = parts.next() {
                        libraries.push(PathBuf::from(p.replace("\\\\", "\\")));
                    }
                }
            }
        }
    }
    let tail = "steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log";
    libraries
        .iter()
        .map(|lib| lib.join(tail))
        .filter(|p| p.is_file())
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_with_thousands_separators() {
        for (line, n) in [("Platinum x 1,500", 1500), ("Platinum x 1.500", 1500), ("Platinum x 1 500", 1500), ("Platinum x 17", 17), ("Vitus Essence x 2", 2)] {
            assert_eq!(parse_item(line).map(|i| i.count), Some(n), "{line}");
        }
        // Not a count: the whole line is the name.
        assert_eq!(parse_item("Something x 1.5.a").map(|i| i.count), Some(1));
    }

    const LOG: &str = "\
0.107 Sys [Diag]: Current time: Tue Oct 13 21:08:47 2026 [UTC: Tue Oct 13 19:08:47 2026]
2530.100 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)
2535.221 Sys [Info]: ResourceLoader 0x0000000020B88330 (/Lotus/Types/Game/Projections/T2VoidProjectionGyrePrimeABronze) Found 19 items to load (0ms)
2535.262 Sys [Info]: Resloader 0x0000000020B88330 (/Lotus/Types/Game/Projections/T2VoidProjectionGyrePrimeABronze) starting
2535.426 Sys [Info]: ResourceLoader 0x00000000444971F0 (/Lotus/Types/Game/Projections/T2VoidProjectionTitaniaGaraVaultBPlatinum) Found 17 items to load (0ms)
2660.508 Sys [Info]: VoidProjections: OpenVoidProjectionRewardScreenRMI
2660.858 Sys [Info]: VoidProjections: de1e7ed00000000000000011 gets reward /Lotus/StoreItems/Types/Recipes/Components/FormaBlueprint
";

    // As the game logs a sale: lines inside the dialog split by a bare CR, the next entry glued
    // on after the closing arguments, a platform glyph after the buyer's name.
    const SALE: &str = "0.107 Sys [Diag]: Current time: Tue Oct 13 21:08:47 2026 [UTC: Tue Oct 13 19:08:47 2026]\n\
3121.530 Script [Info]: Dialog.lua: Dialog::CreateOk(description=Trade request accepted, title= leftItem=/Menu/Confirm_Item_Ok)\n\
3127.384 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:\n\
\rCondition Overload (RARE RANK 0)\n\
\n\
and will receive from Buyer1\u{E000} the following:\n\
\rPlatinum x 17, title= leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)\r3127.431 Sys [Info]: Fade out complete\n\
3131.276 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, title= leftItem=/Menu/Confirm_Item_Ok)\n";

    #[test]
    fn reads_a_sale_from_the_trade_dialog() {
        let mut s = MissionState::default();
        SALE.lines().for_each(|l| s.observe(l));
        assert_eq!(s.trades.len(), 1);
        let t = &s.trades[0];
        assert_eq!(t.partner, "Buyer1");
        assert_eq!(t.offered, vec![TradeItem { name: "Condition Overload".into(), rank: Some(0), count: 1 }]);
        assert!(t.received.is_empty());
        assert_eq!(t.platinum_received, 17);
        assert_eq!(t.platinum_offered, 0);
        assert_eq!(t.uptime, 3127.384);
        assert_eq!(t.at, Some(1_791_918_527 + 3127));
    }

    #[test]
    fn a_whisper_opens_a_private_tab() {
        let mut s = MissionState::default();
        s.observe("0.1 Sys [Diag]: Current time: Tue Oct 13 21:08:47 2026 [UTC: Tue Oct 13 19:08:47 2026]");
        s.observe("300.5 Script [Info]: ChatRedux.lua: ChatRedux::AddTab: Adding tab with channel name: FBuyer1\u{E000} to index 6");
        s.observe("301.0 Script [Info]: ChatRedux.lua: ChatRedux::AddTab: Adding tab with channel name: FBuyer1 to index 6");
        s.observe("302.0 Script [Info]: ChatRedux.lua: ChatRedux::AddTab: Adding tab with channel name: Trade to index 2");
        assert_eq!(s.whispers.len(), 1, "once per name, and only private tabs");
        assert_eq!(s.whispers[0].name, "Buyer1");
        assert_eq!(s.whispers[0].at, Some(1_791_918_527 + 300));
    }

    #[test]
    fn a_trade_that_fails_or_is_cancelled_is_not_counted() {
        let mut s = MissionState::default();
        let failed = SALE.replace("The trade was successful!", "The trade failed.");
        failed.lines().for_each(|l| s.observe(l));
        assert!(s.trades.is_empty());
        // One-line dialog, stacked items, both sides.
        let mut s = MissionState::default();
        s.observe("10.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:\rArcane Energize (LEGENDARY RANK 5)\rVitus Essence x 2\rand will receive from Buyer the following:\rPlatinum x 150, leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)");
        s.observe("14.0 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, leftItem=/Menu/Confirm_Item_Ok)");
        let t = &s.trades[0];
        assert_eq!(t.offered.len(), 2);
        assert_eq!(t.offered[0], TradeItem { name: "Arcane Energize".into(), rank: Some(5), count: 1 });
        assert_eq!(t.offered[1], TradeItem { name: "Vitus Essence".into(), rank: None, count: 2 });
        assert_eq!(t.platinum_received, 150);
        // An arcane shows its rank as pips after the name.
        let mut s2 = MissionState::default();
        s2.observe("31.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:\r\rPrimary Crux \u{E0B9}\u{E0B9}\u{E0B9}\u{E0B9}\u{E0B9}\r\r\rand will receive from Buyer2\u{E000} the following:\r\rPlatinum x 27, title= leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)");
        s2.observe("35.0 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, title= leftItem=/Menu/Confirm_Item_Ok)");
        assert_eq!(s2.trades[0].offered, vec![TradeItem { name: "Primary Crux".into(), rank: Some(5), count: 1 }]);
        assert_eq!(s2.trades[0].platinum_received, 27);
        // Other arcanes use another pip glyph: a maxed Secondary Surge.
        let mut s3 = MissionState::default();
        s3.observe("8731.262 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:\r\rSecondary Surge \u{E08D}\u{E08D}\u{E08D}\u{E08D}\u{E08D}\r\r\rand will receive from Buyer3\u{E000} the following:\r\rPlatinum x 14, title= leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)");
        s3.observe("8735.807 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, title= leftItem=/Menu/Confirm_Item_Ok)");
        assert_eq!(s3.trades[0].offered, vec![TradeItem { name: "Secondary Surge".into(), rank: Some(5), count: 1 }]);
        // Other dialogs aren't trades.
        let mut s = MissionState::default();
        s.observe("20.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to cycle Burston Sati-critades for 3.500?, leftItem=/Menu/Confirm_Item_Yes, rightItem=/Menu/Confirm_Item_No)");
        s.observe("21.0 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, leftItem=/Menu/Confirm_Item_Ok)");
        assert!(s.trades.is_empty());
    }

    #[test]
    fn collects_the_squads_relics_for_the_round() {
        let mut s = MissionState::default();
        LOG.lines().for_each(|l| s.observe_line(l));
        assert_eq!(s.mission.as_deref(), Some("Ukko (Void)"));
        assert_eq!(
            s.relics,
            vec![
                "/Lotus/Types/Game/Projections/T2VoidProjectionGyrePrimeABronze",
                "/Lotus/Types/Game/Projections/T2VoidProjectionTitaniaGaraVaultBPlatinum"
            ]
        );
        assert!(s.reward_screen_open);
        assert_eq!(s.rewards_given.len(), 1);
        assert_eq!(s.last_event, Some(2660.858));
        assert_eq!(s.session_start, Some(1_791_918_527)); // 2026-10-13 19:08:47 UTC
        let entry = &s.history[0];
        assert_eq!(entry.name, "Ukko (Void)");
        assert_eq!(entry.started_at, Some(1_791_918_527 + 2530));
        assert_eq!(entry.relics.len(), 2);
        assert_eq!(entry.rounds, 1);
        assert_eq!(entry.rewards, vec!["/Lotus/StoreItems/Types/Recipes/Components/FormaBlueprint"]);

        s.observe_line("2676.273 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down");
        assert!(!s.reward_screen_open);
        assert!(s.relics.is_empty());
        assert_eq!(s.last_relics.len(), 2);

        // Next round of an endless mission starts a fresh set.
        s.observe_line("2700.000 Sys [Info]: ResourceLoader 0x1 (/Lotus/Types/Game/Projections/T1VoidProjectionEarlyGold) Found 3 items");
        assert_eq!(s.relics, vec!["/Lotus/Types/Game/Projections/T1VoidProjectionEarlyGold"]);
        assert!(s.rewards_given.is_empty());
    }

    #[test]
    fn a_repeated_name_mid_mission_is_the_same_mission() {
        let mut s = MissionState::default();
        s.observe_line("10.0 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)");
        s.observe_line("12.0 Sys [Info]: ResourceLoader 0x01 (/Lotus/Types/Game/Projections/T3VoidProjectionGaussPrimeABronze) Found 19 items to load (0ms)");
        s.observe_line("14.0 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)");
        assert_eq!(s.history.len(), 1, "no reward screen yet: still the first run");
        assert_eq!(s.relics.len(), 1, "the loaded relic stays with the round");
        s.observe_line("90.0 Sys [Info]: VoidProjections: OpenVoidProjectionRewardScreenRMI");
        s.observe_line("95.0 Script [Info]: ProjectionRewardChoice.lua: Relic reward screen shut down");
        s.observe_line("120.0 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)");
        assert_eq!(s.history.len(), 2, "after a reward screen, the same name is a new run");
    }

    #[test]
    fn follows_appends_and_restarts() {
        let dir = std::env::temp_dir().join(format!("orbiter-ee-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("EE.log");
        let (head, tail) = LOG.split_at(LOG.find("2535.426").unwrap());
        std::fs::write(&path, head).unwrap();
        let mut f = LogFollower::default();
        assert_eq!(f.poll(&path).unwrap().relics.len(), 1);
        std::fs::write(&path, LOG).unwrap();
        assert_eq!(f.poll(&path).unwrap().relics.len(), 2);
        let _ = tail;
        // Game restarted: shorter log, state starts over.
        std::fs::write(&path, "0.107 Sys [Diag]: Current time: Fri Oct 23 10:00:00 2026\n").unwrap();
        let s = f.poll(&path).unwrap();
        assert!(s.relics.is_empty() && s.mission.is_none());
        // Game restarted and the new log is already longer than where we'd read to.
        let mut f = LogFollower::default();
        std::fs::write(&path, LOG).unwrap();
        assert_eq!(f.poll(&path).unwrap().relics.len(), 2);
        let fresh = format!("0.107 Sys [Diag]: Current time: Sat Oct 24 09:00:00 2026\n{}\n2.000 Script [Info]: ThemedSquadOverlay.lua: Mission name: Hydron (Sedna)\n", "x".repeat(LOG.len()));
        std::fs::write(&path, fresh).unwrap();
        let s = f.poll(&path).unwrap();
        assert!(s.relics.is_empty());
        assert_eq!(s.mission.as_deref(), Some("Hydron (Sedna)"));
        assert_eq!(s.history.len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The lines every Warframe log opens with, the same on every launch (synthetic values).
    const PREAMBLE: &str = "0.050 Sys [Diag]: Process Command-line: -windowMode:2 -shaderCache:1 -graphicsDriver:dx11 -gpuPreference:2 -cluster:public -language:en -clienttype:Steam\r\n\
0.050 Sys [Diag]: Build Label: 2026.10.01.10.00 Retail Windows x64 [Stripped]\r\n\
0.050 Sys [Diag]: Build Unique ID: 123456789\r\n\
0.050 Sys [Diag]: Windows user-name: steamuser\r\n\
0.051 Sys [Diag]: Windows computer-name: test-machine\r\n";

    fn temp_log(tag: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("orbiter-ee-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("EE.log");
        (dir, path)
    }

    #[test]
    fn a_relaunch_with_the_same_preamble_is_still_a_new_log() {
        assert!(PREAMBLE.len() > 256, "the preamble alone is longer than the old 256-byte check");
        let (dir, path) = temp_log("relaunch");
        let first = format!("{PREAMBLE}0.055 Sys [Diag]: Current time: Sun Oct 25 10:36:25 2026 [UTC: Sun Oct 25 09:36:25 2026]\r\n\
10.000 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)\r\n");
        std::fs::write(&path, &first).unwrap();
        let mut f = LogFollower::default();
        assert_eq!(f.poll(&path).unwrap().mission.as_deref(), Some("Ukko (Void)"));
        // The game restarts and has already logged past where the old log ended.
        let second = format!("{PREAMBLE}0.054 Sys [Diag]: Current time: Sun Oct 25 18:00:00 2026 [UTC: Sun Oct 25 17:00:00 2026]\r\n\
{}\r\n\
5.000 Script [Info]: ThemedSquadOverlay.lua: Mission name: Hydron (Sedna)\r\n", "1.000 Sys [Info]: padding".repeat(20));
        assert!(second.len() > first.len());
        std::fs::write(&path, &second).unwrap();
        let s = f.poll(&path).unwrap();
        assert_eq!(s.session_start, Some(1_792_947_600), "the new session's clock was read");
        assert_eq!(s.history.len(), 1);
        assert_eq!(s.mission.as_deref(), Some("Hydron (Sedna)"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_a_long_log_in_steps_without_losing_the_line_across_a_step() {
        let (dir, path) = temp_log("chunks");
        let mut log = String::from("0.055 Sys [Diag]: Current time: Sun Oct 25 10:36:25 2026 [UTC: Sun Oct 25 09:36:25 2026]\r\n");
        let filler = "1.000 Sys [Info]: nothing to see here, just a line of the right length to fill\r\n";
        // Put the mission line across the first step's boundary.
        while log.len() + filler.len() < CHUNK_BYTES as usize - 20 {
            log.push_str(filler);
        }
        log.push_str("2.000 Script [Info]: ThemedSquadOverlay.lua: Mission name: Mot (Void)\r\n");
        for _ in 0..3000 {
            log.push_str(filler);
        }
        log.push_str("3.000 Sys [Info]: ResourceLoader 0x1 (/Lotus/Types/Game/Projections/T4VoidProjectionAxiA1Gold) Found 3 items\r\n");
        assert!(log.len() as u64 > CHUNK_BYTES);
        std::fs::write(&path, &log).unwrap();
        let mut f = LogFollower::default();
        let s = f.poll(&path).unwrap();
        assert_eq!(s.mission.as_deref(), Some("Mot (Void)"));
        assert_eq!(s.relics, vec!["/Lotus/Types/Game/Projections/T4VoidProjectionAxiA1Gold"]);
        assert!(f.carry.is_empty());
        // A line the game is still writing waits for its end.
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, b"9.000 Script [Info]: ThemedSquadOverlay.lua: Mission name: Hal").unwrap();
        assert_eq!(f.poll(&path).unwrap().mission.as_deref(), Some("Mot (Void)"));
        std::io::Write::write_all(&mut file, b"e (Void)\r\n").unwrap();
        assert_eq!(f.poll(&path).unwrap().mission.as_deref(), Some("Hale (Void)"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn garbled_uptimes_and_clocks_never_panic_or_invent_times() {
        let mut s = MissionState::default();
        s.observe("0.1 Sys [Diag]: Current time: Tue Oct 13 21:08:47 2026 [UTC: Tue Oct 13 19:08:47 2026]");
        s.observe("1e300 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)");
        s.observe("inf Script [Info]: ChatRedux.lua: ChatRedux::AddTab: Adding tab with channel name: FSomeone to index 6");
        assert_eq!(s.history[0].started_at, Some(1_791_918_527), "no usable uptime: the session start");
        assert_eq!(s.whispers[0].at, Some(1_791_918_527));
        assert_eq!(parse_utc_clock("x [UTC: Tue Oct 13 19:08:47 99999999999999999]"), None);
        assert_eq!(parse_utc_clock("x [UTC: Tue Oct 13 39:08:47 2026]"), None);
        // ctime pads one-digit days with a second space.
        assert_eq!(parse_utc_clock("x [UTC: Fri Oct  2 00:00:00 2026]"), Some(1_790_899_200));
    }
}

/// Fuzzing the log reader: random mixes of real log lines, cut short, joined with CR, CRLF or
/// bare CR, with odd Unicode, very long lines and garbled times. It must never panic, never invent
/// a sale, and read the same however the file arrives in pieces. A small seeded generator, so a
/// failure names the seed that replays it.
#[cfg(test)]
mod fuzz {
    use super::*;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            // xorshift64*
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() % n.max(1) as u64) as usize
        }
        fn chance(&mut self, p: f64) -> bool {
            (self.next() >> 11) as f64 / (1u64 << 53) as f64 <= p
        }
        fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
            xs[self.below(xs.len())]
        }
    }

    const PIECES: &[&str] = &[
        "0.107 Sys [Diag]: Current time: Tue Oct 13 21:08:47 2026 [UTC: Tue Oct 13 19:08:47 2026]",
        "2530.100 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)",
        "2535.221 Sys [Info]: ResourceLoader 0x1 (/Lotus/Types/Game/Projections/T2VoidProjectionGyrePrimeABronze) Found 19 items to load (0ms)",
        "2660.508 Sys [Info]: VoidProjections: OpenVoidProjectionRewardScreenRMI",
        "2660.858 Sys [Info]: VoidProjections: de1e7ed00000000000000011 gets reward /Lotus/StoreItems/Types/Recipes/Components/FormaBlueprint",
        "3127.384 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:",
        "Condition Overload (RARE RANK 0)",
        "Arcane Energize \u{E0B9}\u{E0B9}\u{E0B9}",
        "Vitus Essence x 2",
        "and will receive from Buyer1\u{E000} the following:",
        "Platinum x 17, title= leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)",
        "Platinum x 1,500, leftItem=/Menu/Confirm_Item_Ok)",
        "3131.276 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, title= leftItem=/Menu/Confirm_Item_Ok)",
        "3131.276 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade failed., leftItem=/Menu/Confirm_Item_Ok)",
        "300.5 Script [Info]: ChatRedux.lua: ChatRedux::AddTab: Adding tab with channel name: FBuyer1\u{E000} to index 6",
        // Garbled and hostile.
        "1e300 Script [Info]: ThemedSquadOverlay.lua: Mission name: Ukko (Void)",
        "inf Sys [Info]: nothing",
        "NaN Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!)",
        "-5.0 Sys [Diag]: Current time: x [UTC: Tue Oct 13 99:08:47 99999999999]",
        "12.5 Sys [Info]: \u{202E}evil\u{200B}\u{0000}\u{FFFD}",
        "Platinum x 99999999999999999999",
        "Platinum x 4294967295",
        "and will receive from \u{E000}\u{E001} the following:",
        "x",
        "",
    ];

    fn line(r: &mut Rng) -> String {
        let mut s = match r.below(10) {
            0 => {
                // Random characters, odd Unicode among them.
                let alphabet = ['a', ' ', '.', ':', '(', ')', ',', 'x', '1', '\u{E0B9}', '\u{202E}', '\u{0301}', '\u{1F600}', '\u{FFFD}', '\u{00A0}', 'ß', '\t'];
                (0..r.below(80)).map(|_| alphabet[r.below(alphabet.len())]).collect()
            }
            1 if r.chance(0.05) => "A".repeat(r.below(3) * 300_000 + 1),
            1 => "A".repeat(r.below(2000)),
            _ => r.pick(PIECES).to_string(),
        };
        // Cut short, at a character boundary.
        if r.chance(0.15) && !s.is_empty() {
            let mut at = r.below(s.len());
            while !s.is_char_boundary(at) {
                at -= 1;
            }
            s.truncate(at);
        }
        s
    }

    /// A log: lines joined with LF, CRLF or a bare CR (as the game does inside a dialog).
    fn log(r: &mut Rng) -> String {
        let mut out = String::new();
        for _ in 0..r.below(40) {
            out.push_str(&line(r));
            out.push_str(r.pick(&["\n", "\r\n", "\r", "\n", "\n"]));
        }
        out
    }

    fn seeds() -> impl Iterator<Item = u64> {
        let n: u64 = std::env::var("FUZZ_RUNS").ok().and_then(|v| v.parse().ok()).unwrap_or(400);
        let one: Option<u64> = std::env::var("FUZZ_SEED").ok().and_then(|v| v.parse().ok());
        let all: Vec<u64> = match one {
            Some(s) => vec![s],
            None => (0..n).map(|i| 0x5EED_0000 + i * 7919).collect(),
        };
        all.into_iter()
    }

    #[test]
    fn random_logs_never_panic_or_invent_a_sale() {
        for seed in seeds() {
            let mut r = Rng(seed | 1);
            let text = log(&mut r);
            let mut s = MissionState::default();
            for l in text.split('\n') {
                s.observe(l);
            }
            let asks = text.matches(TRADE_ASK).count();
            let done = text.matches(TRADE_DONE).count();
            assert!(s.trades.len() <= asks && s.trades.len() <= done, "FUZZ_SEED={seed}: {} trades from {asks} asks, {done} confirmations", s.trades.len());
            for t in &s.trades {
                assert!(!t.partner.chars().any(|c| ('\u{E000}'..='\u{F8FF}').contains(&c)), "FUZZ_SEED={seed}: glyph in {:?}", t.partner);
                for i in t.offered.iter().chain(t.received.iter()) {
                    assert!(i.count >= 1 && !i.name.is_empty() && !i.name.eq_ignore_ascii_case("platinum"), "FUZZ_SEED={seed}: {i:?}");
                }
                if let Some(at) = t.at {
                    assert!(at >= 0 && at < 253_402_300_800, "FUZZ_SEED={seed}: time {at}");
                }
            }
            assert!(s.whispers.iter().all(|w| !w.name.is_empty()), "FUZZ_SEED={seed}");
        }
    }

    #[test]
    fn a_dialog_cut_off_before_the_trade_went_through_is_no_sale() {
        let sale = "3127.384 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:\rCondition Overload (RARE RANK 0)\rand will receive from Buyer1 the following:\rPlatinum x 17, leftItem=/Menu/Confirm_Item_Ok)\n3131.276 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, leftItem=/Menu/Confirm_Item_Ok)\n";
        let done_at = sale.find(TRADE_DONE).unwrap();
        for seed in seeds() {
            let mut r = Rng(seed | 1);
            let cut = r.below(done_at + TRADE_DONE.len() - 1);
            let mut at = cut;
            while !sale.is_char_boundary(at) {
                at -= 1;
            }
            let mut s = MissionState::default();
            for l in sale[..at].split('\n') {
                s.observe(l);
            }
            // Then anything but a confirmation.
            for _ in 0..r.below(6) {
                let l = line(&mut r);
                if !l.contains(TRADE_DONE) {
                    s.observe(&l);
                }
            }
            assert!(s.trades.is_empty(), "FUZZ_SEED={seed}: a sale from a dialog cut at byte {at}");
        }
    }

    #[test]
    fn the_same_log_reads_the_same_however_it_arrives() {
        for seed in seeds().take(400) {
            let mut r = Rng(seed | 1);
            let text = log(&mut r);
            let bytes = text.as_bytes();
            let mut whole = LogFollower::default();
            whole.carry.extend_from_slice(bytes);
            whole.take_lines();
            let mut pieces = LogFollower::default();
            let mut i = 0;
            while i < bytes.len() {
                let most = if r.chance(0.5) { 8 } else { 4096 };
                let n = 1 + r.below(most);
                let end = (i + n).min(bytes.len());
                pieces.carry.extend_from_slice(&bytes[i..end]);
                pieces.take_lines();
                i = end;
            }
            assert_eq!(whole.state, pieces.state, "FUZZ_SEED={seed}");
        }
    }

    #[test]
    fn a_dialog_that_never_closes_does_not_grow_forever() {
        let mut s = MissionState::default();
        s.observe("10.0 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=Are you sure you want to accept this trade? You are offering:");
        for _ in 0..20_000 {
            s.observe("Condition Overload (RARE RANK 0) and some more text to make the line longer");
        }
        let held = s.trade_text.as_ref().map(|(_, t)| t.len()).unwrap_or(0);
        assert!(held < MAX_DIALOG_BYTES, "{held} bytes held for one trade dialog");
        // And it's no sale, whatever follows.
        s.observe("Platinum x 17, leftItem=/Menu/Confirm_Item_Ok)");
        s.observe("20.0 Script [Info]: Dialog.lua: Dialog::CreateOk(description=The trade was successful!, leftItem=/Menu/Confirm_Item_Ok)");
        assert!(s.trades.is_empty());
    }
}
