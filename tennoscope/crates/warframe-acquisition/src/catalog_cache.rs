use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use atomicwrites::{AtomicFile, OverwriteBehavior};
use reqwest::blocking::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{CatalogIndex, RelicRewardIndex};

pub const WFCD_ALL_JSON_URL: &str = "https://api.warframestat.us/items";
pub const WFCD_RELICS_JSON_URL: &str = "https://raw.githubusercontent.com/WFCD/warframe-items/81c893536dee6de23fbf114cf52d1b01d23bd65d/data/json/Relics.json";
// Raised from 64 MiB: the WFCD items catalog passed 64 MiB in October 2026.
const MAX_CATALOG_BYTES: usize = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogFetch {
    Unavailable,
    TooLarge,
}
pub trait CatalogSource {
    fn fetch(&self) -> Result<Vec<u8>, CatalogFetch>;
}

pub trait RelicCatalogSource {
    fn fetch(&self) -> Result<Vec<u8>, CatalogFetch>;
}

pub struct WfcdCatalogHttp {
    client: Client,
}
impl WfcdCatalogHttp {
    pub fn new() -> Result<Self, CatalogFetch> {
        Ok(Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| CatalogFetch::Unavailable)?,
        })
    }
}
impl CatalogSource for WfcdCatalogHttp {
    fn fetch(&self) -> Result<Vec<u8>, CatalogFetch> {
        let response = self
            .client
            .get(WFCD_ALL_JSON_URL)
            .send()
            .map_err(|_| CatalogFetch::Unavailable)?;
        if !response.status().is_success() {
            return Err(CatalogFetch::Unavailable);
        }
        read_bounded(response)
    }
}

pub struct WfcdRelicCatalogHttp {
    client: Client,
}

impl WfcdRelicCatalogHttp {
    pub fn new() -> Result<Self, CatalogFetch> {
        Ok(Self {
            client: Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| CatalogFetch::Unavailable)?,
        })
    }
}

impl RelicCatalogSource for WfcdRelicCatalogHttp {
    fn fetch(&self) -> Result<Vec<u8>, CatalogFetch> {
        fetch_bounded(&self.client, WFCD_RELICS_JSON_URL)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogLoadSource {
    Network,
    /// The stored generation, fetched recently enough that it is the current catalogue.
    RecentCache,
    StaleCache,
}
pub struct CatalogLoad {
    index: CatalogIndex,
    source: CatalogLoadSource,
    fetched_unix: u64,
}
impl CatalogLoad {
    pub const fn index(&self) -> &CatalogIndex {
        &self.index
    }
    pub const fn source(&self) -> CatalogLoadSource {
        self.source
    }
    pub const fn fetched_unix(&self) -> u64 {
        self.fetched_unix
    }
}

#[derive(Debug, Error)]
pub enum CatalogCacheError {
    #[error("no valid Warframe catalog is available")]
    Unavailable,
    #[error("catalog cache could not be updated")]
    CacheWrite,
}

#[derive(Deserialize)]
struct Generation {
    fetched_unix: u64,
    catalog: serde_json::Value,
    content_hash: String,
}

pub struct RelicCatalogLoad {
    index: RelicRewardIndex,
    source: CatalogLoadSource,
    fetched_unix: u64,
}

impl RelicCatalogLoad {
    pub const fn index(&self) -> &RelicRewardIndex {
        &self.index
    }

    pub const fn source(&self) -> CatalogLoadSource {
        self.source
    }

    pub const fn fetched_unix(&self) -> u64 {
        self.fetched_unix
    }
}

pub struct CatalogCache {
    directory: PathBuf,
}
impl CatalogCache {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }
    pub fn load(
        &self,
        source: &dyn CatalogSource,
        now_unix: u64,
    ) -> Result<CatalogLoad, CatalogCacheError> {
        if let Ok(bytes) = source.fetch() {
            if let Ok(index) = CatalogIndex::from_wfcd_json(&bytes) {
                store_generation(
                    &self.directory.join("catalog-generation.json"),
                    &self.directory,
                    &bytes,
                    now_unix,
                )?;
                return Ok(CatalogLoad {
                    index,
                    source: CatalogLoadSource::Network,
                    fetched_unix: now_unix,
                });
            }
        }
        self.load_cached()
    }

    /// The stored generation when it was fetched less than `max_age_secs` ago, and otherwise
    /// [`Self::load`]: the catalogue changes with game updates, not by the minute, so an inventory
    /// refresh does not need a fresh 70 MB download every time.
    pub fn load_recent(
        &self,
        source: &dyn CatalogSource,
        now_unix: u64,
        max_age_secs: u64,
    ) -> Result<CatalogLoad, CatalogCacheError> {
        if let Ok(mut cached) = self.load_cached()
            && now_unix.saturating_sub(cached.fetched_unix) < max_age_secs
            && cached.fetched_unix <= now_unix
        {
            cached.source = CatalogLoadSource::RecentCache;
            return Ok(cached);
        }
        self.load(source, now_unix)
    }

    pub fn load_cached(&self) -> Result<CatalogLoad, CatalogCacheError> {
        let (fetched_unix, catalog_bytes) =
            load_generation(&self.directory.join("catalog-generation.json"))?;
        let index = CatalogIndex::from_wfcd_json(&catalog_bytes)
            .map_err(|_| CatalogCacheError::Unavailable)?;
        Ok(CatalogLoad {
            index,
            source: CatalogLoadSource::StaleCache,
            fetched_unix,
        })
    }
}

/// The catalogue an inventory refresh works from, kept between refreshes.
///
/// Each refresh used to load the catalogue from scratch: a 70 MB download, a JSON document of
/// several hundred megabytes while it was parsed, and the stored copy rewritten, every time the
/// game finished an inventory sync. This keeps the last load and reuses it while it is current
/// (fetched less than `max_age_secs` ago). An old one (the network was down and only an
/// outdated stored copy loaded) is retried at most every `retry_secs`.
pub struct RecentCatalog {
    max_age_secs: u64,
    retry_secs: u64,
    held: Mutex<Option<(Arc<CatalogLoad>, u64)>>,
}

impl RecentCatalog {
    pub const fn new(max_age_secs: u64, retry_secs: u64) -> Self {
        Self {
            max_age_secs,
            retry_secs,
            held: Mutex::new(None),
        }
    }

    pub fn get(
        &self,
        cache: &CatalogCache,
        source: &dyn CatalogSource,
        now_unix: u64,
    ) -> Result<Arc<CatalogLoad>, CatalogCacheError> {
        let mut held = self.held.lock().map_err(|_| CatalogCacheError::Unavailable)?;
        if let Some((load, checked_unix)) = held.as_ref() {
            let fetched = load.fetched_unix();
            let current = fetched <= now_unix && now_unix - fetched < self.max_age_secs;
            let checked_lately =
                *checked_unix <= now_unix && now_unix - *checked_unix < self.retry_secs;
            if current || checked_lately {
                return Ok(Arc::clone(load));
            }
        }
        // Let go of the old index before the new one is built, so the two never sit in memory
        // together.
        *held = None;
        let load = Arc::new(cache.load_recent(source, now_unix, self.max_age_secs)?);
        *held = Some((Arc::clone(&load), now_unix));
        Ok(load)
    }
}

pub struct RelicCatalogCache {
    directory: PathBuf,
}

impl RelicCatalogCache {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    pub fn load(
        &self,
        source: &dyn RelicCatalogSource,
        now_unix: u64,
    ) -> Result<RelicCatalogLoad, CatalogCacheError> {
        if let Ok(bytes) = source.fetch() {
            if let Ok(index) = RelicRewardIndex::from_wfcd_json(&bytes) {
                self.store(&bytes, now_unix)?;
                return Ok(RelicCatalogLoad {
                    index,
                    source: CatalogLoadSource::Network,
                    fetched_unix: now_unix,
                });
            }
        }
        self.load_cached()
    }

    fn store(&self, catalog_json: &[u8], fetched_unix: u64) -> Result<(), CatalogCacheError> {
        store_generation(
            &self.directory.join("relic-generation.json"),
            &self.directory,
            catalog_json,
            fetched_unix,
        )
    }

    pub fn load_cached(&self) -> Result<RelicCatalogLoad, CatalogCacheError> {
        let (fetched_unix, catalog_bytes) =
            load_generation(&self.directory.join("relic-generation.json"))?;
        let index = RelicRewardIndex::from_wfcd_json(&catalog_bytes)
            .map_err(|_| CatalogCacheError::Unavailable)?;
        Ok(RelicCatalogLoad {
            index,
            source: CatalogLoadSource::StaleCache,
            fetched_unix,
        })
    }
}

fn fetch_bounded(client: &Client, url: &str) -> Result<Vec<u8>, CatalogFetch> {
    let response = client
        .get(url)
        .send()
        .map_err(|_| CatalogFetch::Unavailable)?;
    if !response.status().is_success() {
        return Err(CatalogFetch::Unavailable);
    }
    read_bounded(response)
}

/// Read a response body up to `MAX_CATALOG_BYTES`, refusing anything longer.
///
/// Reads one byte past the limit rather than the limit itself so an oversize body is told apart
/// from one that is exactly the limit, and it is read through `Take` so an oversize body never
/// costs more than the limit plus one byte of memory before it is refused.
fn read_bounded(body: impl Read) -> Result<Vec<u8>, CatalogFetch> {
    let mut bytes = Vec::new();
    body.take((MAX_CATALOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| CatalogFetch::Unavailable)?;
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(CatalogFetch::TooLarge);
    }
    Ok(bytes)
}

/// The hash a generation is stored under: the fetch time, then the catalogue's JSON bytes.
fn generation_hash(fetched_unix: u64, catalog_json: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(fetched_unix.to_le_bytes());
    digest.update(catalog_json);
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// How a generation file written by [`store_generation`] begins. Everything after the header is
/// the catalogue exactly as downloaded, then a closing brace, so the file stays one JSON object
/// (`catalog` is still a top-level field) and is read back without parsing the catalogue twice.
const RAW_GENERATION_PREFIX: &[u8] = b"{\"format\":2,\"fetched_unix\":";

/// Write a generation file around the downloaded bytes. The first format stored a re-serialised
/// `serde_json::Value` of the whole catalogue, which meant a document of several hundred
/// megabytes in memory on every store and every load.
fn store_generation(
    path: &std::path::Path,
    directory: &std::path::Path,
    catalog_json: &[u8],
    fetched_unix: u64,
) -> Result<(), CatalogCacheError> {
    fs::create_dir_all(directory).map_err(|_| CatalogCacheError::CacheWrite)?;
    let content_hash = generation_hash(fetched_unix, catalog_json);
    AtomicFile::new(path, OverwriteBehavior::AllowOverwrite)
        .write(|file| {
            file.write_all(RAW_GENERATION_PREFIX)?;
            write!(file, "{fetched_unix},\"content_hash\":\"{content_hash}\",\"catalog\":")?;
            file.write_all(catalog_json)?;
            file.write_all(b"}")?;
            file.sync_all()
        })
        .map_err(|_| CatalogCacheError::CacheWrite)
}

/// Read a generation file back: its fetch time and the catalogue's JSON, once its hash checks.
/// A file in the first format (written by an earlier version) is still read, the old way.
fn load_generation(path: &std::path::Path) -> Result<(u64, Vec<u8>), CatalogCacheError> {
    let mut bytes = fs::read(path).map_err(|_| CatalogCacheError::Unavailable)?;
    if bytes.starts_with(RAW_GENERATION_PREFIX) {
        let (fetched_unix, content_hash, start) =
            raw_generation_header(&bytes).ok_or(CatalogCacheError::Unavailable)?;
        let end = bytes.len() - 1;
        if bytes[end] != b'}'
            || start > end
            || generation_hash(fetched_unix, &bytes[start..end]) != content_hash
        {
            return Err(CatalogCacheError::Unavailable);
        }
        bytes.truncate(end);
        bytes.drain(..start);
        return Ok((fetched_unix, bytes));
    }
    load_first_format(&bytes)
}

/// The fetch time, the hash, and where the catalogue starts, from a second-format header.
fn raw_generation_header(bytes: &[u8]) -> Option<(u64, String, usize)> {
    let rest = bytes.strip_prefix(RAW_GENERATION_PREFIX)?;
    let digits = rest.iter().take_while(|byte| byte.is_ascii_digit()).count();
    if digits == 0 || digits > 20 {
        return None;
    }
    let fetched_unix = std::str::from_utf8(&rest[..digits]).ok()?.parse().ok()?;
    let rest = rest[digits..].strip_prefix(b",\"content_hash\":\"")?;
    let hash = rest.get(..64)?;
    if !hash
        .iter()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return None;
    }
    let content_hash = String::from_utf8(hash.to_vec()).ok()?;
    let rest = rest[64..].strip_prefix(b"\",\"catalog\":")?;
    Some((fetched_unix, content_hash, bytes.len() - rest.len()))
}

/// The first format: `Generation` as serde_json wrote it, hashed over the catalogue as serde_json
/// writes it back out.
fn load_first_format(bytes: &[u8]) -> Result<(u64, Vec<u8>), CatalogCacheError> {
    let Generation {
        fetched_unix,
        catalog,
        content_hash,
    } = serde_json::from_slice(bytes).map_err(|_| CatalogCacheError::Unavailable)?;
    let catalog_json =
        serde_json::to_vec(&catalog).map_err(|_| CatalogCacheError::Unavailable)?;
    drop(catalog);
    if content_hash != generation_hash(fetched_unix, &catalog_json) {
        return Err(CatalogCacheError::Unavailable);
    }
    Ok((fetched_unix, catalog_json))
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::{CatalogFetch, MAX_CATALOG_BYTES, read_bounded};

    /// `https://api.warframestat.us/items` as measured on 2026-10-10: 17,672 entries. It passed
    /// the old 64 MiB limit (67,108,864) at some point before then, after which every fetch was
    /// refused as `TooLarge` and a fresh install had no catalog at all.
    const LIVE_WFCD_ITEMS_BYTES: usize = 68_640_011;

    fn body(length: usize) -> impl Read {
        std::io::repeat(b' ').take(length as u64)
    }

    #[test]
    fn the_live_wfcd_items_catalog_is_within_the_limit() {
        let bytes =
            read_bounded(body(LIVE_WFCD_ITEMS_BYTES)).expect("the live catalog size is accepted");
        assert_eq!(bytes.len(), LIVE_WFCD_ITEMS_BYTES);
    }

    #[test]
    fn a_body_at_the_limit_is_accepted_and_one_byte_over_is_refused() {
        assert_eq!(
            read_bounded(body(MAX_CATALOG_BYTES)).map(|bytes| bytes.len()),
            Ok(MAX_CATALOG_BYTES)
        );
        assert_eq!(
            read_bounded(body(MAX_CATALOG_BYTES + 1)).map(|bytes| bytes.len()),
            Err(CatalogFetch::TooLarge)
        );
    }
}
