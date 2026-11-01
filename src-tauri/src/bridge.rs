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

/// Where the shared files go, or `None` if there is nowhere private to put them.
pub fn runtime_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
    {
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

/// Written whenever the overlay settings change; TennoScope reads it when it's about to draw.
pub fn write_overlay_in(dir: &Path, prefs: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(prefs).map_err(|e| e.to_string())?;
    crate::write_atomic(&dir.join(OVERLAY_FILE), &bytes, false).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("orbiter-bridge-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_cards_in(&dir), None);
        fs::write(
            dir.join(CARDS_FILE),
            r#"{"at": 5, "cards": ["Rhino Prime Systems", "Forma Blueprint"]}"#,
        )
        .unwrap();
        assert_eq!(
            read_cards_in(&dir),
            Some(ScreenCards {
                at: 5,
                cards: vec!["Rhino Prime Systems".into(), "Forma Blueprint".into()],
                prices: Default::default()
            })
        );
        fs::write(dir.join(CARDS_FILE), "{not json").unwrap();
        assert_eq!(read_cards_in(&dir), None);
        write_pick_in(&dir, &serde_json::json!({"best": 1})).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join(PICK_FILE)).unwrap(),
            r#"{"best":1}"#
        );
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
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
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
