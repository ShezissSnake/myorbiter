import { test } from "node:test";
import assert from "node:assert/strict";
import { salesOf, tradesOf } from "../src/lib/core/saleLog";

test("the sale log reads back as saved; entries that aren't sales are left out", () => {
  const good = [
    { at: 1_790_000_000_000, item: "Serration", rank: 10, quantity: 1, platinum: 9, median: 8.5, trade: "k|1", wfm: "a".repeat(24) },
    { at: 1_790_000_000_001, item: "Mesa Prime Set", rank: null, quantity: 2, platinum: 60 },
  ];
  assert.deepEqual(salesOf(good), good);
  assert.deepEqual(salesOf([{ at: 1, item: "Old", quantity: 1, platinum: 5 }]), [{ at: 1, item: "Old", rank: null, quantity: 1, platinum: 5 }], "a sale saved without a rank");
  const junk = [null, 4, "x", [], { at: "1", item: "A", quantity: 1, platinum: 1 }, { at: 1, item: "", quantity: 1, platinum: 1 }, { at: 1, item: "A", quantity: 0, platinum: 1 }, { at: 1, item: "A", quantity: 1.5, platinum: 1 }, { at: 1, item: "A", quantity: 1, platinum: NaN }, { at: 1, item: "A", quantity: 1, platinum: 1, rank: "R5" }];
  assert.deepEqual(salesOf([...junk, good[1]]), [good[1]]);
  assert.deepEqual(salesOf({ 0: good[0] }), []);
  assert.deepEqual(salesOf([{ ...good[1], median: "58", trade: 5 }]), [good[1]], "a bad median or trade key is dropped, the sale kept");
});

test("the trade log reads back as saved; entries that aren't trades are left out", () => {
  const good = { key: "1790000000|512.4", at: 1_790_000_000_000, partner: "ExamplePlayer", offered: [{ name: "Mesa Prime Set", rank: null, count: 1 }], received: [], platOut: 0, platIn: 60 };
  assert.deepEqual(tradesOf([good]), [good]);
  for (const bad of [null, { ...good, key: 3 }, { ...good, at: null }, { ...good, offered: "x" }, { ...good, received: [{ name: "A", rank: null, count: 0 }] }, { ...good, platIn: Infinity }])
    assert.deepEqual(tradesOf([bad, good]), [good], JSON.stringify(bad));
});
