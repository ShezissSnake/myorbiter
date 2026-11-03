// Rows worked out once per collection (core/memo.ts): the same rows as worked out fresh, shared by
// every caller of the same model and arguments, apart for different arguments or another model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, type Model } from "../src/lib/core/model";
import { idOf, perModel } from "../src/lib/core/memo";
import { arcaneRows, inventoryRows, masteryRows, modRows, partRows, relicRows, saveForSets, setRows } from "../src/lib/core/views";
import { damagedPartNeeds, defaultSellChoices, gearSetRows, needsByUnique, partsStillNeededFrom, relicsYouNeed, spareRows } from "../src/lib/core/spares";
import { describe } from "../src/lib/core/describe";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const bundle = (): Bundle => ({
  observed_at: 1_700_000_000,
  inventory: [
    inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", 2),
    inv("/R/Chassis", "Rhino Prime Chassis Blueprint", "prime_part", 2),
    inv("/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeHelmetBlueprint", "Rhino Prime Neuroptics Blueprint", "prime_part", 1),
    inv("/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeSystemsBlueprint", "Rhino Prime Systems Blueprint", "prime_part", 3),
    inv("/Relic/R1Bronze", "Axi R1 Intact", "relic", 4),
    inv("/A/Energize", "Arcane Energize", "arcane", 3, { rank: 0, max_rank: 5 }),
    inv("/M/Serration", "Serration", "mod", 4, { rank: 0, max_rank: 10 }),
  ],
  catalog: [
    {
      uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, vaulted: true,
      components: [
        { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 },
        { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 45, itemCount: 1 },
        { uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 },
      ],
    },
    { uniqueName: "/A/Energize", name: "Arcane Energize", category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true },
    { uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10, tradable: true },
  ],
  relics: [
    { uniqueName: "/Relic/R1Bronze", name: "Axi R1 Intact", vaulted: true, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 2 }, { name: "Forma Blueprint", rarity: "Common", chance: 98 }] },
    { uniqueName: "/Relic/R1Platinum", name: "Axi R1 Radiant", vaulted: true, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 10 }, { name: "Forma Blueprint", rarity: "Common", chance: 90 }] },
  ],
  prices: {
    prices: { "Rhino Prime Set": 60, "Rhino Prime Blueprint": 20, "Rhino Prime Chassis Blueprint": 5, "Rhino Prime Neuroptics Blueprint": 10, "Rhino Prime Systems Blueprint": 30, "Arcane Energize": 8, Serration: 3, "Forma Blueprint": 4 },
    max_rank_prices: { "Arcane Energize": 160 },
  },
}) as unknown as Bundle;

/** Each set of rows, from a model: asked twice of one model, and once of a model of the same data no one has asked yet. */
const views: [string, (m: Model) => unknown][] = [
  ["setRows", (m) => setRows(m)],
  ["partRows", (m) => partRows(m)],
  ["partRows saving", (m) => partRows(m, saveForSets(defaultSellChoices(), 0.1))],
  ["arcaneRows", (m) => arcaneRows(m)],
  ["modRows", (m) => modRows(m)],
  ["relicRows", (m) => relicRows(m)],
  ["relicRows all at a rate", (m) => relicRows(m, { includeUnowned: true, platPerDucat: 0.2 })],
  ["inventoryRows", (m) => inventoryRows(m)],
  ["spareRows", (m) => spareRows(m, null, defaultSellChoices(), 0.1, 4)],
  ["masteryRows", (m) => masteryRows(m)],
  ["needsByUnique", (m) => needsByUnique(m)],
  ["gearSetRows", (m) => gearSetRows(m, null)],
  ["relicsYouNeed", (m) => relicsYouNeed(m)],
  ["damagedPartNeeds", (m) => damagedPartNeeds(m)],
  ["partsStillNeededFrom", (m) => partsStillNeededFrom(m, "Jordas Golem")],
];

test("the rows are the same as worked out fresh, and the same rows for the same model and arguments", () => {
  const m = buildModel(bundle());
  for (const [name, f] of views) {
    const first = f(m);
    assert.equal(f(m), first, `${name}: asked again, the same rows`);
    const fresh = f(buildModel(bundle()));
    assert.notEqual(fresh, first, `${name}: another model has its own`);
    assert.deepEqual(fresh, first, `${name}: and they're the same rows`);
  }
});

test("different arguments get their own rows", () => {
  const m = buildModel(bundle());
  assert.notEqual(relicRows(m, { platPerDucat: 0.05 }), relicRows(m, { platPerDucat: 0.2 }));
  assert.notEqual(relicRows(m), relicRows(m, { includeUnowned: true }));
  assert.equal(relicRows(m), relicRows(m, {}), "no options and empty options are the same");
  assert.notEqual(spareRows(m, null, defaultSellChoices(), 0.1, 1), spareRows(m, null, defaultSellChoices(), 0.1, 4));
  assert.notEqual(partsStillNeededFrom(m, "Jordas Golem"), partsStillNeededFrom(m, "Lephantis"), "each mission its own");
  assert.equal(partsStillNeededFrom(m, "Lephantis"), partsStillNeededFrom(m, "Lephantis"));
  assert.notEqual(spareRows(m, null, { ...defaultSellChoices(), relicsWorthSelling: false }), spareRows(m, null, defaultSellChoices()));
  assert.notEqual(spareRows(m, null, defaultSellChoices(), 0, 1, new Map([["x", 1]])), spareRows(m, null, defaultSellChoices(), 0, 1, new Map([["x", 1]])), "other drops: worked out again");
  assert.notEqual(partRows(m, saveForSets(defaultSellChoices(), 0.05)), partRows(m, saveForSets(defaultSellChoices(), 0.2)));
  // Worked out at each, they match what a model nobody has asked yet gives.
  for (const rate of [0.05, 0.2]) assert.deepEqual(relicRows(m, { platPerDucat: rate }), relicRows(buildModel(bundle()), { platPerDucat: rate }));
});

test("perModel works a value out once per model and key", () => {
  let runs = 0;
  const f = perModel((m: Model, n: number, o: object | null = null) => (runs++, { n, o }), (n, o = null) => `${n}|${idOf(o)}`);
  const a = {} as Model;
  const b = {} as Model;
  const o = {};
  assert.equal(f(a, 1), f(a, 1));
  assert.equal(runs, 1);
  f(a, 2);
  f(b, 1);
  f(a, 1, o);
  f(a, 1, o);
  f(a, 1, {});
  assert.equal(runs, 5);
});

test("hover cards: a relic, a part, a mod and an arcane described as before", () => {
  const m = buildModel(bundle());
  const fresh = buildModel(bundle());
  for (const name of ["Axi R1", "Rhino Prime Systems Blueprint", "Serration", "Arcane Energize", "Rhino Prime", "Rhino Prime Set", "Forma Blueprint"]) {
    assert.deepEqual(describe(m, name, null, 0.1), describe(fresh, name, null, 0.1), name);
  }
});
