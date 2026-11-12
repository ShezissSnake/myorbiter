//! Reads what TennoScope already keeps on disk and hands MyOrbiter one compact bundle.
//!
//! Everything here is read-only. The SQLite file is opened with `SQLITE_OPEN_READ_ONLY` and only
//! the `inventory` and `snapshot_audit` tables are queried: TennoScope also stores a
//! warframe.market token in that file (`market_credential`), and MyOrbiter never reads it.

pub mod ee_log;
pub mod reward_log;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{Map, Value};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

#[derive(Debug, thiserror::Error)]
pub enum DataError {
    #[error("TennoScope data folder not found at {0}. Open TennoScope once with Warframe running.")]
    MissingDir(PathBuf),
    /// A file TennoScope hasn't written yet (its item data arrives once it's set up). Told apart
    /// from other read errors by the error kind, not its wording: Windows says "path not found"
    /// (os error 3) where Linux says "no such file" (os error 2).
    #[error("not found at {0}: TennoScope hasn't written it yet")]
    MissingFile(PathBuf),
    #[error("could not read {path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("could not parse {path}: {source}")]
    Json { path: PathBuf, source: serde_json::Error },
    #[error("could not read TennoScope's database: {0}")]
    Db(#[from] rusqlite::Error),
}

fn io_error(path: &Path, source: std::io::Error) -> DataError {
    if source.kind() == std::io::ErrorKind::NotFound {
        DataError::MissingFile(path.to_path_buf())
    } else {
        DataError::Io { path: path.to_path_buf(), source }
    }
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
    /// Copies installed in a build (a stance on a weapon, a Requiem mod on the Parazon), which
    /// can't be traded. Left out when TennoScope's store has no such column or didn't say.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equipped: Option<i64>,
}

/// Everything MyOrbiter reads, in one piece: what `myorbiter-dump` prints for the browser dev mode.
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
    let meta = fs::metadata(path).map_err(|source| io_error(path, source))?;
    Ok(FileState { len: meta.len(), modified: meta.modified().ok() })
}

/// One string for the state of both catalog files, e.g. `"81234567.1729800000123456789-2345678.1729800000987654321"`.
/// A string, not a number: JavaScript numbers lose digits past 2^53.
/// No relic table at all reads as `none`: one turning up later changes the revision.
fn catalog_rev(catalog: FileState, relics: Option<FileState>) -> Option<String> {
    let part = |f: FileState| {
        let nanos = f.modified?.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_nanos();
        Some(format!("{}.{nanos}", f.len))
    };
    let relics = match relics {
        Some(r) => part(r)?,
        None => "none".to_string(),
    };
    Some(format!("{}-{relics}", part(catalog)?))
}

/// The relic table to read: TennoScope's own (`catalog/relic-generation.json`), or else `fallback`,
/// the tables MyOrbiter hands TennoScope from the official drop tables (bridge.rs, the same WFCD
/// shape). TennoScope writes its own only when it fetches the list itself, which it doesn't while
/// MyOrbiter gives it the tables, so a new install started by MyOrbiter never has one. Neither:
/// None, and the inventory still loads (the relic pages go without until there is one).
pub fn relics_path(dir: &Path, fallback: Option<&Path>) -> Option<PathBuf> {
    let own = dir.join(RELICS_FILE);
    if own.is_file() {
        return Some(own);
    }
    fallback.filter(|f| f.is_file()).map(Path::to_path_buf)
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
/// and slimming the ~80 MB catalog takes most of a second, and the
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

/// TennoScope's folder: where Tauri keeps app data for its identifier. On Linux
/// `$XDG_DATA_HOME/io.github.deftera186.tennoscope` (falling back to `~/.local/share`), on Windows
/// `%APPDATA%\io.github.deftera186.tennoscope`, on macOS `~/Library/Application Support/…`.
pub fn default_tennoscope_dir() -> Option<PathBuf> {
    Some(data_home()?.join("io.github.deftera186.tennoscope"))
}

#[cfg(windows)]
fn data_home() -> Option<PathBuf> {
    std::env::var_os("APPDATA").filter(|v| !v.is_empty()).map(PathBuf::from)
}
#[cfg(target_os = "macos")]
fn data_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
}
#[cfg(not(any(windows, target_os = "macos")))]
fn data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
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
    load_collection_with(dir, None)
}

/// [`load_collection`], with the relic table to use when TennoScope hasn't written its own
/// ([`relics_path`]).
pub fn load_collection_with(dir: &Path, relics_fallback: Option<&Path>) -> Result<Collection, DataError> {
    ensure_dir(dir)?;
    let relics = relics_path(dir, relics_fallback).map(|p| file_state(&p)).transpose()?;
    let catalog_rev = catalog_rev(file_state(&dir.join(CATALOG_FILE))?, relics);
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
    load_catalogs_with(dir, None)
}

/// [`load_catalogs`], with the relic table to use when TennoScope hasn't written its own.
pub fn load_catalogs_with(dir: &Path, relics_fallback: Option<&Path>) -> Result<Catalogs, DataError> {
    ensure_dir(dir)?;
    let (catalog, catalog_state) = cached(&CATALOG, &dir.join(CATALOG_FILE), read_catalog)?;
    let (relics, relics_state) = match relics_path(dir, relics_fallback) {
        Some(p) => {
            let (r, state) = cached(&RELICS, &p, read_relics)?;
            (r, Some(state))
        }
        None => (Arc::new(Vec::new()), None),
    };
    Ok(Catalogs { rev: catalog_rev(catalog_state, relics_state), catalog, relics })
}

/// Both parts in one: what `myorbiter-dump` prints.
pub fn load_bundle(dir: &Path) -> Result<Bundle, DataError> {
    let Collection { observed_at, inventory, prices, .. } = load_collection(dir)?;
    let Catalogs { catalog, relics, .. } = load_catalogs(dir)?;
    Ok(Bundle { observed_at, inventory, catalog, relics, prices })
}

fn read_inventory(path: &Path) -> Result<(Vec<InventoryRow>, Option<i64>), DataError> {
    if !path.is_file() {
        return Err(DataError::MissingFile(path.to_path_buf()));
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    // The window reloads right after TennoScope writes; wait out a write still in progress
    // instead of failing with "database is locked".
    conn.busy_timeout(Duration::from_secs(5))?;
    // One read transaction for the rows and the read's time: TennoScope writes both in one
    // transaction, and two separate reads could straddle it, pairing the old rows with the new
    // read's time (the keep rules trust an inventory by that time).
    let tx = conn.unchecked_transaction()?;
    // Installed copies are a newer column: an older store hasn't got it, and is read without.
    let has_equipped = tx
        .prepare("SELECT 1 FROM pragma_table_info('inventory') WHERE name = 'equipped'")
        .and_then(|mut s| s.exists([]))
        .unwrap_or(false);
    let mut stmt = tx.prepare(if has_equipped {
        "SELECT item_id, name, category, quantity, mastered, image_name, rank, max_rank, equipped FROM inventory"
    } else {
        "SELECT item_id, name, category, quantity, mastered, image_name, rank, max_rank, NULL FROM inventory"
    })?;
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
                equipped: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    let observed_at: Option<String> = tx
        .query_row("SELECT observed_at FROM snapshot_audit ORDER BY id DESC LIMIT 1", [], |r| r.get(0))
        .ok();
    // Read only: nothing to keep, and a read-only connection can't commit a write anyway.
    drop(tx);
    Ok((rows, observed_at.and_then(|s| s.trim().parse().ok())))
}

fn read_json(path: &Path) -> Result<Value, DataError> {
    let text = fs::read(path).map_err(|source| io_error(path, source))?;
    serde_json::from_slice(&text).map_err(|source| DataError::Json { path: path.to_path_buf(), source })
}

/// TennoScope wraps both catalogs as `{ fetched_unix, catalog: [...] }`.
#[derive(Deserialize)]
struct Wrapped<'a> {
    #[serde(borrow, default)]
    catalog: Vec<&'a RawValue>,
}

/// What an entry is, read before the rest of it.
#[derive(Deserialize)]
struct Head<'a> {
    #[serde(borrow, default, rename = "uniqueName")]
    unique_name: Option<Cow<'a, str>>,
    #[serde(borrow, default)]
    category: Option<Cow<'a, str>>,
    #[serde(default)]
    masterable: Option<bool>,
}

impl Head<'_> {
    /// Masterable, by the catalog's flag or because the game gives mastery by it anyway.
    fn masterable(&self) -> bool {
        self.masterable.unwrap_or(false) || self.unique_name.as_deref().is_some_and(masterable_part)
    }
}

/// Parts the game gives mastery by although the catalog marks them not masterable: an amp's prism
/// (the Mote Amp's included) and the Infested kitgun chambers. Mastery goes by that part once the
/// amp or kitgun built from it is gilded, as for the Solaris chambers the catalog already marks.
/// Their blueprints, scaffolds and braces give none. (TennoScope, patched, says the same.)
fn masterable_part(path: &str) -> bool {
    !path.ends_with("Blueprint")
        && ((path.contains("/OperatorAmplifiers/") && (path.contains("/Barrel/") || path.ends_with("/SentAmpTrainingBarrel")))
            || path.contains("/InfKitGun/Barrels/"))
}

/// The entries of a catalog file that `keep` wants, each with only `fields`. Most of the ~80 MB
/// item catalog is skins, glyphs and patch logs: those are only scanned, never built, which reads
/// it in about half the time of building the whole file and picking from it.
fn catalog_entries(path: &Path, keep: fn(&Head) -> bool, fields: &[&str]) -> Result<Vec<Map<String, Value>>, DataError> {
    let bytes = fs::read(path).map_err(|source| io_error(path, source))?;
    let json = |source| DataError::Json { path: path.to_path_buf(), source };
    let raw: Vec<&RawValue> = match serde_json::from_slice::<Wrapped>(&bytes) {
        Ok(w) => w.catalog,
        Err(first) => serde_json::from_slice(&bytes).map_err(|_| json(first))?,
    };
    let mut out = Vec::new();
    for entry in raw {
        let Ok(head) = serde_json::from_str::<Head>(entry.get()) else { continue };
        if !keep(&head) {
            continue;
        }
        let parts: std::collections::HashMap<Cow<str>, &RawValue> = serde_json::from_str(entry.get()).map_err(json)?;
        let mut obj = Map::new();
        for f in fields {
            if let Some(v) = parts.get(*f) {
                obj.insert((*f).to_string(), serde_json::from_str(v.get()).map_err(json)?);
            }
        }
        if head.masterable() && obj.get("masterable") != Some(&Value::Bool(true)) {
            obj.insert("masterable".into(), Value::Bool(true));
        }
        out.push(obj);
    }
    Ok(out)
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
    "sprintSpeed", "polarities", "aura", "exilusPolarity", "stancePolarity", "passiveDescription", "criticalChance",
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

/// Every field of an entry [`read_catalog`] looks at.
const READ_FIELDS: &[&str] = &[
    "abilities", "damage", "fusionLimit", "levelStats", "components", "drops", "polarity", "baseDrain",
    "compatName", "upgradeEntries", "isUtility",
];

/// The item categories MyOrbiter looks at: of Misc, only what counts for mastery (kitgun chambers,
/// amp prisms, K-Drive boards).
fn kept_item(head: &Head) -> bool {
    let category = head.category.as_deref().unwrap_or("");
    KEPT_CATEGORIES.contains(&category) && (category != "Misc" || head.masterable())
}

/// Keeps the item categories MyOrbiter looks at, and only the fields it reads. The full file is
/// ~80 MB, mostly skins, glyphs and patch logs.
fn read_catalog(path: &Path) -> Result<Vec<Value>, DataError> {
    let fields: Vec<&str> = [ITEM_FIELDS, DETAIL_FIELDS, READ_FIELDS].concat();
    let mut out = Vec::new();
    for obj in catalog_entries(path, kept_item, &fields)? {
        let category = obj.get("category").and_then(Value::as_str).unwrap_or("");
        let masterable = obj.get("masterable").and_then(Value::as_bool).unwrap_or(false);
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
            // `isUtility`: the mod fits the exilus slot.
            slim.extend(pick(&obj, &["polarity", "baseDrain", "compatName", "isUtility"]));
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
    for obj in catalog_entries(path, |_| true, &["uniqueName", "name", "vaulted", "tradable", "imageName", "drops", "rewards"])? {
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

    /// A TennoScope that has started but not been set up: a folder, no database, no item data.
    /// Reported as "not found at", the words the window reads as "not set up yet", on every
    /// system (Windows' own error for a missing folder is worded differently from Linux's).
    #[test]
    fn missing_files_are_reported_as_not_written_yet() {
        let dir = std::env::temp_dir().join(format!("myorbiter-fresh-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let err = load_collection(&dir).err().expect("nothing to read").to_string();
        assert!(err.starts_with("not found at"), "{err}");
        let err = load_catalogs(&dir).err().expect("nothing to read").to_string();
        assert!(err.starts_with("not found at"), "{err}");
        fs::remove_dir_all(&dir).unwrap();
    }
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("myorbiter-data-{tag}-{}", std::process::id()));
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
    fn installed_copies_are_read_when_the_store_has_them() {
        let old = temp_dir("no-equipped");
        write_db(&old);
        let (rows, _) = read_inventory(&old.join("tennoscope.sqlite3")).unwrap();
        assert_eq!(rows[0].equipped, None, "an older store: unknown, and left out of the JSON");
        assert!(serde_json::to_value(&rows[0]).unwrap().get("equipped").is_none());
        fs::remove_dir_all(&old).ok();

        let dir = temp_dir("equipped");
        let db = Connection::open(dir.join("tennoscope.sqlite3")).unwrap();
        db.execute_batch(
            "CREATE TABLE inventory (item_id TEXT, name TEXT, category TEXT, quantity INTEGER, mastered INTEGER, image_name TEXT, rank INTEGER, max_rank INTEGER, equipped INTEGER);
             INSERT INTO inventory VALUES ('/Lotus/Weapons/Tenno/Melee/MeleeTrees/PolearmCmbTwoMeleeTree', 'Bleeding Willow', 'mod', 6, 0, NULL, NULL, NULL, 5);
             INSERT INTO inventory VALUES ('/Lotus/A', 'A', 'mod', 2, 0, NULL, NULL, NULL, NULL);",
        )
        .unwrap();
        drop(db);
        let (rows, _) = read_inventory(&dir.join("tennoscope.sqlite3")).unwrap();
        let willow = rows.iter().find(|r| r.name == "Bleeding Willow").unwrap();
        assert_eq!((willow.quantity, willow.equipped), (6, Some(5)));
        assert_eq!(serde_json::to_value(willow).unwrap()["equipped"], 5);
        assert_eq!(rows.iter().find(|r| r.name == "A").unwrap().equipped, None);
        fs::remove_dir_all(&dir).ok();
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

    /// A new install that MyOrbiter started: TennoScope read the inventory and wrote its database
    /// and item catalog, but never its own relic table (MyOrbiter gives it one). The inventory
    /// loads all the same: with MyOrbiter's relic tables when they're there, with none otherwise.
    #[test]
    fn the_inventory_loads_without_tennoscope_s_own_relic_table() {
        let dir = temp_dir("no-relics");
        write_db(&dir);
        fs::write(dir.join(CATALOG_FILE), r#"{"catalog": [{"uniqueName": "/A", "name": "A", "category": "Primary"}]}"#).unwrap();
        assert!(!dir.join(RELICS_FILE).exists());

        // Neither table: the inventory all the same, and no relics.
        let light = load_collection_with(&dir, None).expect("the inventory is there");
        assert_eq!(light.inventory.len(), 1);
        let bare = light.catalog_rev.clone().unwrap();
        assert!(bare.ends_with("-none"), "{bare}");
        let cats = load_catalogs_with(&dir, None).unwrap();
        assert!(cats.relics.is_empty());
        assert_eq!(cats.rev.as_deref(), Some(bare.as_str()));

        // MyOrbiter's tables, as bridge.rs writes them for TennoScope (a plain list).
        let ours = dir.join("orbiter-relics.json");
        fs::write(&ours, r#"[{"uniqueName": "/Lotus/Types/Game/Projections/T1VoidProjectionA1", "name": "Lith A1 Intact", "vaulted": false, "rewards": [{"rarity": "Rare", "chance": 2, "item": {"name": "Akstiletto Prime Barrel"}}]}]"#).unwrap();
        let with = load_collection_with(&dir, Some(&ours)).unwrap();
        assert_ne!(with.catalog_rev.as_deref(), Some(bare.as_str()), "a table turning up is a new revision");
        let cats = load_catalogs_with(&dir, Some(&ours)).unwrap();
        assert_eq!(cats.relics.len(), 1);
        assert_eq!(cats.relics[0]["rewards"][0]["name"], "Akstiletto Prime Barrel");

        // TennoScope's own wins once it writes one.
        fs::write(dir.join(RELICS_FILE), r#"{"catalog": [{"uniqueName": "/R", "name": "Axi A1 Relic"}, {"uniqueName": "/S", "name": "Axi A2 Relic"}]}"#).unwrap();
        assert_eq!(load_catalogs_with(&dir, Some(&ours)).unwrap().relics.len(), 2);
        assert_eq!(relics_path(&dir, Some(&ours)), Some(dir.join(RELICS_FILE)));
        assert_eq!(relics_path(&dir.join("nope"), Some(&dir.join("absent.json"))), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn amp_prisms_and_infested_chambers_are_kept_as_masterable_with_their_parts() {
        let dir = temp_dir("modular");
        let path = dir.join("catalog/catalog-generation.json");
        let comps = r#""components": [{"uniqueName": "/X/Blueprint", "name": "Blueprint", "itemCount": 1}]"#;
        fs::write(
            &path,
            format!(
                r#"{{"catalog": [
                  {{"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartA", "name": "Raplak Prism", "category": "Misc", "type": "Amp", "masterable": false, {comps}}},
                  {{"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingBarrel", "name": "Mote Prism", "category": "Misc", "type": "Amp", "masterable": false}},
                  {{"uniqueName": "/Lotus/Weapons/Infested/Pistols/InfKitGun/Barrels/InfBarrelEgg/InfModularBarrelEggPart", "name": "Sporelacer", "category": "Misc", "type": "Pistol", "masterable": false, {comps}}},
                  {{"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Chassis/SentAmpSet1ChassisPartA", "name": "Pencha Scaffold", "category": "Misc", "type": "Amp", "masterable": false}},
                  {{"uniqueName": "/Lotus/Types/Vehicles/Hoverboard/HoverboardParts/PartComponents/HoverboardSolarisA/HoverboardSolarisADeck", "name": "Bad Baby", "category": "Misc", "type": "K-Drive Component", "masterable": true}}
                ]}}"#
            ),
        )
        .unwrap();
        let items = read_catalog(&path).unwrap();
        let names: Vec<&str> = items.iter().filter_map(|i| i["name"].as_str()).collect();
        assert_eq!(names, ["Raplak Prism", "Mote Prism", "Sporelacer", "Bad Baby"], "the scaffold gives no mastery");
        assert!(items.iter().all(|i| i["masterable"] == Value::Bool(true)));
        assert_eq!(items[0]["components"][0]["name"], "Blueprint", "with what building it takes");
        assert!(!masterable_part("/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartABlueprint"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_melee_weapon_keeps_its_stance_polarity_and_a_mod_whether_it_fits_the_exilus_slot() {
        let dir = temp_dir("slots");
        let path = dir.join("catalog/catalog-generation.json");
        fs::write(
            &path,
            r#"{"catalog": [
              {"uniqueName": "/Lotus/Weapons/Tenno/Melee/Swords/GreatSword/TennoGreatSword", "name": "Galatine", "category": "Melee", "type": "Melee", "masterable": true, "polarities": ["naramon"], "stancePolarity": "vazarin"},
              {"uniqueName": "/Lotus/Upgrades/Mods/Warframe/AvatarKnockdownResistanceMod", "name": "Handspring", "category": "Mods", "type": "Warframe Mod", "polarity": "vazarin", "baseDrain": 2, "isUtility": true},
              {"uniqueName": "/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod", "name": "Vitality", "category": "Mods", "type": "Warframe Mod", "polarity": "vazarin", "baseDrain": 2}
            ]}"#,
        )
        .unwrap();
        let items = read_catalog(&path).unwrap();
        assert_eq!(items[0]["stancePolarity"], "vazarin");
        assert_eq!(items[1]["isUtility"], Value::Bool(true));
        assert!(items[2].get("isUtility").is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_modification_time_means_no_revision() {
        let known = FileState { len: 3, modified: Some(SystemTime::UNIX_EPOCH + Duration::from_nanos(1_500)) };
        assert_eq!(catalog_rev(known, Some(known)).as_deref(), Some("3.1500-3.1500"));
        assert_eq!(catalog_rev(known, Some(FileState { len: 3, modified: None })), None);
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
