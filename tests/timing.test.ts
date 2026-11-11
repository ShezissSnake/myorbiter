// Record timings (src/lib/timing.ts): keys kept as kinds, the setting off unless switched on, and a
// report made of numbers, the page's id and the kind of control, never what was typed or named.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Recorder, keyKind, type Action } from "../src/lib/timing";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) => keyKind({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test("a key is kept as its kind, never the character typed", () => {
  for (const k of ["1", "9", "a", "Z", "é", "€"]) assert.equal(key(k), "typing");
  assert.equal(key("Enter"), "Enter");
  assert.equal(key("Escape"), "Escape");
  assert.equal(key(" "), "Space");
  assert.equal(key("ArrowDown"), "navigation");
  assert.equal(key("Backspace"), "erase");
  assert.equal(key("F1"), "F1");
  assert.equal(key("k", { ctrlKey: true }), "shortcut");
  assert.equal(key("Dead"), "other");
});

test("Record timings is off unless switched on", async () => {
  const { loadSettings, defaultSettings } = await import("../src/lib/backend");
  assert.equal(defaultSettings().recordTimings, false);
  const as = async (v: unknown) => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(v) };
    return (await loadSettings()).recordTimings;
  };
  assert.equal(await as({ recordTimings: true }), true);
  assert.equal(await as({ recordTimings: "yes" }), false);
  assert.equal(await as({ recordTimings: 1 }), false);
  assert.equal(await as({}), false, "settings from before it: off");
});

/** Just enough of a window for the recorder to switch on in Node. */
function fakeWindow() {
  const g = globalThis as Record<string, unknown>;
  const noop = () => {};
  g.window = { addEventListener: noop, removeEventListener: noop, innerWidth: 1600, innerHeight: 1000, devicePixelRatio: 1 };
  g.document = { addEventListener: noop, removeEventListener: noop, visibilityState: "visible", hasFocus: () => true, body: {} };
  g.requestAnimationFrame = () => 1;
  g.cancelAnimationFrame = noop;
  return () => {
    for (const k of ["window", "document", "requestAnimationFrame", "cancelAnimationFrame"]) delete g[k];
  };
}

test("off, the hooks record nothing and ticks only run", () => {
  const rec = new Recorder();
  rec.command("market_my_orders", 120, true, false);
  assert.equal(rec.tick("sync", () => 42), 42);
  assert.deepEqual(rec.data().commands, []);
});

test("the report: slowest actions, stalls, frames, commands, sizes; no name, price or path", async () => {
  const restore = fakeWindow();
  try {
    const rec = new Recorder();
    const lines: string[] = [];
    rec.enable({ page: () => "orders", sizes: () => ({ "inventory entries": 861, listings: 12, "pages mounted": 19 }), gameRunning: () => false, log: (l) => lines.push(l) });
    assert.equal(rec.on, true);
    for (const [name, ms] of [["presence_state", 4], ["presence_state", 9], ["market_my_orders", 310]] as const) rec.command(name, ms, true, false);
    rec.command("market_create", 50, false, false);
    rec.command("log_line", 1, true, true);
    assert.equal(await rec.tick("sync", async () => "done"), "done");
    const keep = (rec as unknown as { keep(a: Action): void }).keep.bind(rec);
    for (let i = 0; i < 14; i++) keep({ at: i * 1000, how: "click", page: "orders", to: i % 2 ? "mastery" : null, control: "button in sidebar", paint: 20 + i, settled: 100 + i * 10, capped: i === 13, stall: i === 12 ? 140 : 0, ticks: i === 12 ? ["market poll"] : [] });
    const text = rec.report({ version: "0.2.999", os: "Example Linux 1", arch: "x86_64", engine: "WebKitGTK 2.54.2", frames: "shared memory (the NVIDIA default), Wayland", gpu: "NVIDIA", processStart: null, runStart: null }, { window: "1600×1000", scale: 1 });
    assert.match(text, /^MyOrbiter timing report/);
    assert.match(text, /Version 0\.2\.999 · Example Linux 1 x86_64 · WebKitGTK 2\.54\.2/);
    assert.match(text, /861 inventory entries, 12 listings, 19 pages mounted/);
    assert.match(text, /game running: no/);
    assert.match(text, /Slowest 10 actions \(of 14\)/);
    assert.match(text, /33 \/   230\+ orders → mastery, click, button in sidebar/);
    assert.match(text, /stall 140 · during market poll/);
    assert.match(text, /\s1\s+0\s+310\.0\s+310\s+market_my_orders/);
    assert.match(text, /\s2\s+0\s+6\.5\s+9\s+presence_state/);
    assert.match(text, /\s1\s+1\s+50\.0\s+50\s+market_create/);
    assert.match(text, /log_line: 1 ×/);
    assert.doesNotMatch(text, /undefined|NaN|null/);
    // Nothing but numbers, fixed words, the page's id and the system.
    assert.doesNotMatch(text, /\/home\/|\\Users\\|platinum|\bp\b/);
    rec.disable();
    assert.equal(rec.on, false);
  } finally {
    restore();
  }
});
