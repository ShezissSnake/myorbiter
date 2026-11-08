// Settings fuzzing: random, truncated and hostile settings files through the loader and every
// sanitizer. Whatever the file holds, loading never throws, never turns on anything that lists or
// reprices by itself, never removes a price floor, and never keeps fewer copies than the usual
// rules because a value was junk. Seeds as in tests/support/prop.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, loadSettings } from "../src/lib/backend";
import { defaultSparesRules, sparesRulesOf } from "../src/lib/core/sparesRules";
import { sanitizeUpdates } from "../src/lib/core/updates";
import { sanitizeBuild, sanitizeBuilds, sanitizeMaxAgeDays } from "../src/lib/core/builds/types";
import { normalizeRule } from "../src/lib/core/timers";
import { approvedOf } from "../src/lib/core/approved";
import { DRIFT } from "../src/lib/core/drift";
import { migrateTab } from "../src/lib/pages";
import { marketItemsOf, recipeDataOf, relicDataOf, rivenMetaOf } from "../src/lib/core/shapes";
import { parseMyAuctions } from "../src/lib/core/rivens";
import { noxItems } from "../src/lib/core/builds/noxsframe";
import { parseOverframeFile } from "../src/lib/core/builds/overframeList";
import { buildModel } from "../src/lib/core/model";
import { salesCsv, tradesCsv } from "../src/lib/core/exportCsv";
import { salesByDay } from "../src/lib/core/salesDays";
import { forAll, type Rng } from "./support/prop";

const RUNS = Number(process.env.PROPERTY_RUNS ?? 1500);

/** A value of any kind, the hostile ones over-represented. */
function junk(r: Rng, depth = 0): unknown {
  switch (r.int(0, depth > 2 ? 5 : 8)) {
    case 0: return r.pick([NaN, Infinity, -Infinity, -1, 0, 1e308, -1e308, 2 ** 53 + 1, 0.5, -0.0001, 1e-12]);
    case 1: return r.pick(["", "true", "false", "NaN", "1e9", "0", "-5", "null", "__proto__", "x".repeat(r.int(1, 5000)), "\u202Eevil", "\u0000"]);
    case 2: return r.bool();
    case 3: return null;
    case 4: return undefined;
    case 5: return r.int(-1000, 1000);
    case 6: return Array.from({ length: r.int(0, 4) }, () => junk(r, depth + 1));
    case 7: return Object.fromEntries(Array.from({ length: r.int(0, 4) }, () => [r.pick(["a", "on", "keep", "version", "__proto__", "constructor", "0"]), junk(r, depth + 1)]));
    default: return { version: r.pick([1, 2, 3, "2", null]), on: junk(r, depth + 1), keep: junk(r, depth + 1) };
  }
}

/** Every leaf path of an object, as key lists. */
function paths(v: unknown, at: string[] = []): string[][] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [at];
  return Object.entries(v).flatMap(([k, x]) => paths(x, [...at, k]));
}
const get = (o: unknown, p: string[]) => p.reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);
function set(o: Record<string, unknown>, p: string[], v: unknown) {
  let x = o;
  for (const k of p.slice(0, -1)) {
    if (!x[k] || typeof x[k] !== "object" || Array.isArray(x[k])) x[k] = {};
    x = x[k] as Record<string, unknown>;
  }
  x[p[p.length - 1]] = v;
}

/** A settings file: the usual one with fields swapped for junk, or an old version, or garbage. */
function hostile(r: Rng): unknown {
  const kind = r.int(0, 9);
  if (kind === 0) return junk(r);
  const s = JSON.parse(JSON.stringify(defaultSettings())) as Record<string, unknown>;
  if (kind === 1) {
    // An old file: schema 1, the first Sell spares switches, no spares rules.
    s.schema = 1;
    (s.market as Record<string, unknown>).spares = undefined;
    (s.market as Record<string, unknown>).bulk = { sets: junk(r), arcanes: true, mods: r.bool(), parts: r.bool(), partsKeep: junk(r), other: r.bool(), imprints: true, priority: junk(r) };
  }
  const all = paths(s);
  for (let i = r.int(1, 12); i > 0; i--) {
    const p = r.pick(all);
    if (r.bool(0.15)) set(s, p.slice(0, Math.max(1, p.length - 1)), junk(r));
    else set(s, p, junk(r));
  }
  return s;
}

/** Loads `raw` (or a truncated copy of it) as if it were the saved file. */
async function load(r: Rng, raw: unknown) {
  let text = JSON.stringify(raw) ?? "null";
  if (r.bool(0.1)) text = text.slice(0, r.int(0, text.length));
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => text, setItem: () => {} };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { settings: await loadSettings(), parsed };
}

const usual = defaultSparesRules();
/** A collection read with nothing in it: the settings file's own parts are what's tested. */
const EMPTY_BUNDLE = { observed_at: 1, inventory: [], catalog: [], relics: [], prices: { prices: {}, trade_rate: {} } } as never;
/** Keep numbers: [path, least it may be]. */
const KEEPS: [string[], number][] = [
  [["prime", "keep"], 0],
  [["mods", "keep"], 1],
  [["arcanes", "keepMaxed"], 1],
  [["relics", "keep"], 0],
  [["resources", "margin"], 0],
  [["imprints", "keep"], 0],
  ...Object.keys(usual.mods.families).map((f) => [["mods", "families", f, "keep"], 1] as [string[], number]),
];

test("settings files: loading anything never throws, never turns on automatic repricing or hiding, keeps every floor, and junk never keeps fewer copies", async () => {
  const seeds: number[] = [];
  forAll("seeds", (_r, seed) => void seeds.push(seed), RUNS);
  const { rng } = await import("./support/prop");
  for (const seed of seeds) {
    const r = rng(seed);
    const raw = hostile(r);
    const { settings: s, parsed } = await load(r, raw);
    const m = s.market;
    const rawMarket = (parsed && typeof parsed === "object" ? (parsed as { market?: unknown }).market : undefined) as Record<string, unknown> | undefined;
    const ctx = `PROPERTY_SEED=${seed}: ${JSON.stringify(rawMarket ?? null)?.slice(0, 400)}`;
    // Automatic repricing, checking, and hiding listings on a whisper: on only when the file says true.
    assert.equal(m.auto, rawMarket?.auto === true, `auto: ${ctx}`);
    if (m.autoCheck) assert.ok(rawMarket?.autoCheck === true || (typeof rawMarket?.autoCheck !== "boolean" && rawMarket?.auto === true), `autoCheck: ${ctx}`);
    assert.equal(m.lastCopy.optIn, (rawMarket?.lastCopy as { optIn?: unknown } | undefined)?.optIn === true, `lastCopy: ${ctx}`);
    // Floors: whole, positive, finite; the share of the market price between 0 and 1.
    assert.ok(Number.isInteger(m.minPrice) && m.minPrice >= 1, `minPrice ${m.minPrice}: ${ctx}`);
    assert.ok(Number.isInteger(m.minRelicPrice) && m.minRelicPrice >= 1, `minRelicPrice ${m.minRelicPrice}: ${ctx}`);
    assert.ok(Number.isFinite(m.minShare) && m.minShare >= 0 && m.minShare <= 1, `minShare ${m.minShare}: ${ctx}`);
    assert.ok(Number.isFinite(m.every) && m.every >= 1, `every ${m.every}: ${ctx}`);
    assert.ok(m.floors && typeof m.floors === "object" && Object.values(m.floors).every((v) => Number.isInteger(v) && v >= 1), `floors ${JSON.stringify(m.floors)}: ${ctx}`);
    assert.ok(m.paused && typeof m.paused === "object" && Object.values(m.paused).every((v) => typeof v === "boolean"), `paused: ${ctx}`);
    assert.deepEqual(approvedOf(m.approved), m.approved ?? {}, `approved: ${ctx}`);
    // Repricing's cooldown: whole times of the last day (or later), per listing, never junk that could let a change through sooner.
    assert.ok(m.changes && typeof m.changes === "object" && !Array.isArray(m.changes), `changes: ${ctx}`);
    for (const times of Object.values(m.changes)) assert.ok(Array.isArray(times) && times.length >= 1 && times.length <= DRIFT.perDay && times.every((t) => Number.isInteger(t) && t > Date.now() - DRIFT.dayMs - 60_000), `changes ${JSON.stringify(times)}: ${ctx}`);
    // The ducat rate the ducat check depends on: a finite number, never junk.
    assert.ok(Number.isFinite(s.advice.platPerDucat) && s.advice.platPerDucat >= 0, `platPerDucat ${s.advice.platPerDucat}: ${ctx}`);
    // Keep rules: whole numbers in range; junk where a number belongs gives the usual number.
    const rawSpares = rawMarket?.spares;
    for (const [p, least] of KEEPS) {
      const v = get(m.spares, p) as number;
      assert.ok(Number.isInteger(v) && v >= least, `${p.join(".")} = ${v}: ${ctx}`);
      const given = get(rawSpares, p);
      if (rawSpares && (rawSpares as { version?: unknown }).version === 2 && (typeof given !== "number" || !Number.isFinite(given))) {
        assert.ok(v >= (get(usual, p) as number), `${p.join(".")}: junk ${String(given)} kept ${v}, under the usual ${get(usual, p)}: ${ctx}`);
      }
    }
    assert.ok(Array.isArray(m.spares.neverSell) && m.spares.neverSell.every((n) => typeof n.id === "string" && n.id), `neverSell: ${ctx}`);
    // The sale and trade logs: whole entries only, so Sales, Stats and their exports can read them.
    const fine = (n: unknown) => typeof n === "number" && Number.isFinite(n);
    assert.ok(m.sales.every((x) => x && fine(x.at) && typeof x.item === "string" && x.item && Number.isInteger(x.quantity) && x.quantity >= 1 && fine(x.platinum) && x.platinum >= 0 && (x.rank === null || Number.isInteger(x.rank)) && (x.median === undefined || fine(x.median))), `sales: ${ctx}`);
    assert.ok(m.trades.every((t) => t && fine(t.at) && typeof t.key === "string" && typeof t.partner === "string" && fine(t.platIn) && fine(t.platOut) && [t.offered, t.received].every((xs) => Array.isArray(xs) && xs.every((x) => x && typeof x.name === "string" && Number.isInteger(x.count) && x.count >= 1))), `trades: ${ctx}`);
    assert.doesNotThrow(() => (salesCsv(m.sales), tradesCsv(m.trades), salesByDay(m.sales, Date.now(), 30)), `the logs: ${ctx}`);
    // The saved game state's lists: whole entries only (core/savedGame.ts).
    const g = s.game;
    const objs = (xs: unknown) => Array.isArray(xs) && xs.every((x) => x && typeof x === "object" && !Array.isArray(x));
    assert.ok(objs(g.valueHistory) && g.valueHistory.every((v) => fine(v.at) && fine(v.worth) && fine(v.liquid)), `valueHistory: ${ctx}`);
    assert.ok(objs(g.relicRuns) && g.relicRuns.every((r) => fine(r.at) && Array.isArray(r.cards) && Array.isArray(r.relics)), `relicRuns: ${ctx}`);
    assert.ok(objs(g.notices) && g.notices.every((n) => typeof n.id === "string" && typeof n.read === "boolean"), `notices: ${ctx}`);
    assert.ok(g.gear === null || (objs(g.gear) && g.gear.every((x) => typeof x.type === "string" && fine(x.f))), `gear: ${ctx}`);
    assert.ok(g.rivens === null || (objs(g.rivens) && g.rivens.every((x) => typeof x.id === "string" && x.fp && typeof x.fp === "object")), `rivens: ${ctx}`);
    // What the app builds the collection from (App.svelte): a damaged file mustn't stop it.
    const rawGame = parsed && typeof parsed === "object" ? (parsed as { game?: unknown }).game : undefined;
    assert.doesNotThrow(() => buildModel(EMPTY_BUNDLE, undefined, null, m.relicPrices, s.game.imprints, null, s.game.gear, s.game.consumedSuits), `the collection: PROPERTY_SEED=${seed}: ${JSON.stringify(rawGame ?? null)?.slice(0, 300)}`);
  }
});

test("every other sanitizer and parser takes anything without throwing", () => {
  const parsers: [string, (v: unknown) => unknown][] = [
    ["sparesRulesOf", sparesRulesOf],
    ["sanitizeUpdates", sanitizeUpdates],
    ["sanitizeBuild", sanitizeBuild],
    ["sanitizeBuilds", sanitizeBuilds],
    ["sanitizeMaxAgeDays", sanitizeMaxAgeDays],
    ["normalizeRule", normalizeRule],
    ["approvedOf", approvedOf],
    ["migrateTab", (v) => migrateTab(v as string)],
    ["marketItemsOf", marketItemsOf],
    ["recipeDataOf", recipeDataOf],
    ["relicDataOf", relicDataOf],
    ["rivenMetaOf", rivenMetaOf],
    ["parseMyAuctions", parseMyAuctions],
    ["noxItems", noxItems],
    ["parseOverframeFile", parseOverframeFile],
  ];
  forAll("parsers", (r) => {
    const v = junk(r);
    for (const [name, f] of parsers) {
      try {
        f(v);
      } catch (e) {
        // A parser may refuse data it can't read, in words (warframe.market's riven list): a plain
        // Error with a message. A TypeError or RangeError is a crash.
        if (!(e instanceof Error) || e.constructor !== Error || !e.message) throw new Error(`${name} crashed on ${JSON.stringify(v)?.slice(0, 200)}: ${e}`);
      }
    }
  });
});

test("Sell spares rules: junk in a version 2 file never keeps fewer copies than the usual rules", () => {
  forAll("spares", (r) => {
    const raw = JSON.parse(JSON.stringify(usual)) as Record<string, unknown>;
    const p = r.pick(KEEPS)[0];
    set(raw, p, junk(r));
    const out = sparesRulesOf(raw);
    const v = get(out, p) as number;
    const given = get(raw, p);
    if (typeof given !== "number" || !Number.isFinite(given)) assert.ok(v >= (get(usual, p) as number), `${p.join(".")}: ${String(given)} → ${v}`);
  });
});

test("imprints kept in a damaged settings file don't stop the collection being built (PROPERTY_SEED=1061690)", async () => {
  for (const imprints of [132, {}, [null], "x", [1, { DominantTraits: { a: "/x/PowerSuit" } }]]) {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ game: { imprints } }), setItem: () => {} };
    const s = await loadSettings();
    assert.ok(s.game.imprints === null || (Array.isArray(s.game.imprints) && s.game.imprints.every((x) => x && typeof x === "object")), JSON.stringify(s.game.imprints));
    assert.doesNotThrow(() => buildModel(EMPTY_BUNDLE, undefined, null, null, s.game.imprints));
  }
  assert.doesNotThrow(() => buildModel(EMPTY_BUNDLE, undefined, null, null, [null, 4] as never), "the model skips a row that isn't one");
});
