// A riven given in a trade while warframe.market's riven lists aren't loaded (core/rivenLists.ts,
// rivenStore's loadMetaForTrades): the trade asks for them itself, a few tries at most, and is then
// decided by core/rivenSold.ts as it always is. Made-up trades and auctions; nothing here reaches
// warframe.market (the store's requests are replaced, and fetch throws).
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market } from "../src/lib/backend";
import { RIVEN_LISTS_GAP_MS, RIVEN_LISTS_TRIES, RivenListsTries, rivenListsUsable, rivenTradeStep } from "../src/lib/core/rivenLists";
import { rivenRecent, rivenVerdict, type RivenSold } from "../src/lib/core/rivenSold";
import { TELL_WINDOW } from "../src/lib/core/saleNotice";
import { tradeKey } from "../src/lib/core/trades";
import type { MyAuction, RivenMeta } from "../src/lib/core/rivens";
import type { Trade, TradeItem } from "../src/lib/core/types";

const noNetwork = (() => {
  throw new Error("no network in tests");
}) as never;
globalThis.fetch = noNetwork;
const { rivens } = await import("../src/lib/rivenStore.svelte");
const real = { ...market };
beforeEach(() => {
  Object.assign(market, real);
  globalThis.fetch = noNetwork;
  rivens.meta = null;
  rivens.metaError = null;
  rivens.metaFailure = null;
  Object.assign(rivens as unknown as object, { loading: null, pageWaits: false, tradeTries: new RivenListsTries() });
});

const meta: RivenMeta = {
  weapons: [{ slug: "braton", gameRef: "/W/Braton", name: "Braton", group: "primary", rivenType: "rifle" }],
  attributes: [],
};
const SESSION = 1_791_915_400;
const AT = 1_791_918_527;
const riven = (over: Partial<TradeItem> = {}): TradeItem => ({ name: "Braton Crita-hexacan", rank: 0, count: 1, riven: true, ...over });
const trade = (t: Partial<Trade> = {}): Trade => ({ uptime: 3127.384, at: AT, partner: "Buyer1", offered: [riven()], received: [], platinum_offered: 0, platinum_received: 120, ...t });
const auction = (id: string): MyAuction => ({
  id, weapon: "braton", name: "crita-hexacan", starting: 100, buyout: 100, topBid: null, closed: false, visible: true, private: false, note: "", minRep: 0, updated: "",
  attributes: [], rerolls: 0, mr: 8, rank: 0, polarity: "madurai",
});
const key = (t: Trade) => tradeKey(SESSION, t);
const step = (over: Partial<Parameters<typeof rivenTradeStep>[0]> = {}) =>
  rivenTradeStep({ trades: [trade()], linked: true, sold: [], key, busy: () => false, meta: null, ...over });
/** The read the pages make, replaced: counts each call, answers with `answer`'s result. */
function listsRead(answer: () => Promise<RivenMeta>) {
  const calls = { n: 0 };
  market.rivenMeta = async () => {
    calls.n++;
    return answer();
  };
  return calls;
}

test("a riven trade due while the lists are missing asks for them once, and is then decided by the usual rules", async () => {
  const s = step();
  assert.equal(s.do, "lists");
  const calls = listsRead(async () => meta);
  const asked = rivens.loadMetaForTrades(s.do === "lists" ? s.due.map(key) : []);
  assert.ok(asked);
  assert.equal(asked.try, 1);
  const { meta: got, again } = await asked.done;
  assert.deepEqual(got, meta);
  assert.equal(again, false);
  assert.equal(calls.n, 1, "the pages' own read, once");
  // The lists kept: the trade's next step decides, and asks for nothing more.
  const next = step({ meta: rivens.meta });
  assert.equal(next.do, "decide");
  assert.equal(rivens.loadMetaForTrades([key(trade())]), null, "the lists are here: no try");
  assert.equal(calls.n, 1);
  // Decided as always: closed when sure, told otherwise.
  const t = trade();
  const facts = { trade: t, item: t.offered[0], autoTrades: true, linked: true, recent: true, auctions: [auction("a1")], meta: rivens.meta!, held: { rivens: [], at: AT * 1000 + 5000 } };
  assert.equal(rivenVerdict(facts).do, "close");
  assert.equal(rivenVerdict({ ...facts, auctions: [auction("a1"), auction("a2")] }).do, "tell");
  // A read the pages already have out is shared, not made twice.
  rivens.meta = null;
  Object.assign(rivens as unknown as object, { loading: null, tradeTries: new RivenListsTries() });
  let answer: (m: RivenMeta) => void = () => {};
  const slow = listsRead(() => new Promise<RivenMeta>((r) => (answer = r)));
  const page = rivens.loadMeta();
  const forTrade = rivens.loadMetaForTrades([key(trade())]);
  answer(meta);
  await page;
  assert.deepEqual((await forTrade!.done).meta, meta);
  assert.equal(slow.n, 1);
});

test("nothing asks for the lists when no riven trade is due", () => {
  const t = trade();
  // At start: no trade read yet.
  assert.equal(step({ trades: [] }).do, "nothing");
  // A trade without a riven.
  assert.equal(step({ trades: [trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }] })] }).do, "nothing");
  // A riven received is never looked at.
  assert.equal(step({ trades: [trade({ offered: [], received: [riven()], platinum_offered: 120, platinum_received: 0 })] }).do, "nothing");
  // Signed out: the auctions aren't known.
  assert.equal(step({ linked: false }).do, "nothing");
  // A riven already decided, in any state, kept across restarts.
  for (const state of ["closing", "closed", "told", "failed", "kept", "none"] as const) {
    const sold: RivenSold[] = [{ trade: key(t), riven: "Braton Crita-hexacan", rank: 0, at: AT * 1000, partner: "Buyer1", auctions: [], state }];
    assert.equal(step({ trades: [t], sold }).do, "nothing", state);
  }
  // A trade being decided now.
  assert.equal(step({ busy: (k) => k === key(t) }).do, "nothing");
  // Each of those with the lists missing too: the step is "nothing", so no read is made.
  // Only an undecided riven given, signed in, asks.
  assert.equal(step().do, "lists");
  // And with the lists there, it decides without asking.
  assert.equal(step({ meta }).do, "decide");
});

test("lists that can't be had: three tries a minute apart per trade, never read as no auction fits, then it waits for a page", async () => {
  const calls = listsRead(async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  });
  const k = [key(trade())];
  let now = Date.now();
  for (let n = 1; n <= RIVEN_LISTS_TRIES; n++) {
    const asked = rivens.loadMetaForTrades(k, now);
    assert.ok(asked, `try ${n}`);
    assert.equal(asked.try, n);
    // While it is out, no second one goes.
    assert.equal(rivens.loadMetaForTrades(k, now), null);
    const { meta: got, again } = await asked.done;
    assert.equal(got, null);
    assert.equal(again, n < RIVEN_LISTS_TRIES);
    now = Date.now();
    // Not before the gap is over.
    assert.equal(rivens.loadMetaForTrades(k, now + RIVEN_LISTS_GAP_MS - 1), null);
    now += RIVEN_LISTS_GAP_MS;
  }
  assert.equal(calls.n, RIVEN_LISTS_TRIES);
  assert.equal(rivens.metaError, null, "the pages show nothing of the trade's reads");
  // No tries left for that trade: nothing more is asked, however long it waits.
  assert.equal(rivens.loadMetaForTrades(k, now + 3600_000), null);
  assert.equal(calls.n, RIVEN_LISTS_TRIES);
  // And the trade is never decided without them: it stays "lists", never "nothing" or "decide".
  assert.equal(step({ meta: rivens.meta }).do, "lists");
  // A page that loads them later lets it be decided then.
  market.rivenMeta = async () => meta;
  await rivens.loadMeta();
  assert.equal(step({ meta: rivens.meta }).do, "decide");
});

test("another riven trade later gets tries of its own; one try serves every trade due at once", async () => {
  const tries = new RivenListsTries();
  const a = key(trade());
  const b = key(trade({ uptime: 4000.5 }));
  let now = 1_000_000;
  for (let n = 1; n <= RIVEN_LISTS_TRIES; n++) {
    assert.equal(tries.take([a], now), n);
    tries.done(false, now);
    now += RIVEN_LISTS_GAP_MS;
  }
  assert.equal(tries.take([a], now), null);
  assert.equal(tries.left([a]), false);
  // A new trade: its first try, and the old one isn't counted again.
  assert.equal(tries.take([a, b], now), 1);
  tries.done(false, now);
  assert.equal(tries.take([a, b], now + RIVEN_LISTS_GAP_MS), 2);
  tries.done(true, now + RIVEN_LISTS_GAP_MS);
  // After lists that came, no gap.
  assert.equal(tries.take([b], now + RIVEN_LISTS_GAP_MS), 3);
});

test("an empty weapon list counts as missing: not kept, each try reads again, never read as no auction fits", async () => {
  assert.equal(rivenListsUsable(null), false);
  assert.equal(rivenListsUsable({ weapons: [], attributes: [] }), false);
  assert.equal(rivenListsUsable(meta), true);
  assert.equal(step({ meta: { weapons: [], attributes: [] } }).do, "lists");
  const calls = listsRead(async () => ({ weapons: [], attributes: [] }));
  const k = [key(trade())];
  let now = Date.now();
  for (let n = 1; n <= RIVEN_LISTS_TRIES; n++) {
    const asked = rivens.loadMetaForTrades(k, now);
    assert.equal(asked?.try, n);
    const { meta: got, again } = await asked!.done;
    assert.equal(got, null);
    assert.equal(again, n < RIVEN_LISTS_TRIES);
    // Not kept: a try counted is a read made, not one answered by what was kept.
    assert.equal(rivens.meta, null);
    assert.equal(calls.n, n);
    assert.match(rivens.metaFailure ?? "", /no weapon/);
    now = Date.now() + RIVEN_LISTS_GAP_MS;
  }
  assert.equal(rivens.loadMetaForTrades(k, now + 3600_000), null);
  assert.equal(calls.n, RIVEN_LISTS_TRIES);
  assert.equal(step({ meta: rivens.meta }).do, "lists");
});

test("a trade's failed read isn't shown on the pages; a read a page asked for or shared is", async () => {
  listsRead(async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  });
  // The trade's own read: its reason is kept for the log, the pages show nothing of it.
  await rivens.loadMetaForTrades([key(trade())])!.done;
  assert.equal(rivens.metaError, null);
  assert.match(rivens.metaFailure ?? "", /timed out/);
  // A page's read: shown.
  assert.equal(await rivens.loadMeta(), null);
  assert.match(rivens.metaError ?? "", /timed out/);
  // A page that shares a trade's read that fails: shown too, it waited on it.
  Object.assign(rivens as unknown as object, { tradeTries: new RivenListsTries() });
  rivens.metaError = null;
  const forTrade = rivens.loadMetaForTrades([key(trade())]);
  const page = rivens.loadMeta();
  await forTrade!.done;
  assert.equal(await page, null);
  assert.match(rivens.metaError ?? "", /timed out/);
  // A read that works clears both.
  market.rivenMeta = async () => meta;
  await rivens.loadMeta();
  assert.equal(rivens.metaError, null);
  assert.equal(rivens.metaFailure, null);
});

test("the half hour a close needs is counted from the trade, whenever the lists come", () => {
  // The gaps between the tries add two minutes; each try's own time is warframe.market's queue's
  // (its waits after a 429 and its time limits in market.rs), not bounded here.
  assert.equal((RIVEN_LISTS_TRIES - 1) * RIVEN_LISTS_GAP_MS, 120_000);
  // A trade made while MyOrbiter ran, seen at once, is as recent a few minutes later as at once
  // (rivenRecent is taken when it is decided)...
  const sessionRead = AT * 1000 - 600_000;
  const seen = { at: AT * 1000, firstRead: false };
  assert.equal(rivenRecent(trade(), AT * 1000 + 1000, seen, sessionRead), true);
  assert.equal(rivenRecent(trade(), AT * 1000 + 1000 + 10 * 60_000, seen, sessionRead), true);
  // ...and, by the rules as they are, decided past the half hour it is only told, however late
  // the lists came: the wait can only make a close a telling near that edge, as a page's did.
  assert.equal(rivenRecent(trade(), AT * 1000 + TELL_WINDOW, seen, sessionRead), false);
});

test("with Mark sales sold from the game off, the lists are asked for all the same, and the riven is then told", async () => {
  // The step takes no switch: the same with it on or off.
  const s = step();
  assert.equal(s.do, "lists");
  listsRead(async () => meta);
  const asked = rivens.loadMetaForTrades(s.do === "lists" ? s.due.map(key) : []);
  assert.deepEqual((await asked!.done).meta, meta);
  const t = trade();
  const v = rivenVerdict({ trade: t, item: t.offered[0], autoTrades: false, linked: true, recent: true, auctions: [auction("a1")], meta, held: null });
  assert.equal(v.do, "tell");
  assert.equal(v.do === "tell" && v.why, "Mark sales sold from the game is off");
});

test("outside the app (the demo), the lists come from the page's own server and nothing leaves the machine", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    return new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } });
  }) as never;
  const got = rivens.loadMetaForTrades([key(trade())]);
  assert.deepEqual((await got!.done).meta?.weapons.map((w) => w.slug), ["braton"]);
  assert.deepEqual(asked, ["/dev-rivens.json"]);
});
