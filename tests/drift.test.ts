// Repricing changes a listing's price only when it has drifted (core/drift.ts): a target that
// ignores bait, a dead band, and a cooldown that survives a restart, all after the floors. Nothing
// is sent anywhere: warframe.market's calls are stand-ins.
import { settle } from "./support/runes";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market, defaultAdvice, defaultMarketSettings, loadSettings, type MarketSettings } from "../src/lib/backend";
import { DRIFT, DRIFT_RULES, baitProof, changesOf, cooldown, deadBand, drifted, noteChange } from "../src/lib/core/drift";
import { plan, type BookOrder, type MyOrder } from "../src/lib/core/market";
import { aboveDucats, ducatWorth } from "../src/lib/core/bulk";
import { buildModel, type Model } from "../src/lib/core/model";

void settle;
const { mkt } = await import("../src/lib/marketStore.svelte");

const HOUR = 60 * 60_000;
const T0 = Date.parse("2026-11-08T12:00:00Z");
const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true };
const order = (platinum: number, id = "a"): MyOrder => ({ id, itemId: "it", type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null });
let n = 0;
const seller = (platinum: number, status = "ingame", user = `u${++n}`): BookOrder => ({ id: `o${++n}`, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, user: { id: user, ingameName: user, status, platform: "pc", crossplay: true } });
const rule = { floor: null, minShare: 0, reference: null, min: 1, drift: true };

// ------------------------------------------------------------------ the numbers

test("the dead band is the larger of 2p and 5% of the listing's price", () => {
  assert.equal(DRIFT.bandPlat, 2);
  assert.equal(DRIFT.bandShare, 0.05);
  assert.equal(deadBand(10), 2);
  assert.equal(deadBand(100), 5);
  assert.ok(!drifted(20, 22) && !drifted(20, 18) && drifted(20, 23) && drifted(20, 17));
  assert.ok(!drifted(100, 105) && drifted(100, 106) && !drifted(100, 95) && drifted(100, 94));
  assert.match(DRIFT_RULES, /2p or 5%.*once an hour and 6 times a day/);
});

test("the target is the second-lowest seller, the median of the three lowest; never one seller alone", () => {
  assert.equal(baitProof([]), null);
  assert.equal(baitProof([5]), null);
  assert.equal(baitProof([20, 1]), 20);
  assert.equal(baitProof([30, 1, 22, 20]), 20);
});

// ------------------------------------------------------------------ the target

test("a bait listing at 1p moves nothing", () => {
  const p = plan(order(20), [seller(1), seller(20)], me, rule);
  assert.equal(p.change, false);
  assert.equal(p.target, 20);
  // With honest sellers under you, you follow them, not the bait.
  const q = plan(order(20), [seller(1), seller(15), seller(16)], me, rule);
  assert.deepEqual([q.change, q.target], [true, 15]);
});

test("sellers online count, offline ones don't, and a seller counts once", () => {
  assert.equal(plan(order(30), [seller(10, "online"), seller(10, "ingame")], me, rule).target, 10);
  assert.equal(plan(order(30), [seller(10, "offline"), seller(10, "offline"), seller(10, "ingame")], me, rule).change, false, "one seller reachable: no target");
  // One seller listing twice can't make the target alone.
  const p = plan(order(30), [seller(10, "ingame", "twice"), seller(11, "ingame", "twice"), seller(29, "ingame")], me, rule);
  assert.equal(p.change, false, `${p.target}: 29 is within the band of 30`);
});

test("a raise goes no higher than the cheapest seller, and not at all past one under you", () => {
  assert.equal(plan(order(10), [seller(20), seller(25)], me, rule).target, 20);
  assert.equal(plan(order(10), [seller(1), seller(20)], me, rule).change, false);
});

test("everyone asking too much is judged by the cheapest seller, never the bait-proof target", () => {
  // Sellers at 18 and 30 for something that goes for 10: 18 is under twice 10, so it isn't over-asked
  // and nothing goes under every real seller. (By the second-cheapest, 30, it would go to 10p.)
  const p = plan(order(25), [seller(18), seller(30)], me, { ...rule, reference: 10 });
  assert.deepEqual([p.change, p.target, p.reason], [false, 25, "already"]);
  // Everyone over twice what it goes for: priced at that, as before.
  const q = plan(order(40), [seller(25), seller(30)], me, { ...rule, reference: 10 });
  assert.deepEqual([q.change, q.target, q.reason], [true, 10, "median"]);
  // A raise to what it goes for still stops at the cheapest seller.
  const r = plan(order(5), [seller(8), seller(30)], me, { ...rule, reference: 20 });
  assert.equal(r.target, 8);
});

// ------------------------------------------------------------------ after the floors

test("a listing on its floor never moves; one under it is raised to it whatever the gap", () => {
  const on = plan(order(30), [seller(10), seller(10)], me, { ...rule, floor: 30 });
  assert.deepEqual([on.change, on.target], [false, 30]);
  const under = plan(order(29), [seller(10), seller(10)], me, { ...rule, floor: 30 });
  assert.deepEqual([under.change, under.target], [true, 30], "1p, inside the band, but a floor is never left broken");
  // A target clamped up to the floor is measured from there: 32 → 30 is within the band.
  assert.equal(plan(order(32), [seller(10), seller(10)], me, { ...rule, floor: 30 }).change, false);
  // The share of the market value moves with the asks: a gap to it inside the band waits.
  const share = plan(order(29), [seller(10), seller(10)], me, { ...rule, minShare: 1, reference: 30 });
  assert.deepEqual([share.change, share.floor, share.hard], [false, 30, 1]);
  assert.equal(plan(order(20), [seller(10), seller(10)], me, { ...rule, minShare: 1, reference: 30 }).target, 30, "past the band it's raised");
});

test("new listings still start at the cheapest in game (the rule is repricing's only)", () => {
  const p = plan(order(20), [seller(12), seller(19)], me, { ...rule, drift: false });
  assert.deepEqual([p.change, p.target], [true, 12]);
});

// ------------------------------------------------------------------ the cooldown

test("the cooldown: once an hour, six a day, times kept a day", () => {
  assert.deepEqual(cooldown(undefined, T0), { ok: true });
  assert.deepEqual(cooldown([T0], T0 + HOUR - 1), { ok: false, until: T0 + HOUR, why: "hour" });
  assert.deepEqual(cooldown([T0], T0 + HOUR), { ok: true });
  const six = [0, 1, 2, 3, 4, 5].map((h) => T0 + h * HOUR);
  assert.deepEqual(cooldown(six, T0 + 7 * HOUR), { ok: false, until: T0 + DRIFT.dayMs, why: "day" });
  assert.deepEqual(cooldown(six, T0 + DRIFT.dayMs), { ok: true });
  // A time ahead of now (the clock set back) holds the listing, never frees it.
  assert.equal(cooldown([T0 + 2 * HOUR], T0).ok, false);
  let log = noteChange({ old: [T0 - DRIFT.dayMs - 1] }, "k", T0);
  assert.deepEqual(log, { k: [T0] }, "a day old is dropped");
  log = noteChange(log, "k", T0 + HOUR);
  assert.deepEqual(log.k, [T0, T0 + HOUR]);
  assert.deepEqual(changesOf({ k: [T0, "x", 1.5, null, T0 - DRIFT.dayMs], j: "junk", l: [] }, T0 + 1), { k: [T0] });
  assert.deepEqual(changesOf([1, 2], T0), {});
  // Ahead of now, however far, counts as now: a clock set back never frees a listing sooner.
  assert.deepEqual(changesOf({ k: [T0 + 5 * DRIFT.dayMs] }, T0), { k: [T0] });
  assert.equal(cooldown(changesOf({ k: [T0 + 5 * DRIFT.dayMs] }, T0).k, T0 + HOUR - 1).ok, false);
});

// ------------------------------------------------------------------ the store, on a timer

const it = { id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] };
const noPrices = { price: () => null, priceMax: () => null, relicPrice: () => null, partByName: new Map() } as unknown as Model;
const real = { ...market };
const realNow = Date.now;
let now = T0;
let mine: MyOrder[] = [];
let book: BookOrder[] = [];
let sent: [string, number][] = [];

beforeEach(() => {
  Object.assign(market, real);
  now = T0;
  Date.now = () => now;
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.orders = [];
  mkt.ordersAt = null;
  mkt.passFailures = 0;
  mkt.lastPass = null;
  mkt.log = [];
  mkt.op = null;
  mkt.pass = null;
  mkt.advice = null;
  sent = [];
  mine = [order(100)];
  market.items = async () => [it];
  market.myOrders = async () => mine.map((o) => ({ ...o }));
  market.book = async () => structuredClone(book) as never;
  market.update = (async (id: string, c: { platinum?: number }) => {
    sent.push([id, c.platinum!]);
    mine = mine.map((o) => (o.id === id ? { ...o, platinum: c.platinum! } : o));
    return {} as never;
  }) as never;
});
afterEach(() => {
  Date.now = realNow;
  Object.assign(market, real);
});

const settings = (): MarketSettings => ({ ...defaultMarketSettings(), auto: true, autoCheck: true, minShare: 0, minPrice: 1, approved: { "it||": 100 } });
async function timedPass(s: MarketSettings, m: Model = noPrices) {
  mkt.books = {};
  await mkt.reprice(m, s, true, true);
}

test("on a timer: at most one change an hour per listing", async () => {
  const s = settings();
  book = [seller(90), seller(90)];
  await timedPass(s);
  book = [seller(80), seller(80)];
  now += 30 * 60_000;
  await timedPass(s);
  assert.deepEqual(sent, [["a", 90]], "half an hour later: no change");
  now = T0 + HOUR;
  await timedPass(s);
  assert.deepEqual(sent, [["a", 90], ["a", 80]], "an hour after the last: it goes");
});

test("on a timer: at most six changes a day per listing", async () => {
  const s = settings();
  for (let h = 0; h < 12; h++) {
    now = T0 + h * HOUR;
    book = [seller(h % 2 ? 100 : 90), seller(h % 2 ? 100 : 90)];
    await timedPass(s);
  }
  assert.equal(sent.length, DRIFT.perDay);
  now = T0 + DRIFT.dayMs;
  book = [seller(70), seller(70)];
  await timedPass(s);
  assert.equal(sent.length, DRIFT.perDay + 1, "a day after the first, one more may go");
});

test("the cooldown survives a restart: the changes are in the saved settings", async () => {
  const s = settings();
  book = [seller(90), seller(90)];
  await timedPass(s);
  assert.equal(sent.length, 1);
  assert.deepEqual(s.changes, { "it||": [T0] });
  // MyOrbiter closes and starts again ten minutes later, with what it had saved.
  now = T0 + 10 * 60_000;
  const text = JSON.stringify({ market: s });
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => text, setItem: () => {} };
  const loaded = (await loadSettings()).market;
  assert.deepEqual(loaded.changes, { "it||": [T0] });
  mkt.lastPass = null;
  book = [seller(70), seller(70)];
  await timedPass(loaded);
  assert.equal(sent.length, 1, "nothing within the hour, restart or not");
  now = T0 + HOUR;
  await timedPass(loaded);
  assert.equal(sent.length, 2);
});

test("on a timer: a move the 70% floor brings within the band isn't sent", async () => {
  const s = { ...settings(), approved: { "it||": 100 } };
  mine = [order(72)];
  book = [seller(40), seller(40)];
  await timedPass(s);
  assert.deepEqual(sent, [], "72p → 70p (70% of 100p) is within the 2p band");
  assert.ok(mkt.log.some((l) => /stays at 72p, near 70% of the 100p/.test(l.text)), "held at the 70% floor, and it says so");
});

test("Reprice by hand isn't held by the cooldown, and counts for it", async () => {
  const s = settings();
  book = [seller(90), seller(90)];
  await timedPass(s);
  book = [seller(80), seller(80)];
  now += 60_000;
  mkt.books = {};
  await mkt.reprice(noPrices, s, false);
  await mkt.reprice(noPrices, s, true);
  assert.deepEqual(sent, [["a", 90], ["a", 80]]);
  assert.deepEqual(s.changes["it||"], [T0, T0 + 60_000]);
});

test("a change warframe.market refuses still counts, so it isn't tried every pass", async () => {
  const s = settings();
  book = [seller(80), seller(80)];
  market.update = (async () => {
    throw new Error("429 Too Many Requests");
  }) as never;
  await timedPass(s);
  now += 5 * 60_000;
  await timedPass(s);
  assert.deepEqual(s.changes["it||"], [T0]);
});

test("a price typed on Orders counts for the cooldown", async () => {
  const s = settings();
  mkt.rules = s;
  try {
    await mkt.refresh();
    assert.ok(await mkt.update(mkt.orders[0], { platinum: 90 }));
    book = [seller(70), seller(70)];
    now += 10 * 60_000;
    await timedPass(s);
    assert.deepEqual(sent, [["a", 90]], "the pass waits an hour after the typed price");
    now = T0 + HOUR;
    await timedPass(s);
    assert.deepEqual(sent, [["a", 90], ["a", 70]]);
  } finally {
    mkt.rules = null;
  }
});

test("a listing at its ducat floor produces no write", async () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../demo/${f}`, import.meta.url), "utf8"));
  const model = buildModel(read("dev-bundle.json"), undefined, null, null, [], read("dev-recipe-data.json"));
  const items = read("dev-market-items.json");
  const paris = items.find((i: { slug: string }) => i.slug === "paris_prime_set");
  const advice = { ...defaultAdvice(), platPerDucat: 0.5 };
  const floor = aboveDucats(ducatWorth(model, paris, advice.platPerDucat));
  assert.ok(floor && floor > 5, `Paris Prime Set's ducat floor: ${floor}`);
  market.items = async () => items;
  mkt.items = [];
  await mkt.ensureItems();
  mkt.advice = advice;
  mine = [{ ...order(floor), itemId: paris.id }];
  book = [seller(1), seller(2), seller(3)];
  const s = { ...settings(), approved: { [`${paris.id}||`]: floor } };
  for (let h = 0; h < 3; h++) {
    now = T0 + h * HOUR;
    await timedPass(s, model);
  }
  assert.deepEqual(sent, []);
  assert.deepEqual(s.changes, {});
});

// ------------------------------------------------------------------ minimum prices by category

/** The listing's item as a mod, so the Mods minimum (Sell spares) is its own. */
async function asMod() {
  market.items = async () => [{ ...it, tags: ["mod"] }];
  mkt.items = [];
  await mkt.ensureItems();
}

test("on a timer: at most six changes a day per listing, with a category minimum set", async () => {
  await asMod();
  const s = { ...settings(), minByCategory: { mods: 50, relics: 3 } };
  for (let h = 0; h < 12; h++) {
    now = T0 + h * HOUR;
    book = [seller(h % 2 ? 100 : 90), seller(h % 2 ? 100 : 90)];
    await timedPass(s);
  }
  assert.equal(sent.length, DRIFT.perDay);
  assert.ok(sent.every(([, p]) => p >= 50));
});

test("a listing under its category minimum is raised to it, once the cooldown allows", async () => {
  await asMod();
  const s = { ...settings(), minPrice: 10, minByCategory: { mods: 40 }, approved: { "it||": 30 } };
  mine = [order(30)];
  book = [seller(20), seller(20)];
  await timedPass(s);
  assert.deepEqual(sent, [["a", 40]], "raised to the Mods minimum, whatever the gap");
  // Without the Mods minimum the global one applies: 20p stays over 10p, and 70% of 30p is 21p.
  sent = [];
  mine = [order(30)];
  now = T0 + 2 * HOUR;
  await timedPass({ ...settings(), minPrice: 10, approved: { "it||": 30 } });
  assert.deepEqual(sent, [["a", 21]]);
});

test("the highest floor wins: your own floor over a lower category minimum, the category minimum over a lower own floor", async () => {
  await asMod();
  mine = [order(30)];
  book = [seller(5), seller(5)];
  await timedPass({ ...settings(), minPrice: 10, minByCategory: { mods: 4 }, floors: { "it||": 25 }, approved: { "it||": 30 } });
  assert.deepEqual(sent, [["a", 25]], "a 4p Mods minimum under the old 10p one doesn't take it under your 25p floor");
  sent = [];
  mine = [order(40)];
  now = T0 + 2 * HOUR;
  await timedPass({ ...settings(), minPrice: 10, minByCategory: { mods: 28 }, floors: { "it||": 25 }, approved: { "it||": 40 } });
  assert.deepEqual(sent, [["a", 28]], "a 28p Mods minimum over your 25p floor");
});

test("a listing at its ducat floor still produces no write with a lower prime minimum, and a higher one raises it", async () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../demo/${f}`, import.meta.url), "utf8"));
  const model = buildModel(read("dev-bundle.json"), undefined, null, null, [], read("dev-recipe-data.json"));
  const items = read("dev-market-items.json");
  const paris = items.find((i: { slug: string }) => i.slug === "paris_prime_set");
  const advice = { ...defaultAdvice(), platPerDucat: 0.5 };
  const floor = aboveDucats(ducatWorth(model, paris, advice.platPerDucat))!;
  market.items = async () => items;
  mkt.items = [];
  await mkt.ensureItems();
  mkt.advice = advice;
  mine = [{ ...order(floor), itemId: paris.id }];
  book = [seller(1), seller(2), seller(3)];
  const low = { ...settings(), minByCategory: { prime: 2 }, approved: { [`${paris.id}||`]: floor } };
  await timedPass(low, model);
  assert.deepEqual(sent, [], "the ducat floor holds over a lower prime minimum");
  const high = { ...settings(), minByCategory: { prime: floor + 10 }, approved: { [`${paris.id}||`]: floor } };
  now = T0 + HOUR;
  await timedPass(high, model);
  assert.deepEqual(sent, [[mine[0].id, floor + 10]], "the prime minimum over the ducat floor wins");
});

// ------------------------------------------------------------------ off unless you turn it on

test("automatic repricing is off for a new install, and an install that had it on keeps it", async () => {
  assert.equal(defaultMarketSettings().auto, false);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {} };
  assert.equal((await loadSettings()).market.auto, false);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ market: { auto: true } }), setItem: () => {} };
  assert.equal((await loadSettings()).market.auto, true);
});

test("the Guide's clause reads on from \"it changes a price only when it has drifted\"", async () => {
  const { DRIFT_CLAUSE } = await import("../src/lib/core/drift");
  assert.match(DRIFT_CLAUSE, /^more than 2p or 5%/);
});
