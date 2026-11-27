// warframe.market's riven lists while they can't be loaded (rivenStore's loadMeta, core/rivenLists.ts
// RivenListsWait): after a failed read no page sends another for at least a minute, the wait grows
// to ten minutes while the failures go on, and a read that works ends it. Every page asks through the
// same call (Orders at each read of the player's orders, Rivens on its timer, Builds, a riven
// cycle), so the calls here stand for any of them. The clock is the test's own, moved by hand; the
// read is replaced, and fetch throws, so nothing here reaches warframe.market. The waits are written
// out in minutes, as the rule gives them.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market } from "../src/lib/backend";
// Imported whole, so that this file also loads against a store from before the wait (where the
// first test fails on what is sent, as it should, rather than on a missing name).
import * as lists from "../src/lib/core/rivenLists";
import { tradeKey } from "../src/lib/core/trades";
import type { RivenMeta } from "../src/lib/core/rivens";

const noNetwork = (() => {
  throw new Error("no network in tests");
}) as never;
globalThis.fetch = noNetwork;
const { rivens } = await import("../src/lib/rivenStore.svelte");
const real = { ...market };
const MIN = 60_000;
const START = 1_800_000_000_000;
/** The test's clock (unix ms): the store's wait reads it. */
let now = START;
/** A fresh wait: no failure yet. */
const noWait = () => ("RivenListsWait" in lists ? new lists.RivenListsWait() : undefined);
beforeEach(() => {
  Object.assign(market, real);
  globalThis.fetch = noNetwork;
  rivens.meta = null;
  rivens.metaError = null;
  rivens.metaFailure = null;
  // A fresh store's state: no read out, no tries, no wait.
  Object.assign(rivens as unknown as object, { loading: null, pageReadOut: false, tradeTries: new lists.RivenListsTries(), listsWait: noWait() });
  now = START;
  rivens.clock = () => now;
});

const meta: RivenMeta = {
  weapons: [{ slug: "braton", gameRef: "/W/Braton", name: "Braton", group: "primary", rivenType: "rifle" }],
  attributes: [],
};
const down = () => Promise.reject(new Error("Couldn't reach warframe.market (timed out)"));
/** The read the pages make, replaced: counts each call, answers with `answer`'s result. */
function listsRead(answer: () => Promise<RivenMeta>) {
  const calls = { n: 0, answer };
  market.rivenMeta = async () => {
    calls.n++;
    return calls.answer();
  };
  return calls;
}
/** The player's Try now on Rivens: the one call that skips the wait. */
const tryNow = () => rivens.loadMeta(true);
const tradeKeyOf = (uptime: number) =>
  tradeKey(1_791_915_400, { uptime, at: 1_791_918_527, partner: "Buyer1", offered: [{ name: "Braton Crita-hexacan", rank: 0, count: 1, riven: true }], received: [], platinum_offered: 0, platinum_received: 120 });

test("after a failed read, no new read goes for a minute, whoever asks; the wait grows to ten minutes; a read that works ends it", async () => {
  const calls = listsRead(down);
  assert.equal(await rivens.loadMeta(), null);
  assert.equal(calls.n, 1);
  assert.match(rivens.metaError ?? "", /timed out/);
  // Orders at each read of the player's orders (every 30 s), Rivens' timer, Builds, a cycle:
  // inside the minute, none of them sends anything.
  for (const at of [0, 1, 30_000, 45_000, MIN - 1]) {
    now = START + at;
    assert.equal(await rivens.loadMeta(), null);
  }
  assert.equal(calls.n, 1, "nothing sent inside the minute after the failure");
  assert.match(rivens.metaError ?? "", /timed out/, "still shown as failed");
  // Each failure in a row doubles the wait, counted from when the read failed: 1, 2, 4, 8, then
  // 10 minutes at the most.
  let failedAt = START;
  for (const wait of [1, 2, 4, 8, 10, 10, 10].map((m) => m * MIN)) {
    now = failedAt + wait - 1;
    const before: number = calls.n;
    assert.equal(await rivens.loadMeta(), null);
    assert.equal(calls.n, before, `not before ${wait / MIN} min`);
    now = failedAt + wait;
    assert.equal(await rivens.loadMeta(), null);
    assert.equal(calls.n, before + 1, `once ${wait / MIN} min are over`);
    failedAt = now;
  }
  // A read that takes long fails when it fails: the wait runs from then, not from when it was sent.
  calls.answer = () => new Promise<RivenMeta>((_, no) => setTimeout(() => no(new Error("timed out")), 0));
  now = failedAt + 10 * MIN;
  const slow = rivens.loadMeta();
  now += 30_000;
  assert.equal(await slow, null);
  const n = calls.n;
  now += 10 * MIN - 1;
  await rivens.loadMeta();
  assert.equal(calls.n, n);
  // A read that works ends the wait: the lists are kept, and a later failure waits a minute again.
  calls.answer = async () => meta;
  now += 1;
  assert.deepEqual(await rivens.loadMeta(), meta);
  assert.equal(rivens.metaError, null);
  rivens.meta = null;
  Object.assign(rivens as unknown as object, { loading: null });
  calls.answer = down;
  await rivens.loadMeta();
  const m = calls.n;
  now += MIN - 1;
  await rivens.loadMeta();
  assert.equal(calls.n, m);
  now += 1;
  await rivens.loadMeta();
  assert.equal(calls.n, m + 1, "back to a minute after a read that worked");
});

test("a read that is out is shared; a page asking inside the wait gets what a failed read gives and sends nothing", async () => {
  const release: ((e: Error) => void)[] = [];
  const calls = listsRead(() => new Promise<RivenMeta>((_, no) => release.push(no)));
  // Orders and Rivens ask while one read is out: one read.
  const orders = rivens.loadMeta();
  const page = rivens.loadMeta();
  assert.equal(calls.n, 1);
  release[0](new Error("warframe.market answered 503"));
  assert.equal(await orders, null);
  assert.equal(await page, null);
  // Builds asks inside the wait: null and the failure, as after a failed read, and nothing sent.
  now += 20_000;
  assert.equal(await rivens.loadMeta(), null);
  assert.match(rivens.metaError ?? "", /503/);
  assert.equal(calls.n, 1);

  // A wait a riven trade's failed read started: the trade's failure isn't shown, but a page that
  // asks inside it gets what a failed read gives, so Rivens says so and keeps asking on its timer.
  rivens.metaError = null;
  Object.assign(rivens as unknown as object, { listsWait: noWait() });
  calls.answer = down;
  const asked = rivens.loadMetaForTrades([tradeKeyOf(3127.384)], now);
  assert.ok(asked);
  assert.equal((await asked.done).meta, null);
  assert.equal(calls.n, 2);
  assert.equal(rivens.metaError, null, "the trade's failure stays off the pages");
  now += 1000;
  assert.equal(await rivens.loadMeta(), null);
  assert.equal(calls.n, 2, "inside the wait the trade's failure started: nothing sent");
  assert.match(rivens.metaError ?? "", /timed out/);
  // Once it is over, the page's next ask goes.
  now += MIN;
  await rivens.loadMeta();
  assert.equal(calls.n, 3);
});

test("Try now asks at once, inside the wait; it shares a read that is out, and a failure still grows the wait", async () => {
  const calls = listsRead(down);
  await rivens.loadMeta();
  now += 5_000;
  await rivens.loadMeta();
  assert.equal(calls.n, 1);
  // The player's click: sent now.
  assert.equal(await tryNow(), null);
  assert.equal(calls.n, 2);
  // It failed again: two in a row, so the next waits two minutes from that failure.
  now += 2 * MIN - 1;
  await rivens.loadMeta();
  assert.equal(calls.n, 2);
  now += 1;
  await rivens.loadMeta();
  assert.equal(calls.n, 3);
  // A click while a read is out shares it.
  const release: ((m: RivenMeta) => void)[] = [];
  calls.answer = () => new Promise<RivenMeta>((r) => release.push(r));
  now += 30 * MIN;
  const out = rivens.loadMeta();
  const click = tryNow();
  assert.equal(calls.n, 4);
  release[0](meta);
  assert.deepEqual(await out, meta);
  assert.deepEqual(await click, meta);
});

test("a riven trade keeps its tries: three a minute apart, not held by the pages' wait, never sooner, off the pages", async () => {
  // The trade's tries are spaced from when each one failed by the real clock (as in the store), so
  // this test goes by it too.
  rivens.clock = () => Date.now();
  const calls = listsRead(down);
  // A page's read fails; a riven trade due a moment later asks as it does today.
  await rivens.loadMeta();
  rivens.metaError = "the page's own reason";
  const k = [tradeKeyOf(3127.384)];
  let at = Date.now();
  for (let n = 1; n <= lists.RIVEN_LISTS_TRIES; n++) {
    const asked = rivens.loadMetaForTrades(k, at);
    assert.ok(asked, `try ${n}, inside the pages' wait`);
    assert.equal(asked.try, n);
    const sent = Date.now();
    const { meta: got, again } = await asked.done;
    assert.equal(got, null);
    assert.equal(again, n < lists.RIVEN_LISTS_TRIES);
    assert.equal(calls.n, 1 + n);
    assert.equal(rivens.metaError, "the page's own reason", "a trade's failure stays off the pages");
    // Never sooner than a minute after it failed.
    assert.equal(rivens.loadMetaForTrades(k, sent + MIN - 1), null);
    at = Date.now() + MIN;
  }
  // No fourth.
  assert.equal(rivens.loadMetaForTrades(k, at + 60 * MIN), null);
  assert.equal(calls.n, 1 + lists.RIVEN_LISTS_TRIES);
});

test("with the lists loaded, or answered from the copy on disk, nothing waits and nothing more is read", async () => {
  // The Rust side answers from its copy (or warframe.market answers): no failure, no wait.
  const calls = listsRead(async () => meta);
  assert.deepEqual(await rivens.loadMeta(), meta);
  assert.equal(rivens.metaError, null);
  for (const at of [0, 1, 30_000, MIN, 10 * MIN]) {
    now = START + at;
    assert.deepEqual(await rivens.loadMeta(), meta);
  }
  assert.equal(calls.n, 1, "kept for the run: no new read");
  // Lists a riven trade's read brought inside a wait: every page has them at once, nothing sent.
  rivens.meta = null;
  Object.assign(rivens as unknown as object, { loading: null });
  calls.answer = down;
  await rivens.loadMeta();
  assert.equal(calls.n, 2);
  calls.answer = async () => meta;
  now += 1000;
  const asked = rivens.loadMetaForTrades([tradeKeyOf(3127.384)], now);
  assert.deepEqual((await asked!.done).meta, meta);
  assert.equal(calls.n, 3);
  assert.deepEqual(await rivens.loadMeta(), meta);
  assert.equal(rivens.metaError, null);
  assert.equal(calls.n, 3);
  // A read that works leaves no wait behind: with the lists gone (a fresh run's state), the next
  // ask goes at once.
  rivens.meta = null;
  Object.assign(rivens as unknown as object, { loading: null });
  now += 1;
  assert.deepEqual(await rivens.loadMeta(), meta);
  assert.equal(calls.n, 4);
});
