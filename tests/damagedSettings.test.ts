// A damaged settings file (src-tauri/src/lib.rs › read_settings moves it aside): the page is told
// its new name, and the update channel is left unpicked, so the new-install rule settles it
// (updates.svelte.ts) rather than Stable standing as if the player had chosen it. The app's side
// is a stand-in `invoke`; the page is told it runs in the desktop app before backend.ts is first
// loaded (it decides that once, at load).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

globalThis.fetch = (() => {
  throw new Error("test: no network");
}) as never;
const calls: string[] = [];
let reply: (cmd: string) => unknown = () => null;
(globalThis as { window?: unknown }).window = {
  // For the update store's modules, loaded by one test below.
  addEventListener: () => {},
  removeEventListener: () => {},
  __TAURI_INTERNALS__: {
    invoke: async (cmd: string) => {
      calls.push(cmd);
      return reply(cmd);
    },
  },
};
const { loadSettings, settingsMovedAside, settingsReadWhole, settingsUnreadable } = await import("../src/lib/backend");

beforeEach(() => {
  calls.length = 0;
});

// Audit 5.1, as it was printed (money-proven.md): load_settings says the file was damaged and moved
// aside (settings null, not a new install), as read_settings answers then.
test("5.1: after a damaged file, the update channel is not counted as picked", async () => {
  reply = (cmd) => (cmd === "load_settings" ? { settings: null, page: 1, fresh: false } : null);
  const s = await loadSettings();
  assert.deepEqual(calls, ["load_settings"]);
  assert.deepEqual({ channel: s.updates.channel, picked: s.updates.picked }, { channel: "stable", picked: false });
});

test("a damaged file moved aside: the page is told its name, keeps it until dismissed, and starts from the usual settings", async () => {
  reply = (cmd) => (cmd === "load_settings" ? { settings: null, page: 1, fresh: false, movedAside: "settings.json.broken-1793814960" } : null);
  const s = await loadSettings();
  assert.equal(settingsMovedAside(), "settings.json.broken-1793814960");
  assert.equal(s.movedAside, "settings.json.broken-1793814960", "kept in the new settings until the banner is dismissed");
  assert.equal(s.updates.picked, false, "the new-install rule settles the channel");
  // Nothing else is restored: the usual settings, read as not whole (so nothing is removed at start).
  assert.equal(settingsReadWhole(), false);
  assert.equal(settingsUnreadable(), false);
  assert.equal(s.fullModeAsked, false);
  assert.equal(s.market.autoTrades, false);
  assert.equal(s.market.autoRep, false);
});

test("a name that isn't one read_settings gives is not shown", async () => {
  for (const movedAside of ["/home/user/.config/dev.myorbiter.app/settings.json.broken-1", "settings.json.broken-", "settings.json.broken-12a", "x".repeat(300), 5, null]) {
    reply = (cmd) => (cmd === "load_settings" ? { settings: null, page: 1, fresh: false, movedAside } : null);
    const s = await loadSettings();
    assert.equal(settingsMovedAside(), null, String(movedAside));
    assert.equal(s.movedAside, null, String(movedAside));
  }
});

test("a readable file behaves exactly as before: its channel stays picked, nothing is named", async () => {
  for (const updates of [undefined, { channel: "beta" }, { channel: "experimental", picked: true }]) {
    reply = (cmd) => (cmd === "load_settings" ? { settings: { tab: "sales", ...(updates ? { updates } : {}) }, page: 1, fresh: false } : null);
    const s = await loadSettings();
    assert.equal(s.tab, "sales");
    assert.deepEqual({ channel: s.updates.channel, picked: s.updates.picked }, { channel: updates?.channel ?? "stable", picked: true }, JSON.stringify(updates));
    assert.equal(settingsMovedAside(), null);
    assert.equal(s.movedAside, null);
    assert.equal(settingsReadWhole(), true);
  }
  // A note kept from an earlier start, not yet dismissed, stays; one that isn't such a name is dropped.
  reply = (cmd) => (cmd === "load_settings" ? { settings: { movedAside: "settings.json.broken-1793814960" }, page: 1, fresh: false } : null);
  assert.equal((await loadSettings()).movedAside, "settings.json.broken-1793814960");
  reply = (cmd) => (cmd === "load_settings" ? { settings: { movedAside: "../secret" }, page: 1, fresh: false } : null);
  assert.equal((await loadSettings()).movedAside, null);
});

test("no file at all is a new install, as before", async () => {
  reply = (cmd) => (cmd === "load_settings" ? { settings: null, page: 1, fresh: true } : null);
  const s = await loadSettings();
  assert.equal(s.updates.picked, false);
  assert.equal(settingsMovedAside(), null);
  assert.equal(s.movedAside, null);
  assert.equal(settingsReadWhole(), true);
});

test("a file that couldn't be read at all keeps Stable as it was: it is never saved over, and its channel is in it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  reply = (cmd) => {
    if (cmd === "load_settings") throw new Error("couldn't read settings.json: permission denied");
    return null;
  };
  const loading = loadSettings();
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1000);
  }
  const s = await loading;
  assert.equal(settingsUnreadable(), true);
  assert.deepEqual({ channel: s.updates.channel, picked: s.updates.picked }, { channel: "stable", picked: true });
  assert.equal(settingsMovedAside(), null);
});

test("the update log says a channel settled after a damaged file, not on a new install", async () => {
  await import("./support/runes");
  const { settledWho } = await import("../src/lib/updates.svelte");
  reply = (cmd) => (cmd === "load_settings" ? { settings: null, page: 1, fresh: false, movedAside: "settings.json.broken-1793814960" } : null);
  await loadSettings();
  assert.equal(settledWho(), "after a damaged settings file");
  reply = (cmd) => (cmd === "load_settings" ? { settings: null, page: 1, fresh: true } : null);
  await loadSettings();
  assert.equal(settledWho(), "new install");
  const store = (await import("node:fs")).readFileSync(new URL("../src/lib/updates.svelte.ts", import.meta.url), "utf8");
  assert.doesNotMatch(store, /`new install: on/, "both settling lines go through settledWho");
});

test("the banner's words: what happened, what MyOrbiter started with, and where the old file is kept", async () => {
  const { movedAsideWords, systemOf } = await import("../src/lib/core/gettingIn");
  assert.equal(
    movedAsideWords("settings.json.broken-1793814960", "linux"),
    "Your saved settings and records (sales, trades, value over time) couldn't be read, so MyOrbiter started with the usual settings, as on a first start. The old file was moved aside as settings.json.broken-1793814960 in MyOrbiter's settings folder (~/.config/dev.myorbiter.app, or $XDG_CONFIG_HOME/dev.myorbiter.app when that is set); nothing is read back from it. Look through Settings again, your platform first: it is back on PC, unless you are signed in to warframe.market and it answered as MyOrbiter started, when your account set it.",
  );
  // It may have been deleted since: the words don't say it is still there.
  assert.doesNotMatch(movedAsideWords("settings.json.broken-1", "linux"), /is kept/);
  assert.match(movedAsideWords("settings.json.broken-1", "windows"), /\(%APPDATA%\\dev\.myorbiter\.app\)/);
  assert.match(movedAsideWords("settings.json.broken-1", "macos"), /\(~\/Library\/Application Support\/dev\.myorbiter\.app\)/);
  assert.equal(systemOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"), "windows");
  assert.equal(systemOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"), "macos");
  assert.equal(systemOf("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)"), "linux");
});

test("the banner sits at the top of every page, the setup page included, and its Dismiss clears the kept name", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  const banner = app.indexOf('data-banner="settings-moved-aside"');
  assert.ok(banner > 0);
  assert.ok(banner < app.indexOf("{#if !model && error && notYet}"), "before the setup page and the \"Can't read\" pages");
  assert.match(app.slice(banner, banner + 400), /onclick=\{\(\) => \(settings\.movedAside = null\)\}/);
});
