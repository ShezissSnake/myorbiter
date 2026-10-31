import { test } from "node:test";
import assert from "node:assert/strict";
import { platMastery } from "../src/lib/core/platMastery";
import type { Model } from "../src/lib/core/model";
import type { MasteryRow } from "../src/lib/core/views";

const prices: Record<string, number> = { "Mesa Prime Chassis Blueprint": 20, "Mesa Prime Systems Blueprint": 30, "Lato Vandal Set": 25 };
const m = { price: (n: string) => prices[n] ?? null, catalogByUnique: new Map([["/hema", { marketCost: 75 }], ["/lato", { tradable: true }]]) } as unknown as Model;
const row = (name: string, unique: string, extra: Partial<MasteryRow> = {}) => ({ name, unique, status: "missing", unobtainable: false, points: 6000, isPrime: false, missingParts: [], partsOwned: 0, setPrice: null, ...extra }) as unknown as MasteryRow;

test("plat mastery: cheapest way per item, cheapest item first", () => {
  const out = platMastery(m, [
    row("Mesa Prime", "/mesa", { isPrime: true, partsOwned: 2, missingParts: [{ name: "Mesa Prime Chassis Blueprint", need: 1 }, { name: "Mesa Prime Systems Blueprint", need: 1 }] as MasteryRow["missingParts"] }),
    row("Hema", "/hema", { points: 3000 }),
    row("Lato Vandal", "/lato", { points: 3000 }),
    row("Owned", "/x", { status: "level" }),
  ]);
  assert.deepEqual(out.map((x) => [x.row.name, x.plat, x.where]), [["Lato Vandal", 25, "market"], ["Mesa Prime", 50, "market"], ["Hema", 75, "ingame"]]);
  assert.deepEqual(out[1].buys.map((b) => b.name), ["Mesa Prime Chassis Blueprint", "Mesa Prime Systems Blueprint"]);
  assert.equal(out[0].perK, 8.3);
});

test("plat mastery: a whole set beats its parts when cheaper and you have none", () => {
  const p = { ...m, price: (n: string) => ({ "A Prime Barrel": 40, "A Prime Receiver": 40 })[n] ?? null } as unknown as Model;
  const out = platMastery(p, [row("A Prime", "/a", { isPrime: true, setPrice: 50, missingParts: [{ name: "A Prime Barrel", need: 1 }, { name: "A Prime Receiver", need: 1 }] as MasteryRow["missingParts"] })]);
  assert.deepEqual([out[0].plat, out[0].buys[0].name], [50, "A Prime Set"]);
});
