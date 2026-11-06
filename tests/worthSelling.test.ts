// Worth selling, kind by kind: what each selling page and Home's Ready to list count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arcanesWorthSelling, modsWorthSelling, partsWorthSelling, worthTotal } from "../src/lib/core/worthSelling";
import { defaultAdvice } from "../src/lib/backend";
import type { ModRow, PartRow } from "../src/lib/core/views";
import type { SpareArcane } from "../src/lib/core/vosfor";

const advice = defaultAdvice(); // 0.1p a ducat, 5p a trade at least
const part = (name: string, x: Partial<PartRow>): PartRow => ({ name, spare: 2, inSets: 0, price: 20, ducats: 45, tradesPerDay: 10, ...x }) as PartRow;

test("prime parts: loose spares only, never the ones better as ducats or with no price", () => {
  const out = partsWorthSelling(
    [
      part("Sold loose", { spare: 3, inSets: 1 }),
      part("All in sets", { spare: 2, inSets: 2 }),
      part("No price", { price: null }),
      part("Better as ducats", { price: 9, ducats: 100 }),
      part("Under a trade", { spare: 1, price: 4, ducats: 15 }),
      part("Slow seller", { spare: 1, price: 30, tradesPerDay: 0.1 }),
    ],
    advice,
  );
  assert.deepEqual(out.map((x) => [x.name, x.copies, x.counted, x.plat]), [
    ["Sold loose", 2, 2, 40],
    // Sells about 3 a month: its one copy counts.
    ["Slow seller", 1, 1, 30],
  ]);
});

test("mods: spare copies that sell daily and are worth a trade; never a riven, nor one you can't trade", () => {
  const mod = (name: string, x: Partial<ModRow>): ModRow => ({ name, tradable: true, extras: 2, extrasValue: 20, tradesPerDay: 5, ...x }) as ModRow;
  const out = modsWorthSelling(
    [
      mod("Serration", {}),
      mod("Untradable", { tradable: false }),
      mod("No extras", { extras: 0 }),
      mod("No price", { extrasValue: null }),
      mod("Braton Riven Mod", {}),
      mod("Rarely sold", { tradesPerDay: 0.5 }),
      mod("Small change", { extras: 1, extrasValue: 2 }),
      mod("Market takes few", { extras: 50, extrasValue: 500, tradesPerDay: 1 }),
    ],
    5,
  );
  assert.deepEqual(out.map((x) => [x.name, x.copies, x.counted, x.each, x.plat]), [
    ["Serration", 2, 2, 10, 20],
    ["Market takes few", 50, 30, 10, 300],
  ]);
  assert.equal(worthTotal(out), 320);
});

test("arcanes: only the ones marked Sell, maxed at the maxed price, loose at their share", () => {
  const row = (name: string, priceMax: number | null) => ({ name, maxRank: 5, priceMax, tradesPerDay: 10 });
  const spare = (x: Partial<SpareArcane>) => ({ verdict: "sell", sellPlat: 100, maxed: 1, unranked: 0, each: null, row: row("Arcane Energize", 90), ...x }) as unknown as SpareArcane;
  const out = arcanesWorthSelling([
    spare({}),
    spare({ maxed: 0, unranked: 4, each: 4, row: row("Arcane Grace", 80) as never }),
    spare({ maxed: 2, unranked: 3, each: 2, row: row("Arcane Guardian", null) as never }),
    spare({ verdict: "dissolve" as never, row: row("Arcane Dissolved", 40) as never }),
    spare({ sellPlat: null, row: row("Arcane Unpriced", 40) as never }),
  ]);
  assert.deepEqual(out.map((x) => [x.name, x.rank, x.copies, x.plat]), [
    ["Arcane Energize", 5, 1, 90],
    ["Arcane Grace", 0, 4, 16],
    // No maxed price: the maxed copies aren't counted at a guess; the loose ones are.
    ["Arcane Guardian", 0, 3, 6],
  ]);
});
