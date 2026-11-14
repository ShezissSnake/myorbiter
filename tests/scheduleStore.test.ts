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
  (mkt as unknown as { switched: boolean }).switched = false;
  market.items = async () => [];
  market.myOrders = async () => [];
});

test("a timed pass saves its time in the settings; the next start goes by it", async () => {
  const s = settings({ every: 60 });
  const before = Date.now();
  await mkt.reprice(bare, s, false, true);
  assert.ok(s.lastCheck != null && s.lastCheck >= before, "saved");
  assert.equal(s.lastCheck, mkt.lastPass);
  // A new run: nothing of its own yet, so the saved time decides.
  mkt.lastPass = null;
  assert.equal(mkt.lastCheckOf(s), s.lastCheck);
  assert.equal(checkDue(mkt.lastCheckOf(s), mkt.passDelay(60 * MIN), s.lastCheck! + 30 * MIN), false);
  assert.equal(checkDue(mkt.lastCheckOf(s), mkt.passDelay(60 * MIN), s.lastCheck! + 60 * MIN), true);
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
  // On an interval under an hour nothing changes: the usual wait.
  const short = settings({ every: 10 });
  mkt.passFailures = 0;
  await mkt.reprice(bare, short, false, true);
  assert.ok(mkt.lastPass! >= before);
});

test("after a platform switch the saved time is set aside: the new platform is checked at once", async () => {
  market.setPlatform = (async () => {}) as never;
  const s = settings({ every: 24 * 60, lastCheck: Date.now() - MIN });
  assert.equal(mkt.lastCheckOf(s), s.lastCheck);
  await (mkt as unknown as { switchPlatform(p: string): Promise<void> }).switchPlatform(mkt.platform === "pc" ? "ps4" : "pc");
  assert.equal(mkt.lastCheckOf(s), null);
  assert.equal(checkDue(mkt.lastCheckOf(s), mkt.passDelay(24 * 60 * MIN), Date.now()), true);
});
