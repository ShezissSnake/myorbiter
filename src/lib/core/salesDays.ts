// Sales by local calendar day, for Sales' bar chart and its "today": days start at local
// midnight, so a day with a clock change is 23 or 25 hours long, never shifted by an hour.

/** Local midnight of the day `t` falls in. */
export function localDayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return +d;
}

/**
 * Platinum per day for the last `n` local calendar days up to the one `now` falls in, oldest first.
 * A sale before the first day is left out; one after `now` (a clock ahead) counts on the last day.
 */
export function salesByDay(sales: readonly { at: number; quantity: number; platinum: number }[], now: number, n: number): { at: number; plat: number }[] {
  const today = localDayStart(now);
  const out = Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (n - 1 - i));
    return { at: +d, plat: 0 };
  });
  for (const s of sales) {
    if (!(s.at >= out[0].at)) continue;
    let i = n - 1;
    while (i > 0 && s.at < out[i].at) i--;
    out[i].plat += s.quantity * s.platinum;
  }
  return out;
}
