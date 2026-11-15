// Browse market's Sold/day: something that sells never reads "0". Under a tenth a day reads as
// that, blank stays "hasn't sold lately", and the column still sorts by the real pace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { soldPerDay } from "../src/lib/ui/table";

test("a pace under a tenth a day reads <0.1, never 0", () => {
  assert.equal(soldPerDay(0.04), "<0.1");
  assert.equal(soldPerDay(0.001), "<0.1");
  assert.equal(soldPerDay(0.05), 0.1);
  assert.equal(soldPerDay(0.1), 0.1);
  assert.equal(soldPerDay(2.46), 2.5);
  assert.equal(soldPerDay(null), null, "blank: hasn't sold lately");
});

test("Browse market's column shows that and sorts by the number, as before", () => {
  const src = readFileSync("src/lib/tabs/Market.svelte", "utf8");
  const col = src.split("\n").find((l) => l.includes('key: "trades", label: "Sold/day"'));
  assert.ok(col, "the Sold/day column");
  assert.match(col, /value: \(r\) => soldPerDay\(r\.tradesPerDay\)/);
  // "<0.1" is text: the sort goes by the number the column showed before, so its order is unchanged.
  assert.match(col, /sortValue: \(r\) => daily\(r\.tradesPerDay\)/);
  assert.ok(src.includes("const daily = (t: number | null) => (t == null ? null : Math.round(t * 10) / 10);"));
});
