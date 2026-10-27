//! Fitting into the Linux desktop: notifications through the desktop's own notification service
//! (KDE, GNOME, or mako/dunst/swaync on Hyprland), tagged with orbiter's launcher entry so they
//! carry its name and icon and group under it.

/// The launcher entry `scripts/install-desktop.sh` installs (`orbiter.desktop`), which is also the
/// window's Wayland app id, and the icon name it installs.
pub const DESKTOP_ENTRY: &str = "orbiter";

/// Shows a notification. Best effort: with no notification service running nothing happens.
#[cfg(target_os = "linux")]
pub fn notify(summary: String, body: String) {
    // Sending waits on D-Bus; keep it off the command thread.
    std::thread::spawn(move || {
        let result = notify_rust::Notification::new()
            .appname("orbiter")
            .summary(&summary)
            .body(&body)
            .icon(DESKTOP_ENTRY)
            .hint(notify_rust::Hint::DesktopEntry(DESKTOP_ENTRY.into()))
            .timeout(notify_rust::Timeout::Milliseconds(8000))
            .show();
        if let Err(e) = result {
            eprintln!("orbiter: notification not shown: {e}");
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn notify(_summary: String, _body: String) {}
