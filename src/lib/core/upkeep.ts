// Bookkeeping for a session that stays open for hours: how long to wait after failures, how the
// remembered lists stay bounded, and which hand-logged sale a trade from the game log stands for.
import type { Sale, ValuePoint } from "../backend";
import { copiesInCommon, sameSaleItem } from "./sameSale";

/** `base`, doubled for each failure in a row (up to 2^6 times), never more than `cap`. */
export const backoff = (base: number, failures: number, cap: number) => Math.min(cap, base * 2 ** Math.min(Math.max(0, failures), 6));

/**
 * Keys already handled, newest first, capped at `max`, except that keys of the game session still
 * in the log (prefix `session|`) are never dropped: the log shows them again on every read.
 */
export function keepSeen(fresh: string[], seen: string[], max: number, session: string | null): string[] {
  const all = [...fresh, ...seen];
  if (all.length <= max) return all;
  const live = session == null ? null : `${session}|`;
  return all.filter((k, i) => i < max || (live != null && k.startsWith(live)));
}

/** The local calendar day of a time, as a key (a clock change doesn't move it). */
const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * Inventory value over time: every point from the last `fullDays` days, one point (the day's last)
 * for each day before that, and at most `max` points in all. A year of history stays a year.
 */
export function thinHistory(points: ValuePoint[], now = Date.now(), fullDays = 30, max = 2000): ValuePoint[] {
  const recentFrom = now - fullDays * 86_400_000;
  const out: ValuePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    // Older than the window: keep it only if it's the last point of its day.
    if (p.at < recentFrom && next && next.at < recentFrom && dayKey(next.at) === dayKey(p.at)) continue;
    out.push(p);
  }
  return out.length > max ? out.slice(-max) : out;
}

/** How close in time a sale logged by hand and a trade from the game log must be to be the same sale. */
export const SAME_SALE_MS = 10 * 60_000;

/**
 * The sale you logged yourself (not from a trade) that this trade's line already counts, or null:
 * the nearest one of the same item at the same rank within ten minutes (sameSaleItem), and how
 * many of the line's copies it stands for (copiesInCommon). A hand-logged sale stands for one
 * trade only: once a trade claims it (its `trade` is set), a second sale of the same item minutes
 * later is a sale of its own.
 */
export function handLoggedSale(sales: Sale[], line: { name: string; rank: number | null; count: number }, at: number): { index: number; copies: number } | null {
  let best = -1;
  for (let i = 0; i < sales.length; i++) {
    const x = sales[i];
    if (x.trade != null || !sameSaleItem(x, line) || Math.abs(x.at - at) >= SAME_SALE_MS) continue;
    if (best < 0 || Math.abs(x.at - at) < Math.abs(sales[best].at - at)) best = i;
  }
  return best < 0 ? null : { index: best, copies: copiesInCommon(sales[best], line) };
}

/** TennoScope's reason for not starting, and what to do about it where that's known. */
export function failureWords(message: string, retryIn: number): string {
  const wait = retryIn > 0 ? ` MyOrbiter tries again in ${Math.max(1, Math.round(retryIn / 60_000))} min.` : "";
  if (/schema version \d+ is not supported/.test(message))
    return `TennoScope stops as it starts: it's older than the TennoScope that last opened your data ("${message}"). Update the TennoScope MyOrbiter starts (Settings → TennoScope; with your own build, rebuild it as tennoscope/ORBITER.md says).${wait}`;
  return `TennoScope stops as it starts. Its log says: "${message}".${wait}`;
}

/** TennoScope ended `tries` times in a row soon after starting: MyOrbiter stopped starting it. */
export function gaveUpWords(tries: number, message: string | null): string {
  const why = message ? ` Its log says: "${message}".` : "";
  return `TennoScope stopped ${tries} times in a row soon after it started, so MyOrbiter has stopped starting it.${why} Press Start in Settings, TennoScope to try again.`;
}
