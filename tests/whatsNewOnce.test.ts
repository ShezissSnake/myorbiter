// What's New on start: once after an update the player hasn't seen, once the settings are in; not
// on a first start, not twice, not on every start.
import { flush, effectRoot } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEWEST, NEWS } from "../src/lib/whatsNew";

const { whatsNewOnce } = await import("../src/lib/newsOnce.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const internal = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T };

const older = String(NEWS[1].id);

/** App's start as it runs: the defaults (everything seen) until the saved settings replace them. */
function start() {
  const app = internal.proxy({ settings: { newsSeen: NEWEST } });
  let opened = 0;
  let news!: ReturnType<typeof whatsNewOnce>;
  const stop = effectRoot(() => {
    news = whatsNewOnce(() => app.settings.newsSeen, () => opened++);
  });
  flush();
  return { app, news, opened: () => opened, stop };
}

test("after an update not seen yet: opens once the settings are ready, though they came in first", () => {
  const s = start();
  // `settings = await loadSettings()`: the effects run before the start carries on (`await wiki`).
  s.app.settings = { newsSeen: older };
  flush();
  assert.equal(s.opened(), 0, "not before the settings are ready");
  s.news.ready();
  flush();
  assert.equal(s.opened(), 1);
  // Read and closed (WhatsNew's ondone): not again; nor when ready is said twice.
  s.app.settings.newsSeen = NEWEST;
  s.news.ready();
  flush();
  s.app.settings.newsSeen = older;
  flush();
  assert.equal(s.opened(), 1, "once a start");
  s.stop();
});

test("a first start, or a start with everything seen: not opened", () => {
  for (const seen of [NEWEST, "999"]) {
    const s = start();
    s.app.settings = { newsSeen: seen };
    flush();
    s.news.ready();
    flush();
    assert.equal(s.opened(), 0, seen);
    s.stop();
  }
});

test("ready before anything changes: opens on what was loaded", () => {
  const s = start();
  s.app.settings = { newsSeen: "" };
  s.news.ready();
  flush();
  assert.equal(s.opened(), 1, "settings from before What's New existed: everything is new");
  s.stop();
});

test("App says ready after the settings and after the first start's question, and opens it nowhere else", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  const loaded = app.indexOf("settings = await loadSettings()");
  const answered = app.indexOf("ts.answer(access)");
  const ready = app.indexOf("news.ready()");
  assert.ok(loaded > 0 && answered > loaded && ready > answered, "settings, the question, then What's New");
  assert.equal(app.match(/news\.ready\(\)/g)?.length, 1);
  assert.equal(app.match(/showNews = true/g)?.length, 1, "only whatsNewOnce's open");
  assert.match(app, /whatsNewOnce\(\(\) => settings\.newsSeen, \(\) => \(showNews = true\)\)/);
});
