//! The app's folders under its new bundle identifier. Until the rename to MyOrbiter the identifier
//! was `dev.orbiter.app`, and Tauri names the settings, data, cache and log folders after it
//! (Linux: `~/.config/<id>`, `~/.local/share/<id>`, `~/.cache/<id>`; Windows: `%APPDATA%\<id>` and
//! `%LOCALAPPDATA%\<id>`). With a new identifier those folders start out empty, so on start, before
//! Tauri or anything else opens them, each old folder is copied to its new place once.
//!
//! The old folders are only ever read: never moved, changed or removed. A folder is copied under a
//! temporary name beside its new place, a marker file (`MARKER`) is put in it, and it is renamed
//! into place only when complete. The marker is what says the folder is settled, not whether it
//! holds anything: a copy that fails (a file held open by an old copy of the app, say) leaves the
//! new folder without one, the start goes on and writes its defaults there, and the next start
//! copies again. What that start wrote is kept beside it, renamed (`<id>.before-copy-<n>`), never
//! removed. Where there is no old folder the marker is written too, so an old folder that turns up
//! later (an older version run after this one) isn't copied over what this one wrote.
//!
//! This runs before the single-instance check hands a second start over to the running app, so two
//! lock files beside the config folder keep starts apart: `<id>.copy.lock`, held while a start
//! copies (a second start waits for it), and `<id>.lock`, held for as long as the app runs. A start
//! that finds the app running copies nothing, so it never sets aside a folder in use.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// The bundle identifier before the rename.
pub const OLD_ID: &str = "dev.orbiter.app";
/// The bundle identifier now: the same as `identifier` in tauri.conf.json (a test checks it).
pub const ID: &str = "dev.myorbiter.app";
/// The file in a new folder that says its copy is settled.
pub const MARKER: &str = ".copied-from-dev.orbiter.app";
const MARKER_TEXT: &str = "MyOrbiter copied this folder from dev.orbiter.app, its folder before the rename, or found nothing to copy.\nWhile this file is here it doesn't copy again. The old folder was left as it was.\n";

/// What happened to one folder.
#[derive(Debug, PartialEq, Eq)]
pub enum Moved {
    /// Copied from the old folder.
    Copied,
    /// Copied from the old folder, after an earlier start whose copy failed had written to the new
    /// one: what it wrote is kept under this name.
    CopiedSettingAside(PathBuf),
    /// Nothing to do: already settled, or no old folder.
    Skipped,
}

/// What the start's copy did, for the log once it is open: (old folder, new folder, outcome).
static OUTCOME: OnceLock<Vec<(PathBuf, PathBuf, Result<Moved, String>)>> = OnceLock::new();

/// The running lock, kept open (and so locked) until the app exits.
static RUNNING: OnceLock<fs::File> = OnceLock::new();

/// The outcome of trying a lock without waiting.
#[derive(Debug)]
pub enum Lock {
    /// Taken: kept for as long as the file stays open.
    Held(fs::File),
    /// Another process holds it.
    Busy,
    /// The lock file can't be made or locked.
    Unavailable,
}

fn open_lock(path: &Path) -> io::Result<fs::File> {
    fs::OpenOptions::new().create(true).truncate(false).write(true).open(path)
}

/// Takes the lock at `path`, without waiting.
pub fn lock(path: &Path) -> Lock {
    let Ok(file) = open_lock(path) else { return Lock::Unavailable };
    match file.try_lock() {
        Ok(()) => Lock::Held(file),
        Err(fs::TryLockError::WouldBlock) => Lock::Busy,
        Err(fs::TryLockError::Error(_)) => Lock::Unavailable,
    }
}

/// Takes the lock at `path`, waiting up to `limit` while another process holds it; None if it
/// can't be made or is still held then (a start stopped mid-copy mustn't hold up every later one).
pub fn lock_waiting(path: &Path, limit: Duration) -> Option<fs::File> {
    let file = open_lock(path).ok()?;
    let started = std::time::Instant::now();
    loop {
        match file.try_lock() {
            Ok(()) => return Some(file),
            Err(fs::TryLockError::WouldBlock) if started.elapsed() < limit => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => return None,
        }
    }
}

/// What this start may do to the new folders.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum May {
    /// Copy, and set aside an unmarked folder: no other MyOrbiter is running or copying.
    SetAside,
    /// Copy into a missing or empty folder only: the locks can't be made, so another start might be
    /// using a folder.
    CopyOnly,
    /// Nothing: another MyOrbiter is running.
    Nothing,
}

/// Decides from the two locks. `wait` is for an app that restarts (an update): the old process lets
/// go of the running lock only as it ends, so a start with folders still to copy gives it a moment.
pub fn decide(copying: bool, running: &Path, wait: bool) -> (May, Option<fs::File>) {
    let mut tries = if wait { 30 } else { 0 };
    loop {
        match lock(running) {
            Lock::Held(file) => return (if copying { May::SetAside } else { May::CopyOnly }, Some(file)),
            Lock::Busy if tries > 0 => {
                tries -= 1;
                std::thread::sleep(Duration::from_millis(100));
            }
            Lock::Busy => return (May::Nothing, None),
            Lock::Unavailable => return (May::CopyOnly, None),
        }
    }
}

/// Copies each old folder to its new place where that isn't settled yet. Called first thing in
/// `run`, before Tauri starts. A failed copy is tried twice more, half a second apart (a file
/// another program holds for a moment), and otherwise again on the next start.
pub fn run() {
    let bases = bases();
    let Some(first) = bases.first() else { return };
    let pairs = pairs(&bases);
    // Waits while another start copies, so what it copied is settled before this one looks. Past
    // the minute, the other start holds the running lock, so this one does nothing.
    let copying = lock_waiting(&first.join(format!("{ID}.copy.lock")), Duration::from_secs(60));
    let unsettled = pairs.iter().any(|(_, new)| fs::symlink_metadata(new.join(MARKER)).is_err());
    let running_path = first.join(format!("{ID}.lock"));
    let (may, running) = decide(copying.is_some(), &running_path, unsettled);
    if let Some(file) = running {
        let _ = RUNNING.set(file);
    }
    if may == May::Nothing {
        // A second start hands over to the running app and ends soon. But an app restarting after
        // an update can still be ending: this one is then the app, and takes the running lock as
        // soon as it is free, so a later start doesn't take it for gone.
        std::thread::spawn(move || {
            if let Some(file) = lock_waiting(&running_path, Duration::MAX) {
                let _ = RUNNING.set(file);
            }
        });
        return;
    }
    let outcome = pairs
        .into_iter()
        .map(|(old, new)| {
            if may == May::SetAside {
                clear_partials(&new);
            }
            let set_aside = may == May::SetAside;
            let mut aside = None;
            let mut r = copy_once(&old, &new, set_aside, &mut aside);
            for _ in 0..2 {
                if r.is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
                r = copy_once(&old, &new, set_aside, &mut aside);
            }
            (old, new, settle(r, aside).map_err(|e| e.to_string()))
        })
        .collect();
    let _ = OUTCOME.set(outcome);
    drop(copying);
}

/// The outcome of one folder's attempts, naming a folder an attempt set aside (even one whose
/// putting back failed, so a later attempt found the new place empty).
fn settle(r: io::Result<Moved>, aside: Option<PathBuf>) -> io::Result<Moved> {
    match (r, aside) {
        (Ok(Moved::Copied), Some(aside)) => Ok(Moved::CopiedSettingAside(aside)),
        (Err(e), Some(aside)) => Err(io::Error::new(e.kind(), format!("{e} (what the new folder held is in {})", aside.display()))),
        (r, _) => r,
    }
}

/// Removes the temporary copies (`<new>.partial-<pid>`) a start that was stopped mid-copy left
/// beside `new`. Only called with both locks held, when no other start can be copying.
pub fn clear_partials(new: &Path) {
    let (Some(parent), Some(name)) = (new.parent(), new.file_name()) else { return };
    let mut prefix = name.to_os_string();
    prefix.push(".partial-");
    let prefix = prefix.to_string_lossy().into_owned();
    let Ok(entries) = fs::read_dir(parent) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Writes what `run` did to the app's log: one line per folder copied or failed, none otherwise.
pub fn log_outcome() {
    for (old, new, r) in OUTCOME.get().map(Vec::as_slice).unwrap_or(&[]) {
        match r {
            Ok(Moved::Copied) => log::info!(target: "myorbiter::app", "copied {} to {} (the folder before the rename stays as it was)", old.display(), new.display()),
            Ok(Moved::CopiedSettingAside(aside)) => log::info!(target: "myorbiter::app", "copied {} to {} (the folder before the rename stays as it was); what a start after an earlier failed copy wrote there is kept in {}", old.display(), new.display(), aside.display()),
            Ok(Moved::Skipped) => {}
            Err(e) => log::warn!(target: "myorbiter::app", "copying {} to {} failed: {e}; the next start tries again", old.display(), new.display()),
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

/// One attempt, as `run` makes it, for the tests.
#[cfg(test)]
pub fn copy_if_needed(old: &Path, new: &Path, may_set_aside: bool) -> io::Result<Moved> {
    let mut aside = None;
    let r = copy_once(old, new, may_set_aside, &mut aside);
    settle(r, aside)
}

/// Copies `old` to `new` unless `new` holds the marker or there is no `old` folder. Never touches
/// `old`. A `new` that holds anything without the marker is renamed aside (see the module's notes),
/// only once the copy is complete and only when `may_set_aside`; if anything fails, `new` is left
/// as it was. `aside_out` is set when it renames `new` aside, and cleared if it puts it back.
fn copy_once(old: &Path, new: &Path, may_set_aside: bool, aside_out: &mut Option<PathBuf>) -> io::Result<Moved> {
    if fs::symlink_metadata(new.join(MARKER)).is_ok() {
        return Ok(Moved::Skipped);
    }
    // `metadata` follows a symbolic link, so an old folder that links to one elsewhere is copied.
    // Only an old folder that isn't there at all (or isn't a folder) counts as nothing to copy: one
    // that can't be read now (a link to a drive not mounted yet) is an error, tried again later.
    let absent = match fs::metadata(old) {
        Ok(m) => !m.is_dir(),
        Err(e) if e.kind() == io::ErrorKind::NotFound && fs::symlink_metadata(old).is_err_and(|e| e.kind() == io::ErrorKind::NotFound) => true,
        Err(e) => return Err(e),
    };
    if absent {
        // Settled now, folder made if need be (Tauri would make it anyway). Best effort: without
        // it, the same check runs again next start.
        if fs::create_dir_all(new).is_ok() {
            let _ = fs::write(new.join(MARKER), MARKER_TEXT);
        }
        return Ok(Moved::Skipped);
    }
    let held = match fs::read_dir(new) {
        Ok(mut entries) => entries.next().is_some(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => false,
        Err(e) => return Err(e),
    };
    if held && !may_set_aside {
        return Err(io::Error::other("the new folder holds something but isn't marked as copied, and without the lock file it can't be set aside safely"));
    }
    let partial = beside(new, &format!("partial-{}", std::process::id()))?;
    let _ = fs::remove_dir_all(&partial);
    // On any failure from here on, the temporary copy goes and `new` is as it was.
    let fail = |e: io::Error| {
        let _ = fs::remove_dir_all(&partial);
        Err(e)
    };
    if let Err(e) = copy_dir(old, &partial).and_then(|()| fs::write(partial.join(MARKER), MARKER_TEXT)) {
        return fail(e);
    }
    let aside = if held {
        let aside = match free_name(new) {
            Ok(a) => a,
            Err(e) => return fail(e),
        };
        if let Err(e) = fs::rename(new, &aside) {
            return fail(e);
        }
        *aside_out = Some(aside.clone());
        Some(aside)
    } else {
        // An empty new folder is taken away so the copy can take its place in one rename.
        if let Err(e) = fs::remove_dir(new) {
            if e.kind() != io::ErrorKind::NotFound {
                return fail(e);
            }
        }
        None
    };
    if let Err(e) = fs::rename(&partial, new) {
        if let Some(aside) = &aside {
            if fs::rename(aside, new).is_ok() {
                *aside_out = None;
            } else {
                strip_credentials(aside);
            }
        }
        return fail(e);
    }
    if let Some(aside) = &aside {
        strip_credentials(aside);
    }
    Ok(Moved::Copied)
}

/// Takes the warframe.market sign-in out of a folder set aside for good: it is kept for what else it
/// holds, never read again, and a stale copy of a credential is no use to anyone. Only once the
/// setting aside is final (a folder put back stays whole), and best effort.
fn strip_credentials(aside: &Path) {
    let _ = fs::remove_file(aside.join(crate::market::TOKEN_FILE));
    let Ok(entries) = fs::read_dir(aside) else { return };
    let tmp = format!(".{}.", crate::market::TOKEN_FILE);
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&tmp) && name.ends_with(".tmp") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// `<new>.<suffix>`, beside `new`.
fn beside(new: &Path, suffix: &str) -> io::Result<PathBuf> {
    let Some(name) = new.file_name() else { return Err(io::Error::other("the new folder has no name")) };
    let mut s = name.to_os_string();
    s.push(".");
    s.push(suffix);
    Ok(new.with_file_name(s))
}

/// The first `<new>.before-copy-<n>` that doesn't exist yet.
fn free_name(new: &Path) -> io::Result<PathBuf> {
    for n in 1..1000 {
        let p = beside(new, &format!("before-copy-{n}"))?;
        if fs::symlink_metadata(&p).is_err_and(|e| e.kind() == io::ErrorKind::NotFound) {
            return Ok(p);
        }
    }
    Err(io::Error::other("no free name to keep the new folder under"))
}

/// Copies a folder and everything in it, keeping each file's permissions (the warframe.market
/// sign-in file, when the system keyring isn't used, is readable only by you) and, on Unix, each
/// folder's.
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
    // The folder's own permissions (the old folder is readable only by you), but always writable
    // by the app: a read-only copy couldn't take the marker or be cleared after a failure.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(from)?.permissions().mode() | 0o700;
        fs::set_permissions(to, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
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
        fn names(&self) -> Vec<String> {
            let mut n: Vec<_> = fs::read_dir(&self.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
            n.sort();
            n
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sorted(names: &[&str]) -> Vec<String> {
        let mut n: Vec<String> = names.iter().map(|s| s.to_string()).collect();
        n.sort();
        n
    }

    fn fill_old(base: &Path) -> PathBuf {
        let old = base.join(OLD_ID);
        fs::create_dir_all(old.join("logs")).unwrap();
        fs::write(old.join("settings.json"), r#"{"a":1}"#).unwrap();
        fs::write(old.join("logs/orbiter.log"), "a line\n").unwrap();
        old
    }

    fn assert_old_unchanged(old: &Path) {
        assert_eq!(fs::read_to_string(old.join("settings.json")).unwrap(), r#"{"a":1}"#);
        assert_eq!(fs::read_to_string(old.join("logs/orbiter.log")).unwrap(), "a line\n");
        assert!(!old.join(MARKER).exists());
    }

    #[cfg(unix)]
    fn is_root() -> bool {
        fs::read_to_string("/proc/self/status").is_ok_and(|s| s.lines().any(|l| l.starts_with("Uid:") && l.split_whitespace().nth(1) == Some("0")))
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
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Copied);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"a":1}"#);
        assert_eq!(fs::read_to_string(new.join("logs/orbiter.log")).unwrap(), "a line\n");
        assert!(new.join(MARKER).is_file());
        assert_old_unchanged(&old);
        // No temporary folder left beside it.
        assert_eq!(t.names(), sorted(&[OLD_ID, ID]));
    }

    #[test]
    fn copies_into_an_empty_new_folder() {
        let t = Temp::new("empty");
        let old = fill_old(&t.0);
        let new = t.0.join(ID);
        fs::create_dir_all(&new).unwrap();
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Copied);
        assert!(new.join("settings.json").is_file());
        assert_eq!(t.names().len(), 2);
    }

    #[test]
    fn a_settled_folder_is_left_as_it_is() {
        let t = Temp::new("twice");
        let old = fill_old(&t.0);
        let new = t.0.join(ID);
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Copied);
        // The app writes to its folder, the old one changes (an older version run again): the
        // next start copies nothing.
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        fs::write(old.join("settings.json"), "changed later").unwrap();
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Skipped);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert_eq!(t.names().len(), 2);
    }

    #[test]
    fn what_a_start_after_a_failed_copy_wrote_is_set_aside_and_kept() {
        let t = Temp::new("aside");
        let old = fill_old(&t.0);
        let new = t.0.join(ID);
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        let aside = t.0.join(format!("{ID}.before-copy-1"));
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::CopiedSettingAside(aside.clone()));
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"a":1}"#);
        assert!(new.join(MARKER).is_file());
        assert_eq!(fs::read_to_string(aside.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert_old_unchanged(&old);
        // A name already taken isn't reused.
        let t2 = Temp::new("aside2");
        let old2 = fill_old(&t2.0);
        let new2 = t2.0.join(ID);
        fs::create_dir_all(&new2).unwrap();
        fs::write(new2.join("x"), "x").unwrap();
        fs::create_dir_all(t2.0.join(format!("{ID}.before-copy-1"))).unwrap();
        assert_eq!(copy_if_needed(&old2, &new2, true).unwrap(), Moved::CopiedSettingAside(t2.0.join(format!("{ID}.before-copy-2"))));
        assert!(t2.0.join(format!("{ID}.before-copy-2/x")).is_file());
    }

    #[test]
    fn a_folder_set_aside_keeps_everything_but_the_sign_in() {
        let t = Temp::new("strip");
        let old = fill_old(&t.0);
        fs::write(old.join(crate::market::TOKEN_FILE), "old token").unwrap();
        let new = t.0.join(ID);
        fs::create_dir_all(new.join("sub")).unwrap();
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        fs::write(new.join(crate::market::TOKEN_FILE), "token").unwrap();
        fs::write(new.join(".market-token.123.4.tmp"), "token").unwrap();
        fs::write(new.join("sub").join(crate::market::TOKEN_FILE), "not the sign-in").unwrap();
        let aside = t.0.join(format!("{ID}.before-copy-1"));
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::CopiedSettingAside(aside.clone()));
        assert!(!aside.join(crate::market::TOKEN_FILE).exists());
        assert!(!aside.join(".market-token.123.4.tmp").exists());
        assert_eq!(fs::read_to_string(aside.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert!(aside.join("sub").join(crate::market::TOKEN_FILE).is_file(), "only the config folder's own");
        // The copy in place keeps the old folder's sign-in file, and the old folder its own.
        assert_eq!(fs::read_to_string(new.join(crate::market::TOKEN_FILE)).unwrap(), "old token");
        assert_eq!(fs::read_to_string(old.join(crate::market::TOKEN_FILE)).unwrap(), "old token");
    }

    #[test]
    fn without_an_old_folder_nothing_is_copied_now_or_later() {
        let t = Temp::new("none");
        let old = t.0.join(OLD_ID);
        let new = t.0.join(ID);
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Skipped);
        // The folder is made and marked settled at once, so an old folder made later (an older
        // version run after this one) isn't copied over what this one writes.
        assert!(new.join(MARKER).is_file());
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        fill_old(&t.0);
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Skipped);
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert_eq!(t.names().len(), 2);
        // A file where the old folder would be isn't a folder to copy either.
        let t2 = Temp::new("none2");
        fs::write(t2.0.join(OLD_ID), "not a folder").unwrap();
        assert_eq!(copy_if_needed(&t2.0.join(OLD_ID), &t2.0.join(ID), true).unwrap(), Moved::Skipped);
        assert!(t2.0.join(ID).join(MARKER).is_file());
    }

    #[cfg(unix)]
    #[test]
    fn an_old_folder_that_is_a_link_is_copied() {
        let t = Temp::new("link");
        let real = t.0.join("elsewhere");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("settings.json"), r#"{"a":1}"#).unwrap();
        let old = t.0.join(OLD_ID);
        std::os::unix::fs::symlink(&real, &old).unwrap();
        let new = t.0.join(ID);
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Copied);
        assert!(fs::symlink_metadata(&new).unwrap().is_dir(), "a real folder, not a link");
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"a":1}"#);
        assert!(fs::symlink_metadata(&old).unwrap().file_type().is_symlink());
        assert!(!real.join(MARKER).exists());
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
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Copied);
        assert_eq!(fs::metadata(new.join("market-token")).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(&new).unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_copy_changes_nothing_and_is_tried_again_after_the_app_wrote_its_defaults() {
        use std::os::unix::fs::PermissionsExt;
        // Root reads everything, so the unreadable file below wouldn't fail for it.
        if is_root() {
            return;
        }
        let t = Temp::new("fail");
        let old = fill_old(&t.0);
        fs::write(old.join("unreadable"), "x").unwrap();
        fs::set_permissions(old.join("unreadable"), fs::Permissions::from_mode(0o000)).unwrap();
        let new = t.0.join(ID);
        assert!(copy_if_needed(&old, &new, true).is_err());
        assert!(!new.exists(), "half a copy would count as already there");
        assert_eq!(t.names(), vec![OLD_ID.to_string()], "no temporary folder left");
        // The start goes on, and the app writes its defaults to the new folder.
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        // Still failing: the new folder stays as it is, nothing set aside.
        assert!(copy_if_needed(&old, &new, true).is_err());
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert!(!new.join(MARKER).exists());
        assert_eq!(t.names().len(), 2, "{:?}", t.names());
        // Once it can be read, the next start copies, keeping the defaults aside.
        fs::set_permissions(old.join("unreadable"), fs::Permissions::from_mode(0o600)).unwrap();
        let aside = t.0.join(format!("{ID}.before-copy-1"));
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::CopiedSettingAside(aside.clone()));
        assert!(new.join("unreadable").is_file());
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"a":1}"#);
        assert_eq!(fs::read_to_string(aside.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Skipped);
    }

    #[test]
    fn a_second_start_finds_the_lock_taken() {
        let t = Temp::new("lock");
        let path = t.0.join(format!("{ID}.lock"));
        let first = lock(&path);
        assert!(matches!(first, Lock::Held(_)), "{first:?}");
        assert!(matches!(lock(&path), Lock::Busy));
        drop(first);
        assert!(matches!(lock(&path), Lock::Held(_)), "free again once the first start has ended");
        assert!(matches!(lock(&t.0.join("no-such-folder/x.lock")), Lock::Unavailable));
        assert!(lock_waiting(&t.0.join("no-such-folder/x.lock"), Duration::ZERO).is_none());
    }

    #[test]
    fn a_second_start_waits_for_the_copy_then_leaves_a_running_app_alone() {
        let t = Temp::new("may");
        let copy = t.0.join(format!("{ID}.copy.lock"));
        let running = t.0.join(format!("{ID}.lock"));
        // The first start: copying, and then running.
        let first_copy = lock_waiting(&copy, Duration::ZERO).unwrap();
        // A start stopped mid-copy doesn't hold up the next one for good.
        let started = std::time::Instant::now();
        assert!(lock_waiting(&copy, Duration::from_millis(300)).is_none());
        assert!(started.elapsed() >= Duration::from_millis(250));
        let (may1, first_running) = decide(true, &running, true);
        assert_eq!(may1, May::SetAside);
        assert!(first_running.is_some());
        // A second start waits while the first copies...
        let started = std::time::Instant::now();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(first_copy);
        });
        let second_copy = lock_waiting(&copy, Duration::from_secs(10)).unwrap();
        assert!(started.elapsed() >= Duration::from_millis(250), "it waited for the copy");
        release.join().unwrap();
        // ...and then, with the first one running, does nothing, waiting or not.
        assert_eq!(decide(true, &running, false).0, May::Nothing);
        assert_eq!(decide(true, &running, true).0, May::Nothing);
        drop(second_copy);
        // Once the first one has ended, the next start may set aside.
        drop(first_running);
        assert_eq!(decide(true, &running, false).0, May::SetAside);
        // Without the copy lock, or without the running one, only copying into an empty place.
        assert_eq!(decide(false, &t.0.join("other.lock"), false).0, May::CopyOnly);
        assert_eq!(decide(true, &t.0.join("no-such-folder/x.lock"), false).0, May::CopyOnly);
    }

    #[test]
    fn a_folder_set_aside_is_named_even_when_a_later_attempt_copies() {
        let aside = PathBuf::from("/base/x.before-copy-1");
        assert_eq!(settle(Ok(Moved::Copied), Some(aside.clone())).unwrap(), Moved::CopiedSettingAside(aside.clone()));
        let e = settle(Err(io::Error::other("busy")), Some(aside)).unwrap_err().to_string();
        assert!(e.contains("before-copy-1"), "{e}");
        assert_eq!(settle(Ok(Moved::Copied), None).unwrap(), Moved::Copied);
    }

    #[test]
    fn without_the_lock_a_held_folder_is_not_set_aside() {
        let t = Temp::new("nolock");
        let old = fill_old(&t.0);
        let new = t.0.join(ID);
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        assert!(copy_if_needed(&old, &new, false).is_err());
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"b":2}"#);
        assert_eq!(t.names().len(), 2, "{:?}", t.names());
        // A missing folder is still copied without it.
        let t2 = Temp::new("nolock2");
        let old2 = fill_old(&t2.0);
        assert_eq!(copy_if_needed(&old2, &t2.0.join(ID), false).unwrap(), Moved::Copied);
    }

    #[test]
    fn leftover_partial_copies_are_cleared() {
        let t = Temp::new("partials");
        let new = t.0.join(ID);
        fs::create_dir_all(t.0.join(format!("{ID}.partial-12345/sub"))).unwrap();
        fs::create_dir_all(t.0.join(format!("{ID}.before-copy-1"))).unwrap();
        fs::create_dir_all(t.0.join(OLD_ID)).unwrap();
        fs::create_dir_all(&new).unwrap();
        clear_partials(&new);
        assert_eq!(t.names(), sorted(&[OLD_ID, ID, &format!("{ID}.before-copy-1")]));
    }

    #[cfg(unix)]
    #[test]
    fn an_old_folder_that_cannot_be_reached_is_an_error_not_nothing() {
        let t = Temp::new("dangling");
        let old = t.0.join(OLD_ID);
        std::os::unix::fs::symlink(t.0.join("not-mounted"), &old).unwrap();
        let new = t.0.join(ID);
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("settings.json"), r#"{"b":2}"#).unwrap();
        assert!(copy_if_needed(&old, &new, true).is_err());
        assert!(!new.join(MARKER).exists(), "not settled: copied once it can be reached");
        assert_eq!(fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"b":2}"#);
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_old_folder_gives_a_writable_copy() {
        use std::os::unix::fs::PermissionsExt;
        if is_root() {
            return;
        }
        let t = Temp::new("readonly");
        let old = fill_old(&t.0);
        fs::set_permissions(old.join("logs"), fs::Permissions::from_mode(0o500)).unwrap();
        fs::set_permissions(&old, fs::Permissions::from_mode(0o500)).unwrap();
        let new = t.0.join(ID);
        assert_eq!(copy_if_needed(&old, &new, true).unwrap(), Moved::Copied);
        assert_eq!(fs::metadata(&new).unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(fs::metadata(new.join("logs")).unwrap().permissions().mode() & 0o777, 0o700);
        assert!(new.join(MARKER).is_file());
        assert_eq!(fs::metadata(&old).unwrap().permissions().mode() & 0o777, 0o500, "the old folder is untouched");
        fs::set_permissions(&old, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(old.join("logs"), fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[test]
    fn one_pair_per_base_folder() {
        let a = PathBuf::from("/base/a");
        let b = PathBuf::from("/base/b");
        let p = pairs(&[a.clone(), b.clone(), a.clone()]);
        assert_eq!(p, vec![(a.join(OLD_ID), a.join(ID)), (b.join(OLD_ID), b.join(ID))]);
    }
}
