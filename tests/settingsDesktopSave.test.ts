// The settings save on the desktop path (backend.ts › flushSettings under Tauri): a save that
// fails is tried again 15 seconds later with the same settings, and a change made in between is
// the one that is saved. The app's commands are a stand-in `invoke`; the page is told it runs in
// the desktop app before backend.ts is first loaded (it decides that once, at load).
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

/** The stand-in app: each command called, and a reply chosen per call. */
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let reply: (cmd: string, args: Record<string, unknown>) => Promise<unknown> = async () => null;
(globalThis as { window?: unknown }).window = {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      calls.push({ cmd, args: JSON.parse(JSON.stringify(args)) });
      return reply(cmd, args);
    },
  },
};
const { defaultSettings, flushSettings, loadSettings, saveSettings } = await import("../src/lib/backend");
const saves = () => calls.filter((c) => c.cmd === "save_settings").map((c) => c.args);
/** Lets the pending promise callbacks (a save's reply, its catch) run. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

const PAGE = 7;
beforeEach(async () => {
  mock.timers.reset();
  // Nothing left waiting from the last test.
  reply = async () => null;
  await flushSettings();
  calls.length = 0;
});

test("the desktop path loads through load_settings and saves with its page token", async () => {
  reply = async (cmd) => (cmd === "load_settings" ? { settings: { tab: "sales" }, page: PAGE } : null);
  const s = await loadSettings();
  assert.equal(s.tab, "sales");
  saveSettings(s);
  await flushSettings();
  const [one] = saves();
  assert.equal(one.page, PAGE);
  assert.equal((one.settings as { tab: string }).tab, "sales");
});

test("a save that fails is tried again 15 seconds later with the same settings", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let fail = 1;
  reply = async (cmd) => {
    if (cmd === "save_settings" && fail-- > 0) throw new Error("disk full");
    return null;
  };
  const s = defaultSettings();
  s.tab = "sales";
  saveSettings(s);
  mock.timers.tick(300);
  await settle();
  assert.equal(saves().length, 1, "tried once");
  mock.timers.tick(14_999);
  await settle();
  assert.equal(saves().length, 1, "not before 15 seconds");
  mock.timers.tick(1);
  await settle();
  const [first, second] = saves();
  assert.equal(saves().length, 2, "tried again");
  assert.deepEqual(second.settings, first.settings, "with the same settings");
  assert.equal((second.settings as { tab: string }).tab, "sales");
  mock.timers.tick(60_000);
  await settle();
  assert.equal(saves().length, 2, "saved: not tried again");
});

test("a change made after a save failed is the one saved, and the failed one isn't tried over it", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let fail = 1;
  reply = async (cmd) => {
    if (cmd === "save_settings" && fail-- > 0) throw new Error("disk full");
    return null;
  };
  const a = defaultSettings();
  a.tab = "sales";
  saveSettings(a);
  mock.timers.tick(300);
  await settle();
  const b = defaultSettings();
  b.tab = "market";
  saveSettings(b);
  mock.timers.tick(300);
  await settle();
  mock.timers.tick(60_000);
  await settle();
  assert.deepEqual(saves().map((x) => (x.settings as { tab: string }).tab), ["sales", "market"]);
});

test("a change made while the failing save is still under way is the one saved", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let refuse!: (e: Error) => void;
  let first = true;
  reply = (cmd) => {
    if (cmd === "save_settings" && first) {
      first = false;
      return new Promise((_, rej) => (refuse = rej));
    }
    return Promise.resolve(null);
  };
  const a = defaultSettings();
  a.tab = "sales";
  saveSettings(a);
  mock.timers.tick(300);
  await settle();
  // The save is on its way; a change comes in; then the save fails.
  const b = defaultSettings();
  b.tab = "market";
  saveSettings(b);
  refuse(new Error("disk full"));
  await settle();
  mock.timers.tick(300);
  await settle();
  mock.timers.tick(60_000);
  await settle();
  const tabs = saves().map((x) => (x.settings as { tab: string }).tab);
  assert.deepEqual(tabs, ["sales", "market"], "the newer settings are saved, and the failed ones not over them");
});
