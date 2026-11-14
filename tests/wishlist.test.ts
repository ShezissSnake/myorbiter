import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { ODDS_COPIES, crackableFirst, crackableNow, dropSpots, farmFor, openEras, partOdds, relicsFor, wishItem, wishlistEras } from "../src/lib/core/wishlist";
import { masteryRows } from "../src/lib/core/views";
import { collection } from "../src/lib/core/collection";
import { readyTag, type RecipeData } from "../src/lib/core/buildPlan";
import type { Bundle, CatalogItem, Fissure, InventoryRow } from "../src/lib/core/types";

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

// What a wished item says about being ready to build is what Foundry and Mastery say for it: one
// function (readyTag), from the same read of the item.
const TESTBLADE = "/Lotus/Weapons/Tenno/Melee/Testblade";
const testblade = {
  uniqueName: TESTBLADE, name: "Testblade", category: "Melee", type: "Melee", masterable: true,
  components: [
    { uniqueName: "/Lotus/Types/Recipes/Weapons/TestbladeBlueprint", name: "Blueprint", itemCount: 1 },
    { uniqueName: "/Lotus/Types/Gameplay/NarmerSorties/NarmerIsoplast", name: "Narmer Isoplast", itemCount: 2 },
  ],
} as CatalogItem;
const kuva = { uniqueName: "/Lotus/Weapons/Grineer/KuvaLich/LongGuns/KuvaBramma", name: "Kuva Bramma", category: "Primary", type: "Bow", masterable: true } as CatalogItem;
const holdBlueprint = [inv("/Lotus/Types/Recipes/Weapons/TestbladeBlueprint", "Testblade Blueprint", "blueprint", 1)];
const LIVE = { fissures: null, resurgence: null, resurgenceExpiry: null };
const withRecipes = (inventory: InventoryRow[], catalog: CatalogItem[], recipes: RecipeData | null) =>
  buildModel({ observed_at: 1, inventory, catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } }, LIVE, null, null, null, recipes);
const NO_RECIPES: RecipeData = { checkedAt: 1, recipes: {}, names: {} };

test("a wished weapon the catalog gives no parts for is not 'Can build now'; it says how to get it", () => {
  const w = wishItem(withRecipes([], [kuva], null), kuva.uniqueName)!;
  assert.equal(w.c.buildable, false, "Foundry: nothing to build");
  assert.match(w.how ?? "", /Spawn a Kuva Lich/, "the card says how to get it, as Mastery does");
  assert.equal(w.how, masteryRows(withRecipes([], [kuva], null)).find((r) => r.name === "Kuva Bramma")!.acq.how);
  // A held one, or one with parts to get, has no such line.
  assert.equal(wishItem(withRecipes([], [testblade], null), TESTBLADE)!.how, null);
});

test("every part in hand but a resource short: Wishlist, Foundry and Mastery say the same", () => {
  const m = withRecipes(holdBlueprint, [testblade], NO_RECIPES);
  const w = wishItem(m, TESTBLADE)!;
  assert.deepEqual({ buildable: w.c.buildable, short: w.c.short, tier: w.c.tier }, { buildable: true, short: ["Narmer Isoplast"], tier: "hard" });
  const tag = readyTag(w.c);
  assert.equal(tag.label, "Parts ready · rare resources");
  assert.match(tag.title, /building needs Narmer Isoplast/);
  // The card's "Next step" is a sentence of its own: a full stop, no pointer to the tooltip's "open it".
  assert.match(tag.sentence, /^Every part in hand, but building needs Narmer Isoplast, from an open world or an event\.$/);
  for (const t of ["now", "farm", "hard", null] as const) assert.doesNotMatch(readyTag({ tier: t, short: t === "now" || t === null ? [] : ["X"] }).sentence, /Open it/);
  assert.match(readyTag({ tier: "now", short: [] }).sentence, /\.$/);
  const foundry = collection(m).find((c) => c.name === "Testblade")!;
  assert.deepEqual(readyTag(foundry), tag);
  const row = masteryRows(m).find((r) => r.name === "Testblade")!;
  assert.equal(row.status, "build");
  const onMastery = readyTag({ tier: row.buildTier === "parts" ? null : row.buildTier, short: row.buildNames }, "card", row.buildShort);
  assert.deepEqual([onMastery.tier, onMastery.label, onMastery.tone], [tag.tier, tag.label, tag.tone]);
});

test("Mastery doesn't say 'Can build now' or claim resources it has not checked while the recipes are unread", () => {
  const complete = { ...testblade, components: testblade.components!.slice(0, 1) } as CatalogItem;
  // Every part in hand, no resource listed for the item itself: with the recipes read, build now.
  const read = masteryRows(withRecipes(holdBlueprint, [complete], NO_RECIPES)).find((r) => r.name === "Testblade")!;
  assert.equal(readyTag({ tier: read.buildTier === "parts" ? null : read.buildTier, short: read.buildNames }, "card", read.buildShort).label, "Can build now");
  // With none read (a first start offline): the parts are in hand, and that is all it says.
  const unread = masteryRows(withRecipes(holdBlueprint, [complete], null)).find((r) => r.name === "Testblade")!;
  assert.equal(unread.status, "build");
  const t = readyTag({ tier: unread.buildTier === "parts" ? null : unread.buildTier, short: unread.buildNames }, "card", unread.buildShort);
  assert.deepEqual([t.tier, t.label], ["unchecked", "Parts ready"]);
  assert.doesNotMatch(t.title, /and resource in hand/);
  assert.match(t.title, /aren't checked/);
  // The resources the catalog itself lists for it are known without the recipes.
  const known = masteryRows(withRecipes(holdBlueprint, [testblade], null)).find((r) => r.name === "Testblade")!;
  assert.deepEqual(known.buildNames, ["Narmer Isoplast"]);
  assert.equal(readyTag({ tier: null, short: known.buildNames }).tier, "farm");
});

test("the pages draw the build state from readyTag, not a rule of their own", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["tabs/Wishlist", "tabs/Mastery", "tabs/Foundry"].map((x) => `../src/lib/${x}.svelte`).concat(["../src/lib/HoverCard.svelte", "../src/lib/ItemDetails.svelte"])) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /readyTag\(/, `${f} uses readyTag`);
    assert.doesNotMatch(src, />Can build now</, `${f} writes its own 'Can build now' tag`);
    assert.doesNotMatch(src, /\bbuildTag\(/, `${f} builds the tag by hand`);
  }
  const wish = readFileSync(new URL("../src/lib/tabs/Wishlist.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(wish, /!w\.missing\.length \? "Can build|else if !w\.missing\.length\}<span class="tag/);
  // "Next step" is the sentence of its own, not the tooltip's text (which ends in "Open it for what each part takes").
  assert.match(wish, /if \(w\.c\.buildable\) return readyTag\(w\.c\)\.sentence;/);
  assert.doesNotMatch(wish, /readyTag\([^)]*\)\.title/);
});

test("a huge relic count is counted up to a couple of hundred copies, not one array entry each", () => {
  const huge = buildModel(bundle([inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", 2 ** 32)]));
  const capped = buildModel(bundle([inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", ODDS_COPIES)]));
  assert.equal(partOdds(huge, SYS), partOdds(capped, SYS));
  assert.ok(Math.abs(partOdds(huge, SYS) - (1 - 0.98 ** ODDS_COPIES)) < 1e-9);
});
