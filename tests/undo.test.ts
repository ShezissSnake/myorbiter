// Undo instead of instant loss: a dismissal waits, and Undo in that time changes nothing.
import { effectRoot, flush } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, flushSettings, quit } from "../src/lib/backend";

const { UndoSlots } = await import("../src/lib/undo.svelte");
const { persistSettings } = await import("../src/lib/persist.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const { proxy } = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T };
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the change is made only once the time is up", async () => {
  const u = new UndoSlots(10);
  let gone = 0;
  u.hold("a", () => gone++);
  assert.equal(u.has("a"), true);
  assert.equal(gone, 0);
  await later(30);
  assert.equal(gone, 1);
  assert.equal(u.has("a"), false);
});

test("Undo in time changes nothing", async () => {
  const u = new UndoSlots(10);
  let gone = 0;
  u.hold("a", () => gone++);
  u.undo("a");
  await later(30);
  assert.equal(gone, 0);
  assert.equal(u.has("a"), false);
});

test("leaving the page makes every waiting change at once", () => {
  const u = new UndoSlots(10_000);
  const made: string[] = [];
  u.hold("a", () => made.push("a"));
  u.hold("b", () => made.push("b"));
  u.flush();
  assert.deepEqual(made, ["a", "b"]);
  assert.deepEqual(u.held, {});
});

test("holding a key again restarts its wait and makes the change once", async () => {
  const u = new UndoSlots(20);
  let gone = 0;
  u.hold("a", () => gone++);
  await later(10);
  u.hold("a", () => gone++);
  await later(15);
  assert.equal(gone, 0, "restarted");
  await later(20);
  assert.equal(gone, 1);
});

test("quitting within the Undo's five seconds makes the removal first, and saves it", async () => {
  const stored: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: (k: string, v: string) => (stored[k] = v) };
  const settings = proxy(defaultSettings());
  settings.favourites = ["/Lotus/Example/Kept", "/Lotus/Example/Removed"];
  // As App.svelte saves them: every change, through the page's effects.
  const stop = effectRoot(() => persistSettings(() => settings, () => true));
  flush();
  await flushSettings();
  // Wishlist's remove: the entry waits out its Undo; Ctrl+Q comes before the time is up.
  const u = new UndoSlots();
  u.hold("/Lotus/Example/Removed", () => (settings.favourites = settings.favourites.filter((x) => x !== "/Lotus/Example/Removed")));
  try {
    await quit();
    assert.deepEqual(JSON.parse(stored["orbiter-settings"]).favourites, ["/Lotus/Example/Kept"], "saved without it");
    assert.equal(u.has("/Lotus/Example/Removed"), false, "no longer waiting");
  } finally {
    u.flush();
    stop();
  }
});
