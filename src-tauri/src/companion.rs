//! Starting TennoScope from orbiter, so only one app needs opening.
//!
//! orbiter reads TennoScope's data, and only TennoScope can read the reward cards off the screen,
//! so both have to run. orbiter starts it with `--background` (a patched TennoScope then shows no
//! window, only its overlay over the game), and stops it when orbiter closes. A TennoScope you
//! started yourself is left alone: orbiter only ever stops the one it started.
//!
//! The release builds carry a patched TennoScope inside them (the AppImage another AppImage, the
//! Windows installer an `.exe` with its Tesseract), so nobody installs it separately. TennoScope
//! doesn't run on macOS: there orbiter does without it.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The process name TennoScope runs under (`/proc/<pid>/comm` on Linux).
#[cfg(windows)]
const PROCESS: &str = "tennoscope.exe";
#[cfg(not(windows))]
const PROCESS: &str = "tennoscope";

/// Whether TennoScope runs on this system at all (it doesn't on macOS).
pub const SUPPORTED: bool = cfg!(any(target_os = "linux", windows));

/// Where the TennoScope orbiter carries sits, under orbiter's resource folder.
#[cfg(target_os = "linux")]
pub const BUNDLED: &str = "tennoscope/TennoScope.AppImage";
#[cfg(not(target_os = "linux"))]
pub const BUNDLED: &str = "tennoscope/tennoscope.exe";
/// Remembers the TennoScope orbiter started, across an orbiter restart.
const PID_FILE: &str = "orbiter-tennoscope.pid";

/// A process, told apart from a later one that reuses its pid by when it started.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Proc {
    pid: u32,
    /// When it started: field 22 of `/proc/<pid>/stat` on Linux (clock ticks after boot), seconds
    /// since 1970 elsewhere.
    start: u64,
}

#[derive(Default)]
pub struct Companion {
    /// The TennoScope inside this build of orbiter, if it carries one.
    bundled: Mutex<Option<PathBuf>>,
    /// The TennoScope orbiter started, if it's the one running. Shared with the threads that
    /// watch a hand-off (see `ask`).
    started: Arc<Mutex<Option<Proc>>>,
    /// Held while starting one: two checks at once (the page polls) must not start two.
    starting: Mutex<()>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Serialize)]
pub struct Status {
    /// The program orbiter would start, if found.
    pub binary: Option<String>,
    /// That program is the one inside orbiter.
    pub bundled: bool,
    /// TennoScope runs on this system (not on macOS).
    pub supported: bool,
    pub running: bool,
    pub started_by_orbiter: bool,
    /// What a patched TennoScope last reported (health, account, access setup), while fresh.
    pub report: Option<serde_json::Value>,
}

/// A patched TennoScope writes its state here every few seconds.
const STATUS_FILE: &str = "tennoscope-status.json";
/// Older than this, the report is from a TennoScope that has stopped.
const REPORT_FRESH_MS: u64 = 15_000;

fn read_report(live: &[u32]) -> Option<serde_json::Value> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    read_report_in(&crate::bridge::runtime_dir()?, live, now)
}

/// The report, if it's recent and from a TennoScope that is still running.
fn read_report_in(dir: &Path, live: &[u32], now: u64) -> Option<serde_json::Value> {
    let report: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.join(STATUS_FILE)).ok()?).ok()?;
    let at = report.get("at")?.as_u64()?;
    let pid = report.get("pid").and_then(|p| p.as_u64()).map(|p| p as u32);
    let alive = pid.map_or(true, |p| live.contains(&p));
    (alive && now.saturating_sub(at) < REPORT_FRESH_MS).then_some(report)
}

/// The requests orbiter sends a patched TennoScope (see its `orbiter_bridge::asks`). Your
/// warframe.market status isn't one: orbiter holds that itself (see presence.rs).
pub fn allowed_ask(arg: &str) -> bool {
    matches!(arg, "--sync" | "--authorize-capture")
}

/// Where to find TennoScope: the path from Settings, then the one inside orbiter, then a build in
/// `~/dev/projects/tennoscope` (the patched one), then whatever `tennoscope` is on PATH.
pub fn find_binary(custom: Option<&str>, bundled: Option<&Path>) -> Option<PathBuf> {
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = expand_home(c);
        return p.is_file().then_some(p);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = bundled.map(Path::to_path_buf).into_iter().collect();
    if let Some(h) = &home {
        candidates.push(h.join("dev/projects/tennoscope/target/release").join(PROCESS));
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join(PROCESS)));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn expand_home(p: &str) -> PathBuf {
    match (p.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(p),
    }
}

/// Process ids of every running TennoScope.
#[cfg(target_os = "linux")]
pub fn running_in(proc_root: &Path) -> Vec<u32> {
    let Ok(entries) = fs::read_dir(proc_root) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.parse::<u32>().ok())
        .filter(|pid| {
            let dir = proc_root.join(pid.to_string());
            fs::read_to_string(dir.join("comm")).is_ok_and(|c| c.trim() == PROCESS) && !exited(&dir)
        })
        .collect()
}

/// The fields of `/proc/<pid>/stat` after the name, which is in parentheses and may hold spaces.
#[cfg(target_os = "linux")]
fn stat_fields(dir: &Path) -> Option<Vec<String>> {
    let stat = fs::read_to_string(dir.join("stat")).ok()?;
    let (_, rest) = stat.rsplit_once(')')?;
    Some(rest.split_whitespace().map(str::to_owned).collect())
}

/// A process that has exited but not been collected yet (state `Z`).
#[cfg(target_os = "linux")]
fn exited(dir: &Path) -> bool {
    stat_fields(dir).is_some_and(|f| f.first().is_some_and(|s| s == "Z"))
}

/// When the process started; the fields after the name begin at field 3, so 22 is index 19.
#[cfg(target_os = "linux")]
fn start_time_in(proc_root: &Path, pid: u32) -> Option<u64> {
    stat_fields(&proc_root.join(pid.to_string()))?.get(19)?.parse().ok()
}

#[cfg(target_os = "linux")]
fn running() -> Vec<u32> {
    running_in(Path::new("/proc"))
}

/// A running process's identity; None once it has exited (a zombie included).
#[cfg(target_os = "linux")]
fn proc_of(pid: u32) -> Option<Proc> {
    let root = Path::new("/proc");
    if exited(&root.join(pid.to_string())) {
        return None;
    }
    Some(Proc { pid, start: start_time_in(root, pid)? })
}

/// Elsewhere the process table comes from the system through `sysinfo`.
#[cfg(not(target_os = "linux"))]
fn processes() -> sysinfo::System {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys
}

#[cfg(not(target_os = "linux"))]
fn running() -> Vec<u32> {
    processes()
        .processes()
        .values()
        .filter(|p| p.name().eq_ignore_ascii_case(PROCESS))
        .map(|p| p.pid().as_u32())
        .collect()
}

#[cfg(not(target_os = "linux"))]
fn proc_of(pid: u32) -> Option<Proc> {
    let sys = processes();
    let p = sys.process(sysinfo::Pid::from_u32(pid))?;
    if matches!(p.status(), sysinfo::ProcessStatus::Zombie | sysinfo::ProcessStatus::Dead) {
        return None;
    }
    Some(Proc { pid, start: p.start_time() })
}

/// Still the same process orbiter started: its pid is running and it started when we noted. Not
/// by name: an AppImage takes a moment to become `tennoscope` (its runtime mounts it, then runs
/// its launcher, which runs the program in its place), and the start time already tells a reused
/// pid apart.
fn alive(p: Proc) -> bool {
    proc_of(p.pid) == Some(p)
}

fn pid_file() -> Option<PathBuf> {
    Some(crate::bridge::runtime_dir()?.join(PID_FILE))
}

fn remember(p: Option<Proc>) {
    let Some(file) = pid_file() else { return };
    match p {
        Some(p) => {
            let _ = crate::write_atomic(&file, format!("{} {}", p.pid, p.start).as_bytes(), true);
        }
        None => {
            let _ = fs::remove_file(file);
        }
    }
}

fn parse_pid_file(text: &str) -> Option<Proc> {
    let mut it = text.split_whitespace();
    Some(Proc { pid: it.next()?.parse().ok()?, start: it.next()?.parse().ok()? })
}

#[cfg(unix)]
fn terminate(pid: u32) {
    // SAFETY: kill has no memory preconditions; the pid was just checked to be our TennoScope.
    unsafe {
        libc::kill(pid as libc::pid_t, libc::SIGTERM);
    }
}
#[cfg(not(unix))]
fn terminate(pid: u32) {
    if let Some(p) = processes().process(sysinfo::Pid::from_u32(pid)) {
        p.kill();
    }
}

/// Variables orbiter's own AppImage sets for itself (its folder, and paths inside it), taken off
/// a TennoScope it starts: TennoScope is an AppImage of its own and must find its own libraries,
/// not orbiter's.
#[cfg(target_os = "linux")]
fn scrub_appimage_env(cmd: &mut Command) {
    let Some(appdir) = std::env::var_os("APPDIR").filter(|d| !d.is_empty()) else { return };
    let appdir = appdir.to_string_lossy().into_owned();
    for (key, value) in std::env::vars_os() {
        let Some(k) = key.to_str() else { continue };
        if matches!(k, "APPDIR" | "APPIMAGE" | "ARGV0" | "OWD") {
            cmd.env_remove(&key);
            continue;
        }
        let v = value.to_string_lossy();
        if !v.contains(&appdir) {
            continue;
        }
        let kept: Vec<&str> = v.split(':').filter(|part| !part.is_empty() && !part.starts_with(&appdir)).collect();
        if kept.is_empty() {
            cmd.env_remove(&key);
        } else {
            cmd.env(&key, kept.join(":"));
        }
    }
}

/// A TennoScope process, without orbiter's own environment: the WebKit tuning orbiter set for its
/// window, and on Linux its AppImage's paths. The one inside orbiter is told so
/// (`ORBITER_BUNDLED`): its own updater then stands down, as orbiter brings its updates.
fn launch(bin: &Path, bundled: bool) -> Command {
    let mut cmd = Command::new(bin);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    for key in crate::env_set_by_orbiter() {
        cmd.env_remove(key);
    }
    #[cfg(target_os = "linux")]
    scrub_appimage_env(&mut cmd);
    if bundled {
        cmd.env("ORBITER_BUNDLED", "1");
    }
    // TennoScope's own switch: its overlay on a solid background instead of a transparent one.
    if OPAQUE_OVERLAY.load(std::sync::atomic::Ordering::Relaxed) {
        cmd.env("TENNOSCOPE_OPAQUE_OVERLAY", "1");
    }
    cmd
}

static OPAQUE_OVERLAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn set_opaque_overlay(on: bool) {
    OPAQUE_OVERLAY.store(on, std::sync::atomic::Ordering::Relaxed);
}

/// How long a second TennoScope has to pass its request over and exit.
const HAND_OFF: Duration = Duration::from_secs(3);

impl Companion {
    /// Notes the TennoScope inside this build (from its resource folder), if it carries one.
    pub fn set_bundled(&self, path: Option<PathBuf>) {
        *lock(&self.bundled) = path.filter(|p| p.is_file());
    }

    fn binary(&self, custom: Option<&str>) -> Option<(PathBuf, bool)> {
        let bundled = lock(&self.bundled).clone();
        let bin = find_binary(custom, bundled.as_deref())?;
        let is_bundled = bundled.as_deref() == Some(bin.as_path());
        Some((bin, is_bundled))
    }

    /// Picks up a TennoScope an earlier orbiter started (say orbiter was closed from the terminal).
    /// Only if it is still that same process: a pid reused by something else is never adopted.
    pub fn adopt(&self) {
        let Some(noted) = pid_file().and_then(|f| fs::read_to_string(f).ok()).and_then(|t| parse_pid_file(&t)) else {
            remember(None);
            return;
        };
        if alive(noted) {
            *lock(&self.started) = Some(noted);
        } else {
            remember(None);
        }
    }

    pub fn status(&self, custom: Option<&str>) -> Status {
        let live = running();
        let mut started = lock(&self.started);
        if started.is_some_and(|p| !alive(p)) {
            *started = None;
            remember(None);
        }
        let found = self.binary(custom);
        Status {
            binary: found.as_ref().map(|(p, _)| p.display().to_string()),
            bundled: found.is_some_and(|(_, b)| b),
            supported: SUPPORTED,
            // The one orbiter just started counts while it's still turning into TennoScope.
            running: !live.is_empty() || started.is_some(),
            started_by_orbiter: started.is_some(),
            report: read_report(&live),
        }
    }

    /// Starts TennoScope in the background unless one is already running.
    pub fn start(&self, custom: Option<&str>) -> Result<Status, String> {
        let _one_at_a_time = lock(&self.starting);
        if !SUPPORTED {
            return Err("TennoScope doesn't run on macOS.".into());
        }
        let ours = lock(&self.started).is_some_and(alive);
        if running().is_empty() && !ours {
            let (bin, bundled) = self.binary(custom).ok_or("TennoScope wasn't found. Set its path in Settings.")?;
            let mut child = launch(&bin, bundled).arg("--background").spawn().map_err(|e| {
                log::error!(target: "orbiter::tennoscope", "couldn't start {}: {e}", bin.display());
                format!("Couldn't start {}: {e}", bin.display())
            })?;
            log::info!(target: "orbiter::tennoscope", "started {}{} (pid {})", bin.display(), if bundled { ", the one inside orbiter" } else { "" }, child.id());
            let started = proc_of(child.id());
            // Collected in the background whenever it exits, so it never lingers as a zombie.
            std::thread::spawn(move || child.wait());
            *lock(&self.started) = started;
            remember(started);
        }
        Ok(self.status(custom))
    }

    /// Opens TennoScope's own window: a running TennoScope raises it, otherwise it starts normally.
    pub fn show(&self, custom: Option<&str>) -> Result<(), String> {
        let (bin, bundled) = self.binary(custom).ok_or("TennoScope wasn't found. Set its path in Settings.")?;
        let mut child = launch(&bin, bundled)
            .spawn()
            .map_err(|e| format!("Couldn't start {}: {e}", bin.display()))?;
        // Either it hands over to the running TennoScope and exits at once, or it is TennoScope;
        // collect it whenever it exits.
        std::thread::spawn(move || child.wait());
        Ok(())
    }

    /// Hands a request to the running TennoScope: starting it again with the flag passes it over
    /// (single instance) and the new process exits at once.
    pub fn ask(&self, custom: Option<&str>, arg: &str) -> Result<(), String> {
        if !allowed_ask(arg) {
            return Err(format!("Unknown request {arg}"));
        }
        if running().is_empty() {
            return Err("TennoScope isn't running.".into());
        }
        let (bin, bundled) = self.binary(custom).ok_or("TennoScope wasn't found. Set its path in Settings.")?;
        let mut child = launch(&bin, bundled)
            .arg(arg)
            .spawn()
            .map_err(|e| format!("Couldn't reach TennoScope: {e}"))?;
        // Normally it hands the request over and exits at once. If the TennoScope it was meant
        // for closed in the meantime, it becomes TennoScope itself (hidden, carrying out the
        // request): then it's one orbiter started, and orbiter closes it like the first.
        log::info!(target: "orbiter::tennoscope", "asked {arg}");
        let started = Arc::clone(&self.started);
        std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + HAND_OFF;
            while std::time::Instant::now() < deadline {
                if !matches!(child.try_wait(), Ok(None)) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if let Some(p) = proc_of(child.id()) {
                let mut slot = lock(&started);
                if !slot.is_some_and(alive) {
                    *slot = Some(p);
                    remember(Some(p));
                }
            }
            let _ = child.wait();
        });
        Ok(())
    }

    /// Stops the TennoScope orbiter started (and only that one), asking it to quit first.
    pub fn stop(&self) {
        let Some(p) = lock(&self.started).take() else { return };
        log::info!(target: "orbiter::tennoscope", "stopping the TennoScope orbiter started");
        if alive(p) {
            terminate(p.pid);
        }
        remember(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn finds_processes_by_name() {
        let root = std::env::temp_dir().join(format!("orbiter-proc-{}", std::process::id()));
        for (pid, comm, state) in [("101", "tennoscope\n", "S"), ("102", "orbiter\n", "S"), ("103", "tennoscope\n", "Z"), ("self", "x\n", "R")] {
            fs::create_dir_all(root.join(pid)).unwrap();
            fs::write(root.join(pid).join("comm"), comm).unwrap();
            fs::write(root.join(pid).join("stat"), format!("{pid} (tenno scope) {state} 1 2 3")).unwrap();
        }
        assert_eq!(running_in(&root), vec![101]);
        assert!(running_in(Path::new("/nonexistent")).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn report_must_be_fresh_and_alive() {
        let dir = std::env::temp_dir().join(format!("orbiter-report-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(read_report_in(&dir, &[7], 1_000).is_none(), "no file");
        fs::write(dir.join(STATUS_FILE), r#"{"at": 100000, "pid": 7, "game_running": true}"#).unwrap();
        assert!(read_report_in(&dir, &[7], 105_000).is_some());
        assert!(read_report_in(&dir, &[7], 200_000).is_none(), "stale");
        assert!(read_report_in(&dir, &[8], 105_000).is_none(), "written by a TennoScope that has gone");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn start_time_tells_reused_pids_apart() {
        let root = std::env::temp_dir().join(format!("orbiter-stat-{}", std::process::id()));
        fs::create_dir_all(root.join("42")).unwrap();
        // The name may hold spaces and parentheses; field 22 is counted after the last ')'.
        let fields: Vec<String> = (3..=25).map(|n| if n == 3 { "S".into() } else { n.to_string() }).collect();
        fs::write(root.join("42/stat"), format!("42 (tenno (x) scope) {}", fields.join(" "))).unwrap();
        assert_eq!(start_time_in(&root, 42), Some(22));
        assert_eq!(start_time_in(&root, 43), None);
        assert_eq!(parse_pid_file("42 22\n"), Some(Proc { pid: 42, start: 22 }));
        assert_eq!(parse_pid_file("42"), None, "an old pid file without a start time isn't trusted");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn only_known_requests_pass() {
        assert!(allowed_ask("--sync"));
        assert!(allowed_ask("--authorize-capture"));
        assert!(!allowed_ask("--presence=ingame"), "orbiter sets your status itself");
        assert!(!allowed_ask("--background"));
        assert!(!allowed_ask("; rm -rf ~"));
    }

    #[test]
    fn custom_path_wins_and_must_exist() {
        let me = std::env::current_exe().unwrap();
        assert_eq!(find_binary(Some("/definitely/not/here"), Some(&me)), None, "a wrong path in Settings isn't swapped for another");
        assert_eq!(find_binary(Some(me.to_str().unwrap()), None), Some(me.clone()));
        // No path set: the one inside orbiter comes first.
        assert_eq!(find_binary(None, Some(&me)), Some(me));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn appimage_paths_stay_with_orbiter() {
        // The variables are read from this process, so set them here (tests in this module don't
        // read them otherwise).
        std::env::set_var("APPDIR", "/tmp/.mount_orbiterX");
        std::env::set_var("APPIMAGE", "/home/me/orbiter.AppImage");
        std::env::set_var("ORBITER_TEST_DIRS", "/tmp/.mount_orbiterX/usr/share:/usr/share:/usr/local/share");
        std::env::set_var("ORBITER_TEST_ONLY", "/tmp/.mount_orbiterX/usr/lib/gio");
        let cmd = launch(Path::new("/bin/true"), true);
        let envs: std::collections::HashMap<_, _> = cmd.get_envs().map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned()))).collect();
        std::env::remove_var("APPDIR");
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("ORBITER_TEST_DIRS");
        std::env::remove_var("ORBITER_TEST_ONLY");
        assert_eq!(envs.get("APPDIR"), Some(&None), "removed");
        assert_eq!(envs.get("APPIMAGE"), Some(&None));
        assert_eq!(envs.get("ORBITER_TEST_DIRS"), Some(&Some("/usr/share:/usr/local/share".into())));
        assert_eq!(envs.get("ORBITER_TEST_ONLY"), Some(&None));
        assert_eq!(envs.get("ORBITER_BUNDLED"), Some(&Some("1".into())));
    }
}
