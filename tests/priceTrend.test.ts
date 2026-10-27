import { test } from "node:test";
import assert from "node:assert/strict";
import { daysFor, trend, trendWords, type PricePoint } from "../src/lib/core/priceTrend";

const DAY = 86_400_000;
const T = Date.parse("2026-10-26T00:00:00Z");
const pt = (daysAgo: number, median: number, volume = 10, extra: Partial<PricePoint> = {}): PricePoint => ({ at: new Date(T - daysAgo * DAY).toISOString(), median, volume, min: median, max: median, rank: null, subtype: null, ...extra });

test("one rank and variant, oldest first", () => {
  const pts = [pt(1, 7, 10, { rank: 0 }), pt(1, 120, 2, { rank: 5 }), pt(2, 6, 10, { rank: 0 })];
  assert.deepEqual(daysFor(pts, 5, null).map((d) => d.median), [120]);
  assert.deepEqual(daysFor(pts, 0, null).map((d) => d.median), [6, 7]);
  const relic = [pt(1, 3, 5, { subtype: "intact" }), pt(1, 9, 5, { subtype: "radiant" })];
  assert.deepEqual(daysFor(relic, null, null).map((d) => d.median), [3], "relics default to intact");
  assert.deepEqual(daysFor(relic, null, "radiant").map((d) => d.median), [9]);
});

test("this week against the month before, weighted by sales", () => {
  const days = daysFor([...Array.from({ length: 30 }, (_, i) => pt(8 + i, 10)), pt(3, 12, 10), pt(1, 11, 30)], null, null);
  const t = trend(days, T + DAY);
  assert.equal(Math.round(t.week! * 100) / 100, 11.25);
  assert.equal(t.month, 10);
  assert.equal(trendWords(t), "Up 13% this week");
  assert.equal(trendWords(trend(daysFor([pt(10, 10), pt(1, 10.2)], null, null), T + DAY)), "Steady this week");
  assert.equal(trendWords(trend([], T)), null);
});

test("recent price: the last 30 days' sales, weighted by how many sold, for one refinement", async () => {
  const { recentPrice } = await import("../src/lib/core/priceTrend");
  const day = (d: string, median: number, volume: number, subtype: string | null) => ({ at: `2026-${d}T00:00:00.000+00:00`, median, volume, min: median, max: median, rank: null, subtype });
  const pts = [day("08-01", 100, 50, "radiant"), day("10-20", 8, 3, "radiant"), day("10-25", 10, 1, "radiant"), day("10-25", 3, 9, "intact")];
  assert.equal(recentPrice(pts, null, "radiant"), 8.5);
  assert.equal(recentPrice(pts, null, "intact"), 3);
  assert.equal(recentPrice(pts, null, "flawless"), null);
  assert.equal(recentPrice(pts, null, "radiant", 1), 10);
  assert.equal(recentPrice(pts, null, "radiant", 1, 2), null, "one sale is too few");
});
