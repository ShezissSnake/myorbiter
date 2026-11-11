//! How WebKitGTK draws MyOrbiter's window on Linux, chosen at start before the window exists (WebKit
//! reads its environment once, when the first web view is made).
//!
//! - **Accelerated** (the default): WebKit's own choice. Composited on the GPU: scrolling moves
//!   layers instead of repainting the window, and animations run on transform and opacity.
//! - **Accelerated, shared-memory frames** (the NVIDIA driver): still composited on the GPU, but
//!   finished frames reach the window through shared memory instead of DMA-BUF buffers. The DMA-BUF
//!   path is what crashes there ("Error 71 (Protocol error) dispatching to Wayland display") or
//!   paints a blank window. `WEBKIT_DISABLE_DMABUF_RENDERER=1`, the usual fix, does more than its
//!   name says since WebKitGTK 2.44: with no renderer left WebKit stops compositing and paints every
//!   frame on the CPU. `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` keeps the renderer and drops only the
//!   buffer sharing. `WEBKIT_FORCE_DMABUF_RENDERER=1` is needed as well: Debian and Ubuntu build
//!   WebKitGTK (the one the AppImage carries) with a patch that turns the renderer off on NVIDIA,
//!   and that variable is the patch's way past it.
//! - **Accelerated, DMA-BUF frames on NVIDIA** (Settings › Logs, experimental, off unless chosen): the
//!   NVIDIA driver with WebKit's own DMA-BUF hand-over, to compare against shared memory on the
//!   player's own machine. Only `WEBKIT_FORCE_DMABUF_RENDERER=1`, for the Debian and Ubuntu patch.
//!   It is the path that crashes or paints blank on some NVIDIA setups (above): a try that closes
//!   within a minute is dropped by the next start, which goes back to shared memory and says so.
//!   `--no-dmabuf` drops it from a terminal, for a window that stays blank without closing.
//! - **Compatibility** (the Settings switch, or `--compat-rendering` once): no compositing and no
//!   DMA-BUF, every frame painted on the CPU. Slower, but it draws where nothing else does.
//! - **Your own**: any of WebKit's variables already set in the environment wins; MyOrbiter then sets
//!   none of them.
//!
//! An accelerated start leaves a marker once it gets going, removed when the window has run for a
//! minute, or on a clean exit. If the next start finds it (the window crashed early, as a renderer the driver
//! can't take does), that start and the ones after use compatibility rendering, and the log says so.
//! The marker names the process that left it: a second start while that MyOrbiter still runs (which
//! single-instance closes at once) isn't taken for an early close.

use std::path::PathBuf;
use std::sync::OnceLock;

/// WebKit's own variables for the renderer: one of these set by you means MyOrbiter sets none.
pub const WEBKIT_VARS: [&str; 5] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_FORCE_COMPOSITING_MODE",
];

/// The start flags: on saves compatibility rendering for every start after, off clears it.
pub const FLAG_ON: &str = "--compat-rendering";
pub const FLAG_OFF: &str = "--no-compat-rendering";
/// The start flag that drops the experimental DMA-BUF try.
pub const DMABUF_OFF: &str = "--no-dmabuf";

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Accelerated,
    /// Accelerated, frames through shared memory (the NVIDIA driver).
    SharedMemory,
    /// Accelerated, frames through DMA-BUF on the NVIDIA driver: the experimental switch.
    DmaBuf,
    Compat,
    /// WebKit variables you set yourself.
    Yours,
}

/// The variables a mode sets (each only where it isn't set already).
pub fn vars_for(mode: Mode) -> &'static [(&'static str, &'static str)] {
    match mode {
        Mode::SharedMemory => &[("WEBKIT_FORCE_DMABUF_RENDERER", "1"), ("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1")],
        Mode::DmaBuf => &[("WEBKIT_FORCE_DMABUF_RENDERER", "1")],
        Mode::Compat => &[("WEBKIT_DISABLE_DMABUF_RENDERER", "1"), ("WEBKIT_DISABLE_COMPOSITING_MODE", "1")],
        Mode::Accelerated | Mode::Yours => &[],
    }
}

/// Why compatibility rendering is on, when it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Why {
    /// Not on.
    None,
    /// Saved: the Settings switch or the start flag.
    Chosen,
    /// Switched on by MyOrbiter: the start before closed early in accelerated mode.
    AfterCrash,
    /// Not compatibility: the DMA-BUF try (NVIDIA) closed early, so it was dropped and this start
    /// is back on shared memory.
    DmaBufFailed,
}

/// The mode for this start, from what's saved and what this machine is. `dmabuf`: the
/// experimental DMA-BUF try is saved (it counts only with the NVIDIA driver).
pub fn decide(yours: bool, saved: Why, trial_left: bool, nvidia: bool, dmabuf: bool) -> (Mode, Why) {
    if yours {
        return (Mode::Yours, Why::None);
    }
    if saved != Why::None {
        return (Mode::Compat, saved);
    }
    let dmabuf = dmabuf && nvidia;
    if trial_left {
        // The start that closed early was the DMA-BUF try: back to shared memory, not to the CPU.
        return if dmabuf { (Mode::SharedMemory, Why::DmaBufFailed) } else { (Mode::Compat, Why::AfterCrash) };
    }
    match (nvidia, dmabuf) {
        (true, true) => (Mode::DmaBuf, Why::None),
        (true, false) => (Mode::SharedMemory, Why::None),
        _ => (Mode::Accelerated, Why::None),
    }
}

/// Whether the start flags drop the DMA-BUF try (`--no-dmabuf`).
pub fn dmabuf_off_in(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|a| a == DMABUF_OFF)
}

/// What a start flag asks for: Some(true) to save compatibility rendering, Some(false) to clear it.
pub fn flag_in(args: impl IntoIterator<Item = String>) -> Option<bool> {
    let mut asked = None;
    for a in args {
        if a == FLAG_ON {
            asked = Some(true);
        } else if a == FLAG_OFF {
            asked = Some(false);
        }
    }
    asked
}

const SAVED: &str = "rendering";
const TRIAL: &str = "rendering-trial";
/// The experimental DMA-BUF try on NVIDIA, saved for the next starts (present: on).
const DMABUF: &str = "rendering-dmabuf";

fn read_dmabuf(dir: &std::path::Path) -> bool {
    dir.join(DMABUF).is_file()
}

fn write_dmabuf(dir: &std::path::Path, on: bool) -> std::io::Result<()> {
    if on {
        std::fs::create_dir_all(dir)?;
        return std::fs::write(dir.join(DMABUF), "dmabuf\n");
    }
    match std::fs::remove_file(dir.join(DMABUF)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// The app's config folder (what Tauri's `app_config_dir` gives), worked out before Tauri starts.
fn config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
        Some(base.join(crate::datamove::ID))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

fn read_saved(dir: &std::path::Path) -> Why {
    match std::fs::read_to_string(dir.join(SAVED)).map(|s| s.trim().to_owned()).as_deref() {
        Ok("compat") => Why::Chosen,
        Ok("compat-after-crash") => Why::AfterCrash,
        _ => Why::None,
    }
}

fn write_saved(dir: &std::path::Path, why: Why) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    match why {
        Why::None => match std::fs::remove_file(dir.join(SAVED)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
        Why::Chosen => std::fs::write(dir.join(SAVED), "compat\n"),
        Why::AfterCrash => std::fs::write(dir.join(SAVED), "compat-after-crash\n"),
        // Never saved as compatibility: the DMA-BUF file is what's removed for it.
        Why::DmaBufFailed => Ok(()),
    }
}

/// What this start chose, for the log and for Settings.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub mode: Mode,
    pub why: Why,
    pub nvidia: bool,
    pub wayland: bool,
    /// The variables MyOrbiter set, as `NAME=value`.
    pub set: Vec<String>,
    /// Your own WebKit variables, when they decided it.
    pub yours: Vec<String>,
    /// A start flag this start was given, and whether saving it worked.
    pub flag: Option<bool>,
    pub flag_error: Option<String>,
}

static CHOICE: OnceLock<Choice> = OnceLock::new();

/// Sets the environment for this start's mode. Call first thing, before Tauri or GTK start (and
/// before any thread does: setting the environment isn't safe once others read it). Returns the
/// variables it set, which a TennoScope MyOrbiter starts must not inherit.
#[cfg(target_os = "linux")]
pub fn apply() -> Vec<&'static str> {
    use std::path::Path;
    let mut set_keys = Vec::new();
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let nvidia = Path::new("/proc/driver/nvidia/version").exists() || Path::new("/sys/module/nvidia").exists();
    if wayland && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "wayland,x11");
        set_keys.push("GDK_BACKEND");
    }
    let dir = config_dir();
    let flag = flag_in(std::env::args().skip(1));
    let mut flag_error = None;
    if let (Some(on), Some(dir)) = (flag, dir.as_deref()) {
        let r = write_saved(dir, if on { Why::Chosen } else { Why::None });
        // Turning it off by hand also forgets an early close: the next start tries again.
        let _ = std::fs::remove_file(dir.join(TRIAL));
        flag_error = r.err().map(|e| e.to_string());
    }
    let yours: Vec<String> = WEBKIT_VARS.iter().filter_map(|k| std::env::var(k).ok().map(|v| format!("{k}={v}"))).collect();
    let saved = dir.as_deref().map(read_saved).unwrap_or(Why::None);
    if let (true, Some(dir)) = (dmabuf_off_in(std::env::args().skip(1)), dir.as_deref()) {
        let _ = write_dmabuf(dir, false);
    }
    let dmabuf = dir.as_deref().is_some_and(read_dmabuf);
    // A marker left by a MyOrbiter that is still running (a second start while the first is in its
    // first minute, which single-instance then closes) isn't an early close.
    let trial_left = dir.as_deref().is_some_and(|d| trial_is_crash(std::fs::read_to_string(d.join(TRIAL)).ok().as_deref(), running_myorbiter));
    let (mode, why) = decide(!yours.is_empty(), saved, trial_left, nvidia, dmabuf);
    if let Some(dir) = dir.as_deref() {
        if why == Why::AfterCrash && saved == Why::None {
            let _ = write_saved(dir, Why::AfterCrash);
        }
        if why == Why::DmaBufFailed {
            let _ = write_dmabuf(dir, false);
        }
        if !matches!(mode, Mode::Accelerated | Mode::SharedMemory | Mode::DmaBuf) {
            let _ = std::fs::remove_file(dir.join(TRIAL));
        }
    }
    let mut set = Vec::new();
    for (k, v) in vars_for(mode) {
        if std::env::var_os(k).is_none() {
            std::env::set_var(k, v);
            set_keys.push(*k);
            set.push(format!("{k}={v}"));
        }
    }
    let _ = CHOICE.set(Choice { mode, why, nvidia, wayland, set, yours, flag, flag_error });
    set_keys
}

/// Once the log is open: says what was chosen, and clears the start marker after a minute.
pub fn started() {
    let Some(c) = CHOICE.get() else { return };
    let what = match c.mode {
        Mode::Accelerated => "accelerated (GPU compositing)",
        Mode::SharedMemory => "accelerated (GPU compositing, frames through shared memory for the NVIDIA driver)",
        Mode::DmaBuf => "accelerated (GPU compositing, frames through DMA-BUF on the NVIDIA driver: the experimental switch in Settings › Logs)",
        Mode::Compat => "compatibility (no compositing, painted on the CPU)",
        Mode::Yours => "your own WebKit settings",
    };
    let why = match c.why {
        Why::None => "",
        Why::Chosen => ", as saved in Settings or by --compat-rendering",
        Why::AfterCrash => ", switched on because the last accelerated start closed within a minute; turn it off in Settings › Display to try again",
        Why::DmaBufFailed => ", back to shared memory because the last start, with DMA-BUF frames, closed within a minute; the DMA-BUF switch is off again",
    };
    let session = if c.wayland { "Wayland" } else { "X11" };
    let vars = if c.mode == Mode::Yours { c.yours.join(" ") } else { c.set.join(" ") };
    log::info!(target: "myorbiter::rendering", "{what}{why} ({session}{}{}{})", if c.nvidia { ", NVIDIA driver" } else { "" }, if vars.is_empty() { "" } else { "; " }, vars);
    match (c.flag, &c.flag_error) {
        (Some(on), None) => log::info!(target: "myorbiter::rendering", "compatibility rendering {} for the starts after this one ({})", if on { "saved" } else { "cleared" }, if on { FLAG_ON } else { FLAG_OFF }),
        (Some(_), Some(e)) => log::warn!(target: "myorbiter::rendering", "saving the rendering flag failed: {e}"),
        _ => {}
    }
    // Not in a development build: `tauri dev` kills the app to restart it after every rebuild,
    // which would read as a crash.
    if matches!(c.mode, Mode::Accelerated | Mode::SharedMemory | Mode::DmaBuf) && !cfg!(debug_assertions) {
        // Left here, not before the window: a second MyOrbiter started while one runs exits before
        // this point (single-instance), and must not leave a marker behind.
        if let Some(dir) = config_dir() {
            let _ = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(TRIAL), format!("started {}\n", std::process::id())));
        }
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(60));
            stood_up();
        });
    }
}

/// Whether a start marker (`started <pid>`, or `started` from an older build) means the start
/// that wrote it closed early: not when that MyOrbiter is still running (`running`).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn trial_is_crash(marker: Option<&str>, running: impl Fn(u32) -> bool) -> bool {
    let Some(marker) = marker else { return false };
    match marker.trim().strip_prefix("started").map(str::trim).and_then(|p| p.parse::<u32>().ok()) {
        Some(pid) => !running(pid),
        None => true,
    }
}

/// Whether `pid` is another MyOrbiter, running now: the same program name as this one's.
#[cfg(target_os = "linux")]
fn running_myorbiter(pid: u32) -> bool {
    let comm = |p: &str| std::fs::read_to_string(format!("/proc/{p}/comm")).ok().map(|s| s.trim().to_owned());
    pid != std::process::id() && comm(&pid.to_string()).is_some_and(|c| Some(c) == comm("self"))
}

/// The window ran long enough, or MyOrbiter is closing normally: this start didn't crash.
pub fn stood_up() {
    if let Some(dir) = config_dir() {
        let _ = std::fs::remove_file(dir.join(TRIAL));
    }
}

/// For Settings: this start's mode, and what's saved for the next.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    linux: bool,
    now: Option<Choice>,
    /// Compatibility rendering saved for the next start.
    next: bool,
    /// The DMA-BUF try (NVIDIA) saved for the next start.
    dmabuf: bool,
}

#[tauri::command(async)]
pub fn rendering_state() -> State {
    let dir = config_dir();
    let next = dir.as_deref().map(|d| read_saved(d) != Why::None).unwrap_or(false);
    let dmabuf = dir.as_deref().is_some_and(read_dmabuf);
    State { linux: cfg!(target_os = "linux"), now: CHOICE.get().cloned(), next, dmabuf }
}

/// How this start hands its finished frames to the window, in a few words, for the timing report.
pub fn frames_line() -> String {
    let Some(c) = CHOICE.get() else {
        return if cfg!(target_os = "linux") { "unknown".into() } else { "the system's web view".into() };
    };
    let how = match c.mode {
        Mode::Accelerated => "DMA-BUF (WebKit's own choice)".to_owned(),
        Mode::SharedMemory => "shared memory (the NVIDIA default)".to_owned(),
        Mode::DmaBuf => "DMA-BUF (the experimental switch)".to_owned(),
        Mode::Compat => "none: painted on the CPU (compatibility rendering)".to_owned(),
        Mode::Yours => format!("set by WebKit variables ({})", c.yours.join(" ")),
    };
    format!("{how}, {}{}", if c.wayland { "Wayland" } else { "X11" }, if c.why == Why::DmaBufFailed { ", the DMA-BUF try closed early last start" } else { "" })
}

/// Settings › Logs (NVIDIA only, experimental): DMA-BUF frames from the next start, or back to
/// shared memory.
#[tauri::command(async)]
pub fn set_dmabuf_rendering(on: bool) -> Result<(), String> {
    let dir = config_dir().ok_or("Only on Linux")?;
    write_dmabuf(&dir, on).map_err(|e| e.to_string())?;
    log::info!(target: "myorbiter::rendering", "DMA-BUF frames (experimental) {} from the next start (Settings)", if on { "on" } else { "off" });
    Ok(())
}

/// The Settings switch: compatibility rendering from the next start on, or off again.
#[tauri::command(async)]
pub fn set_compat_rendering(on: bool) -> Result<(), String> {
    let dir = config_dir().ok_or("Only on Linux")?;
    write_saved(&dir, if on { Why::Chosen } else { Why::None }).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(dir.join(TRIAL));
    log::info!(target: "myorbiter::rendering", "compatibility rendering {} from the next start (Settings)", if on { "on" } else { "off" });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvidia_keeps_compositing_and_drops_only_dmabuf_buffers() {
        assert_eq!(decide(false, Why::None, false, true, false), (Mode::SharedMemory, Why::None));
        let vars = vars_for(Mode::SharedMemory);
        assert!(vars.contains(&("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1")));
        assert!(vars.contains(&("WEBKIT_FORCE_DMABUF_RENDERER", "1")));
        // Neither of the two that switch compositing off.
        assert!(!vars.iter().any(|(k, _)| *k == "WEBKIT_DISABLE_DMABUF_RENDERER" || *k == "WEBKIT_DISABLE_COMPOSITING_MODE"));
    }

    #[test]
    fn other_gpus_get_webkits_own_choice() {
        assert_eq!(decide(false, Why::None, false, false, false), (Mode::Accelerated, Why::None));
        assert!(vars_for(Mode::Accelerated).is_empty());
    }

    #[test]
    fn your_variables_win_over_everything() {
        assert_eq!(decide(true, Why::Chosen, true, true, true).0, Mode::Yours);
        assert!(vars_for(Mode::Yours).is_empty());
    }

    #[test]
    fn compatibility_when_saved_or_after_an_early_close() {
        assert_eq!(decide(false, Why::Chosen, false, true, false), (Mode::Compat, Why::Chosen));
        assert_eq!(decide(false, Why::None, true, false, false), (Mode::Compat, Why::AfterCrash));
        assert_eq!(decide(false, Why::AfterCrash, false, false, false), (Mode::Compat, Why::AfterCrash));
        // Saved compatibility wins over the DMA-BUF try.
        assert_eq!(decide(false, Why::Chosen, false, true, true), (Mode::Compat, Why::Chosen));
        let vars = vars_for(Mode::Compat);
        assert!(vars.contains(&("WEBKIT_DISABLE_COMPOSITING_MODE", "1")));
        assert!(vars.contains(&("WEBKIT_DISABLE_DMABUF_RENDERER", "1")));
    }

    /// A second start while the first is still in its first minute finds the first one's marker:
    /// that MyOrbiter is running, so nothing closed early.
    #[test]
    fn a_marker_of_a_running_myorbiter_is_not_a_crash() {
        assert!(!trial_is_crash(None, |_| false));
        assert!(!trial_is_crash(Some("started 4242\n"), |p| p == 4242));
        assert!(trial_is_crash(Some("started 4242\n"), |_| false));
        assert!(trial_is_crash(Some("started\n"), |_| true), "an older build's marker");
        assert!(trial_is_crash(Some("garbage"), |_| true));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn only_another_running_myorbiter_counts_as_running() {
        assert!(!running_myorbiter(std::process::id()), "this process is the one starting");
        assert!(!running_myorbiter(u32::MAX), "no such process");
        // A process with another name (the shell running the tests' parent, or init) isn't MyOrbiter.
        assert!(!running_myorbiter(1));
    }

    #[test]
    fn dmabuf_try_only_with_nvidia_and_dropped_after_an_early_close() {
        assert_eq!(decide(false, Why::None, false, true, true), (Mode::DmaBuf, Why::None));
        // Other drivers already get DMA-BUF from WebKit: the switch changes nothing there.
        assert_eq!(decide(false, Why::None, false, false, true), (Mode::Accelerated, Why::None));
        // The try closed early: back to shared memory, not to compatibility rendering.
        assert_eq!(decide(false, Why::None, true, true, true), (Mode::SharedMemory, Why::DmaBufFailed));
        // Without the try, an early close still means compatibility.
        assert_eq!(decide(false, Why::None, true, true, false), (Mode::Compat, Why::AfterCrash));
        let vars = vars_for(Mode::DmaBuf);
        assert_eq!(vars, &[("WEBKIT_FORCE_DMABUF_RENDERER", "1")]);
        assert!(!vars.iter().any(|(k, _)| *k == "WEBKIT_DMABUF_RENDERER_FORCE_SHM" || k.starts_with("WEBKIT_DISABLE")));
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(dmabuf_off_in(a(&["--no-dmabuf"])));
        assert!(!dmabuf_off_in(a(&["--no-compat-rendering"])));
    }

    #[test]
    fn dmabuf_choice_round_trips() {
        let dir = std::env::temp_dir().join(format!("myorbiter-dmabuf-{}", std::process::id()));
        assert!(!read_dmabuf(&dir));
        write_dmabuf(&dir, true).unwrap();
        assert!(read_dmabuf(&dir));
        write_dmabuf(&dir, false).unwrap();
        assert!(!read_dmabuf(&dir));
        write_dmabuf(&dir, false).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_last_flag_given_counts() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(flag_in(a(&["--compat-rendering"])), Some(true));
        assert_eq!(flag_in(a(&["--no-compat-rendering"])), Some(false));
        assert_eq!(flag_in(a(&["--compat-rendering", "--no-compat-rendering"])), Some(false));
        assert_eq!(flag_in(a(&["--other"])), None);
    }

    #[test]
    fn saved_choice_round_trips() {
        let dir = std::env::temp_dir().join(format!("myorbiter-rendering-{}", std::process::id()));
        write_saved(&dir, Why::Chosen).unwrap();
        assert_eq!(read_saved(&dir), Why::Chosen);
        write_saved(&dir, Why::AfterCrash).unwrap();
        assert_eq!(read_saved(&dir), Why::AfterCrash);
        write_saved(&dir, Why::None).unwrap();
        assert_eq!(read_saved(&dir), Why::None);
        // Clearing what isn't there is fine.
        write_saved(&dir, Why::None).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
