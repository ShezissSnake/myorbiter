//! Fitting into the desktop: notifications through the system's own notification service. On Linux
//! that's the desktop's (KDE, GNOME, or mako/dunst/swaync on Hyprland), tagged with orbiter's
//! launcher entry so they carry its name and icon and group under it; on Windows and macOS the
//! system's notification centre.

/// The launcher entry `scripts/install-desktop.sh` installs (`orbiter.desktop`), which is also the
/// window's Wayland app id, and the icon name it installs.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const DESKTOP_ENTRY: &str = "orbiter";

/// Shows a notification. Best effort: with no notification service running nothing happens.
pub fn notify(summary: String, body: String) {
    // Sending waits on D-Bus (or the system's notification service); keep it off the command thread.
    std::thread::spawn(move || {
        let mut n = notify_rust::Notification::new();
        n.appname("orbiter").summary(&summary).body(&body);
        #[cfg(target_os = "linux")]
        n.icon(DESKTOP_ENTRY)
            .hint(notify_rust::Hint::DesktopEntry(DESKTOP_ENTRY.into()))
            .timeout(notify_rust::Timeout::Milliseconds(8000));
        if let Err(e) = n.show() {
            eprintln!("orbiter: notification not shown: {e}");
        }
    });
}
