// A settings file that is there but can't be read at all at start (load_settings fails five
// times, backend.ts › loadSettings): no update channel counts as chosen, and the new-install rule
// settles one at the first check that hears back (updates.svelte.ts › settle), as after a damaged
// file moved aside (damagedSettings.test.ts). What leaves the machine for it is a new install's
// settling, command for command; the log and Settings say which start it is; and still nothing is
// saved over the file, the settled channel and one picked in Settings included. The app's side is
// a stand-in `invoke`; the page is told it runs in the desktop app before backend.ts is first
// loaded (it decides that once, at load). Nothing here reaches GitHub or GitLab.
//
// The tests run in this order on purpose: backend.ts keeps "couldn't be read" for the rest of the
// start (nothing is saved after it), so the new install's start is run before the unreadable one.
import "./support/runes";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

globalThis.fetch = (() => {
  throw new Error("test: no network");
}) as never;

const RUNNING = "0.2.130";
type Call = { cmd: string; args?: Record<string, unknown> };
const calls: Call[] = [];
let unreadable = false;

/** The channels as a new channel has them: Stable and Beta with no build on GitHub, Experimental with a newer one. */
function check(args: { channel: string; firstOnly?: boolean }) {
  if (args.channel === "experimental") return { state: "newer", version: "0.2.132", notes: null, date: null };
  return { state: "empty", system: false };
}

(globalThis as { window?: unknown }).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  __TAURI_INTERNALS__: {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args: args && JSON.parse(JSON.stringify(args)) });
      if (cmd === "load_settings") {
        if (unreadable) throw new Error("couldn't read settings.json: Permission denied (os error 13)");
        return { settings: null, page: 1, fresh: true };
      }
      if (cmd === "updates_info") return { version: RUNNING, install: { how: "appImage", path: "/home/user/Apps/myorbiter.AppImage" } };
      if (cmd === "updates_check") return check(args as { channel: string; firstOnly?: boolean });
      return null;
    },
  },
};

const backend = await import("../src/lib/backend");
const { loadSettings, saveSettings, flushSettings, settingsUnreadable, settingsMovedAside } = backend;
const { Updates, settledWho } = await import("../src/lib/updates.svelte");

const micro = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Loads the settings as this start's app answers, its five tries run out on the mocked clock. */
async function load(t: TestContext) {
  const loading = loadSettings();
  for (let i = 0; i < 5; i++) {
    await micro();
    t.mock.timers.tick(1000);
  }
  return loading;
}

/** The start's update checks, run until the first has heard back; what the app was asked, in order. */
async function firstChecks(t: TestContext, s: Awaited<ReturnType<typeof loadSettings>>) {
  calls.length = 0;
  const u = new Updates();
  u.start(() => s.updates);
  await micro();
  t.mock.timers.tick(0);
  t.mock.timers.tick(300);
  await micro(60);
  // The log line goes out through the app's own `invoke`, a few turns after the settling.
  await micro(30);
  const sent = calls.filter((c) => c.cmd === "updates_check" || c.cmd === "updates_info");
  const logged = calls.filter((c) => c.cmd === "log_line").map((c) => String(c.args?.message));
  return { u, sent, logged };
}

let newInstall: Awaited<ReturnType<typeof firstChecks>> | null = null;

test("a new install's start (the comparison): settles by asking GitHub alone", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.UTC(2026, 10, 20, 9, 0) });
  unreadable = false;
  const s = await load(t);
  assert.equal(settingsUnreadable(), false);
  assert.equal(s.updates.picked, false);
  newInstall = await firstChecks(t, s);
  newInstall.u.stop();
  assert.equal(s.updates.channel, "experimental");
  assert.equal(s.updates.picked, true);
  assert.equal(settledWho(), "new install");
});

test("a settings file that couldn't be read at all leaves no channel chosen", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  unreadable = true;
  const s = await load(t);
  assert.equal(settingsUnreadable(), true);
  assert.equal(settingsMovedAside(), null, "nothing was moved aside");
  assert.deepEqual({ channel: s.updates.channel, picked: s.updates.picked }, { channel: "stable", picked: false }, "Stable is only shown, not chosen");
  assert.equal(s.updates.lastCheck, null);
  assert.equal(s.updates.from, null);
});

test("its first check settles the channel as a new install's does, sending exactly what a new install's sends", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.UTC(2026, 10, 20, 9, 0) });
  unreadable = true;
  const s = await load(t);
  assert.ok(newInstall, "the new install's start ran first");
  const { u, sent, logged } = await firstChecks(t, s);
  u.stop();
  assert.deepEqual(sent, newInstall.sent, "the same commands, with the same arguments, in the same order");
  // GitHub alone for each channel asked, then nothing more: the settled channel's answer is reused.
  assert.deepEqual(sent, [
    { cmd: "updates_info", args: {} },
    { cmd: "updates_check", args: { channel: "stable", firstOnly: true } },
    { cmd: "updates_check", args: { channel: "beta", firstOnly: true } },
    { cmd: "updates_check", args: { channel: "experimental", firstOnly: true } },
  ]);
  assert.deepEqual({ channel: s.updates.channel, picked: s.updates.picked }, { channel: "experimental", picked: true });
  assert.equal(u.offer?.version, "0.2.132", "the settled channel's update is offered");
  // The log names this start truly: not a new install, not a damaged file.
  assert.equal(settledWho(), "after saved settings that couldn't be read");
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^after saved settings that couldn't be read: on Experimental, neither Stable nor Beta has this build or a newer one/);
  assert.equal(newInstall.logged.length, 1);
  assert.equal(logged[0].replace(/^after saved settings that couldn't be read/, "new install"), newInstall.logged[0], "the same line as a new install's but for whose start it is");
});

test("Settings, Updates says, while no channel is chosen, that a channel chosen now is kept only until a restart", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.UTC(2026, 10, 20, 9, 0) });
  unreadable = true;
  const s = await load(t);
  const u = new Updates();
  t.after(() => u.stop());
  // No check is run here (the clock isn't moved): only what Settings shows before the first.
  u.start(() => s.updates);
  await micro();
  const said = u.unsettled ?? "";
  assert.match(said, /^Stable is shown, but no channel is chosen: MyOrbiter couldn't read your saved settings, so the channel saved in them isn't known\./);
  assert.match(said, /the most stable channel with this build or a newer one/);
  assert.match(said, /kept until MyOrbiter restarts/);
  assert.doesNotMatch(said, /that channel stays/, "nothing chosen at this start is saved");
  assert.equal(u.line, `${RUNNING} · channel not chosen yet`);
});

test("still nothing is saved over the file: not the settled channel, not a channel picked in Settings", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  unreadable = true;
  const s = await load(t);
  s.updates.channel = "experimental";
  s.updates.picked = true;
  calls.length = 0;
  saveSettings(s);
  t.mock.timers.tick(300);
  await flushSettings();
  s.updates.channel = "beta";
  saveSettings(() => s);
  await flushSettings();
  assert.deepEqual(
    calls.filter((c) => c.cmd === "save_settings"),
    [],
    "nothing written over the file this start",
  );
});
