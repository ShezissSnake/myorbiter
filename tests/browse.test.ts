// Browsing everything warframe.market trades: categories from its tags, prices and filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { categoryCounts, categoryOf, filterRows, marketRows, type MarketFilter } from "../src/lib/core/browse";
import type { MarketItem } from "../src/lib/core/market";
import type { Bundle } from "../src/lib/core/types";

const item = (name: string, tags: string[], maxRank: number | null = null, gameRef: string | null = null): MarketItem => ({ id: name, slug: name.toLowerCase().replace(/ /g, "_"), gameRef, name, maxRank, subtypes: null, tags });
const ITEMS = [
  item("Kuva Wytch Scene", ["scene", "misc"]),
  item("Corpus Depository Scene", ["scene", "misc"]),
  item("Serration", ["mod", "rare", "rifle"], 10),
  item("Arcane Energize", ["arcane_enhancement", "legendary"], 5),
  item("Rhino Prime Systems Blueprint", ["prime", "blueprint", "warframe"]),
  item("Rhino Prime Set", ["prime", "set", "warframe"]),
  item("Lith A1 Relic", ["relic", "lith"]),
  item("Mandonel Barrel", ["weapon", "component", "archgun"], null, "/Lotus/Types/Recipes/Weapons/WeaponParts/TnConcreteArchgunBarrel"),
  item("Haav", ["fish", "duviri"]),
];
const bundle = {
  observed_at: 1_700_000_000,
  inventory: [{ item_id: "/Lotus/Types/Recipes/Weapons/WeaponParts/TnConcreteArchgunBarrel", name: "Tn Concrete Archgun Barrel", category: "resource", quantity: 3, mastered: false, image_name: null, rank: null, max_rank: null }],
  catalog: [],
  relics: [],
  prices: {
    prices: { "Kuva Wytch Scene": 284, "Corpus Depository Scene": 5, Serration: 2, "Arcane Energize": 6, "Mandonel Barrel": 4 },
    max_rank_prices: { Serration: 12, "Arcane Energize": 120 },
    trade_rate: { "Corpus Depository Scene": [2, 17, ""], Serration: [40, 17, ""], "Arcane Energize": [25, 17, ""], "Haav": [1, 2, ""] },
  },
} as unknown as Bundle;
const all: MarketFilter = { category: "all", min: null, max: null, minTrades: null, owned: false };
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

test("each item goes under one category, by warframe.market's tags", () => {
  assert.deepEqual(ITEMS.map((i) => categoryOf(i.tags)), ["scene", "scene", "mod", "arcane", "prime", "set", "relic", "gear", "fish"]);
  assert.equal(categoryOf(null), "other");
});

test("rows carry prices, trade rates and what you hold", () => {
  const rows = marketRows(buildModel(bundle), ITEMS);
  const energize = rows.find((r) => r.name === "Arcane Energize")!;
  assert.deepEqual([energize.price, energize.priceMax, energize.tradesPerDay], [6, 120, 25]);
  assert.equal(rows.find((r) => r.name === "Mandonel Barrel")!.have, 3);
  assert.equal(rows.find((r) => r.name === "Kuva Wytch Scene")!.tradesPerDay, null);
});

test("filters: category, price either way, how often it sells, owned", () => {
  const rows = marketRows(buildModel(bundle), ITEMS);
  assert.deepEqual(names(filterRows(rows, { ...all, category: "scene" })), ["Kuva Wytch Scene", "Corpus Depository Scene"]);
  // At least 100: the maxed Energize counts; at most 10: the unranked one does.
  assert.deepEqual(names(filterRows(rows, { ...all, min: 100 })), ["Kuva Wytch Scene", "Arcane Energize"]);
  assert.deepEqual(names(filterRows(rows, { ...all, max: 10 })), ["Corpus Depository Scene", "Serration", "Arcane Energize", "Mandonel Barrel"]);
  assert.deepEqual(names(filterRows(rows, { ...all, category: "scene", minTrades: 1 })), ["Corpus Depository Scene"]);
  assert.deepEqual(names(filterRows(rows, { ...all, owned: true })), ["Mandonel Barrel"]);
});

test("the category menu counts what each category shows under the other filters", () => {
  const rows = marketRows(buildModel(bundle), ITEMS);
  const counts = (f: MarketFilter) => Object.fromEntries(categoryCounts(rows, f));
  assert.deepEqual(counts(all), { all: 9, scene: 2, mod: 1, arcane: 1, prime: 1, set: 1, relic: 1, gear: 1, fish: 1 });
  // At least 100p: two scenes become one, and the categories with nothing left drop out of the map.
  assert.deepEqual(counts({ ...all, min: 100 }), { all: 2, scene: 1, arcane: 1 });
  // The category picked doesn't narrow the others' counts: each says what picking it would show.
  assert.deepEqual(counts({ ...all, category: "scene", owned: true }), { all: 1, gear: 1 });
});

test("sells weekly: prices from fewer than one sale a week can be left out", () => {
  const rows = marketRows(buildModel(bundle), ITEMS);
  // Kuva Wytch Scene has a price but no sales lately; the Depository sells twice a day.
  assert.deepEqual(names(filterRows(rows, { ...all, category: "scene", weekly: true })), ["Corpus Depository Scene"]);
  assert.equal(filterRows(rows, { ...all, category: "scene", weekly: false }).length, 2);
  // Once a day, but on only two days: not a steady price.
  assert.deepEqual(names(filterRows(rows, { ...all, category: "fish", weekly: true })), []);
});
