// Saving the settings: what's saved is the whole settings object, and a small change doesn't
// re-read the long logs.
import { flush, effectRoot } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, HEAVY_SETTINGS, joinSettings, lightSettings, type Settings } from "../src/lib/backend";

const { persistSettings } = await import("../src/lib/persist.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const { proxy } = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T };

/** Settings of someone who has used orbiter for a year. */
function bigSettings(): Settings {
  const s = defaultSettings();
  const item = (i: number) => ({ name: `Item ${i % 300} Prime Blueprint`, rank: i % 5 ? null : 5, count: 1 + (i % 3) });
  s.market.sales = Array.from({ length: 2000 }, (_, i) => ({ at: 1.7e12 + i * 6e5, item: `Item ${i % 300}`, rank: null, quantity: 1, platinum: 10 + (i % 50) }));
  s.market.trades = Array.from({ length: 2000 }, (_, i) => ({ key: `1|${i}`, at: 1.7e12 + i * 6e5, partner: `B${i}`, offered: [item(i), item(i + 1)], received: [], platOut: 0, platIn: 30 }));
  s.game.valueHistory = Array.from({ length: 1500 }, (_, i) => ({ at: 1.7e12 + i * 2.16e7, worth: i, liquid: i, platinum: 300, credits: 5e6, endo: 1e5, held: { ducats: 1, aya: 2, kuva: 3, traces: 4, vosfor: 5, essence: 6, relics: 7 } }));
  s.game.rivenHistory = { r1: [{ at: 1, rerolls: 2, buffs: [], curses: [] }] } as unknown as Settings["game"]["rivenHistory"];
  return s;
}

test("the light part and the long logs put back together are the settings", () => {
  const s = bigSettings();
  const heavy = Object.fromEntries(HEAVY_SETTINGS.map(([a, b]) => [`${a}.${b}`, JSON.stringify((s[a] as unknown as Record<string, unknown>)[b])]));
  assert.deepEqual(joinSettings(JSON.stringify(lightSettings(s)), heavy), JSON.parse(JSON.stringify(s)));
});

test("each change is saved, and switching pages doesn't re-read the sales and trade logs", () => {
  const settings = proxy(bigSettings());
  let pending: (() => Settings) | null = null;
  let saves = 0;
  const stop = effectRoot(() =>
    persistSettings(
      () => settings,
      () => true,
      (get) => {
        saves++;
        pending = get;
      },
    ),
  );
  flush();
  assert.deepEqual(pending!(), JSON.parse(JSON.stringify(settings)));

  // Count how often a long log is serialized from here on.
  const stringify = JSON.stringify;
  let longReads = 0;
  JSON.stringify = ((v: unknown, ...rest: []) => {
    if (Array.isArray(v) && v.length >= 1500) longReads++;
    return stringify(v, ...rest);
  }) as typeof JSON.stringify;
  try {
    saves = 0;
    const t0 = performance.now();
    settings.tab = "market";
    flush();
    const ms = performance.now() - t0;
    assert.ok(saves > 0, "the change is saved");
    assert.equal(longReads, 0, "no long log re-read for a page switch");
    assert.ok(ms < 50, `a small change took ${ms.toFixed(1)} ms`);
    assert.equal(pending!().tab, "market");

    settings.market.sales = [{ at: 1, item: "Forma Blueprint", rank: null, quantity: 1, platinum: 5 }, ...settings.market.sales];
    flush();
    assert.equal(longReads, 1, "a new sale re-reads the sales log only");
    assert.equal(pending!().market.sales[0].item, "Forma Blueprint");
    assert.equal(pending!().market.trades.length, 2000);

    // A change deep inside a log is seen too.
    settings.game.valueHistory[3].worth = -1;
    flush();
    assert.equal(pending!().game.valueHistory[3].worth, -1);
  } finally {
    JSON.stringify = stringify;
    stop();
  }
});

test("a save after a page switch doesn't read the long logs back again", () => {
  const s = bigSettings();
  const heavy = Object.fromEntries(HEAVY_SETTINGS.map(([a, b]) => [`${a}.${b}`, JSON.stringify((s[a] as unknown as Record<string, unknown>)[b])]));
  const kept = new Map();
  const first = joinSettings(JSON.stringify(lightSettings(s)), heavy, kept);
  const next = joinSettings(JSON.stringify(lightSettings({ ...s, tab: "market" })), heavy, kept);
  assert.equal(next.tab, "market");
  assert.equal(next.market.trades, first.market.trades, "the trade log is the one read before");
  const sold = { ...heavy, "market.sales": JSON.stringify([{ at: 1, item: "Forma Blueprint", rank: null, quantity: 1, platinum: 5 }]) };
  const after = joinSettings(JSON.stringify(lightSettings(s)), sold, kept);
  assert.equal(after.market.sales[0].item, "Forma Blueprint", "a changed log is read again");
  assert.equal(after.market.trades, first.market.trades);
});

test("nothing is saved before the settings are loaded", () => {
  const settings = proxy(defaultSettings());
  let saves = 0;
  const stop = effectRoot(() => persistSettings(() => settings, () => false, () => saves++));
  flush();
  settings.tab = "x";
  flush();
  stop();
  assert.equal(saves, 0);
});
