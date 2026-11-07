//! `img://localhost/<file>` serves WFCD item artwork from a local cache; `img://localhost/l/<file>`
//! serves the larger copy the item cards and details sheet show.
//!
//! Each image is fetched once from the WFCD repository (the same source TennoScope uses),
//! shrunk to a thumbnail and kept in `~/.cache/io.gitlab.sheziss-group.myorbiter/img`, so browsing tables does not
//! hit the network again and works offline afterwards.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::http::{header, Response, StatusCode};

const SOURCES: &[&str] = &[
    "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/img/",
    "https://cdn.warframestat.us/img/",
];
/// Thumbnails are drawn at up to 64 CSS px; 128 keeps them sharp on HiDPI.
const SIZE: u32 = 128;
/// Card and details art is drawn at up to ~200 CSS px.
const LARGE: u32 = 400;

/// Only plain file names: no paths, nothing that could escape the cache folder.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 120
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'(' | b')'))
        && !name.starts_with('.')
        && [".png", ".jpg", ".jpeg", ".webp"].iter().any(|ext| name.to_ascii_lowercase().ends_with(ext))
}

enum Fetched {
    Image(Vec<u8>),
    /// Every source answered 404: the image really doesn't exist.
    Missing,
    /// Network trouble; try again next time.
    Failed,
}

/// At most this many downloads at once, however many rows a table shows.
const PARALLEL: usize = 6;
static SLOTS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

struct Slot;
impl Slot {
    fn take() -> Slot {
        let (lock, cv) = &SLOTS;
        let mut busy = lock.lock().unwrap_or_else(|e| e.into_inner());
        while *busy >= PARALLEL {
            busy = cv.wait(busy).unwrap_or_else(|e| e.into_inner());
        }
        *busy += 1;
        Slot
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        let (lock, cv) = &SLOTS;
        let mut busy = lock.lock().unwrap_or_else(|e| e.into_inner());
        *busy -= 1;
        cv.notify_one();
    }
}

/// After a fetch fails for want of a network, the next ones wait this long: offline (or behind a
/// network that hangs), a long table would otherwise hold every download slot with requests
/// that each wait out their timeout.
const OFFLINE_PAUSE: Duration = Duration::from_secs(30);
static OFFLINE_SINCE: Mutex<Option<Instant>> = Mutex::new(None);

fn offline() -> bool {
    OFFLINE_SINCE.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|at| at.elapsed() < OFFLINE_PAUSE)
}

fn set_offline(yes: bool) {
    *OFFLINE_SINCE.lock().unwrap_or_else(|e| e.into_inner()) = yes.then(Instant::now);
}

/// warframe.market's own thumbnails, for items WFCD's art doesn't cover (mods, scenes, arcanes on
/// the Market page): named "wfm." and the file name.
const WFM_THUMBS: &str = "https://warframe.market/static/assets/items/images/en/thumbs/";

/// warframe.market's thumbnails go out at least `market::MIN_GAP` apart, as its API calls do. A
/// queue of their own: a page of thumbnails mustn't hold up listing changes behind it. `fetch`
/// runs on a blocking thread (lib.rs answers the image protocol in `spawn_blocking`), so the wait
/// never holds the main thread or an async worker.
static WFM_SPACER: crate::noxsframe::Spacer = crate::noxsframe::Spacer::new(crate::market::MIN_GAP);

fn fetch(name: &str) -> Fetched {
    let mut all_404 = true;
    let mut reached = false;
    let wfm = name.strip_prefix("wfm.").map(|f| (WFM_THUMBS, f));
    let sources: Vec<(&str, &str)> = match wfm {
        Some(s) => vec![s],
        None => SOURCES.iter().map(|b| (*b, name)).collect(),
    };
    for (base, name) in sources {
        if wfm.is_some() {
            WFM_SPACER.turn();
        }
        match crate::http_agent()
            .get(&format!("{base}{name}"))
            .set("User-Agent", crate::USER_AGENT)
            .timeout(Duration::from_secs(15))
            .call()
        {
            Ok(resp) => {
                let mut bytes = Vec::new();
                let mut reader = std::io::Read::take(resp.into_reader(), 8 * 1024 * 1024);
                reached = true;
                if std::io::Read::read_to_end(&mut reader, &mut bytes).is_ok() && !bytes.is_empty() {
                    if wfm.is_none() {
                        set_offline(false);
                    }
                    return Fetched::Image(bytes);
                }
                all_404 = false;
            }
            Err(ureq::Error::Status(404, _)) => reached = true,
            Err(ureq::Error::Status(..)) => {
                reached = true;
                all_404 = false;
            }
            Err(ureq::Error::Transport(_)) => all_404 = false,
        }
    }
    // Only WFCD's sources decide "offline": warframe.market being unreachable mustn't stop WFCD art.
    if wfm.is_none() {
        set_offline(!reached);
    }
    if all_404 { Fetched::Missing } else { Fetched::Failed }
}

/// Shrinks to a PNG thumbnail. `None` if it isn't an image: an error page served as 200 must
/// not be cached (and served as a PNG) forever.
fn thumbnail(bytes: &[u8], size: u32) -> Option<Vec<u8>> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok()?;
    // Item art is a few hundred pixels; refuse anything that would decode to a huge buffer.
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let img = reader.decode().ok()?;
    let img = if img.width() > size || img.height() > size { img.resize(size, size, image::imageops::FilterType::CatmullRom) } else { img };
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// The cached thumbnail path for a file name; fetching it first if needed.
pub fn cached(cache_dir: &Path, name: &str, large: bool) -> Option<PathBuf> {
    if !valid_name(name) {
        return None;
    }
    let (size, suffix) = if large { (LARGE, "large") } else { (SIZE, "thumb") };
    let path = cache_dir.join(format!("{name}.{suffix}.png"));
    if path.is_file() {
        return Some(path);
    }
    // Remember misses for a day so a missing image isn't requested on every render.
    let miss = cache_dir.join(format!("{name}.missing"));
    if let Ok(age) = fs::metadata(&miss).and_then(|m| m.modified()).and_then(|t| t.elapsed().map_err(std::io::Error::other)) {
        if age.as_secs() < 86_400 {
            return None;
        }
    }
    if offline() {
        return None;
    }
    fs::create_dir_all(cache_dir).ok()?;
    let _slot = Slot::take();
    // Another request may have fetched it while this one waited for a slot.
    if path.is_file() {
        return Some(path);
    }
    if offline() {
        return None;
    }
    match fetch(name) {
        Fetched::Image(bytes) => {
            // Written whole and renamed (a unique temp name: two rows asking for the same image
            // at once mustn't collide), so a crash never leaves a cut-off thumbnail that would
            // be served as immutable from then on.
            crate::write_atomic(&path, &thumbnail(&bytes, size)?, false).ok()?;
            Some(path)
        }
        Fetched::Missing => {
            let _ = fs::write(&miss, b"");
            None
        }
        Fetched::Failed => None,
    }
}

pub fn respond(cache_dir: &Path, uri_path: &str) -> Response<Vec<u8>> {
    let name = uri_path.trim_start_matches('/');
    let (large, name) = match name.strip_prefix("l/") {
        Some(rest) => (true, rest),
        None => (false, name),
    };
    let name = percent_decode(name);
    match cached(cache_dir, &name, large).and_then(|p| fs::read(p).ok()) {
        Some(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
            .body(bytes)
            .unwrap_or_default(),
        None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap_or_default(),
    }
}

fn hex(b: u8) -> Option<u8> {
    (b as char).to_digit(16).map(|d| d as u8)
}

/// Works on bytes: slicing the string after a `%` could land inside a multi-byte character and
/// panic, and a panic here would leave the image request without an answer.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_anything_but_plain_image_names() {
        assert!(valid_name("RhinoPrime.png"));
        assert!(valid_name("rifle-damage_amount.mod.jpg"));
        assert!(!valid_name("../secret.png"));
        assert!(!valid_name("a/b.png"));
        assert!(valid_name("wfm.equilibrium_(steam_pinnacle_pack).0326.128x128.webp"));
        assert!(!valid_name(".hidden.png"));
        assert!(!valid_name("script.js"));
    }

    /// Hits the network: `cargo test -p myorbiter -- --ignored`.
    #[test]
    #[ignore]
    fn fetches_and_caches_a_real_image() {
        let dir = std::env::temp_dir().join("myorbiter-img-test");
        let _ = fs::remove_dir_all(&dir);
        let path = cached(&dir, "RhinoPrime.png", false).expect("fetched");
        let img = image::open(&path).expect("decodes");
        assert!(img.width() <= SIZE && img.height() <= SIZE);
        assert!(fs::metadata(&path).unwrap().len() < 60_000);
        assert!(cached(&dir, "DoesNotExist123.png", false).is_none());
        assert!(dir.join("DoesNotExist123.png.missing").exists());
        // warframe.market's own thumbnails, a PNG and a WebP one.
        for name in ["wfm.serration.711b19665b2acbac445c68c9e8f8b550.128x128.png", "wfm.kuva_wytch_scene.24274e7f65c89a2b783895dd0dcb6bda.128x128.webp"] {
            let path = cached(&dir, name, false).expect("fetched from warframe.market");
            image::open(&path).expect("decodes");
        }
    }

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("Rhino%20Prime.png"), "Rhino Prime.png");
        assert_eq!(percent_decode("Plain.png"), "Plain.png");
        assert_eq!(percent_decode("a%2Fb.png"), "a/b.png");
        // A '%' before a multi-byte character used to slice through it and panic.
        assert_eq!(percent_decode("%aé.png"), "%aé.png");
        assert_eq!(percent_decode("x%é"), "x%é");
        assert_eq!(percent_decode("end%4"), "end%4");
    }

    #[test]
    fn the_protocol_serves_only_cached_plain_names() {
        let dir = std::env::temp_dir().join(format!("myorbiter-img-proto-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // A secret beside the cache, and a thumbnail in it.
        fs::write(dir.join("secret.png.thumb.png"), b"x").unwrap();
        let cache = dir.join("img");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("Rhino.png.thumb.png"), b"png").unwrap();
        assert_eq!(respond(&cache, "/Rhino.png").status(), StatusCode::OK);
        assert_eq!(respond(&cache, "/Rhino.png").body(), b"png");
        for evil in ["/..%2Fsecret.png", "/l/..%2F..%2Fsecret.png", "/%2E%2E/secret.png", "/a%00.png", "/%aé.png"] {
            assert_eq!(respond(&cache, evil).status(), StatusCode::NOT_FOUND, "{evil}");
        }
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn only_real_images_become_thumbnails() {
        assert_eq!(thumbnail(b"<html>rate limited</html>", SIZE), None);
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(300, 150).write_to(&mut png, image::ImageFormat::Png).unwrap();
        let thumb = thumbnail(png.get_ref(), SIZE).expect("an image");
        let img = image::load_from_memory(&thumb).unwrap();
        assert_eq!((img.width(), img.height()), (128, 64));
    }
}
