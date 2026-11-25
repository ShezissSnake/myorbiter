// Time, fuzzed: random moments around midnight, the weekly reset and clock changes, in time zones
// with daylight saving (whole and half hour), far east and far west of UTC. Seeds as in
// tests/support/prop.ts. process.env.TZ is switched per case; Node reads it as it changes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { checkedWhen } from "../src/lib/core/timers";
import { until } from "../src/lib/core/traders";
import { nextMondayUtc } from "../src/lib/core/today";
import { TRADE_CLOCK_LEEWAY_MS, tradeAllowance, utcDayStart } from "../src/lib/core/tradeLimit";
import { isDone, setDone } from "../src/lib/core/chores";
import { localDayStart, MOST_BARS, salesByDay, salesChart, scaleTicks } from "../src/lib/core/salesDays";
import { inventoryTrust, MAX_INVENTORY_AGE_MS } from "../src/lib/core/listGuard";
import { forAll } from "./support/prop";

const ZONES = ["UTC", "America/Los_Angeles", "Europe/London", "Australia/Lord_Howe", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kathmandu", "America/Sao_Paulo"];
// Clock changes in 2026: Los Angeles (Mar 8, Nov 1), London (Mar 29, Oct 25), Lord Howe (Apr 5, Oct 4; half an hour).
const CHANGES = [Date.UTC(2026, 2, 8, 10), Date.UTC(2026, 10, 1, 9), Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 9, 25, 1), Date.UTC(2026, 3, 4, 15), Date.UTC(2026, 9, 3, 15)];
const H = 3_600_000;
const original = process.env.TZ;
after(() => {
  if (original == null) delete process.env.TZ;
  else process.env.TZ = original;
});

/** A moment near something that makes time awkward: a clock change, a UTC midnight, a Monday. */
const awkward = (r: { pick: <T>(xs: readonly T[]) => T; int: (a: number, b: number) => number }) =>
  r.pick([...CHANGES, Date.UTC(2026, 10, 9), Date.UTC(2026, 11, 31, 23, 59), Date.UTC(2027, 0, 1)]) + r.int(-50 * H, 50 * H);

test("'yesterday' is the calendar day before, in every time zone, across clock changes", () => {
  forAll("checkedWhen", (r, seed) => {
    process.env.TZ = r.pick(ZONES);
    const now = awkward(r);
    const today = localDayStart(now);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    // A moment somewhere in yesterday (it may be 23, 24 or 25 hours long).
    const at = +yesterday + r.int(0, today - +yesterday - 1);
    const said = checkedWhen(at, now);
    assert.match(said, /^yesterday /, `PROPERTY_SEED=${seed} TZ=${process.env.TZ}: ${new Date(at).toString()} seen ${new Date(now).toString()} → ${said}`);
    const earlier = r.int(today, now);
    assert.match(checkedWhen(earlier, now), /^today /, `PROPERTY_SEED=${seed} TZ=${process.env.TZ}`);
  });
});

test("Sales by day: every sale in its own local day, each day midnight to midnight, totals kept", () => {
  forAll("salesByDay", (r, seed) => {
    process.env.TZ = r.pick(ZONES);
    const now = awkward(r);
    const n = r.pick([7, 30]);
    const sales = Array.from({ length: r.int(0, 40) }, () => ({ at: now - r.int(-10 * 60_000, 35 * 24 * H), quantity: r.int(1, 3), platinum: r.int(1, 90) }));
    const days = salesByDay(sales, now, n);
    const ctx = `PROPERTY_SEED=${seed} TZ=${process.env.TZ}`;
    assert.equal(days.length, n, ctx);
    for (const d of days) assert.equal(localDayStart(d.at), d.at, `${ctx}: a day that doesn't start at midnight: ${new Date(d.at).toString()}`);
    assert.equal(days[n - 1].at, localDayStart(now), ctx);
    for (let i = 1; i < n; i++) {
      const len = days[i].at - days[i - 1].at;
      assert.ok(len >= 22.5 * H && len <= 25.5 * H, `${ctx}: a ${len / H} h day`);
    }
    const counted = sales.filter((s) => s.at >= days[0].at).reduce((t, s) => t + s.quantity * s.platinum, 0);
    assert.equal(days.reduce((t, d) => t + d.plat, 0), counted, `${ctx}: totals`);
    for (const s of sales) {
      if (s.at < days[0].at || s.at > now) continue;
      const day = days.find((d, i) => s.at >= d.at && (i === n - 1 || s.at < days[i + 1].at))!;
      assert.equal(day.at, localDayStart(s.at), `${ctx}: a sale at ${new Date(s.at).toString()} counted on ${new Date(day.at).toString()}`);
    }
  });
});

test("Sales' chart: 7 and 30 days are salesByDay's days; All runs from the first sale's day to today", () => {
  forAll("salesChart", (r, seed) => {
    process.env.TZ = r.pick(ZONES);
    const now = awkward(r);
    const today = localDayStart(now);
    // Sales over a few days to several years back, some a few minutes ahead of now (a clock ahead).
    const back = r.pick([3, 20, 45, 80, 92, 93, 200, 700, 3000]);
    const sales = Array.from({ length: r.int(0, 30) }, () => ({ at: now - r.int(-10 * 60_000, back * 24 * H), quantity: r.int(1, 3), platinum: r.int(1, 900) }));
    const ctx = `PROPERTY_SEED=${seed} TZ=${process.env.TZ}`;
    for (const span of ["7", "30"] as const) {
      const c = salesChart(sales, now, span);
      assert.deepEqual(c.bars.map((b) => ({ at: b.at, plat: b.plat })), salesByDay(sales, now, Number(span)), `${ctx}: ${span} days`);
      assert.equal(c.per, 1, ctx);
    }
    const c = salesChart(sales, now, "all");
    const days = salesByDay(sales, now, c.days);
    assert.ok(c.bars.length <= MOST_BARS && c.bars.length >= 1, `${ctx}: ${c.bars.length} bars`);
    assert.equal(c.days, c.bars.length * c.per, ctx);
    assert.ok(c.days >= 30, `${ctx}: ${c.days} days, fewer than 30 days shows`);
    // Every day from the first sale's to today, and less than a bar's worth of days before it.
    const first = sales.length ? localDayStart(Math.min(...sales.map((s) => s.at))) : today;
    assert.ok(days[0].at <= first, `${ctx}: the first sale's day is left out`);
    if (c.per === 1) assert.ok(days[0].at === first || c.days === 30, `${ctx}: a bar a day starts on ${new Date(days[0].at).toString()}, not the first sale's day`);
    else assert.ok(days[c.per].at > first && c.days > MOST_BARS, `${ctx}: a whole bar before the first sale, or bars of ${c.per} days for ${c.days} days`);
    // Each bar: its days in order, back to back, the last one ending at tomorrow's midnight.
    for (const [i, b] of c.bars.entries()) {
      assert.equal(b.at, days[i * c.per].at, `${ctx}: bar ${i}`);
      assert.equal(b.end, i + 1 < c.bars.length ? c.bars[i + 1].at : localDayStart(today + 36 * H), `${ctx}: bar ${i} ends`);
      assert.equal(b.plat, days.slice(i * c.per, (i + 1) * c.per).reduce((t, d) => t + d.plat, 0), `${ctx}: bar ${i}`);
    }
    // Every sale counted, those after now included.
    assert.equal(c.total, sales.reduce((t, s) => t + s.quantity * s.platinum, 0), `${ctx}: total`);
    const ahead = sales.filter((s) => s.at > now).reduce((t, s) => t + s.quantity * s.platinum, 0);
    for (const span of ["7", "30", "all"] as const) {
      const k = salesChart(sales, now, span);
      // The best bar, and the average over every day shown, days with no sale counted.
      assert.equal(k.best, Math.max(0, ...k.bars.map((b) => b.plat)), ctx);
      assert.equal(k.daily, k.total ? k.total / k.days : null, ctx);
      assert.ok(k.ticks.length ? k.top >= k.best : k.best === 0, ctx);
      assert.ok(k.bars[k.bars.length - 1].plat >= ahead, `${ctx}: a sale after now is left off the last bar`);
    }
  }, 600);
});

test("Sales' chart: no sale, one sale, sales on one day, and a log reaching back decades", () => {
  process.env.TZ = "Europe/London";
  const now = Date.UTC(2026, 10, 25, 12);
  const at = (daysAgo: number, platinum: number) => ({ at: now - daysAgo * 24 * H, quantity: 1, platinum });
  const none = salesChart([], now, "all");
  assert.equal(none.bars.length, 30);
  assert.deepEqual([none.best, none.total, none.daily, none.ticks, none.top], [0, 0, null, [], 1]);
  const one = salesChart([at(0, 1)], now, "all");
  assert.deepEqual([one.bars.length, one.per, one.best, one.daily, one.ticks], [30, 1, 1, 1 / 30, [0, 1]]);
  const oneDay = salesChart([at(5, 40), at(5, 60)], now, "all");
  assert.deepEqual([oneDay.bars.length, oneDay.best, oneDay.bars[24].plat], [30, 100, 100]);
  // Two months: a bar a day from the first sale's day, days with no sale included.
  const months = salesChart([at(61, 10), at(30, 20), at(0, 30)], now, "all");
  assert.deepEqual([months.bars.length, months.per, months.bars[0].plat, months.bars[1].plat, months.daily], [62, 1, 10, 0, 60 / 62]);
  // From three months on (93 days), a bar a week, the last ending today.
  assert.deepEqual([salesChart([at(91, 1)], now, "all").per, salesChart([at(91, 1)], now, "all").days], [1, 92]);
  const weeks = salesChart([at(92, 1)], now, "all");
  assert.deepEqual([weeks.per, weeks.bars.length, weeks.days, weeks.bars[13].end], [7, 14, 98, Date.UTC(2026, 10, 26)]);
  // A clock ahead: a sale tomorrow counts today, and "All" still shows 30 days.
  const ahead = salesChart([at(-1, 7)], now, "all");
  assert.deepEqual([ahead.bars.length, ahead.bars[29].plat], [30, 7]);
  // A sale dated in 1970 or before: at most MOST_BARS bars of 52 weeks, every later sale still counted.
  for (const old of [0, -1e15, -Infinity]) {
    const c = salesChart([{ at: old, quantity: 1, platinum: 5 }, at(0, 5)], now, "all");
    assert.ok(c.bars.length <= MOST_BARS && c.per === 364, `${old}: ${c.bars.length} bars of ${c.per} days`);
    assert.equal(c.bars[c.bars.length - 1].plat, 5, String(old));
  }
});

test("Sales' chart scale: round steps from 0 past the best bar, at most four", () => {
  assert.deepEqual(scaleTicks(0), []);
  assert.deepEqual(scaleTicks(1), [0, 1]);
  assert.deepEqual(scaleTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(scaleTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(scaleTicks(250), [0, 100, 200, 300]);
  assert.deepEqual(scaleTicks(29_448), [0, 10_000, 20_000, 30_000]);
  forAll("scaleTicks", (r, seed) => {
    const peak = r.pick([r.int(1, 20), r.int(1, 2000), r.int(1, 2_000_000)]);
    const t = scaleTicks(peak);
    const step = t[1];
    const ctx = `PROPERTY_SEED=${seed} peak ${peak}: ${t.join(", ")}`;
    assert.ok(t.length >= 2 && t.length <= 5, ctx);
    assert.equal(t[0], 0, ctx);
    assert.ok(t[t.length - 1] >= peak && t[t.length - 2] < peak, ctx);
    assert.ok(Number.isInteger(step) && /^[125]0*$/.test(String(step)), ctx);
    t.forEach((v, i) => assert.equal(v, i * step, ctx));
  });
});

test("the daily trade limit: today is since 00:00 UTC in every time zone, a clock a little ahead still counts", () => {
  forAll("trades", (r, seed) => {
    process.env.TZ = r.pick(ZONES);
    const now = awkward(r);
    const start = utcDayStart(now);
    assert.equal(new Date(start).toISOString().slice(11), "00:00:00.000Z");
    assert.ok(start <= now && now - start < 24 * H);
    const trades = Array.from({ length: r.int(0, 30) }, () => ({ at: now + r.int(-30 * H, 10 * 60_000) }));
    const a = tradeAllowance(trades, r.int(0, 30), now);
    const expect = trades.filter((t) => t.at >= start && t.at <= now + TRADE_CLOCK_LEEWAY_MS).length;
    assert.equal(a.used, expect, `PROPERTY_SEED=${seed}`);
    assert.equal(a.resets, start + 24 * H);
    assert.ok(a.left == null || (a.left >= 0 && a.left <= (a.limit ?? 0)));
  });
});

test("the weekly reset is the next Monday 00:00 UTC, in every time zone", () => {
  forAll("monday", (r, seed) => {
    process.env.TZ = r.pick(ZONES);
    const now = awkward(r);
    const next = Date.parse(nextMondayUtc(now));
    const d = new Date(next);
    assert.equal(d.getUTCDay(), 1, `PROPERTY_SEED=${seed}`);
    assert.equal(d.toISOString().slice(11), "00:00:00.000Z");
    assert.ok(next > now && next - now <= 7 * 24 * H, `PROPERTY_SEED=${seed}: ${d.toISOString()} from ${new Date(now).toISOString()}`);
  });
});

test("countdowns: never negative, never NaN, '—' for an expiry that isn't a time", () => {
  forAll("until", (r, seed) => {
    const now = awkward(r);
    const iso = r.pick([new Date(now + r.int(-H, 9 * 24 * H)).toISOString(), "", "garbage", "2026-13-45T99:00:00Z", null, undefined]);
    const s = until(iso, now);
    assert.ok(!/NaN|-/.test(s), `PROPERTY_SEED=${seed}: ${iso} → ${s}`);
    if (iso && Number.isFinite(Date.parse(iso)) && Date.parse(iso) > now + 60_000) assert.match(s, /\d/, `PROPERTY_SEED=${seed}`);
    if (!iso || !Number.isFinite(Date.parse(iso))) assert.equal(s, "—", `PROPERTY_SEED=${seed}: ${iso}`);
  });
});

test("chores: a tick lasts until its reset passes, whatever the time zone", () => {
  forAll("chores", (r, seed) => {
    process.env.TZ = r.pick(ZONES);
    const now = awkward(r);
    const resets = now + r.int(-H, 8 * 24 * H);
    const ticks = setDone({}, "sortie", resets, true, now);
    assert.equal(isDone(ticks, "sortie", resets, now), resets > now, `PROPERTY_SEED=${seed}`);
    assert.equal(isDone(ticks, "sortie", resets, resets + 1), false, `PROPERTY_SEED=${seed}`);
  });
});

test("the 3-hour inventory rule counts real time: a clock change doesn't stretch or shrink it", () => {
  forAll("trust", (r, seed) => {
    process.env.TZ = r.pick(ZONES);
    const read = r.pick(CHANGES) + r.int(-4 * H, 1 * H);
    const now = read + r.int(0, 4 * H);
    const m = { observedAt: new Date(read), inventoryByBase: new Map([["/x", [{}]]]), catalogByUnique: new Map([["/x", {}]]), mastered: new Set(["/x"]) } as never;
    assert.equal(inventoryTrust(m, now).ok, now - read <= MAX_INVENTORY_AGE_MS, `PROPERTY_SEED=${seed}`);
  });
});
