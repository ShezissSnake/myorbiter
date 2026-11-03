// The Collection showcase puts a page's most valuable spares on display, the way the Arsenal shows gear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickShowcase } from "../src/lib/core/showcase";

type Row = { name: string; rank: number; spare: number | null; price: number | null };
const row = (name: string, spare: number | null, price: number | null = null, rank = 0): Row => ({ name, rank, spare, price });
const opts = { spare: (r: Row) => r.spare, held: (r: Row) => r.price, name: (r: Row) => r.name };

test("the five most valuable spares, most first, ties by name", () => {
  const rows = [row("Gamma", 40), row("Alpha", 120), row("Beta", 40), row("Delta", 10), row("Eta", 5), row("Zeta", 300), row("Theta", 2)];
  const s = pickShowcase(rows, opts);
  assert.equal(s.mode, "spares");
  assert.deepEqual(s.items.map((x) => x.row.name), ["Zeta", "Alpha", "Beta", "Gamma", "Delta"]);
  assert.deepEqual(s.items.map((x) => x.value), [300, 120, 40, 40, 10]);
  assert.equal(pickShowcase(rows, { ...opts, n: 2 }).items.length, 2);
});

test("an item's rows share one place, their spares added up, shown by the row with the most", () => {
  const rows = [row("Vitality", 30, null, 0), row("Vitality", 50, null, 10), row("Reach", 60)];
  const s = pickShowcase(rows, opts);
  assert.deepEqual(s.items.map((x) => [x.row.name, x.row.rank, x.value]), [["Vitality", 10, 80], ["Reach", 0, 60]]);
  // By a key of its own: two kinds with one name stay apart.
  const k = pickShowcase(rows, { ...opts, key: (r) => `${r.name}|${r.rank}` });
  assert.equal(k.items.length, 3);
});

test("spares worth nothing, or under 1p, leave the stage to what you hold", () => {
  const rows = [row("Cheap", 0.4, 3), row("Dear", null, 90), row("Mid", 0, 20), row("Unpriced", null, null)];
  const s = pickShowcase(rows, opts);
  assert.equal(s.mode, "held");
  assert.deepEqual(s.items.map((x) => x.row.name), ["Dear", "Mid", "Cheap"]);
});

test("nothing held or priced: an empty stage", () => {
  assert.deepEqual(pickShowcase([row("A", null)], opts), { mode: "empty", items: [] });
  assert.deepEqual(pickShowcase([], opts), { mode: "empty", items: [] });
  assert.equal(pickShowcase([row("A", null, 5)], { spare: opts.spare, name: opts.name }).mode, "empty", "no held ranking given");
  assert.equal(pickShowcase([row("A", Number.NaN, 5)], opts).mode, "held");
});
