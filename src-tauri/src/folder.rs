//! Opening a folder in the file manager (Settings, Logs).
//!
//! The AppImage starts MyOrbiter with its own libraries first on `LD_LIBRARY_PATH`, and its GIO and
//! GTK modules, schemas and data on their paths (its AppRun and linuxdeploy's GTK hook). A program
//! MyOrbiter starts inherits all of that. Through the opener plugin, `xdg-open` handed the folder to
//! the desktop's opener (`kde-open`), which exits 0 as soon as it has started the file manager. The
//! file manager then loaded the AppImage's older libraries in place of its own and failed to start
//! (Dolphin: liblzma's `XZ_5.4` not found; `gio`: an undefined symbol), so the button did nothing
//! and said nothing. On Linux the folder now opens through `xdg-open` without the AppImage's
//! entries (`companion::plain_command`), and its exit status is the answer.

use std::path::Path;
use std::time::{Duration, Instant};

/// How long to wait for the opener to say how it went. One that is still running then (an
/// `xdg-open` that waits for the program it started) counts as opened, and is left to finish.
const ANSWER_WITHIN: Duration = Duration::from_secs(4);

/// Opens `path`, a folder, in the file manager; why not, in a sentence.
pub fn open(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("{} isn't a folder MyOrbiter can open", path.display()));
    }
    #[cfg(target_os = "linux")]
    {
        let mut cmd = crate::companion::plain_command("xdg-open");
        cmd.arg(path);
        match answer(cmd, ANSWER_WITHIN) {
            Ok(()) => return Ok(()),
            // No xdg-open on this system: the opener plugin's other ways (gio, kde-open) below.
            Err(Failed::NotFound) => {}
            Err(Failed::Exited(code)) => {
                log::warn!(target: "myorbiter::app", "xdg-open couldn't open {} (exit {code:?})", path.display());
                return Err(format!("The file manager couldn't open {}{}", path.display(), code.map(|c| format!(" (xdg-open exit {c})")).unwrap_or_default()));
            }
            Err(Failed::Other(e)) => {
                log::warn!(target: "myorbiter::app", "couldn't run xdg-open for {}: {e}", path.display());
                return Err(format!("Couldn't start the file manager: {e}"));
            }
        }
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(path.display().to_string(), None::<&str>).map_err(|e| {
        log::warn!(target: "myorbiter::app", "couldn't open {}: {e}", path.display());
        format!("Couldn't open {}: {e}", path.display())
    })
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
