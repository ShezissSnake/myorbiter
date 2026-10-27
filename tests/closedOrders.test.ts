import { test } from "node:test";
import assert from "node:assert/strict";
import { importClosed, type ClosedOrder } from "../src/lib/core/closedOrders";
import type { Sale } from "../src/lib/backend";

const H = 3_600_000;
const T = Date.parse("2026-09-17T21:14:52Z");
const closed = (id: string, name: string, at: number, extra: Partial<ClosedOrder> = {}): ClosedOrder => ({ id, kind: "sell", slug: name.toLowerCase().replace(/ /g, "_"), name, rank: null, quantity: 1, platinum: 26, closedAt: new Date(at).toISOString(), ...extra });

test("closed sales the log doesn't have are added; ones it has are matched, once", () => {
  const sales: Sale[] = [{ at: T - 2 * H, item: "Arcane Agility", rank: 5, quantity: 1, platinum: 24, trade: "k1" }];
  const orders = [closed("o1", "Arcane Agility", T, { rank: 5 }), closed("o2", "Blind Rage", T - 30 * H, { platinum: 18.4 }), closed("o3", "Serration", T, { kind: "buy" })];
  const r = importClosed(sales, orders);
  assert.deepEqual([r.added, r.matched], [1, 1]);
  assert.equal(r.sales[0].wfm, "o1", "the logged sale keeps what you got, and the order's id");
  assert.equal(r.sales[0].platinum, 24);
  assert.deepEqual(r.sales[1], { at: T - 30 * H, item: "Blind Rage", rank: null, quantity: 1, platinum: 18, wfm: "o2" });
  const again = importClosed(r.sales, orders);
  assert.deepEqual([again.added, again.matched], [0, 0], "importing again changes nothing");
});

test("a sale of the same item at another rank, or a day apart, isn't the same sale", () => {
  const sales: Sale[] = [{ at: T, item: "Arcane Agility", rank: 0, quantity: 1, platinum: 8 }, { at: T - 30 * H, item: "Blind Rage", rank: null, quantity: 1, platinum: 18 }];
  const r = importClosed(sales, [closed("o1", "Arcane Agility", T, { rank: 5 }), closed("o2", "Blind Rage", T)]);
  assert.deepEqual([r.added, r.matched], [2, 0]);
});
