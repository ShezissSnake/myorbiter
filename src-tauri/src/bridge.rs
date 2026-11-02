//! Two small files shared with a patched TennoScope during the void fissure reward screen.
//!
//! TennoScope reads the reward cards off the screen and writes their names to
//! `tennoscope-reward-screen.json`; orbiter scores them and writes `orbiter-reward-pick.json`,
//! which TennoScope's overlay shows over the game. Both live in the user's runtime directory
//! (`$XDG_RUNTIME_DIR`, private to the user and cleared at logout). Without one they go in a
//! folder of the temp dir that only this user can open (`tennoscope-orbiter-<uid>`), and if that
//! folder isn't safe (someone else made it, or others can read it) the bridge stays off.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const CARDS_FILE: &str = "tennoscope-reward-screen.json";
pub const PICK_FILE: &str = "orbiter-reward-pick.json";
/// Your overlay settings (which overlays show, what the reward cards show), read by TennoScope.
pub const OVERLAY_FILE: &str = "orbiter-overlay.json";
/// A riven being cycled, both rolls and which to keep, for TennoScope to show over the game.
pub const RIVEN_FILE: &str = "orbiter-riven-cycle.json";
/// The relics as the official drop tables have them, for TennoScope's reward-card reader: its own
/// list is a fixed snapshot that knows no relic added since (a new Prime Access's Axi S21).
pub const RELICS_FILE: &str = "orbiter-relics.json";

/// Where the shared files go, or `None` if there is nowhere private to put them.
pub fn runtime_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).filter(|p| p.is_dir()) {
        return Some(dir);
    }
    private_dir_in(&std::env::temp_dir(), uid())
}

#[cfg(unix)]
fn uid() -> u32 {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}
#[cfg(not(unix))]
fn uid() -> u32 {
    0
}

/// `<tmp>/tennoscope-orbiter-<uid>`, made private to this user, and only used if it still is.
/// TennoScope's patch makes the same folder the same way.
#[cfg(unix)]
pub fn private_dir_in(tmp: &Path, uid: u32) -> Option<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt};
    let dir = tmp.join(format!("tennoscope-orbiter-{uid}"));
    let _ = fs::DirBuilder::new().mode(0o700).create(&dir);
    // symlink_metadata: a link planted by someone else is refused, not followed.
    let meta = fs::symlink_metadata(&dir).ok()?;
    (meta.is_dir() && meta.uid() == uid && meta.mode() & 0o077 == 0).then_some(dir)
}
#[cfg(not(unix))]
pub fn private_dir_in(tmp: &Path, _uid: u32) -> Option<PathBuf> {
    let dir = tmp.join("tennoscope-orbiter");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// What TennoScope saw: the card names in screen order, and when (unix ms). No cards: the screen closed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScreenCards {
    pub at: u64,
    pub cards: Vec<String>,
    /// The live prices the overlay shows, by card name, once TennoScope has them.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub prices: std::collections::BTreeMap<String, u32>,
}

pub fn read_cards_in(dir: &Path) -> Option<ScreenCards> {
    let text = fs::read_to_string(dir.join(CARDS_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Written whole and renamed into place, so TennoScope never reads half a file. Each write has a
/// temp file of its own: two picks written at once mustn't share (and fail on) one.
pub fn write_pick_in(dir: &Path, pick: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(pick).map_err(|e| e.to_string())?;
    crate::write_atomic(&dir.join(PICK_FILE), &bytes, false).map_err(|e| e.to_string())
}

/// Written when a read of the inventory shows a riven cycle waiting; TennoScope shows it until `until`.
pub fn write_riven_in(dir: &Path, cycle: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(cycle).map_err(|e| e.to_string())?;
    crate::write_atomic(&dir.join(RIVEN_FILE), &bytes, false).map_err(|e| e.to_string())
}

/**
 * orbiter's relic data (relicdata.rs) the way TennoScope reads a relic list (WFCD's Relics.json):
 * one record per relic and refinement, by its in-game path, with its rewards' names and whether
 * it's vaulted (in no drop table; Requiem relics never are). Relics with no known path are left
 * out: TennoScope finds relics by path.
 */
pub fn relics_for_tennoscope(data: &Value) -> Value {
    let mut path_of: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
    if let Some(paths) = data["paths"].as_object() {
        for (path, name) in paths {
            if let Some(n) = name.as_str() {
                path_of.entry(n).or_default().push(path.as_str());
            }
        }
    }
    let drops = data["drops"].as_object();
    let mut out = Vec::new();
    for relic in data["relics"].as_array().into_iter().flatten() {
        let Some(name) = relic["name"].as_str() else { continue };
        let Some(paths) = path_of.get(name) else { continue };
        // "Axi S21 Radiant" → "Axi S21": what the drop places are listed under.
        let base = name.rsplit_once(' ').map_or(name, |(b, _)| b);
        let vaulted = !base.starts_with("Requiem ") && !drops.is_some_and(|d| d.get(base).and_then(Value::as_array).is_some_and(|a| !a.is_empty()));
        let rewards: Vec<Value> = relic["rewards"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| Some(serde_json::json!({ "rarity": r["rarity"], "chance": r["chance"], "item": { "name": r["name"].as_str()? } })))
            .collect();
        if rewards.is_empty() {
            continue;
        }
        for path in paths {
            out.push(serde_json::json!({ "uniqueName": path, "name": name, "vaulted": vaulted, "rewards": rewards }));
        }
    }
    Value::Array(out)
}

/// Written when orbiter starts (from its cached tables) and whenever the tables are read again.
pub fn write_relics_in(dir: &Path, data: &Value) -> Result<(), String> {
    let list = relics_for_tennoscope(data);
    if !list.as_array().is_some_and(|a| !a.is_empty()) {
        return Err("no relics with a known path".into());
    }
    let bytes = serde_json::to_vec(&list).map_err(|e| e.to_string())?;
    crate::write_atomic(&dir.join(RELICS_FILE), &bytes, false).map_err(|e| e.to_string())
}

/// Written whenever the overlay settings change; TennoScope reads it when it's about to draw.
pub fn write_overlay_in(dir: &Path, prefs: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(prefs).map_err(|e| e.to_string())?;
    crate::write_atomic(&dir.join(OVERLAY_FILE), &bytes, false).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relics_go_to_tennoscope_by_path_with_vaulting() {
        let data = serde_json::json!({
            "relics": [
                { "name": "Axi S21 Radiant", "rewards": [{ "name": "Gyre Prime Blueprint", "chance": 20, "rarity": "Uncommon" }] },
                { "name": "Lith A1 Intact", "rewards": [{ "name": "Forma Blueprint", "chance": 25.33, "rarity": "Common" }] },
                { "name": "Requiem I Intact", "rewards": [{ "name": "Kuva", "chance": 25.33, "rarity": "Common" }] },
                { "name": "Neo Z9 Intact", "rewards": [{ "name": "Unknown Part", "chance": 2, "rarity": "Rare" }] }
            ],
            "drops": { "Axi S21": [{ "location": "Void/Mot", "chance": 0.25 }], "Lith A1": [] },
            "paths": {
                "/Lotus/Types/Game/Projections/T4VoidProjectionCitrinePrimeAPlatinum": "Axi S21 Radiant",
                "/Lotus/Types/Game/Projections/T1VoidProjectionABronze": "Lith A1 Intact",
                "/Lotus/Types/Game/Projections/T5VoidProjectionRequiemIBronze": "Requiem I Intact"
            }
        });
        let list = relics_for_tennoscope(&data);
        let by = |p: &str| list.as_array().unwrap().iter().find(|r| r["uniqueName"].as_str().unwrap().ends_with(p)).cloned().unwrap();
        let s21 = by("CitrinePrimeAPlatinum");
        assert_eq!(s21["rewards"][0]["item"]["name"], "Gyre Prime Blueprint");
        assert_eq!(s21["vaulted"], false);
        assert_eq!(by("T1VoidProjectionABronze")["vaulted"], true, "drops nowhere: vaulted");
        assert_eq!(by("RequiemIBronze")["vaulted"], false, "Requiem relics never are");
        assert_eq!(list.as_array().unwrap().len(), 3, "a relic with no known path is left out");
    }

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("orbiter-bridge-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_cards_in(&dir), None);
        fs::write(dir.join(CARDS_FILE), r#"{"at": 5, "cards": ["Rhino Prime Systems", "Forma Blueprint"]}"#).unwrap();
        assert_eq!(read_cards_in(&dir), Some(ScreenCards { at: 5, cards: vec!["Rhino Prime Systems".into(), "Forma Blueprint".into()], prices: Default::default() }));
        fs::write(dir.join(CARDS_FILE), "{not json").unwrap();
        assert_eq!(read_cards_in(&dir), None);
        write_pick_in(&dir, &serde_json::json!({"best": 1})).unwrap();
        assert_eq!(fs::read_to_string(dir.join(PICK_FILE)).unwrap(), r#"{"best":1}"#);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn private_dir_is_made_private_and_checked() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = std::env::temp_dir().join(format!("orbiter-private-{}", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();
        let me = uid();
        let dir = private_dir_in(&tmp, me).expect("made");
        assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        // Opened up to others: refused.
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(private_dir_in(&tmp, me), None);
        // Someone else's uid: refused (the folder is ours, not theirs).
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        fs::rename(&dir, tmp.join(format!("tennoscope-orbiter-{}", me + 1))).unwrap();
        assert_eq!(private_dir_in(&tmp, me + 1), None);
        // A symlink in its place: refused.
        std::os::unix::fs::symlink(&tmp, tmp.join(format!("tennoscope-orbiter-{me}"))).unwrap();
        assert_eq!(private_dir_in(&tmp, me), None);
        fs::remove_dir_all(&tmp).unwrap();
    }
}
