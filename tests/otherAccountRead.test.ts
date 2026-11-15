// A read under another account or platform doesn't have this account's listings, yet none of them
// is gone: an order id is never given to another listing. Their approvals are kept by order id in
// the settings (core/approved.ts › approvedEnded), across restarts, and back on their own account
// each listing gets its own back: a pass stops where the build before approvals per listing stops
// (70% of the 100p approved: 70p), never at 70% of a price a pass lowered it to. Every market call
// is replaced; a restart is the settings through JSON and nothing kept in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { h, mkt, order, seller, settings, timedPass, logText } from "./support/pass";
import { ENDED_KEPT, approvedOf, settleApprovals } from "../src/lib/core/approved";
import type { MarketSettings } from "../src/lib/backend";

type Owned = Record<string, { key: string; platinum: number }>;
const owned = (s: MarketSettings) => (s as MarketSettings & { approvedFor?: Owned }).approvedFor ?? {};

/** Approved at 100p, sitting at 75p (a pass lowered it), on the first account. */
const start = () => settings({ "it||": 100 }, { approvedFor: { a: { key: "it||", platinum: 100 } } });
/** MyOrbiter closed and started again: the settings as saved, nothing the store held in memory. */
function restart(s: MarketSettings): MarketSettings {
  (mkt as unknown as { endedApprovals?: Map<string, unknown> }).endedApprovals?.clear();
  (mkt as unknown as { floorTold: Set<string> }).floorTold.clear();
  mkt.orders = [];
  mkt.ordersAt = null;
  return JSON.parse(JSON.stringify(s));
}
/** A read that succeeded under the other account (or platform): `theirs` are its listings. */
async function otherRead(s: MarketSettings, theirs = [] as ReturnType<typeof order>[]) {
  mkt.items = [h.it];
  h.mine = theirs;
  await mkt.refresh(s);
}
/** Back on the first account, a timed pass with the market at 41p. */
async function backAndPass(s: MarketSettings) {
  mkt.items = [h.it];
  h.mine = [order(75, "a")];
  h.book = [seller(40), seller(41)];
  h.sent = [];
  await timedPass(s);
}

test("the other account's read, a restart, back: the pass stops at 70p, as the build before does", async () => {
  let s = start();
  await otherRead(s);
  s = restart(s);
  await backAndPass(s);
  assert.deepEqual(h.sent, [["a", 70]], logText());
  assert.deepEqual(owned(s).a, { key: "it||", platinum: 100 });
});

test("a restart first, then the other account's read, then back without a restart: 70p", async () => {
  let s = restart(start());
  await otherRead(s);
  await backAndPass(s);
  assert.deepEqual(h.sent, [["a", 70]], logText());
});

test("the other account's read and back, no restart at all: 70p", async () => {
  const s = start();
  await otherRead(s);
  await backAndPass(s);
  assert.deepEqual(h.sent, [["a", 70]], logText());
});

test("twice over, with restarts between: 70p", async () => {
  let s = start();
  await otherRead(s);
  s = restart(s);
  mkt.items = [h.it];
  h.mine = [order(75, "a")];
  await mkt.refresh(s);
  await otherRead(s);
  s = restart(s);
  await otherRead(s);
  s = restart(s);
  await backAndPass(s);
  assert.deepEqual(h.sent, [["a", 70]], logText());
});

test("both accounts list the same thing: each keeps its own approval, back and forth", async () => {
  let s = start();
  // The other account's own listing of it, at 50p: new to MyOrbiter, its own price.
  await otherRead(s, [order(50, "b")]);
  assert.deepEqual(owned(s), { b: { key: "it||", platinum: 50 } });
  s = restart(s);
  await backAndPass(s);
  assert.deepEqual(h.sent, [["a", 70]], logText());
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 100 } });
  // And on the other account again: its listing has its 50p back, not the first account's 100p.
  s = restart(s);
  await otherRead(s, [order(50, "b")]);
  assert.deepEqual(owned(s), { b: { key: "it||", platinum: 50 } });
});

test("a step back after the other account's read: the saved file still holds the 100p per key", async () => {
  const s = start();
  await otherRead(s);
  const saved = JSON.parse(JSON.stringify(s));
  assert.deepEqual(approvedOf(saved.approved), { "it||": 100 }, "the older build's own reader");
});

test("ended approvals kept: the latest ENDED_KEPT, the oldest dropped first", () => {
  const ended = Object.fromEntries(Array.from({ length: ENDED_KEPT }, (_, i) => [`e${i}`, { key: "x||", platinum: 5, at: 1000 + i }]));
  const r = settleApprovals({}, { a: { key: "it||", platinum: 100 } }, [], ended, 9_999);
  assert.equal(Object.keys(r.ended).length, ENDED_KEPT);
  assert.ok(r.ended.a && !r.ended.e0, "the newest kept, the oldest dropped");
});

test("a listing really sold on its own account still ends, and the next one takes its own price", async () => {
  let s = start();
  await otherRead(s); // the first account's read: a is gone
  s = restart(s);
  mkt.items = [h.it];
  h.mine = [order(60, "n")];
  await mkt.refresh(s);
  assert.deepEqual(owned(s), { n: { key: "it||", platinum: 60 } });
});
