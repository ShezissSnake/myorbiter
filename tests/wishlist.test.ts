import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { crackableFirst, crackableNow, dropSpots, farmFor, openEras, partOdds, relicsFor, wishItem, wishlistEras } from "../src/lib/core/wishlist";
import type { Bundle, Fissure, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number): InventoryRow => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const SYS = "Rhino Prime Systems Blueprint";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1,
  inventory,
  catalog: [{ uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [
    { uniqueName: "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeBlueprint", name: "Blueprint", ducats: 100, itemCount: 1 },
    { uniqueName: "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeSystemsComponent", name: "Systems", ducats: 45, itemCount: 1 },
  ] }],
  relics: [
    { uniqueName: "/Relic/R1Bronze", name: "Axi R1 Intact", vaulted: false, rewards: [{ name: SYS, rarity: "Rare", chance: 2 }, { name: "Rhino Prime Blueprint", rarity: "Common", chance: 25.33 }], drops: [{ location: "Void/Mot (Survival), Rotation C", chance: 10, rarity: "Uncommon" }, { location: "Eris/Phalan (Interception), Rotation B", chance: 14.29, rarity: "Uncommon" }] },
    { uniqueName: "/Relic/R1Platinum", name: "Axi R1 Radiant", vaulted: false, rewards: [{ name: SYS, rarity: "Rare", chance: 10 }, { name: "Rhino Prime Blueprint", rarity: "Common", chance: 16.67 }] },
  ],
  prices: { prices: { [SYS]: 30, "Rhino Prime Blueprint": 20 }, max_rank_prices: {} },
});

test("odds of a part from the relics you hold, each copy at its own refinement", () => {
  const m = buildModel(bundle([inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", 2), inv("/Relic/R1Platinum", "Axi R1 Radiant", "relic", 1)]));
  const [r] = relicsFor(m, SYS);
  assert.deepEqual([r.base, r.total, r.best, r.bestRefinement], ["Axi R1", 3, 10, "Radiant"]);
  // 1 − 0.98² × 0.9
  assert.ok(Math.abs(partOdds(m, SYS) - (1 - 0.98 ** 2 * 0.9)) < 1e-9);
  assert.equal(partOdds(m, "Something Else"), 0);
  // Needing two: both Intact copies give it, or one of them and the Radiant one.
  const p2 = 0.02 * 0.02 * 0.9 + 2 * 0.02 * 0.98 * 0.1 + 0.02 * 0.02 * 0.1;
  assert.ok(Math.abs(partOdds(m, SYS, 2) - p2) < 1e-9);
});

test("a wished-for item lists its missing parts, the odds of finishing from your relics, and the buy cost", () => {
  const m = buildModel(bundle([inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", 1)]));
  const w = wishItem(m, RHINO)!;
  assert.deepEqual(w.missing.map((p) => p.name), ["Rhino Prime Blueprint", SYS]);
  assert.equal(w.odds, 0, "one crack gives one reward: a single relic can't give both parts");
  const two = wishItem(buildModel(bundle([inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", 2)])), RHINO)!;
  assert.ok(Math.abs(two.odds! - 2 * 0.2533 * 0.02) < 1e-9, "one copy gives the blueprint, the other the systems");
  assert.equal(w.buyCost, 50);
  assert.deepEqual(wishlistEras(m, [RHINO]).get("Axi")?.map((x) => x.relic), ["Axi R1", "Axi R1"]);
});

test("where to farm a relic you don't hold: the best spots first", () => {
  const m = buildModel(bundle([]));
  assert.deepEqual(farmFor(m, SYS).map((s) => [s.relic, s.location]), [["Axi R1", "Eris/Phalan (Interception), Rotation B"], ["Axi R1", "Void/Mot (Survival), Rotation C"]]);
  assert.equal(farmFor(buildModel(bundle([inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", 1)])), SYS).length, 0, "nothing to farm when you hold it");
});

test("a part's drop spots: each place once, its rotations as one at the best chance", () => {
  const spots = dropSpots([
    { location: "Deimos/Recall: Dactolyst (The Perita Rebellion), Rotation A", chance: 5.71 },
    { location: "Deimos/Recall: Dactolyst (The Perita Rebellion), Rotation B", chance: 7 },
    { location: "Deimos/The Guilty (The Perita Rebellion), Rotation A", chance: 5.71 },
  ]);
  assert.deepEqual(spots, [
    { location: "Deimos/Recall: Dactolyst (The Perita Rebellion)", chance: 7 },
    { location: "Deimos/The Guilty (The Perita Rebellion)", chance: 5.71 },
  ]);
});

test("the wishlist puts what you can crack for right now first (Omnia counts for any era)", () => {
  const m = buildModel(bundle([inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", 1)]));
  const rhino = wishItem(m, RHINO)!;
  const none = { ...rhino, c: { ...rhino.c, unique: "/Other" }, missing: [] };
  const f = (tier: string): Fissure => ({ id: tier, node: "Mot (Void)", missionType: "Survival", enemy: "Corrupted", tier, tierNum: 4, isStorm: false, isHard: false, expiry: "2099-01-01T00:00:00Z" });
  assert.deepEqual(crackableNow(rhino, openEras([f("Lith")])), []);
  assert.deepEqual(crackableNow(rhino, openEras([f("Axi")])), ["Axi R1"]);
  assert.deepEqual(crackableNow(rhino, openEras([f("Omnia")])), ["Axi R1"]);
  assert.deepEqual(crackableFirst([none, rhino], openEras([f("Axi")])).map((w) => w.c.unique), [RHINO, "/Other"]);
  assert.deepEqual(crackableFirst([none, rhino], openEras([])).map((w) => w.c.unique), ["/Other", RHINO], "otherwise in the order you starred them");
});
