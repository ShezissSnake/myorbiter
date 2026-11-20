// How often the automatic price check runs (core/schedule.ts), what the settings loader keeps of
// it (backend.ts), and when the next check is due, a missed one after a restart included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVERY_CHOICES, checkDue, everyOf, everyWords, lastCheckOf, nextCheckAt, nextCheckShown, nextCheckWhy, whenWords } from "../src/lib/core/schedule";
import { loadSettings } from "../src/lib/backend";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("the intervals: today's, then 2, 6 and 12 hours, a day and a week; nothing shorter than a minute", () => {
  assert.deepEqual([...EVERY_CHOICES], [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440, 10080]);
  assert.equal(Math.min(...EVERY_CHOICES), 1);
  assert.deepEqual(EVERY_CHOICES.map(everyWords), ["every 1 min", "every 2 min", "every 5 min", "every 10 min", "every 15 min", "every 30 min", "every hour", "every 2 hours", "every 6 hours", "every 12 hours", "once a day", "once a week"]);
});

test("the sanitiser keeps the offered intervals; another goes to the nearest that is not shorter", () => {
  for (const m of EVERY_CHOICES) assert.equal(everyOf(m, 5), m);
  const nearest: [number, number][] = [[1.5, 2], [3, 5], [45, 60], [61, 120], [90, 120], [240, 360], [1439, 1440], [1441, 10080], [10079, 10080]];
  for (const [v, want] of nearest) assert.equal(everyOf(v, 5), want, String(v));
  // Never a shorter interval than the file held, but for one past a week, the longest there is.
  for (let v = 1; v <= 10080; v += 7) assert.ok(everyOf(v, 5) >= v, String(v));
  assert.equal(everyOf(20160, 5), 10080);
  // The usual one only for no number, or one under a minute.
  for (const v of [0, 0.5, -60, NaN, Infinity, "60", null, undefined, {}]) assert.equal(everyOf(v, 5), 5, String(v));
});

test("the loader: an offered interval stays, another goes up to the next one, no number or too short falls back to 5 min", async () => {
  const load = async (market: unknown) => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ market }) };
    return (await loadSettings()).market;
  };
  assert.equal((await load({ every: 10080 })).every, 10080, "once a week");
  assert.equal((await load({ every: 1440 })).every, 1440);
  assert.equal((await load({ every: 45 })).every, 60, "not offered: the next one up");
  assert.equal((await load({ every: 240 })).every, 360, "every 4 hours becomes every 6");
  assert.equal((await load({ every: 0 })).every, 5, "too short");
  assert.equal((await load({ every: "often" })).every, 5, "no number");
  assert.equal((await load({ every: 20160 })).every, 10080, "longer than a week: once a week");
  assert.equal((await load({})).every, 5);
  const now = Date.now();
  assert.equal((await load({ lastCheck: now - HOUR })).lastCheck, now - HOUR);
  for (const bad of ["yesterday", -5, 0, NaN, null]) assert.equal((await load({ lastCheck: bad })).lastCheck, null, String(bad));
  assert.equal(lastCheckOf(Infinity), null);
});

test("a check is due a whole interval after the last, this run's or the one saved", () => {
  const now = 1_800_000_000_000;
  assert.equal(checkDue(null, 5 * MIN, now), true, "no check yet: the first after a start runs");
  assert.equal(checkDue(now - 4 * MIN, 5 * MIN, now), false);
  assert.equal(checkDue(now - 5 * MIN, 5 * MIN, now), true);
  assert.equal(nextCheckAt(now - HOUR, DAY, now), now - HOUR + DAY);
  // Once a week, the app restarted the next day: it waits for the week, it doesn't check on every start.
  assert.equal(checkDue(now - DAY, 7 * DAY, now), false);
  // A clock that went back: due, as on a start with nothing saved.
  assert.equal(checkDue(now + HOUR, 7 * DAY, now), true);
  assert.equal(nextCheckAt(now + HOUR, 7 * DAY, now), null);
});

test("a check missed while closed runs once after the start, then waits a whole interval", () => {
  // The timer as App runs it: every 15 s, due by the last check this run, or else the saved one.
  const every = 6 * HOUR;
  const saved = 1_800_000_000_000;
  const start = saved + 2 * DAY; // closed for two days: several checks fell then
  let lastPass: number | null = null;
  let checks = 0;
  for (let t = start; t < start + every + MIN; t += 15_000) {
    if (!checkDue(lastPass ?? saved, every, t)) continue;
    checks++;
    lastPass = t;
  }
  assert.equal(checks, 2, "one on the start's first tick, the next a whole interval later");
  assert.equal(lastPass, start + every);
  // Started again before the next was due: none on the start.
  let early = 0;
  for (let t = saved + HOUR; t < saved + every - MIN; t += 15_000) if (checkDue(saved, every, t)) early++;
  assert.equal(early, 0);
});

test("no interval makes more checks than every minute", () => {
  for (const m of EVERY_CHOICES) {
    let last: number | null = null;
    let n = 0;
    for (let t = 0; t < HOUR; t += 15_000) if (checkDue(last, m * MIN, t + 1)) (n++, (last = t + 1));
    assert.ok(n <= 60, `${m} min: ${n} checks an hour`);
  }
});

test("Next check: the time today, the day too when it isn't today", () => {
  const now = new Date(2026, 10, 14, 9, 0).getTime();
  assert.doesNotMatch(whenWords(now + 2 * HOUR, now), /[A-Za-z]{3}/);
  assert.match(whenWords(now + DAY, now), /^\D+ /);
  assert.notEqual(whenWords(now + DAY, now), whenWords(now + 2 * HOUR, now));
});

test("Next check: a week away names the date too, not only a weekday that reads as today's", () => {
  const now = new Date(2026, 10, 14, 9, 0).getTime();
  assert.match(whenWords(now + 7 * DAY, now), /\b21\b/, "the 21st");
  // Within six days, the weekday alone.
  assert.doesNotMatch(whenWords(now + 3 * DAY, now), /\b17\b/);
});

test("the Next check tooltip: an hour or less waits longer; over an hour it tries again within the hour", () => {
  const clock = Date.UTC(2026, 10, 14, 12, 0);
  // The label's time for a last pass `ago` before the clock, as Orders draws it.
  const label = (ago: number, wait: number) => nextCheckShown(clock - ago, wait, clock);
  assert.equal(nextCheckWhy(5, 0, 5 * MIN, label(MIN, 5 * MIN), clock), "The timer checks every 5 min");
  assert.equal(nextCheckWhy(1440, 0, DAY, label(MIN, DAY), clock), "The timer checks once a day");
  // An hour or less: main's words, with the wait that is used (the label is the last pass plus it).
  assert.equal(nextCheckWhy(5, 1, 10 * MIN, label(MIN, 10 * MIN), clock), "warframe.market didn't answer the last pass, so the timer waits longer (10 min) before the next");
  assert.equal(nextCheckWhy(30, 2, HOUR, label(MIN, HOUR), clock), "warframe.market didn't answer the last 2 passes, so the timer waits longer (60 min) before the next");
  // Every hour: the wait is capped at the hour, no longer than the interval, so the plain sentence.
  assert.equal(nextCheckWhy(60, 2, HOUR, label(MIN, HOUR), clock), "The timer checks every hour");
  // Over an hour: the missed pass is dated back, so the label is within the hour; no figure, no "longer".
  for (const every of [120, 360, 720, 1440, 10080]) {
    const words = nextCheckWhy(every, 1, every * MIN, label((every - 60) * MIN + MIN, every * MIN), clock);
    assert.equal(words, "warframe.market didn't answer the last pass, so it tries again within the hour");
    assert.doesNotMatch(words, /longer|\d+ min/);
  }
  // No label: the plain sentence.
  assert.equal(nextCheckWhy(1440, 1, DAY, null, clock), "The timer checks once a day");
});

test("the Next check tooltip follows the wait in force when the interval changed after a missed pass", () => {
  const clock = Date.UTC(2026, 10, 14, 12, 0);
  // No answer every 5 min (the pass is not dated back), then once a day: the wait is the whole
  // day (capped at the interval) and the label a day after the pass, so not "within the hour".
  const day = nextCheckShown(clock - 2 * MIN, DAY, clock);
  assert.equal(day, clock - 2 * MIN + DAY);
  const raised = nextCheckWhy(1440, 1, DAY, day, clock);
  assert.equal(raised, "The timer checks once a day");
  assert.doesNotMatch(raised, /within the hour|longer/);
  // The reverse: no answer once a week (dated back six days and 23 hours), then every 5 min: the
  // label is due now, so no "waits longer".
  const now = nextCheckShown(clock - (10080 - 60) * MIN - 2 * MIN, 10 * MIN, clock);
  assert.equal(now, clock);
  const lowered = nextCheckWhy(5, 1, 10 * MIN, now, clock);
  assert.equal(lowered, "warframe.market didn't answer the last pass, so it tries again now");
  assert.doesNotMatch(lowered, /longer|within the hour/);
  // Over an hour, a pass that went through but stopped part way (label within the hour): the
  // interval's sentence; the tooltip names the retry only after a pass with no answer.
  assert.equal(nextCheckWhy(10080, 0, 10080 * MIN, clock + 40 * MIN, clock), "The timer checks once a week");
});

test("the Next check tooltip, over an hour, names the retry in the first minutes too, when the page's clock is behind the pass", () => {
  const clock = Date.UTC(2026, 10, 14, 12, 0);
  // The page's clock last ticked `behind` before the pass ended (up to nearly two minutes, as
  // Orders is left and come back to); the store dates the pass back so that the next is due an
  // hour after its end, so the label is an hour and `behind` ahead of that clock.
  for (const behind of [0, 30_000, 59_000, 90_000, 119_000]) {
    for (const every of [120, 1440, 10080]) {
      const end = clock + behind;
      const label = nextCheckShown(end - (every - 60) * MIN, every * MIN, clock);
      assert.equal(label, end + HOUR, `${every} min, ${behind} ms behind`);
      assert.equal(nextCheckWhy(every, 1, every * MIN, label, clock), "warframe.market didn't answer the last pass, so it tries again within the hour", `${every} min, ${behind} ms behind`);
    }
  }
  // A label really further than that is the interval's sentence, as before.
  assert.equal(nextCheckWhy(1440, 1, DAY, clock + 3 * HOUR, clock), "The timer checks once a day");
  assert.equal(nextCheckWhy(1440, 1, DAY, clock + HOUR + 3 * MIN, clock), "The timer checks once a day");
});

test("Next check shows right after a pass, though the page's clock is up to a minute old", () => {
  const clock = Date.UTC(2026, 10, 14, 12, 0);
  // A pass that ended 40 s after the page's clock last ticked: its next time, at once.
  assert.equal(nextCheckShown(clock + 40_000, 5 * MIN, clock), clock + 40_000 + 5 * MIN);
  assert.equal(nextCheckShown(clock - 2 * MIN, 5 * MIN, clock), clock + 3 * MIN);
  // Due already: now, never a time behind the clock.
  assert.equal(nextCheckShown(clock - 10 * MIN, 5 * MIN, clock), clock);
  // No check yet, or one more than a minute ahead of the clock (set back): due now.
  assert.equal(nextCheckShown(null, 5 * MIN, clock), null);
  assert.equal(nextCheckShown(clock + DAY, 5 * MIN, clock), null);
});
