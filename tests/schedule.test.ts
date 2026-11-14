// How often the automatic price check runs (core/schedule.ts), what the settings loader keeps of
// it (backend.ts), and when the next check is due, a missed one after a restart included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVERY_CHOICES, checkDue, everyOf, everyWords, lastCheckOf, nextCheckAt, whenWords } from "../src/lib/core/schedule";
import { loadSettings } from "../src/lib/backend";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("the intervals: today's, then 2, 6 and 12 hours, a day and a week; nothing shorter than a minute", () => {
  assert.deepEqual([...EVERY_CHOICES], [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440, 10080]);
  assert.equal(Math.min(...EVERY_CHOICES), 1);
  assert.deepEqual(EVERY_CHOICES.map(everyWords), ["every 1 min", "every 2 min", "every 5 min", "every 10 min", "every 15 min", "every 30 min", "every hour", "every 2 hours", "every 6 hours", "every 12 hours", "once a day", "once a week"]);
});

test("the sanitiser keeps exactly the offered intervals; anything else is the usual one", () => {
  for (const m of EVERY_CHOICES) assert.equal(everyOf(m, 5), m);
  for (const v of [0, 0.5, -60, 3, 45, 90, 1439, 1441, 10079, 20160, NaN, Infinity, "60", null, undefined, {}]) assert.equal(everyOf(v, 5), 5, String(v));
});

test("the loader: an offered interval stays, an unknown or too short one falls back to 5 min", async () => {
  const load = async (market: unknown) => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ market }) };
    return (await loadSettings()).market;
  };
  assert.equal((await load({ every: 10080 })).every, 10080, "once a week");
  assert.equal((await load({ every: 1440 })).every, 1440);
  assert.equal((await load({ every: 45 })).every, 5, "not offered");
  assert.equal((await load({ every: 0 })).every, 5, "too short");
  assert.equal((await load({ every: 20160 })).every, 5, "longer than a week");
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
