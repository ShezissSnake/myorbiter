// Arcane Dissolution: sell a spare arcane, or dissolve it for Vosfor and Loid's packs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { arcaneRows } from "../src/lib/core/views";
import { packValues, spareArcanes, vosforHeld, vosforWorth, vosforYield } from "../src/lib/core/vosfor";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const arcane = (u: string, name: string) => ({ uniqueName: u, name, category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true });
const bundle = (inventory: InventoryRow[], prices: Record<string, number>, max: Record<string, number>): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [arcane("/A/Energize", "Arcane Energize"), arcane("/A/Grace", "Arcane Grace"), arcane("/A/Drive", "Magus Drive"), arcane("/A/Anomaly", "Magus Anomaly")],
  relics: [],
  prices: { prices, max_rank_prices: max, trade_rate: { "Arcane Energize": [50, 0, ""], "Arcane Grace": [50, 0, ""] } },
});

test("the yield list is per unranked copy, and the two Exodia arcanes can't be dissolved", () => {
  assert.equal(vosforYield("Arcane Energize"), 98);
  assert.equal(vosforYield("Exodia Contagion"), null);
});

test("a cheap spare maxed copy goes to Loid, a valuable one is sold", () => {
  const m = buildModel(bundle(
    [inv("/A/Energize", "Arcane Energize", "arcane", 2, { rank: 5 }), inv("/A/Grace", "Arcane Grace", "arcane", 2, { rank: 5 })],
    // Magus Drive and Anomaly are Solaris commons (15% a slot between seven): dear enough here
    // that a pack's worth beats a 20p maxed Grace.
    { "Arcane Energize": 8, "Arcane Grace": 3, "Magus Drive": 40, "Magus Anomaly": 40 },
    { "Arcane Energize": 160, "Arcane Grace": 20, "Magus Drive": 900, "Magus Anomaly": 900 },
  ));
  const rows = arcaneRows(m);
  const packs = packValues(m, rows);
  const solaris = packs.find((p) => p.name.startsWith("Solaris"))!;
  assert.ok(solaris.needCopies > 0 && solaris.wanted.some((w) => w.name === "Magus Drive"), "Magus arcanes you haven't finished are what a Solaris pack is worth to you");
  const { perVosfor, best } = vosforWorth(packs, "need");
  assert.ok(best && perVosfor > 0);
  const spares = new Map(spareArcanes(m, rows, perVosfor, { lens: "need", minPrice: 5 }).map((s) => [s.row.name, s]));
  const grace = spares.get("Arcane Grace")!;
  assert.equal(grace.maxed, 1);
  assert.equal(grace.vosfor, 98 * 21, "a maxed copy dissolves as the 21 copies it's made of");
  assert.equal(grace.verdict, "dissolve", "20p for a maxed Grace is less than its Vosfor buys");
  const energize = spares.get("Arcane Energize")!;
  assert.equal(energize.sellPlat, 160);
  assert.equal(energize.verdict, "sell");
});

test("Vosfor you hold is read from the inventory", () => {
  const m = buildModel(bundle([inv("/Lotus/Types/Items/MiscItems/DistillPoints", "Vosfor", "resource", 1020)], {}, {}));
  assert.equal(vosforHeld(m), 1020);
});

test("an arcane trading under 5 a day is dissolved unless it sells within the week for far more, and is worth nothing in a pack at market prices", async () => {
  const { SELLS_DAILY } = await import("../src/lib/core/vosfor");
  assert.equal(SELLS_DAILY, 5);
  const b = bundle(
    [inv("/A/Energize", "Arcane Energize", "arcane", 2, { rank: 5 }), inv("/A/Grace", "Arcane Grace", "arcane", 2, { rank: 5 })],
    { "Arcane Energize": 8, "Arcane Grace": 30, "Magus Drive": 9, "Magus Anomaly": 9 },
    { "Arcane Energize": 160, "Arcane Grace": 600, "Magus Drive": 150, "Magus Anomaly": 150 },
  );
  // Grace sells for 600p maxed, but only 3 a day: the spare one still sells this week, for far more.
  (b.prices as unknown as { trade_rate: Record<string, unknown> }).trade_rate = { "Arcane Energize": [50, 0, ""], "Arcane Grace": [3, 0, ""] };
  const m = buildModel(b);
  const rows = arcaneRows(m);
  const spares = new Map(spareArcanes(m, rows, 0.01, { lens: "market", minPrice: 5 }).map((s) => [s.row.name, s]));
  assert.equal(spares.get("Arcane Grace")!.verdict, "sell");
  assert.match(spares.get("Arcane Grace")!.why, /Sells slowly/);
  assert.equal(spares.get("Arcane Energize")!.verdict, "sell");
  // Once in ten days: it may not sell this week, so Vosfor is the sure thing.
  (b.prices as unknown as { trade_rate: Record<string, unknown> }).trade_rate = { "Arcane Energize": [50, 0, ""], "Arcane Grace": [0.1, 0, ""] };
  const slow = buildModel(b);
  const grace = spareArcanes(slow, arcaneRows(slow), 0.01, { lens: "market", minPrice: 5 }).find((s) => s.row.name === "Arcane Grace")!;
  assert.equal(grace.verdict, "dissolve");
  assert.match(grace.why, /under 5 times a day/);
  (b.prices as unknown as { trade_rate: Record<string, unknown> }).trade_rate = { "Arcane Energize": [50, 0, ""], "Arcane Grace": [3, 0, ""] };
  // In a pack at market prices, Grace (Eidolon) adds nothing; Energize still does.
  const eidolon = packValues(m, rows).find((p) => p.name.startsWith("Eidolon"))!;
  (b.prices as unknown as { trade_rate: Record<string, unknown> }).trade_rate = { "Arcane Energize": [50, 0, ""], "Arcane Grace": [50, 0, ""] };
  const eidolonFast = packValues(buildModel(b), arcaneRows(buildModel(b))).find((p) => p.name.startsWith("Eidolon"))!;
  assert.ok(eidolon.plat < eidolonFast.plat, "Grace counts once it sells 5 a day or more");
});

test("whole extra maxed arcanes count unfused copies too: 43 copies of a 21-copy arcane make one extra to sell", () => {
  const b = bundle([inv("/A/Energize", "Arcane Energize", "arcane", 1, { rank: 5 }), inv("/A/Energize", "Arcane Energize", "arcane", 22)], { "Arcane Energize": 8 }, { "Arcane Energize": 160 });
  const m = buildModel(b);
  const [a] = arcaneRows(m).filter((r) => r.name === "Arcane Energize");
  assert.deepEqual([a.copies, a.needed, a.extraMaxed, a.extraSets, a.toFuse], [43, 21, 0, 1, 1]);
  const [s] = spareArcanes(m, [a], 0.001, { lens: "market", minPrice: 5 });
  assert.deepEqual([s.maxed, s.unranked, s.sellPlat], [1, 1, 167.6], "one maxed (to fuse) at 160p and the copy left at its share of one, 160/21p");
});

test("loose copies count as their share of a maxed arcane, not the unranked median: 26 Molt Vigor at 2p aren't 52p", () => {
  // A maxed one sells for 21p, so a copy is worth 1p as part of one; the 2p unranked median comes
  // from a few copies at a time, and 21 of them don't fetch 42p.
  const b = bundle([inv("/A/Energize", "Arcane Energize", "arcane", 1, { rank: 5 }), inv("/A/Energize", "Arcane Energize", "arcane", 26)], { "Arcane Energize": 2 }, { "Arcane Energize": 21 });
  const m = buildModel(b);
  const [a] = arcaneRows(m).filter((r) => r.name === "Arcane Energize");
  const [s] = spareArcanes(m, [a], 45 / (98 * 26), { lens: "market", minPrice: 5 });
  assert.deepEqual([s.maxed, s.unranked, s.each], [1, 5, 1]);
  assert.equal(s.sellPlat, 26, "one maxed at 21p and five copies at 1p");
  assert.equal(s.verdict, "dissolve", "their Vosfor (~45p) beats 26p");
});
