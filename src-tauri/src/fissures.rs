//! Void fissures straight from the game's own worldstate (content.warframe.com), for when
//! api.warframestat.us can't answer: it was down for hours on 1 Nov 2026 ("WorldState Not
//! Found"), and Home then showed no fissures at all. The game's file names nodes and mission types
//! by their internal ids ("SolNode125", "MT_DEFENSE"); WFCD's node and mission-type tables turn
//! those into what the API would have said, so the page can't tell the difference. The tables are
//! kept a week in orbiter's config folder.
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const WORLDSTATE: &str = "https://content.warframe.com/dynamic/worldState.php";
const NODES: &str = "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/solNodes.json";
const MISSIONS: &str = "https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data/missionTypes.json";
const TABLES: &str = "worldstate-tables.json";
const TABLES_FRESH: u64 = 7 * 24 * 3600;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn get(url: &str) -> Result<Value, String> {
    crate::http_agent()
        .get(url)
        .set("User-Agent", crate::market::USER_AGENT)
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
        if now().saturating_sub(c["at"].as_u64().unwrap_or(0)) < TABLES_FRESH {
            return Ok(c.clone());
        }
    }
    match (get(NODES), get(MISSIONS)) {
        (Ok(nodes), Ok(missions)) => {
            let v = json!({ "at": now(), "nodes": nodes, "missions": missions });
            let _ = fs::create_dir_all(dir);
            let _ = crate::write_atomic(&path, &serde_json::to_vec(&v).unwrap_or_default(), false);
            Ok(v)
        }
        (Err(e), _) | (_, Err(e)) => cached.ok_or(e),
    }
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

/// The fissures from the game's worldstate, or why not.
pub fn from_game(dir: &Path) -> Result<Vec<Value>, String> {
    let t = tables(dir)?;
    let ws = get(WORLDSTATE)?;
    Ok(parse(&ws, &t["nodes"], &t["missions"]))
}

#[cfg(test)]
mod tests {
    use super::*;

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
