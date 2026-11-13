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
  const { show, keep } = dueToShow([{ id: "a", at: 1000 }], [order("a", 1, { visible: false })], 1000, 0, 2000);
  assert.deepEqual(show.map((o) => o.id), ["a"]);
  assert.deepEqual(keep, []);
});

test("last copy: shown again when the wait is over, unless it sold or you showed it", () => {
  const hidden = [{ id: "a", at: 0 }, { id: "b", at: 0 }, { id: "c", at: 0 }, { id: "d", at: 8 * MIN }];
  const orders = [order("a", 1, { visible: false }), order("c", 1), order("d", 1, { visible: false })];
  const { show, keep } = dueToShow(hidden, orders, 10 * MIN, 10, 10 * MIN);
  assert.deepEqual(show.map((o) => o.id), ["a"], "b sold (gone), c you showed yourself");
  assert.deepEqual(keep, [{ id: "d", at: 8 * MIN }], "d's wait isn't over");
});

test("last copy: shown again only against an inventory read taken after it was hidden", () => {
  const hidden = [{ id: "a", at: 5 * MIN }];
  const orders = [order("a", 1, { visible: false })];
  // The wait is over, but the newest read predates the whisper: the copy may have sold in game since.
  for (const readAt of [null, 4 * MIN, 5 * MIN]) {
    const { show, keep, waiting } = dueToShow(hidden, orders, 20 * MIN, 10, readAt);
    assert.deepEqual(show, [], `read at ${readAt}`);
    assert.deepEqual(keep, hidden, "kept, with its time, to try again");
    assert.deepEqual(waiting?.map((h) => h.id), ["a"]);
  }
  // A read after the whisper: shown (still held to the keep rules when it's sent).
  const after = dueToShow(hidden, orders, 20 * MIN, 10, 6 * MIN);
  assert.deepEqual(after.show.map((o) => o.id), ["a"]);
  assert.deepEqual(after.keep, []);
  assert.deepEqual(after.waiting, []);
  // Turned off: due at once, but still only against a newer read.
  assert.deepEqual(dueToShow(hidden, orders, 5 * MIN, 0, 4 * MIN).show, []);
  // Still within its wait: not waiting for a read yet.
  assert.deepEqual(dueToShow(hidden, orders, 6 * MIN, 10, 4 * MIN).waiting, []);
});
