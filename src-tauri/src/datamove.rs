//! The app's folders under its new bundle identifier. Until the rename to MyOrbiter the identifier
//! was `dev.orbiter.app`, and Tauri names the settings, data, cache and log folders after it
//! (Linux: `~/.config/<id>`, `~/.local/share/<id>`, `~/.cache/<id>`; Windows: `%APPDATA%\<id>` and
//! `%LOCALAPPDATA%\<id>`). With a new identifier those folders start out empty, so on start, before
//! Tauri or anything else opens them, each old folder is copied to its new place once.
//!
//! The copy only ever adds: the old folders are never moved, changed or removed, and a new folder
//! that already holds anything is left as it is (so an earlier copy, or a start of the new version
//! before the old one was ever run, wins). A folder is copied under a temporary name beside its new
//! place and renamed into place only when complete, so a copy cut short is tried again next start
//! instead of leaving half a folder that would count as "already there".

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The bundle identifier before the rename.
pub const OLD_ID: &str = "dev.orbiter.app";
/// The bundle identifier now: the same as `identifier` in tauri.conf.json (a test checks it).
pub const ID: &str = "io.gitlab.sheziss-group.myorbiter";

/// What happened to one folder.
#[derive(Debug, PartialEq, Eq)]
pub enum Moved {
    /// Copied from the old folder.
    Copied,
    /// Nothing to do: no old folder, or the new one already holds something.
    Skipped,
}

/// What the start's copy did, for the log once it is open: (old folder, new folder, outcome).
static OUTCOME: OnceLock<Vec<(PathBuf, PathBuf, Result<Moved, String>)>> = OnceLock::new();

/// Copies each old folder to its new place, where the new one is missing or empty. Called first
/// thing in `run`, before Tauri starts.
pub fn run() {
    let outcome = pairs(&bases())
        .into_iter()
        .map(|(old, new)| {
            let r = copy_if_new_is_empty(&old, &new).map_err(|e| e.to_string());
            (old, new, r)
        })
        .collect();
    let _ = OUTCOME.set(outcome);
}

/// Writes what `run` did to the app's log: one line per folder copied or failed, none otherwise.
pub fn log_outcome() {
    for (old, new, r) in OUTCOME.get().map(Vec::as_slice).unwrap_or(&[]) {
        match r {
            Ok(Moved::Copied) => log::info!(target: "myorbiter::app", "copied {} to {} (the folder before the rename stays as it was)", old.display(), new.display()),
            Ok(Moved::Skipped) => {}
            Err(e) => log::warn!(target: "myorbiter::app", "copying {} to {} failed: {e}", old.display(), new.display()),
        }
    }
}

/// The folders Tauri puts an identifier's folders in, worked out the way Tauri does (the `dirs`
/// crate): config, data, local data and cache, and on macOS the logs. Some are the same folder
/// on some systems; `pairs` keeps one of each.
fn bases() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    #[cfg(windows)]
    {
        [env("APPDATA"), env("LOCALAPPDATA")].into_iter().flatten().collect()
    }
    #[cfg(target_os = "macos")]
    {
        let Some(home) = env("HOME") else { return Vec::new() };
        vec![home.join("Library/Application Support"), home.join("Library/Caches"), home.join("Library/Logs")]
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let home = env("HOME");
        let xdg = |var: &str, fallback: &str| {
            env(var).filter(|p| p.is_absolute()).or_else(|| home.as_ref().map(|h| h.join(fallback)))
        };
        [xdg("XDG_CONFIG_HOME", ".config"), xdg("XDG_DATA_HOME", ".local/share"), xdg("XDG_CACHE_HOME", ".cache")]
            .into_iter()
            .flatten()
            .collect()
    }
}

/// Each base folder once, as (old folder, new folder).
pub fn pairs(bases: &[PathBuf]) -> Vec<(PathBuf, PathBuf)> {
    let mut seen: Vec<&PathBuf> = Vec::new();
    let mut out = Vec::new();
    for base in bases {
        if seen.contains(&base) {
            continue;
        }
        seen.push(base);
        out.push((base.join(OLD_ID), base.join(ID)));
    }
    out
}

/// Copies `old` to `new` when `old` is a folder and `new` is missing or empty. Never touches `old`.
pub fn copy_if_new_is_empty(old: &Path, new: &Path) -> io::Result<Moved> {
    if !fs::symlink_metadata(old).is_ok_and(|m| m.is_dir()) {
        return Ok(Moved::Skipped);
    }
    match fs::read_dir(new) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                return Ok(Moved::Skipped);
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let Some(name) = new.file_name() else { return Err(io::Error::other("the new folder has no name")) };
    let mut partial = name.to_os_string();
    partial.push(format!(".partial-{}", std::process::id()));
    let partial = new.with_file_name(partial);
    let _ = fs::remove_dir_all(&partial);
    if let Err(e) = copy_dir(old, &partial) {
        let _ = fs::remove_dir_all(&partial);
        return Err(e);
    }
    // The new folder is empty here (checked above): an empty one is taken away so the copy can
    // take its place in one rename.
    if new.exists() {
        fs::remove_dir(new)?;
    }
    if let Err(e) = fs::rename(&partial, new) {
        let _ = fs::remove_dir_all(&partial);
        return Err(e);
    }
    Ok(Moved::Copied)
}

/// Copies a folder and everything in it, keeping each file's and folder's permissions (the
/// warframe.market sign-in file, when the system keyring isn't used, is readable only by you).
/// Symbolic links are copied as links on Unix and left out elsewhere.
fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
        } else if kind.is_symlink() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(fs::read_link(entry.path())?, &target)?;
        }
    }
    fs::set_permissions(to, fs::metadata(from)?.permissions())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh temporary folder for one test, removed when it ends.
    struct Temp(PathBuf);
    impl Temp {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("myorbiter-datamove-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Temp(dir)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fill_old(base: &Path) -> PathBuf {
        let old = base.join(OLD_ID);
        fs::create_dir_all(old.join("logs")).unwrap();
        fs::write(old.join("settings.json"), r#"{"a":1}"#).unwrap();
        fs::write(old.join("logs/orbiter.log"), "a line\n").unwrap();
        old
    }

    #[test]
    fn the_identifier_is_the_one_in_tauri_conf() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], ID);
        assert_ne!(OLD_ID, ID);
    }

    #[test]
    fn copies_everything_when_the_new_folder_is_missing() {
        let t = Temp::new("missing");
        let old = fill_old(&t.0);
        let new = t.0.join(ID);
        assert_eq!(copy_if_new_is_empty(&old, &new).unwrap(), Moved::Copied);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"a":1}"#);
        assert_eq!(fs::read_to_string(new.join("logs/orbiter.log")).unwrap(), "a line\n");
        // The old folder is still there, unchanged.
        assert_eq!(fs::read_to_string(old.join("settings.json")).unwrap(), r#"{"a":1}"#);
        assert_eq!(fs::read_to_string(old.join("logs/orbiter.log")).unwrap(), "a line\n");
        // No temporary folder left beside it.
        let names: Vec<_> = fs::read_dir(&t.0).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 2, "{names:?}");
    }

    #[test]
    fn copies_into_an_empty_new_folder() {
        let t = Temp::new("empty");
        let old = fill_old(&t.0);
        let new = t.0.join(ID);
        fs::create_dir_all(&new).unwrap();
        assert_eq!(copy_if_new_is_empty(&old, &new).unwrap(), Moved::Copied);
        assert!(new.join("settings.json").is_file());
    }

    #[test]
    fn leaves_a_new_folder_that_holds_anything() {
        let t = Temp::new("full");
        let old = fill_old(&t.0);
        let new = t.0.join(ID);
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        assert_eq!(copy_if_new_is_empty(&old, &new).unwrap(), Moved::Skipped);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert!(!new.join("logs").exists());
        // A second start finds the copy already there and does nothing.
        let t2 = Temp::new("twice");
        let old2 = fill_old(&t2.0);
        let new2 = t2.0.join(ID);
        assert_eq!(copy_if_new_is_empty(&old2, &new2).unwrap(), Moved::Copied);
        fs::write(old2.join("settings.json"), "changed later").unwrap();
        assert_eq!(copy_if_new_is_empty(&old2, &new2).unwrap(), Moved::Skipped);
        assert_eq!(fs::read_to_string(new2.join("settings.json")).unwrap(), r#"{"a":1}"#);
    }

    #[test]
    fn does_nothing_without_an_old_folder() {
        let t = Temp::new("none");
        let new = t.0.join(ID);
        assert_eq!(copy_if_new_is_empty(&t.0.join(OLD_ID), &new).unwrap(), Moved::Skipped);
        assert!(!new.exists());
        // A file where the old folder would be isn't a folder to copy.
        fs::write(t.0.join(OLD_ID), "not a folder").unwrap();
        assert_eq!(copy_if_new_is_empty(&t.0.join(OLD_ID), &new).unwrap(), Moved::Skipped);
        assert!(!new.exists());
    }

    #[cfg(unix)]
    #[test]
    fn keeps_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let t = Temp::new("perms");
        let old = fill_old(&t.0);
        fs::write(old.join("market-token"), "secret").unwrap();
        fs::set_permissions(old.join("market-token"), fs::Permissions::from_mode(0o600)).unwrap();
        fs::set_permissions(&old, fs::Permissions::from_mode(0o700)).unwrap();
        let new = t.0.join(ID);
        assert_eq!(copy_if_new_is_empty(&old, &new).unwrap(), Moved::Copied);
        assert_eq!(fs::metadata(new.join("market-token")).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(&new).unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_copy_leaves_no_new_folder_and_is_tried_again() {
        use std::os::unix::fs::PermissionsExt;
        // Root reads everything, so the unreadable file below wouldn't fail for it.
        if fs::read_to_string("/proc/self/status").is_ok_and(|s| s.lines().any(|l| l.starts_with("Uid:") && l.split_whitespace().nth(1) == Some("0"))) {
            return;
        }
        let t = Temp::new("fail");
        let old = fill_old(&t.0);
        fs::write(old.join("unreadable"), "x").unwrap();
        fs::set_permissions(old.join("unreadable"), fs::Permissions::from_mode(0o000)).unwrap();
        let new = t.0.join(ID);
        assert!(copy_if_new_is_empty(&old, &new).is_err());
        assert!(!new.exists(), "half a copy would count as already there");
        let names: Vec<_> = fs::read_dir(&t.0).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "no temporary folder left: {names:?}");
        fs::set_permissions(old.join("unreadable"), fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(copy_if_new_is_empty(&old, &new).unwrap(), Moved::Copied);
        assert!(new.join("unreadable").is_file());
    }

    #[test]
    fn one_pair_per_base_folder() {
        let a = PathBuf::from("/base/a");
        let b = PathBuf::from("/base/b");
        let p = pairs(&[a.clone(), b.clone(), a.clone()]);
        assert_eq!(p, vec![(a.join(OLD_ID), a.join(ID)), (b.join(OLD_ID), b.join(ID))]);
    }
}
