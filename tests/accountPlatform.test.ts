// The account's platform goes into Settings → Platform after any sign-in and any reconnect, from
// the store, and the relic prices (the old platform's) go with a change. A platform picked by hand
// after signing in stays at the next reconnect to the same account: the store keeps the account
// and platform it last took in, and a reconnect that finds the same pair leaves the setting be.
// market.* are stand-ins; nothing reaches the network.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market, defaultMarketSettings, type MarketSettings, type Platform } from "../src/lib/backend";

globalThis.fetch = (() => {
  throw new Error("no network in tests");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");

const calls: Record<string, number> = {};
const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);
let profile: { id: string; platform: Platform } | null = null;
market.account = (async () => {
  count("account");
  return { linked: true, backing: "keyring", profile: profile && { ...profile, ingameName: "ExamplePlayer", crossplay: true }, error: profile ? null : "Couldn't reach warframe.market" };
}) as never;
market.items = (async () => {
  count("items");
  return [{ id: "ex", slug: "example_mod", gameRef: "/Example/Mod", name: "Example Mod", maxRank: null, subtypes: null, tags: [] }];
}) as never;
market.myOrders = (async () => {
  count("myOrders");
  return [];
}) as never;
market.signIn = (async () => void count("signIn")) as never;
market.useToken = (async () => void count("useToken")) as never;

const rules = (platform: Platform): MarketSettings => {
  const s = defaultMarketSettings();
  s.platform = platform;
  s.relicPrices = { "Example Relic": { at: 1, prices: { intact: 3 } } } as never;
  return s;
};
const reset = () => {
  for (const k of Object.keys(calls)) delete calls[k];
  mkt.items = [];
};
let clock = 1e12;
// An outage, then back: the timer's retry (retryIfDisconnected) picks the account up again.
async function reconnect(to: { id: string; platform: Platform }) {
  mkt.account = { linked: true, backing: "keyring", profile: null, error: "Couldn't reach warframe.market" };
  assert.equal(mkt.linked, false, "offline");
  profile = to;
  clock += 3_600_000;
  await mkt.retryIfDisconnected(clock);
  assert.equal(mkt.linked, true, "back");
}

test("at the start, the account's platform is taken in, and its relic prices start over; no request more", async () => {
  reset();
  profile = { id: "acct-a", platform: "xbox" };
  mkt.rules = rules("pc");
  await mkt.init();
  assert.equal(mkt.rules.platform, "xbox");
  assert.deepEqual(mkt.rules.relicPrices, {}, "the PC prices go");
  const asked = { ...calls };
  reset();
  profile = { id: "acct-b", platform: "pc" };
  mkt.rules = rules("pc");
  await mkt.init();
  assert.equal(mkt.rules.platform, "pc");
  assert.equal(Object.keys(mkt.rules.relicPrices).length, 1, "same platform: the prices stay");
  assert.deepEqual(asked, calls, "the same requests either way");
});

test("signing in, or using a token, takes the account's platform in", async () => {
  reset();
  profile = { id: "acct-c", platform: "ps4" };
  mkt.rules = rules("pc");
  await mkt.signIn("player@example.com", "made-up");
  assert.equal(mkt.rules.platform, "ps4");
  assert.deepEqual(mkt.rules.relicPrices, {});
  profile = { id: "acct-d", platform: "switch" };
  mkt.rules = rules("pc");
  await mkt.useToken("made-up-token");
  assert.equal(mkt.rules.platform, "switch");
  assert.deepEqual(calls, { signIn: 1, account: 2, myOrders: 2, useToken: 1 }, "no request more than signing in made");
});

test("a platform picked by hand after signing in stays at the next reconnect; a new sign-in takes the account's again", async () => {
  reset();
  profile = { id: "acct-e", platform: "xbox" };
  mkt.rules = rules("pc");
  await mkt.signIn("player@example.com", "made-up");
  assert.equal(mkt.rules.platform, "xbox");
  // Settings → Platform, by hand (SettingsSheet empties the relic prices itself).
  mkt.rules.platform = "pc";
  mkt.rules.relicPrices = { "Example Relic": { at: 2, prices: { intact: 4 } } } as never;
  await reconnect({ id: "acct-e", platform: "xbox" });
  assert.equal(mkt.rules.platform, "pc", "the hand pick stands");
  assert.equal(Object.keys(mkt.rules.relicPrices).length, 1, "and its prices");
  await mkt.signIn("player@example.com", "made-up");
  assert.equal(mkt.rules.platform, "xbox", "signing in again sets it from the account");
});

test("a reconnect that finds another account, or the account on another platform, takes it in", async () => {
  reset();
  profile = { id: "acct-f", platform: "xbox" };
  mkt.rules = rules("pc");
  await mkt.signIn("player@example.com", "made-up");
  mkt.rules.platform = "pc";
  await reconnect({ id: "acct-f", platform: "ps4" });
  assert.equal(mkt.rules.platform, "ps4", "the account moved platform on warframe.market");
  mkt.rules.platform = "pc";
  await reconnect({ id: "acct-g", platform: "ps4" });
  assert.equal(mkt.rules.platform, "ps4", "another account");
});

test("App takes no platform in itself: the store does", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  const start = app.slice(app.indexOf("mkt.init().then("), app.indexOf("mkt.pollStatus();"));
  assert.ok(start.length > 0);
  assert.doesNotMatch(start, /settings\.market\.platform =/);
  assert.match(start, /mkt\.setStatus\(mkt\.presenceFor\(settings\.market\.presence\)\)/, "the status is still held again");
});
