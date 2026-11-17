// Sell spares: only a price the plan changes becomes the approved price (core/approved.ts). A
// line that keeps the listing's price (fewer copies, the same price) leaves the approval where it
// was, so a price the timer lowered never becomes the one approved. Every market call is replaced.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { market, defaultAdvice, defaultMarketSettings } from "../src/lib/backend";
import { buildModel } from "../src/lib/core/model";
import { bulkPlan, sellTargets } from "../src/lib/core/bulk";
import type { BookOrder, MarketItem, MyOrder } from "../src/lib/core/market";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");

const row = (item_id: string, name: string, category: string, quantity: number, mastered = false) => ({ item_id, name, category, quantity, mastered, image_name: null, rank: null, max_rank: null });
// 4 Serration held, 2 kept: 2 spare.
const m = buildModel({
  observed_at: Math.floor(Date.now() / 1000) - 60,
  inventory: [row("/M/Serration", "Serration", "mod", 4), row("/W/Braton", "Braton", "weapon", 1, true)],
  catalog: [{ uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10 }, { uniqueName: "/W/Braton", name: "Braton", category: "Primary", masterable: true }],
  relics: [],
  prices: { prices: { Serration: 70 }, trade_rate: { Serration: [5, 0, ""] } },
} as never);
const serration: MarketItem = { id: "ser", slug: "serration", gameRef: "/M/Serration", name: "Serration", maxRank: 10, subtypes: null, tags: ["mod"] };
const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true };
const seller = (platinum: number): BookOrder => ({ id: `b${platinum}`, type: "sell", platinum, quantity: 1, rank: 0, subtype: null, visible: true, user: { id: `u${platinum}`, ingameName: "Seller1", status: "ingame", platform: "pc", crossplay: true } });

async function apply(listing: MyOrder, book: BookOrder[], approved: Record<string, number>) {
  const s = { ...defaultMarketSettings(), minPrice: 1, minByCategory: {}, approved } as ReturnType<typeof defaultMarketSettings>;
  s.spares = { ...s.spares, mods: { ...s.spares.mods, dailyOnly: false } } as never;
  const advice = defaultAdvice();
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null } as never;
  mkt.items = [serration];
  mkt.rules = s;
  mkt.advice = advice;
  mkt.model = m;
  mkt.orders = [listing];
  mkt.log = [];
  let now = listing;
  const sent: unknown[] = [];
  market.myOrders = async () => [now];
  market.update = (async (id: string, c: { quantity: number; platinum: number }) => {
    sent.push([id, c]);
    now = { ...now, ...c };
  }) as never;
  market.create = (async (o: unknown) => {
    sent.push(["create", o]);
    return {} as never;
  }) as never;
  market.remove = (async (id: string) => {
    sent.push(["remove", id]);
  }) as never;
  const books = { serration: book };
  const actions = bulkPlan({ model: m, index: mkt.index, orders: [listing], me, books, minPrice: s.minPrice, minByCategory: s.minByCategory, minShare: s.minShare, floors: s.floors, paused: s.paused, otherOrders: 0, sell: s.sellable, advice }, s.spares, sellTargets(m, s.spares, advice, mkt.index, s.sellable));
  mkt.bulk = { actions, at: Date.now(), books, skipped: new Set() } as never;
  await mkt.applyBulk(m, s, advice);
  return { sent, s, plan: actions.map((a) => [a.type, (a as { quantity?: number }).quantity, (a as { platinum?: number }).platinum]) };
}

test("applying '3 → 2 at 70p' (the price kept) leaves the approved 100p as it was", async () => {
  // The listing offers 3 at 70p: a timed pass took it there from an approved 100p.
  const listing: MyOrder = { id: "L", itemId: "ser", type: "sell", platinum: 70, quantity: 3, rank: 0, subtype: null, visible: true, updatedAt: null };
  const r = await apply(listing, [seller(70)], { "ser|0|": 100 });
  assert.deepEqual({ sent: r.sent, approved: r.s.approved }, { sent: [["L", { quantity: 2, platinum: 70 }]], approved: { "ser|0|": 100 } }, `plan: ${JSON.stringify(r.plan)}; log: ${mkt.log.map((l) => l.text).join(" / ")}`);
});

test("a line that changes the price approves the new one", async () => {
  const listing: MyOrder = { id: "L", itemId: "ser", type: "sell", platinum: 90, quantity: 3, rank: 0, subtype: null, visible: true, updatedAt: null };
  const r = await apply(listing, [seller(60)], { "ser|0|": 100 });
  assert.deepEqual({ sent: r.sent, approved: r.s.approved }, { sent: [["L", { quantity: 2, platinum: 60 }]], approved: { "ser|0|": 60 } }, `plan: ${JSON.stringify(r.plan)}`);
});
