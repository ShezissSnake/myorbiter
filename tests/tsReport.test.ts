// TennoScope's report is checked once where it comes in: a report without what the pages read is
// taken as "runs but doesn't answer", and a health component it doesn't name reads as not known.
// The sidebar's lines and the setup steps then never meet a report they can't read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onceEach, reportOf, statusOf, takeAccountFacts } from "../src/lib/core/tsReport";
import { cycleCost, KUVA_COSTS, kuvaSpent } from "../src/lib/core/rivens";
import { imprintSale } from "../src/lib/core/imprints";
import { firstStart, gameLine, inventoryLine, LIMITS, type Signs } from "../src/lib/core/firstStart";
import { buildModel } from "../src/lib/core/model";
import { foundryBuilds, itemReadyTimes } from "../src/lib/core/foundry";
import type { Bundle } from "../src/lib/core/types";
import { defaultGame, type TennoscopeReport, type TennoscopeStatus } from "../src/lib/backend";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const health = (state: string, message: string) => ({ state, message, last_success: null });
const KEYS = ["game_reader", "log_monitor", "capture", "catalog", "market", "collection_prices", "database", "market_account"];

const good: TennoscopeReport = {
  at: 9_000,
  pid: 42,
  game_running: true,
  health: Object.fromEntries(KEYS.map((k) => [k, health("ready", "ok")])) as TennoscopeReport["health"],
  market: { link: "unlinked", backing: null, presence: { status: null, wanted: null, auto: false } },
  setup: { setup_complete: true, access_mode: "full", desktop_capture_action_available: false },
  last_error: null,
  mastery_rank: 12,
};
const status = (report: unknown): TennoscopeStatus => ({ binary: "/opt/tennoscope", running: true, started_by_myorbiter: true, report: report as TennoscopeReport });

/** The setup steps' signs from a status as the store holds it. */
const signs = (st: TennoscopeStatus | null, now = 0): Signs => ({
  now,
  status: st ? { supported: true, running: st.running, binary: st.binary, report: st.report } : null,
  tsError: null,
  since: 0,
  runningSince: 0,
  asked: null,
  gameSince: null,
  signedInSince: null,
  log: { found: true, signedIn: false },
  pickup: { error: "No inventory read yet", entries: 0, observedAt: null },
  ptraceScope: null,
});

test("a whole report comes through as it is", () => {
  assert.deepEqual(reportOf(good), good);
  assert.deepEqual(statusOf(status(good)), status(good));
  assert.equal(statusOf(null), null);
  assert.deepEqual(statusOf(status(null)), status(null));
});

test("a report without setup or health is taken as no report: TennoScope runs but doesn't answer", () => {
  const other = { at: 9_000, pid: 42, game_running: true, last_error: null };
  for (const bad of [other, { ...good, setup: undefined }, { ...good, health: null }, { ...good, setup: "full" }, { ...good, game_running: "yes" }, "junk", 7, null]) {
    assert.equal(reportOf(bad), null, JSON.stringify(bad));
    const st = statusOf(status(bad));
    assert.equal(st?.report, null);
    // The sidebar's two lines and the setup steps draw from it without an exception.
    assert.doesNotThrow(() => gameLine(signs(st)));
    assert.doesNotThrow(() => inventoryLine(signs(st)));
    assert.equal(inventoryLine(signs(st)).value, "No report");
    const x = firstStart(signs(st, LIMITS.report));
    assert.equal(x.stage, "TennoScope runs but doesn't answer");
    assert.equal(x.stuck, true);
  }
});

test("a health component the report doesn't name reads as not known", () => {
  const few = { ...good, health: { game_reader: health("ready", "Inventory synchronized from warframe-memory"), catalog: "broken" } };
  const r = reportOf(few);
  assert.ok(r);
  for (const k of KEYS) assert.equal(typeof r.health[k as keyof TennoscopeReport["health"]].message, "string", k);
  assert.equal(r.health.game_reader.state, "ready");
  assert.equal(r.health.catalog.state, "unknown");
  assert.equal(r.health.market_account.state, "unknown");
  assert.equal(r.health.market_account.last_success, null);
  // A state of its own invention is not known either.
  assert.equal(reportOf({ ...good, health: { ...good.health, capture: health("sleeping", "zzz") } })?.health.capture.state, "unknown");
  // The panel has words for it.
  assert.match(src("lib/TennoscopeSheet.svelte"), /unknown: "Not known"/);
});

test("a mode or an error in another shape reads as none", () => {
  assert.equal(reportOf({ ...good, setup: { access_mode: "everything" } })?.setup.access_mode, null);
  assert.equal(reportOf({ ...good, setup: {} })?.setup.desktop_capture_action_available, false);
  assert.equal(reportOf({ ...good, last_error: "it broke" })?.last_error, null);
  assert.equal(reportOf({ ...good, last_error: { at: "now", message: "x" } })?.last_error, null);
  assert.deepEqual(reportOf({ ...good, last_error: { at: 5, message: "x" } })?.last_error, { at: 5, message: "x" });
});

test("every way a status comes in goes through the check", () => {
  const store = src("lib/tennoscopeStore.svelte.ts");
  // The status is set in one place, and that place checks it.
  assert.deepEqual(store.match(/this\.status = /g), ["this.status = "]);
  const put = store.slice(store.indexOf("private put("), store.indexOf("private put(") + 400);
  assert.match(put, /statusOf\(/);
  assert.ok(put.indexOf("statusOf(") < put.indexOf("this.status = "));
});

// ------------------------------------------------------------------ the account's facts

/**
 * A whole report as the bundled TennoScope writes it (`bridge_status` in
 * tennoscope/app/src-tauri/src/lib.rs, the rows as warframe-acquisition's inventory.rs makes them),
 * with made-up values. `snapshot` stands in for the collection's own summary, which no page reads.
 */
const bundled = {
  at: 1_763_200_000_000,
  pid: 4242,
  health: {
    ...Object.fromEntries(KEYS.map((k) => [k, { state: "ready", message: "Ready", last_success: "2026-11-15T09:00:00Z" }])),
    game_reader: { state: "ready", message: "Inventory synchronized from warframe-memory", last_success: "2026-11-15T09:00:00Z" },
    market_account: { state: "idle", message: "Not signed in", last_success: null },
    acquisition_stages: [{ stage: "game_discovery", state: "ready", message: "Warframe found" }],
  },
  snapshot: { observed_at: "2026-11-15T09:00:00Z", entries: 1234 },
  market: { link: "linked", backing: "keyring", presence: { status: "ingame", wanted: "ingame", auto: true } },
  setup: { setup_complete: true, access_mode: "full", desktop_capture_action_available: false },
  game_running: true,
  foundry: { "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeBlueprint": 1 },
  foundry_ready: [["/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeBlueprint", 1_763_300_000_000]],
  mastery_rank: 22,
  platinum: 1500,
  credits: 12_345_678,
  endo: 98_765,
  rivens: [
    { type: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", id: "6000000000000000000000a1", fp: { compat: "/Lotus/Weapons/Tenno/Rifle/Soma", lim: 0, lvlReq: 12, lvl: 8, rerolls: 3, pol: "AP_ATTACK", buffs: [{ Tag: "WeaponCritChanceMod", Value: 700_000_000 }, { Tag: "WeaponFireRateMod", Value: 400_000_000 }], curses: [{ Tag: "WeaponZoomFovMod", Value: 100_000_000 }] } },
    { type: "/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare", id: "", fp: { compat: "/Lotus/Weapons/Tenno/Pistol/Lex", lvl: 0, buffs: [{ Tag: "WeaponDamageAmountMod", Value: 1 }] }, pending: { rerolls: 4, buffs: [{ Tag: "WeaponCritDamageMod", Value: 2 }], curses: [] } },
  ],
  imprints: [{ ItemType: "/Lotus/Types/Game/KubrowPet/Imprints/KubrowImprint", Name: "Biscuit", DominantTraits: { Personality: "/Lotus/Types/Game/KubrowPet/SunikaKubrowPetPowerSuit" } }],
  gear: [
    { type: "/Lotus/Powersuits/Rhino/RhinoPrime", f: 1, p: 2, s: "Suits", x: 1_600_000, pol: [[0, "AP_ATTACK"], [3, "AP_POWER"]], shards: [[0, "ACC_RED", "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeAbilityStrength"], [1, null, "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeHealth"]], ab: [[0, "/Lotus/Powersuits/PowersuitAbilities/Roar", 2]] },
    { type: "/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimary", f: 8, p: 0, s: "LongGuns", m: ["/Lotus/Weapons/SolarisUnited/Primary/Barrel/PrimaryBarrelA", "/Lotus/Weapons/SolarisUnited/Primary/Grip/PrimaryGripA"] },
  ],
  consumed_suits: ["/Lotus/Powersuits/Excalibur/Excalibur"],
  last_error: { at: 1_763_199_990_000, message: "access mode is already changing" },
};

/** The same report from a TennoScope that hasn't read the inventory this run: every fact null. */
const beforeRead = { ...bundled, foundry: null, foundry_ready: null, mastery_rank: null, platinum: null, credits: null, endo: null, rivens: null, imprints: null, gear: null, consumed_suits: null };

/** What the page reads of a report: all but `snapshot` and the health's stage list. */
const asRead = (r: Record<string, unknown>): Record<string, unknown> => {
  const { snapshot: _, health, ...rest } = r;
  const { acquisition_stages: __, ...components } = health as Record<string, unknown>;
  return { ...rest, health: components };
};

test("a report from the bundled TennoScope reads as it was written: every fact, every row", () => {
  assert.deepEqual(reportOf(bundled), asRead(bundled));
  assert.deepEqual(reportOf(beforeRead), asRead(beforeRead));
  // Rows are passed as they are, not copied: the account effect compares them to what's saved.
  assert.equal(reportOf(bundled)?.gear, bundled.gear);
});

/** For each fact, shapes no page can read: a list that isn't one, a row that isn't one, a part in another shape. */
const WRONG: Record<string, unknown[]> = {
  foundry: [5, "x", ["/Recipe"], { "/Recipe": "1" }],
  foundry_ready: [5, {}, [5], [["/Recipe"]], [["/Recipe", "soon"]], [[5, 1]], [["/Recipe", 1e16]], [["/Recipe", -1e16]]],
  mastery_rank: ["22", {}, NaN, Infinity],
  platinum: ["1500", [1500]],
  credits: [true],
  endo: [{}],
  rivens: [
    5, {}, "x", [null], [5],
    [{ type: "x", id: "a" }],
    [{ type: "x", id: "a", fp: null }],
    [{ type: 5, id: "a", fp: {} }],
    [{ type: "x", id: 7, fp: {} }],
    [{ type: "x", id: "a", fp: { buffs: "abc" } }],
    [{ type: "x", id: "a", fp: { buffs: [{ Tag: "x" }] } }],
    [{ type: "x", id: "a", fp: { buffs: [], curses: {} } }],
    [{ type: "x", id: "a", fp: { compat: 5 } }],
    [{ type: "x", id: "a", fp: { lvl: "8" } }],
    [{ type: "x", id: "a", fp: { buffs: [] }, pending: "x" }],
    [{ type: "x", id: "a", fp: { buffs: [] }, pending: { buffs: 5 } }],
    // In the shape, and still not readable: an id every object has as a key, a cycle count that
    // isn't a count (it indexes the Kuva costs).
    ...["constructor", "__proto__", "toString", "hasOwnProperty"].map((id) => [{ type: "x", id, fp: { buffs: [{ Tag: "x", Value: 1 }] } }]),
    [{ type: "x", id: "a", fp: { rerolls: 1.5 } }],
    [{ type: "x", id: "a", fp: { rerolls: -1 } }],
    [{ type: "x", id: "a", fp: { buffs: [] }, pending: { rerolls: -2 } }],
  ],
  imprints: [5, {}, "x"],
  gear: [
    5, {}, [null],
    [{ type: 5, f: 0, p: 0 }],
    [{ type: "x", p: 0 }],
    [{ type: "x", f: "1", p: 0 }],
    [{ type: "x", f: 0, p: 0, m: "abc" }],
    [{ type: "x", f: 0, p: 0, m: [5] }],
    [{ type: "x", f: 0, p: 0, m: null }],
    [{ type: "x", f: 0, p: 0, s: 5 }],
    [{ type: "x", f: 0, p: 0, x: "lots" }],
    [{ type: "x", f: 0, p: 0, pol: [[0]] }],
    [{ type: "x", f: 0, p: 0, pol: ["AP_ATTACK"] }],
    [{ type: "x", f: 0, p: 0, shards: [[0, 5, "/x"]] }],
    [{ type: "x", f: 0, p: 0, ab: [[0, "/x"]] }],
  ],
  consumed_suits: [5, {}, "x", [5], [null]],
  market: [5, null, { link: "maybe", backing: null, presence: { status: null, wanted: null, auto: false } }, { link: "linked", backing: null }, { link: "linked", backing: null, presence: { status: "away", wanted: null, auto: false } }],
  pid: ["4242"],
};

test("a fact in another shape is left out whole, and the rest of the report reads as written", () => {
  for (const [key, shapes] of Object.entries(WRONG)) {
    const { [key]: _, ...rest } = asRead(bundled);
    for (const shape of shapes) {
      const label = `${key}: ${JSON.stringify(shape)}`;
      const r = reportOf({ ...bundled, [key]: shape });
      assert.ok(r, label);
      assert.equal(key in r, false, label);
      assert.deepEqual(r, rest, label);
    }
  }
});

test("a report without a time is no report, as the app's own reader takes it", () => {
  assert.equal(reportOf({ ...bundled, at: undefined }), null);
  assert.equal(reportOf({ ...bundled, at: "now" }), null);
});

test("a fact in another shape is never written into the saved game, and what was saved stays", () => {
  const before = defaultGame();
  takeAccountFacts(before, reportOf(bundled)!);
  const saved = JSON.stringify(before);
  for (const [key, shapes] of Object.entries(WRONG)) {
    for (const shape of shapes) {
      const label = `${key}: ${JSON.stringify(shape)}`;
      const g = JSON.parse(saved);
      assert.doesNotThrow(() => takeAccountFacts(g, reportOf({ ...bundled, [key]: shape })!), label);
      assert.equal(JSON.stringify(g), saved, label);
    }
  }
  // A report from before the read leaves every fact as saved.
  const g = JSON.parse(saved);
  takeAccountFacts(g, reportOf(beforeRead)!);
  assert.equal(JSON.stringify(g), saved);
});

test("the bundled report's facts are written as before: each one, and the rivens' history", () => {
  const g = defaultGame();
  takeAccountFacts(g, reportOf(bundled)!);
  assert.deepEqual(g.foundryReady, bundled.foundry_ready);
  assert.equal(g.masteryRank, 22);
  assert.equal(g.platinum, 1500);
  assert.equal(g.credits, 12_345_678);
  assert.equal(g.endo, 98_765);
  assert.deepEqual(g.rivens, bundled.rivens);
  assert.deepEqual(g.imprints, bundled.imprints);
  assert.deepEqual(g.gear, bundled.gear);
  assert.deepEqual(g.consumedSuits, bundled.consumed_suits);
  assert.deepEqual(Object.keys(g.rivenHistory).sort(), ["", "6000000000000000000000a1"]);
});

test("what the check passes, the collection is built from without a throw", () => {
  const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
  const bundle = { observed_at: 1_700_000_000, inventory: [], catalog: [{ uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, vaulted: true, components: [{ uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 }] }], relics: [] } as unknown as Bundle;
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const [key, shapes] of Object.entries(WRONG)) {
      for (const shape of shapes) {
        const r = reportOf({ ...bundled, [key]: shape })!;
        assert.doesNotThrow(() => {
          const m = buildModel(bundle, undefined, r.foundry ?? null, null, r.imprints ?? null, null, r.gear ?? null, r.consumed_suits ?? null);
          foundryBuilds(m, r.foundry_ready ?? [], 0);
          itemReadyTimes(m, r.foundry_ready ?? []);
        }, `${key}: ${JSON.stringify(shape)}`);
      }
    }
  } finally {
    console.error = quiet;
  }
});

test("the account effect writes only through the check", () => {
  const app = src("App.svelte");
  const effect = app.slice(app.indexOf("// TennoScope's read of your account"), app.indexOf("// Foundry builds turning ready"));
  assert.match(effect, /const r = ts\.report;/);
  assert.match(effect, /takeAccountFacts\(g, r\)/);
  // No fact of the report is written there by hand.
  assert.doesNotMatch(effect, /= r\.\w+/);
});

// ------------------------------------------------------------------ in the shape, and still not readable

test("a riven id every object has, a time no date holds, a cycle count that isn't one: refused, and nothing saved or thrown", () => {
  const fp = { buffs: [{ Tag: "WeaponCritChanceMod", Value: 1 }] };
  const before = defaultGame();
  takeAccountFacts(before, reportOf(bundled)!);
  const saved = JSON.stringify(before);
  const cases: [string, unknown][] = [
    ["rivens", [{ type: "x", id: "constructor", fp }]],
    ["rivens", [{ type: "x", id: "__proto__", fp }]],
    ["rivens", [{ type: "x", id: "a", fp: { ...fp, rerolls: 2.5 } }]],
    ["foundry_ready", [["/Recipe", 9e15]]],
  ];
  for (const [key, value] of cases) {
    const label = `${key}: ${JSON.stringify(value)}`;
    const r = reportOf({ ...bundled, [key]: value })!;
    assert.equal(key in r, false, label);
    const g = JSON.parse(saved);
    assert.doesNotThrow(() => takeAccountFacts(g, r), label);
    assert.equal(JSON.stringify(g), saved, label);
  }
  // The edges themselves pass: the latest time a date holds, the empty id, a large whole count.
  assert.ok(reportOf({ ...bundled, foundry_ready: [["/Recipe", 8.64e15]] })?.foundry_ready);
  assert.ok(reportOf({ ...bundled, rivens: [{ type: "x", id: "", fp: { ...fp, rerolls: 1e12 } }] })?.rivens);
});

test("a finish time the check passes is formatted as the pages format it", () => {
  const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
  const bundle = { observed_at: 1_700_000_000, inventory: [], catalog: [{ uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, vaulted: true, components: [{ uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 }] }], relics: [] } as unknown as Bundle;
  const m = buildModel(bundle);
  for (const t of [8.64e15, -8.64e15, 0, 1_763_300_000_000]) {
    const r = reportOf({ ...bundled, foundry_ready: [["/R/Bp", t]] })!;
    // Foundry, Home and the side panel: `new Date(b.readyAt).toISOString()` for a build not ready.
    assert.doesNotThrow(() => foundryBuilds(m, r.foundry_ready!, 0).forEach((b) => new Date(b.readyAt).toISOString()), String(t));
    // Mastery: the same, of the item's ready time.
    assert.doesNotThrow(() => [...itemReadyTimes(m, r.foundry_ready!).values()].forEach((at) => new Date(at).toISOString()), String(t));
  }
});

test("the Kuva a riven's cycles cost is summed at once, for any count the check passes", () => {
  assert.equal(kuvaSpent(0), 0);
  assert.equal(kuvaSpent(10), KUVA_COSTS.reduce((a, b) => a + b, 0));
  assert.equal(kuvaSpent(12), KUVA_COSTS.reduce((a, b) => a + b, 0) + 2 * 3500);
  // A loop of one step per cycle would not end in useful time here.
  const t = Date.now();
  assert.equal(kuvaSpent(1e12), KUVA_COSTS.reduce((a, b) => a + b, 0) + (1e12 - 10) * 3500);
  assert.ok(Date.now() - t < 1000);
  assert.ok(Number.isFinite(cycleCost(1e12)));
});

test("imprints are taken as a list, whatever its rows: the readers skip a row that isn't one", () => {
  const odd = [...bundled.imprints, null, "row", [1], 5];
  const r = reportOf({ ...bundled, imprints: odd })!;
  assert.equal(r.imprints, odd);
  const g = defaultGame();
  takeAccountFacts(g, r);
  assert.deepEqual(g.imprints, odd);
  const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
  const bundle = { observed_at: 1_700_000_000, inventory: [], catalog: [{ uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, vaulted: true, components: [{ uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 }] }], relics: [] } as unknown as Bundle;
  assert.doesNotThrow(() => buildModel(bundle, undefined, null, null, r.imprints ?? null));
  assert.doesNotThrow(() => imprintSale("Imprint of Biscuit", { rows: r.imprints ?? null, itemFor: () => "Sunika Kubrow Imprint", names: ["Sunika Kubrow Imprint"] }));
  // Not a list at all: left out, as before.
  assert.equal("imprints" in reportOf({ ...bundled, imprints: { 0: {} } })!, false);
});

test("a field left out is said in the log: its key only, once a run", () => {
  const heard: string[] = [];
  const once = onceEach((k) => heard.push(k));
  const secret = "ExamplePlayer-secret-row";
  for (let i = 0; i < 3; i++) reportOf({ ...bundled, gear: [{ type: secret }], platinum: "1500", rivens: null }, once);
  assert.deepEqual(heard, ["platinum", "gear"]);
  // What reportOf hands on is the key, never the value.
  const raw: string[] = [];
  reportOf({ ...bundled, gear: [{ type: secret }] }, (k) => raw.push(k));
  assert.deepEqual(raw, ["gear"]);
  // A null (not read this run) and a field in its shape are not left out.
  const none: string[] = [];
  reportOf(beforeRead, (k) => none.push(k));
  reportOf(bundled, (k) => none.push(k));
  assert.deepEqual(none, []);
});

test("every status's check logs through the app's log, the key in a line of fixed words", () => {
  const warned: string[] = [];
  const quiet = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
  try {
    for (let i = 0; i < 3; i++) statusOf(status({ ...bundled, consumed_suits: [{ s: "ExamplePlayer-secret-row" }] }));
  } finally {
    console.warn = quiet;
  }
  // In a browser the app's log is the console (backend.ts, logLine); the desktop app writes it to its log file.
  assert.deepEqual(warned, ['[tennoscope] report: "consumed_suits" left out, not in the shape MyOrbiter reads']);
  const ts = src("lib/core/tsReport.ts");
  assert.match(ts, /noteLeftOut = onceEach\(\(key\) => logLine\("warn", "tennoscope", `report: "\$\{key\}" left out, not in the shape MyOrbiter reads`\)\)/);
});

test("the report's type says which fields may be absent", () => {
  const type = src("lib/backend.ts").slice(src("lib/backend.ts").indexOf("export interface TennoscopeReport {"));
  const body = type.slice(0, type.indexOf("\n}\n"));
  const fields = [...body.matchAll(/^  (\w+)(\??):/gm)].map(([, k, q]) => `${k}${q}`);
  assert.deepEqual(fields, ["at", "pid?", "game_running", "health", "market?", "setup", "last_error", "foundry?", "foundry_ready?", "mastery_rank?", "platinum?", "credits?", "endo?", "rivens?", "imprints?", "gear?", "consumed_suits?"]);
  // What reportOf always gives: the rest may be left out.
  const r = reportOf({ at: 1, game_running: false, setup: {}, health: {} })!;
  assert.deepEqual(Object.keys(r).sort(), ["at", "game_running", "health", "last_error", "setup"]);
});
