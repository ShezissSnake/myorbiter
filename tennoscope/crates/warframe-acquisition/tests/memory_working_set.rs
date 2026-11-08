//! The helper's working set over a simulated long session, measured on this test process.
//!
//! One test in its own binary, so nothing else allocates while it measures. Each phase resets
//! the kernel's peak-RSS mark (`/proc/self/clear_refs` = 5, this process only), runs, and reads
//! the new peak back from `/proc/self/status`. No game, no network: a synthetic heap stands in
//! for the game's dirty pages and a synthetic catalogue for the WFCD download.
//!
//! The numbers print with `--nocapture`; the assertions pin the ceilings. Measured before these
//! ceilings existed, on the same synthetic session: the first refresh peaked at +603 MiB, every
//! refresh downloaded the catalogue again, twelve scans of a heap with 1,200 dirty runs peaked
//! at +305 MiB, and the process ended the session with about 610 MiB resident.
#![cfg(target_os = "linux")]

mod common;

use std::{cell::Cell, fs, time::Duration};

use warframe_acquisition::{
    AcquisitionError, CatalogCache, CatalogFetch, CatalogLoadSource, CatalogSource, GameProcess,
    MemoryReader, ReadableRegion, RecentCatalog, RegionScanPriority, RewardMemoryScanner,
    RewardNeedle, RewardRecordPolicy, RewardRecordQuery,
};

const MIB: u64 = 1024 * 1024;

/// Kilobyte figures from `/proc/self/status`.
#[derive(Clone, Copy, Debug)]
struct Status {
    rss_kb: u64,
    hwm_kb: u64,
    size_kb: u64,
    threads: u64,
}

fn status() -> Status {
    let text = fs::read_to_string("/proc/self/status").expect("own status");
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(name))
            .and_then(|rest| rest.split_whitespace().next())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
    };
    Status {
        rss_kb: field("VmRSS:"),
        hwm_kb: field("VmHWM:"),
        size_kb: field("VmSize:"),
        threads: field("Threads:"),
    }
}

/// Run `phase` and return how far resident memory rose above where it started, in MiB, plus
/// the status after it.
fn peak_rise(phase: impl FnOnce()) -> (u64, Status) {
    fs::write("/proc/self/clear_refs", "5").expect("peak RSS resets for this process");
    let before = status();
    phase();
    let after = status();
    (after.hwm_kb.saturating_sub(before.rss_kb) / 1024, after)
}

/// The game's recently written anonymous heap, as many separate dirty runs, without holding any
/// of it: every read fills the caller's buffer with filler bytes.
struct SyntheticHeap {
    regions: Vec<ReadableRegion>,
}

impl SyntheticHeap {
    fn new(runs: usize, run_len: usize) -> Self {
        let regions = (0..runs)
            .map(|index| {
                ReadableRegion::classified(
                    0x7f00_0000_0000 + index as u64 * 2 * run_len as u64,
                    run_len,
                    RegionScanPriority::WritableAnonymous,
                )
            })
            .collect();
        Self { regions }
    }
}

impl MemoryReader for SyntheticHeap {
    fn readable_regions(&self, _: &GameProcess) -> Result<Vec<ReadableRegion>, AcquisitionError> {
        Ok(self.regions.clone())
    }

    fn read_at(
        &self,
        _: &GameProcess,
        address: u64,
        buffer: &mut [u8],
    ) -> Result<usize, AcquisitionError> {
        let Some(region) = self.regions.iter().find(|region| {
            address >= region.start() && address < region.start() + region.len() as u64
        }) else {
            return Ok(0);
        };
        let left = usize::try_from(region.start() + region.len() as u64 - address).unwrap();
        let len = left.min(buffer.len());
        buffer[..len].fill(0x5a);
        Ok(len)
    }
}

/// A WFCD-shaped catalogue of `items` entries, each about 3.9 KB like the live one (68.6 MB for
/// 17,672 items), with the nested drop tables that make its DOM large.
fn synthetic_catalogue(items: usize) -> Vec<u8> {
    let mut body = String::with_capacity(items * 4000);
    body.push('[');
    for index in 0..items {
        if index > 0 {
            body.push(',');
        }
        body.push_str(&format!(
            r#"{{"uniqueName":"/Lotus/Types/Synthetic/Item{index}","name":"Synthetic Item {index}","type":"Warframe","category":"Warframes","masterable":true,"description":"{}","drops":["#,
            "d".repeat(1400)
        ));
        for drop in 0..30 {
            if drop > 0 {
                body.push(',');
            }
            body.push_str(&format!(
                r#"{{"location":"Synthetic Relic {drop} Intact","chance":0.{drop:02},"rarity":"Common"}}"#
            ));
        }
        body.push_str("]}");
    }
    body.push(']');
    body.into_bytes()
}

struct Download {
    body: Vec<u8>,
    calls: Cell<usize>,
}

impl CatalogSource for Download {
    fn fetch(&self) -> Result<Vec<u8>, CatalogFetch> {
        self.calls.set(self.calls.get() + 1);
        Ok(self.body.clone())
    }
}

#[test]
fn a_long_session_keeps_a_bounded_working_set() {
    common::install_test_logger();
    let start = status();
    println!(
        "start: rss {} MiB, virtual {} MiB, threads {}",
        start.rss_kb / 1024,
        start.size_kb / 1024,
        start.threads
    );

    // Inventory refreshes: each `Inventory sync done` in Full mode loads the catalogue.
    let cache_dir = tempfile::tempdir().unwrap();
    let cache = CatalogCache::new(cache_dir.path().join("catalog"));
    let download = Download {
        body: synthetic_catalogue(17_672),
        calls: Cell::new(0),
    };
    println!("synthetic catalogue: {} MiB", download.body.len() as u64 / MIB);
    let recent = RecentCatalog::new(24 * 60 * 60, 60 * 60);
    let refresh = |now: u64| {
        let loaded = recent.get(&cache, &download, now).unwrap();
        assert!(loaded.index().resolve("/Lotus/Types/Synthetic/Item17000").is_some());
        loaded.source()
    };
    let (first_rise, after_first) = peak_rise(|| {
        assert_eq!(refresh(1_000_000), CatalogLoadSource::Network);
    });
    println!(
        "first inventory refresh: peak +{first_rise} MiB, rss after {} MiB",
        after_first.rss_kb / 1024
    );
    // The download, its index and the stored copy, with no whole-catalogue JSON document beside
    // them (that document took the first refresh to +603 MiB on this catalogue).
    assert!(first_rise < 160, "the first refresh peaked at +{first_rise} MiB");
    let refreshes = 8_u64;
    let (catalogue_rise, after_catalogue) = peak_rise(|| {
        for later in 1..=refreshes {
            refresh(1_000_000 + later * 600);
        }
    });
    println!(
        "{refreshes} more refreshes, 10 min apart: {} downloads in all ({} MiB), peak +{catalogue_rise} MiB, rss after {} MiB",
        download.calls.get(),
        download.calls.get() as u64 * download.body.len() as u64 / MIB,
        after_catalogue.rss_kb / 1024
    );
    assert_eq!(download.calls.get(), 1, "one download for the session");
    assert!(
        catalogue_rise < 8,
        "refreshes on a current catalogue peaked at +{catalogue_rise} MiB"
    );

    // A day on, the catalogue is fetched again, once.
    refresh(1_000_000 + 25 * 60 * 60);
    refresh(1_000_000 + 25 * 60 * 60 + 600);
    assert_eq!(download.calls.get(), 2, "a day later: one more download");

    // A fresh start the next day with a stored catalogue under a day old reads it from disk.
    let restarted = RecentCatalog::new(24 * 60 * 60, 60 * 60);
    let (restart_rise, _) = peak_rise(|| {
        let loaded = restarted
            .get(&cache, &download, 1_000_000 + 26 * 60 * 60)
            .unwrap();
        assert_eq!(loaded.source(), CatalogLoadSource::RecentCache);
    });
    assert_eq!(download.calls.get(), 2, "a restart inside the day downloads nothing");
    println!("refresh after a restart, from the stored copy: peak +{restart_rise} MiB");
    assert!(restart_rise < 160, "reading the stored copy peaked at +{restart_rise} MiB");

    // Responder scans: one per squad member per fissure, against a heap of 1,200 dirty runs of
    // 256 KiB each (300 MiB), with the production chunk size and budget.
    let heap = SyntheticHeap::new(1200, 256 * 1024);
    let candidate = RewardNeedle::from_paths(
        "Braton Prime Stock",
        vec!["/Lotus/Types/Recipes/Weapons/WeaponParts/BratonPrimeStock".into()],
    )
    .unwrap();
    let scanner = RewardMemoryScanner::new(256 * 1024, 768 * MIB, Duration::from_secs(30));
    let scan = || {
        scanner
            .resolve_records(
                &heap,
                &GameProcess::new(std::process::id()),
                std::slice::from_ref(&candidate),
                RewardRecordQuery {
                    responders: &["0123456789abcdef01234567"],
                    local_identity: None,
                    local_choice: None,
                },
                RewardRecordPolicy::LiveStructured,
            )
            .unwrap()
    };
    let (scan_rise, after_scan) = peak_rise(|| {
        for _ in 0..12 {
            scan();
        }
    });
    println!(
        "responder scans x12 over 1,200 dirty runs: peak +{scan_rise} MiB, rss after {} MiB",
        after_scan.rss_kb / 1024
    );
    // One shared chunk buffer: the scans' footprint no longer grows with the number of runs
    // (it was one 256 KiB buffer per run, +305 MiB here).
    assert!(scan_rise < 32, "responder scans peaked at +{scan_rise} MiB");

    let end = status();
    println!(
        "end: rss {} MiB, virtual {} MiB, threads {}",
        end.rss_kb / 1024,
        end.size_kb / 1024,
        end.threads
    );
}
