// warframe.market's live feed of new orders is connected only while something is watched, and
// never more often than once at start: a watchlist that empties for a moment doesn't cost a new
// connection. market.feed is stubbed; nothing here reaches warframe.market.
import "./support/runes";
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market, type FeedState } from "../src/lib/backend";
import type { Model } from "../src/lib/core/model";
import type { Watch } from "../src/lib/core/deals";

const { mkt, FEED_LINGER_MS } = await import("../src/lib/marketStore.svelte");

const model = {} as Model;
const item = { id: "i1", slug: "serration", gameRef: null, name: "Serration", maxRank: 10, subtypes: null, tags: null };
const watch: Watch[] = [{ name: "Serration", kind: "alert", rank: null, why: "your price alert" } as Watch];
/** Every market.feed call: true to connect, false to close. */
let calls: boolean[] = [];

beforeEach(() => {
  calls = [];
  market.feed = async (on: boolean): Promise<FeedState> => {
    calls.push(on);
    return { running: on, connected: false, received: 0, error: null };
  };
  mkt.items = [item];
});

test("App.svelte doesn't connect the live feed itself: the store does, while something is watched", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(app, /\.feed\(true\)/);
});

test("nothing watched: the live feed is never connected", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (let i = 0; i < 10; i++) mkt.watchLive(model, []);
    mock.timers.tick(2 * 3_600_000);
    assert.deepEqual(calls, [], "no connection in two hours");
  } finally {
    mock.timers.reset();
  }
});

test("something watched: one connection, held however often the watchlist is worked out again, and closed once it has stayed empty", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    // A session with a watchlist: the model is rebuilt again and again (a new inventory, prices).
    for (let i = 0; i < 60; i++) {
      mkt.watchLive(model, watch);
      mock.timers.tick(60_000);
    }
    assert.deepEqual(calls, [true], "one connection in an hour");
    // The list empties for a moment (a model rebuilt mid-read) and fills again: no new connection.
    mkt.watchLive(model, []);
    mock.timers.tick(FEED_LINGER_MS - 1_000);
    mkt.watchLive(model, watch);
    mock.timers.tick(FEED_LINGER_MS * 3);
    assert.deepEqual(calls, [true]);
    // Empty for good: closed after the linger, once.
    mkt.watchLive(model, []);
    mkt.watchLive(model, []);
    mock.timers.tick(FEED_LINGER_MS - 1_000);
    assert.deepEqual(calls, [true], "still connected inside the linger");
    mock.timers.tick(1_000);
    mkt.watchLive(model, []);
    mock.timers.tick(FEED_LINGER_MS * 3);
    assert.deepEqual(calls, [true, false]);
    // Something watched again: connected again.
    mkt.watchLive(model, watch);
    assert.deepEqual(calls, [true, false, true]);
  } finally {
    // Back to nothing watched, for the next test.
    mkt.watchLive(model, []);
    mock.timers.tick(FEED_LINGER_MS);
    mock.timers.reset();
  }
});

test("names the watchlist holds that warframe.market doesn't list don't connect the feed", () => {
  mkt.watchLive(model, [{ ...watch[0], name: "Not An Item" }]);
  assert.deepEqual(calls, []);
});
