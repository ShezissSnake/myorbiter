// The meters' memory: what each showed last, so only a changed value moves (design/motion rule 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { METER_CAP, meterMemoryOf, moveFrom, recall, remember, type MeterMemory } from "../src/lib/core/meterMemory";

test("first sight: nothing remembered, no motion, then remembered", () => {
  const m: MeterMemory = [];
  assert.equal(recall(m, "orders.trades"), undefined);
  assert.equal(moveFrom(recall(m, "orders.trades"), 18), null);
  const after = remember(m, [["orders.trades", 18]]);
  assert.equal(recall(after, "orders.trades"), 18);
});

test("unchanged: no motion, and the memory is the same list (nothing to save)", () => {
  const m = remember([], [["a", 3], ["b", 5]]);
  assert.equal(moveFrom(recall(m, "b"), 5), null);
  assert.equal(remember(m, [["a", 3], ["b", 5]]), m);
  assert.equal(remember(m, []), m);
});

test("up and down: the meter starts at the value it last showed", () => {
  const m = remember([], [["mastery", 0.55], ["trades", 18]]);
  assert.equal(moveFrom(recall(m, "mastery"), 0.75), 0.55);
  assert.equal(moveFrom(recall(m, "trades"), 14), 18);
  const after = remember(m, [["mastery", 0.75], ["trades", 14]]);
  assert.equal(recall(after, "mastery"), 0.75);
  assert.equal(recall(after, "trades"), 14);
  assert.equal(after.length, 2);
});

test("values that aren't numbers never move and aren't kept", () => {
  assert.equal(moveFrom(3, NaN), null);
  assert.equal(moveFrom(NaN, 3), null);
  assert.deepEqual(remember([], [["x", NaN], ["y", Infinity], ["", 1], ["k".repeat(500), 1]]), []);
});

test("the cap: the meter shown longest ago goes first", () => {
  let m: MeterMemory = [];
  for (let i = 0; i < METER_CAP; i++) m = remember(m, [[`m${i}`, i]]);
  assert.equal(m.length, METER_CAP);
  // Shown again, m0 becomes the newest: m1 is now the oldest.
  m = remember(m, [["m0", 99]]);
  m = remember(m, [["new", 1]]);
  assert.equal(m.length, METER_CAP);
  assert.equal(recall(m, "m0"), 99);
  assert.equal(recall(m, "m1"), undefined);
  assert.equal(recall(m, "new"), 1);
  assert.equal(remember([], [["a", 1], ["b", 2], ["c", 3]], 2).map(([k]) => k).join(), "b,c");
});

test("read from a settings file: junk dropped, each key once, capped", () => {
  assert.deepEqual(meterMemoryOf(null), []);
  assert.deepEqual(meterMemoryOf({ a: 1 }), []);
  assert.deepEqual(meterMemoryOf([["a", 1], ["a", 2], ["b", "3"], [1, 2], ["c"], "x", ["d", NaN]]), [["a", 2]]);
  const many = Array.from({ length: METER_CAP + 50 }, (_, i) => [`k${i}`, i]);
  const m = meterMemoryOf(many);
  assert.equal(m.length, METER_CAP);
  assert.equal(m[0][0], "k50");
});
