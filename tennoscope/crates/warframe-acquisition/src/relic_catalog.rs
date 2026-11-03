use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use crate::{CatalogError, CatalogIndex, RewardNeedle};

#[derive(Clone, Debug, Default)]
pub struct RelicRewardIndex {
    rewards: BTreeMap<String, BTreeSet<String>>,
    /// Rewards every relic of which is vaulted: out of the drop tables, so only relics already
    /// held (or Varzia's) can still give them.
    vaulted: BTreeSet<String>,
}

impl RelicRewardIndex {
    pub fn from_wfcd_json(bytes: &[u8]) -> Result<Self, CatalogError> {
        let records: Vec<RelicRecord> =
            serde_json::from_slice(bytes).map_err(|_| CatalogError::InvalidJson)?;
        let mut rewards = BTreeMap::new();
        // Per reward: (seen in any relic, seen in a relic still in the drop tables).
        let mut availability: BTreeMap<String, bool> = BTreeMap::new();
        for record in records {
            if !record
                .unique_name
                .starts_with("/Lotus/Types/Game/Projections/")
            {
                continue;
            }
            let names = record
                .rewards
                .into_iter()
                .map(|reward| reward.item.name.trim().to_owned())
                .filter(|name| !name.is_empty())
                .collect::<BTreeSet<_>>();
            // A record without the flag counts as farmable, so a gap in the data never claims
            // something is vaulted.
            let vaulted = record.vaulted == Some(true);
            for name in &names {
                let farmable = availability.entry(name.clone()).or_insert(false);
                *farmable |= !vaulted;
            }
            if !names.is_empty() {
                rewards.insert(record.unique_name, names);
            }
        }
        let vaulted = availability
            .into_iter()
            .filter_map(|(name, farmable)| (!farmable).then_some(name))
            .collect();
        Ok(Self { rewards, vaulted })
    }

    /// Every reward a relic in the index can drop, spelled as the relic tables and the reward
    /// screen spell it: "2X Forma Blueprint", "Lavos Prime Chassis Blueprint". A reward several
    /// relics share comes once per relic.
    pub fn reward_names(&self) -> impl Iterator<Item = &str> {
        self.rewards.values().flatten().map(String::as_str)
    }

    /// Whether every relic that drops this reward is vaulted.
    pub fn is_vaulted(&self, reward: &str) -> bool {
        self.vaulted.contains(reward.trim())
    }

    /// Every reward that only vaulted relics drop.
    pub fn vaulted_rewards(&self) -> &BTreeSet<String> {
        &self.vaulted
    }

    pub fn candidates_for_projection_paths(
        &self,
        projection_paths: &[String],
        catalog: &CatalogIndex,
    ) -> Vec<RewardNeedle> {
        projection_paths
            .iter()
            .filter_map(|path| self.rewards.get(path))
            .flatten()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter_map(|name| {
                RewardNeedle::from_paths(name.clone(), reward_catalog_paths(name, catalog)).ok()
            })
            .collect()
    }
}

fn reward_catalog_paths(name: &str, catalog: &CatalogIndex) -> Vec<String> {
    // Relic rewards conventionally add ` Blueprint` to component names. Prefer the component
    // identity even when the catalog also has an exact inventory-recipe alias for that wording.
    if let Some(component_name) = name.strip_suffix(" Blueprint") {
        let paths = catalog.paths_for_name(component_name);
        if !paths.is_empty() {
            return paths;
        }
    }
    let exact = catalog.paths_for_name(name);
    if !exact.is_empty() {
        return exact;
    }

    for alias in [
        crate::catalog::without_quantity(name),
        name.strip_suffix(" Blueprint"),
    ]
    .into_iter()
    .flatten()
    {
        let paths = catalog.paths_for_name(alias);
        if !paths.is_empty() {
            return paths;
        }
        if let Some(component_name) = alias.strip_suffix(" Blueprint") {
            let paths = catalog.paths_for_name(component_name);
            if !paths.is_empty() {
                return paths;
            }
        }
    }
    Vec::new()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelicRecord {
    unique_name: String,
    #[serde(default)]
    vaulted: Option<bool>,
    #[serde(default)]
    rewards: Vec<RelicReward>,
}

#[derive(Deserialize)]
struct RelicReward {
    item: RelicRewardItem,
}

#[derive(Deserialize)]
struct RelicRewardItem {
    name: String,
}

#[cfg(test)]
mod vaulted_tests {
    use super::RelicRewardIndex;

    #[test]
    fn a_reward_is_vaulted_only_when_every_relic_dropping_it_is() {
        let json = br#"[
            {"uniqueName": "/Lotus/Types/Game/Projections/A", "vaulted": true,
             "rewards": [{"item": {"name": "Rhino Prime Systems Blueprint"}}, {"item": {"name": "Forma Blueprint"}}]},
            {"uniqueName": "/Lotus/Types/Game/Projections/B", "vaulted": false,
             "rewards": [{"item": {"name": "Forma Blueprint"}}]},
            {"uniqueName": "/Lotus/Types/Game/Projections/C",
             "rewards": [{"item": {"name": "Paris Prime String"}}]}
        ]"#;
        let index = RelicRewardIndex::from_wfcd_json(json).expect("parses");
        assert!(index.is_vaulted("Rhino Prime Systems Blueprint"));
        assert!(!index.is_vaulted("Forma Blueprint"));
        // No flag in the data: never claimed vaulted.
        assert!(!index.is_vaulted("Paris Prime String"));
    }
}
