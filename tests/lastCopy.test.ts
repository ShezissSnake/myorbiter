import { test } from "node:test";
import assert from "node:assert/strict";
import { dueToShow, hideNow, lastCopies } from "../src/lib/core/lastCopy";
import type { MyOrder } from "../src/lib/core/market";

const order = (id: string, quantity: number, extra: Partial<MyOrder> = {}): MyOrder => ({ id, itemId: `i${id}`, type: "sell", platinum: 10, quantity, rank: null, subtype: null, visible: true, updatedAt: null, ...extra });
const MIN = 60_000;

test("last copy: only shown sell listings with one copy left are hidden", () => {
  const orders = [order("a", 1), order("b", 3), order("c", 1, { visible: false }), order("d", 1, { type: "buy" })];
  assert.deepEqual(lastCopies(orders).map((o) => o.id), ["a"]);
});

test("last copy: another whisper doesn't make the wait longer", () => {
  const first = hideNow([], [order("a", 1)], 0);
  const again = hideNow(first, [order("a", 1), order("b", 1)], 5 * MIN);
  assert.deepEqual(again, [{ id: "a", at: 0 }, { id: "b", at: 5 * MIN }]);
});

test("last copy: turned off, everything it hid is due now", () => {
  const { show, keep } = dueToShow([{ id: "a", at: 1000 }], [order("a", 1, { visible: false })], 1000, 0);
  assert.deepEqual(show.map((o) => o.id), ["a"]);
  assert.deepEqual(keep, []);
});

test("last copy: shown again when the wait is over, unless it sold or you showed it", () => {
  const hidden = [{ id: "a", at: 0 }, { id: "b", at: 0 }, { id: "c", at: 0 }, { id: "d", at: 8 * MIN }];
  const orders = [order("a", 1, { visible: false }), order("c", 1), order("d", 1, { visible: false })];
  const { show, keep } = dueToShow(hidden, orders, 10 * MIN, 10);
  assert.deepEqual(show.map((o) => o.id), ["a"], "b sold (gone), c you showed yourself");
  assert.deepEqual(keep, [{ id: "d", at: 8 * MIN }], "d's wait isn't over");
});
