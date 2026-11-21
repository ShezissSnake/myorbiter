// Settings as loaded (backend.ts › loadSettings), the values a damaged or hand-edited file must
// not turn into something the player did not choose: the Discord kinds, the saved relic prices,
// the platform, and the fields that are read as yes or no or as a number. The browser path:
// localStorage stands in for the file. A full, well-formed file is in settingsRoundTrip.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DISCORD_DEFAULT_KINDS, defaultNotify, defaultSettings, loadSettings } from "../src/lib/backend";
import { DAMAGED_SETTINGS_KEY, DAMAGED_SETTINGS_NAME } from "../src/lib/core/standIn";
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
  const got = await priced({ f: { at: NOW() + 86_400_000, prices }, t: { at: "1700000000000", prices }, n: { prices }, nan: { at: null, prices }, ok: { at: 1_700_000_000_000, prices } });
  assert.deepEqual(got, { ok: { at: 1_700_000_000_000, prices } });
});

test("a relic price that is not a finite number above 0 and within 100000 is left out, the rest of the entry kept", async () => {
  const at = NOW() - 5000;
  const got = await priced({ "Axi C3": { at, how: "median", prices: { intact: 3, exceptional: 0, flawless: -2, radiant: 100_001, a: "9", b: null, c: true, e: 100_000, f: 0.5 } } });
  assert.deepEqual(got, { "Axi C3": { at, how: "median", prices: { intact: 3, e: 100_000, f: 0.5 } } });
});

test("a relic price entry with every price bad is kept with none; its unknown 'how' is dropped, which is why it is read again", async () => {
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

test("a switch that is there but not a real true loads as off; one that is missing is the usual value", async () => {
  const d = defaultSettings();
  const off = <T extends object>(o: T) => Object.fromEntries(Object.keys(o).map((k) => [k, false])) as T;
  for (const bad of ["false", "true", "yes", 0, 1, null, "", {}, []]) {
    const s = await load({ tennoscope: { launch: bad }, overlay: { show: { mastered: bad, pick: bad } }, notify: { reward: bad, sold: bad, deals: bad }, jumpToPick: bad });
    const at = JSON.stringify(bad);
    assert.equal(s.tennoscope.launch, false, at);
    assert.equal(s.tennoscope.opaqueOverlay, d.tennoscope.opaqueOverlay, `${at}: the missing one stays usual`);
    assert.deepEqual(s.overlay.show, { ...d.overlay.show, mastered: false, pick: false }, at);
    assert.deepEqual(s.notify, { ...d.notify, reward: false, sold: false, deals: false }, at);
    assert.equal(s.jumpToPick, false, at);
  }
  // Nothing that is off in a saved file reads as on: every switch given a damaged value is off.
  const all = { tennoscope: off(d.tennoscope), overlay: { show: off(d.overlay.show) }, notify: off(d.notify) };
  const s = await load(JSON.parse(JSON.stringify({ tennoscope: Object.fromEntries(Object.keys(d.tennoscope).map((k) => [k, 0])), notify: Object.fromEntries(Object.keys(d.notify).map((k) => [k, null])), overlay: { show: Object.fromEntries(Object.keys(d.overlay.show).map((k) => [k, ""])) } })));
  assert.deepEqual([s.tennoscope, s.overlay.show, s.notify], [all.tennoscope, all.overlay.show, all.notify]);
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
  const s = await load({ pick: { plat: "9", needed: null, ducats: "x", set: {}, forma: "5" } });
  assert.deepEqual(s.pick, d);
  assert.deepEqual((await load({ pick: { plat: 9, needed: 0, ducats: 7, set: 2, forma: 1.5 } })).pick, { plat: 9, needed: 0, ducats: 7, set: 2, forma: 1.5 });
  assert.equal((await load({ pick: { forma: -1 } })).pick.forma, d.forma);
});

test("a text as the pick weights does not spread its letters into them", async () => {
  assert.deepEqual((await load({ pick: "abc" })).pick, defaultSettings().pick);
});

test("Switch to Current fissure: missing is on as usual, a real false is off", async () => {
  assert.equal((await load({})).jumpToPick, true);
  assert.equal((await load({ jumpToPick: false })).jumpToPick, false);
  assert.equal((await load({ jumpToPick: true })).jumpToPick, true);
});

test("a kinds value of null with no address loads as empty, nothing to post to either way", async () => {
  assert.deepEqual((await load({ notifyOptions: { discord: { kinds: null } } })).notifyOptions.discord, { url: "", kinds: [] });
});

test("a relic price with a time of exactly now is kept (not in the future)", async () => {
  const real = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    assert.deepEqual(await priced({ x: { at: 1_800_000_000_000, prices: { intact: 2 } }, y: { at: 1_800_000_000_001, prices: { intact: 2 } } }), { x: { at: 1_800_000_000_000, prices: { intact: 2 } } });
  } finally {
    Date.now = real;
  }
});

// The switches the loader reads on its own (not in a group flagsOf reads), and the reward weights

type Loaded = Awaited<ReturnType<typeof loadSettings>>;
/** Each such switch: where it sits in a file, and what a damaged value there reads as. */
const SWITCHES: { name: string; put: (v: unknown) => Record<string, unknown>; get: (s: Loaded) => boolean; damaged: boolean }[] = [
  // Off: no request to Nox's Frame that the player may have switched off.
  { name: "buildsFromNox", put: (v) => ({ buildsFromNox: v }), get: (s) => s.buildsFromNox, damaged: false },
  { name: "side.on", put: (v) => ({ side: { on: v } }), get: (s) => s.side.on, damaged: false },
  { name: "overlay.reward", put: (v) => ({ overlay: { reward: v } }), get: (s) => s.overlay.reward, damaged: false },
  { name: "overlay.kiosk", put: (v) => ({ overlay: { kiosk: v } }), get: (s) => s.overlay.kiosk, damaged: false },
  { name: "overlay.riven", put: (v) => ({ overlay: { riven: v } }), get: (s) => s.overlay.riven, damaged: false },
  { name: "notifyOptions.toasts", put: (v) => ({ notifyOptions: { toasts: v } }), get: (s) => s.notifyOptions.toasts, damaged: false },
  { name: "notifyOptions.desktop", put: (v) => ({ notifyOptions: { desktop: v } }), get: (s) => s.notifyOptions.desktop, damaged: false },
  // On, as before: it keeps parts out of what Sell spares offers, so off would offer more for sale.
  { name: "market.sellable.saveForSets", put: (v) => ({ market: { sellable: { saveForSets: v } } }), get: (s) => s.market.sellable.saveForSets, damaged: true },
  // As before (backend.ts says why): the Full mode question is not asked again.
  { name: "fullModeAsked", put: (v) => ({ fullModeAsked: v }), get: (s) => s.fullModeAsked, damaged: true },
];
const DAMAGED = ["false", "true", "yes", "off", 0, 1, null, "", {}, [], [false]];

for (const w of SWITCHES) {
  test(`${w.name}: a damaged value reads as ${w.damaged ? "on" : "off"}`, async () => {
    for (const bad of DAMAGED) assert.equal(w.get(await load(w.put(bad))), w.damaged, `${w.name}: ${JSON.stringify(bad)}`);
  });
}

test("each of the nine switches keeps a real true and a real false", async () => {
  for (const w of SWITCHES) {
    assert.equal(w.get(await load(w.put(true))), true, `${w.name}: true`);
    assert.equal(w.get(await load(w.put(false))), false, `${w.name}: false`);
  }
});

test("each of the nine switches, missing from a file or in a group that is not an object, reads as before: on", async () => {
  for (const w of SWITCHES) {
    assert.equal(w.get(await load({ tab: "home" })), true, `${w.name}: a file without it`);
    const path = w.name.split(".");
    if (path.length < 2) continue;
    for (const bad of ["x", 5, [], null, true]) {
      const saved = path.length === 3 ? { [path[0]]: { [path[1]]: bad } } : { [path[0]]: bad };
      assert.equal(w.get(await load(saved)), true, `${w.name}: its group is ${JSON.stringify(bad)}`);
    }
  }
});

test("no settings file at all, and a damaged file moved aside, give the nine their usual values", async () => {
  const usual = SWITCHES.map((w) => w.get(defaultSettings()));
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {} };
  const fresh = await loadSettings();
  assert.deepEqual(SWITCHES.map((w) => w.get(fresh)), usual, "no file");
  const off = JSON.stringify({ buildsFromNox: false, side: { on: false }, overlay: { reward: false, kiosk: false, riven: false } });
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => (k === DAMAGED_SETTINGS_KEY ? "1" : off), setItem: () => {} };
  const aside = await loadSettings();
  assert.equal(aside.movedAside, DAMAGED_SETTINGS_NAME);
  assert.deepEqual(SWITCHES.map((w) => w.get(aside)), usual, "moved aside");
});

test("every reward weight the sliders offer loads as saved", async () => {
  for (const k of ["plat", "needed", "ducats", "set"] as const) {
    for (let n = 0; n <= 10; n++) {
      const pick = { plat: 1, needed: 1, ducats: 1, set: 1, forma: 3, [k]: n };
      assert.deepEqual((await load({ pick })).pick, pick, `${k} ${n}`);
    }
  }
  // Forma's worth: whatever the field keeps of what was typed (WeightSliders.svelte › setForma:
  // 0 to 100, to one decimal), by the field's own expression.
  for (let i = 0; i <= 1000; i++) {
    const typed = i / 10;
    const forma = Math.min(100, Math.round(typed * 10) / 10);
    assert.equal((await load({ pick: { forma } })).pick.forma, forma, String(forma));
  }
});

test("a reward weight the sliders do not offer loads as the usual one", async () => {
  const d = defaultSettings().pick;
  for (const bad of [-1, 11, 2.5, 0.1, 1e300, -0.5]) {
    assert.deepEqual((await load({ pick: { plat: bad, needed: 5, ducats: bad, set: 0, forma: 7 } })).pick, { plat: d.plat, needed: 5, ducats: d.ducats, set: 0, forma: 7 }, String(bad));
  }
  for (const bad of [100.5, 101, 2.25, 1e300, -1, -0.1]) assert.equal((await load({ pick: { forma: bad } })).pick.forma, d.forma, String(bad));
});

test("all four reward weights at 0, which the sliders refuse, load as the usual four; Forma's worth stays", async () => {
  const d = defaultSettings().pick;
  assert.deepEqual((await load({ pick: { plat: 0, needed: 0, ducats: 0, set: 0, forma: 12 } })).pick, { ...d, forma: 12 });
  // One taken as the usual value for a bad entry: then they are not all at 0.
  assert.deepEqual((await load({ pick: { plat: 0, needed: 0, ducats: 0, set: -3 } })).pick, { plat: 0, needed: 0, ducats: 0, set: d.set, forma: d.forma });
});

// Relic prices: what waits for the daily read, and a relic named __proto__

test("a recent relic price entry that lost a price keeps its time and 'median', so it waits for the daily read", async () => {
  const at = NOW() - 60_000;
  assert.deepEqual(await priced({ "Neo N1": { at, how: "median", prices: { intact: 5, radiant: "12" } } }), { "Neo N1": { at, how: "median", prices: { intact: 5 } } });
});

test("a relic named __proto__ in the file adds no entry and leaves the table a plain one", async () => {
  const at = NOW() - 1000;
  // As the file's text: an object written here with that name would set its prototype instead.
  const text = `{"market":{"relicPrices":{"__proto__":{"at":${at},"how":"median","prices":{"intact":9}},"Lith A1":{"at":${at},"how":"median","prices":{"intact":4}}}}}`;
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => text, setItem: () => {} };
  const got = (await loadSettings()).market.relicPrices;
  assert.equal(Object.getPrototypeOf(got), Object.prototype);
  assert.deepEqual(Object.keys(got), ["Lith A1"]);
  assert.equal(Object.hasOwn(got, "__proto__"), false);
  assert.equal((got as Record<string, unknown>).at, undefined);
});
