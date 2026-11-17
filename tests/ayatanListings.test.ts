// A filled Ayatan sculpture is a listing of its own, apart from an empty one of the same kind:
// its own key, floor, approved price and pause. A key gains the stars only when there are any,
// so every key saved before reads as it did; a floor, approval or pause saved under the old key
// keeps applying to a filled listing of that item until the player sets one for it.
// MyOrbiter itself lists only empty sculptures. Every market call is replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { h, mkt, me, order, seller, settings, timedPass, logText } from "./support/pass";
import { listingKey, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { bulkPlan, type SellTarget } from "../src/lib/core/bulk";
import { buildModel, type Model } from "../src/lib/core/model";
import { market, defaultAdvice, defaultMarketSettings } from "../src/lib/backend";
import { approvedOf } from "../src/lib/core/approved";
import type { Draft } from "../src/lib/marketStore.svelte";

const ayatan: MarketItem = { id: "ay", slug: "anasa_ayatan_sculpture", gameRef: "/Ayatan/Anasa", name: "Anasa Ayatan Sculpture", maxRank: null, subtypes: null, tags: ["ayatan_sculpture"] };
// A filled sculpture listed by the player on the website: 2 amber and 2 cyan stars in, 60p.
const filled: MyOrder = { id: "full", itemId: "ay", type: "sell", platinum: 60, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null, amberStars: 2, cyanStars: 2 };
const empty: MyOrder = { ...filled, id: "bare", platinum: 12, amberStars: 0, cyanStars: 0 };
const draft = (extra: Partial<Draft> = {}): Draft => ({ itemId: "ay", name: ayatan.name, slug: ayatan.slug, platinum: 12, quantity: 1, rank: null, subtype: null, maxRank: null, subtypes: null, available: 1, priced: true, inGame: 0, ladder: [], addToExisting: true, held: [], asked: { rank: null, subtype: null, available: 1 }, ...extra });

test("keys: a filled sculpture's listing key differs from an empty one's; every other key reads exactly as before", () => {
  assert.notEqual(listingKey(filled), listingKey(empty));
  assert.equal(listingKey(empty), "ay||", "an empty sculpture: as before");
  assert.equal(listingKey({ itemId: "ay", rank: null, subtype: null }), "ay||", "no stars named: as before");
  assert.equal(listingKey({ itemId: "ser", rank: 3, subtype: null }), "ser|3|");
  assert.equal(listingKey({ itemId: "r", rank: null, subtype: "radiant" }), "r||radiant");
  assert.equal(listingKey({ itemId: "ay", rank: null, subtype: null, amberStars: 1, cyanStars: 0 }), "ay|||1|0");
});

test("approvals: the store's approval key differs too", () => {
  mkt.items = [ayatan];
  assert.notEqual(mkt.approvalKey(filled), mkt.approvalKey(empty));
  assert.equal(mkt.approvalKey(empty), "ay||");
});

test("existingFor: an empty sculpture's draft is not the filled listing", () => {
  mkt.items = [ayatan];
  mkt.orders = [filled];
  assert.equal(mkt.existingFor(draft())?.id ?? null, null);
  mkt.orders = [filled, empty];
  assert.equal(mkt.existingFor(draft())?.id ?? null, "bare");
});

test("listing an empty sculpture (the form's default) never reprices the filled listing", async () => {
  const sent: unknown[] = [];
  market.update = (async (id: string, c: unknown) => {
    sent.push([id, c]);
  }) as never;
  market.create = (async (o: unknown) => {
    sent.push(["create", o]);
    return {} as never;
  }) as never;
  market.myOrders = async () => [filled];
  mkt.items = [ayatan];
  mkt.model = { observedAt: null, inventoryByBase: new Map() } as unknown as Model; // a console: no inventory read
  mkt.orders = [filled];
  mkt.draft = draft();
  await mkt.submitDraft();
  assert.deepEqual(sent.filter((s) => (s as [string])[0] === "full"), [], `sent: ${JSON.stringify(sent)}`);
  assert.equal(sent.filter((s) => (s as [string])[0] === "create").length, 1, "the empty one is listed on its own");
});

test("Sell spares never takes a filled listing for the empty sculptures it sells", () => {
  const row = (item_id: string, name: string, category: string, quantity: number) => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
  const m = buildModel({
    observed_at: Math.floor(Date.now() / 1000) - 60,
    inventory: [row("/Ayatan/Anasa", "Anasa Ayatan Sculpture", "misc", 3)],
    catalog: [{ uniqueName: "/Ayatan/Anasa", name: "Anasa Ayatan Sculpture", category: "Misc" }],
    relics: [],
    prices: { prices: { "Anasa Ayatan Sculpture": 12 }, trade_rate: { "Anasa Ayatan Sculpture": [5, 0, ""] } },
  } as never);
  const s = defaultMarketSettings();
  const index = { byId: new Map([["ay", ayatan]]), byGameRef: new Map([["/Ayatan/Anasa", ayatan]]), byName: new Map([[ayatan.name.toLowerCase(), ayatan]]) };
  const books = { [ayatan.slug]: [seller(12), seller(12), seller(13)] };
  // Two empty sculptures to sell, as Sell spares' resources row would ask.
  const targets: SellTarget[] = [{ kind: "other", name: ayatan.name, unique: "/Ayatan/Anasa", rank: null, quantity: 2, why: "spare", cat: "resources", family: "ayatan" }];
  const actions = bulkPlan({ model: m, index, orders: [filled], me, books, minPrice: 1, minByCategory: {}, minShare: 0, floors: {}, paused: {}, otherOrders: 0, sell: s.sellable, advice: defaultAdvice() }, s.spares, targets);
  const touched = actions.filter((a) => (a.type === "update" || a.type === "remove") && a.order.id === "full");
  assert.deepEqual(touched, [], JSON.stringify(actions.map((a) => [a.type, (a as { order?: MyOrder }).order?.id, (a as { quantity?: number }).quantity, (a as { platinum?: number }).platinum])));
  assert.ok(actions.some((a) => a.type === "create"), "the empty ones are a listing of their own");
});

test("a floor saved under the old key keeps applying to the filled listing until the player sets one for it", async () => {
  h.it = ayatan;
  h.mine = [{ ...filled }];
  h.book = [{ ...seller(20), amberStars: 2, cyanStars: 2 }, { ...seller(20), amberStars: 2, cyanStars: 2 }];
  const s = settings({}, { floors: { "ay||": 50 } });
  await timedPass(s);
  assert.deepEqual(h.sent, [["full", 50]], logText());
  // Its own floor, once set, is the one that counts.
  h.mine = [{ ...filled }];
  h.sent = [];
  h.now += 3 * 3_600_000;
  s.floors = { ...s.floors, [listingKey(filled)]: 45 };
  s.approved = {};
  s.changes = {};
  (s as { approvedFor?: unknown }).approvedFor = {};
  await timedPass(s);
  assert.deepEqual(h.sent, [["full", 45]], logText());
});

test("a pause saved under the old key keeps applying to the filled listing", async () => {
  h.it = ayatan;
  h.mine = [{ ...filled }];
  h.book = [{ ...seller(20), amberStars: 2, cyanStars: 2 }, { ...seller(20), amberStars: 2, cyanStars: 2 }];
  await timedPass(settings({}, { paused: { "ay||": true } }));
  assert.deepEqual(h.sent, []);
});

test("an approval saved under the old key goes to the filled listing too at the first start, and is kept", async () => {
  h.it = ayatan;
  h.mine = [{ ...filled }];
  h.book = [{ ...seller(20), amberStars: 2, cyanStars: 2 }, { ...seller(20), amberStars: 2, cyanStars: 2 }];
  const s = settings({ "ay||": 80 });
  await timedPass(s);
  assert.deepEqual(h.sent, [["full", 56]], `held at 70% of 80p: ${logText()}`);
});

test("a filled sculpture that takes the old key's approval leaves that price where an older build reads it while it is up", async () => {
  h.it = ayatan;
  h.mine = [{ ...filled }];
  const s = settings({ "ay||": 80 });
  mkt.items = [ayatan];
  // The first read after the update, then a few more.
  await mkt.refresh(s);
  await mkt.refresh(s);
  assert.equal((s as { approvedFor?: Record<string, { platinum: number }> }).approvedFor?.full?.platinum, 80);
  // The per-item record as an older build reads it (its own reader, by the empty sculpture's key).
  const saved = JSON.parse(JSON.stringify(s));
  assert.equal(approvedOf(saved.approved)["ay||"], 80);
  // And after a pass lowered the filled listing.
  h.book = [{ ...seller(20), amberStars: 2, cyanStars: 2 }, { ...seller(20), amberStars: 2, cyanStars: 2 }];
  await timedPass(s);
  assert.deepEqual(h.sent, [["full", 56]], logText());
  h.mine = [{ ...filled, platinum: 56 }];
  await mkt.refresh(s);
  assert.equal(approvedOf(JSON.parse(JSON.stringify(s)).approved)["ay||"], 80);
});

test("an empty sculpture's approval never moves the filled one's 70% line", async () => {
  h.it = ayatan;
  h.mine = [{ ...filled }, { ...empty }];
  h.book = [{ ...seller(20), amberStars: 2, cyanStars: 2 }, { ...seller(20), amberStars: 2, cyanStars: 2 }, seller(12), seller(12)];
  const s = settings({});
  mkt.items = [ayatan];
  mkt.rules = s;
  await mkt.refresh(s);
  // The empty one approved at 10p by a typed price: the filled one's line stays 70% of its own 60p.
  await mkt.update(mkt.orders.find((o) => o.id === "bare")!, { platinum: 10 });
  h.sent = [];
  await timedPass(s);
  assert.deepEqual(h.sent.filter(([id]) => id === "full"), [["full", 42]], logText());
});
