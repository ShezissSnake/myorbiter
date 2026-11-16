// The sentence Settings, Orders and the Guide show for what automatic repricing never does
// (core/approved.ts › AUTO_LIMITS) is held to the code: the share it names is the one the pass
// lowers to, the halving it names is the cut the pass holds back, and what it says of a raise
// (never held back by the 70% mark; up to a listing's own floor or the minimum at once) is what a
// pass on the timer does. Change the rule without the sentence, or the sentence without the
// rule, and a test here fails. Every market call is replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { h, mkt, order, seller, settings, timedPass, logText } from "./support/pass";
import { AUTO_FLOOR_SHARE, AUTO_LEAST_KEPT, AUTO_LIMITS, AUTO_LIMITS_CONSOLE, autoFloor, cutTooFar, unattendedMove } from "../src/lib/core/approved";
import { DRIFT, DRIFT_RULES, noteChange } from "../src/lib/core/drift";

const both = [AUTO_LIMITS, AUTO_LIMITS_CONSOLE];

test("the share it names is the one a pass lowers a listing to", async () => {
  const pct = Number(/under (\d+)% of the one you last set or approved/.exec(AUTO_LIMITS)?.[1]);
  assert.equal(pct, Math.round(AUTO_FLOOR_SHARE * 100));
  // Approved 100p, listed at 100p, the market at 10p: a timed pass goes no lower than that share.
  h.mine = [order(100)];
  h.book = [seller(10), seller(10)];
  await timedPass(settings({ "it||": 100 }));
  assert.deepEqual(h.sent, [["a", autoFloor(100)]], logText());
  assert.equal(autoFloor(100), pct);
  for (const s of both) assert.match(s, /it stops there and says so/);
});

test("the cut it names is the one a pass holds back for Reprice", async () => {
  assert.equal(AUTO_LEAST_KEPT, 0.5, "the sentence says the pass never more than halves a price");
  for (const s of both) assert.match(s, /never more than halves a price \(that waits for you to press Reprice\)/);
  assert.ok(cutTooFar(49, 100) && !cutTooFar(50, 100));
  // Approved 40p, so the 70% mark (28p) doesn't stop it: from 100p, a 45p market is more than half
  // off and waits; a 50p one goes.
  h.mine = [order(100)];
  h.book = [seller(45), seller(45)];
  await timedPass(settings({ "it||": 40 }));
  assert.deepEqual(h.sent, [], `under half waits: ${logText()}`);
  h.book = [seller(50), seller(50)];
  await timedPass(settings({ "it||": 40 }));
  assert.deepEqual(h.sent, [["a", 50]], logText());
});

test("what it says of a raise is what a pass does: the 70% mark never holds one back", async () => {
  for (const s of both) assert.match(s, /that mark never holds back a raise/);
  for (let current = 1; current <= 200; current += 7) for (let target = current; target <= 220; target += 11) assert.deepEqual(unattendedMove(target, current, 1000), { go: true, target, atFloor: false });
  h.mine = [order(60)];
  h.book = [seller(66), seller(66)];
  await timedPass(settings({ "it||": 100 }));
  assert.deepEqual(h.sent, [["a", 66]], logText());
});

test("what it says of a listing under its own floor or the minimum is what a pass does: raised at once, whatever the hour or the day's count", async () => {
  for (const s of both) assert.match(s, /never goes under a listing's own floor \(the one in its row, a relic's crack value, a prime part's ducats\) or your minimum price, and raises a listing that sits under one of them to at least that at once/);
  assert.match(DRIFT_RULES, /a raise up to such a floor waits for neither\)$/);
  // Changed 10 minutes ago, under a 10p minimum: raised now.
  h.mine = [order(5)];
  h.book = [seller(3), seller(3)];
  await timedPass(settings({ "it||": 5 }, { minPrice: 10, changes: noteChange(undefined, "it||", h.now - 10 * 60_000) }));
  assert.deepEqual(h.sent, [["a", 10]], logText());
});

// What it says of a price typed on one of two listings of an item, with an earlier version's
// price saved for it: a, listed at 100p, and b, at 30p, both held by the 20p saved before; 100p
// typed on b. b's approval and the item's price are 100p; a keeps the 20p, so a pass with the
// market at 60p sends a to 60p (an older build, holding every listing by the item's one price,
// stops it at 70p). b, of the same key, then waits for the hour a's change starts.
test("what it says of a price typed on one listing is what a pass does: the others already up keep the earlier price", async () => {
  for (const s of both) assert.match(s, /a price you type or reprice on one listing leaves the others already up at the earlier one/);
  h.mine = [order(100, "a"), order(30, "b")];
  const s = settings({ "it||": 20 });
  mkt.items = [h.it];
  mkt.rules = s;
  await mkt.refresh(s);
  await mkt.update(mkt.orders.find((o) => o.id === "b")!, { platinum: 100 });
  h.book = [seller(60), seller(60)];
  h.sent = [];
  h.now += 25 * 3600e3;
  await timedPass(s);
  assert.deepEqual(h.sent, [["a", 60]], logText());
  const owned = (s as typeof s & { approvedFor?: Record<string, { key: string; platinum: number }> }).approvedFor ?? {};
  assert.deepEqual({ a: owned.a?.platinum, b: owned.b?.platinum, item: s.approved["it||"] }, { a: 20, b: 100, item: 100 });
});

test("its floors are a listing's own and the minimum, never Orders' Floor share of the market price", () => {
  for (const s of both) {
    assert.doesNotMatch(s, /your own floors/);
    assert.doesNotMatch(s, /share of (the )?market/);
  }
});

test("what it says of approvals is the rule: they belong to the listing, and a new one starts from its own price unless an earlier version saved one for the item", async () => {
  for (const s of both) assert.match(s, /The approval belongs to the listing: once it is sold out, removed or made again, it ends, and a new listing starts from its own price, whoever made it, unless an earlier version saved one for that item, which holds every listing of it until you price one again \(a price you type or reprice on one listing leaves the others already up at the earlier one\)\./);
  // A listing made on the website at 60p, the market at 41p, nothing saved for the item: its own
  // 60p holds it at 42p.
  const pass = async (saved: Record<string, number>) => {
    h.mine = [order(60, "w")];
    h.book = [seller(40), seller(41)];
    h.sent = [];
    await timedPass(settings(saved));
    return h.sent;
  };
  assert.deepEqual(await pass({}), [["w", 42]], logText());
  // An earlier version saved 50p for the item: that holds it instead, lower than its own (41p).
  assert.deepEqual(await pass({ "it||": 50 }), [["w", 41]], logText());
  // It saved 100p: held at 70p, higher than its own, so a 60p listing is left where it is.
  assert.deepEqual(await pass({ "it||": 100 }), [], logText());
  assert.match(AUTO_LIMITS, /a Sell spares line that changes it/);
  assert.doesNotMatch(AUTO_LIMITS_CONSOLE, /Sell spares/);
});
