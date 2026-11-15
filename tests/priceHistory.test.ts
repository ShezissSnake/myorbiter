// A price history with one day of sales says so in words about sales: TimeChart's own words for a
// single point are about MyOrbiter's inventory reads ("the line starts with the next one").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("one day of sales in 90: the chart speaks of sales, not of readings", () => {
  const chart = readFileSync("src/lib/ui/PriceHistory.svelte", "utf8").match(/<TimeChart\b[\s\S]*?\/>/)?.[0];
  assert.ok(chart, "the history draws a TimeChart");
  const single = chart.match(/\bsingle="([^"]*)"/)?.[1];
  assert.ok(single != null, "it says what a single day means, rather than TimeChart's default");
  assert.match(single, /\bsold\b/i);
  assert.doesNotMatch(single, /reading|next one/i);
});
