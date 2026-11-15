// A raise is never held back on the timer: the 70% line only ever stops a price going down
// (core/approved.ts › unattendedMove), and a listing under a hard floor (its own floor, a
// relic's crack value, a prime's ducats, the minimum) is raised to it at once, not an hour
// after its last change and whatever the day's count. Only a raise warframe.market refused waits
// the hour before it is tried again. Every market call is replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { h, order, seller, settings, timedPass, logText } from "./support/pass";
import { market } from "../src/lib/backend";
import { unattendedMove } from "../src/lib/core/approved";
import { DRIFT, cooldown, noteChange } from "../src/lib/core/drift";

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

test("six changes today, now under a 10p minimum: a timed pass still raises it at once", async () => {
  h.mine = [order(5)];
  h.book = [seller(3), seller(3)];
  let changes = undefined as ReturnType<typeof noteChange> | undefined;
  for (let i = DRIFT.perDay; i > 0; i--) changes = noteChange(changes, "it||", h.now - i * 2 * 60_000);
  await timedPass(settings({ "it||": 5 }, { minPrice: 10, changes }));
  assert.deepEqual(h.sent, [["a", 10]], logText());
});

test("a raise to a floor warframe.market refused is not sent again every pass: it waits the hour", async () => {
  h.mine = [order(5)];
  h.book = [seller(3), seller(3)];
  const update = market.update;
  let tries = 0;
  market.update = (async () => {
    tries++;
    throw new Error("400 Bad Request");
  }) as never;
  const s = settings({ "it||": 5 }, { minPrice: 10 });
  await timedPass(s);
  assert.equal(tries, 1, logText());
  // The pass's closing note doesn't promise the next pass.
  assert.match(logText(), /1 change refused by warframe\.market \(above\); not tried again by itself within the hour/);
  assert.doesNotMatch(logText(), /next pass/);
  h.now += 10 * 60_000;
  await timedPass(s);
  assert.equal(tries, 1, logText());
  market.update = update;
  h.now += 51 * 60_000;
  await timedPass(s);
  assert.deepEqual(h.sent, [["a", 10]], logText());
});

test("the cooldown on its own: a raise to a floor waits for neither limit, only for a refusal within the hour", () => {
  const six = Array.from({ length: DRIFT.perDay }, (_, i) => h.now - (i + 1) * 60_000);
  assert.deepEqual(cooldown(six, h.now, true), { ok: true });
  assert.deepEqual(cooldown(six, h.now, true, h.now - 59 * 60_000), { ok: false, until: h.now + 60_000, why: "hour" });
  assert.deepEqual(cooldown(six, h.now, true, h.now - DRIFT.cooldownMs), { ok: true });
  assert.equal(cooldown(six, h.now).ok, false, "any other change still waits");
});
