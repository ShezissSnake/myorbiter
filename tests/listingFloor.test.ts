// A listing's own floor, read one way everywhere (core/market.ts › ownFloor): the repricing pass,
// Orders' floor field, Sell spares and the listing form. A floor saved on a relic listing that had
// no variant (warframe.market can leave an intact relic's unnamed) is still seen once the listing
// reads "intact". The listing form's "your floor" is the floor the pass uses, asked of the store,
// with a relic's crack value and the market value held to the asks. Every market call is replaced.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { h, mkt, order, seller, settings, timedPass, logText, noPrices } from "./support/pass";
import { buildModel, type Model } from "../src/lib/core/model";
import * as core from "../src/lib/core/market";
import { listingKey, type MarketItem } from "../src/lib/core/market";
import type { Draft } from "../src/lib/marketStore.svelte";

const relic: MarketItem = { id: "r", slug: "axi_a1_relic", gameRef: "/R/AxiA1", name: "Axi A1 Relic", maxRank: null, subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic"] };
afterEach(() => {
  delete (mkt as { crackFloor?: unknown }).crackFloor;
});

const empty = buildModel({ observed_at: 1, inventory: [], catalog: [], relics: [], prices: { prices: {}, max_rank_prices: {} } } as unknown as Parameters<typeof buildModel>[0]);

test("a 50p floor typed on the listing when it had no variant holds after it reads 'intact'", async () => {
  h.it = relic;
  // Orders' floor field keys the floor by the listing as warframe.market gave it then.
  const floorKey = listingKey(order(60, "a", { itemId: "r", subtype: null }));
  h.mine = [order(60, "a", { itemId: "r", subtype: "intact" })];
  h.book = [seller(20, "intact"), seller(20, "intact")];
  await timedPass(settings({ "r||intact": 60 }, { floors: { [floorKey]: 50 } }), empty);
  assert.deepEqual({ floorKey, sent: h.sent }, { floorKey: "r||", sent: [["a", 50]] }, logText());
});

test("the floor field shows the floor in force, and a change to it is the listing's own", () => {
  const { ownFloor, withOwnFloor } = core;
  const intact = order(60, "a", { itemId: "r", subtype: "intact" });
  assert.equal(ownFloor({ "r||": 50 }, intact, "intact"), 50, "saved with no variant, read as intact");
  assert.equal(ownFloor({ "r||intact": 40 }, order(60, "a", { itemId: "r", subtype: null }), "intact"), 40, "and the other way round");
  assert.equal(ownFloor({ "r||": 50, "r||intact": 45 }, intact, "intact"), 45, "the listing's own key first");
  assert.equal(ownFloor({}, intact, "intact"), null);
  // Typed on the intact listing: saved under its own key; the old key of the same listing goes.
  assert.deepEqual(withOwnFloor({ "r||": 50, "x||": 7 }, intact, "intact", 55), { "r||intact": 55, "x||": 7 });
  // Cleared: no floor of its own is left under either key.
  assert.deepEqual(withOwnFloor({ "r||": 50, "x||": 7 }, intact, "intact", null), { "x||": 7 });
  // A radiant listing's floor is its own: clearing it leaves the intact one's.
  assert.deepEqual(withOwnFloor({ "r||": 50, "r||radiant": 9 }, order(60, "b", { itemId: "r", subtype: "radiant" }), "intact", null), { "r||": 50 });
});

/** A relic whose daily price is 20p and which sellers ask 25p for; a crack of it is worth 31p to the player. */
function relicSetup(): { m: Model; d: Draft } {
  h.it = relic;
  mkt.items = [relic];
  mkt.books = { [relic.slug]: { at: Date.now(), orders: [seller(25, "intact"), seller(25, "intact"), seller(26, "intact")] } };
  mkt.crackFloor = () => 31;
  const m = { ...noPrices, relicPrice: () => 20 } as unknown as Model;
  const d: Draft = { itemId: "r", name: relic.name, slug: relic.slug, platinum: 20, quantity: 1, rank: null, subtype: "intact", maxRank: null, subtypes: relic.subtypes, available: 1, priced: true, inGame: 3, ladder: [], addToExisting: true, held: [], asked: { rank: null, subtype: "intact", available: 1 } };
  return { m, d };
}

test("the listing form's floor is the plan's: a relic whose crack value is above the median's share", () => {
  const { m, d } = relicSetup();
  const s = settings({}, { minShare: 0.5 });
  const plan = mkt.planFor(m, s, order(20, "", { itemId: "r", subtype: "intact" }));
  assert.equal(plan?.floor, 31);
  assert.equal(mkt.formFloor(m, s, d), plan?.floor);
});

test("the listing form's floor is the plan's for an existing listing with its own floor, and with a share of the market over the crack", () => {
  const { m, d } = relicSetup();
  mkt.crackFloor = () => 5;
  // Sellers ask 15p: the market value is held to that, under the 20p daily price.
  mkt.books = { [relic.slug]: { at: Date.now(), orders: [seller(15, "intact"), seller(15, "intact"), seller(16, "intact")] } };
  mkt.orders = [order(40, "x", { itemId: "r", subtype: null })];
  const s = settings({}, { minShare: 0.85, floors: { "r||": 12 } });
  const plan = mkt.planFor(m, s, mkt.orders[0]);
  assert.equal(mkt.formFloor(m, s, d), plan?.floor);
  mkt.orders = [];
});

test("the listing form has no floor rule of its own: it asks the store", () => {
  const src = readFileSync("src/lib/ui/ListDialog.svelte", "utf8");
  assert.match(src, /mkt\.formFloor\(/);
  assert.doesNotMatch(src, /Math\.max\(1, minimum/);
});
