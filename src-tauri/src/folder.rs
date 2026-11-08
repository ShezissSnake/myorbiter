//! Opening a folder in the file manager (Settings, Logs).
//!
//! The AppImage starts MyOrbiter with its own libraries first on `LD_LIBRARY_PATH`, and its GIO and
//! GTK modules, schemas and data on their paths (its AppRun and linuxdeploy's GTK hook). A program
//! MyOrbiter starts inherits all of that. Through the opener plugin, `xdg-open` handed the folder to
//! the desktop's opener (`kde-open`), which exits 0 as soon as it has started the file manager. The
//! file manager then loaded the AppImage's older libraries in place of its own and failed to start
//! (Dolphin: liblzma's `XZ_5.4` not found; `gio`: an undefined symbol), so the button did nothing
//! and said nothing. On Linux the folder now opens through `xdg-open` (then `gio open`, then
//! `kde-open`) without the AppImage's entries (`companion::plain_command`), and its exit status is
//! the answer; the opener plugin is used only on the other systems.

use std::path::Path;
use std::time::{Duration, Instant};

/// How long to wait for the opener to say how it went. One that is still running then (an
/// `xdg-open` that waits for the program it started) counts as opened, and is left to finish.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) const ANSWER_WITHIN: Duration = Duration::from_secs(4);

/// The openers tried in turn, as the opener plugin's own `open` crate tries them: the next one when
/// one isn't installed or fails. (The AppImage carries an `xdg-open` of its own; without its paths
/// the system's is found.)
#[cfg(target_os = "linux")]
pub(crate) const OPENERS: &[(&str, &[&str])] = &[("xdg-open", &[]), ("gio", &["open"]), ("kde-open6", &[]), ("kde-open5", &[]), ("kde-open", &[])];

/// Opens `path`, a folder, in the file manager; why not, in a sentence. It waits for the opener's
/// answer (`ANSWER_WITHIN`), so it runs on a blocking thread.
pub fn open(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("{} isn't a folder MyOrbiter can open", path.display()));
    }
    #[cfg(target_os = "linux")]
    {
        // Never through the opener plugin here: its launchers keep the AppImage's environment.
        let _ = app;
        open_with(OPENERS, path, ANSWER_WITHIN)
    }
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener().open_path(path.display().to_string(), None::<&str>).map_err(|e| {
            log::warn!(target: "myorbiter::app", "couldn't open {}: {e}", path.display());
            format!("Couldn't open {}: {e}", path.display())
        })
    }
}

/// Tries `openers` in turn on `path` (`first_opener`), and says why it didn't open in a sentence.
#[cfg(target_os = "linux")]
fn open_with(openers: &[(&str, &[&str])], path: &Path, within: Duration) -> Result<(), String> {
    first_opener(openers, path.as_os_str(), within).map_err(|failed| match failed {
        Some(why) => format!("The file manager couldn't open {} ({why})", path.display()),
        None => format!("Couldn't open {}: no xdg-open, gio or kde-open on this system", path.display()),
    })
}

/// Tries `openers` in turn on `target` (a folder, or a link: `link.rs`), each started without the
/// AppImage's environment (`companion::plain_command`) and in a process group of its own, so what
/// it starts isn't tied to MyOrbiter's. The first that succeeds ends it; otherwise the first
/// failure (`xdg-open exit 4`), or None when none of them is installed.
#[cfg(target_os = "linux")]
pub(crate) fn first_opener(openers: &[(&str, &[&str])], target: &std::ffi::OsStr, within: Duration) -> Result<(), Option<String>> {
    use std::os::unix::process::CommandExt;
    let mut failed: Option<String> = None;
    for (bin, args) in openers {
        let mut cmd = crate::companion::plain_command(bin);
        cmd.args(*args).arg(target).process_group(0);
        let why = match answer(cmd, within) {
            Ok(()) => return Ok(()),
            Err(Failed::NotFound) => continue,
            Err(Failed::Exited(Some(code))) => format!("{bin} exit {code}"),
            Err(Failed::Exited(None)) => format!("{bin} was stopped"),
            Err(Failed::Other(e)) => format!("{bin}: {e}"),
        };
        log::warn!(target: "myorbiter::app", "couldn't open {} with {bin}: {why}", target.to_string_lossy());
        failed.get_or_insert(why);
    }
    Err(failed)
}

/// How a program run for its answer failed.
#[derive(Debug, PartialEq, Eq)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
enum Failed {
    /// It isn't installed.
    NotFound,
    /// It ended with a failure (its exit code; none when a signal ended it).
    Exited(Option<i32>),
    Other(String),
}

/// Runs `cmd` and waits up to `within` for it to end: a success, a failure, or (still running then)
/// taken as a success, with a thread left to reap it.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn answer(mut cmd: std::process::Command, within: Duration) -> Result<(), Failed> {
    let mut child = cmd.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { Failed::NotFound } else { Failed::Other(e.to_string()) })?;
    let until = Instant::now() + within;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(Failed::Exited(status.code())),
            Ok(None) if Instant::now() >= until => {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => return Err(Failed::Other(e.to_string())),
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Command;

    /// The next opener when one isn't installed or fails; the first failure is the one shown.
    #[cfg(target_os = "linux")]
    #[test]
    fn openers_are_tried_in_turn() {
        let dir = std::env::temp_dir();
        let w = Duration::from_secs(4);
        assert_eq!(open_with(&[("myorbiter-no-such-opener", &[]), ("false", &[]), ("true", &[])], &dir, w), Ok(()));
        let failed = open_with(&[("myorbiter-no-such-opener", &[]), ("false", &[])], &dir, w).unwrap_err();
        assert!(failed.starts_with("The file manager couldn't open ") && failed.ends_with("(false exit 1)"), "{failed}");
        let none = open_with(&[("myorbiter-no-such-opener", &[])], &dir, w).unwrap_err();
        assert!(none.ends_with("no xdg-open, gio or kde-open on this system"), "{none}");
        assert_eq!(OPENERS[0].0, "xdg-open");
    }

    #[test]
    fn the_opener_s_answer_is_the_result() {
        assert_eq!(answer(Command::new("true"), ANSWER_WITHIN), Ok(()));
        assert_eq!(answer(Command::new("false"), ANSWER_WITHIN), Err(Failed::Exited(Some(1))));
        assert_eq!(answer(Command::new("myorbiter-no-such-opener"), ANSWER_WITHIN), Err(Failed::NotFound));
    }

    /// An opener that waits for what it started is taken as opened once the wait is over, without
    /// holding the button for as long as the file manager stays open.
    #[test]
    fn an_opener_still_running_counts_as_opened() {
        let started = Instant::now();
        let mut cmd = Command::new("sleep");
        cmd.arg("5");
        assert_eq!(answer(cmd, Duration::from_millis(100)), Ok(()));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    /// The file manager is started without the AppImage's libraries and modules: run from an
    /// AppImage, every entry inside it is taken off what the opener inherits.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_file_manager_doesn_t_inherit_the_appimage_s_libraries() {
        // The variables are read from this process (as `appimage_paths_stay_with_myorbiter` in
        // companion.rs does, under the same lock); names of their own so no other test sees them.
        let _env = crate::TEST_ENV.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("APPDIR", "/tmp/.mount_myorbiterX");
        std::env::set_var("MYORBITER_TEST_LIBS", "/tmp/.mount_myorbiterX/usr/lib/:/tmp/.mount_myorbiterX/lib/x86_64-linux-gnu/:");
        std::env::set_var("MYORBITER_TEST_GIO", "/tmp/.mount_myorbiterX//usr/lib/gio/modules");
        std::env::set_var("MYORBITER_TEST_DATA", "/tmp/.mount_myorbiterX/usr/share:/usr/share:/usr/local/share");
        let mut cmd = crate::companion::plain_command("sh");
        cmd.arg("-c").arg(r#"[ -z "$APPDIR" ] && [ -z "$MYORBITER_TEST_LIBS" ] && [ -z "$MYORBITER_TEST_GIO" ] && [ "$MYORBITER_TEST_DATA" = /usr/share:/usr/local/share ]"#);
        let result = answer(cmd, ANSWER_WITHIN);
        for k in ["APPDIR", "MYORBITER_TEST_LIBS", "MYORBITER_TEST_GIO", "MYORBITER_TEST_DATA"] {
            std::env::remove_var(k);
        }
        assert_eq!(result, Ok(()), "the opener ran without the AppImage's paths");
    }
}
