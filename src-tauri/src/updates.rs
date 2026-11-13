//! In-app updates, from MyOrbiter's releases on GitHub, with its mirror on GitLab after them.
//!
//! Every build the Release workflow makes (.github/workflows/release.yml) is published with its
//! files on the release `build-<n>` of the repository on github.com, an updater manifest
//! (`latest.json`) among them. Each channel (experimental, beta, stable) is a release of its own,
//! tagged with the channel's name, holding that channel's `latest.json`, replaced when a build
//! reaches the channel (each build lands on Experimental; Beta and Stable get a build promoted by
//! hand, the same files, never rebuilt). GitLab's package registry keeps the channel manifests it
//! served before the move back (`channel/<channel>/latest.json`, never written again), so an
//! address that GitHub doesn't answer still finds a build. The
//! channel is a setting in the page; this module turns it into the manifest's addresses, asks
//! tauri-plugin-updater whether that manifest offers another version, and installs it only when
//! the page asks, after the plugin has checked its signature against the public key in
//! tauri.conf.json. The download is fetched only from MyOrbiter's own address for that build and
//! system (`download_allowed`), checked when the check keeps the update and again just before the
//! download.
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

/// The repository on github.com whose releases carry the builds and the channel manifests.
pub const GITHUB_REPO: &str = "ShezissSnake/myorbiter";

/// The mirror on gitlab.com, whose package registry carries the builds GitLab made and the channel
/// manifests it last served, as the GitLab API names the project (`group%2Fproject`).
pub const PROJECT: &str = "sheziss-group%2Fmyorbiter";

/// How long a check may take before it counts as failed: the manifest is a couple of kilobytes, so
/// a check that takes longer is stuck, and the page should say so while the player still looks.
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);

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

    /// As Settings names it.
    pub fn label(self) -> &'static str {
        match self {
            Channel::Stable => "Stable",
            Channel::Beta => "Beta",
            Channel::Experimental => "Experimental",
        }
    }
}

/// The addresses a channel's builds are announced at, in the order they're tried: the plugin asks
/// the next one when an address can't be reached, answers with an error status (a 404 included)
/// or with JSON that isn't a manifest, and stops at the first manifest it reads (an answer that
/// isn't JSON at all ends the check). First the channel's release on GitHub, then the channel's
/// file in GitLab's package registry. Each is given CHECK_TIMEOUT.
pub fn endpoints(channel: Channel) -> Vec<String> {
    vec![
        format!("https://github.com/{GITHUB_REPO}/releases/download/{}/latest.json", channel.name()),
        format!("https://gitlab.com/api/v4/projects/{PROJECT}/packages/generic/channel/{}/latest.json", channel.name()),
    ]
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

/// Whether an update's download is MyOrbiter's own address for that build and system: `Ok`, or
/// `Err` with the reason. It is, exactly, one of the two forms the release scripts write:
///
/// - `https://github.com/<GITHUB_REPO>/releases/download/build-<digits>/myorbiter_<version>_<file>`
///   (scripts/github-manifest.mjs, `releaseFolder`);
/// - `https://gitlab.com/api/v4/projects/<PROJECT>/packages/generic/myorbiter/<version>/myorbiter_<version>_<file>`
///   (the builds GitLab made, 0.2.100 to 0.2.119: ci/publish.sh).
///
/// `version` is the version on offer, three numbers and nothing after them, the same text wherever
/// it appears; `target` is the system as `<os>-<arch>`, whose `<file>` is `amd64.AppImage` on
/// `linux-x86_64` and `x64-setup.exe` on `windows-x86_64` (no other system has a build). https
/// only, with no user, password, port, query or fragment, and the address reads the same once
/// parsed and written out again, so nothing the parser rewrites (`..`, `%2e%2e`, a default port,
/// an upper-case host) passes for another path.
///
/// The release's number isn't tied to the version (the release scripts make build-<n> for
/// 0.2.<n>, but a copy installed now must still take an update once the version's first numbers
/// change, and this rule can't be corrected in copies already installed). That loses nothing: the
/// file's name carries the version and its signature names it, so another release folder can only
/// name a file the release workflow did not put there, which the signature refuses.
pub fn download_allowed(url: &str, version: &str, target: &str) -> Result<(), &'static str> {
    let (file, other) = match target {
        "linux-x86_64" => ("amd64.AppImage", "x64-setup.exe"),
        "windows-x86_64" => ("x64-setup.exe", "amd64.AppImage"),
        _ => return Err("a system MyOrbiter has no build for"),
    };
    match semver::Version::parse(version) {
        Ok(v) if v.pre.is_empty() && v.build.is_empty() && v.to_string() == version => {}
        _ => return Err("a version that isn't three numbers"),
    }
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return Err("not an address");
    };
    if parsed.as_str() != url {
        return Err("an address that reads differently once parsed");
    }
    if parsed.scheme() != "https" {
        return Err("not https");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("a user or password");
    }
    if parsed.port().is_some() {
        return Err("a port");
    }
    if parsed.query().is_some() {
        return Err("a query");
    }
    if parsed.fragment().is_some() {
        return Err("a fragment");
    }
    let path = parsed.path();
    if path.contains("//") {
        return Err("a doubled slash");
    }
    let name = match parsed.host_str() {
        Some("github.com") => {
            let Some(rest) = path.strip_prefix(&format!("/{GITHUB_REPO}/releases/download/")) else {
                return Err("another repository on github.com");
            };
            if rest.contains('%') {
                return Err("an encoded character in the path");
            }
            let (tag, name) = rest.split_once('/').unwrap_or((rest, ""));
            match tag.strip_prefix("build-") {
                Some(n) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => {}
                _ => return Err("a release that isn't build-<digits>"),
            }
            name
        }
        Some("gitlab.com") => {
            // The project's `%2F` is matched as written: the API names the project by its path.
            let Some(rest) = path.strip_prefix(&format!("/api/v4/projects/{PROJECT}/packages/generic/")) else {
                return Err("another project on gitlab.com");
            };
            if rest.contains('%') {
                return Err("an encoded character in the path");
            }
            let Some(rest) = rest.strip_prefix("myorbiter/") else {
                return Err("a package other than the builds'");
            };
            let (folder, name) = rest.split_once('/').unwrap_or((rest, ""));
            if folder != version {
                return Err("a folder of another version");
            }
            name
        }
        _ => return Err("another host"),
    };
    if name == format!("myorbiter_{version}_{file}") {
        Ok(())
    } else if name == format!("myorbiter_{version}_{other}") {
        Err("the other system's file")
    } else if !name.contains('/') && name.starts_with("myorbiter_") && name.ends_with(&format!("_{file}")) {
        Err("a file of another version")
    } else {
        Err("another file")
    }
}

/// What the address check reads of an update: the plugin's `Update`, or a test's stand-in.
trait Download {
    /// The address the plugin fetches, as it holds it (parsed from the manifest).
    fn url(&self) -> &str;
    /// The version on offer, which the download's signature must name.
    fn version(&self) -> &str;
    /// The system the download must be for, as `<os>-<arch>`.
    fn target(&self) -> String;
}

impl Download for Update {
    fn url(&self) -> &str {
        self.download_url.as_str()
    }
    fn version(&self) -> &str {
        &self.version
    }
    /// The plugin's own names: `Update.target` is the system it runs on (`linux`, `windows`), since
    /// the check sets no target of its own, and the arch is the one it was built for. The plugin
    /// takes the address from the manifest's `<os>-<arch>-<installer>` entry when there is one and
    /// `<os>-<arch>` otherwise, without saying which: either way the file must be this system's.
    fn target(&self) -> String {
        format!("{}-{}", self.target, std::env::consts::ARCH)
    }
}

/// Whether `update`'s download may be fetched here: `download_allowed`, or in an end-to-end test
/// build the test server's own address (`e2e::download`). A refusal goes to the log by the
/// address's host alone (`refused_line`).
fn own_download(channel: Channel, update: &impl Download) -> bool {
    #[cfg(feature = "e2e-updater")]
    if e2e::download(update.url()) {
        return true;
    }
    match download_allowed(update.url(), update.version(), &update.target()) {
        Ok(()) => true,
        Err(reason) => {
            log::warn!(target: "myorbiter::updates", "{}", refused_line(channel, update.url(), reason));
            false
        }
    }
}

/// The log's line for a refused download: of the address, only its host.
fn refused_line(channel: Channel, url: &str, reason: &str) -> String {
    let host = url.parse::<tauri::Url>().ok().and_then(|u| u.host_str().map(str::to_owned));
    format!("{}: update refused, its download (at {}) isn't MyOrbiter's own: {reason}", channel.name(), host.as_deref().unwrap_or("no host"))
}

/// Keeps `update` as the one a click installs, if its download is MyOrbiter's own. One that isn't
/// is refused before it's kept, and nothing is pending afterwards.
fn keep<D: Download>(pending: &Mutex<Option<(Channel, D)>>, channel: Channel, update: D) -> Result<(), String> {
    let own = own_download(channel, &update);
    let mut kept = pending.lock().unwrap_or_else(|e| e.into_inner());
    if own {
        *kept = Some((channel, update));
        Ok(())
    } else {
        *kept = None;
        Err(format!("The {} channel's manifest names a download that isn't MyOrbiter's own; nothing was downloaded", channel.label()))
    }
}

/// The same check again, just before the download, so nothing kept from an earlier check passes
/// unless it passes now. A refused update is no longer pending.
fn still_own<D: Download>(pending: &Mutex<Option<(Channel, D)>>, channel: Channel, update: &D) -> Result<(), String> {
    if own_download(channel, update) {
        return Ok(());
    }
    *pending.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Err("this update's download isn't MyOrbiter's own, so nothing was downloaded".into())
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
    /// The channel has no build yet: no manifest at any address (`system: false`), or one without
    /// a build for this system (`system: true`). Not a failure: the page names a channel that has
    /// one and offers the switch; nothing switches by itself.
    Empty { system: bool },
    /// Nothing to check here (a dev build, a package, macOS): `Info.install` says why.
    Off,
}

/// Whether a failed check means the channel simply has no build (yet), rather than something that
/// went wrong: every address answered without a manifest (a 404; the plugin can't tell a 503 from
/// one, so a site that's down for the whole check reads the same), or the manifest has no build
/// for this system. `Some(system)` as `Check::Empty` has it.
fn empty_channel(e: &tauri_plugin_updater::Error) -> Option<bool> {
    use tauri_plugin_updater::Error as E;
    match e {
        E::ReleaseNotFound => Some(false),
        E::TargetNotFound(_) | E::TargetsNotFound(_) => Some(true),
        _ => None,
    }
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

/// Why a check failed, in plain words for the line under Check now; the plugin's own wording goes
/// to the log. A manifest that isn't JSON fails in the request's own decoding (`Reqwest`), one that
/// is JSON but not a manifest in the plugin's (`Serialization`); answers that aren't a success
/// (a 404, a 503) from every address leave the plugin with no release (`ReleaseNotFound`). A check
/// fails only once every address has been asked, so the words name both sites.
fn check_failure(channel: Channel, e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    let ch = channel.label();
    match e {
        E::Reqwest(r) if r.is_decode() => format!("The {ch} channel's manifest is malformed"),
        E::Reqwest(r) if r.is_timeout() => format!("GitHub or GitLab didn't answer within {} s", CHECK_TIMEOUT.as_secs()),
        E::Reqwest(_) | E::Network(_) => "Couldn't reach GitHub or GitLab".into(),
        E::Serialization(_) | E::Semver(_) | E::FormatDate => format!("The {ch} channel's manifest is malformed"),
        E::ReleaseNotFound => format!("Neither GitHub nor GitLab served the {ch} channel's manifest"),
        E::TargetNotFound(_) | E::TargetsNotFound(_) => format!("The {ch} channel has no build for this system yet"),
        E::UrlParse(_) | E::InsecureTransportProtocol | E::EmptyEndpoints => "The update address is invalid".into(),
        E::UnsupportedOs | E::UnsupportedArch => "Updates aren't offered for this system".into(),
        _ => "Couldn't check for updates".into(),
    }
}

/// A failed install in a short sentence; the plugin's own wording goes to the log.
fn calm(what: &str, e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Minisign(_) | E::SignatureUtf8(_) | E::Base64(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => {
            "the download didn't match its signature, so it wasn't installed".into()
        }
        E::TargetNotFound(_) | E::TargetsNotFound(_) => "this channel has no build for this system yet".into(),
        E::ReleaseNotFound => "neither GitHub nor GitLab had an update file for this channel".into(),
        E::Reqwest(_) | E::Network(_) => format!("couldn't reach the download's site to {what}"),
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
        .map_err(|e| {
            log::warn!(target: "myorbiter::updates", "{} check: invalid address: {e}", channel.name());
            "The update address is invalid".to_string()
        })?;
    let started = Instant::now();
    // A failure before any request (the address refused, the updater not built): logged here, as
    // the check's own failures are below.
    let refused = |e: tauri_plugin_updater::Error| {
        log::warn!(target: "myorbiter::updates", "{} check not sent: {e}", channel.name());
        check_failure(channel, &e)
    };
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
        .map_err(refused)?
        .timeout(CHECK_TIMEOUT)
        .version_comparator(|current, release| release.version != current)
        .build()
        .map_err(refused)?;
    let current = app.package_info().version.clone();
    match updater.check().await {
        Ok(Some(update)) => {
            let Ok(remote) = semver::Version::parse(update.version.trim_start_matches('v')) else {
                log::warn!(target: "myorbiter::updates", "{}: unreadable version {:?} in the manifest", channel.name(), update.version);
                return Err(format!("The {} channel's manifest is malformed", channel.label()));
            };
            let date = update.raw_json.get("pub_date").and_then(|d| d.as_str()).map(str::to_owned);
            let notes = update.body.clone();
            let version = remote.to_string();
            // Kept only if its download is MyOrbiter's own; otherwise nothing is pending.
            keep(&pending.0, channel, update)?;
            log::info!(target: "myorbiter::updates", "{}: {version} on offer (this is {current})", channel.name());
            Ok(match offer(&current, &remote) {
                Offer::Newer => Check::Newer { version, notes, date },
                Offer::Older => Check::Older { version, notes, date },
                Offer::Same => Check::Current { version },
            })
        }
        Ok(None) => {
            log::info!(target: "myorbiter::updates", "{}: up to date ({current})", channel.name());
            *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Ok(Check::Current { version: current.to_string() })
        }
        Err(e) if empty_channel(&e).is_some() => {
            // A channel with nothing on it yet is said once a check, plainly, not as a warning.
            let system = empty_channel(&e) == Some(true);
            log::info!(target: "myorbiter::updates", "{}: no build {}yet", channel.name(), if system { "for this system " } else { "on this channel " });
            *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Ok(Check::Empty { system })
        }
        Err(e) => {
            // Offline, gitlab.com down, or a manifest the plugin can't read: the page says why in
            // plain words; the log keeps the plugin's own.
            log::warn!(target: "myorbiter::updates", "{} check failed after {} ms: {e}", channel.name(), started.elapsed().as_millis());
            Err(check_failure(channel, &e))
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
    // The address once more, right before the download: whatever check kept this update.
    still_own(&pending.0, channel, &update)?;
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

    /// The test server's own downloads, in place of MyOrbiter's release addresses: plain http on
    /// the manifest's own origin (`http://127.0.0.1:<port>`), with no user, query or fragment.
    pub fn download(url: &str) -> bool {
        let (Some(Ok(server)), Ok(url)) = (endpoint().map(|e| e.parse::<tauri::Url>()), url.parse::<tauri::Url>()) else {
            return false;
        };
        url.scheme() == "http" && url.origin() == server.origin() && url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none()
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

    /// The addresses, written out in full: the channel switch builds them all with `endpoints`, and
    /// Stable's are the ones tauri.conf.json carries.
    #[test]
    fn each_channel_has_its_own_manifest() {
        for (c, name) in [(Channel::Stable, "stable"), (Channel::Beta, "beta"), (Channel::Experimental, "experimental")] {
            assert_eq!(
                endpoints(c),
                [
                    format!("https://github.com/ShezissSnake/myorbiter/releases/download/{name}/latest.json"),
                    format!("https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel/{name}/latest.json"),
                ]
            );
        }
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["plugins"]["updater"]["endpoints"], serde_json::json!(endpoints(Channel::Stable)));
    }

    /// Every channel asks GitHub first and GitLab second, over https, each address on MyOrbiter's
    /// own project on a host the app opens links to (link.rs) and nowhere else on it.
    #[test]
    fn every_channel_asks_github_then_gitlab() {
        let hosts: Vec<&str> = crate::link::SITES.iter().map(|(h, _)| *h).collect();
        for c in [Channel::Stable, Channel::Beta, Channel::Experimental] {
            let urls: Vec<tauri::Url> = endpoints(c).iter().map(|u| u.parse().unwrap()).collect();
            assert_eq!(urls.iter().map(|u| u.host_str().unwrap()).collect::<Vec<_>>(), ["github.com", "gitlab.com"], "{c:?}");
            for (u, raw) in urls.iter().zip(endpoints(c)) {
                assert_eq!(u.scheme(), "https");
                assert!(u.username().is_empty() && u.password().is_none() && u.port().is_none() && u.query().is_none(), "{u}");
                assert!(hosts.contains(&u.host_str().unwrap()), "{u} isn't on a host in link.rs");
                // As the plugin is given it: parsed once more, the address doesn't change.
                assert_eq!(u.to_string(), raw);
                assert!(u.path().ends_with(&format!("/{}/latest.json", c.name())), "{u}");
            }
            assert!(urls[0].path().starts_with("/ShezissSnake/myorbiter/releases/download/"), "{}", urls[0]);
            // The encoded slash stays encoded: the API names the project by its full path.
            assert!(urls[1].path().starts_with("/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel/"), "{}", urls[1]);
        }
    }

    /// A channel manifest as CI publishes it (Experimental's, build 0.2.106) reads as the plugin
    /// reads it: the version, the date, and this system's download with its signature.
    #[test]
    fn a_published_manifest_reads_as_the_plugin_reads_it() {
        let raw = include_str!("../../tests/fixtures/updater/experimental-0.2.106.json");
        let release: tauri_plugin_updater::RemoteRelease = serde_json::from_str(raw).unwrap();
        assert_eq!(release.version, v("0.2.106"));
        assert!(release.pub_date.is_some());
        assert!(release.notes.as_deref().is_some_and(|n| !n.is_empty()));
        for (target, file) in [("linux-x86_64", "myorbiter_0.2.106_amd64.AppImage"), ("windows-x86_64", "myorbiter_0.2.106_x64-setup.exe")] {
            let url = release.download_url(target).unwrap().to_string();
            assert_eq!(url, format!("https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/myorbiter/0.2.106/{file}"));
            assert!(!release.signature(target).unwrap().is_empty());
        }
        assert!(release.download_url("darwin-aarch64").is_err());
    }

    const LINUX: &str = "linux-x86_64";
    const WINDOWS: &str = "windows-x86_64";
    const GH_131: &str = "https://github.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_";
    const GL_112: &str = "https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/myorbiter/0.2.112/myorbiter_0.2.112_";

    /// The addresses the release scripts write and the published manifests hold, each for its own
    /// system: the fixture's two (GitLab, 0.2.106) as the plugin reads them, GitHub's form for
    /// build 131, GitLab's for 0.2.112, and both forms once the version's first numbers move on.
    #[test]
    fn the_projects_own_downloads_are_allowed() {
        let raw = include_str!("../../tests/fixtures/updater/experimental-0.2.106.json");
        let release: tauri_plugin_updater::RemoteRelease = serde_json::from_str(raw).unwrap();
        for target in [LINUX, WINDOWS] {
            assert_eq!(download_allowed(release.download_url(target).unwrap().as_str(), "0.2.106", target), Ok(()), "{target}");
        }
        for (url, version, target) in [
            (format!("{GH_131}amd64.AppImage"), "0.2.131", LINUX),
            (format!("{GH_131}x64-setup.exe"), "0.2.131", WINDOWS),
            (format!("{GL_112}amd64.AppImage"), "0.2.112", LINUX),
            (format!("{GL_112}x64-setup.exe"), "0.2.112", WINDOWS),
            // The release's number isn't the version's last number, and the version isn't 0.2.<n>.
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-140/myorbiter_0.3.0_amd64.AppImage".into(), "0.3.0", LINUX),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-007/myorbiter_1.0.12_x64-setup.exe".into(), "1.0.12", WINDOWS),
            ("https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/myorbiter/1.0.0/myorbiter_1.0.0_amd64.AppImage".into(), "1.0.0", LINUX),
            ("https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/myorbiter/0.3.1/myorbiter_0.3.1_x64-setup.exe".into(), "0.3.1", WINDOWS),
        ] {
            assert_eq!(download_allowed(&url, version, target), Ok(()), "{url} for {target}");
        }
    }

    /// Everything else is refused, each for its own reason.
    #[test]
    fn every_other_download_is_refused_for_its_reason() {
        let gh = |file: &str| format!("{GH_131}{file}");
        let cases: Vec<(String, &str, &str, &str)> = vec![
            // Another host, one that only looks like it, and GitHub's own file storage.
            ("https://example.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another host"),
            ("https://github.com.example.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another host"),
            ("https://github.com./ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another host"),
            ("https://objects.githubusercontent.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another host"),
            ("https://raw.githubusercontent.com/ShezissSnake/myorbiter/main/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another host"),
            // http.
            ("http://github.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "not https"),
            // A port, and https's own port, which the parser drops.
            ("https://github.com:8443/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a port"),
            ("https://github.com:443/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            // A user, a password, and a user named like the host in front of another host.
            ("https://user@github.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a user or password"),
            ("https://user:secret@github.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a user or password"),
            ("https://github.com@example.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a user or password"),
            // A query, an empty one, a fragment.
            (gh("amd64.AppImage?x=1"), "0.2.131", LINUX, "a query"),
            (gh("amd64.AppImage?"), "0.2.131", LINUX, "a query"),
            (gh("amd64.AppImage#x"), "0.2.131", LINUX, "a fragment"),
            // Another owner, another repository, the old name (which only redirects), and a case change.
            ("https://github.com/someone/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another repository on github.com"),
            ("https://github.com/ShezissSnake/myorbiter-fork/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another repository on github.com"),
            ("https://github.com/ShezissSnake/orbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another repository on github.com"),
            ("https://github.com/shezisssnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another repository on github.com"),
            // Another GitLab project, by path, by number, and with its slash written in lower case.
            ("https://gitlab.com/api/v4/projects/someone%2Fmyorbiter/packages/generic/myorbiter/0.2.112/myorbiter_0.2.112_amd64.AppImage".into(), "0.2.112", LINUX, "another project on gitlab.com"),
            ("https://gitlab.com/api/v4/projects/12345/packages/generic/myorbiter/0.2.112/myorbiter_0.2.112_amd64.AppImage".into(), "0.2.112", LINUX, "another project on gitlab.com"),
            ("https://gitlab.com/api/v4/projects/sheziss-group%2fmyorbiter/packages/generic/myorbiter/0.2.112/myorbiter_0.2.112_amd64.AppImage".into(), "0.2.112", LINUX, "another project on gitlab.com"),
            // The channel's own folder in GitLab's registry, where the manifests are.
            ("https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel/experimental/myorbiter_0.2.112_amd64.AppImage".into(), "0.2.112", LINUX, "a package other than the builds'"),
            // A release tag that isn't build- and digits.
            ("https://github.com/ShezissSnake/myorbiter/releases/download/experimental/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a release that isn't build-<digits>"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a release that isn't build-<digits>"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131a/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a release that isn't build-<digits>"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-x131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a release that isn't build-<digits>"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/v0.2.131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a release that isn't build-<digits>"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-\u{661}\u{663}\u{661}/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            // A file of another version, and a GitLab folder of another version.
            (gh("amd64.AppImage").replace("myorbiter_0.2.131", "myorbiter_0.2.130"), "0.2.131", LINUX, "a file of another version"),
            (format!("{GL_112}amd64.AppImage").replace("/0.2.112/", "/0.2.111/"), "0.2.112", LINUX, "a folder of another version"),
            (format!("{GL_112}amd64.AppImage").replace("myorbiter_0.2.112", "myorbiter_0.2.111"), "0.2.112", LINUX, "a file of another version"),
            // The other system's file, each way, on both hosts.
            (gh("x64-setup.exe"), "0.2.131", LINUX, "the other system's file"),
            (gh("amd64.AppImage"), "0.2.131", WINDOWS, "the other system's file"),
            (format!("{GL_112}x64-setup.exe"), "0.2.112", LINUX, "the other system's file"),
            (format!("{GL_112}amd64.AppImage"), "0.2.112", WINDOWS, "the other system's file"),
            // Another file of the build: the .deb, a signature, a manifest; and one a folder deeper.
            (gh("amd64.deb"), "0.2.131", LINUX, "another file"),
            (gh("amd64.AppImage.sig"), "0.2.131", LINUX, "another file"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/latest.json".into(), "0.2.131", LINUX, "another file"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/x/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "another file"),
            // `..`, `%2e%2e` and `.%2e`: the parser resolves them, so the address reads differently.
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/../build-1/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/%2e%2e/build-1/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/.%2E/build-1/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage/..".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            // Other rewrites: an upper-case host, a backslash, a tab.
            ("https://GitHub.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131\\myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.App\tImage".into(), "0.2.131", LINUX, "an address that reads differently once parsed"),
            // An encoded slash or dot in the file name, or in the release.
            (gh("amd64%2FAppImage"), "0.2.131", LINUX, "an encoded character in the path"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131/x%2Fmyorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an encoded character in the path"),
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131%2Fx/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "an encoded character in the path"),
            (gh("amd64%2EAppImage"), "0.2.131", LINUX, "an encoded character in the path"),
            (format!("{GL_112}amd64%2FAppImage"), "0.2.112", LINUX, "an encoded character in the path"),
            // A doubled slash.
            ("https://github.com/ShezissSnake/myorbiter/releases/download/build-131//myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a doubled slash"),
            ("https://github.com//ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX, "a doubled slash"),
            ("https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/myorbiter/0.2.112//myorbiter_0.2.112_amd64.AppImage".into(), "0.2.112", LINUX, "a doubled slash"),
            // A version the app can't read as three numbers.
            (gh("amd64.AppImage"), "0.2", LINUX, "a version that isn't three numbers"),
            (gh("amd64.AppImage"), "v0.2.131", LINUX, "a version that isn't three numbers"),
            (gh("amd64.AppImage"), "0.2.131-beta.1", LINUX, "a version that isn't three numbers"),
            (gh("amd64.AppImage"), "0.2.131+x", LINUX, "a version that isn't three numbers"),
            (gh("amd64.AppImage"), "0.2.0131", LINUX, "a version that isn't three numbers"),
            (gh("amd64.AppImage"), "", LINUX, "a version that isn't three numbers"),
            // A system MyOrbiter has no build for.
            (gh("amd64.AppImage"), "0.2.131", "darwin-aarch64", "a system MyOrbiter has no build for"),
            (gh("amd64.AppImage"), "0.2.131", "linux-aarch64", "a system MyOrbiter has no build for"),
            (gh("x64-setup.exe"), "0.2.131", "windows-i686", "a system MyOrbiter has no build for"),
            (gh("amd64.AppImage"), "0.2.131", "linux", "a system MyOrbiter has no build for"),
            (gh("amd64.AppImage"), "0.2.131", "", "a system MyOrbiter has no build for"),
            // Not an address at all.
            ("not an address".into(), "0.2.131", LINUX, "not an address"),
        ];
        for (url, version, target, reason) in &cases {
            assert_eq!(download_allowed(url, version, target), Err(*reason), "{url:?} ({version:?}, {target:?})");
        }
    }

    /// A manifest whose Linux entry carries the Windows file's address and signature (validly
    /// signed for this version) is refused under Linux.
    #[test]
    fn the_other_systems_signed_file_is_refused() {
        let mut raw: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/updater/experimental-0.2.106.json")).unwrap();
        let windows = raw["platforms"]["windows-x86_64"].clone();
        raw["platforms"]["linux-x86_64"] = windows;
        let release: tauri_plugin_updater::RemoteRelease = serde_json::from_value(raw).unwrap();
        assert_eq!(download_allowed(release.download_url(LINUX).unwrap().as_str(), "0.2.106", LINUX), Err("the other system's file"));
    }

    /// What the release script writes for GitHub is what installed copies accept: the fixture is
    /// scripts/github-manifest.mjs's own output (held by tests/githubManifestFixture.test.ts), and
    /// each system's address in it, as the plugin reads it, passes for that system with the
    /// manifest's version and is refused as the other system's file for the other.
    #[test]
    fn the_github_manifest_the_release_script_writes_is_accepted() {
        let raw = include_str!("../../tests/fixtures/updater/github-0.2.120.json");
        let release: tauri_plugin_updater::RemoteRelease = serde_json::from_str(raw).unwrap();
        let version = release.version.to_string();
        assert_eq!(version, "0.2.120");
        for (target, other) in [(LINUX, WINDOWS), (WINDOWS, LINUX)] {
            let url = release.download_url(target).unwrap();
            assert_eq!(url.host_str(), Some("github.com"), "{url}");
            assert_eq!(download_allowed(url.as_str(), &version, target), Ok(()), "{url} for {target}");
            assert_eq!(download_allowed(url.as_str(), &version, other), Err("the other system's file"), "{url} for {other}");
        }
    }

    /// The page cannot call the updater plugin's own commands, which would download with no
    /// address rule: the capability file grants no `updater:` permission.
    #[test]
    fn the_page_has_no_updater_permission() {
        let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let updater = cap["permissions"].as_array().unwrap().iter().filter(|p| p.as_str().or(p["identifier"].as_str()).is_some_and(|id| id.starts_with("updater:"))).count();
        assert_eq!(updater, 0, "no updater permission in capabilities/default.json");
    }

    /// What is checked is the address the plugin will request, as it parsed it from the manifest:
    /// a manifest whose text the parser rewrites into the project's own address (a `..`, an
    /// upper-case host, https's own port) has that address requested, and passes; the same text
    /// given to the function as it stands is refused (above).
    #[test]
    fn the_address_checked_is_the_one_the_plugin_requests() {
        let own = format!("{GH_131}amd64.AppImage");
        for written in [
            "https://github.com/ShezissSnake/myorbiter/releases/download/x/../build-131/myorbiter_0.2.131_amd64.AppImage",
            "https://GitHub.com/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage",
            "https://github.com:443/ShezissSnake/myorbiter/releases/download/build-131/myorbiter_0.2.131_amd64.AppImage",
        ] {
            let manifest = serde_json::json!({ "version": "0.2.131", "platforms": { LINUX: { "url": written, "signature": "x" } } });
            let release: tauri_plugin_updater::RemoteRelease = serde_json::from_value(manifest).unwrap();
            let held = release.download_url(LINUX).unwrap().as_str();
            assert_eq!(held, own, "{written}");
            assert_eq!(download_allowed(held, "0.2.131", LINUX), Ok(()), "{written}");
            assert_eq!(download_allowed(written, "0.2.131", LINUX), Err("an address that reads differently once parsed"), "{written}");
        }
    }

    /// An update as the check and the install see it, without the plugin.
    struct Offered(String, &'static str, &'static str);

    impl Download for Offered {
        fn url(&self) -> &str {
            &self.0
        }
        fn version(&self) -> &str {
            self.1
        }
        fn target(&self) -> String {
            self.2.into()
        }
    }

    /// The check keeps an update only when its download is MyOrbiter's own. One that isn't leaves
    /// nothing pending (not even what an earlier check kept), and the page gets a plain sentence.
    #[test]
    fn a_check_keeps_no_update_whose_download_is_not_the_projects() {
        let pending: Mutex<Option<(Channel, Offered)>> = Mutex::new(None);
        assert_eq!(keep(&pending, Channel::Experimental, Offered(format!("{GH_131}amd64.AppImage"), "0.2.131", LINUX)), Ok(()));
        assert!(pending.lock().unwrap().as_ref().is_some_and(|(c, u)| *c == Channel::Experimental && u.1 == "0.2.131"));
        let foreign = Offered("https://example.com/ShezissSnake/myorbiter/releases/download/build-132/myorbiter_0.2.132_amd64.AppImage".into(), "0.2.132", LINUX);
        assert_eq!(
            keep(&pending, Channel::Experimental, foreign),
            Err("The Experimental channel's manifest names a download that isn't MyOrbiter's own; nothing was downloaded".into())
        );
        assert!(pending.lock().unwrap().is_none(), "nothing is pending after a refusal");
        let windows_file = Offered(format!("{GH_131}x64-setup.exe"), "0.2.131", LINUX);
        assert!(keep(&pending, Channel::Beta, windows_file).unwrap_err().starts_with("The Beta channel's manifest"));
        assert!(pending.lock().unwrap().is_none());
    }

    /// The install checks the pending update again just before the download: one kept by
    /// anything else than this check (an older check, say) is refused there and dropped.
    #[test]
    fn an_install_checks_the_kept_update_again() {
        let foreign = Offered("https://example.com/myorbiter_0.2.132_amd64.AppImage".into(), "0.2.132", LINUX);
        let kept = Offered(foreign.0.clone(), foreign.1, foreign.2);
        let pending = Mutex::new(Some((Channel::Experimental, kept)));
        assert_eq!(still_own(&pending, Channel::Experimental, &foreign), Err("this update's download isn't MyOrbiter's own, so nothing was downloaded".into()));
        assert!(pending.lock().unwrap().is_none());
        let own = Offered(format!("{GL_112}x64-setup.exe"), "0.2.112", WINDOWS);
        assert_eq!(still_own(&pending, Channel::Experimental, &own), Ok(()));
    }

    /// The log names the refused address by its host and nothing else of it: no user, password,
    /// port, path, file, query or fragment.
    #[test]
    fn a_refusal_is_logged_by_host_alone() {
        let line = refused_line(Channel::Beta, "https://someone:secret@downloads.example.net:8443/a/path/evil_0.2.131.exe?token=abc#frag", "another host");
        assert_eq!(line, "beta: update refused, its download (at downloads.example.net) isn't MyOrbiter's own: another host");
        assert_eq!(refused_line(Channel::Stable, "not an address", "not an address"), "stable: update refused, its download (at no host) isn't MyOrbiter's own: not an address");
    }

    /// Each way a check can fail has its own plain sentence, naming the channel where it matters.
    #[test]
    fn a_failed_check_says_why_in_plain_words() {
        use tauri_plugin_updater::Error as E;
        let malformed = serde_json::from_str::<tauri_plugin_updater::RemoteRelease>(r#"{"version":"0.2.106","platforms":{"linux-x86_64":{"url":"not a url","signature":"x"}}}"#).unwrap_err();
        assert_eq!(check_failure(Channel::Experimental, &E::Serialization(malformed)), "The Experimental channel's manifest is malformed");
        let no_version = serde_json::from_str::<tauri_plugin_updater::RemoteRelease>(r#"{"notes":"x"}"#).unwrap_err();
        assert_eq!(check_failure(Channel::Beta, &E::Serialization(no_version)), "The Beta channel's manifest is malformed");
        assert_eq!(check_failure(Channel::Stable, &E::ReleaseNotFound), "Neither GitHub nor GitLab served the Stable channel's manifest");
        assert_eq!(check_failure(Channel::Experimental, &E::Network("dns".into())), "Couldn't reach GitHub or GitLab");
        assert_eq!(check_failure(Channel::Beta, &E::TargetNotFound("linux-x86_64".into())), "The Beta channel has no build for this system yet");
        assert_eq!(check_failure(Channel::Stable, &E::InsecureTransportProtocol), "The update address is invalid");
        assert_eq!(check_failure(Channel::Stable, &E::UnsupportedOs), "Updates aren't offered for this system");
    }

    #[test]
    fn a_channel_with_no_build_is_not_a_failure() {
        use tauri_plugin_updater::Error as E;
        assert_eq!(empty_channel(&E::ReleaseNotFound), Some(false), "no manifest anywhere: the channel is empty");
        assert_eq!(empty_channel(&E::TargetNotFound("linux-x86_64".into())), Some(true), "a manifest with no build for this system");
        assert_eq!(empty_channel(&E::Network("dns".into())), None, "offline is a failure");
        assert_eq!(empty_channel(&E::InsecureTransportProtocol), None);
        assert_eq!(serde_json::to_value(Check::Empty { system: false }).unwrap(), serde_json::json!({ "state": "empty", "system": false }));
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
        // The test server's download isn't let through either.
        assert!(!own_download(Channel::Beta, &Offered("http://127.0.0.1:9/myorbiter_0.2.131_amd64.AppImage".into(), "0.2.131", LINUX)));
        std::env::remove_var("MYORBITER_UPDATER_E2E_ENDPOINT");
        std::env::remove_var("MYORBITER_UPDATER_E2E_PUBKEY");
    }

    /// A build for the end-to-end test takes its server's own downloads, on the manifest's origin,
    /// and nothing else that isn't MyOrbiter's own.
    #[test]
    #[cfg(feature = "e2e-updater")]
    fn the_test_build_takes_only_its_servers_downloads() {
        std::env::set_var("MYORBITER_UPDATER_E2E_ENDPOINT", "http://127.0.0.1:8765/latest.json");
        let at = |url: &str| own_download(Channel::Experimental, &Offered(url.into(), "0.2.131", LINUX));
        assert!(at("http://127.0.0.1:8765/myorbiter_0.2.131_amd64.AppImage"));
        assert!(!at("http://127.0.0.1:8766/myorbiter_0.2.131_amd64.AppImage"), "another port");
        assert!(!at("http://localhost:8765/myorbiter_0.2.131_amd64.AppImage"), "another host");
        assert!(!at("http://127.0.0.1:8765/myorbiter_0.2.131_amd64.AppImage?x"), "a query");
        assert!(!at("https://example.com/myorbiter_0.2.131_amd64.AppImage"));
        assert!(at(&format!("{GH_131}amd64.AppImage")), "the project's own still passes");
        std::env::remove_var("MYORBITER_UPDATER_E2E_ENDPOINT");
        assert!(!at("http://127.0.0.1:8765/myorbiter_0.2.131_amd64.AppImage"), "not without the test server set");
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
