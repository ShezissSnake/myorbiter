// The update check as the page runs it, with the app's side stubbed: every check ends in one state
// shown under Check now (a build on offer, up to date, or why it failed), "Last checked" moves on
// every ending, the schedule checks at start and then when the last check is old enough, and
// Check now is wired to its button. Nothing here reaches GitHub or GitLab.
import "./support/runes";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { updater, type UpdateCheck } from "../src/lib/backend";
import { CHECK_EVERY, clockTime, defaultUpdates, SCHEDULE_TICK, type Channel, type UpdateSettings } from "../src/lib/core/updates";

const { Updates, CHECK_LIMIT } = await import("../src/lib/updates.svelte");
const { holdBackground } = await import("../src/lib/pane.svelte");

const T0 = Date.UTC(2026, 10, 8, 17, 50);
const NEWER: UpdateCheck = { state: "newer", version: "0.2.106", notes: "UI clipping sweep\nSale log", date: "2026-11-08T18:51:46Z" };
const CURRENT: UpdateCheck = { state: "current", version: "0.2.104" };

/** Lets resolved promises' callbacks run (the timers are mocked, so no setTimeout here). */
const micro = async (n = 20) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

type Answer = UpdateCheck | Error | Promise<UpdateCheck>;

/** A store on an AppImage of 0.2.104 on Experimental, whose checks answer `answers` in turn. */
async function setup(t: TestContext, answers: Answer[] = []) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const real = { ...updater };
  const calls: Channel[] = [];
  updater.info = async () => ({ version: "0.2.104", install: { how: "appImage", path: "/home/user/Apps/myorbiter.AppImage" } });
  updater.check = async (c) => {
    calls.push(c);
    const a = answers.shift();
    if (!a) throw new Error("no answer stubbed");
    if (a instanceof Error) throw a;
    return a;
  };
  const settings: UpdateSettings = { ...defaultUpdates(), channel: "experimental" };
  const u = new Updates();
  t.after(() => {
    u.stop();
    Object.assign(updater, real);
  });
  return { u, settings, calls, answers, begin: async () => (u.start(() => settings), await micro()) };
}

/** Runs the check at start: after the first paint (a 0 ms timer here) and a quiet moment. */
async function startCheck(t: TestContext) {
  t.mock.timers.tick(0);
  t.mock.timers.tick(300);
  await micro();
}

test("Check now is the button's click, and the line under it is the check's state", () => {
  const sheet = readFileSync(new URL("../src/lib/SettingsSheet.svelte", import.meta.url), "utf8");
  const button = sheet.match(/<ProgressButton job=\{updates\.checkJob\}[^\n]*\/>/)?.[0] ?? "";
  assert.match(button, /label="Check now"/);
  assert.match(button, /onclick=\{\(\) => updates\.checkNow\(\)\}/, "the click asks for a check");
  assert.match(button, /busy=\{updates\.checking\}/, "a check the schedule started shows on the button too");
  assert.match(sheet, /\{updates\.status\(now\)\}/, "the line shows the check's state");
  assert.match(sheet, /<span class="sr" role="status">\{updates\.headline\}<\/span>/, "a screen reader hears what changed, not the age ticking");
});

test("a newer build: the line says so, and the offer has its notes and an install button", async (t) => {
  const { u, settings, begin } = await setup(t, [NEWER]);
  await begin();
  assert.equal(await u.checkNow(), true);
  assert.equal(u.status(Date.now()), "0.2.106 is available on Experimental (checked just now).");
  assert.deepEqual(u.offer, { channel: "experimental", version: "0.2.106", notes: "UI clipping sweep\nSale log", older: false });
  assert.equal(u.notice?.version, "0.2.106", "an AppImage that can replace itself gets the notice");
  assert.equal(u.checkJob.note, "0.2.106 is out");
  assert.equal(settings.lastCheck, T0);
});

test("up to date: the line says so, with when", async (t) => {
  const { u, settings, begin } = await setup(t, [CURRENT]);
  await begin();
  await u.checkNow();
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
  assert.equal(u.offer, null);
  assert.equal(settings.lastCheck, T0);
  assert.equal(u.status(T0 + 3 * 60_000), "Up to date (checked 3 min ago).");
});

test("a failed check: the reason in plain words with its time, and Last checked moves on", async (t) => {
  const { u, settings, begin } = await setup(t, [new Error("Couldn't reach GitHub or GitLab")]);
  settings.lastCheck = T0 - 2 * 3600_000;
  await begin();
  assert.equal(await u.checkNow(), false);
  assert.equal(settings.lastCheck, T0, "written on a failure too");
  assert.equal(u.error, "Couldn't reach GitHub or GitLab");
  assert.equal(u.status(Date.now()), `Couldn't reach GitHub or GitLab (at ${clockTime(T0)}, just now).`);
  assert.equal(u.checkJob.state, "failed");
  assert.equal(u.checkJob.error, "Couldn't reach GitHub or GitLab");
});

test("a failure after an offer keeps the offer, and the next answer clears the failure", async (t) => {
  const { u, begin } = await setup(t, [NEWER, new Error("Couldn't reach GitHub or GitLab"), CURRENT]);
  await begin();
  await u.checkNow();
  await u.checkNow();
  assert.equal(u.offer?.version, "0.2.106", "what was found is still on offer");
  assert.match(u.status(Date.now()), /^Couldn't reach GitHub or GitLab/);
  await u.checkNow();
  assert.equal(u.error, null);
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
});

test("a check the app never answers ends as a failure after the page's limit, and is logged", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const { u, settings, begin } = await setup(t, [new Promise<UpdateCheck>(() => {})]);
  await begin();
  const run = u.checkNow();
  await micro();
  assert.equal(u.checking, true);
  assert.equal(u.status(Date.now()), "Checking for updates…");
  t.mock.timers.tick(CHECK_LIMIT);
  assert.equal(await run, false);
  assert.equal(u.checking, false);
  assert.equal(settings.lastCheck, T0 + CHECK_LIMIT);
  assert.match(u.status(Date.now()), /^The check didn't finish in 20 s \(at \d\d:\d\d, just now\)\.$/);
  assert.equal(warn.mock.callCount(), 1, "in the log (the console, outside the app)");
});

test("the schedule: a check at start, then when the last is 6 hours old", async (t) => {
  const { u, calls, answers, begin } = await setup(t, [CURRENT, CURRENT, CURRENT]);
  await begin();
  assert.deepEqual(calls, [], "nothing before the first paint");
  await startCheck(t);
  assert.deepEqual(calls, ["experimental"], "once at start");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
  // Ticks every SCHEDULE_TICK; nothing until the last check is CHECK_EVERY old.
  for (let at = SCHEDULE_TICK; at < CHECK_EVERY; at += SCHEDULE_TICK) {
    t.mock.timers.tick(SCHEDULE_TICK);
    await micro();
  }
  assert.equal(calls.length, 1, "not before 6 hours");
  // The first tick once it is 6 hours old (it ended 300 ms after the start).
  t.mock.timers.tick(2 * SCHEDULE_TICK);
  await micro();
  assert.equal(calls.length, 2, "at 6 hours");
  assert.equal(answers.length, 1);
});

test("the schedule after a failure: the same 6 hours (the requests stay as docs/privacy.md says)", async (t) => {
  const { u, calls, begin } = await setup(t, [new Error("Couldn't reach GitHub or GitLab"), CURRENT]);
  await begin();
  await startCheck(t);
  assert.equal(calls.length, 1);
  assert.match(u.status(Date.now()), /^Couldn't reach GitHub or GitLab \(at \d\d:\d\d, just now\)\.$/, "the scheduled check's failure shows");
  for (let at = SCHEDULE_TICK; at < CHECK_EVERY; at += SCHEDULE_TICK) {
    t.mock.timers.tick(SCHEDULE_TICK);
    await micro();
  }
  assert.equal(calls.length, 1, "no retry before 6 hours");
  t.mock.timers.tick(2 * SCHEDULE_TICK);
  await micro();
  assert.equal(calls.length, 2, "at 6 hours");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
});

test("the check at start isn't held back for good by a busy page", async (t) => {
  const { calls, begin } = await setup(t, [CURRENT]);
  // Background work held (a sync's read on its way): the quiet moment doesn't come.
  const release = holdBackground();
  t.after(release);
  await begin();
  t.mock.timers.tick(0);
  t.mock.timers.tick(29_000);
  await micro();
  assert.deepEqual(calls, [], "waits for a quiet moment");
  t.mock.timers.tick(1_000);
  await micro();
  assert.deepEqual(calls, ["experimental"], "but not past START_WAIT");
});

test("a check already old at start, and one after a sleep, run as soon as they're looked at", async (t) => {
  const { u, settings, calls, begin } = await setup(t, [CURRENT, CURRENT]);
  settings.lastCheck = T0 - 2 * 3600_000;
  await begin();
  await startCheck(t);
  assert.equal(calls.length, 1, "start always checks, whatever the last check");
  // A sleep: the wall clock jumps 7 hours, the timers don't run meanwhile.
  t.mock.timers.setTime(Date.now() + 7 * 3600_000);
  t.mock.timers.tick(SCHEDULE_TICK);
  await micro();
  assert.equal(calls.length, 2, "the next tick finds it overdue");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
});

/** A window to show and hide (Node has none): `show()` makes it visible again, as after a sleep. */
function stubDocument(t: TestContext) {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  (globalThis as { document?: unknown }).document = doc;
  t.after(() => delete (globalThis as { document?: unknown }).document);
  return { show: () => doc.dispatchEvent(new Event("visibilitychange")) };
}

test("the window shown again after a sleep: an overdue check runs at once", async (t) => {
  const win = stubDocument(t);
  const { u, calls, begin } = await setup(t, [CURRENT, CURRENT]);
  await begin();
  await startCheck(t);
  assert.equal(calls.length, 1);
  win.show();
  await micro();
  assert.equal(calls.length, 1, "not due yet: nothing");
  t.mock.timers.setTime(Date.now() + 7 * 3600_000);
  win.show();
  await micro();
  assert.equal(calls.length, 2, "due: asked without waiting for the next tick");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
  u.stop();
  t.mock.timers.setTime(Date.now() + 7 * 3600_000);
  win.show();
  await micro();
  assert.equal(calls.length, 2, "stopped: no more checks");
});

test("one start, one request: a check that ran while the start check waited replaces it", async (t) => {
  const win = stubDocument(t);
  const { u, calls, begin } = await setup(t, [CURRENT, CURRENT]);
  const release = holdBackground();
  t.after(release);
  await begin();
  t.mock.timers.tick(0);
  win.show();
  await micro();
  assert.equal(calls.length, 1, "the window shown while the start check waits: checked then");
  t.mock.timers.tick(30_000);
  await micro();
  assert.equal(calls.length, 1, "the start check doesn't ask again");
  assert.equal(u.headline, "Up to date");
});

test("one check at a time: Check now during a scheduled check gets that check's answer", async (t) => {
  let answer!: (r: UpdateCheck) => void;
  const { u, calls, begin } = await setup(t, [new Promise<UpdateCheck>((r) => (answer = r))]);
  await begin();
  await startCheck(t);
  assert.equal(u.checking, true);
  const click = u.checkNow();
  answer(NEWER);
  assert.equal(await click, true);
  assert.deepEqual(calls, ["experimental"], "one request");
  assert.equal(u.checkJob.note, "0.2.106 is out");
});

test("a channel switch while a check runs asks the new channel, and shows its answer", async (t) => {
  let answer!: (r: UpdateCheck) => void;
  const { u, settings, calls, begin } = await setup(t, [new Promise<UpdateCheck>((r) => (answer = r)), { state: "older", version: "0.2.103", notes: null, date: null }]);
  await begin();
  const click = u.checkNow();
  await micro();
  u.setChannel("stable");
  assert.equal(settings.channel, "stable");
  answer(NEWER);
  await click;
  await micro();
  assert.deepEqual(calls, ["experimental", "stable"]);
  assert.equal(u.checked, "stable");
  assert.equal(u.status(Date.now()), "Stable has 0.2.103, older than this build (checked just now).");
  assert.equal(u.offer?.older, true);
});

test("a copy that doesn't update itself never asks", async (t) => {
  const { u, calls, begin } = await setup(t, []);
  updater.info = async () => ({ version: "0.1.0", install: { how: "dev" } });
  await begin();
  await startCheck(t);
  t.mock.timers.tick(CHECK_EVERY);
  await micro();
  assert.deepEqual(calls, []);
  assert.equal(u.status(Date.now()), "Last checked not yet.");
});
