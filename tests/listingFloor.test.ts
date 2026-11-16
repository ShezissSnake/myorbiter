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

test("a listing's floor is read under either key of it, and a change to it is the listing's own", () => {
  const { ownFloor, withOwnFloor } = core;
  const intact = order(60, "a", { itemId: "r", subtype: "intact" });
  assert.equal(ownFloor({ "r||": 50 }, intact, "intact"), 50, "saved with no variant, read as intact");
  assert.equal(ownFloor({ "r||intact": 40 }, order(60, "a", { itemId: "r", subtype: null }), "intact"), 40, "and the other way round");
  assert.equal(ownFloor({ "r||": 50, "r||intact": 45 }, intact, "intact"), 45, "the listing's own key first");
  assert.equal(ownFloor({}, intact, "intact"), null);
  // Typed on the intact listing: saved under its own key, and counting first for it; the one saved
  // with no variant stays, for the other refinements.
  assert.deepEqual(withOwnFloor({ "r||": 50, "x||": 7 }, intact, "intact", 55), { "r||": 50, "r||intact": 55, "x||": 7 });
  assert.equal(ownFloor(withOwnFloor({ "r||": 50 }, intact, "intact", 55), intact, "intact"), 55);
  // Typed on it while it named no variant: saved as intact, and read so once it does; the one with
  // no variant is raised to it for older builds, which read that listing's floor there, and still
  // counts as 50p here.
  const unnamed = order(60, "a", { itemId: "r", subtype: null });
  assert.deepEqual(withOwnFloor({ "r||": 50 }, unnamed, "intact", 55), { "r||": 55, "r||intact": 55, "r||#raised": 55, "r||#before": 50 });
  assert.equal(ownFloor(withOwnFloor({ "r||": 50 }, unnamed, "intact", 55), unnamed, "intact"), 55);
  // Cleared: its own floor goes; the one saved with no variant stays.
  assert.deepEqual(withOwnFloor({ "r||": 50, "r||intact": 55, "x||": 7 }, intact, "intact", null), { "r||": 50, "x||": 7 });
  // A radiant listing's floor is its own: clearing it leaves the intact one's.
  assert.deepEqual(withOwnFloor({ "r||": 50, "r||radiant": 9 }, order(60, "b", { itemId: "r", subtype: "radiant" }), "intact", null), { "r||": 50 });
});

test("the field shows only a floor clearing it takes away; one the listing falls back on still counts", () => {
  const { ownFloor, typedFloor, withOwnFloor } = core;
  const radiant = order(60, "b", { itemId: "r", subtype: "radiant" });
  assert.equal(typedFloor({ "r||": 50 }, radiant, "intact"), null, "saved with no variant: not the radiant listing's own");
  assert.equal(ownFloor({ "r||": 50 }, radiant, "intact"), 50, "yet the plan holds it");
  assert.equal(typedFloor({ "r||": 50 }, order(60, "a", { itemId: "r", subtype: "intact" }), "intact"), null, "the intact listing's too: every refinement falls back on it");
  assert.equal(typedFloor({ "r||intact": 45 }, order(60, "a", { itemId: "r", subtype: null }), "intact"), 45, "an unnamed listing is the intact one");
  const filled = order(60, "f", { itemId: "ay", subtype: null, amberStars: 2, cyanStars: 2 });
  assert.equal(typedFloor({ "ay||": 20 }, filled, null), null, "the empty sculpture's: not the filled one's");
  assert.equal(ownFloor({ "ay||": 20 }, filled, null), 20);
  // Typed, then cleared: the field is empty again, and the empty sculpture's floor stays.
  const typed = withOwnFloor({ "ay||": 20 }, filled, null, 45);
  assert.equal(typedFloor(typed, filled, null), 45);
  assert.equal(typedFloor(withOwnFloor(typed, filled, null, null), filled, null), null);
  assert.deepEqual(withOwnFloor(typed, filled, null, null), { "ay||": 20 });
});

test("typing or clearing the intact listing's Floor leaves the floor saved with no refinement, which the radiant one falls back on", async () => {
  const { ownFloor, withOwnFloor } = core;
  const intact = order(60, "a", { itemId: "r", subtype: "intact" });
  const radiant = order(60, "b", { itemId: "r", subtype: "radiant" });
  let floors: Record<string, number> = { "r||": 50 };
  floors = withOwnFloor(floors, intact, "intact", 55);
  assert.equal(ownFloor(floors, radiant, "intact"), 50, "typed on the intact row");
  floors = withOwnFloor(floors, intact, "intact", null);
  assert.equal(ownFloor(floors, radiant, "intact"), 50, "cleared on the intact row");
  floors = withOwnFloor(floors, order(60, "a", { itemId: "r", subtype: null }), "intact", null);
  assert.equal(ownFloor(floors, radiant, "intact"), 50, "cleared on the row while it named no refinement");
  // And a pass holds the radiant listing there.
  h.it = relic;
  h.mine = [radiant];
  h.book = [seller(20, "radiant"), seller(20, "radiant")];
  await timedPass(settings({ "r||radiant": 60 }, { floors }), empty);
  assert.deepEqual(h.sent, [["b", 50]], logText());
});

// A floor typed on a relic row warframe.market gives with no refinement: today's build reads that
// listing's floor under the key with no refinement only (listingKey), so it is written there too
// when the one there is lower or missing, and marked so that this build still counts what was
// there before for the other refinements. No floor saved before stops applying.
test("a floor typed on a relic row with no refinement is also where older builds read it, and every floor saved before still holds", async () => {
  const { ownFloor, typedFloor, withOwnFloor } = core;
  const unnamed = order(60, "u", { itemId: "r", subtype: null });
  const intact = order(60, "i", { itemId: "r", subtype: "intact" });
  const radiant = order(60, "d", { itemId: "r", subtype: "radiant" });
  /** The floor an older build holds the unnamed listing at: the one saved under its key as given. */
  const older = (f: Record<string, number>) => f[listingKey(unnamed)];
  for (const [label, before, olderAfter, radiantAfter] of [
    ["none saved before", {}, 45, null],
    ["a lower one saved before with no refinement", { "r||": 30 }, 45, 30],
    ["a higher one saved before with no refinement", { "r||": 60 }, 60, 60],
    ["the same one", { "r||": 45 }, 45, 45],
  ] as const) {
    const typed = withOwnFloor(before, unnamed, "intact", 45);
    assert.equal(older(typed), olderAfter, `${label}: older builds hold it at ${olderAfter}p`);
    assert.ok(older(typed)! >= 45, label);
    assert.equal(ownFloor(typed, unnamed, "intact"), 45, `${label}: this build reads 45p for it`);
    assert.equal(typedFloor(typed, unnamed, "intact"), 45, `${label}: and its field shows 45p`);
    assert.equal(ownFloor(typed, radiant, "intact"), radiantAfter, `${label}: the radiant listing falls back on what was there before`);
    assert.equal(ownFloor(typed, intact, "intact"), 45, `${label}: the same listing read as intact`);
    // Typed again, then cleared: back to what was saved before, marks and all.
    assert.deepEqual(withOwnFloor(withOwnFloor(typed, unnamed, "intact", 50), unnamed, "intact", null), before, `${label}: cleared`);
    assert.deepEqual(withOwnFloor(typed, intact, "intact", null), before, `${label}: cleared on the row read as intact`);
  }
  // An older build changed the floor with no refinement since: that one is kept, and counts here.
  const changed = { ...withOwnFloor({ "r||": 30 }, unnamed, "intact", 45), "r||": 40 };
  assert.equal(ownFloor(changed, radiant, "intact"), 40);
  assert.deepEqual(withOwnFloor(changed, unnamed, "intact", null), { "r||": 40 });
  // Typed on the row read as intact: nothing written with no refinement (that row has its own key in every build).
  assert.deepEqual(withOwnFloor({ "r||": 30 }, intact, "intact", 45), { "r||": 30, "r||intact": 45 });
  // The intact row typed 55 and cleared with 50 saved with no refinement: 50 stays, the radiant one still 50.
  const typedIntact = withOwnFloor({ "r||": 50 }, intact, "intact", 55);
  assert.equal(ownFloor(typedIntact, radiant, "intact"), 50);
  assert.deepEqual(withOwnFloor(typedIntact, intact, "intact", null), { "r||": 50 });
  // A pass on this build: the unnamed listing at 45p, the radiant one at the 30p from before.
  h.it = relic;
  const floors = withOwnFloor({ "r||": 30 }, unnamed, "intact", 45);
  h.mine = [unnamed];
  h.book = [seller(20, null), seller(20, null)];
  await timedPass(settings({ "r||intact": 60 }, { floors }), empty);
  assert.deepEqual(h.sent, [["u", 45]], logText());
  h.mine = [radiant];
  h.book = [seller(20, "radiant"), seller(20, "radiant")];
  h.sent = [];
  // Approved at 40p, so the 70% mark (28p) is under it.
  await timedPass(settings({ "r||radiant": 40 }, { floors }), empty);
  assert.deepEqual(h.sent, [["d", 30]], logText());
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

test("the listing form, Orders and Settings say a lift goes to at least the floor, and name every floor that lifts", () => {
  const form = readFileSync("src/lib/ui/ListDialog.svelte", "utf8");
  assert.match(form, /raises it to at least \$\{floor\}p by itself/);
  const orders = readFileSync("src/lib/tabs/Orders.svelte", "utf8");
  assert.match(orders, /its own floor \(in its row\), a relic's crack value, a Prime part's or set's ducats, or Never under is lifted to at least that at once, waiting for neither limit/);
  const sheet = readFileSync("src/lib/SettingsSheet.svelte", "utf8");
  assert.match(sheet, /under its own floor, a relic's crack value, a Prime part's or set's ducats, or your minimum: it is lifted to at least that at once/);
});
