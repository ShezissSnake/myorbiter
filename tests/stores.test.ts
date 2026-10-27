// The warframe.market and riven stores over a long session: reads that race a sale, outages,
// and caches that would otherwise grow for hours.
import { settle } from "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market, presence, defaultMarketSettings } from "../src/lib/backend";
import type { MyOrder } from "../src/lib/core/market";
import type { Model } from "../src/lib/core/model";

const { mkt } = await import("../src/lib/marketStore.svelte");
const { rivens } = await import("../src/lib/rivenStore.svelte");

const order = (id: string, quantity = 1): MyOrder => ({ id, itemId: "it", type: "sell", platinum: 20, quantity, rank: null, subtype: null, visible: true, updatedAt: null });
const me = { id: "me", ingameName: "Me", platform: "pc", crossplay: true } as never;
const real = { ...market };
const model = {} as Model;

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.orders = [];
  mkt.ordersAt = null;
  mkt.passFailures = 0;
  mkt.lastPass = null;
  mkt.log = [];
  mkt.op = null;
  mkt.pass = null;
});

test("a read of your listings that started before a sale doesn't bring the sold listing back", async () => {
  mkt.orders = [order("a"), order("b")];
  let answer!: (o: MyOrder[]) => void;
  market.myOrders = () => new Promise((r) => (answer = r));
  market.close = async () => {};
  const reading = mkt.refresh();
  // The trade closes listing "a" while the read is on its way, with the old list.
  await mkt.sold(mkt.orders[0], 1);
  answer([order("a"), order("b")]);
  await reading;
  assert.deepEqual(mkt.orders.map((o) => o.id), ["b"], "still sold");
  // The next read is taken as it comes.
  market.myOrders = async () => [order("b"), order("c")];
  await mkt.refresh();
  assert.deepEqual(mkt.orders.map((o) => o.id), ["b", "c"]);
});

test("listings count as read only once warframe.market answered; signing out forgets that", async () => {
  assert.equal(mkt.ordersAt, null);
  market.myOrders = async () => {
    throw new Error("Couldn't reach warframe.market");
  };
  await assert.rejects(mkt.refresh());
  assert.equal(mkt.ordersAt, null, "a failed read isn't a read");
  market.myOrders = async () => [order("a")];
  await mkt.refresh();
  assert.ok(mkt.ordersAt);
  market.signOut = async () => {};
  market.account = async () => ({ linked: false, backing: "keyring", profile: null, error: null });
  await mkt.signOut();
  assert.equal(mkt.ordersAt, null);
});

test("Auto-match backs off while warframe.market doesn't answer, and says so once", async () => {
  const s = defaultMarketSettings();
  market.items = async () => [{ id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] }];
  market.myOrders = async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  for (let i = 0; i < 3; i++) await mkt.reprice(model, s, true);
  assert.equal(mkt.passFailures, 3);
  assert.deepEqual(mkt.log.map((l) => l.tone).reverse(), ["warn", "info", "info"], "one warning (one notification), not one per pass");
  assert.equal(mkt.passDelay(5 * 60_000), 40 * 60_000, "5 minutes, doubled three times");
  assert.equal(mkt.passDelay(5 * 60_000) <= 60 * 60_000, true);
  market.myOrders = async () => [];
  await mkt.reprice(model, s, true);
  assert.equal(mkt.passFailures, 0);
  assert.ok(mkt.log.some((l) => /answering again/.test(l.text)));
  assert.equal(mkt.passDelay(5 * 60_000), 5 * 60_000);
});

test("a refused sign-in stops the passes and forgets the listings read", async () => {
  mkt.ordersAt = 1;
  market.items = async () => [{ id: "it", slug: "it", gameRef: "/it", name: "It", maxRank: null, subtypes: null, tags: [] }];
  market.myOrders = async () => {
    throw new Error("warframe.market refused the sign-in");
  };
  await mkt.reprice(model, defaultMarketSettings(), true);
  assert.equal(mkt.linked, false);
  assert.equal(mkt.ordersAt, null);
  assert.equal(mkt.passFailures, 0, "not an outage: no back-off");
});

test("after an outage the account is tried again after 1, 2, 4… minutes, not every minute", async () => {
  let tries = 0;
  market.account = async () => {
    tries++;
    return { linked: true, backing: "keyring", profile: null, error: "Couldn't reach warframe.market" };
  };
  market.items = async () => [];
  mkt.account = { linked: true, backing: "keyring", profile: null, error: "offline" };
  const t0 = 10_000_000;
  for (let m = 0; m <= 8; m++) await mkt.retryIfDisconnected(t0 + m * 60_000);
  // Minutes 0, 2, 6: one, then two and four minutes apart.
  assert.equal(tries, 3);
  market.account = async () => ({ linked: true, backing: "keyring", profile: me, error: null });
  market.myOrders = async () => [];
  await mkt.retryIfDisconnected(t0 + 30 * 60_000);
  assert.equal(mkt.linked, true);
});

test("a deals scan stops asking once warframe.market stops answering", async () => {
  let asked = 0;
  market.items = async () => Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, slug: `s${i}`, gameRef: `/g${i}`, name: `Thing ${i}`, maxRank: null, subtypes: null, tags: [] }));
  mkt.items = [];
  market.book = async () => {
    asked++;
    throw new Error("timed out");
  };
  const watch = Array.from({ length: 10 }, (_, i) => ({ name: `Thing ${i}` })) as never;
  await mkt.scanDeals({} as Model, watch).catch(() => {});
  assert.equal(asked, 3, "three failures in a row, then it waits for the next scan");
});

test("riven searches older than half an hour are dropped from the cache", async () => {
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    market.rivenAuctions = async () => [];
    await rivens.search("braton", ["a"], null);
    now += 31 * 60_000;
    await rivens.search("lato", ["b"], null);
    assert.deepEqual(Object.keys(rivens.results), ["lato|b|"]);
  } finally {
    Date.now = realNow;
  }
  await settle();
});

test("the same warning notifies once an hour; the Activity log still has every one", () => {
  mkt.note("Thing: couldn't update (timed out)", "warn");
  mkt.note("Thing: couldn't update (timed out)", "warn");
  mkt.note("Other: couldn't update (timed out)", "warn");
  assert.deepEqual(mkt.log.map((l) => [l.tone, !!l.quiet]).reverse(), [["warn", false], ["warn", true], ["warn", false]]);
});

test("a Sold that fails can leave telling you to the caller", async () => {
  mkt.orders = [order("q", 2)];
  market.close = async () => {
    throw new Error("timed out");
  };
  assert.equal(await mkt.sold(mkt.orders[0], 1, { quiet: true }), null);
  assert.equal(mkt.log[0].tone, "warn");
  assert.equal(mkt.log[0].quiet, true, "logged, not notified: the trade's own notification says it");
  assert.deepEqual(mkt.orders.map((o) => o.quantity), [2], "put back");
});

test("stepping through the status switch sends only where you stop", async () => {
  const sent: string[] = [];
  const realSet = presence.set;
  presence.set = async (st) => {
    sent.push(st);
    return { wanted: st === "offline" ? null : st, committed: st === "offline" ? null : st, connected: true, error: null } as never;
  };
  try {
    void mkt.setStatus("invisible");
    void mkt.setStatus("online");
    assert.equal(mkt.statusAsked, "online", "the switch shows the choice at once");
    await mkt.setStatus("ingame");
    assert.deepEqual(sent, ["ingame"]);
    assert.equal(mkt.status?.committed, "ingame");
  } finally {
    presence.set = realSet;
  }
});

test("Reload says how it went: listings counted, or the error on screen", async () => {
  market.myOrders = async () => [order("a"), order("b")];
  await mkt.reload();
  assert.match(mkt.log[0].text, /reloaded from warframe.market: 2/);
  market.myOrders = async () => {
    throw new Error("Couldn't reach warframe.market (timed out)");
  };
  await mkt.reload();
  assert.match(mkt.error ?? "", /Couldn't reach/);
  assert.equal(mkt.op, null);
});

test("the listing form drops the old price when you pick another rank", async () => {
  mkt.items = [{ id: "ser", slug: "serration", gameRef: "/M/Serration", name: "Serration", maxRank: 10, subtypes: null, tags: ["mod"] }];
  market.book = async () => [{ id: "b", type: "sell", platinum: 20, quantity: 1, rank: 0, subtype: null, visible: true, user: { id: "u", ingameName: "U", status: "ingame", platform: "pc", crossplay: true } }];
  const held = { inventoryByBase: new Map([["/M/Serration", [{ rank: 0, quantity: 3 }]]]), partByName: new Map(), inventoryByName: new Map(), catalogByUnique: new Map(), catalogNames: new Set() } as unknown as Model;
  await mkt.startListing(held, "Serration");
  assert.equal(mkt.draft?.platinum, 20);
  mkt.draft!.rank = 10;
  await mkt.retarget();
  assert.equal(mkt.draft?.platinum, null, "nobody sells R10 in game: the price is yours to set");
  assert.equal(mkt.draft?.available, 0);
  mkt.closeDraft();
});

