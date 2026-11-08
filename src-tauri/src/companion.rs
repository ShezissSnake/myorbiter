//! Starting TennoScope from MyOrbiter, so only one app needs opening.
//!
//! MyOrbiter reads TennoScope's data, and only TennoScope can read the reward cards off the screen,
//! so both have to run. MyOrbiter starts it with `--background` (a patched TennoScope then shows no
//! window, only its overlay over the game), and stops it when MyOrbiter closes. A TennoScope you
//! started yourself is left alone: MyOrbiter only ever stops the one it started.
//!
//! The release builds carry a patched TennoScope inside them (the AppImage another AppImage, the
//! Windows installer an `.exe` with its Tesseract), so nobody installs it separately. TennoScope
//! doesn't run on macOS: there MyOrbiter does without it.

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

/// Where the TennoScope MyOrbiter carries sits, under MyOrbiter's resource folder.
#[cfg(target_os = "linux")]
pub const BUNDLED: &str = "tennoscope/TennoScope.AppImage";
#[cfg(not(target_os = "linux"))]
pub const BUNDLED: &str = "tennoscope/tennoscope.exe";
/// Remembers the TennoScope MyOrbiter started, across a MyOrbiter restart.
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
    /// The TennoScope inside this build of MyOrbiter, if it carries one.
    bundled: Mutex<Option<PathBuf>>,
    /// The program you chose in Settings, if any, and the file that keeps it (see `set_custom`).
    /// It lives here, not in the page's settings: the page can ask to change it, but can't make
    /// MyOrbiter start a program by naming it in a request.
    custom: Mutex<Option<String>>,
    custom_file: Mutex<Option<PathBuf>>,
    /// The TennoScope MyOrbiter started, if it's the one running. Shared with the threads that
    /// watch a hand-off (see `ask`).
    started: Arc<Mutex<Option<Proc>>>,
    /// Held while starting one: two checks at once (the page polls) must not start two.
    starting: Mutex<()>,
}

/// How long `stop` waits for TennoScope to be gone after asking it to stop.
const STOP_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Serialize)]
pub struct Status {
    /// The program MyOrbiter would start, if found.
    pub binary: Option<String>,
    /// The program chosen in Settings, if one is (empty: MyOrbiter finds it).
    pub custom: Option<String>,
    /// That program is the one inside MyOrbiter.
    pub bundled: bool,
    /// TennoScope runs on this system (not on macOS).
    pub supported: bool,
    pub running: bool,
    pub started_by_myorbiter: bool,
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

/// The requests MyOrbiter sends a patched TennoScope (see its `orbiter_bridge::asks`). Your
/// warframe.market status isn't one: MyOrbiter holds that itself (see presence.rs). `--access=…`
/// is the Full mode switch (Settings, setup) and the first start's answer, each shown with its
/// warning.
pub fn allowed_ask(arg: &str) -> bool {
    matches!(arg, "--sync" | "--authorize-capture") || allowed_access(arg)
}

/// The modes MyOrbiter may start TennoScope in or switch it to: Full, or Overlay. Never Companion,
/// which would turn the reward screen off too.
pub fn allowed_access(arg: &str) -> bool {
    matches!(arg, "--access=full" | "--access=overlay")
}

/// A program MyOrbiter may start as TennoScope, by its file name: `tennoscope` (`tennoscope.exe` on
/// Windows), or a TennoScope AppImage (`TennoScope*.AppImage`, any case). MyOrbiter starts nothing
/// else, whatever path it is given.
pub fn program_allowed(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return false };
    let lower = name.to_ascii_lowercase();
    lower == "tennoscope" || lower == "tennoscope.exe" || (lower.starts_with("tennoscope") && lower.ends_with(".appimage"))
}

/// The path from Settings as MyOrbiter will use it, if it may: `~/` expanded, absolute, an existing
/// file, with a TennoScope name (see `program_allowed`).
pub fn check_custom(path: &str) -> Result<PathBuf, String> {
    let p = expand_home(path.trim());
    if !p.is_absolute() {
        return Err(format!("{}: give the program's full path", p.display()));
    }
    if !crate::local_path(&p) {
        return Err(format!("{}: MyOrbiter only starts a TennoScope on this computer, not one on a network share", p.display()));
    }
    if !program_allowed(&p) {
        return Err(format!("{}: MyOrbiter only starts a program named tennoscope, tennoscope.exe or TennoScope….AppImage", p.display()));
    }
    if !p.is_file() {
        return Err(format!("{}: there's no such file", p.display()));
    }
    Ok(p)
}

/// Where to find TennoScope: the path from Settings, then the one inside MyOrbiter, then (in a
/// development build) one built in this checkout's `tennoscope/` folder, then whatever
/// `tennoscope` is on PATH.
pub fn find_binary(custom: Option<&str>, bundled: Option<&Path>) -> Option<PathBuf> {
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        return check_custom(c).ok();
    }
    let mut candidates: Vec<PathBuf> = bundled.map(Path::to_path_buf).into_iter().collect();
    candidates.extend(checkout_build());
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join(PROCESS)));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// TennoScope as built in the MyOrbiter checkout this development build came from
/// (`tennoscope/target/release/tennoscope`, tennoscope/ORBITER.md). Release builds don't look
/// there: the build machine's folder means nothing on the player's.
#[cfg(debug_assertions)]
fn checkout_build() -> Option<PathBuf> {
    let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?;
    Some(checkout.join("tennoscope/target/release").join(PROCESS))
}
#[cfg(not(debug_assertions))]
fn checkout_build() -> Option<PathBuf> {
    None
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

/// Elsewhere the process table comes from the system through `sysinfo`. None when the system
/// won't give one (`System::new` can fail), which reads as "no such process" to every caller.
#[cfg(not(target_os = "linux"))]
fn processes() -> Option<sysinfo::System> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new().ok()?;
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    Some(sys)
}

#[cfg(not(target_os = "linux"))]
fn running() -> Vec<u32> {
    let Some(sys) = processes() else { return Vec::new() };
    sys.processes()
        .values()
        .filter(|p| p.name().eq_ignore_ascii_case(PROCESS))
        .map(|p| p.pid().as_u32())
        .collect()
}

#[cfg(not(target_os = "linux"))]
fn proc_of(pid: u32) -> Option<Proc> {
    let sys = processes()?;
    let p = sys.process(sysinfo::Pid::from_u32(pid))?;
    if matches!(p.status(), sysinfo::ProcessStatus::Zombie | sysinfo::ProcessStatus::Dead) {
        return None;
    }
    Some(Proc { pid, start: p.start_time() })
}

/// Still the same process MyOrbiter started: its pid is running and it started when we noted. Not
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
    let Some(sys) = processes() else { return };
    if let Some(p) = sys.process(sysinfo::Pid::from_u32(pid)) {
        p.kill();
    }
}

/// Variables MyOrbiter's own AppImage sets for itself (its folder, and paths inside it), taken off
/// a TennoScope it starts: TennoScope is an AppImage of its own and must find its own libraries,
/// not MyOrbiter's.
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

/// A TennoScope process, without MyOrbiter's own environment: the WebKit tuning MyOrbiter set for its
/// window, and on Linux its AppImage's paths. The one inside MyOrbiter is told so
/// (`ORBITER_BUNDLED`): its own updater then stands down, as MyOrbiter brings its updates.
fn launch(bin: &Path, bundled: bool) -> Command {
    let mut cmd = Command::new(bin);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    for key in crate::env_set_by_myorbiter() {
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

    /// Reads the program chosen in Settings from `file` (MyOrbiter's config folder), written only
    /// after a choice in the native file dialog (`tennoscope_choose_program`). Nothing the page
    /// saves names it: older versions' `tennoscope.path` in the page's settings isn't taken over.
    pub fn load_custom(&self, file: PathBuf) {
        let kept = fs::read_to_string(&file).ok().map(|text| text.trim().to_owned());
        // Checked again as it's read: only a program named like TennoScope, whatever the file says.
        *lock(&self.custom) = kept.filter(|k| !k.is_empty() && check_custom(k).is_ok());
        *lock(&self.custom_file) = Some(file);
    }

    /// Sets the program (None or empty: find it), once it passes `check_custom`, and keeps it for
    /// the next start. Called with a path only from the native file dialog.
    pub fn set_custom(&self, path: Option<&str>) -> Result<(), String> {
        let path = path.map(str::trim).filter(|p| !p.is_empty());
        let value = match path {
            Some(p) => Some(check_custom(p)?.display().to_string()),
            None => None,
        };
        if let Some(file) = lock(&self.custom_file).as_ref() {
            crate::write_atomic(file, value.as_deref().unwrap_or("").as_bytes(), true).map_err(|e| format!("couldn't keep the path: {e}"))?;
        }
        log::info!(target: "myorbiter::tennoscope", "program set to {}", value.as_deref().unwrap_or("(found by MyOrbiter)"));
        *lock(&self.custom) = value;
        Ok(())
    }

    fn binary(&self) -> Option<(PathBuf, bool)> {
        let custom = lock(&self.custom).clone();
        let bundled = lock(&self.bundled).clone();
        let bin = find_binary(custom.as_deref(), bundled.as_deref())?;
        let is_bundled = bundled.as_deref() == Some(bin.as_path());
        Some((bin, is_bundled))
    }

    /// Picks up a TennoScope an earlier MyOrbiter started (say MyOrbiter was closed from the terminal).
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

    pub fn status(&self) -> Status {
        let live = running();
        let mut started = lock(&self.started);
        if started.is_some_and(|p| !alive(p)) {
            *started = None;
            remember(None);
        }
        let found = self.binary();
        Status {
            binary: found.as_ref().map(|(p, _)| p.display().to_string()),
            custom: lock(&self.custom).clone(),
            bundled: found.is_some_and(|(_, b)| b),
            supported: SUPPORTED,
            // The one MyOrbiter just started counts while it's still turning into TennoScope.
            running: !live.is_empty() || started.is_some(),
            started_by_myorbiter: started.is_some(),
            report: read_report(&live),
        }
    }

    /// Starts TennoScope in the background unless one is already running; with `access` (the first
    /// start's answer, `--access=full` or `--access=overlay`), in that mode: on the command line of
    /// the one it starts, or handed to the one already running.
    pub fn start_in(&self, access: Option<&str>) -> Result<Status, String> {
        if let Some(a) = access.filter(|a| !allowed_access(a)) {
            return Err(format!("Unknown request {a}"));
        }
        let _one_at_a_time = lock(&self.starting);
        if !SUPPORTED {
            return Err("TennoScope doesn't run on macOS.".into());
        }
        let ours = lock(&self.started).is_some_and(alive);
        if !running().is_empty() {
            if let Some(a) = access {
                self.ask(a)?;
            }
        } else if !ours {
            let (bin, bundled) = self.binary().ok_or("TennoScope wasn't found. Choose it in Settings, TennoScope, Program.")?;
            let mut command = launch(&bin, bundled);
            command.arg("--background").args(access);
            let mut child = command.spawn().map_err(|e| {
                log::error!(target: "myorbiter::tennoscope", "couldn't start {}: {e}", bin.display());
                format!("Couldn't start {}: {e}", bin.display())
            })?;
            log::info!(target: "myorbiter::tennoscope", "started {}{} (pid {})", bin.display(), if bundled { ", the one inside MyOrbiter" } else { "" }, child.id());
            let started = proc_of(child.id());
            // Collected in the background whenever it exits, so it never lingers as a zombie.
            std::thread::spawn(move || child.wait());
            *lock(&self.started) = started;
            remember(started);
        }
        Ok(self.status())
    }

    /// Opens TennoScope's own window: a running TennoScope raises it, otherwise it starts normally.
    pub fn show(&self) -> Result<(), String> {
        let (bin, bundled) = self.binary().ok_or("TennoScope wasn't found. Choose it in Settings, TennoScope, Program.")?;
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
    pub fn ask(&self, arg: &str) -> Result<(), String> {
        if !allowed_ask(arg) {
            return Err(format!("Unknown request {arg}"));
        }
        if running().is_empty() {
            return Err("TennoScope isn't running.".into());
        }
        let (bin, bundled) = self.binary().ok_or("TennoScope wasn't found. Choose it in Settings, TennoScope, Program.")?;
        let mut child = launch(&bin, bundled)
            .arg(arg)
            .spawn()
            .map_err(|e| format!("Couldn't reach TennoScope: {e}"))?;
        // Normally it hands the request over and exits at once. If the TennoScope it was meant
        // for closed in the meantime, it becomes TennoScope itself (hidden, carrying out the
        // request): then it's one MyOrbiter started, and MyOrbiter closes it like the first.
        log::info!(target: "myorbiter::tennoscope", "asked {arg}");
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

    /// Stops the TennoScope MyOrbiter started (and only that one), asking it to quit first.
    pub fn stop(&self) {
        let Some(p) = lock(&self.started).take() else { return };
        log::info!(target: "myorbiter::tennoscope", "stopping the TennoScope MyOrbiter started");
        if alive(p) {
            terminate(p.pid);
            // Asking isn't the same as it being gone: on Windows the process ends a moment after
            // TerminateProcess returns, and until then its files are locked. The installer that
            // runs right after this (updates.rs) would stop on "can't write tennoscope.exe".
            let until = std::time::Instant::now() + STOP_WAIT;
            while alive(p) && std::time::Instant::now() < until {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if alive(p) {
                log::warn!(target: "myorbiter::tennoscope", "TennoScope was still running {} s after being asked to stop", STOP_WAIT.as_secs());
            }
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
        let root = std::env::temp_dir().join(format!("myorbiter-proc-{}", std::process::id()));
        for (pid, comm, state) in [("101", "tennoscope\n", "S"), ("102", "myorbiter\n", "S"), ("103", "tennoscope\n", "Z"), ("self", "x\n", "R")] {
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
        let dir = std::env::temp_dir().join(format!("myorbiter-report-{}", std::process::id()));
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
        let root = std::env::temp_dir().join(format!("myorbiter-stat-{}", std::process::id()));
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
        assert!(allowed_ask("--access=full") && allowed_ask("--access=overlay"));
        assert!(!allowed_ask("--access=companion"), "MyOrbiter turns Full off to Overlay, never further");
        assert!(!allowed_ask("--presence=ingame"), "MyOrbiter sets your status itself");
        assert!(!allowed_ask("--background"));
        assert!(!allowed_ask("; rm -rf ~"));
    }

    #[test]
    fn a_first_start_asks_only_for_full_or_overlay() {
        assert!(allowed_access("--access=full") && allowed_access("--access=overlay"));
        for refused in ["--access=companion", "--sync", "--background", "--access=full --sync", ""] {
            assert!(!allowed_access(refused), "{refused}");
        }
        // Refused before anything is looked at or started.
        let companion = Companion::default();
        assert_eq!(companion.start_in(Some("--access=companion")).unwrap_err(), "Unknown request --access=companion");
    }

    #[test]
    fn custom_path_wins_must_exist_and_be_tennoscope() {
        let dir = std::env::temp_dir().join(format!("myorbiter-find-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let ts = dir.join(PROCESS);
        fs::write(&ts, b"").unwrap();
        let me = std::env::current_exe().unwrap();
        assert_eq!(find_binary(Some("/definitely/not/here/tennoscope"), Some(&me)), None, "a wrong path in Settings isn't swapped for another");
        assert_eq!(find_binary(Some(ts.to_str().unwrap()), None), Some(ts.clone()));
        assert_eq!(find_binary(Some(me.to_str().unwrap()), None), None, "a program that isn't TennoScope is never started");
        // No path set: the one inside MyOrbiter comes first.
        assert_eq!(find_binary(None, Some(&me)), Some(me));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_tennoscope_names_may_start() {
        for ok in ["/opt/tennoscope", "/x/tennoscope.exe", "/x/TennoScope.exe", "/x/TennoScope_0.14.0_amd64.AppImage", "/x/tennoscope.appimage"] {
            assert!(program_allowed(Path::new(ok)), "{ok}");
        }
        for no in ["/bin/sh", "/x/tennoscope.sh", "/x/tennoscope-evil", "/x/not-tennoscope", "/x/TennoScope.AppImage.sh", "/x/", "tennoscope/.."] {
            assert!(!program_allowed(Path::new(no)), "{no}");
        }
        assert!(check_custom("tennoscope").is_err(), "a relative path isn't taken");
        assert!(check_custom("/definitely/not/here/tennoscope").is_err(), "nor a missing file");
    }

    #[test]
    fn the_chosen_program_is_kept_and_read_back_only_if_it_s_still_a_tennoscope() {
        let dir = std::env::temp_dir().join(format!("myorbiter-custom-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let ts = dir.join(PROCESS);
        fs::write(&ts, b"").unwrap();
        let file = dir.join("tennoscope-program");
        // No file yet: found by MyOrbiter, whatever the page's settings say.
        let c = Companion::default();
        c.load_custom(file.clone());
        assert_eq!(c.status().custom, None);
        // Chosen (in the dialog): kept, and read back at the next start.
        c.set_custom(Some(&ts.display().to_string())).unwrap();
        let c = Companion::default();
        c.load_custom(file.clone());
        assert_eq!(c.status().custom, Some(ts.display().to_string()));
        // Something else is refused and changes nothing.
        assert!(c.set_custom(Some("/bin/sh")).is_err());
        assert_eq!(c.status().custom, Some(ts.display().to_string()));
        c.set_custom(None).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "");
        // A file holding something else (written by anything but the dialog) isn't started.
        fs::write(&file, "/bin/sh").unwrap();
        let c = Companion::default();
        c.load_custom(file.clone());
        assert_eq!(c.status().custom, None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn appimage_paths_stay_with_myorbiter() {
        // The variables are read from this process, so set them here (tests in this module don't
        // read them otherwise).
        std::env::set_var("APPDIR", "/tmp/.mount_myorbiterX");
        std::env::set_var("APPIMAGE", "/home/me/myorbiter.AppImage");
        std::env::set_var("MYORBITER_TEST_DIRS", "/tmp/.mount_myorbiterX/usr/share:/usr/share:/usr/local/share");
        std::env::set_var("MYORBITER_TEST_ONLY", "/tmp/.mount_myorbiterX/usr/lib/gio");
        let cmd = launch(Path::new("/bin/true"), true);
        let envs: std::collections::HashMap<_, _> = cmd.get_envs().map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned()))).collect();
        std::env::remove_var("APPDIR");
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("MYORBITER_TEST_DIRS");
        std::env::remove_var("MYORBITER_TEST_ONLY");
        assert_eq!(envs.get("APPDIR"), Some(&None), "removed");
        assert_eq!(envs.get("APPIMAGE"), Some(&None));
        assert_eq!(envs.get("MYORBITER_TEST_DIRS"), Some(&Some("/usr/share:/usr/local/share".into())));
        assert_eq!(envs.get("MYORBITER_TEST_ONLY"), Some(&None));
        assert_eq!(envs.get("ORBITER_BUNDLED"), Some(&Some("1".into())));
    }
}
