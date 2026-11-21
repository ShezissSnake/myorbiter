// Importing closed sales into a sale log that is full (it keeps the newest 2,000): the message counts
// what was kept after the cut, not what was found, and says the log is full. The cap stays.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as closedOrders from "../src/lib/core/closedOrders";
import type { ClosedOrder } from "../src/lib/core/closedOrders";
import type { Sale } from "../src/lib/backend";

const H = 3_600_000;
const T = Date.parse("2026-09-17T21:14:52Z");
// A log of n sales, newest first, one an hour back from T.
const log = (n: number): Sale[] => Array.from({ length: n }, (_, i) => ({ at: T - i * H, item: "Example Mod", rank: 0, quantity: 1, platinum: 10 }));
const closed = (n: number, from: number): ClosedOrder[] => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: "sell", slug: "example_part", name: "Example Part", rank: null, quantity: 1, platinum: 20, closedAt: new Date(from - i * H).toISOString() }));
const importedLog = (...a: Parameters<typeof closedOrders.importedLog>) => {
  assert.equal(typeof closedOrders.importedLog, "function", "closedOrders.ts has importedLog");
  return closedOrders.importedLog(...a);
};

test("ten older sales into a full log: none kept, and the message says so", () => {
  const r = importedLog(log(2000), closed(10, T - 3000 * H));
  assert.equal(r.sales?.length, 2000, "the cap stays");
  assert.ok(r.sales!.every((s) => s.item === "Example Mod"), "the ten older ones are the ones cut");
  assert.equal(r.words, "Found 10 new sales on warframe.market and kept none; the other 0 were already logged. The sale log is full: it keeps your newest 2,000 sales, so the 10 oldest were dropped.");
});

test("ten newer sales into a log of 1,995: all ten kept, the five oldest logged ones cut", () => {
  const r = importedLog(log(1995), [...closed(10, T + 20 * H), { ...closed(1, T)[0], id: "b", kind: "buy" }]);
  assert.equal(r.sales?.length, 2000);
  assert.equal(r.sales!.filter((s) => s.wfm).length, 10);
  assert.equal(r.words, "Found 10 new sales on warframe.market and kept 10; the other 0 were already logged. The sale log is full: it keeps your newest 2,000 sales, so the 5 oldest were dropped.");
  const one = importedLog(log(2000), closed(1, T + H));
  assert.equal(one.words, "Found 1 new sale on warframe.market and kept 1; the other 0 were already logged. The sale log is full: it keeps your newest 2,000 sales, so the oldest was dropped.");
});

test("a log that the import just fills says it is full now; a log with room reads as before", () => {
  const r = importedLog(log(1990), closed(10, T + 20 * H));
  assert.equal(r.sales?.length, 2000);
  assert.equal(r.words, "Added 10 sales from warframe.market; the other 0 were already logged. The sale log is now full: it keeps your newest 2,000 sales.");
  const some = importedLog(log(5), closed(2, T + 20 * H));
  assert.equal(some.sales?.length, 7);
  assert.equal(some.words, "Added 2 sales from warframe.market; the other 0 were already logged.");
  const again = importedLog(some.sales!, closed(2, T + 20 * H));
  assert.equal(again.sales, null, "nothing new: the log isn't written");
  assert.equal(again.words, "All 2 closed sales on warframe.market were already logged.");
  assert.equal(importedLog(log(5), []).words, "warframe.market has no closed sales on your profile.");
});

test("Sales.svelte imports through importedLog and has no cut of its own", () => {
  const src = readFileSync(new URL("../src/lib/tabs/Sales.svelte", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function importSales"), src.indexOf("const DAY = 86_400_000"));
  assert.match(body, /importedLog\(settings\.market\.sales, closed, setPartsOf\(model\)\)/);
  assert.doesNotMatch(body, /slice\(0, 2000\)/);
});
