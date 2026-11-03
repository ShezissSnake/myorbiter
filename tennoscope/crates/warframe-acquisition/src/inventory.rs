use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::Read,
    time::Duration,
};

use reqwest::{blocking::Client, redirect::Policy};
use serde::Deserialize;
use url::Url;
use warframe_domain::{CatalogItem, Category, InventoryEntry, InventorySnapshot, ItemId};

use crate::{
    AcquisitionError, CatalogIndex, InventoryAuthorization, InventoryTransport, SnapshotDecoder,
};

pub const INVENTORY_ENDPOINT: &str = "https://mobile.warframe.com/api/inventory.php";
pub const MAX_INVENTORY_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(20);

/// Blocking HTTPS adapter for the one pinned Warframe inventory endpoint.
///
/// Redirects are rejected so credentials in the query cannot be forwarded to
/// another origin. The returned bytes exist only in the caller's memory.
pub struct InventoryHttpTransport {
    client: Client,
}

impl InventoryHttpTransport {
    pub fn new() -> Result<Self, AcquisitionError> {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TOTAL_TIMEOUT)
            .redirect(Policy::none())
            .build()
            .map_err(|_| AcquisitionError::InventoryRequestFailed)?;
        Ok(Self { client })
    }

    pub const fn connect_timeout(&self) -> Duration {
        CONNECT_TIMEOUT
    }

    pub const fn total_timeout(&self) -> Duration {
        TOTAL_TIMEOUT
    }

    pub const fn response_limit(&self) -> usize {
        MAX_INVENTORY_RESPONSE_BYTES
    }

    pub const fn follows_redirects(&self) -> bool {
        false
    }
}

impl InventoryTransport for InventoryHttpTransport {
    fn fetch(&self, authorization: &InventoryAuthorization) -> Result<Vec<u8>, AcquisitionError> {
        let mut url =
            Url::parse(INVENTORY_ENDPOINT).map_err(|_| AcquisitionError::InventoryRequestFailed)?;
        if url.scheme() != "https" || url.host_str() != Some("mobile.warframe.com") {
            return Err(AcquisitionError::InventoryRequestFailed);
        }
        url.query_pairs_mut()
            .append_pair("accountId", authorization.account_id())
            .append_pair("nonce", authorization.nonce());

        let response = self
            .client
            .get(url)
            .send()
            .map_err(|_| AcquisitionError::InventoryRequestFailed)?;
        if !response.status().is_success() {
            return Err(AcquisitionError::InventoryRequestFailed);
        }

        read_bounded(response, MAX_INVENTORY_RESPONSE_BYTES)
    }
}

fn read_bounded(reader: impl Read, limit: usize) -> Result<Vec<u8>, AcquisitionError> {
    let limit_u64 = u64::try_from(limit).map_err(|_| AcquisitionError::InventoryRequestFailed)?;
    let mut bytes = Vec::new();
    reader
        .take(limit_u64.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| AcquisitionError::InventoryRequestFailed)?;
    if bytes.len() > limit {
        return Err(AcquisitionError::InventoryResponseTooLarge);
    }
    Ok(bytes)
}

#[derive(Default)]
pub struct InventoryJsonDecoder<'a> {
    catalog: Option<&'a CatalogIndex>,
}

impl<'a> InventoryJsonDecoder<'a> {
    pub const fn with_catalog(catalog: &'a CatalogIndex) -> Self {
        Self {
            catalog: Some(catalog),
        }
    }
}

/// What the inventory says that the snapshot does not keep: affinity per item, and builds
/// waiting in the foundry. Held in memory for this run only; never persisted.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct MasteryFacts {
    xp: BTreeMap<String, u64>,
    pending: BTreeMap<String, u32>,
    /// What only orbiter reads, boxed so the facts (and every result carrying them) stay small.
    orbiter: Box<OrbiterFacts>,
}

/// The inventory facts orbiter reads beyond TennoScope's own.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct OrbiterFacts {
    /// When each foundry build finishes (recipe path, unix milliseconds), for orbiter.
    ready: Vec<(String, i64)>,
    /// The account's mastery rank, for orbiter.
    player_level: Option<u32>,
    /// Platinum on the account, for orbiter's value-over-time chart.
    platinum: Option<u64>,
    /// Credits and Endo on the account, for orbiter's stats over time.
    credits: Option<u64>,
    endo: Option<u64>,
    /// Unveiled rivens as the inventory gives them: type, item id and the parsed fingerprint
    /// (weapon, buffs, curses, rank, rerolls, polarity), passed through whole for orbiter.
    rivens: Vec<serde_json::Value>,
    /// Kubrow and Kavat imprints as the inventory gives them, passed through whole for orbiter.
    imprints: Vec<serde_json::Value>,
    /// One row per copy of a warframe, weapon or companion: `{type, f, p, s}`, its path, the game's
    /// feature bits (Orokin Catalyst/Reactor, Exilus, gilded, Incarnon Genesis installed…), its
    /// Forma and its inventory section; `m`, a modular build's parts, and `x`, its affinity. Also,
    /// when the copy has them: `pol`, its slots' polarities, `[slot, "AP_…"]`; `shards`, its archon
    /// shards, `[slot, colour, upgrade path]`; `ab`, a Helminth ability per config,
    /// `[config, ability path, ability slot]`.
    gear: Vec<serde_json::Value>,
    /// The warframes fed to the Helminth (`InfestedFoundry.ConsumedSuits`), by path: whose
    /// abilities are subsumed. Empty when the account has no Helminth.
    consumed_suits: Vec<String>,
}

impl MasteryFacts {
    pub fn from_parts(xp: BTreeMap<String, u64>, pending: BTreeMap<String, u32>) -> Self {
        Self {
            xp,
            pending,
            ..Default::default()
        }
    }

    /// Adds when each foundry build finishes and the account's mastery rank.
    pub fn with_extras(
        mut self,
        ready: Vec<(String, i64)>,
        player_level: Option<u32>,
        platinum: Option<u64>,
    ) -> Self {
        self.orbiter.ready = ready;
        self.orbiter.player_level = player_level;
        self.orbiter.platinum = platinum;
        self
    }

    /// Adds the account's credits and Endo.
    pub fn with_wallet(mut self, credits: Option<u64>, endo: Option<u64>) -> Self {
        self.orbiter.credits = credits;
        self.orbiter.endo = endo;
        self
    }

    /// Adds the unveiled rivens.
    pub fn with_rivens(mut self, rivens: Vec<serde_json::Value>) -> Self {
        self.orbiter.rivens = rivens;
        self
    }

    /// Credits on the account, when the inventory said (shared with orbiter).
    pub fn credits(&self) -> Option<u64> {
        self.orbiter.credits
    }

    /// Endo on the account, when the inventory said (shared with orbiter).
    pub fn endo(&self) -> Option<u64> {
        self.orbiter.endo
    }

    /// Unveiled rivens, each `{type, id, fp}` (shared with orbiter).
    pub fn rivens(&self) -> &[serde_json::Value] {
        &self.orbiter.rivens
    }

    /// Adds the Kubrow and Kavat imprints.
    pub fn with_imprints(mut self, imprints: Vec<serde_json::Value>) -> Self {
        self.orbiter.imprints = imprints;
        self
    }

    /// Kubrow and Kavat imprints, each the inventory's own row (shared with orbiter).
    pub fn imprints(&self) -> &[serde_json::Value] {
        &self.orbiter.imprints
    }

    /// Adds each copy of a warframe, weapon or companion, `{type, f, p, s}` (and `m`, `x`).
    pub fn with_gear(mut self, gear: Vec<serde_json::Value>) -> Self {
        self.orbiter.gear = gear;
        self
    }

    /// Each copy of a warframe, weapon or companion, `{type, f, p, s}` (and `m`, `x`, `pol`,
    /// `shards`, `ab`; shared with orbiter).
    pub fn gear(&self) -> &[serde_json::Value] {
        &self.orbiter.gear
    }

    /// Adds the warframes fed to the Helminth.
    pub fn with_consumed_suits(mut self, suits: Vec<String>) -> Self {
        self.orbiter.consumed_suits = suits;
        self
    }

    /// The warframes fed to the Helminth, by path (shared with orbiter).
    pub fn consumed_suits(&self) -> &[String] {
        &self.orbiter.consumed_suits
    }

    /// Platinum on the account, when the inventory said (shared with orbiter).
    pub fn platinum(&self) -> Option<u64> {
        self.orbiter.platinum
    }

    /// When each foundry build finishes: recipe path and unix milliseconds (shared with orbiter).
    pub fn foundry_ready(&self) -> &[(String, i64)] {
        &self.orbiter.ready
    }

    /// The account's mastery rank, when the inventory said (shared with orbiter).
    pub fn player_level(&self) -> Option<u32> {
        self.orbiter.player_level
    }

    /// The affinity the inventory reports for an item, or 0 when it reports none.
    pub fn xp(&self, item: &str) -> u64 {
        self.xp.get(item).copied().unwrap_or(0)
    }

    /// How many builds of a recipe are waiting in the foundry, or 0 when none are.
    pub fn pending(&self, recipe: &str) -> u32 {
        self.pending.get(recipe).copied().unwrap_or(0)
    }

    /// Every build waiting in the foundry, by recipe path (shared with orbiter).
    pub fn pending_builds(&self) -> &BTreeMap<String, u32> {
        &self.pending
    }
}

/// The rank an item's affinity reaches, capped at its max rank; `None` for categories without
/// mastery. Rank r costs r² times the rank-1 threshold that `mastery_threshold` defines.
pub fn mastery_rank(category: Category, xp: u64, max_rank: u32) -> Option<u32> {
    let affinity_per_rank_squared = mastery_threshold(category, 1)?;
    Some(max_rank.min((xp / affinity_per_rank_squared).isqrt() as u32))
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawEntry {
    item_type: String,
    #[serde(default)]
    item_count: Option<i64>,
    /// Where a ranked copy records the rank it was fused to, as JSON inside a JSON string.
    #[serde(default)]
    upgrade_fingerprint: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawXpEntry {
    item_type: String,
    #[serde(rename = "XP")]
    xp: u64,
}

/// One inventory response.
///
/// Every section is defaulted *and* holds raw rows rather than decoded ones. `inventory.php` omits
/// a section entirely when the account holds nothing in it (no Necramech means no `MechSuits`),
/// and it also emits rows the game's own client refuses: a Steam Deck report carried
/// `Inventory has NULL item` in Warframe's `EE.log` against the very response we were reading, and
/// one `"ItemType": null` failed the entire account's snapshot. The client skips such a row and
/// carries on, so we do too; each row is converted in `add_*` where a failure costs that row only.
///
/// The sync marker stays required because it is what distinguishes an inventory response from any
/// other JSON the endpoint could return; a payload that decodes to no holdings at all is refused in
/// `decode` rather than here.
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawInventory {
    last_inventory_sync: serde_json::Value,
    #[serde(rename = "PlayerLevel", default)]
    player_level: Option<u32>,
    #[serde(rename = "PremiumCredits", default)]
    premium_credits: Option<serde_json::Value>,
    #[serde(rename = "RegularCredits", default)]
    regular_credits: Option<serde_json::Value>,
    #[serde(rename = "FusionPoints", default)]
    fusion_points: Option<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    suits: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    long_guns: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    pistols: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    melee: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    sentinels: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    misc_items: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    recipes: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    pending_recipes: Vec<serde_json::Value>,
    #[serde(rename = "XPInfo", default, deserialize_with = "rows")]
    xp_info: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    space_suits: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    space_melee: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    space_guns: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    sentinel_weapons: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    kubrow_pets: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    operator_amps: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    mech_suits: Vec<serde_json::Value>,
    /// Unranked mods and arcanes, stacked by type. The largest holding in the response by value.
    #[serde(default, deserialize_with = "rows")]
    raw_upgrades: Vec<serde_json::Value>,
    /// Mods and arcanes carrying a rank, plus rivens: one row per copy, no `ItemCount`.
    #[serde(default, deserialize_with = "rows")]
    upgrades: Vec<serde_json::Value>,
    /// Ayatan sculptures and stars.
    #[serde(default, deserialize_with = "rows")]
    fusion_treasures: Vec<serde_json::Value>,
    /// Built Railjack armaments.
    #[serde(default, deserialize_with = "rows")]
    crew_ship_weapons: Vec<serde_json::Value>,
    // Read for their builds only, never as holdings: an exalted weapon, the Parazon, a K-Drive, a
    // Railjack or the Operator keeps its mods here.
    #[serde(default, deserialize_with = "rows")]
    special_items: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    hoverboards: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    antiques: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    moa_pets: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    scoops: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    horses: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    drifter_guns: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    drifter_melee: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    motorcycles: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    crew_ships: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    data_knives: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    crew_ship_harnesses: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    crew_ship_salvaged_weapons: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    operator_suits: Vec<serde_json::Value>,
    /// Loadouts whose rows are themselves configs, rather than items carrying `Configs`.
    #[serde(default, deserialize_with = "rows")]
    operator_load_outs: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    adult_operator_load_outs: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "rows")]
    kahl_load_outs: Vec<serde_json::Value>,
    /// Kubrow and Kavat imprints, one row per imprint. Not part of the collection; passed to
    /// orbiter, which lists them for sale.
    #[serde(default, deserialize_with = "rows")]
    kubrow_pet_prints: Vec<serde_json::Value>,
    /// The Helminth: only `ConsumedSuits` is read, for orbiter. Any shape is accepted here and
    /// whatever isn't understood reads as nothing fed.
    #[serde(default)]
    infested_foundry: Option<serde_json::Value>,
}

/// A section, tolerating the two shapes that are not a list of rows.
///
/// `null` is not the same as absent to serde. `#[serde(default)]` covers a missing key and
/// nothing else, and the endpoint emits both. Anything that is neither a list nor null is a
/// section we did not understand, and reads as empty rather than failing its siblings.
fn rows<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<serde_json::Value>, D::Error> {
    Ok(match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Array(rows) => rows,
        _ => Vec::new(),
    })
}

/// What a decode had to throw away, so a failed read can be explained without the payload.
///
/// Counts and paths only: the response is one account's holdings, and the credential that fetched
/// it never reaches here at all.
#[derive(Default)]
struct DecodeReport {
    rows_seen: usize,
    rows_skipped: usize,
    first_skip: Option<String>,
}

impl DecodeReport {
    fn skip(&mut self, reason: &str, row: &serde_json::Value) {
        self.rows_skipped += 1;
        if self.first_skip.is_none() {
            self.first_skip = Some(format!("{reason} ({})", row_label(row)));
        }
    }

    fn summary(&self) -> String {
        let first = self.first_skip.as_deref().unwrap_or("none");
        format!(
            "rows_seen={} rows_skipped={} first_skip={first}",
            self.rows_seen, self.rows_skipped
        )
    }
}

/// A skipped row named by its `ItemType` alone.
///
/// The rest of a row can carry a riven's rolled stats or a trade's counterparty, so only the item
/// path, which is game content identical for every account that owns one, is ever quoted.
fn row_label(row: &serde_json::Value) -> String {
    match row.get("ItemType").and_then(serde_json::Value::as_str) {
        Some(path) if path.len() <= 128 => format!("ItemType={path}"),
        Some(_) => "ItemType=<overlong>".to_owned(),
        None => "ItemType absent".to_owned(),
    }
}

/// One row, or the reason it cannot be one.
fn parse_entry(row: serde_json::Value, report: &mut DecodeReport) -> Option<RawEntry> {
    report.rows_seen += 1;
    match serde_json::from_value::<RawEntry>(row.clone()) {
        Ok(entry) if validate_item_type(&entry.item_type) => Some(entry),
        Ok(_) => {
            report.skip("item path is not canonical", &row);
            None
        }
        Err(_) => {
            report.skip("row does not have an item type", &row);
            None
        }
    }
}

struct AccumulatedEntry {
    /// The catalogue path these copies came from, which is the map key for everything except a
    /// ranked mod. That one is keyed per rank, and still has to look its artwork and name up here.
    path: String,
    name: Option<String>,
    category: Category,
    quantity: i64,
    mastered: bool,
    masterable: bool,
    max_rank: Option<u32>,
    rank: Option<u32>,
    fusion_limit: Option<u32>,
    image_name: Option<String>,
    /// Copies installed in a build. Stays `None` unless the read established it; see
    /// `installed_copies`.
    equipped: Option<u32>,
}

impl SnapshotDecoder for InventoryJsonDecoder<'_> {
    fn decode(&self, response: &[u8]) -> Result<InventorySnapshot, AcquisitionError> {
        self.decode_with_facts(response)
            .map(|(snapshot, _)| snapshot)
    }
}

impl InventoryJsonDecoder<'_> {
    /// The snapshot plus the affinity and pending builds it does not keep. The raw payload
    /// is parsed once; callers that only need holdings use `decode`.
    pub fn decode_with_facts(
        &self,
        response: &[u8],
    ) -> Result<(InventorySnapshot, MasteryFacts), AcquisitionError> {
        let raw: RawInventory = match serde_json::from_slice(response) {
            Ok(raw) => raw,
            Err(error) => {
                // Not `{error}`: serde's type-error text quotes the offending value, which
                // here is account data ("invalid type: string \"<their handle>\"").
                log::warn!(
                    "inventory decode failed: {:?} at line {} column {} payload_bytes={}",
                    error.classify(),
                    error.line(),
                    error.column(),
                    response.len()
                );
                return Err(AcquisitionError::SnapshotInvalid);
            }
        };
        if raw.last_inventory_sync.is_null() {
            log::warn!(
                "inventory sync timestamp missing payload_bytes={}",
                response.len()
            );
            return Err(AcquisitionError::SnapshotInvalid);
        }
        // Before the `add_*` calls below take the sections.
        let installed = installed_copies(&raw);
        // Each copy of a warframe, weapon or companion: its path, the game's feature bits (512:
        // an Incarnon Genesis installed, 8: gilded) and its Forma, so orbiter can tell which copies
        // matter. Also the section it sits in, the parts a modular build (kitgun, zaw, amp, MOA,
        // hound, K-Drive) was made from, and its affinity: orbiter reads what each is and whether
        // it's gilded, since mastery goes by the chamber, strike, prism, model or board. And what a
        // build needs from the copy: its slots' polarities, its archon shards and the Helminth
        // ability each config puts in, for orbiter's Builds. Necramechs and exalted weapons too.
        let gear = [
            ("Suits", &raw.suits),
            ("LongGuns", &raw.long_guns),
            ("Pistols", &raw.pistols),
            ("Melee", &raw.melee),
            ("Sentinels", &raw.sentinels),
            ("SentinelWeapons", &raw.sentinel_weapons),
            ("SpaceSuits", &raw.space_suits),
            ("SpaceGuns", &raw.space_guns),
            ("SpaceMelee", &raw.space_melee),
            ("OperatorAmps", &raw.operator_amps),
            ("MoaPets", &raw.moa_pets),
            ("KubrowPets", &raw.kubrow_pets),
            ("Hoverboards", &raw.hoverboards),
            ("CrewShipHarnesses", &raw.crew_ship_harnesses),
            ("MechSuits", &raw.mech_suits),
            ("SpecialItems", &raw.special_items),
        ]
        .into_iter()
        .flat_map(|(section, rows)| rows.iter().map(move |row| (section, row)))
        .filter_map(|(section, v)| {
            let kind = v.get("ItemType")?.as_str()?;
            let count = |k: &str| v.get(k).and_then(|n| n.as_u64()).unwrap_or(0);
            let mut row = serde_json::json!({
                "type": kind,
                "f": count("Features"),
                "p": count("Polarized"),
                "s": section,
            });
            let parts = v
                .get("ModularParts")
                .and_then(|m| m.as_array())
                .map(|m| m.iter().filter_map(|p| p.as_str()).collect::<Vec<_>>())
                .unwrap_or_default();
            if !parts.is_empty() {
                row["m"] = serde_json::json!(parts);
            }
            let xp = count("XP");
            if xp > 0 {
                row["x"] = serde_json::json!(xp);
            }
            for (key, list) in [
                ("pol", slot_polarities(v)),
                ("shards", archon_shards(v)),
                ("ab", ability_overrides(v)),
            ] {
                if !list.is_empty() {
                    row[key] = serde_json::Value::Array(list);
                }
            }
            Some(row)
        })
        .collect::<Vec<_>>();
        let consumed_suits = consumed_suits(raw.infested_foundry.as_ref());
        let mut entries = BTreeMap::<String, AccumulatedEntry>::new();
        let report = &mut DecodeReport::default();

        add_unique_section(
            &mut entries,
            raw.suits,
            Category::Frame,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.long_guns,
            Category::Weapon,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.pistols,
            Category::Weapon,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.melee,
            Category::Weapon,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.sentinels,
            Category::Companion,
            self.catalog,
            report,
        );
        add_misc_section(&mut entries, raw.misc_items, self.catalog, report);
        add_stackable_section(
            &mut entries,
            raw.recipes,
            Category::Blueprint,
            1,
            self.catalog,
            report,
        );
        // Pending builds run through the same section as the recipes, so the two counts agree
        // by construction; a scratch report keeps those rows out of the real one.
        let mut pending_holdings = BTreeMap::<String, AccumulatedEntry>::new();
        add_stackable_section(
            &mut pending_holdings,
            raw.pending_recipes.clone(),
            Category::Blueprint,
            1,
            None,
            &mut DecodeReport::default(),
        );
        // When each build finishes, for orbiter's foundry alerts: `CompletionDate` is a Mongo date,
        // `{"$date": {"$numberLong": "…"}}` or `{"$date": …}`.
        let ready = raw
            .pending_recipes
            .iter()
            .filter_map(|v| {
                let path = v.get("ItemType")?.as_str()?.to_owned();
                let date = v.get("CompletionDate")?.get("$date")?;
                let ms = match date.get("$numberLong") {
                    Some(n) => n
                        .as_str()
                        .and_then(|s| s.parse::<i64>().ok())
                        .or_else(|| n.as_i64()),
                    None => date.as_i64(),
                }?;
                Some((path, ms))
            })
            .collect::<Vec<_>>();
        let player_level = raw.player_level;
        // A plain number, or a Mongo `{"$numberLong": "…"}`.
        let number = |v: &serde_json::Value| {
            v.as_u64().or_else(|| {
                v.get("$numberLong")
                    .and_then(|n| n.as_str())
                    .and_then(|s| s.parse().ok())
            })
        };
        let platinum = raw.premium_credits.as_ref().and_then(number);
        let credits = raw.regular_credits.as_ref().and_then(number);
        let endo = raw.fusion_points.as_ref().and_then(number);
        // Unveiled rivens: `Upgrades` rows of a `/Randomized/` type whose fingerprint has stats.
        // Veiled ones (a challenge, no buffs) are left out. Never logged.
        let rivens = raw
            .upgrades
            .iter()
            .filter_map(|v| {
                let kind = v.get("ItemType")?.as_str()?;
                if !kind.contains("/Upgrades/Mods/Randomized/") {
                    return None;
                }
                let fp: serde_json::Value =
                    serde_json::from_str(v.get("UpgradeFingerprint")?.as_str()?).ok()?;
                fp.get("buffs")?;
                let id = v
                    .get("ItemId")
                    .and_then(|i| i.get("$oid").or(Some(i)))
                    .and_then(|i| i.as_str())
                    .unwrap_or_default();
                // Mid-cycle: the new roll waiting for keep-or-take, for orbiter to compare.
                let pending = v
                    .get("PendingRerollFingerprint")
                    .and_then(|p| p.as_str())
                    .and_then(|p| serde_json::from_str::<serde_json::Value>(p).ok())
                    .filter(|p| p.get("buffs").is_some());
                let mut row = serde_json::json!({ "type": kind, "id": id, "fp": fp });
                if let Some(p) = pending {
                    row["pending"] = p;
                }
                Some(row)
            })
            .collect::<Vec<_>>();
        // Imprints carry no secrets, but their rows are the player's own pets: never logged.
        let imprints = raw.kubrow_pet_prints;
        let pending = pending_holdings
            .into_iter()
            .map(|(path, accumulated)| (path, accumulated.quantity.max(0) as u32))
            .collect::<BTreeMap<_, _>>();

        add_stackable_section(
            &mut entries,
            raw.pending_recipes,
            Category::Blueprint,
            -1,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.space_suits,
            Category::Frame,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.space_melee,
            Category::Weapon,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.space_guns,
            Category::Weapon,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.sentinel_weapons,
            Category::Weapon,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.kubrow_pets,
            Category::Companion,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.operator_amps,
            Category::Weapon,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.mech_suits,
            Category::Frame,
            self.catalog,
            report,
        );
        add_upgrade_section(&mut entries, raw.raw_upgrades, self.catalog, report);
        // One row per copy and no `ItemCount`. Copies that carry a rank get a row per rank rather
        // than joining the unranked stack, because the market prices the ranks separately.
        add_upgrade_section(&mut entries, raw.upgrades, self.catalog, report);
        add_stackable_section(
            &mut entries,
            raw.fusion_treasures,
            Category::Resource,
            1,
            self.catalog,
            report,
        );
        add_unique_section(
            &mut entries,
            raw.crew_ship_weapons,
            Category::Weapon,
            self.catalog,
            report,
        );

        let mut affinity = BTreeMap::<String, u64>::new();
        for row in raw.xp_info {
            report.rows_seen += 1;
            let Ok(xp_row) = serde_json::from_value::<RawXpEntry>(row.clone()) else {
                report.skip("row does not have an item type and XP", &row);
                continue;
            };
            if !validate_item_type(&xp_row.item_type) {
                report.skip("item path is not canonical", &row);
                continue;
            }
            // A repeated path keeps the larger affinity: the facts answer "how much", and the
            // larger reading is the one the game last wrote.
            affinity
                .entry(xp_row.item_type.clone())
                .and_modify(|kept| *kept = (*kept).max(xp_row.xp))
                .or_insert(xp_row.xp);
            let xp = xp_row;
            let path = xp.item_type;
            let fallback = category_from_path(&path);
            let entry = entries
                .entry(path.clone())
                .or_insert_with(|| accumulated_entry(&path, fallback, self.catalog));
            if entry.masterable
                && entry
                    .max_rank
                    .and_then(|rank| mastery_threshold(entry.category, rank))
                    .is_some_and(|threshold| xp.xp >= threshold)
            {
                entry.mastered = true;
            }
        }

        // Zero in use is a claim. Unless some build reference lands on a held row, every row
        // stays unknown: a young account's empty builds, or a shape this no longer reads.
        let resolved = installed
            .counts
            .keys()
            .any(|key| entries.get(key).is_some_and(|entry| entry.quantity > 0));
        if resolved {
            for (key, entry) in &mut entries {
                entry.equipped = match entry.category {
                    // Gear is in use by sitting in a loadout, which this does not read.
                    Category::Frame
                    | Category::Weapon
                    | Category::Companion
                    | Category::Vehicle => None,
                    Category::PrimePart
                    | Category::Relic
                    | Category::Resource
                    | Category::Blueprint
                    | Category::Mod
                    | Category::Arcane => Some(installed.counts.get(key).copied().unwrap_or(0)),
                };
            }
        }
        // An unread slot shape undercounts what is in use, which offers an installed copy for sale.
        if installed.not_understood > 0 || (!resolved && installed.slots > 0) {
            trace_decode(&format!(
                "[decode] installed copies: resolved={resolved} slots={} not_understood={}",
                installed.slots, installed.not_understood
            ));
        }

        let domain_entries = entries
            .into_iter()
            .filter(|(_, accumulated)| accumulated.quantity >= 0)
            .filter_map(|(path, accumulated)| {
                build_entry(path, accumulated).or_else(|| {
                    report.rows_skipped += 1;
                    None
                })
            })
            .collect::<Vec<_>>();
        // Every section being optional is what lets a young account read at all, but it also means
        // a response whose shape we stopped understanding would decode quietly to nothing. No
        // logged-in account owns nothing, so an empty snapshot is a failed read, not a poor one.
        if domain_entries.is_empty() {
            trace_decode(&format!("[decode] rejected empty: {}", report.summary()));
            return Err(AcquisitionError::SnapshotInvalid);
        }
        if report.rows_skipped != 0 {
            trace_decode(&format!("[decode] tolerated: {}", report.summary()));
        }
        let snapshot = InventorySnapshot::coherent(domain_entries)
            .map_err(|_| AcquisitionError::SnapshotInvalid)?;
        Ok((
            snapshot,
            MasteryFacts::from_parts(affinity, pending)
                .with_extras(ready, player_level, platinum)
                .with_wallet(credits, endo)
                .with_rivens(rivens)
                .with_imprints(imprints)
                .with_gear(gear)
                .with_consumed_suits(consumed_suits),
        ))
    }
}

/// A copy's polarised slots, `Polarity: [{Slot, Value}]`, as `[slot, "AP_…"]`. The code is passed
/// as the game writes it (`AP_ATTACK`, `AP_UNIVERSAL`, `AP_ANY`…); orbiter names it. An entry
/// missing either half is dropped.
fn slot_polarities(row: &serde_json::Value) -> Vec<serde_json::Value> {
    row.get("Polarity")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let slot = p.get("Slot")?.as_u64()?;
            let value = p.get("Value")?.as_str()?;
            Some(serde_json::json!([slot, value]))
        })
        .collect()
}

/// A warframe's archon shards, `ArchonCrystalUpgrades: [{UpgradeType, Color}]`, as
/// `[slot, colour, upgrade path]`, the slot being the entry's place in the list. An empty slot (`{}`,
/// or a shard taken out) has no `UpgradeType` and is dropped; a missing colour passes as null.
fn archon_shards(row: &serde_json::Value) -> Vec<serde_json::Value> {
    row.get("ArchonCrystalUpgrades")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(slot, shard)| {
            let upgrade = shard.get("UpgradeType")?.as_str()?;
            let colour = shard.get("Color").and_then(serde_json::Value::as_str);
            Some(serde_json::json!([slot, colour, upgrade]))
        })
        .collect()
}

/// The Helminth ability each config of a warframe puts in, `Configs[i].AbilityOverride: {Ability,
/// Index}`, as `[config, ability path, ability slot]`.
fn ability_overrides(row: &serde_json::Value) -> Vec<serde_json::Value> {
    row.get("Configs")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(config, c)| {
            let ability = c.get("AbilityOverride")?;
            let path = ability.get("Ability")?.as_str()?;
            let index = ability.get("Index")?.as_u64()?;
            Some(serde_json::json!([config, path, index]))
        })
        .collect()
}

/// The warframes fed to the Helminth, `InfestedFoundry.ConsumedSuits: [{s, c}]`, by path.
fn consumed_suits(foundry: Option<&serde_json::Value>) -> Vec<String> {
    foundry
        .and_then(|f| f.get("ConsumedSuits"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|suit| suit.get("s")?.as_str().map(str::to_owned))
        .collect()
}

/// One accumulated holding as a domain entry, or nothing if it cannot become one.
fn build_entry(path: String, accumulated: AccumulatedEntry) -> Option<InventoryEntry> {
    let name = match accumulated.name {
        Some(name) => name,
        None => display_label(&accumulated.path)?,
    };
    let item = CatalogItem::new(ItemId::new(path).ok()?, name, accumulated.category).ok()?;
    let item = match accumulated.image_name {
        Some(image_name) => item.with_image_name(image_name).ok()?,
        None => item,
    };
    let quantity = u32::try_from(accumulated.quantity).ok()?;
    let entry = InventoryEntry::new(item, quantity)
        .with_mastered(accumulated.mastered)
        // A path slot and an id slot can both land on a stack that holds a single copy.
        .with_equipped(accumulated.equipped.map(|count| count.min(quantity)));
    Some(match accumulated.rank {
        Some(rank) => entry.with_rank(rank, accumulated.fusion_limit),
        None => entry,
    })
}

/// Copies installed in some build, keyed the way `add_upgrade_section` keys their holdings.
struct InstalledCopies {
    counts: HashMap<String, u32>,
    /// References read from slots, before deduplication.
    slots: usize,
    /// Slots holding something that is neither a copy nor empty.
    not_understood: usize,
}

/// Copies slotted in any build, counted once each: one copy serves every build that names it, by
/// instance id or, for an unranked copy, by path. The ids are per-account and never leave here.
fn installed_copies(raw: &RawInventory) -> InstalledCopies {
    let mut ids = HashSet::<&str>::new();
    let mut paths = HashSet::<&str>::new();
    let mut slots = 0;
    let mut not_understood = 0;
    let equipment = [
        &raw.suits,
        &raw.long_guns,
        &raw.pistols,
        &raw.melee,
        &raw.special_items,
        &raw.sentinels,
        &raw.sentinel_weapons,
        &raw.space_suits,
        &raw.space_guns,
        &raw.space_melee,
        &raw.hoverboards,
        &raw.operator_amps,
        &raw.antiques,
        &raw.moa_pets,
        &raw.scoops,
        &raw.horses,
        &raw.drifter_guns,
        &raw.drifter_melee,
        &raw.motorcycles,
        &raw.crew_ships,
        &raw.data_knives,
        &raw.mech_suits,
        &raw.crew_ship_harnesses,
        &raw.kubrow_pets,
        &raw.crew_ship_weapons,
        &raw.crew_ship_salvaged_weapons,
        &raw.operator_suits,
    ];
    let configs = equipment
        .into_iter()
        .flatten()
        .filter_map(|row| row.get("Configs")?.as_array())
        .flatten()
        .chain(
            [
                &raw.operator_load_outs,
                &raw.adult_operator_load_outs,
                &raw.kahl_load_outs,
            ]
            .into_iter()
            .flatten(),
        );
    for config in configs {
        // Conclave builds keep their own slots, and a copy used only there is still in use.
        for key in ["Upgrades", "PvpUpgrades"] {
            let Some(slotted) = config.get(key).and_then(serde_json::Value::as_array) else {
                continue;
            };
            for slot in slotted {
                match slot {
                    serde_json::Value::Null => {}
                    serde_json::Value::String(text) if text.is_empty() => {}
                    serde_json::Value::String(text) if is_object_id(text) => {
                        slots += 1;
                        ids.insert(text);
                    }
                    serde_json::Value::String(text) if text.starts_with("/Lotus/") => {
                        slots += 1;
                        paths.insert(text);
                    }
                    serde_json::Value::Object(_) => match instance_id(slot) {
                        Some(id) => {
                            slots += 1;
                            ids.insert(id);
                        }
                        None => not_understood += 1,
                    },
                    _ => not_understood += 1,
                }
            }
        }
    }

    let mut counts = HashMap::<String, u32>::new();
    for row in &raw.upgrades {
        if ids.is_empty() {
            break;
        }
        let Some(id) = row.get("ItemId").and_then(instance_id) else {
            continue;
        };
        // Removed as it is found, so a duplicated row cannot count the same copy twice.
        if !ids.remove(id) {
            continue;
        }
        let Some(path) = row.get("ItemType").and_then(serde_json::Value::as_str) else {
            continue;
        };
        let fingerprint = row
            .get("UpgradeFingerprint")
            .and_then(serde_json::Value::as_str);
        let key = match fused_rank(fingerprint) {
            0 => path.to_owned(),
            rank => format!("{path}#{rank}"),
        };
        *counts.entry(key).or_default() += 1;
    }
    for path in paths {
        *counts.entry(path.to_owned()).or_default() += 1;
    }
    InstalledCopies {
        counts,
        slots,
        not_understood,
    }
}

/// An `Upgrades` row's id as a slot or an `ItemId` writes it: bare, or as `{"$oid"}` or `{"$id"}`.
fn instance_id(value: &serde_json::Value) -> Option<&str> {
    match value {
        serde_json::Value::String(text) => Some(text),
        serde_json::Value::Object(object) => {
            object.get("$oid").or_else(|| object.get("$id"))?.as_str()
        }
        _ => None,
    }
}

/// Whether a bare slot string is an instance id rather than an item path.
fn is_object_id(text: &str) -> bool {
    text.len() == 24 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// One line about what a decode had to throw away.
///
/// A failed read reaches the player as "Inventory snapshot was invalid" and reaches us as nothing
/// at all: the serde error was discarded at the parse, so the one report that mattered could not
/// be answered from the app's own output. This is counts and item paths only; see `row_label`.
fn trace_decode(line: &str) {
    log::warn!("{line}");
}

fn add_misc_section(
    output: &mut BTreeMap<String, AccumulatedEntry>,
    rows: Vec<serde_json::Value>,
    catalog: Option<&CatalogIndex>,
    report: &mut DecodeReport,
) {
    for row in rows {
        let Some(item) = parse_entry(row, report) else {
            continue;
        };
        let category = if item.item_type.contains("/Projections/") {
            Category::Relic
        } else {
            Category::Resource
        };
        add_stackable_item(output, item, category, 1, catalog, report);
    }
}

/// Mods, arcanes and rivens, whether they carry a rank or not.
///
/// Both sections mix the two kinds, and only the path tells them apart. WFCD files an arcane
/// under `/Upgrades/CosmeticEnhancers/`. The fallback is what an unresolved path gets: 12 of this
/// account's 1,011 rows are newer than the cached catalog, and "a mod" is a better guess for them
/// than "a resource".
fn add_upgrade_section(
    output: &mut BTreeMap<String, AccumulatedEntry>,
    rows: Vec<serde_json::Value>,
    catalog: Option<&CatalogIndex>,
    report: &mut DecodeReport,
) {
    for row in rows {
        let Some(item) = parse_entry(row, report) else {
            continue;
        };
        let category = if item.item_type.contains("/CosmeticEnhancers/") {
            Category::Arcane
        } else {
            Category::Mod
        };
        match fused_rank(item.upgrade_fingerprint.as_deref()) {
            0 => add_stackable_item(output, item, category, 1, catalog, report),
            rank => add_ranked_copy(output, item.item_type, category, rank, catalog),
        }
    }
}

/// The rank a copy was fused to, from the fingerprint the game stores it in.
///
/// The fingerprint is a JSON document inside a JSON string, and an unranked copy omits `lvl`
/// entirely rather than writing zero. A riven's fingerprint carries its rolled stats in the same
/// field, so this has to read one key rather than assume a shape.
fn fused_rank(fingerprint: Option<&str>) -> u32 {
    fingerprint
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|parsed| parsed.get("lvl")?.as_u64())
        .and_then(|rank| u32::try_from(rank).ok())
        .unwrap_or(0)
}

/// One fused copy, on a row of its own for its rank.
///
/// Ranks are not a detail of the same holding: `Serration` sells for 3p unranked and 48p at rank
/// 10, and the two are separate listings on warframe.market. Summing them onto one row forces one
/// price onto both, and the only price a merged row can honestly show is the lower.
fn add_ranked_copy(
    output: &mut BTreeMap<String, AccumulatedEntry>,
    path: String,
    category: Category,
    rank: u32,
    catalog: Option<&CatalogIndex>,
) {
    let mut resolved = accumulated_entry(&path, category, catalog);
    resolved.rank = Some(rank);
    // The key, not the path: the path is what the catalogue is asked about, and several rows share
    // it. `#` cannot occur in an item path, which `validate_item_type` has already established.
    let entry = output.entry(format!("{path}#{rank}")).or_insert(resolved);
    entry.quantity = entry.quantity.saturating_add(1);
}

fn add_unique_section(
    output: &mut BTreeMap<String, AccumulatedEntry>,
    rows: Vec<serde_json::Value>,
    category: Category,
    catalog: Option<&CatalogIndex>,
    report: &mut DecodeReport,
) {
    for row in rows {
        let Some(item) = parse_entry(row, report) else {
            continue;
        };
        let path = item.item_type;
        let resolved = accumulated_entry(&path, category, catalog);
        let entry = output.entry(path).or_insert(resolved);
        entry.quantity = entry.quantity.saturating_add(1);
    }
}

fn add_stackable_section(
    output: &mut BTreeMap<String, AccumulatedEntry>,
    rows: Vec<serde_json::Value>,
    category: Category,
    direction: i64,
    catalog: Option<&CatalogIndex>,
    report: &mut DecodeReport,
) {
    for row in rows {
        let Some(item) = parse_entry(row, report) else {
            continue;
        };
        add_stackable_item(output, item, category, direction, catalog, report);
    }
}

fn add_stackable_item(
    output: &mut BTreeMap<String, AccumulatedEntry>,
    item: RawEntry,
    category: Category,
    direction: i64,
    catalog: Option<&CatalogIndex>,
    report: &mut DecodeReport,
) {
    let quantity = item.item_count.unwrap_or(1);
    if quantity < 0 {
        report.skip(
            "negative count",
            &serde_json::json!({"ItemType": item.item_type}),
        );
        return;
    }
    if quantity == 0 {
        return;
    }
    let path = item.item_type;
    let resolved = accumulated_entry(&path, category, catalog);
    let entry = output.entry(path).or_insert(resolved);
    entry.quantity = entry
        .quantity
        .saturating_add(quantity.saturating_mul(direction));
}

/// Whether a path is one the game could have written.
///
/// A row failing this is a row we cannot key, name, or price, so it is dropped, but the account
/// around it is untouched. Rejecting the snapshot over one such path is what a real read hit.
fn validate_item_type(path: &str) -> bool {
    path.starts_with("/Lotus/")
        && path.len() <= 512
        && path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'_' | b'-'))
        && path
            .rsplit('/')
            .next()
            .is_some_and(|segment| !segment.is_empty())
}

fn category_from_path(path: &str) -> Category {
    if path.contains("/Projections/") {
        Category::Relic
    } else if path.contains("/Recipes/") {
        // Prime recipe holdings are the tradeable blueprint itself, not an instruction category.
        // Keeping them with Prime Parts puts their market and Ducat decisions in one place even
        // when a stale catalogue cannot provide richer metadata for a newly released item.
        if path
            .rsplit('/')
            .next()
            .is_some_and(|name| name.contains("Prime"))
        {
            Category::PrimePart
        } else {
            Category::Blueprint
        }
    } else if path.contains("/Powersuits/") || path.contains("/MechSuits/") {
        Category::Frame
    } else if path.contains("/Weapons/")
        || path.contains("/SentinelWeapons/")
        || path.contains("/OperatorAmp")
    {
        Category::Weapon
    } else if path.contains("/Sentinel") || path.contains("/Kubrow") || path.contains("/Pets/") {
        Category::Companion
    } else {
        Category::Resource
    }
}

fn mastery_threshold(category: Category, max_rank: u32) -> Option<u64> {
    let max_rank = u64::from(max_rank);
    let affinity_per_rank_squared = match category {
        Category::Frame | Category::Companion | Category::Vehicle => 1_000_u64,
        Category::Weapon => 500_u64,
        Category::PrimePart
        | Category::Relic
        | Category::Resource
        | Category::Blueprint
        | Category::Mod
        | Category::Arcane => {
            return None;
        }
    };
    affinity_per_rank_squared
        .checked_mul(max_rank)?
        .checked_mul(max_rank)
}

fn accumulated_entry(
    path: &str,
    fallback_category: Category,
    catalog: Option<&CatalogIndex>,
) -> AccumulatedEntry {
    let path_category = category_from_path(path);
    let category =
        if fallback_category == Category::Blueprint && path_category == Category::PrimePart {
            Category::PrimePart
        } else {
            catalog
                .and_then(|catalog| catalog.resolve(path))
                .and_then(|metadata| metadata.category())
                .unwrap_or(fallback_category)
        };
    let metadata = catalog.and_then(|catalog| catalog.resolve(path));
    AccumulatedEntry {
        path: path.to_owned(),
        name: metadata.map(|metadata| metadata.name().to_owned()),
        category,
        quantity: 0,
        mastered: false,
        masterable: metadata.is_some_and(|metadata| metadata.masterable()),
        max_rank: metadata.map(|metadata| metadata.max_rank()),
        rank: None,
        fusion_limit: metadata.and_then(|metadata| metadata.fusion_limit()),
        image_name: metadata
            .and_then(|metadata| metadata.image_name())
            .map(str::to_owned),
        equipped: None,
    }
}

fn display_label(path: &str) -> Option<String> {
    let segment = path.rsplit('/').next()?;
    let chars: Vec<char> = segment.chars().collect();
    let mut label = String::with_capacity(segment.len() + 8);
    for (index, &current) in chars.iter().enumerate() {
        let previous = index.checked_sub(1).and_then(|i| chars.get(i)).copied();
        let next = chars.get(index + 1).copied();
        let boundary = previous.is_some_and(|previous| {
            (previous.is_ascii_lowercase() && current.is_ascii_uppercase())
                || (previous.is_ascii_alphabetic() && current.is_ascii_digit())
                || (previous.is_ascii_digit() && current.is_ascii_alphabetic())
                || (previous.is_ascii_uppercase()
                    && current.is_ascii_uppercase()
                    && next.is_some_and(|next| next.is_ascii_lowercase()))
                || previous == '_'
                || previous == '-'
        });
        if boundary && !label.ends_with(' ') {
            label.push(' ');
        }
        if !matches!(current, '_' | '-') {
            label.push(current);
        }
    }
    let label = label.trim().to_owned();
    (!label.is_empty()).then_some(label)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::read_bounded;
    use crate::AcquisitionError;

    #[test]
    fn bounded_reader_accepts_complete_body_at_limit() {
        assert_eq!(read_bounded(Cursor::new(b"1234"), 4).unwrap(), b"1234");
    }

    #[test]
    fn bounded_reader_rejects_body_one_byte_over_limit() {
        assert_eq!(
            read_bounded(Cursor::new(b"12345"), 4),
            Err(AcquisitionError::InventoryResponseTooLarge)
        );
    }
}
