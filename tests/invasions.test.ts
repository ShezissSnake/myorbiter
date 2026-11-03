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
});

test("not flagged once you've mastered or built the item, already hold the part, or the invasion is over", () => {
  assert.deepEqual(invasionNeeds(buildModel(bundle([inv(DERA, "Dera Vandal", "weapon", 0, { mastered: true })])), [invasion()]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([inv(DERA, "Dera Vandal", "weapon", 1)])), [invasion()]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([inv(BARREL, "Dera Vandal Barrel", "resource", 1)])), [invasion()]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([])), [invasion(true)]), []);
  assert.deepEqual(invasionNeeds(buildModel(bundle([])), null), []);
});

test("invasions paying a rare reward are flagged without an inventory, one per invasion and reward", async () => {
  const { invasionRares } = await import("../src/lib/core/invasions");
  const rare: Invasion = {
    id: "i2", node: "Kiliken (Venus)", completion: 40,
    attacker: { faction: "Grineer", reward: { countedItems: [{ uniqueName: "/Lotus/StoreItems/Types/Recipes/Components/OrokinReactorBlueprint", type: "Orokin Reactor Blueprint", count: 1 }] } },
    defender: { faction: "Corpus", reward: { countedItems: [{ uniqueName: "/Lotus/StoreItems/Types/Recipes/Components/FormaBlueprint", type: "Forma Blueprint", count: 3 }] } },
  };
  const exilus: Invasion = { id: "i3", node: "Cerberus (Pluto)", vsInfestation: true, attacker: { faction: "Infested", reward: null }, defender: { faction: "Corpus", reward: { countedItems: [{ uniqueName: "x", type: "Exilus Weapon Adapter Blueprint", count: 1 }] } } };
  const got = invasionRares([invasion(), rare, exilus, { ...rare, id: "i4", completed: true }]);
  assert.deepEqual(got.map((r) => [r.reward, r.side]), [["Orokin Reactor Blueprint", "Grineer"], ["3 × Forma Blueprint", "Corpus"], ["Exilus Weapon Adapter Blueprint", "Corpus"]]);
  assert.equal(got[0].key, "i2|/Lotus/StoreItems/Types/Recipes/Components/OrokinReactorBlueprint");
  assert.equal(got[0].completion, 40);
  assert.deepEqual(invasionRares(null), []);
});
