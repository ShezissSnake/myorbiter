// The clock stepped back while MyOrbiter runs: what was read "in the future" isn't fresh. An order
// book, a price history and a Sell spares plan whose age is below zero are read (or worked out)
// again, as an old one is. market.book and market.history are stand-ins; nothing reaches the network.
import "./support/runes";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { market } from "../src/lib/backend";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");

const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
afterEach(() => (shift = 0));
const HOUR = 3_600_000;

test("an order book read before the clock went back an hour is read again", async () => {
  let reads = 0;
  market.book = (async () => {
    reads++;
    return [];
  }) as never;
  mkt.books = {};
  await mkt.book("example_alpha");
  await mkt.book("example_alpha");
  assert.equal(reads, 1, "fresh: kept for ten minutes");
  shift = -HOUR;
  await mkt.book("example_alpha");
  assert.equal(reads, 2, "read in the future: read again");
  await mkt.book("example_alpha");
  assert.equal(reads, 2, "and that read is fresh");
});

test("a price history read before the clock went back is read again", async () => {
  let reads = 0;
  market.history = (async () => {
    reads++;
    return [];
  }) as never;
  await mkt.history("example_bravo");
  await mkt.history("example_bravo");
  assert.equal(reads, 1);
  shift = -HOUR;
  await mkt.history("example_bravo");
  assert.equal(reads, 2);
});

test("a Sell spares plan made before the clock went back is worked out again before anything is sent", async () => {
  mkt.account = { linked: true, backing: "keyring", profile: { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true } as never, error: null };
  let planned = 0;
  const own = mkt as unknown as { planBulk: () => Promise<boolean> };
  own.planBulk = async () => {
    planned++;
    return true;
  };
  try {
    mkt.bulk = { actions: [], at: Date.now(), books: {}, skipped: new Set() };
    shift = -HOUR;
    const r = await mkt.applyBulk(null as never, {} as never, {} as never);
    assert.deepEqual(r, { sent: 0, failed: 0, outcome: "replanned" });
    assert.equal(planned, 1);
  } finally {
    delete (own as { planBulk?: unknown }).planBulk;
    mkt.bulk = null;
  }
});
