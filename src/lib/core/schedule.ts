// How often the automatic price check runs (Orders' "Check automatically" and "Apply
// automatically"), and when the next one is due. The choices are fixed: nothing shorter than a
// minute, nothing longer than a week, no free typing. The interval sets how often the order books
// are read; the limits per listing (core/drift.ts: once an hour, six times a day) are separate and
// hold whatever the interval.
//
// The time of the last timed check is kept in the settings, so a long interval means what it says
// across restarts: a start before the next check is due waits for it; a start after it was due
// (the app was closed when it fell) runs one check, once, as soon as the first check after a start
// can run; the next one comes a whole interval after that. A saved time in the future (a clock
// that went back) counts as due, as no saved time does: one check, as on every start before.

/** The intervals offered, in minutes: every 1, 2, 5, 10, 15 and 30 minutes, every hour, 2, 6 and 12 hours, once a day, once a week. */
export const EVERY_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440, 10080] as const;

/** The interval from a saved file: one of the choices, or `fallback`. */
export function everyOf(v: unknown, fallback: number): number {
  return typeof v === "number" && (EVERY_CHOICES as readonly number[]).includes(v) ? v : fallback;
}

/** "every 5 min", "every hour", "every 6 hours", "once a day", "once a week". */
export function everyWords(min: number): string {
  if (min === 10080) return "once a week";
  if (min === 1440) return "once a day";
  if (min === 60) return "every hour";
  if (min > 60 && min % 60 === 0) return `every ${min / 60} hours`;
  return `every ${min} min`;
}

/** The last check's time from a saved file: a finite, positive number, or null. */
export function lastCheckOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * When the next timed check is due: `wait` after the last one (this run's, or the saved one from
 * an earlier run). Null when it is due now: no check yet, or the saved time is in the future.
 */
export function nextCheckAt(last: number | null, wait: number, now: number): number | null {
  if (last == null || last > now) return null;
  return last + wait;
}

/** Whether the timed check is due at `now` (see `nextCheckAt`). */
export function checkDue(last: number | null, wait: number, now: number): boolean {
  const next = nextCheckAt(last, wait, now);
  return next == null || now >= next;
}

/** "14:05" today; "Tue 14:05" on another day. */
export function whenWords(t: number, now: number): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString(undefined, { weekday: "short", ...(t - now > 6 * 86_400_000 ? { day: "numeric", month: "short" } : {}) })} ${time}`;
}
