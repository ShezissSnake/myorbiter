//! Fitting into the desktop: notifications through the system's own notification service. On Linux
//! that's the desktop's (KDE, GNOME, or mako/dunst/swaync on Hyprland), tagged with MyOrbiter's
//! launcher entry so they carry its name and icon and group under it; on Windows and macOS the
//! system's notification centre.

/// The launcher entry `scripts/install-desktop.sh` installs (`myorbiter.desktop`), which is also the
/// window's Wayland app id, and the icon name it installs.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const DESKTOP_ENTRY: &str = "myorbiter";

#[cfg(any(target_os = "linux", target_os = "windows"))]
use std::sync::atomic::{AtomicUsize, Ordering};
/// Notifications waiting for a click right now, and how many may.
#[cfg(any(target_os = "linux", target_os = "windows"))]
static WAITING: AtomicUsize = AtomicUsize::new(0);
#[cfg(any(target_os = "linux", target_os = "windows"))]
const MAX_WAITING: usize = 8;
/// Counts one waiting notification off when its thread ends, however it ends.
#[cfg(any(target_os = "linux", target_os = "windows"))]
struct Waiting;
#[cfg(any(target_os = "linux", target_os = "windows"))]
impl Drop for Waiting {
    fn drop(&mut self) {
        WAITING.fetch_sub(1, Ordering::SeqCst);
    }
}

/// How long the page's send waits for the notification service to take a notification.
pub const SEND_WAIT: std::time::Duration = std::time::Duration::from_secs(10);

/// Shows a notification. Best effort for the player (with no notification service running nothing
/// is shown), but the answer comes back: the receiver gets `Ok` once the service took the
/// notification, or why it didn't, so the page can say what happened. What the service then does
/// with it (hold it back in Do Not Disturb) is its own and isn't known here.
/// `id`: the notification in MyOrbiter's history. Clicking the notification then brings MyOrbiter's
/// window up and tells the page (event `notice-open`), which opens what it's about. `actions`:
/// buttons of its own beside that, as (action, label): pressing one tells the page (event
/// `notice-action`, with the id and the action) and leaves MyOrbiter where it is, so a sale's
/// "Give +rep" doesn't take you out of the game. Linux and Windows (a button on the toast); macOS
/// shows it without the click or the buttons.
pub fn notify(app: tauri::AppHandle, summary: String, body: String, id: Option<String>, actions: Vec<(String, String)>) -> std::sync::mpsc::Receiver<Result<(), String>> {
    let (done, answer) = std::sync::mpsc::channel();
    // Each notification that can be clicked keeps a thread waiting for it, and a desktop that keeps
    // old notifications in a tray (GNOME) may never say it closed. Past a few, new ones are shown
    // without the click, so threads don't pile up over a long session.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let id = id.filter(|_| WAITING.fetch_add(1, Ordering::SeqCst) < MAX_WAITING || {
        WAITING.fetch_sub(1, Ordering::SeqCst);
        false
    });
    // Sending waits on D-Bus (or the system's notification service), and waiting for the click
    // lasts as long as the notification: keep both off the command thread.
    std::thread::spawn(move || {
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        let _waiting = id.is_some().then_some(Waiting);
        let mut n = notify_rust::Notification::new();
        n.appname("MyOrbiter").summary(&summary).body(&body);
        #[cfg(target_os = "linux")]
        n.icon(DESKTOP_ENTRY)
            .hint(notify_rust::Hint::DesktopEntry(DESKTOP_ENTRY.into()))
            .timeout(notify_rust::Timeout::Milliseconds(8000));
        #[cfg(target_os = "windows")]
        if installed() {
            // The id the installer gives MyOrbiter's Start menu shortcut: the toast then comes from
            // MyOrbiter, with its name and icon (not from PowerShell, notify-rust's stand-in).
            n.app_id(&app.config().identifier);
        }
        // The page's own buttons, never one that stands for the click or the close.
        let actions: Vec<(String, String)> = actions.into_iter().filter(|(a, _)| !a.is_empty() && a != "default" && a != "__closed").collect();
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        if id.is_some() {
            n.action("default", "Open");
            for (action, label) in &actions {
                n.action(action, label);
            }
        }
        match n.show() {
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            Ok(handle) => {
                let _ = done.send(Ok(()));
                if let Some(id) = id {
                    handle.wait_for_action(|action| {
                        if actions.iter().any(|(a, _)| a == action) {
                            tell_action(&app, &id, action);
                        } else if action != "__closed" {
                            bring_up(&app, &id);
                        }
                    });
                }
            }
            #[cfg(not(any(target_os = "linux", target_os = "windows")))]
            Ok(_) => {
                let _ = (&app, &id, &actions);
                let _ = done.send(Ok(()));
            }
            Err(e) => {
                log::warn!(target: "myorbiter::notify", "notification not shown: {e}");
                let _ = done.send(Err(reason(&e.to_string())));
            }
        }
    });
    answer
}

/// An error from the notification service as one short line for the page.
fn reason(e: &str) -> String {
    let line: String = e.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() > 200 { format!("{}…", line.chars().take(200).collect::<String>()) } else { line }
}

/// What the send said, or that it said nothing within `wait` (the service is stuck) or the sending
/// thread ended without an answer. A service that answers after `wait` may still show the
/// notification: the page was told it couldn't be sent, which is what it knew at the time.
pub fn sent(answer: &std::sync::mpsc::Receiver<Result<(), String>>, wait: std::time::Duration) -> Result<(), String> {
    match answer.recv_timeout(wait) {
        Ok(r) => r,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!("the desktop's notification service didn't answer within {} seconds", wait.as_secs())),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err("sending ended without an answer".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::Duration;

    #[test]
    fn the_answer_is_what_the_send_said() {
        let (tx, rx) = channel();
        tx.send(Ok(())).unwrap();
        assert_eq!(sent(&rx, Duration::from_secs(1)), Ok(()));
        let (tx, rx) = channel();
        tx.send(Err("no service".into())).unwrap();
        assert_eq!(sent(&rx, Duration::from_secs(1)), Err("no service".into()));
    }

    #[test]
    fn silence_and_a_dead_sender_are_errors_that_say_so() {
        let (tx, rx) = channel::<Result<(), String>>();
        let e = sent(&rx, Duration::from_millis(20)).unwrap_err();
        assert!(e.contains("didn't answer"), "{e}");
        drop(tx);
        let e = sent(&rx, Duration::from_secs(1)).unwrap_err();
        assert!(e.contains("without an answer"), "{e}");
    }

    #[test]
    fn a_long_multi_line_error_is_one_short_line() {
        let long = format!("zbus error:\n  {}", "x".repeat(500));
        let r = reason(&long);
        assert!(!r.contains('\n') && r.starts_with("zbus error: xxx") && r.chars().count() <= 201, "{r}");
        assert_eq!(reason("a  b\nc"), "a b c");
    }
}

/// The main window, in front, opening what notification `id` is about.
#[cfg(any(target_os = "linux", target_os = "windows"))]
fn bring_up(app: &tauri::AppHandle, id: &str) {
    use tauri::{Emitter, Manager};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("notice-open", id.to_string());
    }
}

/// One of notification `id`'s own buttons was pressed: the page does it, MyOrbiter stays where it is.
#[cfg(any(target_os = "linux", target_os = "windows"))]
fn tell_action(app: &tauri::AppHandle, id: &str, action: &str) {
    use tauri::{Emitter, Manager};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.emit("notice-action", NoticeAction { id: id.to_string(), action: action.to_string() });
    }
}

/// What `notice-action` carries.
#[cfg(any(target_os = "linux", target_os = "windows"))]
#[derive(Clone, serde::Serialize)]
struct NoticeAction {
    id: String,
    action: String,
}

/// Run from where the installer put it, rather than from a build folder: only then does Windows
/// know the app id (from the Start menu shortcut), and a toast with an unknown one isn't shown.
#[cfg(target_os = "windows")]
fn installed() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    let dir = exe.parent().map(|d| d.display().to_string()).unwrap_or_default();
    let sep = std::path::MAIN_SEPARATOR;
    !(dir.ends_with(&format!("{sep}target{sep}debug")) || dir.ends_with(&format!("{sep}target{sep}release")))
}
