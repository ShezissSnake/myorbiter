// An approved price belongs to one listing (core/approved.ts): when that listing is sold out,
// deleted or replaced, the approval ends, and a new listing's own price is its approved price.
// "Gone" is known only from a read of the player's listings that succeeded; a failed read or a
// hidden listing ends nothing, and no approval ends in a way that lowers a 70% line by itself.
// A listing is told from the next by warframe.market's own order id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { h, mkt, order, seller, settings, timedPass, logText } from "./support/pass";
import { approvedOf } from "../src/lib/core/approved";
import { market, type MarketSettings } from "../src/lib/backend";
import type { Model } from "../src/lib/core/model";
import type { Draft } from "../src/lib/marketStore.svelte";

type Owned = Record<string, { key: string; platinum: number }>;
const owned = (s: MarketSettings) => (s as MarketSettings & { approvedFor?: Owned }).approvedFor ?? {};

test("an old 20p approval of a listing since made again on the website at 100p: a timed pass toward a 60p market stops at 70p", async () => {
  // The 20p was approved for listing "old"; the listing up now is "a", made again at 100p.
  h.mine = [order(100, "a")];
  h.book = [seller(60), seller(60)];
  const s = settings({ "it||": 20 }, { approvedFor: { old: { key: "it||", platinum: 20 } } });
  await timedPass(s);
  assert.deepEqual(h.sent, [["a", 70]], logText());
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 100 } }, "the new listing's own price is its approved price");
  assert.equal(s.approved["it||"], 100, "and the price an older build reads for it");
});

test("first start after the update: an approval saved without its listing goes to the listing now up for it, and is kept", async () => {
  h.mine = [order(100, "a")];
  h.book = [seller(60), seller(60)];
  const s = settings({ "it||": 20 });
  await timedPass(s);
  assert.deepEqual(s.approved, { "it||": 20 }, "nothing is dropped");
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 20 } });
  assert.deepEqual(h.sent, [["a", 60]], "the saved 20p still holds for the listing up now");
});

test("first start after the update: an approval whose listing is not up ends, the others are kept", async () => {
  h.mine = [order(50, "a"), order(30, "b")];
  const s = settings({ "it||": 40, "gone||": 30, "r||intact": 9 });
  mkt.items = [h.it];
  await mkt.refresh(s);
  assert.deepEqual(s.approved, { "it||": 40 });
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 40 }, b: { key: "it||", platinum: 40 } }, "two listings of one thing both had it");
});

test("a read of the listings that failed ends no approval", async () => {
  h.readFails = true;
  const s = settings({ "it||": 40 }, { approvedFor: { a: { key: "it||", platinum: 40 } } });
  mkt.items = [h.it];
  await assert.rejects(() => mkt.refresh(s));
  assert.deepEqual(s.approved, { "it||": 40 });
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 40 } });
  // A timed pass whose read fails ends nothing either.
  await timedPass(s);
  assert.deepEqual(s.approved, { "it||": 40 });
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 40 } });
});

test("a hidden listing ends nothing", async () => {
  h.mine = [order(80, "a", { visible: false })];
  const s = settings({ "it||": 40 }, { approvedFor: { a: { key: "it||", platinum: 40 } } });
  mkt.items = [h.it];
  await mkt.refresh(s);
  assert.deepEqual(s.approved, { "it||": 40 });
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 40 } });
});

test("a listing sold out or deleted ends its approval; the next one, made on the website, takes its own price", async () => {
  const s = settings({ "it||": 40 }, { approvedFor: { a: { key: "it||", platinum: 40 } } });
  mkt.items = [h.it];
  h.mine = [];
  await mkt.refresh(s);
  // Sold out: the approval ends (kept by order id, for a read that only missed it); the key's price
  // stays for an older build after a step back, as it read it before.
  assert.deepEqual({ approved: s.approved, owned: owned(s), ended: (s as unknown as { approvedEnded: unknown }).approvedEnded }, { approved: { "it||": 40 }, owned: {}, ended: { a: { key: "it||", platinum: 40, at: h.now } } }, "sold out: the approval ends");
  h.mine = [order(90, "b")];
  await mkt.refresh(s);
  assert.deepEqual({ approved: s.approved, owned: owned(s) }, { approved: { "it||": 90 }, owned: { b: { key: "it||", platinum: 90 } } });
});

test("the same listing seen again in the same run (another account's or platform's read between) keeps its approval, never its lowered price", async () => {
  const s = settings({ "it||": 100 }, { approvedFor: { a: { key: "it||", platinum: 100 } } });
  mkt.items = [h.it];
  h.mine = [];
  await mkt.refresh(s);
  h.mine = [order(70, "a")];
  await mkt.refresh(s);
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 100 } });
});

test("two listings of one thing: one sold out leaves the other's approval as it was", async () => {
  h.mine = [order(70, "a"), order(75, "b")];
  const s = settings({ "it||": 100 }, { approvedFor: { a: { key: "it||", platinum: 100 }, b: { key: "it||", platinum: 100 } } });
  mkt.items = [h.it];
  h.mine = [order(70, "a")];
  await mkt.refresh(s);
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 100 } });
  assert.equal(s.approved["it||"], 100);
});

test("a second listing of one thing, made on the website, takes its own price and leaves the first one's as it was", async () => {
  h.mine = [order(70, "a"), order(150, "b")];
  const s = settings({ "it||": 100 }, { approvedFor: { a: { key: "it||", platinum: 100 } } });
  mkt.items = [h.it];
  await mkt.refresh(s);
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 100 }, b: { key: "it||", platinum: 150 } });
});

test("an approval an older build changed after a step back applies to the listings up for it, as one saved before the update", async () => {
  // This build approved 50p for "a"; the older one then had 80p approved (Reprice pressed there).
  h.mine = [order(60, "a")];
  const s = settings({ "it||": 80 }, { approvedFor: { a: { key: "it||", platinum: 50 } } });
  mkt.items = [h.it];
  await mkt.refresh(s);
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 80 } });
});

test("a listing of an item not in the item list ends nothing of that item", async () => {
  h.mine = [order(60, "a", { itemId: "unknown" })];
  const s = settings({ "unknown||intact": 100 }, { approvedFor: { a: { key: "unknown||intact", platinum: 100 } } });
  mkt.items = [h.it];
  await mkt.refresh(s);
  assert.deepEqual(s.approved, { "unknown||intact": 100 });
  assert.deepEqual(owned(s), { a: { key: "unknown||intact", platinum: 100 } });
});

test("approvals are still saved as before: a step back to an older build reads every one", async () => {
  h.mine = [order(100, "a"), order(5, "c", { itemId: "other" })];
  const s = settings({ "it||": 20 });
  mkt.items = [h.it, { ...h.it, id: "other", slug: "other" }];
  await mkt.refresh(s);
  const saved = JSON.parse(JSON.stringify(s));
  assert.deepEqual(approvedOf(saved.approved), { "it||": 20, "other||": 5 }, "the older build's own reader");
});

test("a new listing is approved at its own price by the first read that has it", async () => {
  const s = settings({});
  mkt.items = [h.it];
  h.mine = [order(33, "n")];
  await mkt.refresh(s);
  assert.deepEqual({ approved: s.approved, owned: owned(s) }, { approved: { "it||": 33 }, owned: { n: { key: "it||", platinum: 33 } } });
});

test("Reprice by hand and a typed price approve that listing only", async () => {
  h.mine = [order(70, "a"), order(75, "b")];
  const s = settings({ "it||": 100 });
  mkt.items = [h.it];
  mkt.rules = s;
  await mkt.refresh(s);
  await mkt.update(mkt.orders.find((o) => o.id === "b")!, { platinum: 90 });
  assert.deepEqual(owned(s), { a: { key: "it||", platinum: 100 }, b: { key: "it||", platinum: 90 } });
});

test("a listing made with the listing form is approved at its own price by the read after it", async () => {
  const s = settings({ "it||": 100 });
  mkt.items = [h.it];
  mkt.rules = s;
  mkt.model = { observedAt: null, inventoryByBase: new Map(), partByName: new Map() } as unknown as Model; // a console: no inventory read
  market.create = (async (o: { platinum: number; quantity: number }) => {
    h.mine = [...h.mine, order(o.platinum, "made", { quantity: o.quantity })];
    return {} as never;
  }) as never;
  await mkt.refresh(s);
  mkt.draft = { itemId: "it", name: "It", slug: "it", platinum: 40, quantity: 1, rank: null, subtype: null, maxRank: null, subtypes: null, available: 1, priced: true, inGame: 0, ladder: [], addToExisting: true, held: [], asked: { rank: null, subtype: null, available: 1 } } as Draft;
  await mkt.submitDraft();
  assert.deepEqual(owned(s), { made: { key: "it||", platinum: 40 } }, logText());
});
