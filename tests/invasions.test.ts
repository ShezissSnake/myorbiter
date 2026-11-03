import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { invasionNeeds, type Invasion } from "../src/lib/core/invasions";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const DERA = "/Lotus/Weapons/Corpus/DeraVandal";
const BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/DeraVandalBarrel";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [{ uniqueName: DERA, name: "Dera Vandal", category: "Primary", masterable: true, components: [{ uniqueName: BARREL, name: "Barrel", itemCount: 1 }] } as CatalogItem],
  relics: [],
  prices: { prices: {}, max_rank_prices: {} },
});
const invasion = (completed = false): Invasion => ({
  id: "i1", node: "Gulliver (Phobos)", completed,
  attacker: { faction: "Grineer", reward: { countedItems: [{ uniqueName: "/Lotus/Types/Items/Research/EnergyComponent", type: "Fieldron", count: 3 }] } },
  defender: { faction: "Corpus", reward: { countedItems: [{ uniqueName: BARREL, type: "Dera Vandal Barrel", count: 1 }] } },
});

test("an invasion rewarding a part for something you haven't mastered is flagged, with the side to take", () => {
  const [n, ...rest] = invasionNeeds(buildModel(bundle([])), [invasion()]);
  assert.equal(rest.length, 0, "Fieldron builds nothing you master");
  assert.deepEqual([n.reward, n.item, n.side, n.node], ["Dera Vandal Barrel", "Dera Vandal", "Corpus", "Gulliver (Phobos)"]);
  assert.equal(n.key, `i1|${BARREL}`);
  assert.deepEqual([n.attacker, n.defender], ["Grineer", "Corpus"], "both sides, for the tug-of-war bar");
});

test("not flagged once you've mastered or built the item, already hold the part, or the invasion is over", () => {
  assert.deepEqual(invasionNeeds(buildModel(bundle([inv(DERA, "Dera Vandal", "weapon", 0, { mastered: true })])), [invasion()]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([inv(DERA, "Dera Vandal", "weapon", 1)])), [invasion()]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([inv(BARREL, "Dera Vandal Barrel", "resource", 1)])), [invasion()]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([])), [invasion(true)]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([])), null), []);
});
