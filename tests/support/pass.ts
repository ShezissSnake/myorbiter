// A repricing pass on the timer with warframe.market stood in for: the player's listings as the
// stand-in holds them (each update applied), the order book every item reads, and every price
// sent, in order. Not a test file itself; a test imports `mkt` from here. Nothing reaches the
// network: fetch throws, and every market call a pass makes is replaced.
import "./runes";
import { beforeEach, afterEach } from "node:test";
import { market, defaultMarketSettings, type MarketSettings } from "../../src/lib/backend";
import type { BookOrder, MarketItem, MyOrder } from "../../src/lib/core/market";
import type { Model } from "../../src/lib/core/model";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
export const { mkt } = await import("../../src/lib/marketStore.svelte");

export const T0 = Date.parse("2026-11-08T12:00:00Z");
export const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true };
const plainItem: MarketItem = { id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] };
export const h = {
  it: plainItem,
  now: T0,
  mine: [] as MyOrder[],
  book: [] as BookOrder[],
  sent: [] as [string, number][],
  /** Set to make the next read of the player's listings fail. */
  readFails: false,
};
/** A model that knows no prices: only the listing's own rules count. */
export const noPrices = { price: () => null, priceMax: () => null, relicPrice: () => null, partByName: new Map() } as unknown as Model;
export const order = (platinum: number, id = "a", extra: Partial<MyOrder> = {}): MyOrder => ({ id, itemId: h.it.id, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null, ...extra });
let n = 0;
export const seller = (platinum: number, subtype: string | null = null): BookOrder => ({ id: `o${++n}`, type: "sell", platinum, quantity: 1, rank: null, subtype, visible: true, user: { id: `u${++n}`, ingameName: `S${n}`, status: "ingame", platform: "pc", crossplay: true } });
const real = { ...market };
const realNow = Date.now;

beforeEach(() => {
  Object.assign(market, real);
  h.it = plainItem;
  h.now = T0;
  h.mine = [];
  h.book = [];
  h.sent = [];
  h.readFails = false;
  Date.now = () => h.now;
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null } as never;
  mkt.items = [];
  mkt.orders = [];
  mkt.ordersAt = null;
  mkt.passFailures = 0;
  mkt.lastPass = null;
  mkt.log = [];
  mkt.op = null;
  mkt.pass = null;
  mkt.advice = null;
  mkt.rules = null;
  mkt.error = null;
  mkt.madeHere.clear();
  (mkt as unknown as { floorRefused: Map<string, number>; floorTold: Set<string> }).floorRefused.clear();
  (mkt as unknown as { floorRefused: Map<string, number>; floorTold: Set<string> }).floorTold.clear();
  mkt.model = null;
  mkt.draft = null;
  market.items = async () => [h.it];
  market.myOrders = async () => {
    if (h.readFails) throw new Error("503 Service Unavailable");
    return h.mine.map((o) => ({ ...o }));
  };
  market.book = async () => structuredClone(h.book) as never;
  market.update = (async (id: string, c: { platinum?: number }) => {
    h.sent.push([id, c.platinum!]);
    h.mine = h.mine.map((o) => (o.id === id ? { ...o, platinum: c.platinum! } : o));
  }) as never;
});
afterEach(() => {
  Date.now = realNow;
  Object.assign(market, real);
});

/** The signed-in account and platform of a read in these tests (core/approved.ts › whoseRead). */
export const ME = "me|pc";
/**
 * Settings for a timed pass: Apply automatically on, no share floor, a 1p minimum. Approvals given
 * per listing are this account's (ME) unless they say whose.
 */
export const settings = (approved: Record<string, number>, extra: Partial<MarketSettings> & Record<string, unknown> = {}): MarketSettings => {
  const s = { ...defaultMarketSettings(), auto: true, autoCheck: true, minShare: 0, minPrice: 1, approved, ...extra } as MarketSettings & { approvedFor?: Record<string, { by?: string }> };
  if (s.approvedFor) s.approvedFor = Object.fromEntries(Object.entries(s.approvedFor).map(([id, e]) => [id, { by: ME, ...e }]));
  return s;
};
/** Signed in to the account `id` (the test's own is "me"), as the next read sees it. */
export const asAccount = (id: string) => {
  mkt.account = { linked: true, backing: "keyring", profile: { ...me, id }, error: null } as never;
};
/** One pass on the timer, with Apply automatically, from fresh order books. */
export async function timedPass(s: MarketSettings, m: Model = noPrices) {
  mkt.books = {};
  await mkt.reprice(m, s, true, true);
}
/** What the Activity log says, newest first, joined. */
export const logText = () => mkt.log.map((l) => l.text).join(" / ");
