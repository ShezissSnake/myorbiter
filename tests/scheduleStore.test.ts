// The automatic check's timing as the store keeps it (marketStore.svelte.ts): the time of the last
// check saved in the settings, a pass warframe.market didn't answer tried again within the hour on
// a long interval, and the saved time set aside after a platform switch. Every market call is a
// stand-in; nothing reaches the network.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { market, defaultMarketSettings, type MarketSettings } from "../src/lib/backend";
import type { Model } from "../src/lib/core/model";
import { checkDue } from "../src/lib/core/schedule";

const { mkt } = await import("../src/lib/marketStore.svelte");

const me = { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true } as never;
const real = { ...market };
const bare = { price: () => null, priceMax: () => null, relicPrice: () => null, partByName: new Map() } as unknown as Model;
const MIN = 60_000;
const HOUR = 60 * MIN;
const WEEK = 7 * 24 * HOUR;
const settings = (extra: Partial<MarketSettings> = {}): MarketSettings => ({ ...defaultMarketSettings(), autoCheck: true, ...extra });

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: me, error: null };
  mkt.items = [];
  mkt.orders = [];
  mkt.books = {};
  mkt.log = [];
  mkt.pass = null;
  mkt.passFailures = 0;
  mkt.lastPass = null;
  mkt.error = null;
  (mkt as unknown as { switched: boolean; chosen: boolean }).switched = false;
  (mkt as unknown as { switched: boolean; chosen: boolean }).chosen = false;
  market.items = async () => [];
  market.myOrders = async () => [];
});

test("over an hour, a timed pass saves its time in the settings; the next start goes by it", async () => {
  // warframe.market answers (an item list, no listings): a pass that went through.
  market.items = async () => [{ id: "a", slug: "slug_a", gameRef: "/Example/a", name: "Example Item a", maxRank: null, subtypes: null, tags: [] }] as never;
  const s = settings({ every: 120 });
  const before = Date.now();
  await mkt.reprice(bare, s, false, true);
  assert.ok(s.lastCheck != null && s.lastCheck >= before, "saved");
  assert.equal(s.lastCheck, mkt.lastPass);
  // A new run: nothing of its own yet, so the saved time decides.
  mkt.lastPass = null;
  assert.equal(mkt.lastCheckOf(s), s.lastCheck);
  assert.equal(checkDue(mkt.lastCheckOf(s), mkt.passDelay(120 * MIN), s.lastCheck! + 90 * MIN), false);
  assert.equal(checkDue(mkt.lastCheckOf(s), mkt.passDelay(120 * MIN), s.lastCheck! + 120 * MIN), true);
});

test("an hour or less: timed passes save nothing, so settings aren't written on every pass", async () => {
  for (const every of [1, 5, 60]) {
    const s = settings({ every });
    const was = JSON.stringify(s);
    for (let i = 0; i < 3; i++) {
      mkt.lastPass = null;
      await mkt.reprice(bare, s, false, true);
    }
    assert.ok(mkt.lastPass != null, `${every} min: the pass ran`);
    assert.equal(JSON.stringify(s), was, `${every} min: the settings are untouched`);
    // A time saved under a longer interval isn't used at this one: a start checks at once, as before.
    mkt.lastPass = null;
    assert.equal(mkt.lastCheckOf({ ...s, lastCheck: Date.now() }), null);
  }
});

test("a pass warframe.market didn't answer is tried again within the hour, not a week later", async () => {
  market.items = async () => {
    throw new Error("warframe.market didn't answer");
  };
  const s = settings({ every: 7 * 24 * 60 });
  const before = Date.now();
  await mkt.reprice(bare, s, false, true);
  assert.equal(mkt.passFailures, 1);
  const last = mkt.lastCheckOf(s)!;
  assert.equal(s.lastCheck, last, "the saved time is the same, for a restart");
  const wait = mkt.passDelay(WEEK);
  assert.equal(checkDue(last, wait, before + 30 * MIN), false, "not at once");
  assert.equal(checkDue(last, wait, Date.now() + HOUR), true, "within the hour");
  // On an interval under an hour nothing changes: the pass's own time, never one in the future
  // (which would count as due on every tick).
  const short = settings({ every: 10 });
  mkt.passFailures = 0;
  const t0 = Date.now();
  await mkt.reprice(bare, short, false, true);
  assert.equal(mkt.passFailures, 1);
  assert.ok(mkt.lastPass! >= t0 && mkt.lastPass! <= Date.now(), "the time of the pass itself");
});

test("a pass that stops after three failed reads is tried again within the hour too", async () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id, slug: `slug_${id}`, gameRef: `/Example/${id}`, name: `Example Item ${id}`, maxRank: null, subtypes: null, tags: [] }));
  market.items = async () => items as never;
  market.myOrders = async () => items.map((it, i) => ({ id: `o${i}`, itemId: it.id, type: "sell", platinum: 20, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null })) as never;
  // The first book answers, the next three don't: the pass stops, though warframe.market answered once.
  market.book = (async (slug: string) => {
    if (slug === "slug_a") return [];
    throw new Error("warframe.market didn't answer");
  }) as never;
  const s = settings({ every: 7 * 24 * 60 });
  const before = Date.now();
  const summary = await mkt.reprice(bare, s, false, true);
  assert.equal(summary?.stopped, true);
  assert.equal(mkt.passFailures, 0, "it read a book, so it isn't counted as a pass with no answer");
  const wait = mkt.passDelay(WEEK);
  assert.equal(checkDue(mkt.lastCheckOf(s), wait, before + 30 * MIN), false, "not at once");
  assert.equal(checkDue(mkt.lastCheckOf(s), wait, Date.now() + HOUR), true, "within the hour");
});

test("after a platform switch the saved time is set aside and cleared: the new platform is checked at once", async () => {
  market.setPlatform = (async () => {}) as never;
  const saved = Date.now() - MIN;
  const s = settings({ every: 24 * 60, lastCheck: saved });
  const other = mkt.platform === "pc" ? "ps4" : "pc";
  // The platform MyOrbiter starts on is no switch: the saved time stands.
  await mkt.usePlatform(other as never, s);
  assert.equal(s.lastCheck, saved);
  assert.equal(mkt.lastCheckOf(s), saved);
  // A switch while it runs: set aside now, and gone from the settings for the next start.
  await mkt.usePlatform((other === "pc" ? "ps4" : "pc") as never, s);
  assert.equal(mkt.lastCheckOf(s), null);
  assert.equal(s.lastCheck, null);
  assert.equal(checkDue(mkt.lastCheckOf(s), mkt.passDelay(24 * 60 * MIN), Date.now()), true);
});
