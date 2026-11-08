use std::{cell::Cell, fs};
use tempfile::tempdir;
use warframe_acquisition::{
    CatalogCache, CatalogCacheError, CatalogFetch, CatalogLoadSource, CatalogSource,
    RelicCatalogCache, RelicCatalogSource, WFCD_ALL_JSON_URL,
};

const VALID: &[u8] = br#"[{"uniqueName":"/Lotus/Powersuits/Test/Test","name":"Test Frame","type":"Warframe","category":"Warframes","masterable":true}]"#;
const VALID_RELICS: &[u8] = br#"[{"uniqueName":"/Lotus/Types/Game/Projections/TestABronze","rewards":[{"item":{"name":"Forma Blueprint"}}]}]"#;

#[test]
fn item_catalog_uses_the_supported_aggregate_endpoint() {
    assert_eq!(WFCD_ALL_JSON_URL, "https://api.warframestat.us/items");
}

struct Source {
    result: Result<Vec<u8>, CatalogFetch>,
    calls: Cell<usize>,
}
impl CatalogSource for Source {
    fn fetch(&self) -> Result<Vec<u8>, CatalogFetch> {
        self.calls.set(self.calls.get() + 1);
        self.result.clone()
    }
}

impl RelicCatalogSource for Source {
    fn fetch(&self) -> Result<Vec<u8>, CatalogFetch> {
        CatalogSource::fetch(self)
    }
}

#[test]
fn relic_catalog_has_an_independent_atomic_cache_generation() {
    let dir = tempdir().unwrap();
    let cache = RelicCatalogCache::new(dir.path().join("catalog"));
    let loaded = cache
        .load(
            &Source {
                result: Ok(VALID_RELICS.to_vec()),
                calls: Cell::new(0),
            },
            100,
        )
        .unwrap();

    assert_eq!(loaded.source(), CatalogLoadSource::Network);
    assert_eq!(loaded.fetched_unix(), 100);
    assert!(dir.path().join("catalog/relic-generation.json").is_file());

    let stale = cache
        .load(
            &Source {
                result: Err(CatalogFetch::Unavailable),
                calls: Cell::new(0),
            },
            200,
        )
        .unwrap();
    assert_eq!(stale.source(), CatalogLoadSource::StaleCache);
    assert_eq!(stale.fetched_unix(), 100);
}

#[test]
fn valid_download_is_atomically_cached_with_freshness_metadata() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    let loaded = cache
        .load(
            &Source {
                result: Ok(VALID.to_vec()),
                calls: Cell::new(0),
            },
            100,
        )
        .unwrap();
    assert_eq!(loaded.source(), CatalogLoadSource::Network);
    assert_eq!(loaded.fetched_unix(), 100);
    assert!(
        loaded
            .index()
            .resolve("/Lotus/Powersuits/Test/Test")
            .is_some()
    );
    assert!(dir.path().join("catalog/catalog-generation.json").is_file());
}

#[test]
fn stale_complete_cache_is_used_when_network_fails() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    cache
        .load(
            &Source {
                result: Ok(VALID.to_vec()),
                calls: Cell::new(0),
            },
            100,
        )
        .unwrap();
    let loaded = cache
        .load(
            &Source {
                result: Err(CatalogFetch::Unavailable),
                calls: Cell::new(0),
            },
            200,
        )
        .unwrap();
    assert_eq!(loaded.source(), CatalogLoadSource::StaleCache);
    assert_eq!(loaded.fetched_unix(), 100);
}

#[test]
fn invalid_download_never_replaces_the_last_complete_catalog() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    cache
        .load(
            &Source {
                result: Ok(VALID.to_vec()),
                calls: Cell::new(0),
            },
            100,
        )
        .unwrap();
    let loaded = cache
        .load(
            &Source {
                result: Ok(b"not json".to_vec()),
                calls: Cell::new(0),
            },
            200,
        )
        .unwrap();
    assert_eq!(loaded.source(), CatalogLoadSource::StaleCache);
    assert!(
        loaded
            .index()
            .resolve("/Lotus/Powersuits/Test/Test")
            .is_some()
    );
}

#[test]
fn interrupted_temporary_generation_is_never_loaded() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    fs::create_dir_all(dir.path().join("catalog")).unwrap();
    fs::write(
        dir.path().join("catalog/catalog-generation.tmp-99"),
        b"partial",
    )
    .unwrap();
    assert!(
        cache
            .load(
                &Source {
                    result: Err(CatalogFetch::Unavailable),
                    calls: Cell::new(0)
                },
                100
            )
            .is_err()
    );
}

#[test]
fn mismatched_content_hash_rejects_the_entire_generation() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    cache
        .load(
            &Source {
                result: Ok(VALID.to_vec()),
                calls: Cell::new(0),
            },
            100,
        )
        .unwrap();
    let path = dir.path().join("catalog/catalog-generation.json");
    let mut envelope: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    envelope["fetched_unix"] = 999.into();
    fs::write(path, serde_json::to_vec(&envelope).unwrap()).unwrap();
    assert!(
        cache
            .load(
                &Source {
                    result: Err(CatalogFetch::Unavailable),
                    calls: Cell::new(0)
                },
                200
            )
            .is_err()
    );
}

#[test]
fn concurrent_writers_leave_one_whole_valid_generation() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("catalog");
    std::thread::scope(|scope| {
        for now in [100, 200] {
            let path = path.clone();
            scope.spawn(move || {
                let outcome = CatalogCache::new(path).load(
                    &Source {
                        result: Ok(VALID.to_vec()),
                        calls: Cell::new(0),
                    },
                    now,
                );
                // Either writer may lose the race to replace the generation file. On Windows
                // the replace of a destination being replaced at the same moment fails
                // transiently (MoveFileExW), and the loser reporting CacheWrite is a
                // legitimate outcome, since the invariant under test is that one whole valid
                // generation survives, asserted below. Any other failure is a bug.
                if let Err(error) = outcome
                    && !matches!(error, CatalogCacheError::CacheWrite)
                {
                    panic!("unexpected cache error under concurrent writers: {error}");
                }
            });
        }
    });
    let loaded = CatalogCache::new(path)
        .load(
            &Source {
                result: Err(CatalogFetch::Unavailable),
                calls: Cell::new(0),
            },
            300,
        )
        .unwrap();
    assert!(matches!(loaded.fetched_unix(), 100 | 200));
    assert!(
        loaded
            .index()
            .resolve("/Lotus/Powersuits/Test/Test")
            .is_some()
    );
}

#[test]
fn fails_honestly_without_network_or_a_valid_cache() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    assert!(
        cache
            .load(
                &Source {
                    result: Err(CatalogFetch::Unavailable),
                    calls: Cell::new(0)
                },
                100
            )
            .is_err()
    );
}

/// A generation is stored around the downloaded bytes, so it reads back without a second parse,
/// and the file is still one JSON object with the catalogue under `catalog`.
#[test]
fn a_stored_generation_keeps_the_download_byte_for_byte() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    cache
        .load(
            &Source {
                result: Ok(VALID.to_vec()),
                calls: Cell::new(0),
            },
            100,
        )
        .unwrap();
    let stored = fs::read(dir.path().join("catalog/catalog-generation.json")).unwrap();
    let envelope: serde_json::Value = serde_json::from_slice(&stored).unwrap();
    assert_eq!(envelope["fetched_unix"], 100);
    assert_eq!(envelope["catalog"][0]["name"], "Test Frame");
    assert!(
        stored.windows(VALID.len()).any(|window| window == VALID),
        "the download is stored as it came"
    );
    let cached = cache.load_cached().unwrap();
    assert_eq!(cached.fetched_unix(), 100);
    assert!(cached.index().resolve("/Lotus/Powersuits/Test/Test").is_some());
}

/// Changing the stored fetch time in place breaks the hash, in the stored format itself.
#[test]
fn an_edited_fetch_time_in_place_rejects_the_generation() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    cache
        .load(
            &Source {
                result: Ok(VALID.to_vec()),
                calls: Cell::new(0),
            },
            100,
        )
        .unwrap();
    let path = dir.path().join("catalog/catalog-generation.json");
    let stored = String::from_utf8(fs::read(&path).unwrap()).unwrap();
    fs::write(&path, stored.replacen("\"fetched_unix\":100", "\"fetched_unix\":900", 1)).unwrap();
    assert!(cache.load_cached().is_err());
}

/// A generation written by an earlier version (the whole envelope serialised by serde_json, the
/// hash taken over the re-serialised catalogue) still loads.
#[test]
fn a_first_format_generation_still_loads() {
    use sha2::{Digest, Sha256};
    let dir = tempdir().unwrap();
    let catalog: serde_json::Value = serde_json::from_slice(VALID).unwrap();
    let mut digest = Sha256::new();
    digest.update(100_u64.to_le_bytes());
    digest.update(serde_json::to_vec(&catalog).unwrap());
    let content_hash: String = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    fs::create_dir_all(dir.path().join("catalog")).unwrap();
    fs::write(
        dir.path().join("catalog/catalog-generation.json"),
        serde_json::to_vec(&serde_json::json!({
            "fetched_unix": 100,
            "catalog": catalog,
            "content_hash": content_hash,
        }))
        .unwrap(),
    )
    .unwrap();
    let cached = CatalogCache::new(dir.path().join("catalog")).load_cached().unwrap();
    assert_eq!(cached.fetched_unix(), 100);
    assert!(cached.index().resolve("/Lotus/Powersuits/Test/Test").is_some());
}

/// `load_recent` reads a stored generation under the age limit and only fetches past it.
#[test]
fn a_recent_generation_is_used_without_a_download() {
    let dir = tempdir().unwrap();
    let cache = CatalogCache::new(dir.path().join("catalog"));
    let source = Source {
        result: Ok(VALID.to_vec()),
        calls: Cell::new(0),
    };
    cache.load(&source, 100).unwrap();
    let recent = cache.load_recent(&source, 100 + 3_600, 86_400).unwrap();
    assert_eq!(recent.source(), CatalogLoadSource::RecentCache);
    assert_eq!(source.calls.get(), 1, "no second download inside the day");
    let next_day = cache.load_recent(&source, 100 + 90_000, 86_400).unwrap();
    assert_eq!(next_day.source(), CatalogLoadSource::Network);
    assert_eq!(source.calls.get(), 2);
}
