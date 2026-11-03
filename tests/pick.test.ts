import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { bestCard, defaultPickWeights, resolveName, scoreCards } from "../src/lib/core/pick";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const BOAR = "/Lotus/Weapons/Tenno/Shotgun/BoarPrime";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [
    { uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [
      { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 },
      { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
      { uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 },
    ] },
    { uniqueName: BOAR, name: "Boar Prime", category: "Primary", masterable: true, isPrime: true, components: [
      { uniqueName: "/B/Bp", name: "Blueprint", ducats: 15, itemCount: 1 },
      { uniqueName: "/B/Stock", name: "Stock", ducats: 100, itemCount: 1 },
    ] },
  ],
  relics: [],
  prices: { prices: { "Rhino Prime Blueprint": 40, "Rhino Prime Chassis Blueprint": 3, "Rhino Prime Systems Blueprint": 8, "Boar Prime Blueprint": 2, "Boar Prime Stock": 6 }, max_rank_prices: {} },
});

test("plat comes first: a 40p part beats a cheap part you need", () => {
  const m = buildModel(bundle([inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })]));
  const cards = scoreCards(m, ["Rhino Prime Blueprint", "Boar Prime Blueprint", "Forma Blueprint"]);
  assert.equal(cards[1].needed, true);
  assert.equal(cards[0].needed, false);
  assert.equal(bestCard(cards), 0);
  assert.ok(cards[2].score < cards[1].score, "Forma is worth least");
});

test("a big price gap beats need: you could buy the needed part instead", () => {
  const m = buildModel(bundle([inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })]));
  // Rhino Prime Systems at 40p (45 ducats) against Boar Prime Blueprint at 2p (15 ducats), needed.
  const b = bundle([inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })]);
  b.prices = { ...b.prices!, prices: { ...(b.prices?.prices ?? {}), "Rhino Prime Systems Blueprint": 40 } };
  const cards = scoreCards(buildModel(b), ["Rhino Prime Systems Blueprint", "Boar Prime Blueprint"]);
  assert.equal(cards[1].needed, true);
  assert.equal(bestCard(cards), 0);
  void m;
});

test("when plat is close, the part you need wins", () => {
  const m = buildModel(bundle([inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })]));
  const cards = scoreCards(m, ["Rhino Prime Systems Blueprint", "Boar Prime Stock"]);
  assert.equal(cards[1].needed, true);
  assert.equal(cards[1].neededFor, "Boar Prime");
  assert.equal(bestCard(cards), 1);
  assert.ok(cards[1].reasons.includes("needed for Boar Prime"));
});

test("a part that completes a set is marked, half for one part away", () => {
  const m = buildModel(bundle([
    inv("/B/Bp", "Boar Prime Blueprint", "prime_part", 1),
    inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", 1),
  ]));
  const [stock, systems] = scoreCards(m, ["Boar Prime Stock", "Rhino Prime Systems Blueprint"]);
  assert.equal(stock.set, 1);
  assert.equal(stock.setName, "Boar Prime");
  assert.equal(systems.set, 0.5);
});

test("weights decide: ducats only picks the 100-ducat part", () => {
  const m = buildModel(bundle([inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true }), inv(BOAR, "Boar Prime", "weapon", 0, { mastered: true })]));
  const cards = scoreCards(m, ["Rhino Prime Systems Blueprint", "Boar Prime Stock"], { plat: 0, needed: 0, ducats: 1, set: 0, forma: 3 });
  assert.equal(bestCard(cards), 1);
  assert.equal(cards[1].score, 100);
});

test("names from the screen without 'Blueprint' still resolve", () => {
  const m = buildModel(bundle([]));
  assert.equal(resolveName(m, "Rhino Prime Systems"), "Rhino Prime Systems Blueprint");
  assert.equal(resolveName(m, "rhino prime systems blueprint"), "Rhino Prime Systems Blueprint");
  assert.equal(bestCard([]), null);
  assert.deepEqual(Object.keys(defaultPickWeights()), ["plat", "needed", "ducats", "set", "forma"]);
});

// ------------------------------------------------------------------ the foundry
const VAUBAN = "/Lotus/Powersuits/Engineer/VaubanPrime";
const R = "/Lotus/Types/Recipes/WarframeRecipes/VaubanPrime";
const vauban = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [{ uniqueName: VAUBAN, name: "Vauban Prime", category: "Warframes", masterable: true, isPrime: true, components: [
    { uniqueName: `${R}Blueprint`, name: "Blueprint", ducats: 45, itemCount: 1 },
    { uniqueName: `${R}ChassisComponent`, name: "Chassis", ducats: 15, itemCount: 1 },
    { uniqueName: `${R}SystemsComponent`, name: "Systems", ducats: 45, itemCount: 1 },
  ] }],
  relics: [],
  prices: { prices: { "Vauban Prime Chassis Blueprint": 10, "Vauban Prime Systems Blueprint": 10, "Vauban Prime Blueprint": 10 }, max_rank_prices: {} },
});
const needed = (m: ReturnType<typeof buildModel>, name: string) => scoreCards(m, [name])[0].needed;

test("a part you hold isn't needed, whether as its blueprint or already built", () => {
  assert.equal(needed(buildModel(vauban([])), "Vauban Prime Chassis Blueprint"), true);
  assert.equal(needed(buildModel(vauban([inv(`${R}ChassisBlueprint`, "Vauban Prime Chassis Blueprint", "prime_part", 1)])), "Vauban Prime Chassis Blueprint"), false);
  assert.equal(needed(buildModel(vauban([inv(`${R}ChassisComponent`, "Vauban Prime Chassis", "prime_part", 1)])), "Vauban Prime Chassis Blueprint"), false);
});

test("the foundry: a part being crafted counts as held, an item being built as owned", () => {
  const crafting = buildModel(vauban([]), undefined, { [`${R}ChassisBlueprint`]: 1 });
  assert.equal(needed(crafting, "Vauban Prime Chassis Blueprint"), false, "the Chassis is in the foundry");
  assert.equal(needed(crafting, "Vauban Prime Systems Blueprint"), true, "the Systems still aren't");
  const building = buildModel(vauban([]), undefined, { [`${R}Blueprint`]: 1 });
  assert.equal(needed(building, "Vauban Prime Systems Blueprint"), false, "Vauban Prime itself is being built");
  assert.equal(building.owned(VAUBAN), 1);
});

test("a part being crafted is no longer a part you could sell", () => {
  const held = vauban([inv(`${R}ChassisBlueprint`, "Vauban Prime Chassis Blueprint", "prime_part", 1)]);
  assert.equal(buildModel(held).ownedPartQty.get("Vauban Prime Chassis Blueprint"), 1);
  const crafting = buildModel(vauban([]), undefined, { [`${R}ChassisBlueprint`]: 1 });
  assert.equal(crafting.ownedPartQty.get("Vauban Prime Chassis Blueprint") ?? 0, 0, "not tradable while it's in the foundry");
  assert.equal(crafting.partHave("Vauban Prime Chassis Blueprint"), 1, "but it counts toward building Vauban Prime");
});

test("an item listing the same component twice needs two of it", () => {
  const AK = "/Lotus/Weapons/Tenno/Pistols/AkbroncoPrime";
  const BR = "/Lotus/Weapons/Tenno/Shotgun/BroncoPrime";
  const m = buildModel({
    observed_at: 1,
    inventory: [inv(BR, "Bronco Prime", "weapon", 1)],
    catalog: [
      { uniqueName: AK, name: "Akbronco Prime", category: "Secondary", masterable: true, isPrime: true, components: [
        { uniqueName: `${AK}Blueprint`, name: "Blueprint", ducats: 15, itemCount: 1 },
        { uniqueName: BR, name: "Bronco Prime", itemCount: 1 },
        { uniqueName: BR, name: "Bronco Prime", itemCount: 1 },
      ] },
    ],
    relics: [],
    prices: { prices: {}, max_rank_prices: {} },
  } as Bundle);
  const ak = m.catalogByUnique.get(AK)!;
  assert.deepEqual(ak.components?.map((c) => [c.name, c.itemCount]), [["Blueprint", 1], ["Bronco Prime", 2]]);
});

test("live prices from the reward screen win over the daily median, so the score matches the card", () => {
  const m = buildModel(bundle([inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true }), inv(BOAR, "Boar Prime", "primary", 0, { mastered: true })]));
  // By the daily median Rhino Prime Systems (8p) wins; live, it is down to 1p.
  const median = scoreCards(m, ["Rhino Prime Systems Blueprint", "Boar Prime Stock"]);
  assert.equal(bestCard(median), 0);
  const live = scoreCards(m, ["Rhino Prime Systems Blueprint", "Boar Prime Stock"], defaultPickWeights(), { "Rhino Prime Systems Blueprint": 1 });
  assert.equal(live[0].price, 1);
  assert.equal(bestCard(live), 1, "6p and 100 ducats beat 1p and 45 ducats");
});

test("a Forma Blueprint counts as what it's worth to you (3p by default, double for 2X), above a 2p common", async () => {
  const { scoreCards, bestCard, formaCount, defaultPickWeights } = await import("../src/lib/core/pick");
  const { buildModel } = await import("../src/lib/core/model");
  const m = buildModel({ observed_at: 1, inventory: [], catalog: [], relics: [], prices: { prices: { "Bronco Prime Barrel": 2 }, max_rank_prices: {} } } as never);
  assert.deepEqual(["Forma Blueprint", "2X Forma Blueprint", "Forma", "Umbra Forma Blueprint", "Lex Prime Barrel"].map(formaCount), [1, 2, 1, 0, 0]);
  const cards = scoreCards(m, ["Bronco Prime Barrel", "Forma Blueprint", "2X Forma Blueprint"]);
  assert.deepEqual(cards.map((c) => c.price), [2, 3, 6]);
  assert.equal(cards[1].priceIsYours, true);
  assert.match(cards[1].reasons[0], /Forma, worth 3p to you/);
  assert.equal(bestCard(cards), 2, "2X Forma wins");
  assert.ok(cards[1].score > cards[0].score, "Forma above a 2p common");
  // Set to 0: no price, as before.
  assert.equal(scoreCards(m, ["Forma Blueprint"], { ...defaultPickWeights(), forma: 0 })[0].price, null);
});
