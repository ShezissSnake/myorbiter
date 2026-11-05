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
import { localDayStart, salesByDay } from "../src/lib/core/salesDays";
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
