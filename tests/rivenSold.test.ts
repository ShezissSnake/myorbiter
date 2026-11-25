// A riven sold in a trade in game: which auction is closed by MyOrbiter itself, and which cases are
// only told (core/rivenSold.ts, rivenStore's closeIfStill). Made-up trades and auctions; nothing
// here signs in to or writes to warframe.market (the store's requests are replaced).
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market } from "../src/lib/backend";
import { auctionFits, heldLike, keepRivenSold, rivenDecided, rivenSoldOf, rivenSoldShown, rivenVerdict, setRivenSold, stillToClose, type HeldRivens, type RivenSaleFacts, type RivenSold } from "../src/lib/core/rivenSold";
import { parseMyAuctions, type MyAuction, type RivenMeta } from "../src/lib/core/rivens";
import { markTrades, salesFromTrade, type TradeMarking } from "../src/lib/core/trades";
import { indexItems, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { recentTrade, saleNotice } from "../src/lib/core/saleNotice";
import type { Trade, TradeItem } from "../src/lib/core/types";
import type { Sale } from "../src/lib/backend";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { rivens } = await import("../src/lib/rivenStore.svelte");
const real = { ...market };
beforeEach(() => {
  Object.assign(market, real);
  rivens.mine = [];
  rivens.mineAt = null;
  rivens.mineError = null;
});

const meta: RivenMeta = {
  weapons: [
    { slug: "braton", gameRef: "/W/Braton", name: "Braton", group: "primary", rivenType: "rifle" },
    { slug: "kuva_bramma", gameRef: "/W/KuvaBramma", name: "Kuva Bramma", group: "primary", rivenType: "rifle" },
  ],
  attributes: [],
};
const AT = 1_791_918_527 + 3127;
const auction = (id: string, over: Partial<MyAuction> = {}): MyAuction => ({
  id, weapon: "braton", name: "crita-hexacan", starting: 100, buyout: 100, topBid: null, closed: false, visible: true, private: false, note: "", minRep: 0, updated: "",
  attributes: [], rerolls: 0, mr: 8, rank: 0, polarity: "madurai", ...over,
});
const riven = (over: Partial<TradeItem> = {}): TradeItem => ({ name: "Braton Crita-hexacan", rank: 0, count: 1, riven: true, ...over });
const trade = (t: Partial<Trade> = {}): Trade => ({ uptime: 3127.384, at: AT, partner: "Buyer1", offered: [riven()], received: [], platinum_offered: 0, platinum_received: 120, ...t });
const readBefore: HeldRivens = { rivens: [{ weapon: "braton", name: "Crita-hexacan" }], at: AT * 1000 - 60_000 };
/** Every condition for a close holding: the case the others change one thing of. */
const facts = (over: Partial<RivenSaleFacts> = {}): RivenSaleFacts => {
  const t = over.trade ?? trade();
  return { trade: t, item: t.offered.find((x) => x.riven) ?? t.offered[0], autoTrades: true, linked: true, recent: true, auctions: [auction("a1")], meta, held: readBefore, ...over };
};
const why = (f: RivenSaleFacts) => {
  const v = rivenVerdict(f);
  assert.equal(v.do, "tell", JSON.stringify(v));
  return v.do === "tell" ? v.why : "";
};

test("case 1: the one open auction that fits the riven sold for platinum is closed, when every condition holds", () => {
  const v = rivenVerdict(facts());
  assert.equal(v.do, "close");
  assert.equal(v.do === "close" && v.auction.id, "a1");
  // Read before the trade with no riven of that name, or the riven as the read held it: the same.
  assert.equal(rivenVerdict(facts({ held: { rivens: [], at: null } })).do, "close");
  // Other rivens held, other weapons or names, don't count.
  assert.equal(rivenVerdict(facts({ held: { rivens: [{ weapon: "braton", name: "Visi-critatis" }, { weapon: "kuva_bramma", name: "Crita-hexacan" }], at: null } })).do, "close");
  // A ranked riven, a weapon of two words: the logged name is the market's weapon name and the riven's.
  const kb = trade({ offered: [riven({ name: "Kuva Bramma Visi-satitron", rank: 8 })] });
  const v2 = rivenVerdict(facts({ trade: kb, auctions: [auction("k", { weapon: "kuva_bramma", name: "visi-satitron", rank: 8 }), auction("a1")] }));
  assert.equal(v2.do === "close" && v2.auction.id, "k");
  // Items given beside the riven don't stop it: the other side is still platinum only.
  const withItems = trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }, riven()] });
  assert.equal(rivenVerdict(facts({ trade: withItems })).do, "close");
});

test("case 2: the switch off, a swap or a gift: told, nothing written", () => {
  assert.match(why(facts({ autoTrades: false })), /Mark sales sold from the game is off/);
  // A swap: something came back besides platinum (a riven for a riven too).
  assert.match(why(facts({ trade: trade({ received: [{ name: "Forma Blueprint", rank: null, count: 1 }] }) })), /wasn't a sale/);
  assert.match(why(facts({ trade: trade({ received: [riven({ name: "Braton Visi-critatis" })] }) })), /wasn't a sale/);
  // A gift: nothing back; and platinum given with it.
  assert.match(why(facts({ trade: trade({ platinum_received: 0 }) })), /wasn't a sale/);
  assert.match(why(facts({ trade: trade({ platinum_offered: 5 }) })), /wasn't a sale/);
});

test("case 2: more than one open auction or more than one held riven fits, or the rank differs: told", () => {
  assert.match(why(facts({ auctions: [auction("a1"), auction("a2", { rerolls: 3 })] })), /more than one of your auctions/);
  const v = rivenVerdict(facts({ auctions: [auction("a1"), auction("a2")] }));
  assert.deepEqual(v.do === "tell" && v.auctions.map((a) => a.id), ["a1", "a2"]);
  assert.match(why(facts({ held: { rivens: [{ weapon: "braton", name: "Crita-hexacan" }, { weapon: "braton", name: "crita-hexacan" }], at: AT * 1000 - 60_000 } })), /more than one riven/);
  // A riven the read couldn't name may be it.
  assert.match(why(facts({ held: { rivens: [{ weapon: "braton", name: "Crita-hexacan" }, { weapon: null, name: null }], at: AT * 1000 - 60_000 } })), /more than one riven/);
  assert.match(why(facts({ auctions: [auction("a1", { rank: 8 })] })), /rank in the game \(0\) isn't the auction's \(8\)/);
  assert.match(why(facts({ trade: trade({ offered: [riven({ rank: null })] }) })), /not logged/);
});

test("case 2: anything else short of case 1 while an auction fits is told: old, two rivens, an unread or newer inventory", () => {
  assert.match(why(facts({ recent: false })), /older than half an hour/);
  assert.match(why(facts({ trade: trade({ offered: [riven(), riven({ name: "Braton Visi-critatis" })] }) })), /more than one riven/);
  assert.match(why(facts({ trade: trade({ offered: [riven({ count: 2 })] }) })), /more than one riven/);
  assert.match(why(facts({ held: null })), /hasn't been read/);
  // Twins: one sold, the other kept. A read after the trade that still holds one of that name is
  // the riven kept, whose auction this may be; with the read's time unknown, the same.
  assert.match(why(facts({ held: { rivens: [{ weapon: "braton", name: "Crita-hexacan" }], at: AT * 1000 + 5_000 } })), /still holds/);
  assert.match(why(facts({ held: { rivens: [{ weapon: "braton", name: "Crita-hexacan" }], at: null } })), /still holds/);
  assert.match(why(facts({ trade: trade({ at: null }) })), /still holds/);
});

test("case 8: a sale older than the window, or one already in the log when MyOrbiter started, is told and never closed", () => {
  const now = AT * 1000;
  // Over half an hour old: not recent, so told with an auction fitting, never closed.
  const old = trade({ at: AT - 31 * 60 });
  assert.equal(recentTrade(old, now, false), false);
  assert.match(why(facts({ trade: old, recent: recentTrade(old, now, false) })), /older than half an hour/);
  // Under it: recent, and closed (the inventory read holding none of that riven).
  const fresh = trade({ at: AT - 29 * 60 });
  assert.equal(rivenVerdict(facts({ trade: fresh, recent: recentTrade(fresh, now, false), held: { rivens: [], at: null } })).do, "close");
  // No time in the log: found on the first read of its session (made while MyOrbiter was shut) it
  // isn't recent; turning up after that read, it is (the inventory rule then still asks for a read
  // known to be from before it, or none of that riven held).
  const untimed = trade({ at: null });
  assert.equal(recentTrade(untimed, now, true), false);
  assert.match(why(facts({ trade: untimed, recent: recentTrade(untimed, now, true) })), /or was made while MyOrbiter was closed/);
  assert.equal(recentTrade(untimed, now, false), true);
  assert.equal(rivenVerdict(facts({ trade: untimed, recent: true, held: { rivens: [], at: null } })).do, "close");
  // With no auction fitting, an old sale is nothing at all.
  assert.equal(rivenVerdict(facts({ trade: old, recent: false, auctions: [] })).do, "nothing");
});

test("case 3: a riven received never closes anything and is never told", () => {
  const bought = trade({ offered: [], received: [riven()], platinum_offered: 120, platinum_received: 0 });
  assert.equal(rivenVerdict(facts({ trade: bought, item: bought.received[0] })).do, "nothing");
  // In a swap, only the riven given is looked at.
  const swap = trade({ offered: [{ name: "Forma Blueprint", rank: null, count: 1 }], received: [riven()] });
  assert.equal(rivenVerdict(facts({ trade: swap, item: swap.received[0] })).do, "nothing");
});

test("case 4: the inventory alone never closes an auction, and a bad read takes nothing down", () => {
  // No riven in the trade: an auction for a riven the read doesn't hold stays, however the read looks.
  for (const held of [null, { rivens: [], at: Date.now() }, { rivens: [{ weapon: "braton", name: "Visi-critatis" }], at: Date.now() }]) {
    const t = trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }] });
    assert.equal(rivenVerdict(facts({ trade: t, item: t.offered[0], held })).do, "nothing");
    // An item named like the riven but not tagged one by the game isn't a riven.
    const look = trade({ offered: [{ name: "Braton Crita-hexacan", rank: 0, count: 1 }] });
    assert.equal(rivenVerdict(facts({ trade: look, item: look.offered[0], held })).do, "nothing");
  }
  // The inventory can only hold a close back: with no fitting auction, no read makes one.
  assert.equal(rivenVerdict(facts({ auctions: [], held: { rivens: [], at: null } })).do, "nothing");
  assert.equal(heldLike([{ weapon: "braton", name: "Crita-hexacan" }, { weapon: "braton", name: "Other" }], auction("a1")), 1);
});

test("case 7: not signed in, nothing at all; no fitting auction, nothing either", () => {
  assert.equal(rivenVerdict(facts({ linked: false })).do, "nothing");
  assert.equal(rivenVerdict(facts({ linked: false, autoTrades: false })).do, "nothing");
  // Closed, another weapon, another name, a name only part of the logged one: no fit.
  for (const a of [auction("x", { closed: true }), auction("x", { weapon: "kuva_bramma" }), auction("x", { name: "visi-critatis" }), auction("x", { name: "hexacan" })]) assert.equal(rivenVerdict(facts({ auctions: [a] })).do, "nothing", JSON.stringify(a));
  // A weapon warframe.market doesn't list (or names otherwise): nothing guessed.
  assert.equal(auctionFits(meta, auction("x", { weapon: "lex" }), "Lex Crita-hexacan"), false);
  assert.equal(auctionFits(meta, auction("x"), "  braton   CRITA-hexacan "), true);
});

test("case 9: a trade with a riven and listed items: the listing is marked as before, the riven never matched to a listing", async () => {
  const items: MarketItem[] = [
    { id: "co", slug: "condition_overload", gameRef: "/M/CO", name: "Condition Overload", maxRank: 5, subtypes: null, tags: ["mod"] },
    // An item that happens to carry the riven's whole name: still not the riven's.
    { id: "bc", slug: "braton_crita_hexacan", gameRef: "/M/BC", name: "Braton Crita-hexacan", maxRank: null, subtypes: null, tags: ["mod"] },
  ];
  const order = (id: string, itemId: string, platinum: number, rank: number | null): MyOrder => ({ id, itemId, type: "sell", platinum, quantity: 1, rank, subtype: null, visible: true, updatedAt: null });
  const orders = [order("o1", "co", 20, 0), order("o2", "bc", 100, null)];
  const t = trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }, riven()], platinum_received: 120 });
  const sales = salesFromTrade(t, orders, indexItems(items))!;
  assert.equal(sales[0].order?.id, "o1");
  assert.equal(sales[1].order, null);
  assert.equal(sales[1].riven, true);
  // markTrades: the listing marked sold, the riven logged with its own outcome, nothing sent for it.
  let log: Sale[] = [];
  const sold: string[] = [];
  const lines: unknown[] = [];
  const io: TradeMarking = {
    sales: () => log, setSales: (s) => (log = s), seen: () => {}, salesOf: () => sales, orders: () => orders,
    sold: async (o) => (sold.push(o.id), { quantity: 1 }), outcome: (_k, l) => lines.push(l), failed: (_k, e) => assert.fail(String(e)), now: () => AT * 1000,
  };
  await markTrades([t], 1, io);
  assert.deepEqual(sold, ["o1"]);
  assert.deepEqual(log.map((s) => s.item).sort(), ["Braton Crita-hexacan", "Condition Overload"]);
  const out = (lines[0] as { name: string; outcome: string }[]).map((l) => `${l.name}: ${l.outcome}`);
  assert.deepEqual(out, ["Condition Overload: marked", "Braton Crita-hexacan: riven"]);
  // The sale's notification no longer says the riven "wasn't listed".
  assert.match(saleNotice(t, [{ ...riven(), outcome: "riven" }]).body, /looked at on its own/);
  assert.doesNotMatch(saleNotice(t, [{ ...riven(), outcome: "riven" }]).body, /listed/);
});

test("case 5: the close reads the auctions fresh and closes only one still open that still fits", async () => {
  const raw = (id: string, over: Record<string, unknown> = {}) => ({ id, starting_price: 100, buyout_price: 100, closed: false, visible: true, item: { type: "riven", weapon_url_name: "braton", name: "crita-hexacan", mod_rank: 0, ...over } });
  const still = (list: MyAuction[]) => stillToClose(meta, list, "a1", "Braton Crita-hexacan", 0);
  const run = async (answers: unknown[][], closeFails = false) => {
    const sent: string[] = [];
    let reads = 0;
    market.myAuctions = async () => {
      const a = answers[Math.min(reads++, answers.length - 1)];
      if (a == null) throw new Error("timed out");
      return a;
    };
    market.closeAuction = async (id: string) => {
      sent.push(id);
      if (closeFails) throw new Error("warframe.market answered 500");
    };
    let result: string;
    try {
      result = await rivens.closeIfStill("a1", still);
    } catch (e) {
      result = `threw: ${(e as Error).message}`;
    }
    return { result, sent, reads };
  };
  // Still open and still the riven: one close, read before it.
  const ok = await run([[raw("a1")], []]);
  assert.deepEqual([ok.result, ok.sent], ["closed", ["a1"]]);
  assert.ok(ok.reads >= 1);
  // Closed meanwhile (here or on the site): nothing sent.
  assert.deepEqual(await run([[raw("a1", {})].map((x) => ({ ...x, closed: true }))]).then((r) => [r.result, r.sent]), ["gone", []]);
  assert.deepEqual(await run([[]]).then((r) => [r.result, r.sent]), ["gone", []]);
  // Open under that id but no longer the riven (ranked since, renamed): nothing sent.
  assert.deepEqual(await run([[raw("a1", { mod_rank: 3 })]]).then((r) => [r.result, r.sent]), ["changed", []]);
  assert.deepEqual(await run([[raw("a1", { name: "visi-critatis" })]]).then((r) => [r.result, r.sent]), ["changed", []]);
  // The read fails: nothing sent.
  assert.deepEqual(await run([null as never]).then((r) => [r.result, r.sent]), ["unread", []]);
  // The close fails: a read after it that has it closed counts as closed; still open, the reason is thrown.
  assert.deepEqual(await run([[raw("a1")], [{ ...raw("a1"), closed: true }]], true).then((r) => [r.result, r.sent]), ["closed", ["a1"]]);
  assert.deepEqual(await run([[raw("a1")]], true).then((r) => [r.result, r.sent]), ["threw: warframe.market answered 500", ["a1"]]);
  // stillToClose itself: another id is never taken for it.
  assert.equal(stillToClose(meta, parseMyAuctions([raw("a2")]), "a1", "Braton Crita-hexacan", 0), null);
});

test("case 5: one trade decides once: a record for each riven, kept over a restart; a close found unfinished is never sent again", () => {
  const r: RivenSold = { trade: "1|3127.384", riven: "Braton Crita-hexacan", rank: 0, at: AT * 1000, partner: "Buyer1", auctions: ["a1"], state: "closing" };
  let list = keepRivenSold([], r, "1");
  assert.equal(rivenDecided(list, r.trade, riven()), true);
  assert.equal(rivenDecided(list, r.trade, riven({ name: "Braton Visi-critatis" })), false);
  assert.equal(rivenDecided(list, "2|10", riven()), false);
  // The same riven of the same trade again replaces, never adds.
  list = keepRivenSold(list, { ...r, state: "closed" }, "1");
  assert.equal(list.length, 1);
  // Saved and loaded: a close that was under way when MyOrbiter quit comes back told (failed), with its click, not as a close to send.
  const loaded = rivenSoldOf(JSON.parse(JSON.stringify([{ ...r, state: "closing" }, { bad: true }, { ...r, trade: "x", state: "odd" }])));
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].state, "failed");
  assert.match(loaded[0].why ?? "", /MyOrbiter was closed/);
  // The game session still running keeps all its records, however many.
  let many: RivenSold[] = [];
  for (let i = 0; i < 150; i++) many = keepRivenSold(many, { ...r, trade: `${i < 60 ? 1 : 2}|${i}` }, "1");
  assert.ok(many.some((x) => x.trade === "1|0"), "the running session's oldest is kept");
});

test("case 6: the telling shows while the auction is open, and not once it is closed or put away", () => {
  const r: RivenSold = { trade: "1|3127.384", riven: "Braton Crita-hexacan", rank: 0, at: AT * 1000, partner: "Buyer1", auctions: ["a1"], state: "told", why: "Mark sales sold from the game is off" };
  assert.deepEqual(rivenSoldShown([r], [auction("a1")]).map((x) => x.auctions.map((a) => a.id)), [["a1"]]);
  assert.equal(rivenSoldShown([r], [auction("a1", { closed: true })]).length, 0);
  assert.equal(rivenSoldShown([r], []).length, 0);
  assert.equal(rivenSoldShown(setRivenSold([r], r, "kept"), [auction("a1")]).length, 0);
  assert.equal(rivenSoldShown(setRivenSold([r], r, "closed"), [auction("a1")]).length, 0);
  assert.equal(rivenSoldShown(setRivenSold([r], r, "failed", "warframe.market answered 500"), [auction("a1")]).length, 1);
  for (const state of ["none", "closing"] as const) assert.equal(rivenSoldShown([{ ...r, state }], [auction("a1")]).length, 0);
});
