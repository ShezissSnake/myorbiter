//! Fitting into the desktop: notifications through the system's own notification service. On Linux
//! that's the desktop's (KDE, GNOME, or mako/dunst/swaync on Hyprland), tagged with orbiter's
//! launcher entry so they carry its name and icon and group under it; on Windows and macOS the
//! system's notification centre.

/// The launcher entry `scripts/install-desktop.sh` installs (`orbiter.desktop`), which is also the
/// window's Wayland app id, and the icon name it installs.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const DESKTOP_ENTRY: &str = "orbiter";

/// Shows a notification. Best effort: with no notification service running nothing happens.
/// `id`: the notification in orbiter's history. Clicking the notification then brings orbiter's
/// window up and tells the page (event `notice-open`), which opens what it's about. Linux and
/// Windows; macOS shows it without the click.
pub fn notify(app: tauri::AppHandle, summary: String, body: String, id: Option<String>) {
    // Sending waits on D-Bus (or the system's notification service), and waiting for the click
    // lasts as long as the notification: keep both off the command thread.
    std::thread::spawn(move || {
        let mut n = notify_rust::Notification::new();
        n.appname("orbiter").summary(&summary).body(&body);
        #[cfg(target_os = "linux")]
        n.icon(DESKTOP_ENTRY)
            .hint(notify_rust::Hint::DesktopEntry(DESKTOP_ENTRY.into()))
            .timeout(notify_rust::Timeout::Milliseconds(8000));
        #[cfg(target_os = "windows")]
        if installed() {
            // The id the installer gives orbiter's Start menu shortcut: the toast then comes from
            // orbiter, with its name and icon (not from PowerShell, notify-rust's stand-in).
            n.app_id(&app.config().identifier);
        }
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        if id.is_some() {
            n.action("default", "Open");
        }
        match n.show() {
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            Ok(handle) => {
                if let Some(id) = id {
                    handle.wait_for_action(|action| {
                        if action != "__closed" {
                            bring_up(&app, &id);
                        }
                    });
                }
            }
            #[cfg(not(any(target_os = "linux", target_os = "windows")))]
            Ok(_) => {
                let _ = (&app, &id);
            }
            Err(e) => eprintln!("orbiter: notification not shown: {e}"),
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

/// Run from where the installer put it, rather than from a build folder: only then does Windows
/// know the app id (from the Start menu shortcut), and a toast with an unknown one isn't shown.
#[cfg(target_os = "windows")]
fn installed() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    let dir = exe.parent().map(|d| d.display().to_string()).unwrap_or_default();
    let sep = std::path::MAIN_SEPARATOR;
    !(dir.ends_with(&format!("{sep}target{sep}debug")) || dir.ends_with(&format!("{sep}target{sep}release")))
}
