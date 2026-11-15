// Settings as loaded (backend.ts › loadSettings), the values a damaged or hand-edited file must
// not turn into something the player did not choose: the Discord kinds, the saved relic prices,
// the platform, and the fields that are read as yes or no or as a number. The browser path:
// localStorage stands in for the file. A full, well-formed file is in settingsRoundTrip.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DISCORD_DEFAULT_KINDS, defaultNotify, defaultSettings, loadSettings } from "../src/lib/backend";
import { buildModel } from "../src/lib/core/model";

globalThis.fetch = (() => { throw new Error("no network in this test"); }) as never;
const load = (saved: unknown) => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(saved), setItem: () => {} };
  return loadSettings();
};
const URL = "https://discord.com/api/webhooks/1/abc";

// Discord kinds

test("a damaged list of Discord kinds loads as empty and the address stays", async () => {
  for (const kinds of ["rivens", null, 5, true, {}, { 0: "rivens" }]) {
    const d = (await load({ notifyOptions: { discord: { url: URL, kinds } } })).notifyOptions.discord;
    assert.deepEqual(d, { url: URL, kinds: [] }, JSON.stringify(kinds));
  }
});

test("a list of Discord kinds is kept, its texts only", async () => {
  assert.deepEqual((await load({ notifyOptions: { discord: { url: URL, kinds: ["deals", 3, "sold", null] } } })).notifyOptions.discord.kinds, ["deals", "sold"]);
  assert.deepEqual((await load({ notifyOptions: { discord: { url: URL, kinds: [] } } })).notifyOptions.discord.kinds, []);
});

test("no list because Discord was never set up loads as today: the usual kinds, no address", async () => {
  for (const saved of [null, {}, { notifyOptions: {} }, { notifyOptions: { discord: {} } }, { notifyOptions: { discord: { url: "" } } }, { notifyOptions: { discord: "x" } }]) {
    assert.deepEqual((await load(saved)).notifyOptions.discord, { url: "", kinds: DISCORD_DEFAULT_KINDS }, JSON.stringify(saved));
  }
});

test("an address with no list at all is a damaged list too: nothing is posted until the player picks", async () => {
  assert.deepEqual((await load({ notifyOptions: { discord: { url: URL } } })).notifyOptions.discord, { url: URL, kinds: [] });
});

// Relic prices

const NOW = () => Date.now();
const priced = (relicPrices: unknown) => load({ market: { relicPrices } }).then((s) => s.market.relicPrices);

test("a relic price entry whose prices is not an object is left out, the others kept", async () => {
  const good = { at: NOW() - 1000, how: "median", prices: { intact: 4, radiant: 12 } };
  const got = await priced({ "Lith A1": { at: NOW(), how: "median", prices: null }, "Lith A2": { at: NOW(), prices: [5] }, "Lith A3": { at: NOW(), prices: "5" }, "Lith A4": null, "Lith A5": 7, "Lith A6": [], "Meso B1": good });
  assert.deepEqual(got, { "Meso B1": good });
});

test("a relic price entry with a time in the future, or no real time, is left out", async () => {
  const prices = { intact: 4 };
  const got = await priced({ f: { at: NOW() + 86_400_000, prices }, t: { at: "1700000000000", prices }, n: { prices }, nan: { at: null, prices }, inf: { at: 1e999, prices }, ok: { at: 1_700_000_000_000, prices } });
  assert.deepEqual(got, { ok: { at: 1_700_000_000_000, prices } });
});

test("a relic price that is not a finite number above 0 and within 100000 is left out, the rest of the entry kept", async () => {
  const at = NOW() - 5000;
  const got = await priced({ "Axi C3": { at, how: "median", prices: { intact: 3, exceptional: 0, flawless: -2, radiant: 100_001, a: "9", b: null, c: true, d: 1e999, e: 100_000, f: 0.5 } } });
  assert.deepEqual(got, { "Axi C3": { at, how: "median", prices: { intact: 3, e: 100_000, f: 0.5 } } });
});

test("a relic price entry with every price bad is kept with none, so it is read again; an unknown 'how' is dropped", async () => {
  const at = NOW() - 5000;
  assert.deepEqual(await priced({ x: { at, how: "mean", prices: { intact: -1 } } }), { x: { at, prices: {} } });
});

test("relic prices that are not an object load as none", async () => {
  for (const bad of [null, 5, "x", [], [{ at: 1, prices: {} }]]) assert.deepEqual(await priced(bad), {}, JSON.stringify(bad));
});

test("a relic price entry that was a problem no longer makes relicPrice throw", async () => {
  const prices = await priced({ "Lith A1": { at: NOW() + 86_400_000, how: "median", prices: null }, "Lith A2": { at: NOW(), prices: null } });
  const m = buildModel({ observed_at: 1, inventory: [], catalog: [], relics: [], prices: { prices: {}, max_rank_prices: {} } } as unknown as Parameters<typeof buildModel>[0], undefined, null, prices);
  assert.doesNotThrow(() => m.relicPrice("Lith A1"));
  assert.doesNotThrow(() => m.relicPrice("Lith A2"));
});

// Platform

test("only a platform the app lists is accepted; anything else loads as pc", async () => {
  for (const p of ["xbox", "ps4", "switch", "mobile", "pc"]) assert.equal((await load({ market: { platform: p } })).market.platform, p);
  for (const p of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf", "PC", "Xbox", "", "x", 1, null, {}, ["xbox"], true]) {
    assert.equal((await load({ market: { platform: p } })).market.platform, "pc", JSON.stringify(p));
  }
});

// Yes or no, and numbers

test("a text where a yes or no is read loads as the usual value, in every group", async () => {
  const d = defaultSettings();
  const s = await load({
    tennoscope: { launch: "false", opaqueOverlay: "true" },
    overlay: { show: { mastered: "false", vault: 0, set: null, plat: {}, ducats: [], pick: "no" } },
    notify: { reward: "false", sold: 0, whispers: null, deals: "off", fissures: [] },
  });
  assert.deepEqual(s.tennoscope, d.tennoscope);
  assert.deepEqual(s.overlay.show, d.overlay.show);
  assert.deepEqual(s.notify, d.notify);
});

test("a true or false is kept, the others of the group stay the usual", async () => {
  const s = await load({ tennoscope: { launch: false }, overlay: { show: { vault: false } }, notify: { deals: false, rivens: false } });
  assert.deepEqual(s.tennoscope, { launch: false, opaqueOverlay: false });
  assert.deepEqual(s.overlay.show, { ...defaultSettings().overlay.show, vault: false });
  assert.deepEqual(s.notify, { ...defaultNotify(), deals: false, rivens: false });
});

test("a group that is not an object loads as the usual one", async () => {
  for (const bad of ["x", 5, [], [true], null, true]) {
    const s = await load({ tennoscope: bad, overlay: { show: bad }, notify: bad, pick: bad });
    const d = defaultSettings();
    assert.deepEqual([s.tennoscope, s.overlay.show, s.notify, s.pick], [d.tennoscope, d.overlay.show, d.notify, d.pick], JSON.stringify(bad));
  }
});

test("the older single switch for the listings' notices still turns off sold and repriced, and only a real true or false counts", async () => {
  const s = await load({ notify: { market: false, sold: "yes" } });
  assert.equal(s.notify.market, false);
  assert.equal(s.notify.sold, false, "the older switch decides while its own is not a yes or no");
  assert.equal(s.notify.repriced, false);
  assert.equal((await load({ notify: { market: false, sold: true } })).notify.sold, true);
});

test("a reward-card weight that is not a finite number loads as the usual one", async () => {
  const d = defaultSettings().pick;
  const s = await load({ pick: { plat: "9", needed: null, ducats: 1e999, set: {}, forma: "5" } });
  assert.deepEqual(s.pick, d);
  assert.deepEqual((await load({ pick: { plat: 9, needed: 0, ducats: 7, set: 2, forma: 1.5 } })).pick, { plat: 9, needed: 0, ducats: 7, set: 2, forma: 1.5 });
  assert.equal((await load({ pick: { forma: -1 } })).pick.forma, d.forma);
});

test("a text as the pick weights does not spread its letters into them", async () => {
  assert.deepEqual((await load({ pick: "abc" })).pick, defaultSettings().pick);
});

test("Switch to Current fissure is a yes or no: a text loads as the usual one", async () => {
  for (const bad of ["false", 0, null, {}]) assert.equal((await load({ jumpToPick: bad })).jumpToPick, true, JSON.stringify(bad));
  assert.equal((await load({ jumpToPick: false })).jumpToPick, false);
});
