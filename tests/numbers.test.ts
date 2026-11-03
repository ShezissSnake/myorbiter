// Figures that name the same thing agree from page to page: Spare value and its rows, Worth
// selling on each selling page, the prices Inventory shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { inventoryRows, partRows, modRows } from "../src/lib/core/views";
import { inventoryValue, spareRows, valueTotals } from "../src/lib/core/spares";
import { arcaneSpares, arcanesWorthSelling, modsWorthSelling, partsWorthSelling, worthSelling, worthTotal } from "../src/lib/core/worthSelling";
import { defaultAdvice } from "../src/lib/backend";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [
    {
      uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true,
      components: [
        { uniqueName: "/R/Bp", name: "Blueprint", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 100, itemCount: 1 },
        { uniqueName: "/R/Systems", name: "Systems", ducats: 15, itemCount: 1 },
      ],
    },
    { uniqueName: "/A/Energize", name: "Arcane Energize", category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true },
    { uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10, tradable: true },
    { uniqueName: "/M/Thumper", name: "Thumper", category: "Mods", maxRank: 5, tradable: true },
  ],
  relics: [
    { uniqueName: "/Relic/A1Bronze", name: "Axi A1 Intact", vaulted: true, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 2 }] },
    { uniqueName: "/Relic/A1Silver", name: "Axi A1 Exceptional", vaulted: true, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 4 }] },
  ],
  prices: {
    prices: {
      "Rhino Prime Set": 60, "Rhino Prime Blueprint": 20, "Rhino Prime Chassis Blueprint": 12,
      "Rhino Prime Neuroptics Blueprint": 4, "Rhino Prime Systems Blueprint": 30,
      "Arcane Energize": 8, Serration: 12, Thumper: 3, "Axi A1 Relic": 5,
    },
    max_rank_prices: { "Arcane Energize": 105, Serration: 40 },
    trade_rate: { Serration: [2, 0, ""], Thumper: [0.2, 0, ""], "Arcane Energize": [8, 0, ""], "Rhino Prime Systems Blueprint": [0.5, 0, ""], "Rhino Prime Blueprint": [3, 0, ""] },
  },
});
const row = (rows: { name: string; rank?: number | null }[], name: string, rank: number | null = null) => rows.find((r) => r.name === name && (rank == null || r.rank === rank));

test("an unranked arcane's Each is its unranked price; only its spare copies count as 1/21 of a maxed one", () => {
  const m = buildModel(bundle([inv("/A/Energize", "Arcane Energize", "arcane", 1, { rank: 5 }), inv("/A/Energize", "Arcane Energize", "arcane", 30)]));
  const r0 = spareRows(m).find((r) => r.name === "Arcane Energize" && r.rank === 0)!;
  assert.equal(r0.price, 8, "the unranked market price, as Arcanes shows it");
  assert.equal(r0.spareEach, 5, "105p maxed over 21 copies, lower than 8p");
  assert.equal(r0.worth, 5 * r0.spare);
  assert.match(r0.why, /count as 1\/21 of a maxed one \(105p\) in Spare value/);
  // Market value counts every copy at its own price: kept ones never at the 1/21 share.
  const rows = inventoryRows(m);
  const v = inventoryValue(rows, new Map(spareRows(m).map((x) => [x.key, x])));
  assert.equal(v.market, 105 + 30 * 8);
});

test("an exceptional or flawless relic has no price of its own until one sells: never the intact one's", () => {
  const m = buildModel(bundle([inv("/Relic/A1Bronze", "Axi A1 Intact", "relic", 2), inv("/Relic/A1Silver", "Axi A1 Exceptional", "relic", 3)]));
  const rows = inventoryRows(m);
  assert.equal(rows.find((r) => r.subtype === "intact" || r.name === "Axi A1 Intact")?.price, 5);
  assert.equal(rows.find((r) => r.name === "Axi A1 Exceptional")!.price, null);
});

test("Spare value: an item at two ranks shares one month of sales, and its rows add up to the total", () => {
  // Serration sells twice a day: 60 copies a month, however many ranks they're spread over.
  const m = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 2, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 100)]));
  const ledger = new Map(spareRows(m).map((x) => [x.key, x]));
  const rows = inventoryRows(m);
  const v = inventoryValue(rows, ledger);
  const spare = [...ledger.values()].filter((r) => r.name === "Serration").reduce((n, r) => n + r.spare, 0);
  assert.equal(spare, 101, "your best copy and one to give away kept");
  const shares = rows.map((r) => v.rows.get(r.key)!);
  assert.equal(Math.round(shares.reduce((n, x) => n + x.spare, 0)), v.spare, "the rows add up to Spare value");
  assert.equal(Math.round(shares.reduce((n, x) => n + x.easy, 0)), v.easy, "and to Quick-sale value");
  // 101 spare at (40 + 40 + 99 × 12) / 101 each, 60 of them.
  assert.equal(v.spare, Math.round(((2 * 40 + 99 * 12) / 101) * 60));
  // Quick-sale: all 103 copies, still 60 of them in a month.
  assert.equal(v.easy, Math.round(((3 * 40 + 100 * 12) / 103) * 60));
  // A filter that shows one row: the total is that row's share.
  const r0 = rows.filter((r) => r.rank === 0);
  assert.equal(valueTotals(r0, v.rows).spare, Math.round(v.rows.get(r0[0].key)!.spare));
});

test("Worth selling, prime parts: Sell only, never the copies going out in a set or the ones better as ducats, a month at most", () => {
  const m = buildModel(bundle([...["/R/Bp", "/R/Chassis", "/R/Helmet"].map((u) => inv(u, "x", "prime_part", 1)), inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 40), inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", 4), inv(RHINO, "Rhino Prime", "warframe", 1, { mastered: true })]));
  const parts = partRows(m);
  const advice = { ...defaultAdvice(), platPerDucat: 0.1, minPlat: 5 };
  const items = partsWorthSelling(parts, advice);
  // One of each part goes out in the set; Neuroptics (100 ducats are 10p to you, it sells for 4p) is better as ducats.
  assert.equal(row(items, "Rhino Prime Neuroptics Blueprint"), undefined, "better as ducats");
  const systems = row(items, "Rhino Prime Systems Blueprint") as (typeof items)[number];
  assert.deepEqual([systems.copies, systems.counted, systems.plat], [39, 15, 450], "39 loose after the set, half a sale a day: 15 in a month");
  const bp = row(items, "Rhino Prime Blueprint") as (typeof items)[number];
  assert.deepEqual([bp.copies, bp.counted], [4, 4]);
});

test("Worth selling, mods: tradable mods that sell daily and are worth a trade, a month at most", () => {
  const m = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 100), inv("/M/Thumper", "Thumper", "mod", 240)]));
  const items = modsWorthSelling(modRows(m), 5);
  assert.deepEqual(items.map((x) => [x.name, x.copies, x.counted]), [["Serration", 99, 60]], "Thumper hardly trades");
  assert.equal(modsWorthSelling(modRows(m), 100).length, 0, "under 100p a trade, even six at once");
});

test("Worth selling, arcanes: the ones marked Sell, maxed and loose at their own prices", () => {
  const m = buildModel(bundle([inv("/A/Energize", "Arcane Energize", "arcane", 3, { rank: 5 }), inv("/A/Energize", "Arcane Energize", "arcane", 7)]));
  const advice = { ...defaultAdvice(), minPlat: 5, vosforLens: "market" as const };
  const items = arcanesWorthSelling(arcaneSpares(m, advice));
  assert.deepEqual(items.map((x) => [x.rank, x.copies, x.each]), [[5, 2, 105], [0, 7, 5]]);
  // Home counts the same items.
  assert.equal(worthTotal(worthSelling(m, advice).filter((x) => x.kind === "arcane")), worthTotal(items));
});

test("Requiem and Antivirus mods are kept whole while a lich weapon is left to master", async () => {
  const { modRows, modSpares, lichWeaponsLeft } = await import("../src/lib/core/views");
  const { buildModel } = await import("../src/lib/core/model");
  const cat = (uniqueName: string, name: string, category: string, extra: object = {}) => ({ uniqueName, name, category, ...extra });
  const bundle = (kuvaMastered: boolean) => ({
    observed_at: 1, relics: [], prices: { prices: {}, max_rank_prices: {} },
    catalog: [
      cat("/Lotus/Weapons/Grineer/KuvaLich/LongGuns/KuvaBramma", "Kuva Bramma", "Primary", { masterable: true }),
      cat("/Lotus/Upgrades/Mods/Immortal/ImmortalOneMod", "Lohk", "Mods", { rarity: "Rare" }),
      cat("/Lotus/Upgrades/Mods/Immortal/AntivirusOneMod", "Byteryte", "Mods", { rarity: "Rare" }),
      cat("/Lotus/Upgrades/Mods/Rifle/Serration", "Serration", "Mods", { rarity: "Rare" }),
    ],
    inventory: [
      { item_id: "/Lotus/Upgrades/Mods/Immortal/ImmortalOneMod", name: "Lohk", category: "mod", quantity: 5, mastered: false, image_name: null, rank: null, max_rank: 3 },
      { item_id: "/Lotus/Upgrades/Mods/Immortal/AntivirusOneMod", name: "Byteryte", category: "mod", quantity: 5, mastered: false, image_name: null, rank: null, max_rank: 3 },
      { item_id: "/Lotus/Upgrades/Mods/Rifle/Serration", name: "Serration", category: "mod", quantity: 5, mastered: false, image_name: null, rank: null, max_rank: 10 },
      ...(kuvaMastered ? [{ item_id: "/Lotus/Weapons/Grineer/KuvaLich/LongGuns/KuvaBramma", name: "Kuva Bramma", category: "weapon", quantity: 1, mastered: true, image_name: null, rank: null, max_rank: null }] : []),
    ],
  });
  const m = buildModel(bundle(false) as never);
  assert.deepEqual(lichWeaponsLeft(m), { requiem: ["Kuva Bramma"], antivirus: [] });
  const rows = new Map(modRows(m).map((r) => [r.name, r]));
  assert.equal(rows.get("Lohk")!.extras, 0, "a Kuva weapon left: every Requiem mod kept");
  assert.deepEqual(modSpares(rows.get("Lohk")!), []);
  assert.match(rows.get("Lohk")!.keptFor ?? "", /Kuva Bramma/);
  assert.equal(rows.get("Byteryte")!.extras, 3, "no Coda weapon left to master here: Antivirus mods spare as usual");
  assert.equal(rows.get("Serration")!.extras, 3);
  const done = buildModel(bundle(true) as never);
  assert.equal(modRows(done).find((r) => r.name === "Lohk")!.extras, 3, "everything mastered: Requiem mods are spare again");
});
