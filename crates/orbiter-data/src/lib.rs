//! Reads what TennoScope already keeps on disk and hands orbiter one compact bundle.
//!
//! Everything here is read-only. The SQLite file is opened with `SQLITE_OPEN_READ_ONLY` and only
//! the `inventory` and `snapshot_audit` tables are queried: TennoScope also stores a
//! warframe.market token in that file (`market_credential`), and orbiter never reads it.

pub mod ee_log;
pub mod reward_log;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

#[derive(Debug, thiserror::Error)]
pub enum DataError {
    #[error("TennoScope data folder not found at {0}. Open TennoScope once with Warframe running.")]
    MissingDir(PathBuf),
    #[error("could not read {path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("could not parse {path}: {source}")]
    Json { path: PathBuf, source: serde_json::Error },
    #[error("could not read TennoScope's database: {0}")]
    Db(#[from] rusqlite::Error),
}

#[derive(Serialize)]
pub struct InventoryRow {
    pub item_id: String,
    pub name: String,
    pub category: String,
    pub quantity: i64,
    pub mastered: bool,
    pub image_name: Option<String>,
    pub rank: Option<i64>,
    pub max_rank: Option<i64>,
}

/// Everything orbiter reads, in one piece: what `orbiter-dump` prints for the browser dev mode.
/// The window loads it in two parts instead, [`Collection`] on every reload and [`Catalogs`] only
/// when [`Collection::catalog_rev`] changes.
#[derive(Serialize)]
pub struct Bundle {
    /// Unix seconds of TennoScope's last inventory read, if it recorded one.
    pub observed_at: Option<i64>,
    pub inventory: Vec<InventoryRow>,
    /// Shared with the cache below: the catalogs only change when TennoScope fetches new ones,
    /// while the inventory changes every time it re-reads the game.
    pub catalog: Arc<Vec<Value>>,
    pub relics: Arc<Vec<Value>>,
    pub prices: Value,
}

/// What changes every time TennoScope re-reads the game (about 1 MB of JSON), sent on every
/// reload. The catalogs (about 6 MB) come separately, in [`Catalogs`].
#[derive(Serialize)]
pub struct Collection {
    /// Unix seconds of TennoScope's last inventory read, if it recorded one.
    pub observed_at: Option<i64>,
    pub inventory: Vec<InventoryRow>,
    pub prices: Value,
    /// Which catalog files are on disk (see [`Catalogs::rev`]): the window fetches the catalogs
    /// again only when this differs from the revision it holds. `None`: the files carry no
    /// modification time, so there is no telling; the window fetches them every time.
    pub catalog_rev: Option<String>,
}

/// The item catalog and relic table, slimmed. They change only when TennoScope fetches new
/// catalog files.
#[derive(Serialize)]
pub struct Catalogs {
    /// The state of the files these were read from, comparable with [`Collection::catalog_rev`].
    pub rev: Option<String>,
    pub catalog: Arc<Vec<Value>>,
    pub relics: Arc<Vec<Value>>,
}

/// A file's size and modification time: when either changes, the file changed.
#[derive(Clone, Copy, PartialEq)]
struct FileState {
    len: u64,
    modified: Option<SystemTime>,
}

fn file_state(path: &Path) -> Result<FileState, DataError> {
    let meta = fs::metadata(path).map_err(|source| DataError::Io { path: path.to_path_buf(), source })?;
    Ok(FileState { len: meta.len(), modified: meta.modified().ok() })
}

/// One string for the state of both catalog files, e.g. `"81234567.1729800000123456789-2345678.1729800000987654321"`.
/// A string, not a number: JavaScript numbers lose digits past 2^53.
fn catalog_rev(catalog: FileState, relics: FileState) -> Option<String> {
    let part = |f: FileState| {
        let nanos = f.modified?.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_nanos();
        Some(format!("{}.{nanos}", f.len))
    };
    Some(format!("{}-{}", part(catalog)?, part(relics)?))
}

const CATALOG_FILE: &str = "catalog/catalog-generation.json";
const RELICS_FILE: &str = "catalog/relic-generation.json";

/// A slimmed catalog and the file state it was read from.
struct Slimmed {
    path: PathBuf,
    state: FileState,
    items: Arc<Vec<Value>>,
}

static CATALOG: Mutex<Option<Slimmed>> = Mutex::new(None);
static RELICS: Mutex<Option<Slimmed>> = Mutex::new(None);

/// `read` of `path`, reused while the file's size and modification time stay the same. Reading
/// and slimming the ~80 MB catalog takes about a second and a few hundred MB at peak, and the
/// window reloads the bundle every time TennoScope writes its database.
/// Also returns the file state the items go with. A file rewritten between that check and the read
/// is reported with its older state, so the next check reads it again (and the window, seeing a new
/// revision, fetches it again).
fn cached(cache: &Mutex<Option<Slimmed>>, path: &Path, read: fn(&Path) -> Result<Vec<Value>, DataError>) -> Result<(Arc<Vec<Value>>, FileState), DataError> {
    let state = file_state(path)?;
    // Held while reading, so two reloads at once read the file once.
    let mut slot = cache.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = slot.as_ref() {
        if c.path == path && c.state == state && state.modified.is_some() {
            return Ok((Arc::clone(&c.items), state));
        }
    }
    let items = Arc::new(read(path)?);
    *slot = Some(Slimmed { path: path.to_path_buf(), state, items: Arc::clone(&items) });
    Ok((items, state))
}

/// `$XDG_DATA_HOME/io.github.deftera186.tennoscope`, falling back to `~/.local/share`.
pub fn default_tennoscope_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join("io.github.deftera186.tennoscope"))
}

fn ensure_dir(dir: &Path) -> Result<(), DataError> {
    if dir.is_dir() {
        Ok(())
    } else {
        Err(DataError::MissingDir(dir.to_path_buf()))
    }
}

/// The inventory and prices, and the revision of the catalog files beside them. Only stats the
/// catalog files: reading them is [`load_catalogs`]' job.
pub fn load_collection(dir: &Path) -> Result<Collection, DataError> {
    ensure_dir(dir)?;
    let catalog_rev = catalog_rev(file_state(&dir.join(CATALOG_FILE))?, file_state(&dir.join(RELICS_FILE))?);
    let (inventory, observed_at) = read_inventory(&dir.join("tennoscope.sqlite3"))?;
    let prices_path = dir.join("collection-prices.json");
    let prices = if prices_path.exists() {
        read_json(&prices_path)?
    } else {
        Value::Null
    };
    Ok(Collection { observed_at, inventory, prices, catalog_rev })
}

/// The slimmed item catalog and relic table, read again only when their files change.
pub fn load_catalogs(dir: &Path) -> Result<Catalogs, DataError> {
    ensure_dir(dir)?;
    let (catalog, catalog_state) = cached(&CATALOG, &dir.join(CATALOG_FILE), read_catalog)?;
    let (relics, relics_state) = cached(&RELICS, &dir.join(RELICS_FILE), read_relics)?;
    Ok(Catalogs { rev: catalog_rev(catalog_state, relics_state), catalog, relics })
}

/// Both parts in one: what `orbiter-dump` prints.
pub fn load_bundle(dir: &Path) -> Result<Bundle, DataError> {
    let Collection { observed_at, inventory, prices, .. } = load_collection(dir)?;
    let Catalogs { catalog, relics, .. } = load_catalogs(dir)?;
    Ok(Bundle { observed_at, inventory, catalog, relics, prices })
}

fn read_inventory(path: &Path) -> Result<(Vec<InventoryRow>, Option<i64>), DataError> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    // The window reloads right after TennoScope writes; wait out a write still in progress
    // instead of failing with "database is locked".
    conn.busy_timeout(Duration::from_secs(5))?;
    let mut stmt = conn.prepare(
        "SELECT item_id, name, category, quantity, mastered, image_name, rank, max_rank FROM inventory",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(InventoryRow {
                item_id: r.get(0)?,
                name: r.get(1)?,
                category: r.get(2)?,
                quantity: r.get(3)?,
                mastered: r.get::<_, i64>(4)? != 0,
                image_name: r.get(5)?,
                rank: r.get(6)?,
                max_rank: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let observed_at: Option<String> = conn
        .query_row("SELECT observed_at FROM snapshot_audit ORDER BY id DESC LIMIT 1", [], |r| r.get(0))
        .ok();
    Ok((rows, observed_at.and_then(|s| s.trim().parse().ok())))
}

fn read_json(path: &Path) -> Result<Value, DataError> {
    let text = fs::read(path).map_err(|source| DataError::Io { path: path.to_path_buf(), source })?;
    serde_json::from_slice(&text).map_err(|source| DataError::Json { path: path.to_path_buf(), source })
}

/// TennoScope wraps both catalogs as `{ fetched_unix, catalog: [...] }`.
fn catalog_entries(value: Value) -> Vec<Value> {
    match value {
        Value::Object(mut map) => match map.remove("catalog") {
            Some(Value::Array(items)) => items,
            _ => Vec::new(),
        },
        Value::Array(items) => items,
        _ => Vec::new(),
    }
}

const KEPT_CATEGORIES: &[&str] = &[
    "Warframes", "Primary", "Secondary", "Melee", "Arch-Gun", "Arch-Melee", "Archwing",
    "Sentinels", "Pets", "Misc", "Arcanes", "Mods",
];

const ITEM_FIELDS: &[&str] = &[
    "uniqueName", "name", "category", "type", "tradable", "masterable", "isPrime", "vaulted",
    "masteryReq", "rarity", "imageName", "productCategory", "excludeFromCodex", "marketCost",
    "bpCost", "isAugment", "wikiaUrl",
];

/// What the item details sheet shows: build cost and time, a warframe's stats and abilities, a
/// weapon's stats, and the riven disposition.
const DETAIL_FIELDS: &[&str] = &[
    "description", "buildPrice", "buildTime", "buildQuantity", "health", "shield", "armor", "power",
    "sprintSpeed", "polarities", "aura", "exilusPolarity", "passiveDescription", "criticalChance",
    "criticalMultiplier", "procChance", "fireRate", "totalDamage", "magazineSize", "reloadTime",
    "multishot", "accuracy", "trigger", "disposition", "omegaAttenuation", "slot", "releaseDate",
    "range", "followThrough", "blockingAngle", "comboDuration", "noise",
];

const COMPONENT_FIELDS: &[&str] = &["uniqueName", "name", "itemCount", "ducats", "tradable", "imageName"];

fn pick(src: &Map<String, Value>, fields: &[&str]) -> Map<String, Value> {
    fields
        .iter()
        .filter_map(|f| src.get(*f).map(|v| ((*f).to_string(), v.clone())))
        .collect()
}

/// Keeps the item categories orbiter looks at, and only the fields it reads. The full file is
/// ~80 MB, mostly skins, glyphs and patch logs.
fn read_catalog(path: &Path) -> Result<Vec<Value>, DataError> {
    let mut out = Vec::new();
    for item in catalog_entries(read_json(path)?) {
        let Value::Object(obj) = item else { continue };
        let category = obj.get("category").and_then(Value::as_str).unwrap_or("");
        if !KEPT_CATEGORIES.contains(&category) {
            continue;
        }
        let masterable = obj.get("masterable").and_then(Value::as_bool).unwrap_or(false);
        if category == "Misc" && !masterable {
            continue;
        }
        let mut slim = pick(&obj, ITEM_FIELDS);
        if masterable && category != "Mods" && category != "Arcanes" {
            slim.extend(pick(&obj, DETAIL_FIELDS));
            if let Some(Value::Array(abilities)) = obj.get("abilities") {
                let list: Vec<Value> = abilities
                    .iter()
                    .filter_map(Value::as_object)
                    .map(|a| Value::Object(pick(a, &["name", "description", "imageName"])))
                    .collect();
                slim.insert("abilities".into(), Value::Array(list));
            }
            // Damage by type, only the types it deals.
            if let Some(Value::Object(damage)) = obj.get("damage") {
                let dealt: Map<String, Value> = damage
                    .iter()
                    .filter(|(k, v)| k.as_str() != "total" && v.as_f64().is_some_and(|x| x > 0.0))
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect();
                if !dealt.is_empty() {
                    slim.insert("damage".into(), Value::Object(dealt));
                }
            }
        }
        // The rank a mod or arcane fuses to. `fusionLimit` is the game's number; `levelStats` can
        // carry extra entries (Plexus and archwing mods list 14 for a rank-10 mod).
        if let Some(limit) = obj.get("fusionLimit").and_then(Value::as_u64) {
            slim.insert("maxRank".into(), Value::from(limit));
        } else if let Some(Value::Array(stats)) = obj.get("levelStats") {
            slim.insert("maxRank".into(), Value::from(stats.len().saturating_sub(1)));
        }
        if let Some(Value::Array(components)) = obj.get("components") {
            let comps: Vec<Value> = components
                .iter()
                .filter_map(Value::as_object)
                .map(|c| {
                    let mut sc = pick(c, COMPONENT_FIELDS);
                    sc.insert("drops".into(), Value::Array(slim_drops(c.get("drops"))));
                    Value::Object(sc)
                })
                .collect();
            slim.insert("components".into(), Value::Array(comps));
        }
        if category == "Arcanes" || category == "Mods" {
            slim.insert("drops".into(), Value::Array(slim_drops(obj.get("drops"))));
            // What it does at max rank, for hover cards ("+165% Damage").
            if let Some(Value::Array(levels)) = obj.get("levelStats") {
                if let Some(Value::Array(stats)) = levels.last().and_then(|l| l.get("stats")) {
                    let lines: Vec<Value> = stats.iter().filter_map(Value::as_str).map(|t| Value::from(t.replace("\\n", "\n"))).collect();
                    slim.insert("maxStats".into(), Value::Array(lines));
                }
            }
            slim.extend(pick(&obj, &["polarity", "baseDrain", "compatName"]));
        }
        // A riven type's stats: each tag's base value, label and name syllables, to read the
        // game's riven fingerprints.
        if let (true, Some(Value::Array(entries))) = (obj.get("uniqueName").and_then(Value::as_str).is_some_and(|u| u.contains("/Randomized/")), obj.get("upgradeEntries")) {
            let list: Vec<Value> = entries
                .iter()
                .filter_map(|e| {
                    let v = e.get("upgradeValues")?.get(0)?;
                    Some(serde_json::json!({
                        "tag": e.get("tag")?, "value": v.get("value")?, "locTag": v.get("locTag"),
                        "prefix": e.get("prefixTag"), "suffix": e.get("suffixTag"),
                    }))
                })
                .collect();
            slim.insert("rivenStats".into(), Value::Array(list));
        }
        out.push(Value::Object(slim));
    }
    Ok(out)
}

/// Drop sources, deduplicated by location, at most 8 per item, best chance first.
fn slim_drops(drops: Option<&Value>) -> Vec<Value> {
    let Some(Value::Array(list)) = drops else { return Vec::new() };
    let mut seen: Vec<(String, f64, String)> = Vec::new();
    for d in list.iter().filter_map(Value::as_object) {
        let loc = d.get("location").and_then(Value::as_str).unwrap_or("").to_string();
        if loc.is_empty() {
            continue;
        }
        let chance = d.get("chance").and_then(Value::as_f64).unwrap_or(0.0);
        let rarity = d.get("rarity").and_then(Value::as_str).unwrap_or("").to_string();
        match seen.iter_mut().find(|(l, ..)| *l == loc) {
            Some(entry) if entry.1 < chance => entry.1 = chance,
            Some(_) => {}
            None => seen.push((loc, chance, rarity)),
        }
    }
    seen.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    seen.into_iter()
        .take(8)
        .map(|(location, chance, rarity)| {
            serde_json::json!({ "location": location, "chance": chance, "rarity": rarity })
        })
        .collect()
}

fn read_relics(path: &Path) -> Result<Vec<Value>, DataError> {
    let mut out = Vec::new();
    for item in catalog_entries(read_json(path)?) {
        let Value::Object(obj) = item else { continue };
        let mut slim = pick(&obj, &["uniqueName", "name", "vaulted", "tradable", "imageName"]);
        // Where the relic itself drops (best chance first), for "where to farm it".
        slim.insert("drops".into(), Value::Array(slim_drops(obj.get("drops"))));
        let rewards: Vec<Value> = obj
            .get("rewards")
            .and_then(Value::as_array)
            .map(|rs| {
                rs.iter()
                    .filter_map(Value::as_object)
                    .map(|r| {
                        let name = r
                            .get("item")
                            .and_then(|i| i.get("name"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        serde_json::json!({
                            "name": name,
                            "rarity": r.get("rarity").cloned().unwrap_or(Value::Null),
                            "chance": r.get("chance").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        slim.insert("rewards".into(), Value::Array(rewards));
        out.push(Value::Object(slim));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("orbiter-data-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("catalog")).unwrap();
        dir
    }

    #[test]
    fn a_catalog_is_read_again_only_when_the_file_changes() {
        let dir = temp_dir("cache");
        let path = dir.join("catalog/catalog-generation.json");
        let cache = Mutex::new(None);
        fs::write(&path, r#"{"fetched_unix": 1, "catalog": [{"uniqueName": "/A", "name": "A", "category": "Primary"}]}"#).unwrap();
        let (first, _) = cached(&cache, &path, read_catalog).unwrap();
        let (again, _) = cached(&cache, &path, read_catalog).unwrap();
        assert!(Arc::ptr_eq(&first, &again), "same file: the slimmed copy is reused");
        fs::write(&path, r#"{"fetched_unix": 2, "catalog": [{"uniqueName": "/A", "name": "A", "category": "Primary"}, {"uniqueName": "/B", "name": "B", "category": "Melee"}]}"#).unwrap();
        let (fresh, _) = cached(&cache, &path, read_catalog).unwrap();
        assert_eq!(fresh.len(), 2);
        fs::remove_dir_all(&dir).ok();
    }

    fn write_db(dir: &Path) {
        let db = Connection::open(dir.join("tennoscope.sqlite3")).unwrap();
        db.execute_batch(
            "CREATE TABLE inventory (item_id TEXT, name TEXT, category TEXT, quantity INTEGER, mastered INTEGER, image_name TEXT, rank INTEGER, max_rank INTEGER);
             CREATE TABLE snapshot_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, observed_at TEXT, game_build TEXT, source TEXT, item_count INTEGER);
             INSERT INTO inventory VALUES ('/Lotus/A', 'A', 'Mods', 2, 1, NULL, 3, 10);
             INSERT INTO snapshot_audit (observed_at, game_build, source, item_count) VALUES ('1792945000', 'x', 'y', 1);",
        )
        .unwrap();
    }

    #[test]
    fn the_collection_carries_the_catalog_revision_but_not_the_catalogs() {
        let dir = temp_dir("split");
        write_db(&dir);
        fs::write(dir.join(CATALOG_FILE), r#"{"catalog": [{"uniqueName": "/A", "name": "A", "category": "Primary"}]}"#).unwrap();
        fs::write(dir.join(RELICS_FILE), r#"{"catalog": []}"#).unwrap();

        let light = load_collection(&dir).unwrap();
        let rev = light.catalog_rev.clone().expect("files with a modification time have a revision");
        let json = serde_json::to_value(&light).unwrap();
        assert!(json.get("catalog").is_none() && json.get("relics").is_none(), "no catalog in the reload");
        assert_eq!(json["inventory"][0]["item_id"], "/Lotus/A");

        let cats = load_catalogs(&dir).unwrap();
        assert_eq!(cats.rev.as_deref(), Some(rev.as_str()), "the catalogs say which revision they are");
        assert_eq!(cats.catalog[0]["name"], "A");
        assert_eq!(load_collection(&dir).unwrap().catalog_rev.as_deref(), Some(rev.as_str()), "unchanged files, same revision");

        // TennoScope fetched a new catalog (a different size, so it differs even where the clock is coarse).
        fs::write(dir.join(CATALOG_FILE), r#"{"catalog": [{"uniqueName": "/A", "name": "A", "category": "Primary"}, {"uniqueName": "/B", "name": "B", "category": "Melee"}]}"#).unwrap();
        let next = load_collection(&dir).unwrap().catalog_rev.unwrap();
        assert_ne!(next, rev);
        let cats = load_catalogs(&dir).unwrap();
        assert_eq!(cats.rev.as_deref(), Some(next.as_str()));
        assert_eq!(cats.catalog.len(), 2);

        // A new relic table changes it too.
        fs::write(dir.join(RELICS_FILE), r#"{"catalog": [{"uniqueName": "/R", "name": "Axi A1 Relic"}]}"#).unwrap();
        assert_ne!(load_collection(&dir).unwrap().catalog_rev.unwrap(), next);

        assert!(matches!(load_catalogs(&dir.join("nope")), Err(DataError::MissingDir(_))));
        assert!(matches!(load_collection(&dir.join("nope")), Err(DataError::MissingDir(_))));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_modification_time_means_no_revision() {
        let known = FileState { len: 3, modified: Some(SystemTime::UNIX_EPOCH + Duration::from_nanos(1_500)) };
        assert_eq!(catalog_rev(known, known).as_deref(), Some("3.1500-3.1500"));
        assert_eq!(catalog_rev(known, FileState { len: 3, modified: None }), None);
    }

    #[test]
    fn loads_a_bundle_from_a_tennoscope_folder() {
        let dir = temp_dir("bundle");
        write_db(&dir);
        fs::write(dir.join("catalog/catalog-generation.json"), r#"{"catalog": []}"#).unwrap();
        fs::write(dir.join("catalog/relic-generation.json"), r#"{"catalog": [{"uniqueName": "/R", "name": "Axi A1 Relic", "rewards": [{"item": {"name": "Forma Blueprint"}, "rarity": "Common", "chance": 25.33}]}]}"#).unwrap();
        let b = load_bundle(&dir).unwrap();
        assert_eq!(b.observed_at, Some(1_792_945_000));
        assert_eq!(b.inventory.len(), 1);
        assert!(b.inventory[0].mastered);
        assert_eq!(b.relics[0]["rewards"][0]["name"], "Forma Blueprint");
        assert_eq!(b.prices, Value::Null);
        assert!(matches!(load_bundle(&dir.join("nope")), Err(DataError::MissingDir(_))));
        fs::remove_dir_all(&dir).ok();
    }
}
