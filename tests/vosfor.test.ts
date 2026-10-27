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
    { "Arcane Energize": 8, "Arcane Grace": 3, "Magus Drive": 9, "Magus Anomaly": 9 },
    { "Arcane Energize": 160, "Arcane Grace": 20, "Magus Drive": 150, "Magus Anomaly": 150 },
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
