//! In-app updates, from the package registry of MyOrbiter's repository on gitlab.com.
//!
//! Every build CI makes is published (.gitlab-ci.yml) with its files in the registry's
//! `orbiter/0.2.<n>/` folder, an updater manifest (`latest.json`) among them, and a release
//! `build-<n>` that links to them. Each channel is one fixed file, `channel/<channel>/latest.json`
//! (experimental, beta, stable), replaced when a build reaches that channel (each build lands on
//! Experimental; Beta and Stable get a build promoted by hand, the same files, never rebuilt). The
//! channel is a setting in the page; this module turns it into the manifest's addresses, asks
//! tauri-plugin-updater whether that manifest offers another version, and installs it only when
//! the page asks, after the plugin has checked its signature against the public key in
//! tauri.conf.json.
//!
//! Where an update can go depends on how MyOrbiter was installed (`Install`): an AppImage replaces
//! its own file, the Windows installer runs in passive mode, while a .deb or .rpm, a development
//! build and the macOS build leave updating to the package manager or to a download by hand.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The project whose package registry carries the builds and the channel manifests, as the
/// GitLab API names it (`group%2Fproject`).
pub const PROJECT: &str = "sheziss-group%2Fmyorbiter";

/// How long a check may take before it counts as failed.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

/// A release channel, as the page names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
    Experimental,
}

impl Channel {
    pub fn name(self) -> &'static str {
        match self {
            Channel::Stable => "stable",
            Channel::Beta => "beta",
            Channel::Experimental => "experimental",
        }
    }
}

/// The addresses a channel's builds are announced at, in the order they're tried: the plugin asks
/// the next one when an address can't be reached or answers with an error (not when it answers
/// with something that isn't a manifest). Today one, the channel's `latest.json` in the package
/// registry; a mirror would go after it.
pub fn endpoints(channel: Channel) -> Vec<String> {
    vec![format!("https://gitlab.com/api/v4/projects/{PROJECT}/packages/generic/channel/{}/latest.json", channel.name())]
}

/// Where the check goes. A normal build only ever asks `endpoints(channel)`; a build made with the
/// `e2e-updater` feature (never one CI ships, see ci/build.sh's check) may be pointed at a local
/// server by `MYORBITER_UPDATER_E2E_ENDPOINT` (and given the test's key, `e2e::apply`), for the
/// end-to-end test of the update itself.
fn check_urls(channel: Channel) -> Vec<String> {
    #[cfg(feature = "e2e-updater")]
    if let Some(url) = e2e::endpoint() {
        return vec![url];
    }
    endpoints(channel)
}

/// How a newer or older build compares with the one running.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Offer {
    /// The channel's build is this one.
    Same,
    /// Newer: offered as an update.
    Newer,
    /// Older: a more stable channel that hasn't caught up. Only installed on an explicit click
    /// that names it ("Switch to Stable's 0.1.40"), never by an update check.
    Older,
}

/// Compares versions as semver (0.1.52 against 0.1.9 by number, not by text).
pub fn offer(current: &semver::Version, remote: &semver::Version) -> Offer {
    match remote.cmp(current) {
        std::cmp::Ordering::Greater => Offer::Newer,
        std::cmp::Ordering::Less => Offer::Older,
        std::cmp::Ordering::Equal => Offer::Same,
    }
}

/// Whether an install of `remote` may go ahead: a newer build always, an older one only when the
/// click asked for that older build (`older`).
pub fn may_install(current: &semver::Version, remote: &semver::Version, older: bool) -> bool {
    match offer(current, remote) {
        Offer::Newer => true,
        Offer::Older => older,
        Offer::Same => false,
    }
}

/// How this copy of MyOrbiter was installed, and so whether it can update itself.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "how", rename_all = "camelCase")]
pub enum Install {
    /// An AppImage in a folder MyOrbiter may write to: the update replaces the file.
    AppImage { path: String },
    /// An AppImage in a folder MyOrbiter can't write to: updates are checked, not installed.
    ReadOnly { folder: String },
    /// Installed with the Windows installer: the update runs the new installer (passive mode).
    Windows,
    /// A .deb or .rpm: the package manager updates it.
    Package,
    /// A development build (`tauri dev`, a debug build).
    Dev,
    /// A release build run straight from its folder (no installer, no AppImage).
    Manual,
    /// The macOS build: no updater manifest carries it, a new .dmg is downloaded by hand.
    Mac,
}

impl Install {
    /// Whether update checks make sense here (an AppImage in a read-only folder still checks, to
    /// say an update exists).
    pub fn checks(&self) -> bool {
        matches!(self, Install::AppImage { .. } | Install::ReadOnly { .. } | Install::Windows)
    }
    /// Whether an update can be installed here.
    pub fn installs(&self) -> bool {
        matches!(self, Install::AppImage { .. } | Install::Windows)
    }
}

/// Works out `Install` from the facts: a debug build, the system, the bundle the binary was
/// patched for, the AppImage it runs from (`$APPIMAGE`), and whether a folder can be written to.
pub fn install_kind(debug: bool, os: &str, bundle: Option<BundleType>, appimage: Option<&Path>, writable: impl Fn(&Path) -> bool) -> Install {
    if debug {
        return Install::Dev;
    }
    match os {
        "macos" => Install::Mac,
        "windows" => match bundle {
            Some(BundleType::Nsis) => Install::Windows,
            _ => Install::Manual,
        },
        "linux" => match (bundle, appimage) {
            (Some(BundleType::Deb) | Some(BundleType::Rpm), _) => Install::Package,
            (_, Some(path)) => {
                let folder = path.parent().unwrap_or(Path::new("/"));
                if writable(folder) {
                    Install::AppImage { path: path.display().to_string() }
                } else {
                    Install::ReadOnly { folder: folder.display().to_string() }
                }
            }
            _ => Install::Manual,
        },
        _ => Install::Manual,
    }
}

/// Whether a file can be made in `folder` (and removed again): what replacing the AppImage takes.
fn folder_writable(folder: &Path) -> bool {
    let probe = folder.join(format!(".myorbiter-update-check-{}", std::process::id()));
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn this_install<R: Runtime>(app: &AppHandle<R>) -> Install {
    #[cfg(target_os = "linux")]
    let appimage: Option<PathBuf> = app.env().appimage.map(PathBuf::from);
    #[cfg(not(target_os = "linux"))]
    let appimage: Option<PathBuf> = {
        let _ = app;
        None
    };
    install_kind(cfg!(debug_assertions), std::env::consts::OS, tauri::utils::platform::bundle_type(), appimage.as_deref(), folder_writable)
}

/// What the page shows about this copy: its version and how it updates.
#[derive(Serialize)]
pub struct Info {
    version: String,
    install: Install,
}

/// The result of a check, for the page.
#[derive(Serialize, Debug)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Check {
    /// The channel's build is the one running.
    Current { version: String },
    /// The channel has a newer build.
    Newer { version: String, notes: Option<String>, date: Option<String> },
    /// The channel's build is older than this one (a more stable channel).
    Older { version: String, notes: Option<String>, date: Option<String> },
    /// Nothing to check here (a dev build, a package, macOS): `Info.install` says why.
    Off,
}

/// The update the last check found, kept so a click installs exactly what was shown.
#[derive(Default)]
pub struct Pending(Mutex<Option<(Channel, Update)>>);

/// Download progress, as the button shows it.
#[derive(Clone, Serialize)]
pub struct Progress {
    done: u64,
    total: Option<u64>,
}

/// A failed check or install in a short sentence; the plugin's own wording goes to the log.
fn calm(what: &str, e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Minisign(_) | E::SignatureUtf8(_) | E::Base64(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => {
            "the download didn't match its signature, so it wasn't installed".into()
        }
        E::TargetNotFound(_) | E::TargetsNotFound(_) => "this channel has no build for this system yet".into(),
        E::ReleaseNotFound => "GitLab had no update file for this channel".into(),
        E::Reqwest(_) | E::Network(_) => format!("couldn't reach GitLab to {what}"),
        E::Io(io) if io.kind() == std::io::ErrorKind::PermissionDenied => "MyOrbiter's file can't be replaced: its folder isn't writable".into(),
        E::TempDirNotOnSameMountPoint => "MyOrbiter couldn't make room to swap its file (no writable folder on the same drive)".into(),
        _ => format!("couldn't {what}"),
    }
}

/// This build and how it was installed. Telling an AppImage's folder writable makes and removes a
/// file there (`folder_writable`), which waits on the disk, so it runs on a blocking thread: not
/// the main thread, and not one of the async runtime's few workers.
#[tauri::command(async)]
pub async fn updates_info(app: AppHandle) -> Result<Info, String> {
    tauri::async_runtime::spawn_blocking(move || Info { version: app.package_info().version.to_string(), install: this_install(&app) })
        .await
        .map_err(|e| e.to_string())
}

/// Asks the channel's manifest for its build. Every version other than this one comes back (the
/// comparator lets older ones through), so the page can offer a downgrade explicitly; whether one
/// installs is decided again at the click (`updates_install`).
#[tauri::command]
pub async fn updates_check(app: AppHandle, pending: State<'_, Pending>, channel: Channel) -> Result<Check, String> {
    check(&app, &pending, channel).await
}

async fn check(app: &AppHandle, pending: &Pending, channel: Channel) -> Result<Check, String> {
    let install = this_install(app);
    if !install.checks() {
        return Ok(Check::Off);
    }
    let urls = check_urls(channel)
        .iter()
        .map(|u| u.parse())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "the update address is invalid".to_string())?;
    let started = Instant::now();
    // On Windows the installer replaces files TennoScope runs from, and exits MyOrbiter itself:
    // TennoScope and the warframe.market status are closed first.
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
            handle.state::<crate::presence::Presence>().close();
            handle.state::<crate::companion::Companion>().stop();
            handle.cleanup_before_exit();
        })
        .endpoints(urls)
        .map_err(|e| calm("check for updates", &e))?
        .timeout(CHECK_TIMEOUT)
        .version_comparator(|current, release| release.version != current)
        .build()
        .map_err(|e| calm("check for updates", &e))?;
    let current = app.package_info().version.clone();
    match updater.check().await {
        Ok(Some(update)) => {
            let Ok(remote) = semver::Version::parse(update.version.trim_start_matches('v')) else {
                return Err(format!("the channel announced an unreadable version ({})", update.version));
            };
            let date = update.raw_json.get("pub_date").and_then(|d| d.as_str()).map(str::to_owned);
            let notes = update.body.clone();
            let version = remote.to_string();
            log::info!(target: "myorbiter::updates", "{}: {version} on offer (this is {current})", channel.name());
            let check = match offer(&current, &remote) {
                Offer::Newer => Check::Newer { version, notes, date },
                Offer::Older => Check::Older { version, notes, date },
                Offer::Same => Check::Current { version },
            };
            *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = Some((channel, update));
            Ok(check)
        }
        Ok(None) => {
            *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Ok(Check::Current { version: current.to_string() })
        }
        Err(e) => {
            // One calm line: while the repository is private, or offline, every check ends here.
            log::info!(target: "myorbiter::updates", "{} check failed after {} ms: {e}", channel.name(), started.elapsed().as_millis());
            Err(calm("check for updates", &e))
        }
    }
}

/// Downloads and installs the build the last check found on `channel`, if it is `version`.
/// `older`: the click named an older build (switching to a more stable channel). Progress goes
/// to `progress`. On Linux the AppImage is replaced and the page then restarts MyOrbiter (the
/// process plugin); on Windows the installer takes over and MyOrbiter exits.
#[tauri::command]
pub async fn updates_install(
    app: AppHandle,
    pending: State<'_, Pending>,
    channel: Channel,
    version: String,
    older: bool,
    progress: tauri::ipc::Channel<Progress>,
) -> Result<(), String> {
    install(&app, &pending, channel, &version, older, |p| {
        let _ = progress.send(p);
    })
    .await
}

async fn install(app: &AppHandle, pending: &Pending, channel: Channel, version: &str, older: bool, mut progress: impl FnMut(Progress)) -> Result<(), String> {
    let install = this_install(app);
    if !install.installs() {
        return Err(match install {
            Install::ReadOnly { folder } => format!("MyOrbiter can't replace its own file: {folder} isn't writable. Move the AppImage to a folder you own, or download the new one by hand"),
            Install::Package => "updates come from your package manager".into(),
            Install::Dev => "updates aren't available in dev builds".into(),
            _ => "this copy of MyOrbiter can't update itself".into(),
        });
    }
    let update = {
        let guard = pending.0.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some((c, u)) if *c == channel && u.version.trim_start_matches('v') == version => u.clone(),
            _ => return Err("check again first: the update shown is no longer the one on offer".into()),
        }
    };
    let current = app.package_info().version.clone();
    let remote = semver::Version::parse(update.version.trim_start_matches('v')).map_err(|_| "unreadable version".to_string())?;
    if !may_install(&current, &remote, older) {
        return Err(format!("{remote} is older than this build ({current}): only a switch that names it installs it"));
    }
    // A step back: the page named it (`older`), and the player confirms it outside the page, in a
    // native dialog that names both builds, so a page alone can't install an older build.
    if remote < current && !confirm_older(app, &current, &remote).await {
        return Err(format!("{remote} wasn't installed: the step back from {current} wasn't confirmed"));
    }
    log::info!(target: "myorbiter::updates", "installing {remote} from {} (was {current})", channel.name());
    let mut done = 0u64;
    let mut last_sent = 0u64;
    let result = update
        .download_and_install(
            |chunk, total| {
                done += chunk as u64;
                // About every 1% (or 256 KB without a size), so the page isn't flooded.
                let step = total.map_or(256 * 1024, |t| (t / 100).max(64 * 1024));
                if done - last_sent >= step || total == Some(done) {
                    last_sent = done;
                    progress(Progress { done, total });
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(()) => {
            log::info!(target: "myorbiter::updates", "installed {remote}; restarting");
            // The restart that follows skips the usual exit: this start ended on purpose, not by
            // crashing, so the next one keeps the accelerated rendering (rendering.rs).
            crate::rendering::stood_up();
            Ok(())
        }
        Err(e) => {
            log::warn!(target: "myorbiter::updates", "installing {remote} failed: {e}");
            Err(calm("install the update", &e))
        }
    }
}

/// Asks, in a native dialog over MyOrbiter's window, whether to install `remote`, older than the
/// `current` build. False if the dialog is closed or can't be shown.
async fn confirm_older(app: &AppHandle, current: &semver::Version, remote: &semver::Version) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (app, text, yes, no) = (
        app.clone(),
        format!("Install MyOrbiter {remote}? It's older than the build running now, {current}. MyOrbiter restarts into {remote}, and {current} is offered again only once its channel moves on."),
        format!("Install {remote}"),
        format!("Keep {current}"),
    );
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().message(text).title("Install an older MyOrbiter").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancelCustom(yes, no));
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.parent(&window);
        }
        dialog.blocking_show()
    })
    .await
    .unwrap_or(false)
}

/// Once the app is up: in an end-to-end test build, the test's own drive of the update (`e2e::auto`).
pub fn setup(app: &AppHandle) {
    #[cfg(feature = "e2e-updater")]
    e2e::auto(app);
    #[cfg(not(feature = "e2e-updater"))]
    let _ = app;
}

/// The update plugin, set up for MyOrbiter.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R, tauri_plugin_updater::Config> {
    tauri_plugin_updater::Builder::new().build()
}

/// The app's configuration, as built, with the updater's part passed through `updater_config`.
pub fn context<R: Runtime>(mut context: tauri::Context<R>) -> tauri::Context<R> {
    if let Some(updater) = context.config_mut().plugins.0.get_mut("updater") {
        *updater = updater_config(std::mem::take(updater));
    }
    context
}

/// The updater's configuration (`plugins.updater`). A normal build leaves it exactly as compiled
/// in; one with the `e2e-updater` feature takes the end-to-end test's settings (`e2e::apply`).
fn updater_config(config: serde_json::Value) -> serde_json::Value {
    #[cfg(feature = "e2e-updater")]
    let config = e2e::apply(config);
    config
}

/// The end-to-end test's hooks. Compiled only with the `e2e-updater` feature, which no release
/// build enables: ci/build.sh fails a build whose binary contains `MYORBITER_UPDATER_E2E`.
#[cfg(feature = "e2e-updater")]
mod e2e {
    /// The test server's manifest (only a local plain-http address is taken).
    pub fn endpoint() -> Option<String> {
        std::env::var("MYORBITER_UPDATER_E2E_ENDPOINT").ok().filter(|u| u.parse::<tauri::Url>().is_ok_and(|p| p.scheme() == "http" && p.host_str() == Some("127.0.0.1") && p.username().is_empty() && p.password().is_none()))
    }

    /// With the test server set: plain http allowed for it, and, when `MYORBITER_UPDATER_E2E_PUBKEY`
    /// is set, the test's own signing key in place of the release key (the test signs its builds
    /// with a throwaway key; the real key's private half never leaves the developer's machine and CI).
    /// With `MYORBITER_UPDATER_E2E_AUTO=1`, the test drives the update with no window to click in:
    /// one check on Experimental, the install if it found a newer build, then the restart, each
    /// step printed for the test script to read (and an exit once it's up to date or failed).
    pub fn auto(app: &tauri::AppHandle) {
        if std::env::var("MYORBITER_UPDATER_E2E_AUTO").as_deref() != Ok("1") || endpoint().is_none() {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            use tauri::Manager;
            let pending = app.state::<super::Pending>();
            let version = app.package_info().version.to_string();
            println!("e2e: running {version}, install {:?}", super::this_install(&app));
            match super::check(&app, &pending, super::Channel::Experimental).await {
                Ok(super::Check::Newer { version: next, .. }) => {
                    println!("e2e: {next} on offer, installing");
                    match super::install(&app, &pending, super::Channel::Experimental, &next, false, |_| {}).await {
                        Ok(()) => {
                            println!("e2e: installed {next}, restarting");
                            app.request_restart();
                        }
                        Err(e) => {
                            println!("e2e: install refused: {e}");
                            app.exit(3);
                        }
                    }
                }
                Ok(other) => {
                    println!("e2e: no update ({other:?})");
                    app.exit(0);
                }
                Err(e) => {
                    println!("e2e: check failed: {e}");
                    app.exit(4);
                }
            }
        });
    }

    pub fn apply(mut config: serde_json::Value) -> serde_json::Value {
        if endpoint().is_none() {
            return config;
        }
        if let Some(updater) = config.as_object_mut() {
            updater.insert("dangerousInsecureTransportProtocol".into(), true.into());
            if let Some(key) = std::env::var("MYORBITER_UPDATER_E2E_PUBKEY").ok().filter(|k| !k.trim().is_empty()) {
                updater.insert("pubkey".into(), key.trim().into());
            }
        }
        config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> semver::Version {
        semver::Version::parse(s).unwrap()
    }

    #[test]
    fn each_channel_has_its_own_manifest() {
        let registry = "https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel";
        assert_eq!(endpoints(Channel::Stable), [format!("{registry}/stable/latest.json")]);
        assert_eq!(endpoints(Channel::Beta), [format!("{registry}/beta/latest.json")]);
        assert_eq!(endpoints(Channel::Experimental), [format!("{registry}/experimental/latest.json")]);
        for c in [Channel::Stable, Channel::Beta, Channel::Experimental] {
            for u in endpoints(c) {
                let url = u.parse::<tauri::Url>().unwrap();
                assert_eq!(url.scheme(), "https");
                // The encoded slash stays encoded: the API names the project by its full path.
                assert!(url.path().starts_with("/api/v4/projects/sheziss-group%2Fmyorbiter/"), "{url}");
            }
        }
    }

    #[test]
    fn channels_read_as_the_page_writes_them() {
        assert_eq!(serde_json::from_str::<Channel>("\"beta\"").unwrap(), Channel::Beta);
        assert!(serde_json::from_str::<Channel>("\"nightly\"").is_err());
        assert!(serde_json::from_str::<Channel>("\"Stable\"").is_err());
    }

    /// Without the test feature the check goes to the channel's address, and the configuration
    /// keeps its key and https, whatever the environment says.
    #[test]
    #[cfg(not(feature = "e2e-updater"))]
    fn a_release_build_cannot_be_pointed_elsewhere() {
        std::env::set_var("MYORBITER_UPDATER_E2E_ENDPOINT", "http://127.0.0.1:9/latest.json");
        std::env::set_var("MYORBITER_UPDATER_E2E_PUBKEY", "dGVzdA==");
        assert_eq!(check_urls(Channel::Beta), endpoints(Channel::Beta));
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let built = &config["plugins"]["updater"];
        assert_eq!(&updater_config(built.clone()), built);
        std::env::remove_var("MYORBITER_UPDATER_E2E_ENDPOINT");
        std::env::remove_var("MYORBITER_UPDATER_E2E_PUBKEY");
    }

    /// The committed key is the release key (id E8C1BC6BE2D5CFB9), not a test key.
    #[test]
    fn the_release_key_is_configured() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let key = config["plugins"]["updater"]["pubkey"].as_str().unwrap();
        use base64::Engine;
        let text = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(key).unwrap()).unwrap();
        assert!(text.starts_with("untrusted comment: minisign public key: E8C1BC6BE2D5CFB9\n"), "{text}");
        assert_eq!(config["plugins"]["updater"]["requireSignedVersion"], true);
    }

    #[test]
    fn versions_compare_by_number() {
        assert_eq!(offer(&v("0.1.9"), &v("0.1.52")), Offer::Newer);
        assert_eq!(offer(&v("0.1.52"), &v("0.1.40")), Offer::Older);
        assert_eq!(offer(&v("0.1.52"), &v("0.1.52")), Offer::Same);
        assert_eq!(offer(&v("0.1.0"), &v("0.1.1")), Offer::Newer);
    }

    #[test]
    fn an_older_build_installs_only_when_asked_for() {
        assert!(may_install(&v("0.1.40"), &v("0.1.52"), false));
        assert!(may_install(&v("0.1.40"), &v("0.1.52"), true));
        assert!(!may_install(&v("0.1.52"), &v("0.1.40"), false));
        assert!(may_install(&v("0.1.52"), &v("0.1.40"), true));
        assert!(!may_install(&v("0.1.52"), &v("0.1.52"), true));
    }

    #[test]
    fn how_each_install_updates() {
        let yes = |_: &Path| true;
        let no = |_: &Path| false;
        let img = Path::new("/home/me/Apps/myorbiter.AppImage");
        assert_eq!(install_kind(true, "linux", Some(BundleType::AppImage), Some(img), yes), Install::Dev);
        assert_eq!(install_kind(false, "linux", Some(BundleType::AppImage), Some(img), yes), Install::AppImage { path: img.display().to_string() });
        assert_eq!(install_kind(false, "linux", Some(BundleType::AppImage), Some(img), no), Install::ReadOnly { folder: "/home/me/Apps".into() });
        assert_eq!(install_kind(false, "linux", Some(BundleType::Deb), None, yes), Install::Package);
        assert_eq!(install_kind(false, "linux", Some(BundleType::Rpm), None, yes), Install::Package);
        assert_eq!(install_kind(false, "linux", None, None, yes), Install::Manual);
        assert_eq!(install_kind(false, "windows", Some(BundleType::Nsis), None, yes), Install::Windows);
        assert_eq!(install_kind(false, "windows", None, None, yes), Install::Manual);
        assert_eq!(install_kind(false, "macos", Some(BundleType::App), None, yes), Install::Mac);
        assert!(Install::ReadOnly { folder: "/opt".into() }.checks());
        assert!(!Install::ReadOnly { folder: "/opt".into() }.installs());
        assert!(!Install::Package.checks() && !Install::Dev.checks() && !Install::Mac.checks() && !Install::Manual.checks());
    }

    #[test]
    fn a_folder_is_writable_or_not() {
        let dir = std::env::temp_dir();
        assert!(folder_writable(&dir));
        assert!(!folder_writable(Path::new("/proc/definitely-not-here")));
    }
}
