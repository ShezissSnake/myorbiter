//! Hand-off to orbiter (a companion app) during the void fissure reward screen.
//!
//! When the cards are read, their names go to `tennoscope-reward-screen.json`; orbiter scores them
//! by the player's own priorities and writes `orbiter-reward-pick.json`, which the overlay shows.
//! Both files live in the user's runtime directory (`$XDG_RUNTIME_DIR`). Without one they go in a
//! temp-dir folder only this user can open (`tennoscope-orbiter-<uid>`), and if that folder isn't
//! safe the hand-off stays off. Without orbiter running nothing changes: the overlay just finds no
//! pick.
//!
//! orbiter can also start TennoScope with `--background`, which keeps the main window hidden.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CARDS_FILE: &str = "tennoscope-reward-screen.json";
pub const PICK_FILE: &str = "orbiter-reward-pick.json";
/// TennoScope's health, account and market status, for orbiter to show.
pub const STATUS_FILE: &str = "tennoscope-status.json";
/// A riven cycle orbiter wants shown over the game: both rolls and which to keep.
pub const RIVEN_FILE: &str = "orbiter-riven-cycle.json";

/// Something orbiter asks of a running TennoScope, by starting it again with a flag (the
/// single-instance plugin hands the arguments to the running one).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ask {
    /// Read the inventory now (Full access only).
    Sync,
    /// Set the warframe.market status; `auto` follows the game.
    Presence {
        status: Option<warframe_status::Presence>,
        auto: bool,
    },
    /// Open the system's screen-capture permission dialog.
    AuthorizeCapture,
    /// Change the access mode (`--access=full`, `overlay` or `companion`): orbiter's "Read my
    /// inventory (Full mode)" switch, in its setup and Settings, which show the account-risk
    /// warning beside it. The same transition as choosing it in this window.
    Access(crate::AccessMode),
}

pub fn asks(args: &[String]) -> Vec<Ask> {
    use warframe_status::Presence;
    args.iter()
        .skip(1)
        .filter_map(|a| match a.as_str() {
            "--sync" => Some(Ask::Sync),
            "--authorize-capture" => Some(Ask::AuthorizeCapture),
            "--access=full" => Some(Ask::Access(crate::AccessMode::Full)),
            "--access=overlay" => Some(Ask::Access(crate::AccessMode::Overlay)),
            "--access=companion" => Some(Ask::Access(crate::AccessMode::Companion)),
            _ => match a.strip_prefix("--presence=")? {
                "online" => Some(Ask::Presence {
                    status: Some(Presence::Online),
                    auto: false,
                }),
                "ingame" => Some(Ask::Presence {
                    status: Some(Presence::Ingame),
                    auto: false,
                }),
                "invisible" => Some(Ask::Presence {
                    status: Some(Presence::Invisible),
                    auto: false,
                }),
                "offline" => Some(Ask::Presence {
                    status: None,
                    auto: false,
                }),
                "auto" => Some(Ask::Presence {
                    status: None,
                    auto: true,
                }),
                _ => None,
            },
        })
        .collect()
}

static LAST_ERROR: std::sync::Mutex<Option<(u64, String)>> = std::sync::Mutex::new(None);

/// The last request from orbiter that failed, and when (unix ms), for orbiter to show.
pub fn note_error(message: String) {
    if let Ok(mut slot) = LAST_ERROR.lock() {
        *slot = Some((now_ms(), message));
    }
}

pub fn last_error() -> Option<serde_json::Value> {
    let slot = LAST_ERROR.lock().ok()?;
    slot.as_ref()
        .map(|(at, message)| serde_json::json!({ "at": at, "message": message }))
}

/// Written every few seconds while TennoScope runs.
pub fn publish_status(status: serde_json::Value) {
    let Some(dir) = runtime_dir() else { return };
    let mut body = status;
    if let Some(map) = body.as_object_mut() {
        map.insert("at".into(), now_ms().into());
        map.insert("pid".into(), std::process::id().into());
    }
    let tmp = dir.join(format!(".{STATUS_FILE}.{}", std::process::id()));
    if fs::write(&tmp, body.to_string()).is_ok() {
        let _ = fs::rename(&tmp, dir.join(STATUS_FILE));
    }
}

/// orbiter's answer, kept only while it is about the cards on screen now.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OrbiterPick {
    pub at: u64,
    pub cards: Vec<String>,
    pub scores: Vec<u32>,
    pub best: Option<usize>,
    #[serde(default)]
    pub reasons: Vec<Vec<String>>,
    /// Where each card can still be had: "vaulted", "resurgence" or "farmable" (null when not a part).
    #[serde(default)]
    pub vault: Vec<Option<String>>,
}

/// orbiter's overlay settings: which overlays to show at all, and what the reward cards show.
pub const OVERLAY_FILE: &str = "orbiter-overlay.json";

/// orbiter's overlay settings as it wrote them, whether or not orbiter is running now: they are
/// the player's choice either way. Nothing when orbiter never wrote any.
pub fn overlay_prefs() -> Option<serde_json::Value> {
    serde_json::from_str(&fs::read_to_string(runtime_dir()?.join(OVERLAY_FILE)).ok()?).ok()
}

/// Whether the player lets this overlay ("reward" or "kiosk") show: yes unless orbiter's settings
/// turned it off.
pub fn overlay_enabled(kind: &str) -> bool {
    enabled_in(overlay_prefs().as_ref(), kind)
}

fn enabled_in(prefs: Option<&serde_json::Value>, kind: &str) -> bool {
    prefs
        .and_then(|p| p.get(kind))
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// The relics as the official drop tables have them now, from orbiter, in the shape of WFCD's
/// Relics.json. The relic list TennoScope fetches is a fixed snapshot, so it knows no relic added
/// since (a new Prime Access's): read from it alone, those cards fall to the nearest name it does know.
pub const RELICS_FILE: &str = "orbiter-relics.json";

/// orbiter's relic tables, when it has written them.
pub fn read_relics() -> Option<Vec<u8>> {
    fs::read(runtime_dir()?.join(RELICS_FILE)).ok()
}

fn runtime_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
    {
        return Some(dir);
    }
    private_dir_in(&std::env::temp_dir())
}

/// `<tmp>/tennoscope-orbiter-<uid>`, made private to this user and only used while it still is
/// (orbiter makes the same folder the same way).
#[cfg(unix)]
fn private_dir_in(tmp: &Path) -> Option<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    // /proc/self belongs to this process's user.
    let uid = fs::metadata("/proc/self").ok()?.uid();
    let dir = tmp.join(format!("tennoscope-orbiter-{uid}"));
    let _ = fs::DirBuilder::new().mode(0o700).create(&dir);
    let meta = fs::symlink_metadata(&dir).ok()?;
    (meta.is_dir() && meta.uid() == uid && meta.mode() & 0o077 == 0).then_some(dir)
}

#[cfg(not(unix))]
fn private_dir_in(tmp: &Path) -> Option<PathBuf> {
    let dir = tmp.join("tennoscope-orbiter");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The cards on screen in order, or none once the screen has closed. Best effort: a failed write
/// only means orbiter has nothing to score.
pub fn publish_cards(names: &[String]) {
    let at = now_ms();
    if let Ok(mut last) = LAST_CARDS.lock() {
        *last = Some((at, names.to_vec()));
    }
    if let Some(dir) = runtime_dir() {
        let _ = write_cards_in(&dir, names, at, None);
    }
}

/// The cards just published, so their prices can follow under the same timestamp: orbiter sees
/// one reward screen, priced a moment later, not a second screen.
static LAST_CARDS: std::sync::Mutex<Option<(u64, Vec<String>)>> = std::sync::Mutex::new(None);

/// The live prices the overlay shows on the cards, once fetched, for orbiter to score with the
/// same numbers. Ignored if the screen has moved on to other cards.
pub fn publish_card_prices(names: &[String], prices: &std::collections::BTreeMap<String, u32>) {
    let Some(at) = LAST_CARDS
        .lock()
        .ok()
        .and_then(|last| last.as_ref().filter(|(_, n)| n == names).map(|(at, _)| *at))
    else {
        return;
    };
    if let Some(dir) = runtime_dir() {
        let _ = write_cards_in(&dir, names, at, Some(prices));
    }
}

fn write_cards_in(
    dir: &Path,
    names: &[String],
    at: u64,
    prices: Option<&std::collections::BTreeMap<String, u32>>,
) -> std::io::Result<()> {
    let mut body = serde_json::json!({ "at": at, "cards": names });
    if let Some(prices) = prices {
        body["prices"] = serde_json::json!(prices);
    }
    let tmp = dir.join(format!(".{CARDS_FILE}.{}", std::process::id()));
    fs::write(&tmp, body.to_string())?;
    fs::rename(&tmp, dir.join(CARDS_FILE))
}

/// orbiter writes this every few seconds while it holds the player's warframe.market status.
pub const PRESENCE_HELD_FILE: &str = "orbiter-presence.json";
/// Older than this, orbiter has stopped holding it (quit, or crashed without tidying up).
const PRESENCE_HELD_FRESH_MS: u64 = 15_000;

/// Whether orbiter is holding the warframe.market status right now. While it is, TennoScope keeps
/// no status connection of its own and refuses status changes: two clients setting status for one
/// account would undo each other, and the player chose to manage it from orbiter.
pub fn orbiter_holds_presence() -> bool {
    let Some(dir) = runtime_dir() else {
        return false;
    };
    let Ok(text) = fs::read_to_string(dir.join(PRESENCE_HELD_FILE)) else {
        return false;
    };
    held_in(&text, now_ms(), |pid| {
        !cfg!(target_os = "linux") || Path::new(&format!("/proc/{pid}")).exists()
    })
}

fn held_in(text: &str, now: u64, alive: impl Fn(u64) -> bool) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return false;
    };
    let fresh = v
        .get("at")
        .and_then(|a| a.as_u64())
        .is_some_and(|at| now.saturating_sub(at) < PRESENCE_HELD_FRESH_MS);
    let running = v.get("pid").and_then(|p| p.as_u64()).is_none_or(&alive);
    fresh && running
}

/// Started by an orbiter that carries this TennoScope inside it (`ORBITER_BUNDLED` is set): its
/// updates come with orbiter's.
pub fn bundled_in_orbiter() -> bool {
    std::env::var_os("ORBITER_BUNDLED").is_some()
}

/// Started with `--background` (or only to pass orbiter a request): keep the main window hidden.
pub fn wants_background(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == "--background") || !asks(args).is_empty()
}

pub fn read_pick() -> Option<OrbiterPick> {
    read_pick_in(&runtime_dir()?)
}

fn read_pick_in(dir: &Path) -> Option<OrbiterPick> {
    let pick: OrbiterPick =
        serde_json::from_str(&fs::read_to_string(dir.join(PICK_FILE)).ok()?).ok()?;
    // A pick for an earlier screen is no pick at all.
    (pick.scores.len() == pick.cards.len() && now_ms().saturating_sub(pick.at) < 120_000)
        .then_some(pick)
}

/// The riven cycle orbiter wrote, while it's to be shown: passed to the overlay as orbiter wrote it.
/// Only `key` (which cycle) and `until` (when to stop showing it, unix ms) are read here.
pub fn read_riven() -> Option<serde_json::Value> {
    read_riven_in(&runtime_dir()?, now_ms())
}

fn read_riven_in(dir: &Path, now: u64) -> Option<serde_json::Value> {
    let v: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join(RIVEN_FILE)).ok()?).ok()?;
    v.get("key")?.as_str()?;
    let until = v.get("until")?.as_u64()?;
    // Never more than two minutes ahead: a clock gone wrong mustn't pin it over the game.
    (now < until && until - now <= 120_000).then_some(v)
}

#[cfg(test)]
mod tests {

    #[test]
    fn orbiters_relic_tables_read_as_a_relic_list() {
        // What orbiter writes (bridge.rs, relics_for_tennoscope): a relic TennoScope's own
        // snapshot doesn't have, by path, with its rewards and whether it's vaulted.
        let json = br#"[
            {"uniqueName": "/Lotus/Types/Game/Projections/T4VoidProjectionCitrinePrimeAPlatinum", "name": "Axi S21 Radiant", "vaulted": false,
             "rewards": [{"rarity": "Uncommon", "chance": 20, "item": {"name": "Gyre Prime Blueprint"}}, {"rarity": "Rare", "chance": 10, "item": {"name": "Steflos Prime Barrel"}}]},
            {"uniqueName": "/Lotus/Types/Game/Projections/T1VoidProjectionABronze", "name": "Lith A1 Intact", "vaulted": true,
             "rewards": [{"rarity": "Common", "chance": 25.33, "item": {"name": "Akstiletto Prime Barrel"}}]}
        ]"#;
        let index = warframe_acquisition::RelicRewardIndex::from_wfcd_json(json).unwrap();
        let names: Vec<&str> = index.reward_names().collect();
        assert!(names.contains(&"Gyre Prime Blueprint"));
        assert!(index.is_vaulted("Akstiletto Prime Barrel"));
        assert!(!index.is_vaulted("Gyre Prime Blueprint"));
    }

    use super::*;

    #[test]
    fn a_riven_cycle_shows_until_its_time_is_up() {
        let dir = std::env::temp_dir().join(format!("tennoscope-riven-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let now = 1_800_000_000_000;
        let write = |v: serde_json::Value| fs::write(dir.join(RIVEN_FILE), v.to_string()).unwrap();
        write(serde_json::json!({ "key": "r|4", "until": now + 20_000, "weapon": "Rubico" }));
        assert_eq!(read_riven_in(&dir, now).unwrap()["weapon"], "Rubico");
        assert!(
            read_riven_in(&dir, now + 20_000).is_none(),
            "its time is up"
        );
        write(serde_json::json!({ "key": "r|4", "until": now + 600_000 }));
        assert!(read_riven_in(&dir, now).is_none(), "too far ahead to trust");
        write(serde_json::json!({ "until": now + 20_000 }));
        assert!(read_riven_in(&dir, now).is_none(), "no key");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_overlay_shows_unless_orbiter_turned_it_off() {
        let prefs = serde_json::json!({ "reward": false, "kiosk": true });
        assert!(!enabled_in(Some(&prefs), "reward"));
        assert!(enabled_in(Some(&prefs), "kiosk"));
        assert!(enabled_in(None, "reward"), "no settings: everything shows");
        assert!(enabled_in(Some(&serde_json::json!({})), "kiosk"));
    }

    #[test]
    fn asks_from_flags() {
        use warframe_status::Presence;
        let args = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(asks(&args(&["tennoscope", "--sync"])), vec![Ask::Sync]);
        assert_eq!(
            asks(&args(&[
                "tennoscope",
                "--presence=ingame",
                "--presence=auto",
                "--presence=nope"
            ])),
            vec![
                Ask::Presence {
                    status: Some(Presence::Ingame),
                    auto: false
                },
                Ask::Presence {
                    status: None,
                    auto: true
                }
            ]
        );
        assert_eq!(asks(&args(&["tennoscope", "--background"])), vec![]);
        assert!(wants_background(&args(&["tennoscope", "--sync"])));
        assert_eq!(
            asks(&args(&[
                "tennoscope",
                "--access=full",
                "--access=overlay",
                "--access=companion",
                "--access=everything"
            ])),
            vec![
                Ask::Access(crate::AccessMode::Full),
                Ask::Access(crate::AccessMode::Overlay),
                Ask::Access(crate::AccessMode::Companion)
            ]
        );
        assert!(wants_background(&args(&["tennoscope", "--access=full"])));
    }

    #[test]
    fn background_flag() {
        let args = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(wants_background(&args(&["tennoscope", "--background"])));
        assert!(!wants_background(&args(&["tennoscope"])));
        assert!(
            !wants_background(&args(&["--background"])),
            "the program path is not a flag"
        );
    }

    #[test]
    fn cards_out_pick_in() {
        let dir = std::env::temp_dir().join(format!("tennoscope-orbiter-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        write_cards_in(
            &dir,
            &["Corinth Prime Barrel".into(), "Forma Blueprint".into()],
            7,
            None,
        )
        .unwrap();
        let cards: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(CARDS_FILE)).unwrap()).unwrap();
        assert_eq!(
            cards,
            serde_json::json!({ "at": 7, "cards": ["Corinth Prime Barrel", "Forma Blueprint"] })
        );
        // The live prices follow under the same timestamp.
        let prices =
            std::collections::BTreeMap::from([("Corinth Prime Barrel".to_string(), 38u32)]);
        write_cards_in(
            &dir,
            &["Corinth Prime Barrel".into(), "Forma Blueprint".into()],
            7,
            Some(&prices),
        )
        .unwrap();
        let cards: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join(CARDS_FILE)).unwrap()).unwrap();
        assert_eq!(cards["at"], 7);
        assert_eq!(cards["prices"]["Corinth Prime Barrel"], 38);

        assert_eq!(read_pick_in(&dir), None);
        let fresh = serde_json::json!({ "at": now_ms(), "cards": ["A", "B"], "scores": [70, 12], "best": 0, "reasons": [["38p"], []] });
        fs::write(dir.join(PICK_FILE), fresh.to_string()).unwrap();
        assert_eq!(read_pick_in(&dir).unwrap().best, Some(0));
        let stale = serde_json::json!({ "at": 1, "cards": ["A"], "scores": [70], "best": 0 });
        fs::write(dir.join(PICK_FILE), stale.to_string()).unwrap();
        assert_eq!(read_pick_in(&dir), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn orbiter_holds_presence_only_while_fresh_and_running() {
        let beat = r#"{"at": 100000, "pid": 42, "status": "online"}"#;
        assert!(held_in(beat, 105_000, |_| true));
        assert!(
            !held_in(beat, 120_000, |_| true),
            "stale: orbiter stopped writing it"
        );
        assert!(
            !held_in(beat, 105_000, |_| false),
            "orbiter's process is gone"
        );
        assert!(!held_in("{oops", 105_000, |_| true));
    }
}
