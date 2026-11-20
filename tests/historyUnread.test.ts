// A price history that could not be read is not a history with no sales: a relic whose history
// request fails (no answer, or an answer without the history) is not stamped as priced, and the
// price history panel says it could not read rather than that warframe.market didn't answer.
// market.items and market.history are stubbed; nothing here reaches warframe.market.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market } from "../src/lib/backend";

const { mkt } = await import("../src/lib/marketStore.svelte");

test("a relic whose price history could not be read is not stamped as priced", async () => {
  market.items = async () => [
    { id: "r1", slug: "lith_x1_relic", gameRef: "/r1", name: "Lith X1 Relic", maxRank: null, subtypes: ["intact", "radiant"], tags: ["relic"] },
    { id: "r2", slug: "lith_x2_relic", gameRef: "/r2", name: "Lith X2 Relic", maxRank: null, subtypes: ["intact", "radiant"], tags: ["relic"] },
  ];
  mkt.items = [];
  const day = new Date(Date.now() - 86_400_000).toISOString();
  market.history = async (slug: string) => {
    // What Rust gives the page for a reply without `statistics_closed`.
    if (slug === "lith_x1_relic") throw new Error("warframe.market answered with something MyOrbiter couldn't read: no price history in the reply");
    return [
      { at: day, median: 4, volume: 3, min: 3, max: 5, rank: null, subtype: "intact" },
      { at: day, median: 5, volume: 2, min: 4, max: 6, rank: null, subtype: "intact" },
    ];
  };
  const now = Date.now();
  const read = await mkt.readRelicPrices(["Lith X1", "Lith X2"], {}, now);
  assert.ok(read, "the read ran");
  assert.equal(read["Lith X1"], undefined, "not stamped: read again next time");
  assert.equal(read["Lith X2"]?.at, now, "the one that was read is stamped");
});

test("the price history panel's failed line is true whether the site didn't answer or answered with something else", () => {
  const source = readFileSync("src/lib/ui/PriceHistory.svelte", "utf8");
  const failed = source.match(/\{#if failed\}\s*<p[^>]*>([^<]*)<\/p>/)?.[1];
  assert.ok(failed, "the panel has a line for a history that failed");
  assert.doesNotMatch(failed, /didn't answer/, "an answer of another shape is an answer");
  assert.match(failed, /couldn't read/i);
});
