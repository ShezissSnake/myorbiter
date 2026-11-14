// Whether you need an invasion's or an alert's reward (core/rewardNeed.ts): the reward screen's
// marks, from the same rules (pick.ts for a prime part, worldNeeds.ts for the rest), and nothing
// where there is no record to go by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { invasionNeeds, invasionRares, type Invasion } from "../src/lib/core/invasions";
import { anyMark, markWords, rewardMarks } from "../src/lib/core/rewardNeed";
import { scoreCards } from "../src/lib/core/pick";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const DERA = "/Lotus/Weapons/Corpus/DeraVandal";
const BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/DeraVandalBarrel";
const STOCK = "/Lotus/Types/Recipes/Weapons/WeaponParts/DeraVandalStock";
const CATALYST = "/Lotus/StoreItems/Types/Recipes/Components/OrokinCatalystBlueprint";
const CELL = "/Lotus/StoreItems/Types/Items/MiscItems/OrokinCell";
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [
    { uniqueName: DERA, name: "Dera Vandal", category: "Primary", masterable: true, components: [{ uniqueName: BARREL, name: "Barrel", itemCount: 1 }, { uniqueName: STOCK, name: "Stock", itemCount: 1 }] } as CatalogItem,
    { uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [
      { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 },
      { uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 },
    ] } as CatalogItem,
  ],
  relics: [],
  prices: { prices: {}, max_rank_prices: {} },
});
const invasion: Invasion = {
  id: "i1", node: "Cerberus (Pluto)",
  attacker: { faction: "Grineer", reward: { countedItems: [{ uniqueName: BARREL, type: "Dera Vandal Barrel", count: 1 }] } },
  defender: { faction: "Corpus", reward: { countedItems: [{ uniqueName: CATALYST, type: "Orokin Catalyst Blueprint", count: 1 }] } },
};

test("an invasion's part you need: marked need, for the item it builds, with why", () => {
  const m = buildModel(bundle([]));
  const [n] = invasionNeeds(m, [invasion]);
  const k = rewardMarks(m, { uniqueName: n.uniqueName, name: n.reward }, []);
  assert.deepEqual(k.need, { item: "Dera Vandal", whole: false, have: 0, needed: 1 });
  const [w] = markWords(k);
  assert.equal(w.text, "need · Dera Vandal");
  assert.equal(w.tone, "warn", "a needed reward stands out");
  assert.match(w.why, /^A part for Dera Vandal, which you haven't built or mastered/);
});

test("the same part once you hold it, or the item is mastered: no need; held says so", () => {
  const held = buildModel(bundle([inv(BARREL, "Dera Vandal Barrel", "resource", 1)]));
  const k = rewardMarks(held, { uniqueName: BARREL, name: "Dera Vandal Barrel" }, []);
  assert.equal(k.need, null);
  assert.equal(k.held, 1);
  assert.deepEqual(markWords(k).map((w) => w.text), ["held · 1"]);
  const mastered = buildModel(bundle([inv(DERA, "Dera Vandal", "weapon", 0, { mastered: true })]));
  const m2 = rewardMarks(mastered, { uniqueName: STOCK, name: "Dera Vandal Stock" }, []);
  assert.equal(m2.need, null);
  assert.equal(anyMark(m2), false, "mastered, none held: nothing to say");
});

test("on the wishlist: the item it builds is starred", () => {
  const m = buildModel(bundle([]));
  const k = rewardMarks(m, { uniqueName: BARREL, name: "Dera Vandal Barrel" }, [DERA]);
  assert.equal(k.wish, "Dera Vandal");
  assert.deepEqual(markWords(k).map((w) => w.text), ["need · Dera Vandal", "wishlist"]);
  assert.equal(rewardMarks(m, { uniqueName: BARREL, name: "Dera Vandal Barrel" }, []).wish, null);
});

test("a resource or a reward with no record: no marks, never a guess", () => {
  const m = buildModel(bundle([inv(CELL, "Orokin Cell", "resource", 40)]));
  assert.equal(anyMark(rewardMarks(m, { uniqueName: CELL, name: "Orokin Cell" }, [])), false, "a resource, held or not");
  assert.equal(anyMark(rewardMarks(m, { name: "Orokin Reactor Blueprint" }, [])), false, "an alert's reward by name only, unknown to the catalog");
  assert.equal(anyMark(rewardMarks(m, { uniqueName: "/Lotus/Types/Items/Research/EnergyComponent", name: "Fieldron" }, [])), false);
  // A blueprint the data knows by its path, not one of yours: no need, nothing held.
  const rare = invasionRares([invasion]).find((r) => r.reward === "Orokin Catalyst Blueprint")!;
  assert.equal(anyMark(rewardMarks(m, rare.item, [])), false);
  const holding = buildModel(bundle([inv("/Lotus/Types/Recipes/Components/OrokinCatalystBlueprint", "Orokin Catalyst Blueprint", "blueprint", 2)]));
  assert.deepEqual(markWords(rewardMarks(holding, rare.item, [])).map((w) => w.text), ["held · 2"]);
});

test("a prime part is decided as the reward screen decides it", () => {
  const m = buildModel(bundle([]));
  const k = rewardMarks(m, { name: "Rhino Prime Systems Blueprint" }, []);
  const [card] = scoreCards(m, ["Rhino Prime Systems Blueprint"]);
  assert.equal(!!k.need, card.needed);
  assert.equal(k.need?.item, card.neededFor);
  const done = buildModel(bundle([inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })]));
  assert.equal(rewardMarks(done, { name: "Rhino Prime Systems Blueprint" }, []).need, null);
  assert.equal(scoreCards(done, ["Rhino Prime Systems Blueprint"])[0].needed, false);
});
