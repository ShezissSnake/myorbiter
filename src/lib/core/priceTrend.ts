// An item's last 90 days on warframe.market, a day at a time: what it sold for and how many, and
// whether this week is dearer or cheaper than the month before.

/** One day, as src-tauri/src/market.rs `PricePoint` reads it. */
export interface PricePoint {
  at: string;
  median: number;
  volume: number;
  min: number;
  max: number;
  rank: number | null;
  subtype: string | null;
}

export interface Day {
  at: number;
  median: number;
  volume: number;
}

/**
 * The days for one rank and variant, oldest first. `rank` null: an unranked item (or any rank).
 * `subtype` null: the item's default variant (relics: intact).
 */
export function daysFor(points: PricePoint[], rank: number | null, subtype: string | null): Day[] {
  const subs = new Set(points.map((p) => p.subtype).filter(Boolean));
  const want = subtype ?? (subs.has("intact") ? "intact" : null);
  return points
    .filter((p) => (rank == null || p.rank == null || p.rank === rank) && (want == null || p.subtype == null || p.subtype === want))
    .map((p) => ({ at: Date.parse(p.at), median: p.median, volume: p.volume }))
    .filter((d) => Number.isFinite(d.at))
    .sort((a, b) => a.at - b.at);
}

export interface Trend {
  /** What a sale went for over the last 7 days (weighted by how many sold each day). */
  week: number | null;
  /** The 30 days before that. */
  month: number | null;
  /** week / month - 1. */
  change: number | null;
  /** Sales a day over the last 30 days. */
  perDay: number;
}

const DAY = 86_400_000;
function weighted(days: Day[]): number | null {
  const n = days.reduce((s, d) => s + d.volume, 0);
  return n ? days.reduce((s, d) => s + d.median * d.volume, 0) / n : null;
}

export function trend(days: Day[], now = days.length ? days[days.length - 1].at + DAY : Date.now()): Trend {
  const week = weighted(days.filter((d) => d.at > now - 7 * DAY));
  const month = weighted(days.filter((d) => d.at <= now - 7 * DAY && d.at > now - 37 * DAY));
  const last30 = days.filter((d) => d.at > now - 30 * DAY);
  return { week, month, change: week != null && month ? week / month - 1 : null, perDay: last30.reduce((s, d) => s + d.volume, 0) / 30 };
}

/**
 * What one sold for lately: the median of each day's sales over the last `days` days, weighted by
 * how many sold that day. Null when fewer than `minSold` sold in that time: one sale is a guess.
 */
export function recentPrice(points: PricePoint[], rank: number | null, subtype: string | null, days = 30, minSold = 1): number | null {
  const all = daysFor(points, rank, subtype);
  if (!all.length) return null;
  const end = all[all.length - 1].at;
  const d = all.filter((x) => x.at > end - days * DAY);
  if (d.reduce((n, x) => n + x.volume, 0) < minSold) return null;
  const w = weighted(d);
  return w == null ? null : Math.round(w * 10) / 10;
}

/** "Up 12% this week", "Steady", or null when there's too little to say. */
export function trendWords(t: Trend): string | null {
  if (t.change == null) return null;
  const pct = Math.round(t.change * 100);
  return Math.abs(pct) < 5 ? "Steady this week" : `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% this week`;
}
