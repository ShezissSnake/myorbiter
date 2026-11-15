// A raise is never held back on the timer: the 70% line only ever stops a price going down
// (core/approved.ts › unattendedMove), and a listing under a hard floor (its own floor, a
// relic's crack value, a prime's ducats, the minimum) is raised to it at once, not an hour
// after its last change. The day's limit of changes still holds. Every market call is replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { h, mkt, order, seller, settings, timedPass, logText } from "./support/pass";
import { unattendedMove } from "../src/lib/core/approved";
import { DRIFT, noteChange } from "../src/lib/core/drift";

test("at 60p, approved 100p, the market at 65p: the move goes up to 65p", () => {
  assert.deepEqual(unattendedMove(65, 60, 100), { go: true, target: 65, atFloor: false });
  assert.deepEqual(unattendedMove(60, 60, 100), { go: true, target: 60, atFloor: false }, "no move is no drop");
  assert.deepEqual(unattendedMove(50, 60, 100), { go: false, floor: 70 }, "a drop from under the line is still held");
});

test("a timed pass raises a listing at 60p toward a 65p market, approved 100p", async () => {
  h.mine = [order(60)];
  h.book = [seller(65), seller(65)];
  await timedPass(settings({ "it||": 100 }, { approvedFor: { a: { key: "it||", platinum: 100 } } }));
  assert.deepEqual(h.sent, [["a", 65]], logText());
});

test("a listing at 5p under a 10p minimum is raised to it, approved 100p", async () => {
  h.mine = [order(5)];
  h.book = [seller(3), seller(3)];
  await timedPass(settings({ "it||": 100 }, { minPrice: 10, approvedFor: { a: { key: "it||", platinum: 100 } } }));
  assert.deepEqual(h.sent, [["a", 10]], logText());
});

test("changed 10 minutes ago, now under a newly raised 10p minimum: a timed pass raises it at once", async () => {
  h.mine = [order(5)];
  h.book = [seller(3), seller(3)];
  const s = settings({ "it||": 5 }, { minPrice: 10, changes: noteChange(undefined, "it||", h.now - 10 * 60_000) });
  await timedPass(s);
  assert.deepEqual(h.sent, [["a", 10]], logText());
});

test("under its own floor, changed 10 minutes ago: raised at once; a raise over no floor still waits the hour", async () => {
  h.mine = [order(20)];
  h.book = [seller(40), seller(40)];
  const s = settings({ "it||": 20 }, { floors: { "it||": 30 }, changes: noteChange(undefined, "it||", h.now - 10 * 60_000) });
  await timedPass(s);
  assert.deepEqual(h.sent, [["a", 40]], logText());
  // Over its floor now; the market up to 50p is a raise past no floor: the hour holds.
  h.sent = [];
  h.book = [seller(50), seller(50)];
  h.now += 10 * 60_000;
  await timedPass(s);
  assert.deepEqual(h.sent, [], logText());
});

test("the day's limit still holds a raise to a hard floor: a change refused again and again is not sent every pass", async () => {
  h.mine = [order(5)];
  h.book = [seller(3), seller(3)];
  let changes = undefined as ReturnType<typeof noteChange> | undefined;
  for (let i = DRIFT.perDay; i > 0; i--) changes = noteChange(changes, "it||", h.now - i * 2 * 60_000);
  const s = settings({ "it||": 5 }, { minPrice: 10, changes });
  await timedPass(s);
  assert.deepEqual(h.sent, [], logText());
});
