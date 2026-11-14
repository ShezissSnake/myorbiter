// One sale in game is one sale in the log, and lowers its listing once: the set fold and Import,
// a hand-logged sale and the trade it stands for (at the trade marking and on Stats), and a Sold
// click soon after a trade's own mark.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSetSales, loggedForTrade, placeTradeLine, salesFromTrade, setPartsOf, tradeKey } from "../src/lib/core/trades";
import { importClosed, type ClosedOrder } from "../src/lib/core/closedOrders";
import { handLoggedSale } from "../src/lib/core/upkeep";
import { buildModel } from "../src/lib/core/model";
import { indexItems, salesCoveredByTrades, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { copiesToSend, soldAfterTrade } from "../src/lib/core/soldMarks";
import { salesOf } from "../src/lib/core/saleLog";
import type { Sale, TradeLogEntry } from "../src/lib/backend";
import type { Trade } from "../src/lib/core/types";

const comp = (n: string, unique = `/Lotus/Types/Recipes/WarframeRecipes/NekrosPrime${n}Blueprint`) => ({ uniqueName: unique, name: n, ducats: 45, itemCount: 1 });
const m = buildModel({
  observed_at: 1, inventory: [], relics: [], prices: { prices: {}, max_rank_prices: {} },
  catalog: [{ uniqueName: "/Lotus/Powersuits/Nekros/NekrosPrime", name: "Nekros Prime", category: "Warframes", masterable: true, isPrime: true, components: [comp("Blueprint", "/Lotus/Types/Recipes/WarframeRecipes/NekrosPrimeBlueprint"), comp("Chassis"), comp("Systems")] }],
} as unknown as Parameters<typeof buildModel>[0]);
const names = ["Nekros Prime Blueprint", "Nekros Prime Chassis Blueprint", "Nekros Prime Systems Blueprint"];
const items: MarketItem[] = [
  { id: "nek", slug: "nekros_prime_set", gameRef: "/S/Set", name: "Nekros Prime Set", maxRank: null, subtypes: null, tags: ["set"] },
  ...names.map((name, i) => ({ id: `p${i}`, slug: `p${i}`, gameRef: null, name, maxRank: null, subtypes: null, tags: ["prime"] })),
];
const at = 1_792_512_340_000;
const closedParts: ClosedOrder[] = names.map((name, i) => ({ id: `c${i}`, kind: "sell", slug: `p${i}`, name, rank: null, quantity: 1, platinum: 16, closedAt: new Date(at + 2_000).toISOString() }));
const setTrade: TradeLogEntry = { key: "7|1", at, partner: "Buyer1", offered: names.map((name) => ({ name, rank: null, count: 1 })), received: [], platOut: 0, platIn: 48 };

/** Stats' revenue as Stats.svelte adds it: every sale trade's platinum, plus the copies no trade covers. */
function revenue(sales: Sale[], trades: TradeLogEntry[]) {
  const covered = salesCoveredByTrades(sales, trades);
  return trades.reduce((n, t) => n + t.platIn, 0) + sales.reduce((n, s) => n + (s.quantity - (covered.get(s) ?? 0)) * s.platinum, 0);
}
/** Import, then the fold (as the app runs it on each model change); or the fold, then Import. */
const importThenFold = (sales: Sale[]) => {
  const imported = importClosed(sales, closedParts, setPartsOf(m)).sales;
  return foldSetSales(imported, [setTrade], m) ?? imported;
};
const foldThenImport = (sales: Sale[]) => importClosed(foldSetSales(sales, [setTrade], m) ?? sales, closedParts, setPartsOf(m)).sales;

test("parts listed one by one and sold in one trade: logged as parts, never folded, and Import adds none", () => {
  const orders: MyOrder[] = names.map((_, i) => ({ id: `o${i}`, itemId: `p${i}`, type: "sell", platinum: 16, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null }));
  const t: Trade = { uptime: 1, at: at / 1000, partner: "Buyer1", offered: setTrade.offered, received: [], platinum_offered: 0, platinum_received: 48 };
  assert.equal(tradeKey(7, t), setTrade.key);
  const sales: Sale[] = salesFromTrade(t, orders, indexItems(items), m)!.map((s) => ({ at, item: s.name, rank: null, quantity: s.count, platinum: s.platinumEach, trade: setTrade.key }));
  assert.deepEqual(sales.map((s) => s.item), names, "the trade logs the three parts it closed");
  assert.equal(foldSetSales(sales, [setTrade], m), null, "the trade's own part sales stay parts");
  const r = importClosed(sales, closedParts, setPartsOf(m));
  assert.deepEqual([r.added, r.matched], [0, 3]);
  // Whichever comes first, the same log and the same revenue: the trade's 48p, once.
  assert.deepEqual(revenue(foldThenImport(sales), [setTrade]), 48);
  assert.deepEqual(revenue(importThenFold(sales), [setTrade]), 48);
  assert.deepEqual(importClosed(importThenFold(sales), closedParts, setPartsOf(m)).added, 0, "importing again adds nothing");
});

test("parts logged before sales carried their trade: folded into the set either way, Import adds none", () => {
  const sales: Sale[] = names.map((item, i) => ({ at, item, rank: null, quantity: 1, platinum: [16, 16, 16][i] }));
  // The fold first: the set sale takes the parts' closed orders.
  const folded = foldSetSales(sales, [setTrade], m)!;
  assert.deepEqual(folded.map((s) => [s.item, s.trade]), [["Nekros Prime Set", "7|1"]], "the set sale is the trade's");
  const after = importClosed(folded, closedParts, setPartsOf(m));
  assert.deepEqual([after.added, after.matched], [0, 3]);
  assert.deepEqual(after.sales[0].wfmParts, ["c0", "c1", "c2"]);
  assert.deepEqual([importClosed(after.sales, closedParts, setPartsOf(m)).added, importClosed(after.sales, closedParts, setPartsOf(m)).matched], [0, 0], "again: nothing");
  // Import first: the fold keeps the parts' closed orders, so importing again adds nothing.
  const both = importThenFold(sales);
  assert.deepEqual(both.map((s) => [s.item, s.wfmParts]), [["Nekros Prime Set", ["c0", "c1", "c2"]]]);
  assert.equal(importClosed(both, closedParts, setPartsOf(m)).added, 0);
  // And Stats counts the trade once, whichever came first.
  assert.equal(revenue(after.sales, [setTrade]), 48);
  assert.equal(revenue(both, [setTrade]), 48);
});

test("a set sale takes only its own parts' closed orders, and a part sale logged on its own keeps its order", () => {
  const sales: Sale[] = [{ at, item: "Nekros Prime Set", rank: null, quantity: 1, platinum: 48, trade: "7|1" }, { at: at + 60_000, item: "Nekros Prime Blueprint", rank: null, quantity: 1, platinum: 20 }];
  const extra: ClosedOrder = { ...closedParts[0], id: "c9", closedAt: new Date(at + 60_000).toISOString() };
  const r = importClosed(sales, [...closedParts, extra], setPartsOf(m));
  // One blueprint order goes to the blueprint's own sale, the other (and the two other parts) to the set.
  assert.deepEqual([r.added, r.matched], [0, 4]);
  // A third blueprint: the set has room for one only.
  const r2 = importClosed(sales, [...closedParts, extra, { ...extra, id: "c10" }], setPartsOf(m));
  assert.equal(r2.added, 1);
  // Without the model's sets (an older call): as before, the parts are added.
  assert.equal(importClosed([sales[0]], closedParts).added, 3);
});

test("a set sale's parts imported over two runs: each part's order is matched once, none added", () => {
  const sales: Sale[] = [{ at, item: "Nekros Prime Set", rank: null, quantity: 1, platinum: 48, trade: "7|1" }];
  // The Systems order closed first; the Blueprint's shows up at the next import.
  const first = importClosed(sales, [closedParts[2]], setPartsOf(m));
  assert.deepEqual([first.added, first.matched], [0, 1]);
  const second = importClosed(first.sales, [closedParts[2], closedParts[0]], setPartsOf(m));
  assert.deepEqual([second.added, second.matched, second.sales[0].wfmParts], [0, 1, ["c2", "c0"]]);
  // A second Systems order: the set has only one, so it's a sale of its own.
  assert.equal(importClosed(second.sales, [closedParts[2], closedParts[0], { ...closedParts[2], id: "c7" }], setPartsOf(m)).added, 1);
});

test("a set sale's room: an order no longer listed still takes a part's room, and an order's copies count", () => {
  // All three parts matched before, one of their orders gone from the profile since: the set is full.
  const full: Sale[] = [{ at, item: "Nekros Prime Set", rank: null, quantity: 1, platinum: 48, trade: "7|1", wfmParts: ["gone", "c1", "c2"] }];
  assert.equal(importClosed(full, [closedParts[1], closedParts[2], closedParts[0]], setPartsOf(m)).added, 1, "a fourth part order is a sale of its own");
  // Two sets in one trade; one order closed both Blueprints, so a third Blueprint isn't the set's.
  const two: Sale[] = [{ at, item: "Nekros Prime Set", rank: null, quantity: 2, platinum: 48, trade: "7|1", wfmParts: ["c0"] }];
  const both = { ...closedParts[0], quantity: 2 };
  assert.deepEqual(importClosed(two, [both, { ...closedParts[0], id: "c9" }], setPartsOf(m)).added, 1);
  // The same in one import: the order of 2 fills the Blueprints' room, the one after it is added.
  const fresh: Sale[] = [{ at, item: "Nekros Prime Set", rank: null, quantity: 2, platinum: 48, trade: "7|1" }];
  assert.equal(importClosed(fresh, [both, { ...closedParts[0], id: "c9" }], setPartsOf(m)).added, 1);
});

test("a hand-logged sale of another rank is not the trade's sale", () => {
  // Sold ×1 of a maxed arcane on Orders, then three unranked copies traded in game.
  const hand: Sale[] = [{ at: 0, item: "Arcane Energize", rank: 5, quantity: 1, platinum: 60 }];
  assert.equal(handLoggedSale(hand, { name: "Arcane Energize", rank: null, count: 3 }, 300_000), null);
  const r = placeTradeLine(hand, [], { name: "Arcane Energize", rank: null, count: 3 }, 300_000, "s|1");
  assert.deepEqual([r.left, r.sales[0].trade], [3, undefined], "all 3 are logged and marked sold");
});

test("a Sold click and its own trade are one sale: an unranked arcane, a mod at rank 0, a prime part", () => {
  // The Sold click writes the listing's rank (0); the log gives an unranked arcane none, a mod its rank.
  for (const [rank, line] of [[0, null], [0, 0], [null, null]] as const) {
    const sold: Sale[] = [{ at: 0, item: "Arcane Energize", rank, quantity: 1, platinum: 10 }];
    const r = placeTradeLine(sold, [], { name: "Arcane Energize", rank: line, count: 1 }, 60_000, "s|1");
    assert.deepEqual([r.left, r.sales[0].trade], [0, "s|1"], `rank ${rank} against ${line}`);
  }
});

test("differing quantities: only the copies not yet logged are logged and marked sold", () => {
  const line = { name: "Serration", rank: 10, count: 3 };
  // Sold 1 on Orders, then a trade of 3: the hand sale is the trade's, 2 more are logged and marked.
  const one: Sale[] = [{ at: 0, item: "Serration", rank: 10, quantity: 1, platinum: 20 }];
  const a = placeTradeLine(one, [], line, 60_000, "s|1");
  assert.deepEqual([a.left, a.sales.map((s) => [s.quantity, s.trade])], [2, [[1, "s|1"]]]);
  // Logged 5 by hand, then a trade of 3: the 3 are the trade's, 2 stay a sale of their own; nothing to mark.
  const five: Sale[] = [{ at: 0, item: "Serration", rank: 10, quantity: 5, platinum: 20, wfm: "w1" }];
  const b = placeTradeLine(five, [], line, 60_000, "s|1");
  assert.deepEqual([b.left, b.sales.map((s) => [s.quantity, s.trade ?? null, s.wfm ?? null])], [0, [[3, "s|1", "w1"], [2, null, null]]]);
  // The trade handled again (after the split, or after logging the rest): nothing more.
  const logged = [{ ...a.sales[0] }, { at: 60_000, item: "Serration", rank: 10, quantity: 2, platinum: 20, trade: "s|1" }];
  assert.equal(placeTradeLine(logged, loggedForTrade(logged, "s|1"), line, 60_000, "s|1").left, 0);
  assert.equal(placeTradeLine(b.sales, loggedForTrade(b.sales, "s|1"), line, 60_000, "s|1").left, 0);
});

test("two Sold clicks of one each, then the trade of 2: both are the trade's, nothing marked or logged again", () => {
  const sold: Sale[] = [{ at, item: "Serration", rank: 10, quantity: 1, platinum: 20 }, { at: at + 10_000, item: "Serration", rank: 10, quantity: 1, platinum: 20 }];
  const r = placeTradeLine(sold, [], { name: "Serration", rank: 10, count: 2 }, at + 60_000, "s|1");
  assert.deepEqual([r.left, r.sales.map((s) => [s.quantity, s.trade])], [0, [[1, "s|1"], [1, "s|1"]]]);
  const trade: TradeLogEntry = { key: "s|1", at: at + 60_000, partner: "Buyer1", offered: [{ name: "Serration", rank: 10, count: 2 }], received: [], platOut: 0, platIn: 40 };
  assert.equal(revenue(r.sales, [trade]), 40, "the trade's 40p, once");
  assert.equal(revenue(sold, [trade]), 40, "and the same with marking off");
});

{
  const line = (count: number) => ({ name: "Serration", rank: 10, count });
  const trade = (key: string, t: number, count: number): TradeLogEntry => ({ key, at: t, partner: "Buyer1", offered: [line(count)], received: [], platOut: 0, platIn: 20 * count });
  // [hand-logged copies and time, the trades (key, time, copies)], and the platinum they made.
  const cases: [string, Sale, TradeLogEntry[], number][] = [
    // "Sold several: 2", then two trades of 1 (one before it, one after).
    ["Sold several: 2, then two trades of 1", { at: at + 5 * 60_000, item: "Serration", rank: 10, quantity: 2, platinum: 20 }, [trade("s|1", at, 1), trade("s|2", at + 10 * 60_000, 1)], 40],
    // A sale of 3 by hand, then trades of 2 and 1.
    ["3 logged by hand, then trades of 2 and 1", { at, item: "Serration", rank: 10, quantity: 3, platinum: 20 }, [trade("s|1", at + 60_000, 2), trade("s|2", at + 2 * 60_000, 1)], 60],
  ];
  for (const [name, hand, trades, platinum] of cases) test(`one hand-logged sale across two trades (${name}): the marking and Stats agree, marking on or off`, () => {
    // Marking off: nothing claimed the sale; Stats pairs it itself.
    assert.equal(revenue([hand], trades), platinum, `marking off, ${hand.quantity} by hand`);
    // Marking on: each trade claims its copies, nothing is left to mark.
    let sales: Sale[] = [hand];
    for (const t of trades) {
      const r = placeTradeLine(sales, loggedForTrade(sales, t.key), t.offered[0], t.at, t.key);
      assert.equal(r.left, 0, `${t.key} marks nothing`);
      sales = r.sales;
    }
    assert.equal(revenue(sales, trades), platinum, `marking on, ${hand.quantity} by hand`);
    assert.equal(sales.reduce((n, s) => n + s.quantity, 0), hand.quantity, "no copy logged twice");
  });
}

test("a hand-logged sale all of whose copies a trade covers takes nothing from a second trade beside it", () => {
  const hand: Sale = { at, item: "Serration", rank: 10, quantity: 2, platinum: 20 };
  const trades: TradeLogEntry[] = ["s|1", "s|2"].map((key, i) => ({ key, at: at + (i + 1) * 60_000, partner: "Buyer1", offered: [{ name: "Serration", rank: 10, count: 2 }], received: [], platOut: 0, platIn: 40 }));
  // Marking off: the first trade covers both copies; the second trade is a sale of its own.
  assert.equal(revenue([hand], trades), 80);
  // Marking on: the first trade claims the sale, the second logs and marks its own 2.
  let sales: Sale[] = [hand];
  const left: number[] = [];
  for (const t of trades) {
    const r = placeTradeLine(sales, loggedForTrade(sales, t.key), t.offered[0], t.at, t.key);
    left.push(r.left);
    sales = r.left ? [{ at: t.at, item: "Serration", rank: 10, quantity: r.left, platinum: 20, trade: t.key }, ...r.sales] : r.sales;
  }
  assert.deepEqual(left, [0, 2]);
  assert.equal(revenue(sales, trades), 80);
});

test("Stats pairs a hand-logged sale with a trade by the same rule: rank and copies", () => {
  // Marking off, so nothing claimed the hand-logged sale: Stats pairs it itself.
  const t = (offered: TradeLogEntry["offered"], platIn: number): TradeLogEntry => ({ key: "s|1", at: at + 5 * 60_000, partner: "Buyer1", offered, received: [], platOut: 0, platIn });
  // A maxed arcane sold by hand, then 3 unranked in a trade: two sales, 60p + 90p.
  assert.equal(revenue([{ at, item: "Arcane Energize", rank: 5, quantity: 1, platinum: 60 }], [t([{ name: "Arcane Energize", rank: null, count: 3 }], 90)]), 150);
  // 3 logged by hand, a trade of 1: the trade is one of the three; the other two count on their own.
  assert.equal(revenue([{ at, item: "Serration", rank: 0, quantity: 3, platinum: 30 }], [t([{ name: "Serration", rank: 0, count: 1 }], 30)]), 90);
  // 1 logged by hand, a trade of 3: the hand-logged sale is one of the trade's copies.
  assert.equal(revenue([{ at, item: "Serration", rank: 0, quantity: 1, platinum: 30 }], [t([{ name: "Serration", rank: 0, count: 3 }], 90)]), 90);
  // An unranked arcane by hand (rank 0) and in the log (no rank): the same.
  assert.equal(revenue([{ at, item: "Arcane Energize", rank: 0, quantity: 1, platinum: 10 }], [t([{ name: "Arcane Energize", rank: null, count: 1 }], 10)]), 10);
  // Two items in one trade, each logged by hand: both covered.
  assert.equal(revenue([{ at, item: "Serration", rank: 0, quantity: 1, platinum: 30 }, { at, item: "Arcane Energize", rank: 0, quantity: 1, platinum: 10 }], [t([{ name: "Serration", rank: 0, count: 1 }, { name: "Arcane Energize", rank: null, count: 1 }], 40)]), 40);
});

test("a Sold click soon after a trade marked that listing asks first; later, or on another listing, it doesn't", () => {
  const now = at + 2 * 60_000;
  const trades: TradeLogEntry[] = [{ key: "s|1", at, partner: "Buyer1", offered: [{ name: "Serration", rank: 10, count: 1 }], received: [], platOut: 0, platIn: 20 }];
  const sales: Sale[] = [{ at, item: "Serration", rank: 10, quantity: 1, platinum: 20, trade: "s|1", lowered: { listing: "o1", count: 1, at: at + 5_000 } }];
  // 3 listed, the trade lowered it to 2; Sold pressed for the same copy: without the question, 1 is sent again.
  assert.equal(copiesToSend(1, 2, 2), 1);
  assert.deepEqual(soldAfterTrade("o1", sales, trades, now), { count: 1, partner: "Buyer1" });
  assert.equal(soldAfterTrade("o2", sales, trades, now), null);
  assert.equal(soldAfterTrade("o1", sales, trades, at + 11 * 60_000), null, "ten minutes on: no question");
  // A trade that lowered it while Undo showed: those copies are taken off what the click sends.
  assert.equal(copiesToSend(1, 3, 2), 0);
  assert.equal(copiesToSend(2, 3, 2), 1);
});

test("saved sales: an older record without the new fields loads as it was; damaged new fields are dropped", () => {
  const old = { at, item: "Serration", rank: 10, quantity: 1, platinum: 20, trade: "s|1", wfm: "w1" };
  assert.deepEqual(salesOf([old]), [old]);
  const fresh = { at, item: "Nekros Prime Set", rank: null, quantity: 1, platinum: 48, wfmParts: ["c0", "c1"], lowered: { listing: "o1", count: 1, at } };
  assert.deepEqual(salesOf([fresh]), [fresh]);
  const bad = salesOf([{ ...fresh, wfmParts: "c0", lowered: { listing: 5, count: 0, at: "x" } }]);
  assert.deepEqual(bad, [{ at, item: "Nekros Prime Set", rank: null, quantity: 1, platinum: 48 }]);
});
