import { test } from "node:test";
import assert from "node:assert/strict";
import { competitor, knownName, marketValue, plan, salesCoveredByTrades, type BookOrder, type MyOrder } from "../src/lib/core/market";
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

// The example in docs/features.md (Orders): the order should land on 20p.
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

test("a relic's value: no more than what sellers on the site ask (the middle ask, in game or not)", () => {
  // Axi Y2 intact as it was: three sales at 25–100p lift the recent price to 75p, while four
  // sellers in game ask 8p and dozens offline ask 2p.
  const b = [sell(2, "offline"), sell(2, "offline"), sell(8, "ingame"), sell(8, "ingame"), sell(9, "online"), sell(10, "ingame"), sell(500, "ingame", { user: { id: "me" } })];
  const comp = competitor(mine(38), b, me);
  assert.equal(comp.askLevel, 8, "the middle ask of everyone but you");
  assert.equal(marketValue(75, comp), 8);
  assert.equal(marketValue(5, comp), 5, "recent sales lower than the asks stand");
  assert.equal(marketValue(null, comp), 8);
  assert.equal(marketValue(7, { askLevel: null }), 7);
  // One or two odd listings don't set it: with only two sellers, the dearer one does.
  assert.equal(competitor(mine(1), [sell(1, "ingame"), sell(30, "online")], me).askLevel, 30);
  assert.equal(competitor(mine(1), [sell(3, "offline", { user: { id: "me" } })], me).askLevel, null);
  // A few forgotten listings at 2p don't set it either: 12–14p in game, three offline at 2p.
  const forgotten = [sell(2, "offline"), sell(2, "offline"), sell(2, "offline"), sell(12, "ingame"), sell(13, "ingame"), sell(14, "ingame")];
  assert.equal(competitor(mine(14), forgotten, me).askLevel, 12);
  assert.equal(plan(mine(14), forgotten, me, { floor: null, minShare: 0.5, reference: 15, capByAsks: true }).target, 12);
  // Repricing a relic: held at half of 8p (4p), matching the 8p in game, not the 38p half of 75p.
  const capped = plan(mine(38), b, me, { floor: null, minShare: 0.5, reference: 75, capByAsks: true });
  assert.deepEqual([capped.target, capped.floor, capped.value], [8, 4, 8]);
  assert.equal(plan(mine(38), b, me, { floor: null, minShare: 0.5, reference: 75 }).target, 38, "anything else keeps its reference");
});

test("a relic everyone in game asks far too much for goes at what sellers on the site ask", () => {
  // Axi V14 intact: in game 30p and 120p, dozens offline at 3p; it sold for 3.1p.
  const b = [sell(30, "ingame"), sell(120, "ingame"), sell(3, "offline"), sell(3, "offline"), sell(3, "offline"), sell(3, "offline")];
  const p = plan(mine(30), b, me, { floor: null, minShare: 0.5, reference: 3.1, capByAsks: true });
  assert.deepEqual([p.target, p.reason, p.value], [3, "median", 3]);
});

test("arcanes: copies you could fuse count as held at max rank, so a listing for them isn't 'more than you hold'", async () => {
  const { holdings } = await import("../src/lib/core/market");
  const model = {
    inventoryByBase: new Map([["/A/Energize", [{ item_id: "/A/Energize", name: "Arcane Energize", category: "arcane", quantity: 1, rank: 5 }, { item_id: "/A/Energize", name: "Arcane Energize", category: "arcane", quantity: 22, rank: 0 }]]]),
    inventoryByName: new Map(),
    partByName: new Map(),
  } as never;
  const item = { id: "e", slug: "arcane_energize", gameRef: "/A/Energize", name: "Arcane Energize", maxRank: 5, subtypes: null, tags: ["legendary", "arcane_enhancement"] };
  const h = holdings(model, item as never)!;
  assert.equal(h.find((x) => x.rank === 5)?.count, 2, "one maxed and one more from 22 unranked");
  assert.equal(h.find((x) => x.rank === 0)?.count, 22);
});

test("with no inventory read at all (a console player), what you hold is unknown, not none", async () => {
  const { holdings, heldFor } = await import("../src/lib/core/market");
  const empty = { observedAt: null, inventoryByBase: new Map(), inventoryByName: new Map(), partByName: new Map() } as never;
  const item = { id: "e", slug: "arcane_energize", gameRef: "/A/Energize", name: "Arcane Energize", maxRank: 5, subtypes: null, tags: ["arcane_enhancement"] };
  assert.equal(holdings(empty, item as never), null);
  assert.equal(heldFor(empty, item as never, { rank: 0, subtype: null }), null);
});

test("trade chat lines from your listings: dearest first, ranks shown, split to the chat's length", async () => {
  const { wtsLines } = await import("../src/lib/core/market");
  assert.deepEqual(wtsLines([{ name: "Serration", rank: 0, platinum: 9 }, { name: "Arcane Reaper", rank: 0, platinum: 30 }, { name: "Gauss Prime Neuroptics Blueprint", rank: null, platinum: 14 }]), ["WTS [Arcane Reaper] R0 30p [Gauss Prime Neuroptics Blueprint] 14p [Serration] R0 9p"]);
  const many = wtsLines(Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}`, rank: null, platinum: 100 - i })), 60);
  assert.ok(many.length > 1 && many.every((l) => l.length <= 60 && l.startsWith("WTS [")));
  assert.deepEqual(wtsLines([]), []);
});

test("a ranked item's reference price is its unranked or maxed price only, never the unranked one for another rank", async () => {
  const { referencePrice } = await import("../src/lib/core/market");
  const { buildModel } = await import("../src/lib/core/model");
  const m = buildModel({ observed_at: 1, inventory: [], catalog: [], relics: [], prices: { prices: { "Cutting Edge": 4, "Lone Mod": 3 }, max_rank_prices: { "Cutting Edge": 60 } } } as never);
  const ce = { id: "ce", slug: "cutting_edge", gameRef: null, name: "Cutting Edge", maxRank: 10, subtypes: null, tags: ["mod"] };
  assert.equal(referencePrice(m, ce, 0), 4);
  assert.equal(referencePrice(m, ce, null), 4);
  assert.equal(referencePrice(m, ce, 10), 60);
  // Rank 9: no daily price for it, so no reference (the 4p one would drag a 60p listing down).
  assert.equal(referencePrice(m, ce, 9), null);
  // Maxed with no maxed price: none either.
  assert.equal(referencePrice(m, { ...ce, name: "Lone Mod" }, 10), null);
});

test("one seller far under everyone else isn't followed down; a buyer still sees them", () => {
  const b = [sell(2, "ingame"), sell(58, "ingame"), sell(60, "ingame")];
  const c = competitor(mine(60), b, me);
  assert.equal(c.price, 58);
  assert.equal(c.lowest?.platinum, 2);
  assert.equal(plan(mine(60), b, me, { floor: null, minShare: 0.5, reference: null }).target, 58);
  // Close together, or only a few platinum apart: the market, followed.
  assert.equal(competitor(mine(60), [sell(20, "ingame"), sell(25, "ingame")], me).price, 20);
  assert.equal(competitor(mine(9), [sell(1, "ingame"), sell(4, "ingame")], me).price, 1);
  // Alone: nothing to tell it by.
  assert.equal(competitor(mine(60), [sell(2, "ingame")], me).price, 2);
});

test("a variant other than the first has no daily price, and what you hold of it is unknown", async () => {
  const { referencePrice, heldFor } = await import("../src/lib/core/market");
  const ser = { id: "se", slug: "serration", gameRef: "/M/Serration", name: "Serration", maxRank: 10, subtypes: ["regular", "atragraph"], tags: ["mod"] };
  const m = { price: () => 5, priceMax: () => 40, observedAt: new Date(), inventoryByBase: new Map([["/M/Serration", [{ quantity: 1, rank: 10 }]]]), inventoryByName: new Map(), partByName: new Map(), catalogByUnique: new Map(), catalogNames: new Set() } as never;
  assert.equal(referencePrice(m, ser, 10, "regular"), 40);
  assert.equal(referencePrice(m, ser, 10, "atragraph"), null);
  assert.equal(heldFor(m, ser, { rank: 10, subtype: null }), 1);
  assert.equal(heldFor(m, ser, { rank: 10, subtype: "atragraph" }), null);
  // Ayatan sculptures: a full one is its own listing, and not counted from your inventory.
  assert.equal(competitor({ rank: null, subtype: null, amberStars: 2, cyanStars: 1 }, [{ ...sell(30, "ingame"), amberStars: 0, cyanStars: 0 }, { ...sell(70, "ingame"), amberStars: 2, cyanStars: 1 }], me).price, 70);
  assert.equal(heldFor(m, ser, { rank: 10, subtype: null, amberStars: 1 }), null);
});

test("an odd cheap seller is skipped only when the next two agree, and never raises a price", () => {
  // 4p against 15p and 16p: skipped, but a 5p listing isn't raised to 15p because of it.
  const b = [sell(4, "ingame"), sell(15, "ingame"), sell(16, "ingame")];
  assert.equal(competitor(mine(5), b, me).price, 15);
  const p = plan(mine(5), b, me, { floor: null, minShare: 0.5, reference: null });
  assert.equal(p.target, 5);
  assert.equal(p.change, false);
  // Only two others, or the next two far apart: nothing to call odd.
  assert.equal(competitor(mine(60), [sell(2, "ingame"), sell(58, "ingame")], me).price, 2);
  assert.equal(competitor(mine(60), [sell(2, "ingame"), sell(20, "ingame"), sell(60, "ingame")], me).price, 2);
});
