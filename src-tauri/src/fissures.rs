//! Void fissures, Baro, Varzia, the Sortie, bounties and the open worlds' clocks straight from the game's own worldstate (api.warframe.com), for when
//! api.warframestat.us can't answer: it was down for hours on 1 Nov 2026 ("WorldState Not
//! Found"), and Home then showed no fissures at all. The game's file names nodes and mission types
//! by their internal ids ("SolNode125", "MT_DEFENSE"); WFCD's node and mission-type tables turn
//! those into what the API would have said, so the page can't tell the difference. The tables are
//! kept a week in MyOrbiter's config folder.
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The game's worldstate: where the game reads it now, then the older address it was served from.
/// (content.warframe.com/dynamic answered 404 on 1 Nov 2026.)
const WORLDSTATE: [&str; 2] = ["https://api.warframe.com/cdn/worldState.php", "https://content.warframe.com/dynamic/worldState.php"];
const NODES: &str = "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/solNodes.json";
const MISSIONS: &str = "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/missionTypes.json";
const SORTIES: &str = "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/sortieData.json";
const LANGUAGES: &str = "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/languages.json";
const TABLES: &str = "worldstate-tables.json";
const TABLES_FRESH: u64 = 7 * 24 * 3600;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn get(url: &str) -> Result<Value, String> {
    crate::request("GET", url)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("{url}: {e}"))?
        .into_json::<Value>()
        .map_err(|e| format!("{url}: {e}"))
}

/// WFCD's node and mission-type tables, from the cache while it's under a week old.
fn tables(dir: &Path) -> Result<Value, String> {
    let path = dir.join(TABLES);
    let cached: Option<Value> = fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    if let Some(c) = &cached {
        // A copy saved without the sortie table or the bounty names (they failed to download, or
        // it's from before bounties were read) is read again next time.
        if now().saturating_sub(c["at"].as_u64().unwrap_or(0)) < TABLES_FRESH && c["sorties"]["bosses"].is_object() && c["jobs"].is_object() {
            return Ok(c.clone());
        }
    }
    match (get(NODES), get(MISSIONS)) {
        (Ok(nodes), Ok(missions)) => {
            // The sortie table only names bosses and conditions: without it the rest still works.
            let sorties = get(SORTIES).unwrap_or_else(|_| json!({}));
            // Only the bounties' names are kept from the (large) language table.
            let jobs = get(LANGUAGES).ok().map(|l| job_names(&l)).unwrap_or(Value::Null);
            let v = json!({ "at": now(), "nodes": nodes, "missions": missions, "sorties": sorties, "jobs": jobs });
            let _ = fs::create_dir_all(dir);
            let _ = crate::write_atomic(&path, &serde_json::to_vec(&v).unwrap_or_default(), false);
            Ok(v)
        }
        (Err(e), _) | (_, Err(e)) => cached.ok_or(e),
    }
}

/// The bounties' names from WFCD's language table, by their lowercased job path.
fn job_names(languages: &Value) -> Value {
    let names: Map<String, Value> = languages
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(k, _)| k.contains("/jobs/"))
        .filter_map(|(k, v)| Some((k.clone(), json!(v["value"].as_str()?))))
        .collect();
    Value::Object(names)
}

/// `{"$date": {"$numberLong": "1700000000000"}}` (or a plain number) as milliseconds.
fn millis(v: &Value) -> Option<i64> {
    let d = &v["$date"];
    d["$numberLong"].as_str().and_then(|s| s.parse().ok()).or_else(|| d.as_i64()).or_else(|| v.as_i64())
}

/// Milliseconds since 1970 as the API writes times: "2026-11-01T00:39:02.000Z".
fn iso(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let day = crate::civil_day(secs.div_euclid(86_400));
    let t = secs.rem_euclid(86_400);
    format!("{day}T{:02}:{:02}:{:02}.{:03}Z", t / 3600, t % 3600 / 60, t % 60, ms.rem_euclid(1000))
}

const TIERS: [(&str, &str, u64); 6] = [("VoidT1", "Lith", 1), ("VoidT2", "Meso", 2), ("VoidT3", "Neo", 3), ("VoidT4", "Axi", 4), ("VoidT5", "Requiem", 5), ("VoidT6", "Omnia", 6)];

/// The game's fissures and Void Storms in api.warframestat.us's shape.
pub fn parse(ws: &Value, nodes: &Value, missions: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let lists = [(ws["ActiveMissions"].as_array(), false), (ws["VoidStorms"].as_array(), true)];
    for (list, storm) in lists {
        for m in list.into_iter().flatten() {
            let tier_key = m["Modifier"].as_str().or_else(|| m["ActiveMissionTier"].as_str()).unwrap_or("");
            let Some((_, tier, num)) = TIERS.iter().find(|(k, _, _)| *k == tier_key) else { continue };
            let (Some(node_id), Some(expiry)) = (m["Node"].as_str(), millis(&m["Expiry"])) else { continue };
            let node = &nodes[node_id];
            let mission = m["MissionType"].as_str().and_then(|t| missions[t]["value"].as_str()).or_else(|| node["type"].as_str()).unwrap_or("Unknown");
            let id = m["_id"]["$oid"].as_str().or_else(|| m["_id"]["$id"].as_str()).map(str::to_string).unwrap_or_else(|| format!("{node_id}{expiry}"));
            let mut f = Map::new();
            f.insert("id".into(), json!(id));
            f.insert("node".into(), json!(node["value"].as_str().unwrap_or(node_id)));
            f.insert("missionType".into(), json!(mission));
            f.insert("enemy".into(), json!(node["enemy"].as_str().unwrap_or("")));
            f.insert("tier".into(), json!(tier));
            f.insert("tierNum".into(), json!(num));
            f.insert("isStorm".into(), json!(storm));
            f.insert("isHard".into(), json!(m["Hard"].as_bool().unwrap_or(false)));
            f.insert("expiry".into(), json!(iso(expiry)));
            if let Some(a) = millis(&m["Activation"]) {
                f.insert("activation".into(), json!(iso(a)));
            }
            out.push(Value::Object(f));
        }
    }
    out
}

/// A trader's visit (`VoidTraders` for Baro, `PrimeVaultTraders` for Varzia) in the API's shape:
/// where and when, and the stock by store path with its two prices (ducats and credits for Baro;
/// Regal Aya and Aya for Varzia, which the API also calls ducats and credits).
fn trader(t: &Value, nodes: &Value) -> Option<Value> {
    let activation = millis(&t["Activation"])?;
    let expiry = millis(&t["Expiry"])?;
    let node = t["Node"].as_str().unwrap_or("");
    let inventory: Vec<Value> = t["Manifest"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|x| {
            let path = x["ItemType"].as_str()?;
            let item = words(path.rsplit('/').next().unwrap_or(path));
            Some(json!({ "uniqueName": path, "item": item, "ducats": x["PrimePrice"].as_u64(), "credits": x["RegularPrice"].as_u64() }))
        })
        .collect();
    Some(json!({ "activation": iso(activation), "expiry": iso(expiry), "location": nodes[node]["value"].as_str().unwrap_or(node), "inventory": inventory }))
}

/// A store name split into words as the API writes the ones it can't name: "EvilBaroArmourA" →
/// "Evil Baro Armour A", "MPVNidusPrimeSinglePack" → "MPV Nidus Prime Single Pack". The page shows
/// the catalog's name instead wherever it knows the item.
fn words(name: &str) -> String {
    let c: Vec<char> = name.chars().collect();
    let mut out = String::new();
    for (i, &ch) in c.iter().enumerate() {
        let starts = i > 0 && ch.is_uppercase() && (c[i - 1].is_lowercase() || c[i - 1].is_ascii_digit() || (c[i - 1].is_uppercase() && c.get(i + 1).is_some_and(|n| n.is_lowercase())));
        if starts {
            out.push(' ');
        }
        out.push(ch);
    }
    out
}

/// The open worlds' clocks, worked out as the API does: Earth from the time of day, Orb Vallis from
/// its fixed 1,600-second cycle, Cetus (and the Cambion Drift, which follows it) from when the
/// Ostrons' bounties end, the last 50 minutes of each 150 being night.
fn cycles(ws: &Value, now_ms: i64) -> Map<String, Value> {
    let mut out = Map::new();
    let now = now_ms / 1000;
    let earth = now.rem_euclid(28_800);
    let (state, left) = if earth < 14_400 { ("day", 14_400 - earth) } else { ("night", 28_800 - earth) };
    out.insert("earthCycle".into(), json!({ "state": state, "expiry": iso((now + left) * 1000) }));
    // WFCD's current reference point for the Vallis cycle (a warm period starting then).
    let vallis = (now - 1_770_234_408).rem_euclid(1600);
    let (state, left) = if vallis < 400 { ("warm", 400 - vallis) } else { ("cold", 1600 - vallis) };
    out.insert("vallisCycle".into(), json!({ "state": state, "expiry": iso((now + left) * 1000) }));
    let cetus_end = current(ws, "CetusSyndicate", now_ms).and_then(|m| millis(&m["Expiry"]));
    if let Some(end) = cetus_end {
        let night_from = end - 50 * 60_000;
        let (cetus, cambion, until) = if now_ms < night_from { ("day", "fass", night_from) } else { ("night", "vome", end) };
        out.insert("cetusCycle".into(), json!({ "state": cetus, "expiry": iso(until) }));
        out.insert("cambionCycle".into(), json!({ "state": cambion, "expiry": iso(until) }));
    }
    out
}

/// What the game's own worldstate gives for the parts api.warframestat.us couldn't: fissures,
/// Baro, Varzia and the open worlds' clocks, by the API's names.
pub fn from_game(dir: &Path) -> Result<Map<String, Value>, String> {
    let t = tables(dir)?;
    let ws = get(WORLDSTATE[0]).or_else(|_| get(WORLDSTATE[1]))?;
    let mut p = parts(&ws, &t["nodes"], &t["missions"], (now() * 1000) as i64);
    p.extend(sorties(&ws, &t["nodes"], &t["missions"], &t["sorties"]));
    let bounties = syndicates(&ws, &t["jobs"], (now() * 1000) as i64);
    if !bounties.is_empty() {
        p.insert("syndicateMissions".into(), Value::Array(bounties));
    }
    Ok(p)
}

/// A syndicate's bounties running now. The game's file also lists the next rotation ahead of time
/// (the same tag, starting when this one ends), which mustn't be taken for the current one.
fn current<'a>(ws: &'a Value, tag: &str, now_ms: i64) -> Option<&'a Value> {
    ws["SyndicateMissions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["Tag"] == tag && millis(&m["Expiry"]).is_some_and(|e| e > now_ms) && millis(&m["Activation"]).map_or(true, |a| a <= now_ms))
        .min_by_key(|m| millis(&m["Expiry"]))
}

/// The game's tag for each place with bounties, and the syndicate the API names it by.
const SYNDICATES: [(&str, &str); 6] = [
    ("CetusSyndicate", "Ostrons"),
    ("SolarisSyndicate", "Solaris United"),
    ("EntratiSyndicate", "Entrati"),
    ("ZarimanSyndicate", "The Holdfasts"),
    ("EntratiLabSyndicate", "Cavia"),
    ("HexSyndicate", "The Hex"),
];

/// The open worlds' bounties in the API's shape, without the reward pools: those come from the drop
/// tables by level (as the API itself does), on the page.
fn syndicates(ws: &Value, jobs: &Value, now_ms: i64) -> Vec<Value> {
    let mut out = Vec::new();
    for (tag, name) in SYNDICATES {
        let Some(m) = current(ws, tag, now_ms) else { continue };
        let Some(expiry) = millis(&m["Expiry"]) else { continue };
        let list: Vec<Value> = m["Jobs"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|j| {
                let path = j["jobType"].as_str().unwrap_or("");
                // Isolation Vaults have no job, only the chamber: "ChamberB".
                let vault = j["locationTag"].as_str().and_then(|t| t.strip_prefix("Chamber")).map(|c| format!("Isolation Vault Chamber {c}"));
                let mut job = Map::new();
                job.insert("type".into(), json!(jobs[path.to_lowercase()].as_str().map(str::to_string).or(vault).unwrap_or_else(|| "Bounty".into())));
                if let (Some(lo), Some(hi)) = (j["minEnemyLevel"].as_u64(), j["maxEnemyLevel"].as_u64()) {
                    job.insert("enemyLevels".into(), json!([lo, hi]));
                }
                job.insert("standingStages".into(), j["xpAmounts"].clone());
                job.insert("minMR".into(), json!(j["masteryReq"].as_u64().unwrap_or(0)));
                job.insert("isVault".into(), json!(j["isVault"].as_bool().unwrap_or(false)));
                job.insert("uniqueName".into(), j["rewards"].clone());
                // Narmer's bounties run by day on the Plains and by night in the Vallis (as the API says).
                if path.contains("/Narmer/") {
                    let when = if m["Tag"] == "CetusSyndicate" { "day" } else { "night" };
                    job.insert("timeBound".into(), json!(when));
                }
                Value::Object(job)
            })
            .collect();
        out.push(json!({ "syndicate": name, "syndicateKey": name, "expiry": iso(expiry), "jobs": list }));
    }
    out
}

/// The Sortie and the Archon Hunt in the API's shape: the boss and each mission with its node.
fn sorties(ws: &Value, nodes: &Value, missions: &Value, data: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    let mission = |m: &Value| m["missionType"].as_str().map(|t| missions[t]["value"].as_str().unwrap_or(t).to_string()).unwrap_or_default();
    let node = |m: &Value| m["node"].as_str().map(|n| nodes[n]["value"].as_str().unwrap_or(n).to_string()).unwrap_or_default();
    let boss = |s: &Value| {
        let key = s["Boss"].as_str().unwrap_or("");
        (data["bosses"][key]["name"].as_str().unwrap_or(key).to_string(), data["bosses"][key]["faction"].as_str().unwrap_or("").to_string())
    };
    if let Some(s) = ws["Sorties"].as_array().and_then(|a| a.first()) {
        if let Some(expiry) = millis(&s["Expiry"]) {
            let (name, faction) = boss(s);
            let variants: Vec<Value> = s["Variants"].as_array().into_iter().flatten().map(|v| {
                let m = v["modifierType"].as_str().unwrap_or("");
                json!({ "missionType": mission(v), "node": node(v), "modifier": data["modifierTypes"][m].as_str().unwrap_or(m) })
            }).collect();
            out.insert("sortie".into(), json!({ "expiry": iso(expiry), "boss": name, "faction": faction, "variants": variants }));
        }
    }
    if let Some(s) = ws["LiteSorties"].as_array().and_then(|a| a.first()) {
        if let Some(expiry) = millis(&s["Expiry"]) {
            let (name, faction) = boss(s);
            let list: Vec<Value> = s["Missions"].as_array().into_iter().flatten().map(|m| json!({ "type": mission(m), "node": node(m) })).collect();
            out.insert("archonHunt".into(), json!({ "expiry": iso(expiry), "boss": name, "faction": faction, "missions": list }));
        }
    }
    out
}

fn parts(ws: &Value, nodes: &Value, missions: &Value, now_ms: i64) -> Map<String, Value> {
    let mut out = cycles(ws, now_ms);
    out.insert("fissures".into(), Value::Array(parse(ws, nodes, missions)));
    if let Some(b) = ws["VoidTraders"].as_array().and_then(|a| a.first()).and_then(|t| trader(t, nodes)) {
        out.insert("voidTrader".into(), b);
    }
    if let Some(v) = ws["PrimeVaultTraders"].as_array().and_then(|a| a.first()).and_then(|t| trader(t, nodes)) {
        out.insert("vaultTrader".into(), v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sortie_and_archon_hunt_from_the_game() {
        let ws = json!({
            "Sorties": [{ "Expiry": { "$date": { "$numberLong": "1793497200000" } }, "Boss": "SORTIE_BOSS_KELA", "Variants": [{ "missionType": "MT_DEFENSE", "modifierType": "SORTIE_MODIFIER_IMPACT", "node": "SolNode125" }] }],
            "LiteSorties": [{ "Expiry": { "$date": { "$numberLong": "1793497200000" } }, "Boss": "SORTIE_BOSS_AMAR", "Missions": [{ "missionType": "MT_DEFENSE", "node": "SolNode125" }] }]
        });
        let nodes = json!({ "SolNode125": { "value": "Stephano (Uranus)" } });
        let missions = json!({ "MT_DEFENSE": { "value": "Defense" } });
        let data = json!({ "bosses": { "SORTIE_BOSS_KELA": { "name": "Kela De Thaym", "faction": "Grineer" } }, "modifierTypes": { "SORTIE_MODIFIER_IMPACT": "Enemy Physical Enhancement: Impact" } });
        let s = sorties(&ws, &nodes, &missions, &data);
        assert_eq!(s["sortie"]["boss"], "Kela De Thaym");
        assert_eq!(s["sortie"]["variants"][0]["node"], "Stephano (Uranus)");
        assert_eq!(s["sortie"]["variants"][0]["modifier"], "Enemy Physical Enhancement: Impact");
        assert_eq!(s["archonHunt"]["boss"], "SORTIE_BOSS_AMAR", "a boss the table doesn't know keeps its key");
        assert_eq!(s["archonHunt"]["missions"][0]["type"], "Defense");
    }

    /// Reads the game's live worldstate (network): `cargo test live_from_the_game -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_from_the_game() {
        let dir = std::env::temp_dir().join(format!("myorbiter-ws-test-{}", now()));
        let p = from_game(&dir).expect("read");
        println!("{}", serde_json::to_string_pretty(&p).unwrap());
        assert!(!p["fissures"].as_array().unwrap().is_empty(), "fissures");
        assert!(p["syndicateMissions"].as_array().is_some_and(|s| s.len() >= 3), "bounties");
    }

    #[test]
    fn store_names_in_words() {
        assert_eq!(words("EvilBaroArmourA"), "Evil Baro Armour A");
        assert_eq!(words("MPVNidusPrimeSinglePack"), "MPV Nidus Prime Single Pack");
        assert_eq!(words("PrimeScarfDItem"), "Prime Scarf D Item");
        assert_eq!(words("Plain"), "Plain");
    }

    #[test]
    fn bounties_from_the_game() {
        let ws = json!({ "SyndicateMissions": [
            { "Tag": "CetusSyndicate", "Activation": { "$date": { "$numberLong": "1793495445687" } }, "Expiry": { "$date": { "$numberLong": "1793504445687" } }, "Jobs": [
                { "jobType": "/Lotus/Types/Gameplay/Eidolon/Jobs/AttritionBountyCap", "rewards": "/Lotus/Types/Game/MissionDecks/EidolonJobMissionRewards/TierATableCRewards", "masteryReq": 0, "minEnemyLevel": 5, "maxEnemyLevel": 15, "xpAmounts": [470, 470, 470] },
                { "jobType": "/Lotus/Types/Gameplay/Eidolon/Jobs/SomethingNew", "masteryReq": 3, "minEnemyLevel": 30, "maxEnemyLevel": 50, "xpAmounts": [600] },
                { "jobType": "/Lotus/Types/Gameplay/Eidolon/Jobs/Narmer/AttritionBountyExt", "masteryReq": 0, "minEnemyLevel": 50, "maxEnemyLevel": 70, "xpAmounts": [780] },
                { "rewards": "/Lotus/Types/Game/MissionDecks/DeimosMissionRewards/VaultBountyTierATableBRewards", "masteryReq": 5, "minEnemyLevel": 30, "maxEnemyLevel": 40, "xpAmounts": [2, 2, 2, 4], "locationTag": "ChamberB", "isVault": true }
            ] },
            { "Tag": "SteelMeridianSyndicate", "Expiry": { "$date": { "$numberLong": "1793504445687" } }, "Jobs": [] },
            { "Tag": "CetusSyndicate", "Activation": { "$date": { "$numberLong": "1793504445687" } }, "Expiry": { "$date": { "$numberLong": "1793513445687" } }, "Jobs": [
                { "jobType": "/Lotus/Types/Gameplay/Eidolon/Jobs/Next", "minEnemyLevel": 5, "maxEnemyLevel": 15 }
            ] }
        ] });
        let names = job_names(&json!({ "/lotus/types/gameplay/eidolon/jobs/attritionbountycap": { "value": "Capture Their Leader" }, "/lotus/language/other": { "value": "x" } }));
        assert_eq!(names.as_object().unwrap().len(), 1, "only the bounties' names are kept");
        let s = syndicates(&ws, &names, 1_793_500_000_000);
        assert_eq!(s.len(), 1, "only the places with bounties, and only the rotation running now");
        let next = syndicates(&ws, &names, 1_793_505_000_000);
        assert_eq!(next[0]["expiry"], "2026-11-01T06:10:45.687Z", "once it starts, the next rotation");
        assert_eq!(s[0]["syndicate"], "Ostrons");
        assert_eq!(s[0]["expiry"], "2026-11-01T03:40:45.687Z");
        let j = &s[0]["jobs"];
        assert_eq!(j[0]["type"], "Capture Their Leader");
        assert_eq!(j[0]["enemyLevels"], json!([5, 15]));
        assert_eq!(j[0]["standingStages"], json!([470, 470, 470]));
        assert_eq!(j[1]["type"], "Bounty", "a job the table doesn't name yet");
        assert_eq!(j[1]["minMR"], 3);
        assert_eq!(j[2]["timeBound"], "day", "Narmer on the Plains");
        assert!(j[0]["timeBound"].is_null());
        assert_eq!(j[3]["type"], "Isolation Vault Chamber B");
        assert_eq!(j[3]["isVault"], true);
    }

    #[test]
    fn baro_varzia_and_the_clocks_from_the_game() {
        let at = 1_793_491_200_000_i64; // 2026-11-01 00:00 UTC
        let ws = json!({
            "VoidTraders": [{ "Activation": { "$date": { "$numberLong": "1793400000000" } }, "Expiry": { "$date": { "$numberLong": "1793600000000" } }, "Node": "MercuryHUB", "Manifest": [{ "ItemType": "/Lotus/StoreItems/Upgrades/Mods/Rifle/Expert/WeaponFireDamageModExpert", "PrimePrice": 350, "RegularPrice": 110000 }] }],
            "PrimeVaultTraders": [{ "Activation": { "$date": { "$numberLong": "1793400000000" } }, "Expiry": { "$date": { "$numberLong": "1795000000000" } }, "Node": "TennoConHUB2", "Manifest": [{ "ItemType": "/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionA", "RegularPrice": 1 }] }],
            "SyndicateMissions": [{ "Tag": "CetusSyndicate", "Expiry": { "$date": { "$numberLong": "1793494800000" } } }]
        });
        let nodes = json!({ "MercuryHUB": { "value": "Larunda Relay (Mercury)" } });
        let p = parts(&ws, &nodes, &json!({}), at);
        assert_eq!(p["voidTrader"]["location"], "Larunda Relay (Mercury)");
        assert_eq!(p["voidTrader"]["inventory"][0]["ducats"], 350);
        assert_eq!(p["vaultTrader"]["inventory"][0]["credits"], 1);
        assert_eq!(p["earthCycle"]["state"], "day", "midnight UTC is the start of an Earth day");
        assert_eq!(p["earthCycle"]["expiry"], "2026-11-01T04:00:00.000Z");
        // Bounties end at 01:00, so night runs from 00:10: at 00:00 it's still day.
        assert_eq!((p["cetusCycle"]["state"].as_str(), p["cetusCycle"]["expiry"].as_str()), (Some("day"), Some("2026-11-01T00:10:00.000Z")));
        assert_eq!(p["cambionCycle"]["state"], "fass");
        assert!(p["fissures"].as_array().unwrap().is_empty());
    }

    #[test]
    fn reads_fissures_and_storms_in_the_apis_shape() {
        let ws = json!({
            "ActiveMissions": [
                { "_id": { "$oid": "abc" }, "Region": 9, "Activation": { "$date": { "$numberLong": "1793490000000" } }, "Expiry": { "$date": { "$numberLong": "1793497200000" } }, "Node": "SolNode125", "MissionType": "MT_DEFENSE", "Modifier": "VoidT2", "Hard": true },
                { "_id": { "$oid": "x" }, "Expiry": { "$date": { "$numberLong": "1793497200000" } }, "Node": "SolNode1", "MissionType": "MT_CAPTURE", "Modifier": "Nonsense" }
            ],
            "VoidStorms": [ { "_id": { "$oid": "s1" }, "Node": "CrewBattleNode519", "Expiry": { "$date": { "$numberLong": "1793497200000" } }, "ActiveMissionTier": "VoidT1" } ]
        });
        let nodes = json!({
            "SolNode125": { "value": "Stephano (Uranus)", "enemy": "Grineer", "type": "Defense" },
            "CrewBattleNode519": { "value": "Kasio's Rest (Neptune Proxima)", "enemy": "Corpus", "type": "Skirmish" }
        });
        let missions = json!({ "MT_DEFENSE": { "value": "Defense" } });
        let fs = parse(&ws, &nodes, &missions);
        assert_eq!(fs.len(), 2, "an unknown tier is left out");
        assert_eq!(fs[0]["node"], "Stephano (Uranus)");
        assert_eq!((fs[0]["tier"].as_str(), fs[0]["tierNum"].as_u64(), fs[0]["isHard"].as_bool()), (Some("Meso"), Some(2), Some(true)));
        assert_eq!(fs[0]["expiry"], "2026-11-01T01:40:00.000Z");
        assert_eq!((fs[1]["missionType"].as_str(), fs[1]["isStorm"].as_bool(), fs[1]["tier"].as_str()), (Some("Skirmish"), Some(true), Some("Lith")));
    }
}
