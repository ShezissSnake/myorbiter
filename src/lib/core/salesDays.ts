// Sales by local calendar day, for Sales' bar chart and its "today": days start at local
// midnight, so a day with a clock change is 23 or 25 hours long, never shifted by an hour.

/** Local midnight of the day `t` falls in. */
export function localDayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return +d;
}

/** Local midnight `n` calendar days after (or, negative, before) the midnight `day`. */
function addDays(day: number, n: number): number {
  const d = new Date(day);
  d.setDate(d.getDate() + n);
  return +d;
}

/**
 * Platinum per day for the last `n` local calendar days up to the one `now` falls in, oldest first.
 * A sale before the first day is left out; one after `now` (a clock ahead) counts on the last day.
 */
export function salesByDay(sales: readonly { at: number; quantity: number; platinum: number }[], now: number, n: number): { at: number; plat: number }[] {
  const today = localDayStart(now);
  const out = Array.from({ length: n }, (_, i) => ({ at: addDays(today, -(n - 1 - i)), plat: 0 }));
  for (const s of sales) {
    if (!(s.at >= out[0].at)) continue;
    // The last day starting at or before the sale (a search: "All" can hold years of days).
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s.at >= out[mid].at) lo = mid;
      else hi = mid - 1;
    }
    out[lo].plat += s.quantity * s.platinum;
  }
  return out;
}

/**
 * The most bars the chart draws. Up to this many days it draws a bar a day; past it, a bar for
 * several days. The chart is narrowest beside Best sellers in a window about 1,190 px wide, where
 * the page takes two columns with the sidebar open (440 to 470 px of bars, by the scale's widest
 * number; in one column, from the 900 px window up, it is wider): there 92 bars are about 5 px
 * apart, a 4 px bar and a 1 px gap, still a bar to point at. A bar a day covers three months; a
 * bar a week up to 21 months.
 */
export const MOST_BARS = 92;
/** How many days one bar may cover, smallest first: a day, a week, 2, 4, 8, 13, 26 and 52 weeks. */
const BAR_DAYS = [1, 7, 14, 28, 56, 91, 182, 364];

/** One bar's days in words: "day", "week", "2 weeks". */
export function barWords(days: number): string {
  return days === 1 ? "day" : days === 7 ? "week" : `${days / 7} weeks`;
}

/**
 * Round values for the chart's scale, from 0 up to the first at or above `peak`: 1, 2 or 5 times
 * a power of ten apart, whole platinum, at most four steps. Empty when nothing was made.
 */
export function scaleTicks(peak: number): number[] {
  if (!(peak > 0)) return [];
  const rough = peak / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag);
  const top = Math.ceil(peak / step);
  return Array.from({ length: top + 1 }, (_, i) => i * step);
}

export type SalesChart = {
  /** Each bar, oldest first: its first day's local midnight, the midnight after its last day, its platinum. */
  bars: { at: number; end: number; plat: number }[];
  /** Days per bar (BAR_DAYS). */
  per: number;
  /** Days the chart covers (bars × per). */
  days: number;
  /** Platinum over the days shown. */
  total: number;
  /** The best bar's platinum. */
  best: number;
  /** Platinum a day, over every day shown, days with no sale counted; null when nothing was made. */
  daily: number | null;
  /** The scale: round values from 0 to the top of the chart (empty when nothing was made). */
  ticks: number[];
  /** The value at the chart's top: the last tick, or 1 with nothing made. */
  top: number;
};

/**
 * Sales' chart for a span: the last 7 or 30 days, or "all", every day from the first sale's to
 * today (never fewer than 30), by bars of a day or, past MOST_BARS days, of a week or more. Days
 * are local calendar days as in salesByDay; with bars of several days the first bar may start
 * before the first sale, and its days count as days shown.
 */
export function salesChart(sales: readonly { at: number; quantity: number; platinum: number }[], now: number, span: "7" | "30" | "all"): SalesChart {
  const today = localDayStart(now);
  let n = span === "7" ? 7 : 30;
  if (span === "all") {
    let first = Infinity;
    for (const s of sales) if (s.at < first) first = s.at;
    // A day count by calendar, not by 24 hours (a clock change makes a day 23 or 25). A sale
    // dated a lifetime back (a log edited by hand) holds the chart to MOST_BARS bars of 52 weeks.
    const most = MOST_BARS * 364;
    if (first < today) n = Math.max(n, first < today - most * 86_400_000 ? most : Math.min(most, Math.round((today - localDayStart(first)) / 86_400_000) + 1));
  }
  const per = BAR_DAYS.find((d) => Math.ceil(n / d) <= MOST_BARS) ?? 364;
  const count = Math.ceil(n / per);
  const byDay = salesByDay(sales, now, count * per);
  const bars = Array.from({ length: count }, (_, i) => {
    const days = byDay.slice(i * per, (i + 1) * per);
    return { at: days[0].at, end: addDays(days[days.length - 1].at, 1), plat: days.reduce((t, d) => t + d.plat, 0) };
  });
  const total = bars.reduce((t, b) => t + b.plat, 0);
  const best = bars.reduce((m, b) => Math.max(m, b.plat), 0);
  const ticks = scaleTicks(best);
  return { bars, per, days: count * per, total, best, daily: total > 0 ? total / (count * per) : null, ticks, top: ticks.length ? ticks[ticks.length - 1] : 1 };
}
