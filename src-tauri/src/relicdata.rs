//! Relics as the game has them now: what each one holds at each refinement, and which ones drop
//! somewhere (the rest are vaulted). TennoScope's relic list lags a new Prime Access by days or
//! weeks, so orbiter reads the official drop tables itself, through drops.warframestat.us (which
//! republishes them within a day or two), and lays them over TennoScope's list (see relicData.ts).
//!
//! Checked at most twice a day: a tiny `info.json` says whether the tables changed, and only then
//! are the two big files (about 7 MB) read again. WFCD's relic list gives each relic's in-game path
//! (Varzia's stock and your inventory go by path). The result is kept in orbiter's config folder,
//! so it's there offline and on the next start.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DROPS: &str = "https://drops.warframestat.us/data";
const WFCD_RELICS: &str = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Relics.json";
/// How long a check holds: the tables change with updates, a few times a month.
const FRESH: u64 = 12 * 3600;
const FILE: &str = "relic-data.json";

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn get(url: &str, timeout: u64) -> Result<Value, String> {
    crate::http_agent()
        .get(url)
        .set("User-Agent", crate::market::USER_AGENT)
        .timeout(Duration::from_secs(timeout))
        .call()
        .map_err(|e| format!("{url}: {e}"))?
        .into_json::<Value>()
        .map_err(|e| format!("{url}: {e}"))
}

/// "ETERNA" → "Eterna"; "A13" stays.
fn title(code: &str) -> String {
    if code.chars().any(|c| c.is_ascii_digit()) || code.len() <= 3 {
        return code.to_string();
    }
    let mut out = String::new();
    for (i, c) in code.chars().enumerate() {
        if i == 0 { out.extend(c.to_uppercase()) } else { out.extend(c.to_lowercase()) }
    }
    out
}

/// "Mercury/Apollodorus (<b>Survival</b>), Rotation B" → without the markup.
fn plain(place: &str) -> String {
    place.replace("<b>", "").replace("</b>", "")
}

/// The compact form the page uses: relics with their rewards, drop places per relic, paths.
fn compact(relics: &Value, all: &Value, wfcd: Option<&Value>, hash: &str, modified: u64) -> Value {
    let mut list = Vec::new();
    for r in relics["relics"].as_array().into_iter().flatten() {
        let (Some(tier), Some(code), Some(state)) = (r["tier"].as_str(), r["relicName"].as_str(), r["state"].as_str()) else { continue };
        let rewards: Vec<Value> = r["rewards"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|w| Some(json!({ "name": w["itemName"].as_str()?, "chance": w["chance"].as_f64()?, "rarity": w["rarity"].as_str().unwrap_or("") })))
            .collect();
        list.push(json!({ "name": format!("{tier} {} {state}", title(code)), "rewards": rewards }));
    }
    let mut drops: Map<String, Value> = Map::new();
    for d in all.as_array().into_iter().flatten() {
        let Some(item) = d["item"].as_str() else { continue };
        let Some(base) = item.strip_suffix(" Relic") else { continue };
        let entry = json!({ "location": plain(d["place"].as_str().unwrap_or("")), "chance": d["chance"].as_f64().unwrap_or(0.0), "rarity": d["rarity"].as_str().unwrap_or("") });
        drops.entry(base.to_string()).or_insert_with(|| Value::Array(Vec::new())).as_array_mut().expect("array").push(entry);
    }
    // Best chance first, as TennoScope's are.
    for v in drops.values_mut() {
        if let Some(a) = v.as_array_mut() {
            a.sort_by(|x, y| y["chance"].as_f64().unwrap_or(0.0).total_cmp(&x["chance"].as_f64().unwrap_or(0.0)));
        }
    }
    let mut paths: Map<String, Value> = Map::new();
    for r in wfcd.and_then(|w| w.as_array()).into_iter().flatten() {
        if let (Some(u), Some(n)) = (r["uniqueName"].as_str(), r["name"].as_str()) {
            paths.insert(u.to_string(), Value::String(n.to_string()));
        }
    }
    json!({ "hash": hash, "modified": modified, "checkedAt": now(), "relics": list, "drops": drops, "paths": paths, "bounties": bounties(all) })
}

/// The bounty reward tables the worldstate doesn't carry: the Zariman's, Albrecht's
/// Laboratories' (Cavia) and Höllvania's (1999). Their missions rotate in game, but each level
/// tier always pays from the same table, so these are what the Bounties card shows on hover.
/// `{ place, level, rotation, rewards }`, best chance first; place is zariman, cavia, hex, cetus,
/// fortuna, necralisk or vault (the Cambion Drift's Isolation Vaults). In the open worlds the
/// rotation (A, B or C) is which of three tables the game is paying from this time (a bounty's
/// reward path names it: `TierATableCRewards`); the page puts them together where it can't tell.
fn bounties(all: &Value) -> Value {
    // The open worlds' tables too: when the bounties come from the game's own worldstate (the API
    // is down), each one's rewards are its level's table.
    const KINDS: [(&str, &str); 7] = [
        ("Zariman Bounty", "zariman"),
        ("Entrati Lab Bounty", "cavia"),
        ("WF1999 Bounty", "hex"),
        ("Cetus Bounty", "cetus"),
        ("Orb Vallis Bounty", "fortuna"),
        ("Cambion Drift Bounty", "necralisk"),
        ("Isolation Vault", "vault"),
    ];
    let mut tiers: Vec<(String, String, String, Vec<Value>)> = Vec::new();
    for d in all.as_array().into_iter().flatten() {
        let (Some(place), Some(item)) = (d["place"].as_str(), d["item"].as_str()) else { continue };
        let place = plain(place);
        // The vaults' Arcana table is a bonus on top of the vault's own: the bounty's pool is the latter.
        if place.contains("Arcana Isolation Vault") {
            continue;
        }
        let Some((kind, key)) = KINDS.iter().find(|(k, _)| place.contains(k)) else { continue };
        // "Zariman Ten Zero (Level  50 - 55 Zariman Bounty), Rotation C" → "50 - 55"
        let Some(level) = place.split("Level").nth(1).and_then(|r| r.split(kind).next()) else { continue };
        let level = level.split_whitespace().collect::<Vec<_>>().join(" ");
        let rotation = place.rsplit("Rotation ").next().filter(|_| place.contains("Rotation ")).unwrap_or("").trim().to_string();
        let reward = json!({ "name": item, "chance": d["chance"].as_f64().unwrap_or(0.0), "rarity": d["rarity"].as_str().unwrap_or("") });
        match tiers.iter_mut().find(|(p, l, r, _)| p == key && *l == level && *r == rotation) {
            Some((_, _, _, rewards)) => rewards.push(reward),
            None => tiers.push((key.to_string(), level, rotation, vec![reward])),
        }
    }
    let low = |level: &str| level.split(' ').next().and_then(|n| n.parse::<u32>().ok()).unwrap_or(0);
    tiers.sort_by(|a, b| a.0.cmp(&b.0).then(low(&a.1).cmp(&low(&b.1))).then(a.2.cmp(&b.2)));
    Value::Array(
        tiers
            .into_iter()
            .map(|(place, level, rotation, mut rewards)| {
                rewards.sort_by(|x, y| y["chance"].as_f64().unwrap_or(0.0).total_cmp(&x["chance"].as_f64().unwrap_or(0.0)));
                json!({ "place": place, "level": level, "rotation": rotation, "rewards": rewards })
            })
            .collect(),
    )
}

/// The relic data: from the cache while it's fresh (or when the site can't be reached), else read
/// again. `force`: check now whatever the age. Errors only when there's nothing at all.
pub fn relic_data(dir: &Path, force: bool) -> Result<Value, String> {
    let path = dir.join(FILE);
    let cached: Option<Value> = fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    // A cache from before the bounty tables (or the open worlds' ones) were kept is read again, once; it's still what's
    // used if the tables can't be reached.
    let complete = cached.as_ref().is_some_and(|c| c["bounties"].as_array().is_some_and(|b| b.iter().any(|t| t["place"] == "cetus" && t["rotation"].is_string())));
    if let Some(c) = cached.as_ref().filter(|_| complete) {
        if !force && now().saturating_sub(c["checkedAt"].as_u64().unwrap_or(0)) < FRESH {
            return Ok(c.clone());
        }
    }
    let info = match get(&format!("{DROPS}/info.json"), 15) {
        Ok(v) => v,
        Err(e) => return cached.ok_or(e),
    };
    let hash = info["hash"].as_str().unwrap_or("").to_string();
    let modified = info["modified"].as_u64().unwrap_or(0);
    if let Some(mut c) = cached.clone().filter(|_| complete) {
        if !hash.is_empty() && c["hash"].as_str() == Some(hash.as_str()) {
            c["checkedAt"] = json!(now());
            let _ = crate::write_atomic(&path, &serde_json::to_vec(&c).unwrap_or_default(), false);
            return Ok(c);
        }
    }
    let fetched = (|| -> Result<Value, String> {
        let relics = get(&format!("{DROPS}/relics.json"), 60)?;
        let all = get(&format!("{DROPS}/all.slim.json"), 90)?;
        // Paths only matter for relics TennoScope doesn't know yet; without them the rest works.
        let wfcd = get(WFCD_RELICS, 60).ok();
        Ok(compact(&relics, &all, wfcd.as_ref(), &hash, modified))
    })();
    match fetched {
        Ok(v) if v["relics"].as_array().is_some_and(|a| !a.is_empty()) => {
            let _ = crate::write_atomic(&path, &serde_json::to_vec(&v).unwrap_or_default(), false);
            Ok(v)
        }
        Ok(_) => cached.ok_or_else(|| "The drop tables came back empty".to_string()),
        Err(e) => cached.ok_or(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_names_relics_and_groups_drops() {
        let relics = json!({ "relics": [
            { "tier": "Lith", "relicName": "A13", "state": "Radiant", "rewards": [{ "itemName": "Steflos Prime Receiver", "chance": 10.0, "rarity": "Rare" }] },
            { "tier": "Requiem", "relicName": "ETERNA", "state": "Intact", "rewards": [{ "itemName": "Lohk", "chance": 9.5, "rarity": "Rare" }] },
            { "tier": "Requiem", "state": "Intact", "rewards": [] }
        ]});
        let all = json!([
            { "place": "Mercury/Apollodorus (<b>Survival</b>), Rotation B", "item": "Lith A13 Relic", "rarity": "Rare", "chance": 7.69 },
            { "place": "Void/Mot (<b>Survival</b>), Rotation C", "item": "Lith A13 Relic", "rarity": "Uncommon", "chance": 12.5 },
            { "place": "Somewhere", "item": "Forma Blueprint", "rarity": "Common", "chance": 50.0 }
        ]);
        let wfcd = json!([{ "uniqueName": "/Lotus/Types/Game/Projections/T1VoidProjectionSteflosPrimeABronze", "name": "Lith A13 Intact" }]);
        let v = compact(&relics, &all, Some(&wfcd), "h", 1);
        let names: Vec<&str> = v["relics"].as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["Lith A13 Radiant", "Requiem Eterna Intact"]);
        let drops = v["drops"]["Lith A13"].as_array().unwrap();
        assert_eq!(drops.len(), 2);
        assert_eq!(drops[0]["location"], "Void/Mot (Survival), Rotation C", "best chance first, markup gone");
        assert!(v["drops"].get("Forma Blueprint").is_none());
        assert_eq!(v["paths"]["/Lotus/Types/Game/Projections/T1VoidProjectionSteflosPrimeABronze"], "Lith A13 Intact");
    }

    #[test]
    fn bounties_group_by_place_and_tier() {
        let all = json!([
            { "place": "Zariman Ten Zero (<b>Level  60 - 65 Zariman Bounty</b>), Rotation C", "item": "1000 Endo", "rarity": "Uncommon", "chance": 20.34 },
            { "place": "Zariman Ten Zero (<b>Level  50 - 55 Zariman Bounty</b>), Rotation C", "item": "Aya", "rarity": "Rare", "chance": 8.7 },
            { "place": "Zariman Ten Zero (<b>Level  50 - 55 Zariman Bounty</b>), Rotation C", "item": "500 Endo", "rarity": "Uncommon", "chance": 17.39 },
            { "place": "Höllvania (<b>Level  55 - 60 WF1999 Bounty</b>), Rotation C", "item": "Ayatan Anasa", "rarity": "Rare", "chance": 5.0 },
            { "place": "Earth/Cetus (<b>Level 5 - 15 Cetus Bounty</b>), Rotation A", "item": "50 Endo", "rarity": "Uncommon", "chance": 20.0 },
            { "place": "Earth/Cetus (<b>Level 5 - 15 Cetus Bounty</b>), Rotation C", "item": "Vitality", "rarity": "Uncommon", "chance": 20.0 },
            { "place": "Deimos/Cambion Drift (<b>Level 30 - 40 Isolation Vault</b>), Rotation A", "item": "Fass Residue", "rarity": "Common", "chance": 20.0 },
            { "place": "Deimos/Cambion Drift (<b>Level 30 - 40 Arcana Isolation Vault</b>), Rotation A", "item": "Theorem Demulcent", "rarity": "Rare", "chance": 2.0 }
        ]);
        let b = bounties(&all);
        let tiers: Vec<(String, String)> = b.as_array().unwrap().iter().map(|t| (t["place"].as_str().unwrap().into(), t["level"].as_str().unwrap().into())).collect();
        let want = [("cetus", "5 - 15"), ("cetus", "5 - 15"), ("hex", "55 - 60"), ("vault", "30 - 40"), ("zariman", "50 - 55"), ("zariman", "60 - 65")];
        assert_eq!(tiers, want.map(|(p, l)| (p.to_string(), l.to_string())));
        assert_eq!((b[0]["rotation"].as_str(), b[1]["rotation"].as_str()), (Some("A"), Some("C")), "each of the three tables apart");
        assert_eq!(b[1]["rewards"][0]["name"], "Vitality");
        assert_eq!(b[4]["rewards"][0]["name"], "500 Endo", "best chance first");
        assert_eq!(b[3]["rewards"].as_array().unwrap().len(), 1, "not the vault's Arcana table");
    }

    /// Reads the real tables (network): `cargo test -p orbiter relicdata -- --ignored`.
    #[test]
    #[ignore]
    fn live_tables() {
        let dir = std::env::temp_dir().join(format!("orbiter-relic-test-{}", now()));
        let v = relic_data(&dir, true).expect("read");
        let relics = v["relics"].as_array().unwrap();
        assert!(relics.len() > 3000, "{} relics", relics.len());
        assert!(v["drops"].as_object().unwrap().len() > 20);
        assert!(v["paths"].as_object().unwrap().len() > 3000);
        eprintln!("{} relic entries, {} that drop, {} paths", relics.len(), v["drops"].as_object().unwrap().len(), v["paths"].as_object().unwrap().len());
        // A second call is served from the cache.
        let again = relic_data(&dir, false).expect("cached");
        assert_eq!(again["checkedAt"], v["checkedAt"]);
        let _ = fs::remove_dir_all(dir);
    }
}
