// A trade handled again (its key lost, its sales kept) logs and marks nothing more: the copies it
// logged before are taken by item and rank, whichever line they were logged under (takeLogged).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loggedForTrade, placeTradeLine } from "../src/lib/core/trades";
import type { Sale } from "../src/lib/backend";

const at = 1_792_512_340_000;
const relic = (count: number) => ({ name: "Axi A1 Relic", rank: null, count });
const sale = (quantity: number, trade = "s|1"): Sale => ({ at, item: "Axi A1 Relic", rank: null, quantity, platinum: 5, trade });

/** The copies each line would log and mark sold again, handled in this order. */
const again = (sales: Sale[], lines: { name: string; rank: number | null; count: number }[]) => {
  const logged = loggedForTrade(sales, "s|1");
  return lines.map((l) => placeTradeLine(sales, logged, l, at, "s|1").left);
};

test("lines of 4 and 3 of one relic, logged as 3, 2 and 2 (a line split by a hand-logged sale): nothing again, in either order", () => {
  // The line of 4 claimed a hand-logged sale of 2 and logged 2; the line of 3 logged its 3.
  const sales = [sale(3), sale(2), sale(2)];
  assert.deepEqual(again(sales, [relic(4), relic(3)]), [0, 0], "4, then 3");
  assert.deepEqual(again(sales, [relic(3), relic(4)]), [0, 0], "3, then 4");
});

test("the other split: the line of 3 claimed a hand-logged sale of 2 and logged 1, the line of 4 its 4", () => {
  const sales = [sale(2), sale(1), sale(4)];
  assert.deepEqual(again(sales, [relic(4), relic(3)]), [0, 0], "4, then 3");
  assert.deepEqual(again(sales, [relic(3), relic(4)]), [0, 0], "3, then 4");
});

test("a keyed sale larger than its line, as older versions claimed a hand-logged sale whole: the line is covered", () => {
  // 5 logged by hand, claimed whole by a trade of 3.
  assert.deepEqual(again([sale(5)], [relic(3)]), [0]);
  // And against two lines of one item, 2 and 1.
  assert.deepEqual(again([sale(5)], [relic(2), relic(1)]), [0, 0]);
});

test("two lines, no logged sale of either line's own count: each is covered from the trade's copies", () => {
  // Lines of 3 and 2; the line of 3 was a hand-logged 1 and a logged 2, the line of 2 logged 2.
  const sales = [sale(1), sale(2), sale(2)];
  assert.deepEqual(again(sales, [relic(3), relic(2)]), [0, 0]);
  assert.deepEqual(again(sales, [relic(2), relic(3)]), [0, 0]);
});

test("copies the trade did not log before are still logged: only those", () => {
  // Lines of 4 and 3, but only 5 copies in the record (the log was cut, say): 2 are left, once.
  const left = again([sale(3), sale(2)], [relic(4), relic(3)]);
  assert.equal(left.reduce((a, b) => a + b, 0), 2);
  // Another trade's sales and another rank are not this trade's.
  assert.deepEqual(again([sale(3, "s|2")], [relic(3)]), [3]);
  assert.deepEqual(
    again([{ at, item: "Serration", rank: 10, quantity: 3, platinum: 20, trade: "s|1" }], [{ name: "Serration", rank: 0, count: 3 }]),
    [3],
  );
});

test("the record is not changed by handling a trade again", () => {
  const sales = [sale(3), sale(2), sale(2)];
  const before = JSON.stringify(sales);
  again(sales, [relic(4), relic(3)]);
  assert.equal(JSON.stringify(sales), before);
});
