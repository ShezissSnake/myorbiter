//! The backend's half of Record timings (Settings › Logs; the recorder is `src/lib/timing.ts`):
//! when the process started, what it runs on, and saving a timing report beside the log. Nothing
//! here is sent anywhere, and nothing names the player, a file or a folder: the report is numbers,
//! the system's name and version, and the graphics card's maker.

use std::path::Path;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

/// A saved report's name starts with this; the oldest go once there are more than `KEEP`.
const PREFIX: &str = "timings-";
const KEEP: usize = 10;
/// A report longer than this is cut: it is a page of numbers, never this long.
const MAX_BYTES: usize = 256 * 1024;

static RUN_START: OnceLock<f64> = OnceLock::new();

fn unix_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// Called first thing in `run()`: the start when the system can't say when the process began.
pub fn mark_run_start() {
    let _ = RUN_START.set(unix_ms());
}

/// When this process started (unix ms), from `/proc` (10 ms steps): the kernel's start time of the
/// process against the time since boot.
#[cfg(target_os = "linux")]
fn process_start_ms() -> Option<f64> {
    let stat = std::fs::read_to_string("/proc/self/stat").ok()?;
    // The program's name (field 2) is in brackets and may hold spaces: count from after it.
    let after = &stat[stat.rfind(')')? + 1..];
    // Field 22, starttime, is the 20th after the name.
    let ticks: f64 = after.split_whitespace().nth(19)?.parse().ok()?;
    let uptime: f64 = std::fs::read_to_string("/proc/uptime").ok()?.split_whitespace().next()?.parse().ok()?;
    // SAFETY: sysconf only reads a system constant.
    let hz = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if hz <= 0 {
        return None;
    }
    Some(unix_ms() - (uptime - ticks / hz as f64) * 1000.0)
}

#[cfg(not(target_os = "linux"))]
fn process_start_ms() -> Option<f64> {
    None
}

/// WebKitGTK's version, from the library the window already runs on (no crate of its own needed).
#[cfg(target_os = "linux")]
fn webkit_version() -> Option<String> {
    extern "C" {
        fn webkit_get_major_version() -> u32;
        fn webkit_get_minor_version() -> u32;
        fn webkit_get_micro_version() -> u32;
    }
    // SAFETY: plain getters of WebKitGTK, which wry links; they take nothing and touch no state.
    let (a, b, c) = unsafe { (webkit_get_major_version(), webkit_get_minor_version(), webkit_get_micro_version()) };
    Some(format!("WebKitGTK {a}.{b}.{c}"))
}

#[cfg(not(target_os = "linux"))]
fn webkit_version() -> Option<String> {
    None
}

/// The system's own name for itself ("Fedora Linux 43", "Windows"), short.
fn os_name() -> String {
    #[cfg(target_os = "linux")]
    {
        if let Some(name) = std::fs::read_to_string("/etc/os-release").ok().as_deref().and_then(pretty_name) {
            return name;
        }
    }
    std::env::consts::OS.to_owned()
}

/// `PRETTY_NAME` from an os-release file: letters, digits, spaces and a little punctuation, at
/// most 60 characters.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn pretty_name(text: &str) -> Option<String> {
    let v = text.lines().find_map(|l| l.strip_prefix("PRETTY_NAME="))?.trim().trim_matches(|c| c == '"' || c == '\'');
    let clean: String = v.chars().filter(|c| c.is_ascii_alphanumeric() || " .-_()/+".contains(*c)).take(60).collect();
    (!clean.trim().is_empty()).then(|| clean.trim().to_owned())
}

/// The graphics cards' makers, from their PCI vendor ids ("NVIDIA", "AMD + Intel" on a laptop with two).
#[cfg(target_os = "linux")]
fn gpu_vendors() -> Option<String> {
    let mut names: Vec<&str> = Vec::new();
    for e in std::fs::read_dir("/sys/class/drm").ok()?.flatten() {
        let n = e.file_name();
        let n = n.to_string_lossy();
        // card0, card1: not their outputs (card0-DP-1).
        if !n.starts_with("card") || n.contains('-') {
            continue;
        }
        let Ok(id) = std::fs::read_to_string(e.path().join("device/vendor")) else { continue };
        let name = vendor_name(id.trim());
        if !names.contains(&name) {
            names.push(name);
        }
    }
    names.sort_unstable();
    (!names.is_empty()).then(|| names.join(" + "))
}

#[cfg(not(target_os = "linux"))]
fn gpu_vendors() -> Option<String> {
    None
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn vendor_name(id: &str) -> &'static str {
    match id.to_ascii_lowercase().as_str() {
        "0x10de" => "NVIDIA",
        "0x1002" => "AMD",
        "0x8086" => "Intel",
        "0x1af4" | "0x1234" | "0x15ad" => "virtual",
        _ => "other",
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingEnv {
    version: String,
    os: String,
    arch: &'static str,
    engine: Option<String>,
    /// How frames reach the window (rendering.rs).
    frames: String,
    gpu: Option<String>,
    /// Unix ms: the process's start, and the top of `run()`.
    process_start: Option<f64>,
    run_start: Option<f64>,
}

/// What the timing report says about where it was taken, once per report.
#[tauri::command(async)]
pub fn timing_env(app: tauri::AppHandle) -> TimingEnv {
    TimingEnv {
        version: app.package_info().version.to_string(),
        os: os_name(),
        arch: std::env::consts::ARCH,
        engine: webkit_version(),
        frames: crate::rendering::frames_line(),
        gpu: gpu_vendors(),
        process_start: process_start_ms(),
        run_start: RUN_START.get().copied(),
    }
}

/// Saves a timing report in the log folder, as `timings-<UTC date and time>.txt` (readable only by
/// you, like the log), and keeps the ten newest. Gives the file's name, not its folder.
#[tauri::command(async)]
pub fn timing_save_report(text: String) -> Result<String, String> {
    let dir = crate::applog::dir().ok_or("The log folder isn't open")?;
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    save_in(&dir, &text, secs).map_err(|e| e.to_string())
}

fn save_in(dir: &Path, text: &str, secs: u64) -> std::io::Result<String> {
    // Cut first, so redacting never works through more than the cap.
    let mut cut = text.len().min(MAX_BYTES);
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    let was_cut = cut < text.len();
    let mut text = crate::applog::redact(&text[..cut]);
    if was_cut {
        text.push_str("\n(cut here: too long)\n");
    }
    // "[2026-11-02][21:28:20]" → "2026-11-02-212820"; a second report in the same second gets
    // "-2", "-3"…: never written over.
    let stamp: String = crate::applog::stamp(secs).replace("][", "-").chars().filter(|c| c.is_ascii_digit() || *c == '-').collect();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    for n in 1..100 {
        let name = if n == 1 { format!("{PREFIX}{stamp}.txt") } else { format!("{PREFIX}{stamp}-{n}.txt") };
        match options.open(dir.join(&name)) {
            Ok(mut f) => {
                f.write_all(text.as_bytes())?;
                prune(dir);
                return Ok(name);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other("too many reports this second"))
}

/// Keeps the `KEEP` newest reports (their names sort by time).
fn prune(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut names: Vec<((String, u32), String)> = entries.flatten().filter_map(|e| {
        let n = e.file_name().to_string_lossy().into_owned();
        report_key(&n).map(|k| (k, n))
    }).collect();
    names.sort();
    let extra = names.len().saturating_sub(KEEP);
    for (_, n) in &names[..extra] {
        let _ = std::fs::remove_file(dir.join(n));
    }
}

/// A report's name as this saves it (`timings-2026-11-02-212820.txt`, or `…-212820-2.txt` for a
/// second one in the same second) as its time and number; anything else in the folder is None.
fn report_key(name: &str) -> Option<(String, u32)> {
    let base = name.strip_prefix(PREFIX)?.strip_suffix(".txt")?;
    let stamp = base.get(..17)?;
    let ok = stamp.bytes().enumerate().all(|(i, b)| if matches!(i, 4 | 7 | 10) { b == b'-' } else { b.is_ascii_digit() });
    if !ok {
        return None;
    }
    let n = match &base[17..] {
        "" => 1,
        more => more.strip_prefix('-').filter(|d| !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit()))?.parse().ok()?,
    };
    Some((stamp.to_owned(), n))
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_release_name_is_cleaned_and_short() {
        assert_eq!(pretty_name("NAME=x\nPRETTY_NAME=\"Fedora Linux 43 (Workstation Edition)\"\n").as_deref(), Some("Fedora Linux 43 (Workstation Edition)"));
        assert_eq!(pretty_name("PRETTY_NAME='A<b>c'\n").as_deref(), Some("Abc"));
        assert_eq!(pretty_name("NAME=x\n"), None);
        assert_eq!(pretty_name(&format!("PRETTY_NAME={}", "x".repeat(200))).map(|s| s.len()), Some(60));
    }

    #[test]
    fn only_its_own_reports_are_pruned() {
        assert_eq!(report_key("timings-2026-11-02-212820.txt"), Some(("2026-11-02-212820".into(), 1)));
        assert_eq!(report_key("timings-2026-11-02-212820-10.txt"), Some(("2026-11-02-212820".into(), 10)));
        assert!(report_key("timings-2026-11-02-212820-2.txt") < report_key("timings-2026-11-02-212820-10.txt"));
        for other in ["timings-1999.txt", "timings-ñotes-for-later-x.txt", "timings-2026-11-02-212820-.txt", "timings-2026-11-02-21282x.txt", "myorbiter.log", "timings-2026-11-02-212820.txt.bak"] {
            assert_eq!(report_key(other), None, "{other}");
        }
        let dir = std::env::temp_dir().join(format!("myorbiter-timing-prune-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("timings-1999.txt"), "a player's own").unwrap();
        std::fs::write(dir.join("timings-ñotes-for-later-x.txt"), "a player's own").unwrap();
        for i in 0..12u64 {
            save_in(&dir, "r", 1_762_000_000 + i).unwrap();
        }
        assert!(dir.join("timings-1999.txt").exists() && dir.join("timings-ñotes-for-later-x.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn vendors_by_pci_id() {
        assert_eq!(vendor_name("0x10de"), "NVIDIA");
        assert_eq!(vendor_name("0x1002"), "AMD");
        assert_eq!(vendor_name("0x8086"), "Intel");
        assert_eq!(vendor_name("0xffff"), "other");
    }

    #[test]
    fn reports_are_saved_by_time_redacted_and_ten_kept() {
        let dir = std::env::temp_dir().join(format!("myorbiter-timing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("myorbiter.log"), "kept").unwrap();
        for i in 0..12u64 {
            let name = save_in(&dir, &format!("report {i} token abc"), 1_762_000_000 + i).unwrap();
            assert!(name.starts_with("timings-2025-11-") && name.ends_with(".txt"), "{name}");
        }
        let mut names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names.len(), 11, "ten reports and the log: {names:?}");
        assert!(names.contains(&"myorbiter.log".to_owned()));
        let newest = std::fs::read_to_string(dir.join(&names[10])).unwrap();
        assert_eq!(newest, "report 11 token [redacted]");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(dir.join(&names[10])).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let a = save_in(&dir, "first", 1_762_050_000).unwrap();
        let b = save_in(&dir, "second", 1_762_050_000).unwrap();
        assert_ne!(a, b, "the same second gets another name");
        assert!(b.ends_with("-2.txt"), "{b}");
        // The ten newest stay: the report a moment later outlives the one before it.
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert!(left.contains(&a) && left.contains(&b), "{left:?}");
        assert_eq!(std::fs::read_to_string(dir.join(&a)).unwrap(), "first");
        let long = save_in(&dir, &"é".repeat(MAX_BYTES), 1_762_100_000).unwrap();
        assert!(std::fs::read_to_string(dir.join(long)).unwrap().ends_with("(cut here: too long)\n"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn this_process_started_in_the_past() {
        let start = process_start_ms().expect("readable on Linux");
        let now = unix_ms();
        assert!(start <= now + 50.0 && now - start < 3_600_000.0, "{start} {now}");
    }
}
