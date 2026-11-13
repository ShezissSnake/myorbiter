// The repricing pass's own guards (marketStore.svelte.ts › reprice and planFor), held by what the
// pass sends to a stand-in warframe.market: a paused listing is left alone, a pass on the timer
// never more than halves a price, and a relic is never taken under what a crack of it is worth.
// Every market call is replaced; nothing reaches the network.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market, defaultMarketSettings, type MarketSettings } from "../src/lib/backend";
import { listingKey, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { buildModel, type Model } from "../src/lib/core/model";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const { mkt } = await import("../src/lib/marketStore.svelte");

const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true } as never;
const real = { ...market };
/** A model that knows no prices: only the listing's own rules count. */
const bare = { price: () => null, priceMax: () => null, relicPrice: () => null, partByName: new Map() } as unknown as Model;
const item = (id: string, name = `Example Item ${id}`, extra: Partial<MarketItem> = {}): MarketItem => ({ id, slug: `slug_${id}`, gameRef: `/Example/${id}`, name, maxRank: null, subtypes: null, tags: [], ...extra });
const listing = (id: string, itemId: string, platinum: number, subtype: string | null = null): MyOrder => ({ id, itemId, type: "sell", platinum, quantity: 1, rank: null, subtype, visible: true, updatedAt: null });
const sellers = (prices: number[], subtype: string | null = null) =>
  prices.map((platinum, i) => ({ id: `b${i}`, type: "sell", platinum, quantity: 1, rank: null, subtype, visible: true, user: { id: `u${i}`, ingameName: `Tenno_${i}`, status: "ingame", platform: "pc", crossplay: true } }));

/**
 * The stand-in warframe.market: your listings as it holds them (an update changes them), the
 * order books by slug, and every call made, in order.
 */
function standIn(items: MarketItem[], listings: MyOrder[], books: Record<string, ReturnType<typeof sellers>>) {
  const state = { listings: listings.map((o) => ({ ...o })), books, reads: [] as string[], sent: [] as { id: string; platinum: number | undefined }[], onRead: null as ((slug: string) => void) | null };
  market.items = async () => items;
  market.myOrders = async () => state.listings.map((o) => ({ ...o }));
  market.book = (async (slug: string) => {
    state.reads.push(slug);
    state.onRead?.(slug);
    return state.books[slug] ?? [];
  }) as never;
  market.update = (async (id: string, c: { platinum?: number }) => {
    state.sent.push({ id, platinum: c.platinum });
    state.listings = state.listings.map((o) => (o.id === id ? { ...o, platinum: c.platinum ?? o.platinum } : o));
    return {} as never;
  }) as never;
  return state;
}

const settings = (extra: Partial<MarketSettings> = {}): MarketSettings => ({ ...defaultMarketSettings(), auto: true, minShare: 0, minPrice: 1, ...extra });
/** A pass by hand, as the page runs it: Check prices, then Reprice (which sends only what the check showed). */
const byHand = async (m: Model, s: MarketSettings) => {
  await mkt.reprice(m, s, false);
  return mkt.reprice(m, s, true);
};

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.items = [];
  mkt.orders = [];
  mkt.books = {};
  mkt.log = [];
  mkt.op = null;
  mkt.pass = null;
  mkt.passFailures = 0;
  mkt.lastPass = null;
  mkt.error = null;
  mkt.advice = null;
  mkt.rules = null;
  mkt.model = null;
  mkt.editing.clear();
});

// ------------------------------------------------------------------ a paused listing

test("a paused listing is read and sent by no pass, timed or by hand; the other listing is sent", async () => {
  const items = [item("pa"), item("pb")];
  for (const how of ["timed", "by hand"] as const) {
    mkt.items = [];
    mkt.books = {};
    const m = standIn(items, [listing("a", "pa", 20), listing("b", "pb", 20)], { slug_pa: sellers([10, 10, 11]), slug_pb: sellers([10, 10, 11]) });
    const s = settings({ approved: { "pa||": 20, "pb||": 20 }, paused: { [listingKey(listing("a", "pa", 20))]: true } });
    if (how === "timed") await mkt.reprice(bare, s, true, true);
    else await byHand(bare, s);
    assert.deepEqual(m.sent.map((x) => x.id), ["b"], `${how}: only the listing that isn't paused is sent`);
    assert.ok(!m.reads.includes("slug_pa"), `${how}: a paused listing's book isn't even read`);
  }
});

test("a listing paused while a pass runs is not sent; unpaused, the next pass moves it", async () => {
  const items = [item("pa"), item("pb")];
  const key = listingKey(listing("a", "pa", 20));
  for (const how of ["timed", "by hand"] as const) {
    mkt.items = [];
    mkt.books = {};
    const m = standIn(items, [listing("a", "pa", 20), listing("b", "pb", 20)], { slug_pa: sellers([10, 10, 11]), slug_pb: sellers([10, 10, 11]) });
    const s = settings({ approved: { "pa||": 20, "pb||": 20 } });
    // By hand, Reprice sends what the check before it showed; its books are made older than Reprice
    // reuses, so the pass reads them again (and the pause below lands while it does).
    if (how === "by hand") {
      await mkt.reprice(bare, s, false);
      mkt.books = Object.fromEntries(Object.entries(mkt.books).map(([k, v]) => [k, { ...v, at: v.at - 3 * 60_000 }]));
    } else mkt.books = {};
    // Paused from the listing's row while the pass reads its book (after the pass looked at it).
    m.onRead = (slug) => {
      if (slug === "slug_pa") s.paused = { ...s.paused, [key]: true };
    };
    await mkt.reprice(bare, s, true, how === "timed");
    assert.deepEqual(m.sent.map((x) => x.id), ["b"], `${how}: paused during the pass, not sent`);
    m.onRead = null;
    s.paused = {};
    m.sent = [];
    mkt.books = {};
    if (how === "timed") await mkt.reprice(bare, s, true, true);
    else await byHand(bare, s);
    const a = m.sent.filter((x) => x.id === "a");
    assert.equal(a.length, 1, `${how}: unpaused, the next pass moves it`);
    assert.ok(a[0].platinum! < 20, `${how}: down toward the market`);
  }
});

// ------------------------------------------------------------------ never more than halved unattended

test("a timed pass never more than halves a price: nothing is sent and a note is written; by hand it is sent", async () => {
  const items = [item("h"), item("c")];
  // 100p listed, 50p approved (so 70% of it, 35p, isn't what stops it), sellers at 40p.
  const book = { slug_h: sellers([40, 40, 40]), slug_c: sellers([10, 10, 10]) };
  let m = standIn(items, [listing("h", "h", 100), listing("c", "c", 20)], book);
  let s = settings({ approved: { "h||": 50, "c||": 20 } });
  await mkt.reprice(bare, s, true, true);
  assert.deepEqual(m.sent, [{ id: "c", platinum: 14 }], "timed: the other listing goes (to 70% of 20p); the halving one doesn't");
  assert.equal(mkt.log.filter((l) => l.tone === "warn").length, 2, "one note for the held listing, one for the other at its 70% floor");

  mkt.items = [];
  mkt.books = {};
  mkt.log = [];
  m = standIn(items, [listing("h", "h", 100)], book);
  s = settings({ approved: { "h||": 50 } });
  await mkt.reprice(bare, s, true, true);
  assert.deepEqual(m.sent, [], "timed: nothing sent");
  assert.equal(mkt.log.filter((l) => l.tone === "warn").length, 1, "timed: one note says it was left for Reprice");

  mkt.items = [];
  mkt.books = {};
  m = standIn(items, [listing("h", "h", 100)], book);
  s = settings({ approved: { "h||": 50 } });
  await byHand(bare, s);
  assert.deepEqual(m.sent, [{ id: "h", platinum: 40 }], "by hand: sent");
});

test("a timed pass sends a price of exactly half", async () => {
  const items = [item("e")];
  const m = standIn(items, [listing("e", "e", 100)], { slug_e: sellers([50, 50, 50]) });
  const s = settings({ approved: { "e||": 50 } });
  // The market's target is exactly half, not one under it.
  await mkt.reprice(bare, s, false);
  assert.equal(mkt.planFor(bare, s, mkt.orders[0])?.target, 50);
  mkt.books = {};
  await mkt.reprice(bare, s, true, true);
  assert.deepEqual(m.sent, [{ id: "e", platinum: 50 }]);
});

// ------------------------------------------------------------------ a relic's crack value

const inv = (item_id: string, name: string, category: string, quantity: number): InventoryRow => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
/** A relic whose radiant crack is 10% of a 100p part: 10p alone, 1 − 0.9⁴ of 100p (34.4p) in a squad of four. */
const relicModel = () =>
  buildModel({
    observed_at: 1_700_000_000,
    inventory: [inv("/Example/RelicRadiant", "Lith Z9 Radiant", "relic", 1)],
    catalog: [{ uniqueName: "/Example/Frame", name: "Example Prime", category: "Warframes", masterable: true, isPrime: true, components: [{ uniqueName: "/Example/Systems", name: "Systems", ducats: 45, itemCount: 1 }] }],
    relics: [
      { uniqueName: "/Example/RelicIntact", name: "Lith Z9 Intact", vaulted: false, rewards: [{ name: "Example Prime Systems Blueprint", rarity: "Rare", chance: 2 }, { name: "1200X Kuva", rarity: "Common", chance: 98 }] },
      { uniqueName: "/Example/RelicRadiant", name: "Lith Z9 Radiant", vaulted: false, rewards: [{ name: "Example Prime Systems Blueprint", rarity: "Rare", chance: 10 }, { name: "1200X Kuva", rarity: "Common", chance: 90 }] },
    ],
    prices: { prices: { "Example Prime Systems Blueprint": 100 } },
  } as unknown as Bundle);
const RELIC = item("z9", "Lith Z9 Relic", { subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic"] });
const OTHER = item("ot", "Example Other Thing");

test("a relic is never repriced under its crack value, alone or in a squad of four; something else isn't held by it", async () => {
  const model = relicModel();
  const sent = async (squad: number, timed: boolean, price: number) => {
    mkt.items = [];
    mkt.books = {};
    mkt.advice = { platPerDucat: 0, minPlat: 0, slowBelow: 1, squad };
    const m = standIn([RELIC, OTHER], [listing("r", "z9", price, "radiant"), listing("o", "ot", price)], { slug_z9: sellers([5, 5, 6], "radiant"), slug_ot: sellers([5, 5, 6]) });
    const s = settings({ approved: { "z9||radiant": price, "ot||": price } });
    if (timed) await mkt.reprice(model, s, true, true);
    else await byHand(model, s);
    return Object.fromEntries(m.sent.map((x) => [x.id, x.platinum]));
  };
  // By hand nothing else holds it: the relic stops just above its 10p crack, the other goes to 5p.
  assert.deepEqual(await sent(1, false, 40), { r: 11, o: 5 });
  // Cracked in a squad of four, a crack is worth 34.4p: the relic stays above that.
  assert.deepEqual(await sent(4, false, 40), { r: 35, o: 5 });
  // On the timer, from 14p (70% of it is 10p): the crack, not the 70% line, is where it stops.
  assert.deepEqual(await sent(1, true, 14), { r: 11, o: 10 });
});
