import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { dealFromOrder, findDeals, type Watch } from "../src/lib/core/deals";
import { indexItems, type BookOrder } from "../src/lib/core/market";
import type { Bundle } from "../src/lib/core/types";

const me = { id: "me", platform: "pc", crossplay: true };
let n = 0;
const sell = (platinum: number, status = "ingame"): BookOrder => ({
  id: `o${n++}`, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true,
  user: { id: `u${n}`, ingameName: `Seller${n}`, status, platform: "pc", crossplay: true } as BookOrder["user"],
});
const bundle: Bundle = { observed_at: 1, inventory: [], catalog: [], relics: [], prices: { prices: { "Mesa Prime Neuroptics": 40, "Lex Prime Barrel": 5 }, max_rank_prices: {} } };
const index = indexItems([
  { id: "a", slug: "mesa_prime_neuroptics", gameRef: null, name: "Mesa Prime Neuroptics", maxRank: null, subtypes: null, tags: null },
  { id: "b", slug: "lex_prime_barrel", gameRef: null, name: "Lex Prime Barrel", maxRank: null, subtypes: null, tags: null },
]);
const watch: Watch[] = [
  { name: "Mesa Prime Neuroptics", kind: "part", rank: null, why: "the last part of Mesa Prime" },
  { name: "Lex Prime Barrel", kind: "part", rank: null, why: "a missing part of Lex Prime" },
];

test("a deal is an in-game seller at 60% of the usual price or less, with the whisper ready", () => {
  const m = buildModel(bundle);
  const deals = findDeals(m, index, { mesa_prime_neuroptics: [sell(20, "offline"), sell(22), sell(35)], lex_prime_barrel: [sell(1)] }, watch, me);
  assert.equal(deals.length, 1, "the Lex barrel's usual price is too low to bother");
  const [d] = deals;
  assert.deepEqual([d.price, d.usual, d.why], [22, 40, "the last part of Mesa Prime"], "offline sellers don't count");
  assert.equal(d.whisper, `/w ${d.seller} Hi! I want to buy: "Mesa Prime Neuroptics" for 22 platinum. (warframe.market)`);
});

test("no deal when the cheapest in-game seller is near the usual price", () => {
  const m = buildModel(bundle);
  assert.equal(findDeals(m, index, { mesa_prime_neuroptics: [sell(30)] }, watch, me).length, 0);
});

test("a new listing from the live feed is a deal by the same rule, the moment it goes up", () => {
  const m = buildModel(bundle);
  const byslug = new Map(watch.map((w) => [w.name.toLowerCase().replace(/ /g, "_"), w]));
  const order = (platinum: number, itemId = "a", seller = "Cheapo") => ({ id: "n1", type: "sell", platinum, itemId, user: { id: "u9", ingameName: seller, status: "ingame" } });
  const d = dealFromOrder(m, index, order(20), byslug, me)!;
  assert.deepEqual([d.name, d.price, d.usual, d.seller], ["Mesa Prime Neuroptics", 20, 40, "Cheapo"]);
  assert.equal(dealFromOrder(m, index, order(30), byslug, me), null, "75% of usual isn't a deal");
  assert.equal(dealFromOrder(m, index, order(1, "b"), byslug, me), null, "too cheap an item to bother");
  assert.equal(dealFromOrder(m, index, order(20, "zz"), byslug, me), null, "an item nobody watches");
  assert.equal(dealFromOrder(m, index, { ...order(20), user: { id: "me", ingameName: "Me", status: "ingame" } }, byslug, me), null, "your own listing");
});

test("a price alert is news at or under your price, whatever the usual price says", async () => {
  const { alertWatches, watchlist } = await import("../src/lib/core/deals");
  const m = buildModel(bundle);
  const alerts = [{ name: "Mesa Prime Neuroptics", rank: null, maxPrice: 34, at: 1 }, { name: "Lex Prime Barrel", rank: null, maxPrice: 2, at: 1 }];
  const mine = alertWatches(alerts);
  // 35p is 88% of the usual 40p: no deal by the 60% rule, but under an alert at 36p it would be.
  assert.equal(findDeals(m, index, { mesa_prime_neuroptics: [sell(35)] }, mine, me).length, 0, "over your price");
  const d = findDeals(m, index, { mesa_prime_neuroptics: [sell(33)], lex_prime_barrel: [sell(1)] }, mine, me);
  assert.deepEqual(d.map((x) => [x.name, x.price]).sort(), [["Lex Prime Barrel", 1], ["Mesa Prime Neuroptics", 33]], "a 5p item counts when you asked for it");
  // Alerts go first in the watchlist and don't count against its limit.
  assert.deepEqual(watchlist(m, 0, alerts).map((w) => w.kind), ["alert", "alert"]);
});

test("the live feed offers only sellers you can trade with, as the order-book scan does", () => {
  const m = buildModel(bundle);
  const byslug = new Map(watch.map((w) => [w.name.toLowerCase().replace(/ /g, "_"), w]));
  const order = (platform: string, crossplay: boolean) => ({ id: "n2", type: "sell", platinum: 20, itemId: "a", user: { id: "u8", ingameName: "Faraway", status: "ingame", platform, crossplay } });
  const noCross = { ...me, crossplay: false };
  assert.equal(dealFromOrder(m, index, order("xbox", true), byslug, noCross), null, "crossplay off: another platform's seller can't trade with you");
  assert.equal(dealFromOrder(m, index, order("switch", true), byslug, me), null, "Switch doesn't cross-trade");
  assert.ok(dealFromOrder(m, index, order("xbox", true), byslug, me), "both on crossplay");
  assert.ok(dealFromOrder(m, index, order("pc", false), byslug, noCross), "same platform");
  // The scan says the same of the same sellers.
  const book = (platform: string, crossplay: boolean) => [{ ...sell(20), user: { id: "u7", ingameName: "Faraway", status: "ingame", platform, crossplay } as BookOrder["user"] }];
  assert.equal(findDeals(m, index, { mesa_prime_neuroptics: book("xbox", true) }, watch, noCross).length, 0);
  assert.equal(findDeals(m, index, { mesa_prime_neuroptics: book("xbox", true) }, watch, me).length, 1);
});
