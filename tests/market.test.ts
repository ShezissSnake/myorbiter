import { test } from "node:test";
import assert from "node:assert/strict";
import { competitor, knownName, plan, salesCoveredByTrades, type BookOrder, type MyOrder } from "../src/lib/core/market";
import type { Sale, TradeLogEntry } from "../src/lib/backend";

const me = { id: "me", platform: "pc", crossplay: true };
let n = 0;
const sell = (platinum: number, status: string, extra: Omit<Partial<BookOrder>, "user"> & { user?: Partial<BookOrder["user"]> } = {}): BookOrder => ({
  id: `o${n++}`, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true,
  ...extra,
  user: { id: `u${n}`, ingameName: `seller${n}`, status, platform: "pc", crossplay: true, ...(extra.user ?? {}) },
});
const mine = (platinum: number, extra: Partial<MyOrder> = {}): MyOrder => ({
  id: "mine", itemId: "item", type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null, ...extra,
});

// The README's example: the order should land on 20p.
const book = [
  sell(15, "offline"), sell(16, "offline"), sell(17, "online"), sell(20, "ingame"),
  sell(21, "online"), sell(23, "offline"), sell(23, "ingame"),
];

test("matches the cheapest seller who is in game", () => {
  const p = plan(mine(25), book, me, { floor: null, minShare: 0, reference: null });
  assert.equal(p.target, 20);
  assert.equal(p.change, true);
  assert.equal(p.competitor.sellers, 2);
  assert.deepEqual(p.competitor.ladder, [20, 23]);
});

test("raises to match too, and ignores your own order", () => {
  const withMe = [...book, sell(12, "ingame", { user: { id: "me" } })];
  assert.equal(plan(mine(12), withMe, me, { floor: null, minShare: 0, reference: null }).target, 20);
});

test("only compares the same rank, subtype, and tradable platforms", () => {
  const b = [
    sell(5, "ingame", { rank: 0 }), sell(90, "ingame", { rank: 5 }),
    sell(1, "ingame", { rank: 5, user: { platform: "ps4", crossplay: false } }),
    sell(80, "ingame", { rank: 5, subtype: "radiant" }),
  ];
  assert.equal(competitor({ rank: 5, subtype: null }, b, me).price, 90);
  assert.equal(competitor({ rank: 5, subtype: "radiant" }, b, me).price, 80);
  const noCross = { ...me, crossplay: false };
  assert.equal(competitor({ rank: 5, subtype: null }, [sell(70, "ingame", { rank: 5, user: { platform: "xbox", crossplay: true } })], noCross).price, null);
});

test("an order without a variant counts as the item's first one", () => {
  const b = [sell(3, "ingame", { subtype: "regular", rank: 0 }), sell(1, "ingame", { subtype: "atragraph", rank: 0 })];
  assert.equal(competitor({ rank: 0, subtype: null }, b, me, "regular").price, 3);
  assert.equal(competitor({ rank: 0, subtype: "atragraph" }, b, me, "regular").price, 1);
});

test("never goes below the floor", () => {
  const troll = [sell(1, "ingame")];
  const own = plan(mine(30), troll, me, { floor: 18, minShare: 0, reference: null });
  assert.equal(own.target, 18);
  assert.equal(own.reason, "floor");
  const share = plan(mine(30), troll, me, { floor: null, minShare: 0.6, reference: 25 });
  assert.equal(share.target, 15);
});

test("keeps the price when nobody is in game", () => {
  const p = plan(mine(30), [sell(10, "online")], me, { floor: null, minShare: 0, reference: null });
  assert.equal(p.change, false);
  assert.equal(p.reason, "no-sellers");
});

test("does nothing when already matched", () => {
  const p = plan(mine(20), book, me, { floor: null, minShare: 0, reference: null });
  assert.equal(p.change, false);
  assert.equal(p.reason, "already");
});

test("a sale typed by hand takes the item's own spelling; an unknown name stays as typed", () => {
  const names = ["Arcane Energize", "Serration"];
  assert.equal(knownName(names, "  serration "), "Serration");
  assert.equal(knownName(names, "Blah thing"), null);
  assert.equal(knownName(names, ""), null);
});

test("a sale is matched to its trade by the trade's key; one logged by hand, to the nearest unclaimed trade", () => {
  const H = 3_600_000;
  const t0 = 1_800_000_000_000;
  const trade = (key: string, at: number, name: string): TradeLogEntry => ({ key, at, partner: "P", offered: [{ name, rank: null, count: 1 }], received: [], platOut: 0, platIn: 70 });
  const sale = (at: number, item: string, extra: Partial<Sale> = {}): Sale => ({ at, item, rank: null, quantity: 1, platinum: 70, ...extra });
  const covered = (sales: Sale[], trades: TradeLogEntry[]) => sales.map((s) => salesCoveredByTrades(sales, trades).has(s));
  // Matched by key however late it was logged; a key no sale trade has (a swap, trimmed) counts on its own.
  const trades = [trade("s|1", t0 - 3 * H, "Mesa Prime Set"), trade("s|2", t0, "Serration")];
  assert.deepEqual(covered([sale(t0 - 2 * H, "Mesa Prime Set", { trade: "s|1" }), sale(t0, "Serration", { trade: "s|9" })], trades), [true, false]);
  // By hand, an hour after an unclaimed trade of the same item: that trade's sale (the Mesa Prime Set above).
  assert.deepEqual(covered([sale(t0 - 2 * H, "Mesa Prime Set")], trades), [true]);
  // Names differ a little between the log and the market.
  assert.deepEqual(covered([sale(t0 + 5 * 60_000, "serration blueprint")], trades), [true]);
  // A trade another sale already is: a second sale of its own.
  assert.deepEqual(covered([sale(t0, "Serration", { trade: "s|2" }), sale(t0 + 5 * 60_000, "Serration")], trades), [true, false]);
  // One trade, two hand-logged sales: the nearer one is the trade's, the other is its own sale.
  assert.deepEqual(covered([sale(t0 + 2 * H, "Serration"), sale(t0 + 10 * 60_000, "Serration")], trades), [false, true]);
  // More than a day apart: not the same sale.
  assert.deepEqual(covered([sale(t0 + 30 * H, "Serration")], trades), [false]);
});

test("everyone in game asking more than twice what it sells for: priced at what it sells for", () => {
  // A relic that goes for 4p, with only 30p sellers in game.
  const p = plan(mine(4), [sell(30, "ingame")], me, { floor: null, minShare: 0.5, reference: 4 });
  assert.deepEqual([p.target, p.change, p.reason], [4, false, "already"]);
  const fromHigh = plan(mine(30), [sell(30, "ingame")], me, { floor: null, minShare: 0.5, reference: 4 });
  assert.deepEqual([fromHigh.target, fromHigh.reason], [4, "median"]);
  // Up to twice: still matched.
  assert.equal(plan(mine(4), [sell(8, "ingame")], me, { floor: null, minShare: 0.5, reference: 4 }).target, 8);
  // Your floor still wins.
  assert.equal(plan(mine(4), [sell(30, "ingame")], me, { floor: 10, minShare: 0.5, reference: 4 }).target, 10);
});
