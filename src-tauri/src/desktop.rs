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

/// Shows a notification. Best effort: with no notification service running nothing happens.
/// `id`: the notification in MyOrbiter's history. Clicking the notification then brings MyOrbiter's
/// window up and tells the page (event `notice-open`), which opens what it's about. `actions`:
/// buttons of its own beside that, as (action, label): pressing one tells the page (event
/// `notice-action`, with the id and the action) and leaves MyOrbiter where it is, so a sale's
/// "Give +rep" doesn't take you out of the game. Linux and Windows (a button on the toast); macOS
/// shows it without the click or the buttons.
pub fn notify(app: tauri::AppHandle, summary: String, body: String, id: Option<String>, actions: Vec<(String, String)>) {
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
            }
            Err(e) => log::warn!(target: "myorbiter::notify", "notification not shown: {e}"),
        }
    });
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
