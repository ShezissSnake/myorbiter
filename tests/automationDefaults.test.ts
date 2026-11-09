// Automatic actions on warframe.market (marking sales sold from the game, +rep) are off for a new
// install and stay off until turned on: only an explicit true in the settings file survives loading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, loadSettings } from "../src/lib/backend";

/** Loads `text` as if it were the saved settings file (null: there is none, a new install). */
async function loadFrom(text: string | null) {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => text, setItem: () => {} };
  return loadSettings();
}

test("a new install has automatic sold marking and automatic +rep off, like repricing", async () => {
  const d = defaultSettings().market;
  assert.equal(d.autoTrades, false);
  assert.equal(d.autoRep, false);
  assert.equal(d.auto, false);
  const s = await loadFrom(null);
  assert.equal(s.market.autoTrades, false);
  assert.equal(s.market.autoRep, false);
  assert.equal(s.market.auto, false);
});

test("an older file that turned them on keeps them on", async () => {
  const s = await loadFrom(JSON.stringify({ market: { autoTrades: true, autoRep: true } }));
  assert.equal(s.market.autoTrades, true);
  assert.equal(s.market.autoRep, true);
});

test("an older file without the keys has them off", async () => {
  const s = await loadFrom(JSON.stringify({ market: { minPrice: 12 } }));
  assert.equal(s.market.minPrice, 12);
  assert.equal(s.market.autoTrades, false);
  assert.equal(s.market.autoRep, false);
});

test("anything but true is off: false, a string, a number, null", async () => {
  for (const v of [false, "true", 1, null, {}, []]) {
    const s = await loadFrom(JSON.stringify({ market: { autoTrades: v, autoRep: v } }));
    assert.equal(s.market.autoTrades, false, JSON.stringify(v));
    assert.equal(s.market.autoRep, false, JSON.stringify(v));
  }
});
