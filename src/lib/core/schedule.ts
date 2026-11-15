// How often the automatic price check runs (Orders' "Check automatically" and "Apply
// automatically"), and when the next one is due. The choices are fixed: nothing shorter than a
// minute, nothing longer than a week, no free typing. The interval sets how often the order books
// are read; the limits per listing (core/drift.ts: once an hour, six times a day) are separate and
// hold whatever the interval.
//
// For an interval over an hour, the time of the last timed check is kept in the settings, so a
// long interval means what it says across restarts: a start before the next check is due waits
// for it; a start after it was due (the app was closed when it fell) runs one check, once, as soon
// as the first check after a start can run; the next one comes a whole interval after that. A
// saved time in the future (a clock that went back) counts as due, as no saved time does: one
// check, as on every start before. At an hour or less the time stays in memory, and a start
// checks at once.

/** Only intervals over this many minutes save the time of the last check in the settings: a save
 *  (and the redraw of hidden pages it brings) then comes at most once an hour. */
export const SAVED_ABOVE_MIN = 60;
export const savesCheck = (every: number | undefined): boolean => every != null && every > SAVED_ABOVE_MIN;

/** The intervals offered, in minutes: every 1, 2, 5, 10, 15 and 30 minutes, every hour, 2, 6 and 12 hours, once a day, once a week. */
export const EVERY_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120, 360, 720, 1440, 10080] as const;

/**
 * The interval from a saved file: one of the choices. Another number (an older build's, or a file
 * edited by hand) goes to the nearest choice that is not shorter, so a check never comes more often
 * than the file asked (240 becomes every 6 hours); past a week, to once a week, the longest there
 * is. `fallback` only for no number at all, or one under a minute.
 */
export function everyOf(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return fallback;
  return EVERY_CHOICES.find((c) => c >= v) ?? EVERY_CHOICES[EVERY_CHOICES.length - 1];
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

/**
 * "Next check" on Orders: when the next timed check runs, never before `clock`; null when it is
 * due now. `clock` is the page's minute clock, up to a minute old, so a pass that just ended is
 * ahead of it: it's asked with the later of the two, and the label shows at once. A last check
 * more than a minute ahead of the clock is a clock set back, due now as in `nextCheckAt`.
 */
export function nextCheckShown(last: number | null, wait: number, clock: number): number | null {
  if (last == null) return null;
  const at = nextCheckAt(last, wait, last - clock <= 60_000 ? Math.max(clock, last) : clock);
  return at == null ? null : Math.max(at, clock);
}

/**
 * The "Next check" tooltip, true of the label it sits on: `next` is the label's time
 * (`nextCheckShown`), `wait` the store's `passDelay`, `clock` the page's clock. After passes
 * warframe.market didn't answer, the words follow the wait in force, not the interval alone (the
 * interval may have changed since):
 * - the label is due now (a dated-back pass, then a shorter interval): it tries again now;
 * - the wait is longer than the interval (an hour or less doubles it, up to an hour): it waits
 *   longer, with that wait; a label ahead of the clock is the last check plus `wait`, so the
 *   figure is the one behind it;
 * - over an hour, a label within the hour (the store dates a missed pass back): it tries again
 *   within the hour, with no figure;
 * - anything else (a missed pass at an hour or less, then once a day): the interval's sentence.
 */
export function nextCheckWhy(every: number, failures: number, wait: number, next: number | null, clock: number): string {
  const plain = `The timer checks ${everyWords(every)}`;
  if (!failures || next == null) return plain;
  const missed = `warframe.market didn't answer the last ${failures === 1 ? "pass" : `${failures} passes`}`;
  if (next <= clock) return `${missed}, so it tries again now`;
  if (wait > every * 60_000) return `${missed}, so the timer waits longer (${Math.round(wait / 60_000)} min) before the next`;
  // 61 minutes: the page's clock is up to a minute behind a pass that just ended.
  if (every > 60 && next - clock <= 61 * 60_000) return `${missed}, so it tries again within the hour`;
  return plain;
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
