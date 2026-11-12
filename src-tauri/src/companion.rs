//! Starting TennoScope from MyOrbiter, so only one app needs opening.
//!
//! MyOrbiter reads TennoScope's data, and only TennoScope can read the reward cards off the screen,
//! so both have to run. MyOrbiter starts it with `--background` (a patched TennoScope then shows no
//! window, only its overlay over the game), and stops it when MyOrbiter closes. A TennoScope you
//! started yourself is left alone: MyOrbiter only ever stops the one it started.
//! On Windows it also ends when MyOrbiter's process ends however that happens (a job object, see
//! `win`), and stopping it never starts another program.
//!
//! The release builds carry a patched TennoScope inside them (the AppImage another AppImage, the
//! Windows installer an `.exe` with its Tesseract), so nobody installs it separately. TennoScope
//! doesn't run on macOS: there MyOrbiter does without it.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
#[cfg_attr(test, allow(dead_code))]
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
    /// What TennoScope last answered, so the log has a line per change (`Seen`).
    seen: Mutex<Seen>,
    /// Held while starting one: two checks at once (the page polls) must not start two.
    starting: Mutex<()>,
    /// How often the TennoScope MyOrbiter started has ended by itself lately, and so whether
    /// MyOrbiter starts it again (see `Relaunch`). Shared with the thread that waits for it.
    relaunch: Arc<Mutex<Relaunch>>,
}

/// A run that lasts this long is a TennoScope that worked: one that ends after it is one more
/// crash to start over from, not one more in a row.
const STEADY: Duration = Duration::from_secs(120);
/// The wait before the first restart; each one after it waits twice as long.
const RETRY_FIRST: Duration = Duration::from_secs(15);
/// After this many starts in a row that each ended within `STEADY`, MyOrbiter stops starting it by
/// itself until the player starts it (Settings, TennoScope).
const MAX_TRIES: u32 = 4;

/// What MyOrbiter does about a TennoScope that ends by itself (a crash, a kill by the system, a
/// start that fails), so that nothing restarts in a loop: a growing wait between starts, and no more
/// after `MAX_TRIES` in a row. MyOrbiter stopping it (`stop`) is not an end.
#[derive(Debug)]
struct Relaunch {
    /// The wait before the first restart (`RETRY_FIRST`; shorter in tests).
    first: Duration,
    /// The run MyOrbiter is keeping track of: its pid and when it began.
    current: Option<(u32, Instant)>,
    /// Starts in a row that each ended within `STEADY`.
    tries: u32,
    wait_until: Option<Instant>,
    gave_up: bool,
}

impl Default for Relaunch {
    fn default() -> Self {
        Self { first: RETRY_FIRST, current: None, tries: 0, wait_until: None, gave_up: false }
    }
}

/// What follows a run that ended.
#[derive(Debug, PartialEq)]
enum Next {
    /// Another start, once this long has passed.
    After(Duration),
    GiveUp,
}

/// Why a routine start is held back.
#[derive(Debug, PartialEq)]
enum Held {
    Waiting(Duration),
    GaveUp,
}

impl Relaunch {
    /// A TennoScope MyOrbiter is responsible for began (started, adopted, or a hand-off that turned
    /// into TennoScope).
    fn running(&mut self, pid: u32, now: Instant) {
        self.current = Some((pid, now));
    }

    /// MyOrbiter stopped it on purpose: its end is not one to count.
    fn stopped(&mut self) {
        self.current = None;
    }

    /// Whether a start by the page's routine check may go ahead now.
    fn may_start(&self, now: Instant) -> Result<(), Held> {
        if self.gave_up {
            return Err(Held::GaveUp);
        }
        match self.wait_until {
            Some(t) if now < t => Err(Held::Waiting(t - now)),
            _ => Ok(()),
        }
    }

    /// The player asked for it (Start TennoScope): the count starts over.
    fn reset(&mut self) {
        *self = Self { first: self.first, current: self.current, ..Self::default() };
    }

    /// Run `pid` ended. None when it isn't the run being tracked (MyOrbiter stopped it, or another
    /// path already noted its end): the first path to see an end counts it, once.
    fn exited(&mut self, pid: u32, now: Instant) -> Option<(Duration, u32, Next)> {
        let (current, began) = self.current?;
        if current != pid {
            return None;
        }
        self.current = None;
        let ran = now.saturating_duration_since(began);
        let (tries, next) = self.ended(ran, now);
        Some((ran, tries, next))
    }

    /// A start that didn't get as far as running (the program couldn't be started).
    fn failed(&mut self, now: Instant) -> (u32, Next) {
        self.ended(Duration::ZERO, now)
    }

    fn ended(&mut self, ran: Duration, now: Instant) -> (u32, Next) {
        // Given up stays given up until the player starts it (a hand-off that became TennoScope can end after).
        if self.gave_up {
            return (self.tries, Next::GiveUp);
        }
        self.tries = if ran >= STEADY { 1 } else { self.tries + 1 };
        if self.tries >= MAX_TRIES {
            self.gave_up = true;
            self.wait_until = None;
            return (self.tries, Next::GiveUp);
        }
        let wait = self.first * 2u32.pow(self.tries - 1);
        self.wait_until = Some(now + wait);
        (self.tries, Next::After(wait))
    }

    fn view(&self, now: Instant) -> Restart {
        Restart {
            tries: self.tries,
            gave_up: self.gave_up,
            retry_in_ms: self.wait_until.filter(|_| !self.gave_up).map(|t| t.saturating_duration_since(now).as_millis() as u64).filter(|ms| *ms > 0),
        }
    }
}

/// Says in the log what happened to a run that ended and what MyOrbiter does next.
fn log_end(what: &str, tries: u32, next: &Next) {
    match next {
        Next::After(wait) => log::warn!(target: "myorbiter::tennoscope", "{what}; starting it again in {} s (try {tries} of {MAX_TRIES})", wait.as_secs()),
        Next::GiveUp => log::error!(target: "myorbiter::tennoscope", "{what}; it has now ended {MAX_TRIES} times in a row within {} s of starting, so MyOrbiter stops starting it by itself (Settings, TennoScope, Start, tries again)", STEADY.as_secs()),
    }
}

/// How a process ended, in words for the log. Which signal matters: 9 is the system ending it (out
/// of memory, or a kill), 11 a crash in the program itself.
fn describe_exit(code: Option<i32>, signal: Option<i32>) -> String {
    match (code, signal) {
        (_, Some(sig)) => {
            let name = match sig {
                1 => "SIGHUP",
                4 => "SIGILL",
                6 => "SIGABRT",
                7 => "SIGBUS",
                9 => "SIGKILL",
                11 => "SIGSEGV",
                15 => "SIGTERM",
                _ => "a signal",
            };
            format!("was ended by signal {sig} ({name})")
        }
        (Some(code), None) => format!("exited with code {code}"),
        (None, None) => "ended".to_owned(),
    }
}

#[cfg(unix)]
fn signal_of(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}
#[cfg(not(unix))]
fn signal_of(_: &std::process::ExitStatus) -> Option<i32> {
    None
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
    /// Whether MyOrbiter is holding off starting it again, or has stopped trying.
    pub restart: Restart,
}

/// See `Relaunch`.
#[derive(Debug, Serialize, Default)]
pub struct Restart {
    /// Starts in a row that each ended within two minutes.
    pub tries: u32,
    /// Too many of those: MyOrbiter starts it again only when the player does.
    pub gave_up: bool,
    /// The wait before the next start, when there is one.
    pub retry_in_ms: Option<u64>,
}

/// A patched TennoScope writes its state here every few seconds.
const STATUS_FILE: &str = "tennoscope-status.json";
/// Older than this, the report is from a TennoScope that has stopped.
const REPORT_FRESH_MS: u64 = 15_000;

fn read_report(live: &[u32]) -> Result<serde_json::Value, NoReport> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    report_in(&crate::bridge::runtime_dir().ok_or(NoReport::NoFolder)?, live, now)
}

/// The report, if it's recent and from a TennoScope that is still running.
#[cfg(test)]
fn read_report_in(dir: &Path, live: &[u32], now: u64) -> Option<serde_json::Value> {
    report_in(dir, live, now).ok()
}

/// Why there is no report to go by, for MyOrbiter's log.
#[derive(Debug, Clone, PartialEq)]
enum NoReport {
    /// No private folder to share files in (no `$XDG_RUNTIME_DIR`, and the temp folder's isn't safe).
    NoFolder,
    NoFile,
    Unreadable,
    /// Older than `REPORT_FRESH_MS`: written by a TennoScope that stopped writing.
    Stale(u64),
    /// Written by a TennoScope that isn't running any more (an old file).
    Gone,
}

impl NoReport {
    fn words(&self) -> String {
        match self {
            NoReport::NoFolder => "there's no private folder to share it in".into(),
            NoReport::NoFile => "it hasn't written one".into(),
            NoReport::Unreadable => "its report can't be read".into(),
            NoReport::Stale(secs) => format!("its last report is {secs} s old"),
            NoReport::Gone => "the report there is from a TennoScope that has ended".into(),
        }
    }
}

fn report_in(dir: &Path, live: &[u32], now: u64) -> Result<serde_json::Value, NoReport> {
    let text = fs::read_to_string(dir.join(STATUS_FILE)).map_err(|_| NoReport::NoFile)?;
    let report: serde_json::Value = serde_json::from_str(&text).map_err(|_| NoReport::Unreadable)?;
    let at = report.get("at").and_then(|a| a.as_u64()).ok_or(NoReport::Unreadable)?;
    let pid = report.get("pid").and_then(|p| p.as_u64()).map(|p| p as u32);
    if !pid.map_or(true, |p| live.contains(&p)) {
        return Err(NoReport::Gone);
    }
    let age = now.saturating_sub(at);
    if age >= REPORT_FRESH_MS {
        return Err(NoReport::Stale(age / 1000));
    }
    Ok(report)
}

/// What TennoScope last answered, as far as MyOrbiter's log tells it: each change is one line
/// (`Seen::changes`), never a name or a path of the player's.
#[derive(Debug, Clone, Default, PartialEq)]
struct Seen {
    running: bool,
    report: Option<Result<(), NoReport>>,
    access: Option<String>,
    game: Option<bool>,
    /// The game reader's state and message ("ready", "Inventory synchronized from warframe-memory").
    reader: Option<(String, String)>,
    catalog: Option<(String, String)>,
    /// When the last request it turned down was, and why.
    refused: Option<(u64, String)>,
}

impl Seen {
    fn of(running: bool, report: &Result<serde_json::Value, NoReport>) -> Seen {
        let state = |r: &serde_json::Value, part: &str| {
            let h = &r["health"][part];
            h["state"].as_str().map(|s| (s.to_string(), h["message"].as_str().unwrap_or("").chars().take(200).collect()))
        };
        match report {
            Ok(r) => Seen {
                running,
                report: Some(Ok(())),
                access: r["setup"]["access_mode"].as_str().map(str::to_string),
                game: r["game_running"].as_bool(),
                reader: state(r, "game_reader"),
                catalog: state(r, "catalog"),
                refused: r["last_error"]["at"].as_u64().map(|at| (at, r["last_error"]["message"].as_str().unwrap_or("").chars().take(200).collect())),
            },
            Err(why) => Seen { running, report: running.then(|| Err(why.clone())), ..Seen::default() },
        }
    }

    /// The lines for what changed from `before` to `self`.
    fn changes(&self, before: &Seen) -> Vec<String> {
        let mut out = Vec::new();
        if self.running != before.running {
            out.push(if self.running { "TennoScope is running".to_string() } else { "TennoScope isn't running".to_string() });
        }
        // By kind: a stale report's age grows every look, and is one change, not one a look.
        fn kind(r: &Option<Result<(), NoReport>>) -> Option<Result<(), std::mem::Discriminant<NoReport>>> {
            r.as_ref().map(|r| r.as_ref().map_err(std::mem::discriminant).copied())
        }
        if kind(&self.report) != kind(&before.report) {
            match (&self.report, &before.report) {
                (Some(Ok(())), Some(Ok(()))) => {}
                (Some(Ok(())), _) => out.push("TennoScope's report received".into()),
                (Some(Err(why)), _) => out.push(format!("no report from TennoScope: {}", why.words())),
                (None, _) => {}
            }
        }
        if self.report != Some(Ok(())) {
            return out;
        }
        if self.access != before.access {
            out.push(format!("TennoScope's access mode: {}", self.access.as_deref().unwrap_or("not chosen")));
        }
        if self.game != before.game {
            out.push(match self.game {
                Some(true) => "TennoScope sees Warframe running".to_string(),
                Some(false) => "TennoScope doesn't see Warframe running".to_string(),
                None => "TennoScope doesn't say whether Warframe runs".to_string(),
            });
        }
        if self.reader != before.reader {
            if let Some((state, message)) = &self.reader {
                out.push(format!("TennoScope's game reader: {state}{}", if message.is_empty() { String::new() } else { format!(" ({message})") }));
            }
        }
        if self.catalog != before.catalog {
            if let Some((state, message)) = self.catalog.as_ref().filter(|(s, _)| s != "ready") {
                out.push(format!("TennoScope's item data: {state}{}", if message.is_empty() { String::new() } else { format!(" ({message})") }));
            }
        }
        if self.refused != before.refused {
            if let Some((_, message)) = &self.refused {
                out.push(format!("TennoScope turned a request down: {message}"));
            }
        }
        out
    }
}

/// The requests MyOrbiter sends a patched TennoScope (see its `orbiter_bridge::asks`). Your
/// warframe.market status isn't one: MyOrbiter holds that itself (see presence.rs). `--access=…`
/// is the Full mode switch (Settings, setup), which shows its warning beside it.
pub fn allowed_ask(arg: &str) -> bool {
    matches!(arg, "--sync" | "--authorize-capture" | "--access=full" | "--access=overlay")
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

#[cfg(all(target_os = "linux", not(test)))]
fn running() -> Vec<u32> {
    running_in(Path::new("/proc"))
}
/// The tests' view of the system: no TennoScope running (the one on the computer the tests run on
/// is never looked at), so they can start a stand-in.
#[cfg(test)]
fn running() -> Vec<u32> {
    Vec::new()
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

#[cfg(all(not(target_os = "linux"), not(test)))]
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

#[cfg(not(test))]
fn pid_file() -> Option<PathBuf> {
    Some(crate::bridge::runtime_dir()?.join(PID_FILE))
}
/// Tests never touch the pid file of a MyOrbiter that is running on the same computer.
#[cfg(test)]
fn pid_file() -> Option<PathBuf> {
    None
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
/// On Windows through a handle to the process, never by starting another program: `sysinfo`'s
/// `kill` runs `taskkill.exe`, and `stop` also runs from `RunEvent::Exit`, which Windows reaches
/// inside WM_ENDSESSION while it ends the session. A program started then can't initialise and
/// Windows shows "taskkill.exe - Application Error (0xc0000142)" at every shutdown.
#[cfg(windows)]
fn terminate(pid: u32) {
    win::terminate(pid);
}
#[cfg(not(any(unix, windows)))]
fn terminate(_pid: u32) {}

/// Stopping TennoScope on Windows without starting a program: a handle to the process for `stop`,
/// and a job object that ends the TennoScope MyOrbiter started when MyOrbiter's process ends,
/// however it ends (a crash, Task Manager, the session ending before `stop` runs). Six kernel32
/// functions, declared here; every Windows program links kernel32.
#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;

    type Handle = *mut c_void;

    const PROCESS_TERMINATE: u32 = 0x0001;
    /// `JobObjectExtendedLimitInformation`, the class `ExtendedLimits` is set with.
    const EXTENDED_LIMIT_INFORMATION: i32 = 9;
    /// Programs TennoScope starts (its WebView2, Tesseract, a browser opened from its window) stay
    /// out of the job: only TennoScope itself ends with MyOrbiter, as on Linux, where only it is
    /// sent SIGTERM.
    const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK: u32 = 0x1000;
    /// When the last handle to the job closes, every process in it is ended.
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

    /// `JOBOBJECT_BASIC_LIMIT_INFORMATION`.
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    /// `IO_COUNTERS`.
    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    /// `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`.
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    // The sizes Windows expects (`sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)`), checked when
    // MyOrbiter is built for Windows.
    #[cfg(target_pointer_width = "64")]
    const _: () = assert!(std::mem::size_of::<ExtendedLimits>() == 144);
    #[cfg(target_pointer_width = "32")]
    const _: () = assert!(std::mem::size_of::<ExtendedLimits>() == 112);

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn TerminateProcess(process: Handle, exit_code: u32) -> i32;
        fn CloseHandle(object: Handle) -> i32;
        fn CreateJobObjectW(job_attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, information: *const c_void, length: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
    }

    /// Ends the process `pid` (already checked to be the TennoScope MyOrbiter started).
    pub fn terminate(pid: u32) {
        // SAFETY: no pointers are passed; the handle is checked before use and closed once.
        unsafe {
            let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                log::warn!(target: "myorbiter::tennoscope", "couldn't open TennoScope (pid {pid}) to stop it: {}", std::io::Error::last_os_error());
                return;
            }
            if TerminateProcess(process, 1) == 0 {
                log::warn!(target: "myorbiter::tennoscope", "couldn't stop TennoScope (pid {pid}): {}", std::io::Error::last_os_error());
            }
            CloseHandle(process);
        }
    }

    /// The job, made the first time it's needed and never closed by MyOrbiter: Windows closes the
    /// handle as MyOrbiter's process ends, and that ends what is in the job. The handle isn't
    /// inheritable, so no program MyOrbiter starts holds it open. None if Windows wouldn't make one.
    fn job() -> Option<Handle> {
        static JOB: OnceLock<Option<usize>> = OnceLock::new();
        let made = JOB.get_or_init(|| {
            // SAFETY: null attributes and name are allowed; `limits` outlives the call and its
            // size is the one passed; the handle is closed if it can't be set up.
            unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    log::warn!(target: "myorbiter::tennoscope", "couldn't make a job object: {}", std::io::Error::last_os_error());
                    return None;
                }
                let mut limits = ExtendedLimits::default();
                limits.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
                let set = SetInformationJobObject(
                    job,
                    EXTENDED_LIMIT_INFORMATION,
                    &limits as *const ExtendedLimits as *const c_void,
                    std::mem::size_of::<ExtendedLimits>() as u32,
                );
                if set == 0 {
                    log::warn!(target: "myorbiter::tennoscope", "couldn't set up the job object: {}", std::io::Error::last_os_error());
                    CloseHandle(job);
                    return None;
                }
                Some(job as usize)
            }
        });
        made.map(|h| h as Handle)
    }

    /// Puts a TennoScope MyOrbiter just started in the job, so it ends when MyOrbiter does. If that
    /// fails (MyOrbiter itself runs in a job that allows no other), `stop` still ends it on a
    /// normal quit.
    pub fn end_with_myorbiter(child: &mut std::process::Child) {
        let Some(job) = job() else { return };
        // SAFETY: both handles are valid: the job's for the life of the process, the child's
        // while `child` is borrowed.
        let added = unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as Handle) } != 0;
        // A hand-off process (`ask`) may already have passed its request over and exited.
        if !added && matches!(child.try_wait(), Ok(None)) {
            log::warn!(target: "myorbiter::tennoscope", "TennoScope (pid {}) won't end with MyOrbiter if MyOrbiter is killed: {}", child.id(), std::io::Error::last_os_error());
        }
    }
}

/// Variables MyOrbiter's own AppImage sets for itself (its folder, and paths inside it), taken off
/// a program it starts: TennoScope is an AppImage of its own and must find its own libraries, not
/// MyOrbiter's, and the system's programs (the file manager) must find the system's. The GTK hook
/// also forces its own theme (`GTK_THEME`, set beside `GTK_DATA_PREFIX=$APPDIR`) and puts
/// `$APPDIR/usr/share:/usr/share:` in front of the session's `XDG_DATA_DIRS`: both are undone, an
/// `XDG_DATA_DIRS` the session didn't have going back to unset (the spec's default).
#[cfg(target_os = "linux")]
fn scrub_appimage_env(cmd: &mut Command) {
    let Some(appdir) = std::env::var_os("APPDIR").filter(|d| !d.is_empty()) else { return };
    let appdir = appdir.to_string_lossy().into_owned();
    if std::env::var_os("GTK_DATA_PREFIX").is_some_and(|p| p.to_string_lossy() == appdir.as_str()) {
        cmd.env_remove("GTK_THEME");
    }
    for (key, value) in std::env::vars_os() {
        let Some(k) = key.to_str() else { continue };
        if matches!(k, "APPDIR" | "APPIMAGE" | "ARGV0" | "OWD") {
            cmd.env_remove(&key);
            continue;
        }
        let v = value.to_string_lossy();
        if k == "XDG_DATA_DIRS" {
            if let Some(session) = v.strip_prefix(&format!("{appdir}/usr/share:/usr/share:")) {
                match session.split(':').filter(|p| !p.is_empty()).collect::<Vec<_>>() {
                    kept if kept.is_empty() => cmd.env_remove(&key),
                    kept => cmd.env(&key, kept.join(":")),
                };
                continue;
            }
        }
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

/// A program started without MyOrbiter's own environment: the WebKit tuning MyOrbiter set for its
/// window, and on Linux its AppImage's paths (`scrub_appimage_env`). Its input and output go
/// nowhere.
pub(crate) fn plain_command(bin: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(bin);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    for key in crate::env_set_by_myorbiter() {
        cmd.env_remove(key);
    }
    #[cfg(target_os = "linux")]
    scrub_appimage_env(&mut cmd);
    cmd
}

/// A TennoScope process (`plain_command`). The one inside MyOrbiter is told so (`ORBITER_BUNDLED`):
/// its own updater then stands down, as MyOrbiter brings its updates.
fn launch(bin: &Path, bundled: bool) -> Command {
    let mut cmd = plain_command(bin);
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
        // A different program starts over: what the last one did says nothing about it.
        lock(&self.relaunch).reset();
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
            log::info!(target: "myorbiter::tennoscope", "adopted the TennoScope an earlier MyOrbiter started (pid {})", noted.pid);
            *lock(&self.started) = Some(noted);
            // Its real start time isn't known; it ran before this MyOrbiter did, so it counts as steady.
            let now = Instant::now();
            lock(&self.relaunch).running(noted.pid, now.checked_sub(STEADY).unwrap_or(now));
        } else {
            remember(None);
        }
    }

    pub fn status(&self) -> Status {
        let live = running();
        let mut started = lock(&self.started);
        if let Some(p) = started.filter(|p| !alive(*p)) {
            *started = None;
            remember(None);
            // One MyOrbiter didn't start itself (adopted, or a hand-off that became TennoScope) has
            // no thread waiting for it: its end is noticed here.
            let ended = lock(&self.relaunch).exited(p.pid, Instant::now());
            if let Some((ran, tries, next)) = ended {
                log_end(&format!("TennoScope (pid {}) ended on its own after {} s", p.pid, ran.as_secs()), tries, &next);
            }
        }
        let found = self.binary();
        let running = !live.is_empty() || started.is_some();
        let report = read_report(&live);
        {
            let next = Seen::of(running, &report);
            let mut seen = lock(&self.seen);
            for line in next.changes(&seen) {
                log::info!(target: "myorbiter::tennoscope", "{line}");
            }
            *seen = next;
        }
        Status {
            binary: found.as_ref().map(|(p, _)| p.display().to_string()),
            custom: lock(&self.custom).clone(),
            bundled: found.is_some_and(|(_, b)| b),
            supported: SUPPORTED,
            // The one MyOrbiter just started counts while it's still turning into TennoScope.
            running,
            started_by_myorbiter: started.is_some(),
            report: report.ok(),
            restart: lock(&self.relaunch).view(Instant::now()),
        }
    }

    /// Starts TennoScope in the background unless one is already running. Without `force` (the page's
    /// routine check every 15 s) it doesn't start one while MyOrbiter waits out a restart, or once
    /// the TennoScope has ended `MAX_TRIES` times in a row (see `Relaunch`); `force` (the player
    /// pressed Start) starts it whatever came before, and starts the count over.
    pub fn start(&self, force: bool) -> Result<Status, String> {
        let _one_at_a_time = lock(&self.starting);
        if !SUPPORTED {
            return Err("TennoScope doesn't run on macOS.".into());
        }
        let ours = lock(&self.started).is_some_and(alive);
        if running().is_empty() && !ours {
            {
                let mut relaunch = lock(&self.relaunch);
                if force {
                    relaunch.reset();
                } else if relaunch.may_start(Instant::now()).is_err() {
                    drop(relaunch);
                    return Ok(self.status());
                }
            }
            let (bin, bundled) = self.binary().ok_or("TennoScope wasn't found. Choose it in Settings, TennoScope, Program.")?;
            let mut child = match launch(&bin, bundled).arg("--background").spawn() {
                Ok(child) => child,
                Err(e) => {
                    log::error!(target: "myorbiter::tennoscope", "couldn't start {}: {e}", bin.display());
                    let (tries, next) = lock(&self.relaunch).failed(Instant::now());
                    log_end("TennoScope didn't start", tries, &next);
                    return Err(format!("Couldn't start {}: {e}", bin.display()));
                }
            };
            let pid = child.id();
            log::info!(target: "myorbiter::tennoscope", "started {}{} (pid {pid})", bin.display(), if bundled { ", the one inside MyOrbiter" } else { "" });
            #[cfg(windows)]
            win::end_with_myorbiter(&mut child);
            lock(&self.relaunch).running(pid, Instant::now());
            let started = proc_of(pid);
            *lock(&self.started) = started;
            remember(started);
            // Waited for in the background, so it never lingers as a zombie, and so how it ended
            // (a code, or the signal that ended it) is in the log.
            let slot = Arc::clone(&self.started);
            let relaunch = Arc::clone(&self.relaunch);
            std::thread::spawn(move || {
                let how = match child.wait() {
                    Ok(status) => describe_exit(status.code(), signal_of(&status)),
                    Err(e) => format!("couldn't be waited for ({e})"),
                };
                let ended = lock(&relaunch).exited(pid, Instant::now());
                {
                    let mut slot = lock(&slot);
                    if slot.is_some_and(|p| p.pid == pid) {
                        *slot = None;
                        remember(None);
                    }
                }
                match ended {
                    Some((ran, tries, next)) => log_end(&format!("TennoScope (pid {pid}) {how} after {} s, and MyOrbiter hadn't stopped it", ran.as_secs()), tries, &next),
                    None => log::info!(target: "myorbiter::tennoscope", "TennoScope (pid {pid}) {how}"),
                }
            });
        }
        Ok(self.status())
    }

    /// Opens TennoScope's own window: a running TennoScope raises it, otherwise it starts normally.
    pub fn show(&self) -> Result<(), String> {
        let (bin, bundled) = self.binary().ok_or("TennoScope wasn't found. Choose it in Settings, TennoScope, Program.")?;
        log::info!(target: "myorbiter::tennoscope", "asked to open TennoScope's window");
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
        // In the job too: if it becomes TennoScope (below), it is one MyOrbiter started.
        #[cfg(windows)]
        win::end_with_myorbiter(&mut child);
        // Normally it hands the request over and exits at once. If the TennoScope it was meant
        // for closed in the meantime, it becomes TennoScope itself (hidden, carrying out the
        // request): then it's one MyOrbiter started, and MyOrbiter closes it like the first.
        log::info!(target: "myorbiter::tennoscope", "asked {arg}");
        let started = Arc::clone(&self.started);
        let relaunch = Arc::clone(&self.relaunch);
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
                    lock(&relaunch).running(p.pid, Instant::now());
                    log::info!(target: "myorbiter::tennoscope", "the TennoScope started to pass on a request stayed up: it is the one MyOrbiter keeps (pid {})", p.pid);
                }
            }
            let _ = child.wait();
        });
        Ok(())
    }

    /// Stops the TennoScope MyOrbiter started (and only that one): SIGTERM on Unix, so it can quit
    /// cleanly; on Windows `TerminateProcess`, a hard stop as `taskkill /F` was before.
    pub fn stop(&self) {
        // Before anything else: its end from here on is MyOrbiter's doing, not one to count.
        lock(&self.relaunch).stopped();
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

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn a_helper_that_keeps_ending_is_started_again_after_longer_waits_and_then_left() {
        let t0 = Instant::now();
        let mut r = Relaunch::default();
        assert_eq!(r.may_start(t0), Ok(()), "the first start is never held");
        // Four starts in a row, each ended within two minutes of starting.
        r.running(100, t0);
        let (_, tries, next) = r.exited(100, t0 + secs(2)).unwrap();
        assert_eq!((tries, next), (1, Next::After(secs(15))));
        assert_eq!(r.may_start(t0 + secs(5)), Err(Held::Waiting(secs(12))), "the routine check waits");
        assert_eq!(r.may_start(t0 + secs(17)), Ok(()));
        r.running(101, t0 + secs(17));
        let (_, tries, next) = r.exited(101, t0 + secs(18)).unwrap();
        assert_eq!((tries, next), (2, Next::After(secs(30))));
        r.running(102, t0 + secs(50));
        let (_, tries, next) = r.exited(102, t0 + secs(51)).unwrap();
        assert_eq!((tries, next), (3, Next::After(secs(60))));
        r.running(103, t0 + secs(112));
        let (_, tries, next) = r.exited(103, t0 + secs(113)).unwrap();
        assert_eq!((tries, next), (4, Next::GiveUp));
        assert_eq!(r.may_start(t0 + secs(100_000)), Err(Held::GaveUp), "however long it waits");
        let view = r.view(t0 + secs(200));
        assert!(view.gave_up && view.retry_in_ms.is_none());
        // The player pressing Start begins again.
        r.reset();
        assert_eq!(r.may_start(t0 + secs(200)), Ok(()));
        assert_eq!(r.view(t0 + secs(200)).tries, 0);
    }

    #[test]
    fn a_run_that_lasted_is_one_crash_to_start_over_from() {
        let t0 = Instant::now();
        let mut r = Relaunch::default();
        for round in 0..10u32 {
            let at = t0 + secs(u64::from(round) * 4000);
            r.running(round, at);
            // An hour of running, then it ends by itself: restarted after the first wait, always.
            let (_, tries, next) = r.exited(round, at + secs(3600)).unwrap();
            assert_eq!((tries, next), (1, Next::After(secs(15))), "round {round}");
        }
        assert!(!r.view(t0 + secs(100_000)).gave_up);
    }

    #[test]
    fn stopping_it_and_the_same_end_seen_twice_count_for_nothing() {
        let t0 = Instant::now();
        let mut r = Relaunch::default();
        r.running(7, t0);
        r.stopped();
        assert!(r.exited(7, t0 + secs(1)).is_none(), "MyOrbiter ended it itself");
        assert_eq!(r.may_start(t0 + secs(1)), Ok(()));
        r.running(8, t0);
        assert!(r.exited(8, t0 + secs(1)).is_some());
        assert!(r.exited(8, t0 + secs(1)).is_none(), "the thread and the status check both see an end: once");
        assert!(r.exited(9, t0 + secs(1)).is_none(), "another process's end isn't this one's");
        // A start that fails counts like a run that ended at once.
        let (tries, next) = r.failed(t0 + secs(2));
        assert_eq!((tries, next), (2, Next::After(secs(30))));
    }

    #[test]
    fn the_log_says_how_it_ended() {
        assert_eq!(describe_exit(Some(1), None), "exited with code 1");
        assert_eq!(describe_exit(None, Some(9)), "was ended by signal 9 (SIGKILL)");
        assert_eq!(describe_exit(None, Some(11)), "was ended by signal 11 (SIGSEGV)");
        assert_eq!(describe_exit(None, None), "ended");
    }

    /// A stand-in TennoScope that exits at once, as one that crashes on start does: MyOrbiter's page
    /// checks every 15 s and starts it when it isn't running. Here the waits are milliseconds.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_helper_that_exits_on_start_is_started_a_few_times_then_left() {
        use std::os::unix::fs::PermissionsExt;
        let _env = crate::TEST_ENV.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!("myorbiter-standin-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("starts");
        let program = dir.join(PROCESS);
        fs::write(&program, format!("#!/bin/sh\necho \"$@\" >> '{}'\nexit 3\n", marker.display())).unwrap();
        fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
        let starts = || fs::read_to_string(&marker).map(|t| t.lines().count()).unwrap_or(0);

        let c = Companion::default();
        lock(&c.relaunch).first = Duration::from_millis(30);
        c.set_custom(Some(&program.display().to_string())).unwrap();
        // Until its end has been noted (the thread that waits for it), another check would only see
        // a TennoScope that isn't there; that's all the page does, every 15 s.
        let settled = |c: &Companion| {
            let until = Instant::now() + Duration::from_secs(10);
            while lock(&c.relaunch).current.is_some() && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(5));
            }
        };
        let mut checks = 0;
        while !c.status().restart.gave_up && checks < 1000 {
            c.start(false).unwrap();
            settled(&c);
            std::thread::sleep(Duration::from_millis(15));
            checks += 1;
        }
        let status = c.status();
        assert!(status.restart.gave_up, "it gives up");
        assert_eq!(starts(), MAX_TRIES as usize, "after exactly this many starts, however many checks it took");
        assert_eq!(fs::read_to_string(&marker).unwrap().lines().next(), Some("--background"), "started in the background");
        assert!(!status.running);
        // Left alone: more checks start nothing.
        for _ in 0..20 {
            c.start(false).unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(starts(), MAX_TRIES as usize);
        // Start pressed: it starts again, and the count starts over.
        let status = c.start(true).unwrap();
        settled(&c);
        assert_eq!(starts(), MAX_TRIES as usize + 1);
        assert!(!status.restart.gave_up);
        assert_eq!(c.status().restart.tries, 1);
        // MyOrbiter stopping a TennoScope is not an end to count (nothing of ours runs now).
        c.stop();
        fs::remove_dir_all(&dir).unwrap();
    }

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
    fn the_log_says_what_tennoscope_answered_once_per_change() {
        let report = |access: &str, game: bool, reader: (&str, &str)| -> Result<serde_json::Value, NoReport> {
            Ok(serde_json::json!({ "at": 1, "setup": { "access_mode": access }, "game_running": game, "health": { "game_reader": { "state": reader.0, "message": reader.1 }, "catalog": { "state": "ready", "message": "Item data up to date" } }, "last_error": null }))
        };
        let start = Seen::default();
        // Started, and nothing written yet: said once, with why.
        let silent = Seen::of(true, &Err(NoReport::NoFile));
        assert_eq!(silent.changes(&start), ["TennoScope is running", "no report from TennoScope: it hasn't written one"]);
        assert!(Seen::of(true, &Err(NoReport::NoFile)).changes(&silent).is_empty(), "the same again says nothing");
        let stale = Seen::of(true, &Err(NoReport::Stale(40)));
        assert_eq!(stale.changes(&silent), ["no report from TennoScope: its last report is 40 s old"]);
        assert!(Seen::of(true, &Err(NoReport::Stale(55))).changes(&stale).is_empty(), "older still is the same change");
        // The first report: everything in it, once.
        let first = Seen::of(true, &report("overlay", false, ("idle", "Warframe is not running")));
        assert_eq!(first.changes(&silent), ["TennoScope's report received", "TennoScope's access mode: overlay", "TennoScope doesn't see Warframe running", "TennoScope's game reader: idle (Warframe is not running)"]);
        // Full access granted, the game seen, the read done.
        let full = Seen::of(true, &report("full", true, ("ready", "Inventory synchronized from warframe-memory")));
        assert_eq!(full.changes(&first), ["TennoScope's access mode: full", "TennoScope sees Warframe running", "TennoScope's game reader: ready (Inventory synchronized from warframe-memory)"]);
        assert!(full.changes(&full).is_empty());
        // A read refused by the system, and a request turned down.
        let refused = Seen::of(true, &Ok(serde_json::json!({ "at": 1, "setup": { "access_mode": "full" }, "game_running": true, "health": { "game_reader": { "state": "failed", "message": "permission denied while reading Warframe process 12" }, "catalog": { "state": "failed", "message": "No valid WFCD catalog is available" } }, "last_error": { "at": 5, "message": "access mode is already changing" } })));
        assert_eq!(refused.changes(&full), ["TennoScope's game reader: failed (permission denied while reading Warframe process 12)", "TennoScope's item data: failed (No valid WFCD catalog is available)", "TennoScope turned a request down: access mode is already changing"]);
        // It ends: said, and nothing about a report it can't write.
        assert_eq!(Seen::of(false, &Err(NoReport::NoFile)).changes(&refused), ["TennoScope isn't running"]);
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
        assert_eq!(report_in(&dir, &[8], 105_000), Err(NoReport::Gone));
        assert_eq!(report_in(&dir, &[7], 200_000), Err(NoReport::Stale(100)));
        fs::write(dir.join(STATUS_FILE), "{not json").unwrap();
        assert_eq!(report_in(&dir, &[7], 105_000), Err(NoReport::Unreadable));
        fs::remove_file(dir.join(STATUS_FILE)).unwrap();
        assert_eq!(report_in(&dir, &[7], 105_000), Err(NoReport::NoFile));
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
        let _env = crate::TEST_ENV.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("APPDIR", "/tmp/.mount_myorbiterX");
        std::env::set_var("APPIMAGE", "/home/me/myorbiter.AppImage");
        std::env::set_var("MYORBITER_TEST_DIRS", "/tmp/.mount_myorbiterX/usr/share:/usr/share:/usr/local/share");
        std::env::set_var("MYORBITER_TEST_ONLY", "/tmp/.mount_myorbiterX/usr/lib/gio");
        // The GTK hook's own: its theme, and its data folders before the session's.
        let session = (std::env::var_os("GTK_DATA_PREFIX"), std::env::var_os("GTK_THEME"), std::env::var_os("XDG_DATA_DIRS"));
        std::env::set_var("GTK_DATA_PREFIX", "/tmp/.mount_myorbiterX");
        std::env::set_var("GTK_THEME", "Adwaita:dark");
        std::env::set_var("XDG_DATA_DIRS", "/tmp/.mount_myorbiterX/usr/share:/usr/share:/usr/local/share:/usr/share");
        let cmd = launch(Path::new("/bin/true"), true);
        // A session without XDG_DATA_DIRS: unset again, so the spec's default applies.
        std::env::set_var("XDG_DATA_DIRS", "/tmp/.mount_myorbiterX/usr/share:/usr/share:");
        let cmd2 = launch(Path::new("/bin/true"), true);
        for (k, v) in [("GTK_DATA_PREFIX", session.0), ("GTK_THEME", session.1), ("XDG_DATA_DIRS", session.2)] {
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
        std::env::remove_var("APPDIR");
        std::env::remove_var("APPIMAGE");
        std::env::remove_var("MYORBITER_TEST_DIRS");
        std::env::remove_var("MYORBITER_TEST_ONLY");
        let envs: std::collections::HashMap<_, _> = cmd.get_envs().map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned()))).collect();
        assert_eq!(envs.get("GTK_THEME"), Some(&None), "the system's theme, not the AppImage's");
        assert_eq!(envs.get("GTK_DATA_PREFIX"), Some(&None));
        assert_eq!(envs.get("XDG_DATA_DIRS"), Some(&Some("/usr/local/share:/usr/share".into())), "the session's own");
        assert_eq!(cmd2.get_envs().find(|(k, _)| *k == "XDG_DATA_DIRS").map(|(_, v)| v.is_none()), Some(true));
        assert_eq!(envs.get("APPDIR"), Some(&None), "removed");
        assert_eq!(envs.get("APPIMAGE"), Some(&None));
        assert_eq!(envs.get("MYORBITER_TEST_DIRS"), Some(&Some("/usr/share:/usr/local/share".into())));
        assert_eq!(envs.get("MYORBITER_TEST_ONLY"), Some(&None));
        assert_eq!(envs.get("ORBITER_BUNDLED"), Some(&Some("1".into())));
    }
}
