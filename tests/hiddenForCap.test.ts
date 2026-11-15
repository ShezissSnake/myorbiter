// "Hidden for" (market.lastCopy.minutes) has one upper limit, MAX_HIDE_MINUTES, however it got
// into the settings: a saved longer time loads as the limit, and the field cuts what is typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadSettings } from "../src/lib/backend";
import { DEFAULT_HIDE_MINUTES, MAX_HIDE_MINUTES, hideMinutesOf } from "../src/lib/core/lastCopy";

async function loaded(minutes: unknown): Promise<number> {
  const text = JSON.stringify({ market: { lastCopy: { optIn: true, minutes } } });
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => text, setItem: () => {} };
  return (await loadSettings()).market.lastCopy.minutes;
}

test("the limit is 120 minutes, above the default", () => {
  assert.equal(MAX_HIDE_MINUTES, 120);
  assert.ok(DEFAULT_HIDE_MINUTES < MAX_HIDE_MINUTES);
});

test("a saved time over the limit loads as the limit, not the default", async () => {
  for (const big of [121, 300, 1440, 1e9]) assert.equal(await loaded(big), MAX_HIDE_MINUTES, String(big));
  assert.equal(await loaded(120.6), MAX_HIDE_MINUTES, "rounds up to 121, then cut");
});

test("120 and 1 load unchanged; a fraction of 1 or more rounds as before", async () => {
  assert.equal(await loaded(120), 120);
  assert.equal(await loaded(1), 1);
  assert.equal(await loaded(45), 45);
  assert.equal(await loaded(5.4), 5);
});

test("0, a fraction under 1, a negative, text and nothing load as the default, as before", async () => {
  for (const bad of [0, 0.5, -5, "300", "x", null, undefined, true, {}, []]) assert.equal(await loaded(bad), DEFAULT_HIDE_MINUTES, JSON.stringify(bad) ?? "undefined");
  assert.equal(hideMinutesOf(Number.NaN), DEFAULT_HIDE_MINUTES);
  assert.equal(hideMinutesOf(Number.POSITIVE_INFINITY), MAX_HIDE_MINUTES);
});

test("Settings builds the field's max and its hint from the constant, and cuts a typed time", () => {
  const src = readFileSync(new URL("../src/lib/SettingsSheet.svelte", import.meta.url), "utf8");
  assert.match(src, /max=\{MAX_HIDE_MINUTES\}/);
  assert.match(src, /at most \{MAX_HIDE_MINUTES\}/);
  assert.match(src, /oninput=\{cutHideMinutes\}/);
  assert.match(src, /valueAsNumber > MAX_HIDE_MINUTES[\s\S]{0,200}lastCopy\.minutes = MAX_HIDE_MINUTES/);
  assert.doesNotMatch(src, /a longer time typed in is kept/);
});
