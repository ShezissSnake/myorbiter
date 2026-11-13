// The settings loader (backend.ts › loadSettings) and the save, on the browser path: a file with
// every field set to a valid value that isn't the default loads as itself, and saved and loaded
// again is the same; the lines that carry an older build's file forward change only what they
// are for. The desktop path's save is in settingsDesktopSave.test.ts.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { defaultNotify, defaultSettings, flushSettings, loadSettings, saveSettings, type Settings } from "../src/lib/backend";

const stored = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
};
beforeEach(() => stored.clear());

const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const HOUR = 3_600_000;

/** Every field set to a valid value that isn't its default. Times are relative to now where the loader keeps only recent or future ones. */
function full(now = Date.now()): Settings {
  return {
    advice: { platPerDucat: 0.25, minPlat: 7, slowBelow: 2, squad: 4, maxMissing: 3, vosforLens: "market" },
    market: {
      platform: "xbox",
      auto: true,
      autoCheck: true,
      every: 15,
      minShare: 0.6,
      floors: { "alpha|0|": 12 },
      paused: { "alpha|0|": true },
      approved: { "alpha|0|": 30 },
      changes: { "alpha|0|": [now - 3 * HOUR, now - HOUR] },
      presence: "online",
      presenceBack: { p: "invisible", until: now + HOUR },
      ordersSort: { key: "price", desc: true },
      minPrice: 12,
      minByCategory: { relics: 4, mods: 6 },
      relicPrices: { "Lith Z9": { at: 1_700_000_000_000, prices: { intact: 2, radiant: 9 } } },
      spares: {
        version: 2,
        prime: { on: false, sellAs: "parts", onlyRelicsHeld: true, keep: 1 },
        mods: {
          on: false,
          keep: 3,
          dailyOnly: false,
          families: { primed: { on: false, keep: 3 }, galvanized: { on: false, keep: 4 }, augment: { on: false, keep: 3 }, stance: { on: false, keep: 1 }, requiem: { on: false, keep: 6 }, antivirus: { on: false, keep: 7 } },
        },
        arcanes: { on: false, which: "any", legendary: false, keepMaxed: 2 },
        relics: { on: true, keep: 2 },
        gear: { on: false, sellAs: "parts" },
        resources: { on: true, families: { gems: false, fish: false, ayatan: false, stars: false, captura: false, lenses: false, other: false }, ayatan: "filled", margin: 5 },
        imprints: { on: false, keep: 1 },
        priority: "trades",
        neverSell: [{ id: "alpha", name: "Example Alpha", cat: "mods" }],
      },
      sellable: { veiledRivens: true, relicsWorthSelling: true, saveForSets: false },
      sales: [{ at: 1_700_000_000_000, item: "Example Alpha", rank: 0, quantity: 1, platinum: 20, median: 18, trade: "t1", wfm: "o1" }],
      autoTrades: true,
      tradesSeen: ["t1"],
      tradesTold: ["t1"],
      trades: [{ key: "t1", at: 1_700_000_000_000, partner: "Tenno_Alpha", offered: [{ name: "Example Alpha", rank: 0, count: 1 }], received: [], platOut: 0, platIn: 20 }],
      buyAlerts: [{ name: "Example Bravo", rank: null, subtype: null, maxPrice: 15, at: 1_700_000_000_000 }],
      rep: { "Tenno_Alpha": "given", "Tenno_Bravo": "skipped" },
      repText: "Thanks for the trade",
      autoRep: true,
      lastCopy: { optIn: true, minutes: 20, hidden: [{ id: "o1", at: 1_700_000_000_000 }] },
    },
    pick: { plat: 5, needed: 6, ducats: 7, set: 2, forma: 4 },
    jumpToPick: false,
    overlay: { reward: false, kiosk: false, riven: false, rivenKey: "Ctrl+Shift+R", show: { mastered: false, vault: false, set: false, plat: false, ducats: false, pick: false } },
    tennoscope: { launch: false, opaqueOverlay: true },
    dataDir: "/home/user/example-data",
    eeLog: "/home/user/example/EE.log",
    withoutInventory: true,
    fullModeAsked: true,
    homeHidden: ["baro"],
    homeFissures: "steel",
    homeFissuresOnly: true,
    side: { on: false, cards: ["alerts"] },
    homeDismissed: ["welcome"],
    notify: Object.fromEntries(Object.keys(defaultNotify()).map((k) => [k, false])) as unknown as Settings["notify"],
    notifyOptions: { paused: true, pausedUntil: now + HOUR, pausedHow: "hour", toasts: false, desktop: false, quietInFissure: true, quiet: ["deals"], discord: { url: "https://discord.com/api/webhooks/1/example", kinds: ["sold"] } },
    pagesHidden: ["stats"],
    newsSeen: "21",
    simplified: 2,
    details: true,
    chores: { daily: now + 10 * HOUR },
    startDone: true,
    homeChosen: true,
    pageOrder: ["home", "market", "spares", "sales"],
    startPage: "market",
    tab: "sales",
    folded: true,
    sectionsClosed: ["Trade"],
    meters: [["alpha", 3]],
    plannerMode: "radiant",
    schema: 2,
    notifiedInvasions: ["inv1"],
    game: {
      foundryReady: [["/Example/Blueprint", 1_700_000_000_000]],
      masteryRank: 12,
      platinum: 345,
      credits: 1_000_000,
      endo: 5000,
      rivens: [{ type: "/Example/RivenMod", id: "rv1", fp: { compat: "/Example/Rifle", rerolls: 3 } }],
      imprints: [{ type: "/Example/Imprint" } as never],
      gear: [{ type: "/Example/Rifle", f: 1, p: 2 }],
      consumedSuits: ["/Example/Frame"],
      keepGear: ["/Example/Rifle"],
      rivenHistory: { rv1: [{ at: 1_700_000_000_000, rerolls: 2, buffs: [], curses: [] }] },
      foundryNotified: ["fn1"],
      whispersSeen: ["ws1"],
      chatsSeen: { c1: "m1" },
      dealsNotified: ["dn1"],
      fissuresNotified: ["fi1"],
      rivensNotified: ["rn1"],
      cyclesNotified: ["cy1"],
      shortNotified: ["sh1"],
      valueHistory: [{ at: 1_700_000_000_000, worth: 1000, liquid: 400, platinum: 345 }],
      relicRuns: [{ at: 1_700_000_000_000, cards: ["Example Alpha"], relics: ["/Example/Relic/Radiant"] }],
      drops: { at: 1_700_000_000_000, counts: { "/Example/Part": 2 }, windows: [{ from: 1_699_000_000_000, at: 1_700_000_000_000, gains: { "/Example/Part": 1 } }] },
      savingFor: { "/Example/Part": { set: "Example Prime Set", complete: 1 } },
      notices: [{ id: "n1", at: 1_700_000_000_000, kind: "sold", title: "Sold", body: "Example Alpha", read: true }],
      worldNotified: ["wn1"],
    },
    favourites: ["Example Rifle"],
    fissureRules: [{ id: "f1", kinds: ["storm"], tiers: ["Axi"], missions: ["Survival"], planets: ["Jupiter"] }],
    rivenWatch: [{ id: "w1", weapon: "/Example/Rifle", weaponName: "Example Rifle", positive: ["damage"], negative: null, maxPrice: 300 }],
    builds: [{ id: "b1", item: "/Example/Rifle", kind: "primary", mods: [{ path: "/Example/Mods/Alpha", rank: 5 }], arcanes: [], shards: [], source: "mine", importedAt: 1_700_000_000_000 }],
    buildsMaxAgeDays: 365,
    buildsFromNox: false,
    recordTimings: true,
    updates: { channel: "experimental", later: "0.2.130", lastCheck: 1_700_000_000_000, from: { version: "0.2.120", channel: "stable" }, picked: false },
  };
}

/**
 * Fields the loader sets whatever the file says (so the fixture holds their one value): the
 * schema and page-list versions, the old switches and relic minimum it drops (Sell spares keeps
 * them under `spares`), the relic switch that is always on, and the rules' own version.
 */
const FIXED = new Set(["schema", "simplified", "market.bulk", "market.minRelicPrice", "market.sellable.relicsWorthSelling", "market.spares.version"]);

const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/**
 * Where the fixture doesn't cover `base`: a field it lacks, or (with `values`, against the
 * defaults) one it leaves at the default, an empty list or record counting as a default.
 */
function uncovered(base: unknown, fix: unknown, path: string, out: string[], values = true) {
  if (FIXED.has(path)) return;
  if (plain(base) && Object.keys(base).length) {
    if (!plain(fix)) return void out.push(`${path}: not an object`);
    for (const k of Object.keys(base)) {
      const p = path ? `${path}.${k}` : k;
      if (FIXED.has(p)) continue;
      if (!(k in fix)) out.push(`${p}: missing`);
      else uncovered(base[k], fix[k], p, out, values);
    }
    return;
  }
  if (values && JSON.stringify(base) === JSON.stringify(fix)) out.push(`${path}: the default`);
}

test("the fixture sets every field the settings have, each to something other than its default", async () => {
  // A field added to the settings (to defaultSettings, or one the loader adds to what it reads)
  // and not to the fixture is listed here, and the test fails until the fixture holds it.
  const out: string[] = [];
  uncovered(defaultSettings(), full(), "", out);
  // What the loader makes of no file at all: the fields it adds that the defaults don't have.
  // Only the fields are checked here (a new install's update settings differ from the defaults).
  uncovered(await loadSettings(), full(), "", out, false);
  assert.deepEqual([...new Set(out)], []);
});

test("a full, valid settings file loads as itself, and saved and loaded again it is the same", async () => {
  const file = full();
  stored.set("orbiter-settings", JSON.stringify(file));
  const loaded = await loadSettings();
  assert.deepEqual(json(loaded), json(file));
  saveSettings(loaded);
  await flushSettings();
  const again = await loadSettings();
  assert.deepEqual(json(again), json(file));
});

test("an older file with one switch for your listings' notices: off, the sold and repriced notices are off, the others as they were", async () => {
  const file = full();
  const old: Record<string, boolean> = { ...defaultNotify(), market: false, reward: false, deals: false };
  delete old.sold;
  delete old.repriced;
  stored.set("orbiter-settings", JSON.stringify({ ...file, notify: old }));
  const loaded = await loadSettings();
  assert.deepEqual(loaded.notify, { ...defaultNotify(), market: false, reward: false, deals: false, sold: false, repriced: false });
  assert.deepEqual(json({ ...loaded, notify: null }), json({ ...file, notify: null }), "nothing else changed");
  // On, they stay on.
  stored.set("orbiter-settings", JSON.stringify({ ...file, notify: { ...old, market: true } }));
  assert.deepEqual((await loadSettings()).notify, { ...defaultNotify(), reward: false, deals: false });
});

test("an older file from before the page sections starts with an empty page order and nothing else reset", async () => {
  const file = full();
  stored.set("orbiter-settings", JSON.stringify({ ...file, simplified: 1 }));
  const loaded = await loadSettings();
  assert.deepEqual(loaded.pageOrder, []);
  assert.deepEqual(json(loaded), json({ ...file, pageOrder: [] }), "nothing else reset");
});
