// A floor has a limit, 100,000p (backend.ts › MAX_SAVED_PRICE, the one minimum prices have).
// Orders' Floor field refuses a value over it and says so, rather than save one the next start
// would not keep; a floor already saved above it is cut to the limit at the start, never dropped.
// A pause turned off is kept, so a filled sculpture's "not paused" holds over the empty one's.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_SAVED_PRICE, defaultSettings, flushSettings, loadSettings, saveSettings } from "../src/lib/backend";
import { floorTyped, isPaused, ownFloor } from "../src/lib/core/market";

const stored = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
};
beforeEach(() => stored.clear());

async function loadMarket(market: Record<string, unknown>) {
  const file = defaultSettings();
  stored.set("orbiter-settings", JSON.stringify({ ...file, market: { ...file.market, ...market } }));
  return (await loadSettings()).market;
}

test("the limit is 100,000p", () => assert.equal(MAX_SAVED_PRICE, 100_000));

test("the Floor field takes a floor up to the limit, clears on empty, and refuses over it", () => {
  assert.equal(floorTyped("45", MAX_SAVED_PRICE), 45);
  assert.equal(floorTyped("100000", MAX_SAVED_PRICE), 100_000);
  assert.equal(floorTyped("12.4", MAX_SAVED_PRICE), 13);
  assert.equal(floorTyped("", MAX_SAVED_PRICE), null);
  assert.equal(floorTyped("0", MAX_SAVED_PRICE), "keep");
  assert.equal(floorTyped("100001", MAX_SAVED_PRICE), "over");
  assert.equal(floorTyped("150000", MAX_SAVED_PRICE), "over");
});

test("a floor with a fraction rounds up; a box the browser can't read, or 0 or less, leaves the floor as it was; only an emptied box is automatic", () => {
  assert.equal(floorTyped("12.01", MAX_SAVED_PRICE), 13, "never under what was typed");
  assert.equal(floorTyped("0.4", MAX_SAVED_PRICE), 1);
  assert.equal(floorTyped("99999.5", MAX_SAVED_PRICE), 100_000);
  assert.equal(floorTyped("100000.2", MAX_SAVED_PRICE), "over");
  // "12-" or "e" in a number box: the browser gives "" and flags it as bad input.
  assert.equal(floorTyped("", MAX_SAVED_PRICE, true), "keep", "not an emptied box: the floor stays");
  assert.equal(floorTyped("", MAX_SAVED_PRICE, false), null, "emptied: the automatic floor");
  assert.equal(floorTyped("-3", MAX_SAVED_PRICE), "keep");
  assert.equal(floorTyped("0", MAX_SAVED_PRICE), "keep");
  const src = readFileSync(new URL("../src/lib/tabs/Orders.svelte", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("function setFloor("), src.indexOf("function togglePause("));
  assert.match(body, /floorTyped\(input\.value, MAX_SAVED_PRICE, input\.validity\.badInput\)/);
  assert.match(body, /if \(floor === "keep"\) \{\s*input\.value = String\(floorOf\(o\) \?\? ""\);\s*return;/, "the box shows the floor kept");
});

test("Orders' Floor field uses that rule with the loader's limit, and says the limit when it refuses", () => {
  const src = readFileSync(new URL("../src/lib/tabs/Orders.svelte", import.meta.url), "utf8");
  assert.match(src, /floorTyped\(input\.value, MAX_SAVED_PRICE, input\.validity\.badInput\)/);
  assert.match(src, /Not saved: a floor goes up to \{MAX_SAVED_PRICE\.toLocaleString\("en"\)\}p/);
  assert.match(src, /max=\{MAX_SAVED_PRICE\}/);
});

test("the Floor field's refusal ends: after a few seconds, or when the field is used again", () => {
  const src = readFileSync(new URL("../src/lib/tabs/Orders.svelte", import.meta.url), "utf8");
  assert.match(src, /setTimeout\(\(\) => floorRefusalGone\(o\.id\), FLOOR_REFUSAL_MS\)/);
  assert.match(src, /onfocus=\{\(\) => floorRefusalGone\(o\.id\)\}/);
  assert.match(src, /const FLOOR_REFUSAL_MS = \d{4};/);
});

test("a floor saved above the limit is cut to it at the start, never dropped; the rest load as before", async () => {
  const m = await loadMarket({ floors: { "a||": 150_000, "b||": 100_000, "c||": 50, "ay|||2|2": 1e9, "d||": 0, "e||": "9", "f||": 2.5, "g||": -3 } });
  assert.deepEqual(m.floors, { "a||": 100_000, "b||": 100_000, "c||": 50, "ay|||2|2": 100_000 });
});

test("a pause turned off is kept; anything that isn't true or false is not", async () => {
  const m = await loadMarket({ paused: { "x||": true, "y||": false, "z||": "yes", "w||": 1 } });
  assert.deepEqual(m.paused, { "x||": true, "y||": false });
});

test("a filled sculpture unpaused on Orders stays unpaused after a restart, the empty one's pause kept", async () => {
  const filled = { itemId: "ay", rank: null, subtype: null, amberStars: 2, cyanStars: 2 };
  const empty = { itemId: "ay", rank: null, subtype: null };
  const s = defaultSettings();
  s.market.paused = { "ay||": true, "ay|||2|2": false };
  saveSettings(s);
  await flushSettings();
  const m = (await loadSettings()).market;
  assert.equal(isPaused(m.paused, filled), false);
  assert.equal(isPaused(m.paused, empty), true);
});

test("a floor cut to the limit is still the listing's floor", async () => {
  const m = await loadMarket({ floors: { "a||": 250_000 } });
  assert.equal(ownFloor(m.floors, { itemId: "a", rank: null, subtype: null }, null), 100_000);
});
