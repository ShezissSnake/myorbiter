//! Foundry recipes: what every blueprint takes, parts' own blueprints included (a Systems
//! blueprint takes Morphics, Plastids, Salvage…), which the item catalog doesn't carry. Without
//! them orbiter only knew a warframe's own blueprint, so a frame whose part blueprints you held
//! read "build it" even when building those parts needed resources from an event.
//!
//! Read from warframe-public-export-plus (DE's public export with names and rarities filled in,
//! MIT) on GitHub, at most once a week, and kept compact in orbiter's config folder:
//! `{ checkedAt, recipes: { result: { c: credits, i: [[path, count]] } }, names: { path: { n, img, r, k } } }`
//! where a name's `r` is the game's rarity (COMMON, UNCOMMON, RARE) and `k` is "chart" for the
//! star chart's resources and "world" for anything else (open worlds, events, fishing, mining).
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const EXPORT: &str = "https://raw.githubusercontent.com/calamity-inc/warframe-public-export-plus/senpai";
const FRESH: u64 = 7 * 24 * 3600;
const FILE: &str = "recipe-data.json";

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn get(url: &str) -> Result<Value, String> {
    crate::http_agent()
        .get(url)
        .set("User-Agent", crate::USER_AGENT)
        .timeout(Duration::from_secs(90))
        .call()
        .map_err(|e| format!("{url}: {e}"))?
        .into_json::<Value>()
        .map_err(|e| format!("{url}: {e}"))
}

/// Star-chart resources (Ferrite, Orokin Cell, Morphics…) live under MiscItems; the rest (Narmer
/// Isoplast, Lazulite Toroid, fish and gems) come from open worlds and events.
fn kind(path: &str) -> &'static str {
    if path.starts_with("/Lotus/Types/Items/MiscItems/") || path.starts_with("/Lotus/Types/Items/Research/") {
        "chart"
    } else {
        "world"
    }
}

fn compact(recipes: &Value, resources: &Value, dict: &Value) -> Value {
    let mut out = Map::new();
    let mut used = std::collections::BTreeSet::new();
    for r in recipes.as_object().into_iter().flat_map(|o| o.values()) {
        let Some(result) = r["resultType"].as_str() else { continue };
        let ingredients: Vec<Value> = r["ingredients"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|i| {
                let t = i["ItemType"].as_str()?;
                used.insert(t.to_string());
                Some(json!([t, i["ItemCount"].as_u64().unwrap_or(1)]))
            })
            .collect();
        if ingredients.is_empty() {
            continue;
        }
        // Several blueprints can make the same thing (a market one and a clan one): the first is kept.
        out.entry(result.to_string()).or_insert_with(|| json!({ "c": r["buildPrice"].as_u64().unwrap_or(0), "i": ingredients }));
    }
    let mut names = Map::new();
    for path in used {
        let Some(res) = resources.get(&path) else { continue };
        let Some(name) = res["name"].as_str().and_then(|k| dict[k].as_str()) else { continue };
        let img = res["icon"].as_str().and_then(|i| i.rsplit('/').next()).unwrap_or("");
        names.insert(path.clone(), json!({ "n": name, "img": img, "r": res["rarity"].as_str().unwrap_or(""), "k": kind(&path) }));
    }
    json!({ "checkedAt": now(), "recipes": out, "names": names })
}

/// The recipes: from the cache while it's under a week old (or when GitHub can't be reached),
/// else read again. Errors only when there's nothing at all.
pub fn recipe_data(dir: &Path) -> Result<Value, String> {
    let path = dir.join(FILE);
    let cached: Option<Value> = fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    if let Some(c) = &cached {
        if now().saturating_sub(c["checkedAt"].as_u64().unwrap_or(0)) < FRESH {
            return Ok(c.clone());
        }
    }
    let fetched = (|| -> Result<Value, String> {
        let recipes = get(&format!("{EXPORT}/ExportRecipes.json"))?;
        let resources = get(&format!("{EXPORT}/ExportResources.json"))?;
        let dict = get(&format!("{EXPORT}/dict.en.json"))?;
        Ok(compact(&recipes, &resources, &dict))
    })();
    match fetched {
        Ok(v) if v["recipes"].as_object().is_some_and(|o| o.len() > 100) => {
            let _ = fs::create_dir_all(dir);
            let _ = crate::write_atomic(&path, &serde_json::to_vec(&v).unwrap_or_default(), false);
            Ok(v)
        }
        Ok(_) => cached.ok_or_else(|| "The recipes came back empty".to_string()),
        Err(e) => cached.ok_or(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_keeps_ingredients_and_names_resources() {
        let recipes = json!({
            "/Lotus/Types/Recipes/WarframeRecipes/IronframeChassisBlueprint": {
                "resultType": "/Lotus/Types/Recipes/WarframeRecipes/IronframeChassisComponent", "buildPrice": 15000,
                "ingredients": [
                    { "ItemType": "/Lotus/Types/Gameplay/Venus/Resources/ArachnoidCamperTerraItem", "ItemCount": 2 },
                    { "ItemType": "/Lotus/Types/Items/MiscItems/Rubedo", "ItemCount": 2300 }
                ]
            },
            "/Lotus/Types/Game/Nothing": { "resultType": "/Lotus/Types/Game/X", "ingredients": [] }
        });
        let resources = json!({
            "/Lotus/Types/Gameplay/Venus/Resources/ArachnoidCamperTerraItem": { "name": "/Lotus/Language/T", "icon": "/Lotus/Interface/Icons/CrpArachnoidPowerCoreCamperTerra.png", "rarity": "RARE" },
            "/Lotus/Types/Items/MiscItems/Rubedo": { "name": "/Lotus/Language/R", "icon": "/Lotus/Interface/Icons/Rubedo.png", "rarity": "UNCOMMON" }
        });
        let dict = json!({ "/Lotus/Language/T": "Lazulite Toroid", "/Lotus/Language/R": "Rubedo" });
        let v = compact(&recipes, &resources, &dict);
        let r = &v["recipes"]["/Lotus/Types/Recipes/WarframeRecipes/IronframeChassisComponent"];
        assert_eq!(r["c"], 15000);
        assert_eq!(r["i"][1], json!(["/Lotus/Types/Items/MiscItems/Rubedo", 2300]));
        assert!(v["recipes"].get("/Lotus/Types/Game/X").is_none(), "nothing to build from: left out");
        let t = &v["names"]["/Lotus/Types/Gameplay/Venus/Resources/ArachnoidCamperTerraItem"];
        assert_eq!((t["n"].as_str(), t["img"].as_str(), t["k"].as_str()), (Some("Lazulite Toroid"), Some("CrpArachnoidPowerCoreCamperTerra.png"), Some("world")));
        assert_eq!(v["names"]["/Lotus/Types/Items/MiscItems/Rubedo"]["k"], "chart");
    }
}
