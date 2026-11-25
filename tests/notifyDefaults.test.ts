// Which notifications start on, and the one time settings saved before that list get the kinds that
// now start off switched off (backend.ts › NOTIFY_ON, NOTIFY_OFF, quietOnce). The browser path:
// localStorage stands in for the file, and a save goes through the same split and join as the
// desktop app's (lightSettings, HEAVY_SETTINGS, joinSettings).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEAVY_SETTINGS, NOTIFY_OFF, NOTIFY_ON, defaultNotify, defaultSettings, joinSettings, lightSettings, loadSettings, type HeavyKey, type Settings } from "../src/lib/backend";
import { DAMAGED_SETTINGS_KEY } from "../src/lib/core/standIn";

globalThis.fetch = (() => { throw new Error("no network in this test"); }) as never;
const stored = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) };
const put = (saved: unknown) => {
  stored.clear();
  if (saved !== undefined) stored.set("orbiter-settings", JSON.stringify(saved));
};
/** Saved as the app saves it: the light part and each long log apart, put back together. */
function save(s: Settings) {
  const heavy: Partial<Record<HeavyKey, string>> = {};
  for (const [a, b] of HEAVY_SETTINGS) heavy[`${a}.${b}`] = JSON.stringify((s as unknown as Record<string, Record<string, unknown>>)[a][b]);
  stored.set("orbiter-settings", JSON.stringify(joinSettings(JSON.stringify(lightSettings(s)), heavy)));
}
const allOn = () => Object.fromEntries(Object.keys(defaultNotify()).map((k) => [k, true])) as unknown as Settings["notify"];
const onOnly = (n: Settings["notify"]) => Object.keys(n).filter((k) => n[k as keyof Settings["notify"]]).sort();

test("every kind is on one of the two lists, once", () => {
  const kinds = Object.keys(defaultNotify()).sort();
  assert.deepEqual([...NOTIFY_ON, ...NOTIFY_OFF].sort(), kinds);
  assert.equal(new Set([...NOTIFY_ON, ...NOTIFY_OFF]).size, kinds.length);
  assert.equal(kinds.length, 20);
});

test("the usual switches: the on list on, the off list off", () => {
  assert.deepEqual(onOnly(defaultNotify()), [...NOTIFY_ON].sort());
  assert.deepEqual(defaultSettings().notify, defaultNotify());
});

test("a new install starts with the off list off, and keeps it so across a restart", async () => {
  put(undefined);
  const s = await loadSettings();
  assert.deepEqual(s.notify, defaultNotify());
  assert.equal(s.notifyQuiet, 1);
  s.notify.deals = true;
  save(s);
  assert.equal((await loadSettings()).notify.deals, true, "a kind turned on after the first start stays on");
});

test("settings saved before the list: the off list is switched off once, the rest kept as saved", async () => {
  const notify = { ...allOn(), whispers: false, siteChat: false };
  const old = { ...defaultSettings(), notify, notifyQuiet: undefined, newsSeen: "2026-11-09" };
  put(JSON.parse(JSON.stringify(old)));
  const s = await loadSettings();
  for (const k of NOTIFY_OFF) assert.equal(s.notify[k], false, k);
  for (const k of NOTIFY_ON) assert.equal(s.notify[k], k !== "whispers" && k !== "siteChat", `${k}: a kind on the on list is as saved, on or off`);
  assert.equal(s.notifyQuiet, 1);
});

test("the reset never switches a kind on", async () => {
  const off = Object.fromEntries(Object.keys(defaultNotify()).map((k) => [k, false]));
  put({ notify: off });
  assert.deepEqual(onOnly((await loadSettings()).notify), []);
});

test("the reset touches nothing but the switches: the pause, the quiet hours, the pop-ups, the desktop and Discord stay", async () => {
  const pausedUntil = Date.now() + 3_600_000;
  const notifyOptions = { paused: true, pausedUntil, pausedHow: "hour", toasts: false, desktop: false, quietInFissure: true, quiet: ["deals", "sold"], discord: { url: "https://discord.com/api/webhooks/1/example", kinds: ["deals", "baro"] } };
  put({ notify: allOn(), notifyOptions });
  const s = await loadSettings();
  assert.deepEqual(s.notifyOptions, notifyOptions);
});

test("a restart after a kind was turned back on: it stays on, today and on a later build", async () => {
  put({ notify: allOn() });
  const s = await loadSettings();
  assert.equal(s.notify.alerts, false);
  s.notify.alerts = true;
  s.notify.invasions = true;
  save(s);
  for (let i = 0; i < 3; i++) {
    const again = await loadSettings();
    assert.equal(again.notify.alerts, true, `restart ${i + 1}`);
    assert.equal(again.notify.invasions, true, `restart ${i + 1}`);
    assert.equal(again.notify.baro, false);
    save(again);
  }
});

test("an older build that saves the file keeps the mark: back on this build, nothing is reset again", async () => {
  put({ notify: allOn() });
  const s = await loadSettings();
  s.notify.foundry = true;
  save(s);
  // An older build spreads what it reads and saves it back: a field it doesn't know stays.
  const read = JSON.parse(stored.get("orbiter-settings")!);
  stored.set("orbiter-settings", JSON.stringify({ ...read, simplified: 1, schema: 1 }));
  assert.equal((await loadSettings()).notify.foundry, true);
});

test("a damaged mark still counts as done: a kind the player turned on is never switched off by it", async () => {
  for (const mark of [0, null, "1", 2, {}, false]) {
    put({ notify: allOn(), notifyQuiet: mark });
    const s = await loadSettings();
    assert.deepEqual(s.notify, allOn(), JSON.stringify(mark));
    assert.equal(s.notifyQuiet, 1);
  }
});

test("a damaged file: the usual switches, the off list off", async () => {
  for (const saved of [5, "text", [1, 2], null]) {
    put(saved);
    assert.deepEqual((await loadSettings()).notify, defaultNotify(), JSON.stringify(saved));
  }
  // A file the desktop app moved aside as damaged, stood in for in the browser.
  put({ notify: allOn() });
  stored.set(DAMAGED_SETTINGS_KEY, "1");
  assert.deepEqual((await loadSettings()).notify, defaultNotify());
  stored.delete(DAMAGED_SETTINGS_KEY);
});

test("damaged switches in a file from before the list: the off list off, a damaged switch off, the rest as saved", async () => {
  put({ notify: { ...allOn(), sold: "yes", baro: true, whispers: 1 } });
  const s = await loadSettings();
  assert.equal(s.notify.sold, false);
  assert.equal(s.notify.whispers, false);
  assert.equal(s.notify.baro, false);
  assert.equal(s.notify.market, true);
});
