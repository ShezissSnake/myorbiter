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

test("an empty channel: said plainly, with the nearest channel that has a build, and nothing switches", async (t) => {
  const { u, settings, calls, begin } = await setup(t, [{ state: "empty", system: false }, { state: "empty", system: false }, { state: "newer", version: "0.2.127", notes: null, date: null }]);
  settings.channel = "stable";
  await begin();
  assert.equal(await u.checkNow(), true, "not a failure");
  assert.deepEqual(calls, ["stable", "beta", "experimental"], "the nearest first, and only because Stable was empty");
  assert.equal(u.error, null);
  assert.equal(u.checkJob.note, "Stable is empty");
  assert.equal(u.status(Date.now()), "Stable has no build yet, so there's nothing to update to there (checked just now).");
  assert.deepEqual(u.empty, { words: "Stable has no build yet", to: { channel: "experimental", version: "0.2.127" } });
  assert.equal(settings.channel, "stable", "nothing switches by itself");
  assert.equal(u.offer, null, "and nothing is offered on a channel not chosen");
  assert.equal(u.notice, null);
});

test("the switch an empty channel offers is a click, and asks the new channel at once", async (t) => {
  const { u, settings, calls, begin } = await setup(t, [{ state: "empty", system: false }, { state: "current", version: "0.2.104" }, { state: "current", version: "0.2.104" }]);
  settings.channel = "stable";
  await begin();
  await u.checkNow();
  assert.deepEqual(u.empty?.to, { channel: "beta", version: "0.2.104" });
  u.setChannel("beta");
  await micro();
  assert.equal(settings.channel, "beta");
  assert.deepEqual(calls, ["stable", "beta", "beta"]);
  assert.equal(u.empty, null);
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
});

test("a channel that gets its first build later offers it at the next check", async (t) => {
  const { u, settings, begin } = await setup(t, [{ state: "empty", system: false }, new Error("offline"), { state: "newer", version: "0.2.130", notes: null, date: null }]);
  settings.channel = "stable";
  await begin();
  await u.checkNow();
  assert.ok(u.empty, "empty, and the nearest couldn't be asked");
  assert.equal(u.empty?.to, null);
  await u.checkNow();
  assert.equal(u.empty, null);
  assert.deepEqual(u.offer, { channel: "stable", version: "0.2.130", notes: null, older: false });
});

// A new install (no settings saved yet) of a CI build that checks: its first check asks Stable,
// then Beta if need be, and settles on the most stable channel whose build is this one (0.2.104)
// or newer (core/updates.ts `newInstallStep`). Before, a first start made one request (the channel
// its build was published to, Experimental); now one when Stable has a build, two when only Beta
// has one, three when neither has (then Experimental, asked as every check asks it). Each of them
// asks GitHub alone (`firstOnly`): its 404 is "empty", and a check it couldn't answer throws, so
// the stubs here are GitHub's own answers (tests/updatesTable.test.ts has the addresses cell by
// cell).
const EMPTY: UpdateCheck = { state: "empty", system: false };
const OLDER = (version: string): UpdateCheck => ({ state: "older", version, notes: null, date: null });
const OFFLINE = () => new Error("Couldn't reach GitHub or GitLab");

/** A store on a new install: Stable shown, nothing chosen. */
async function newInstall(t: TestContext, answers: Answer[]) {
  const s = await setup(t, answers);
  Object.assign(s.settings, { channel: "stable", picked: false });
  return s;
}

/** The next start on the same (saved) settings, whose checks answer `answers`. */
async function restart(t: TestContext, settings: UpdateSettings, answers: Answer[]) {
  const calls: Channel[] = [];
  updater.check = async (c) => {
    calls.push(c);
    const a = answers.shift();
    if (!a) throw new Error("no answer stubbed");
    if (a instanceof Error) throw a;
    return a;
  };
  const u = new Updates();
  t.after(() => u.stop());
  u.start(() => settings);
  await micro();
  await startCheck(t);
  return { u, calls };
}

test("a new install, Stable has a build: settles on Stable at its first check, one request", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [CURRENT]);
  await begin();
  assert.deepEqual(calls, [], "nothing before the first paint");
  assert.equal(settings.picked, false);
  assert.equal(u.line, "0.2.104 · channel not chosen yet", "no channel claimed before it settles");
  assert.match(u.unsettled ?? "", /^Stable is shown, but no channel is chosen yet/);
  await startCheck(t);
  assert.deepEqual(calls, ["stable"], "Stable's answer is the check: Beta isn't asked");
  assert.equal(settings.channel, "stable");
  assert.equal(settings.picked, true);
  assert.equal(u.unsettled, null);
  assert.equal(u.line, "0.2.104 · Stable");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
  assert.equal(settings.lastCheck, Date.now());
});

test("a new install, Stable has a newer build: Stable, offered, and the last request is Stable's", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [NEWER]);
  await begin();
  await startCheck(t);
  // The app keeps the last check's download as the one to install (updates.rs `Pending`).
  assert.deepEqual(calls, ["stable"]);
  assert.equal(settings.channel, "stable");
  assert.deepEqual(u.offer, { channel: "stable", version: "0.2.106", notes: "UI clipping sweep\nSale log", older: false });
});

test("a new install, only Beta has a build: settles on Beta, two requests", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [EMPTY, CURRENT]);
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable", "beta"]);
  assert.equal(settings.channel, "beta");
  assert.equal(settings.picked, true);
  assert.equal(u.line, "0.2.104 · Beta");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
  assert.equal(u.empty, null);
});

test("a new install, neither Stable nor Beta has a build (today's channels): Experimental, three requests", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [EMPTY, EMPTY, CURRENT]);
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable", "beta", "experimental"], "Experimental asked last, as the check, never for the rule");
  assert.equal(settings.channel, "experimental");
  assert.equal(settings.picked, true);
  assert.equal(u.line, "0.2.104 · Experimental");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
});

// A check that failed never settles a new install: it throws. And Experimental settles it only
// with this build or a newer one (`buildCounts`), so a GitHub that answers 404 for every channel
// (the repository moved or gone), or holds only older builds, settles nothing either.

test("GitHub's 404 for every channel: unsettled, three requests, asked again when due", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, CURRENT]);
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable", "beta", "experimental"], "three requests, not five");
  assert.equal(settings.picked, false, "not settled on Experimental for good");
  assert.equal(settings.channel, "stable", "the channel shown, unchanged");
  assert.equal(settings.lastCheck, Date.now());
  assert.match(u.status(Date.now()), /^No channel answered with this build or a newer one \(at \d\d:\d\d, just now\)\.$/);
  assert.match(u.unsettled ?? "", /No channel has answered with this build or a newer one yet, so MyOrbiter asks again at its next check/, "every channel answered: true here too");
  assert.equal(u.empty, null, "no channel is said empty: none is chosen");
  assert.equal(u.line, "0.2.104 · channel not chosen yet");
  for (let at = 0; at <= CHECK_EVERY; at += SCHEDULE_TICK) {
    t.mock.timers.tick(SCHEDULE_TICK);
    await micro();
  }
  assert.deepEqual(calls.slice(3), ["stable", "beta", "experimental"], "asked again once due, and settled once Experimental answers with the build");
  assert.equal(settings.channel, "experimental");
  assert.equal(settings.picked, true);
});

test("only older builds on every channel: unsettled, nothing offered", async (t) => {
  const BRIDGE = OLDER("0.2.100");
  const { u, settings, calls, begin } = await newInstall(t, [BRIDGE, BRIDGE, BRIDGE]);
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable", "beta", "experimental"]);
  assert.equal(settings.picked, false);
  assert.equal(settings.channel, "stable");
  assert.equal(u.offer, null, "no older build offered on a channel nobody chose");
  assert.equal(u.notice, null);
  assert.match(u.status(Date.now()), /^No channel answered with this build or a newer one/);
});

test("today's channels (Stable and Beta empty, Experimental with the build): still Experimental in that round", async (t) => {
  for (const exp of [CURRENT, NEWER]) {
    await t.test(exp.state, async (t2) => {
      const { u, settings, calls, begin } = await newInstall(t2, [EMPTY, EMPTY, exp]);
      await begin();
      await startCheck(t2);
      assert.deepEqual(calls, ["stable", "beta", "experimental"], "three requests, as before");
      assert.equal(settings.channel, "experimental");
      assert.equal(settings.picked, true);
      assert.equal(u.checked, "experimental", "Experimental's answer is the check's: the last request is its");
      assert.equal(u.offer?.version ?? null, exp.state === "newer" ? "0.2.106" : null);
    });
  }
});

test("a running build newer than Experimental's, with Beta holding it: still Beta, Experimental not asked", async (t) => {
  const { settings, calls, begin } = await newInstall(t, [EMPTY, CURRENT]);
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable", "beta"]);
  assert.equal(settings.channel, "beta");
  assert.equal(settings.picked, true);
});

test("Stable's or Beta's file failing on GitHub is a failed check: nothing settles, no less stable channel", async (t) => {
  // updates.rs answers a new install's check from GitHub alone: anything but a file or its 404
  // fails the check (no longer an empty or older channel), so a failed Stable or Beta never lets
  // a less stable channel be settled on.
  for (const [name, answers, asked] of [
    ["Stable", [new Error("Couldn't read the Stable channel's manifest on GitHub"), CURRENT, NEWER], ["stable"]],
    ["Beta", [EMPTY, new Error("GitHub didn't answer within 10 s"), NEWER], ["stable", "beta"]],
  ] as [string, Answer[], Channel[]][]) {
    await t.test(name, async (t2) => {
      const { u, settings, calls, begin } = await newInstall(t2, answers);
      await begin();
      await startCheck(t2);
      assert.deepEqual(calls, asked);
      assert.equal(settings.picked, false);
      assert.equal(settings.channel, "stable");
      assert.equal(u.offer, null);
    });
  }
});

test("a new install whose build is newer than Stable's, than Beta's, or than both", async (t) => {
  for (const [answers, want, asked] of [
    [[OLDER("0.2.100"), CURRENT], "beta", ["stable", "beta"]],
    [[OLDER("0.2.100"), NEWER], "beta", ["stable", "beta"]],
    [[EMPTY, OLDER("0.2.101"), CURRENT], "experimental", ["stable", "beta", "experimental"]],
    [[OLDER("0.2.100"), OLDER("0.2.102"), CURRENT], "experimental", ["stable", "beta", "experimental"]],
  ] as [UpdateCheck[], Channel, Channel[]][]) {
    await t.test(`${answers.map((a) => a.state).join(", ")}: ${want}`, async (t2) => {
      const { u, settings, calls, begin } = await newInstall(t2, [...answers]);
      await begin();
      await startCheck(t2);
      assert.deepEqual(calls, asked);
      assert.equal(settings.channel, want);
      assert.equal(settings.picked, true);
      assert.equal(u.offer?.older ?? false, false, "no step back offered by itself");
      assert.equal(u.line, `0.2.104 · ${want === "beta" ? "Beta" : "Experimental"}`);
    });
  }
});

test("a new install, no answer from Stable: nothing settles, Settings says so, and the next due check asks again", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [OFFLINE(), EMPTY, CURRENT]);
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable"], "Beta isn't asked past a silent Stable");
  assert.equal(settings.picked, false, "never marked picked while unsettled");
  assert.equal(settings.channel, "stable", "the channel shown, unchanged");
  assert.equal(settings.lastCheck, Date.now(), "a failed check like any other: the next in 6 hours, not at every tick");
  assert.match(u.status(Date.now()), /^Couldn't reach GitHub or GitLab \(at \d\d:\d\d, just now\)\.$/);
  assert.match(u.unsettled ?? "", /No channel has answered with this build or a newer one yet, so MyOrbiter asks again at its next check/);
  assert.equal(u.line, "0.2.104 · channel not chosen yet");
  t.mock.timers.tick(SCHEDULE_TICK);
  await micro();
  assert.equal(calls.length, 1, "not before the next check is due");
  for (let at = 0; at <= CHECK_EVERY; at += SCHEDULE_TICK) {
    t.mock.timers.tick(SCHEDULE_TICK);
    await micro();
  }
  assert.deepEqual(calls, ["stable", "stable", "beta"], "asked again once due");
  assert.equal(settings.channel, "beta");
  assert.equal(settings.picked, true);
});

test("a new install, Stable's check times out: nothing settles", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { u, settings, calls, begin } = await newInstall(t, [new Promise<UpdateCheck>(() => {})]);
  await begin();
  await startCheck(t);
  t.mock.timers.tick(CHECK_LIMIT);
  await micro();
  assert.deepEqual(calls, ["stable"]);
  assert.equal(settings.picked, false);
  assert.match(u.status(Date.now()), /^The check didn't finish in 20 s/);
});

test("a new install, no answer from Beta after an empty Stable: nothing settles, and the next start asks again", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [EMPTY, OFFLINE()]);
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable", "beta"]);
  assert.equal(settings.picked, false);
  assert.equal(settings.channel, "stable");
  assert.ok(u.unsettled);
  assert.equal(u.empty, null, "Stable's emptiness isn't said as a chosen channel's: none is chosen");
  u.stop();
  const next = await restart(t, settings, [EMPTY, CURRENT]);
  assert.deepEqual(next.calls, ["stable", "beta"]);
  assert.equal(settings.channel, "beta");
  assert.equal(settings.picked, true);
  assert.equal(next.u.status(Date.now()), "Up to date (checked just now).");
});

test("a new install, the player picks a channel while it asks: the answer on its way is dropped, the pick stays", async (t) => {
  let answer!: (r: UpdateCheck) => void;
  const { u, settings, calls, begin } = await newInstall(t, [new Promise<UpdateCheck>((r) => (answer = r)), CURRENT]);
  await begin();
  await startCheck(t);
  assert.equal(u.checking, true);
  u.setChannel("experimental");
  assert.equal(settings.picked, true, "saved as picked at once");
  answer(CURRENT);
  await micro();
  assert.deepEqual(calls, ["stable", "experimental"], "Stable's answer dropped; the picked channel asked");
  assert.equal(settings.channel, "experimental", "not moved to Stable, though Stable has this build");
  assert.equal(u.checked, "experimental");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
  u.stop();
  const next = await restart(t, settings, [CURRENT]);
  assert.deepEqual(next.calls, ["experimental"], "a later start never asks for it again");
  assert.equal(settings.channel, "experimental");
});

test("a new install, the player picks the channel already shown while it asks: kept, though Beta has the build", async (t) => {
  let answer!: (r: UpdateCheck) => void;
  const { u, settings, calls, begin } = await newInstall(t, [new Promise<UpdateCheck>((r) => (answer = r)), EMPTY, CURRENT]);
  await begin();
  await startCheck(t);
  u.setChannel("stable");
  assert.equal(settings.picked, true);
  answer(EMPTY);
  await micro();
  // Stable's answer was the settling's, dropped; then Stable is asked as the chosen channel, and
  // being empty, its nearest channel (Beta) for the Switch to offer. Nothing moves.
  assert.deepEqual(calls, ["stable", "stable", "beta"]);
  assert.equal(settings.channel, "stable");
  assert.deepEqual(u.empty, { words: "Stable has no build yet", to: { channel: "beta", version: "0.2.104" } });
});

test("a new install, a pick made while offline and unsettled, then a start online: the pick stays and only it is asked", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [OFFLINE(), OFFLINE()]);
  await begin();
  await startCheck(t);
  assert.equal(settings.picked, false);
  u.setChannel("beta");
  await micro();
  assert.deepEqual(calls, ["stable", "beta"], "the pick's own check, still offline");
  assert.equal(settings.picked, true);
  assert.equal(settings.channel, "beta");
  assert.equal(u.unsettled, null, "picked: nothing more to find out");
  assert.equal(u.line, "0.2.104 · Beta");
  u.stop();
  const next = await restart(t, settings, [{ state: "current", version: "0.2.104" }]);
  assert.deepEqual(next.calls, ["beta"]);
  assert.equal(settings.channel, "beta");
});

test("a new install of a local build: Stable at once, nothing asked for it", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, [CURRENT]);
  updater.info = async () => ({ version: "0.1.0", install: { how: "appImage", path: "/home/user/Apps/myorbiter.AppImage" } });
  await begin();
  assert.equal(settings.picked, true, "settled when the app says which build it is");
  assert.equal(settings.channel, "stable");
  assert.equal(u.unsettled, null);
  assert.equal(u.line, "0.1.0 · local build");
  await startCheck(t);
  assert.deepEqual(calls, ["stable"], "only the check it always made");
});

test("a new install that doesn't check for updates: Experimental, as before, and no request", async (t) => {
  const { u, settings, calls, begin } = await newInstall(t, []);
  updater.info = async () => ({ version: "0.2.104", install: { how: "manual" } });
  await begin();
  await startCheck(t);
  t.mock.timers.tick(CHECK_EVERY);
  await micro();
  assert.deepEqual(calls, []);
  assert.equal(settings.channel, "experimental");
  assert.equal(settings.picked, true);
  assert.equal(u.unsettled, null);
});

test("saved settings keep their channel: nothing is asked for them, even when their channel's build is older", async (t) => {
  const { u, settings, calls, begin } = await setup(t, [OLDER("0.2.100")]);
  Object.assign(settings, { channel: "stable", picked: true });
  await begin();
  await startCheck(t);
  assert.deepEqual(calls, ["stable"], "the one check it always made");
  assert.equal(settings.channel, "stable", "nobody already installed is moved");
  assert.equal(u.unsettled, null);
  assert.equal(u.offer?.older, true, "the older build offered only as a click, as before");
});

test("a channel the player picks on a new install stays, even the one already shown, before the app says which build", async (t) => {
  const { u, settings } = await setup(t, []);
  updater.info = async () => ({ version: "0.2.127", install: { how: "appImage", path: "/home/user/Apps/myorbiter.AppImage" } });
  Object.assign(settings, { channel: "stable", picked: false });
  u.start(() => settings);
  u.setChannel("stable");
  await micro();
  assert.equal(settings.picked, true);
  assert.equal(settings.channel, "stable");
});

test("Settings, Updates says what an unsettled new install shows, and both channel controls go through setChannel", () => {
  const sheet = readFileSync(new URL("../src/lib/SettingsSheet.svelte", import.meta.url), "utf8");
  assert.match(sheet, /\{#if updates\.unsettled\}<p class="hint"[^>]*>\{updates\.unsettled\}<\/p>\{\/if\}/);
  assert.match(sheet, /<Seg label="Channel"[^\n]*onchange=\{\(c\) => updates\.setChannel\(c\)\}/, "the channel buttons");
  assert.match(sheet, /onclick=\{\(\) => empty\.to && updates\.setChannel\(empty\.to\.channel\)\}/, "an empty channel's Switch to");
  assert.doesNotMatch(sheet, /settings\.updates\.channel = /, "no other place sets the channel");
});
