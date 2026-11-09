// Rows worked out once per collection (core/memo.ts): the same rows as worked out fresh, shared by
// every caller of the same model and arguments, apart for different arguments or another model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, type Model } from "../src/lib/core/model";
import { idOf, keepRows, perModel, sameData } from "../src/lib/core/memo";
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

/** The lists whose rows are kept from one model to the next while they hold the same (perModel's rowKey). */
const kept = new Set(["setRows", "partRows", "partRows saving", "arcaneRows", "modRows", "relicRows", "relicRows all at a rate", "inventoryRows", "spareRows", "masteryRows"]);

test("the rows are the same as worked out fresh, and the same rows for the same model and arguments", () => {
  const m = buildModel(bundle());
  for (const [name, f] of views) {
    const first = f(m);
    assert.equal(f(m), first, `${name}: asked again, the same rows`);
    const fresh = f(buildModel(bundle()));
    // A model of the same data: a list of kept rows is the list handed out last, any other its own.
    if (kept.has(name)) assert.equal(fresh, first, `${name}: the same data, the same list`);
    else assert.notEqual(fresh, first, `${name}: another model has its own`);
    assert.deepEqual(fresh, first, `${name}: and they're the same rows`);
  }
});

test("a new read keeps the rows that didn't change and only those", () => {
  const before = inventoryRows(buildModel(bundle()));
  const b = bundle();
  b.inventory = b.inventory.map((r) => (r.name === "Serration" ? { ...r, quantity: 5 } : r));
  const after = inventoryRows(buildModel(b));
  assert.notEqual(after, before, "a row changed: a new list");
  for (const r of after) {
    const old = before.find((x) => x.key === r.key)!;
    if (r.name === "Serration") {
      assert.notEqual(r, old, "the changed row is new");
      assert.equal(r.quantity, 5);
    } else assert.equal(r, old, `${r.name}: kept`);
  }
  assert.equal(after.length, before.length);
});

test("keepRows and sameData", () => {
  const a = [{ k: "x", n: 1, sub: [{ v: 1 }] }, { k: "y", n: 2, sub: [] }];
  const same = [{ k: "x", n: 1, sub: [{ v: 1 }] }, { k: "y", n: 2, sub: [] }];
  assert.equal(keepRows(a, same, (r) => r.k), a, "every row the same, in order: the old list");
  const moved = [same[1], same[0]];
  const out = keepRows(a, moved, (r) => r.k);
  assert.notEqual(out, a, "reordered: a new list");
  assert.equal(out[0], a[1]);
  assert.equal(out[1], a[0]);
  const changed = keepRows(a, [{ k: "x", n: 1, sub: [{ v: 2 }] }, same[1]], (r) => r.k);
  assert.notEqual(changed[0], a[0], "a nested change counts");
  assert.equal(changed[1], a[1]);
  assert.equal(sameData({ a: 1, b: undefined }, { a: 1 }), false, "a key the other hasn't got");
  assert.equal(sameData(new Map([[1, 1]]), new Map([[1, 1]])), false, "a Map only as itself");
  assert.equal(sameData([NaN], [NaN]), true);
});

test("different arguments get their own rows", () => {
  const m = buildModel(bundle());
  // Lists whose rows are kept (perModel's rowKey) may hand out the same list for other arguments
  // when it holds the same: worked out for each all the same, they match a fresh model's.
  const fresh = () => buildModel(bundle());
  for (const rate of [0.05, 0.2]) assert.deepEqual(relicRows(m, { platPerDucat: rate }), relicRows(fresh(), { platPerDucat: rate }));
  assert.deepEqual(relicRows(m, { includeUnowned: true }), relicRows(fresh(), { includeUnowned: true }));
  assert.equal(relicRows(m), relicRows(m, {}), "no options and empty options are the same");
  for (const squad of [1, 4]) assert.deepEqual(spareRows(m, null, defaultSellChoices(), 0.1, squad), spareRows(fresh(), null, defaultSellChoices(), 0.1, squad));
  assert.notEqual(partsStillNeededFrom(m, "Jordas Golem"), partsStillNeededFrom(m, "Lephantis"), "each mission its own");
  assert.equal(partsStillNeededFrom(m, "Lephantis"), partsStillNeededFrom(m, "Lephantis"));
  assert.notDeepEqual(spareRows(m, null, { ...defaultSellChoices(), relicsWorthSelling: false }), spareRows(m, null, defaultSellChoices()));
  for (const rate of [0.05, 0.2]) assert.deepEqual(partRows(m, saveForSets(defaultSellChoices(), rate)), partRows(fresh(), saveForSets(defaultSellChoices(), rate)));
});

test("perModel with rowKey works a list out for each model and key, and keeps rows that hold the same", () => {
  let runs = 0;
  const f = perModel((m: Model, n: number) => (runs++, [{ k: "a", n }, { k: "b", n: 0 }]), (n) => `${n}`, (r: { k: string }) => r.k);
  const a = {} as Model;
  const b = {} as Model;
  const one = f(a, 1);
  const two = f(a, 2);
  assert.equal(runs, 2, "each key worked out");
  assert.notEqual(two, one);
  assert.equal(two[1], one[1], "the row that holds the same is kept");
  assert.equal(f(b, 2), two, "another model, the same data: the same list");
  assert.equal(runs, 3);
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
