// The daily trade limit: as many trades a day as your Mastery Rank (Founders get two more), every
// completed trade counting once whatever it carried, refreshed at 00:00 UTC. Up to 6 items go each
// way in one trade. Counted from the trades orbiter read in the game's log.

/** The most items one side of a trade can carry. */
export const ITEMS_PER_TRADE = 6;

/** 00:00 UTC of the day `now` falls in (Unix ms). */
export function utcDayStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface TradeAllowance {
  /** Trades a day at your rank; null when the rank isn't known yet. */
  limit: number | null;
  /** Trades orbiter saw since 00:00 UTC. */
  used: number;
  /** Left today; null without a rank. */
  left: number | null;
  /** When it refreshes (Unix ms). */
  resets: number;
}

export function tradeAllowance(trades: { at: number }[], masteryRank: number | null | undefined, now = Date.now()): TradeAllowance {
  const start = utcDayStart(now);
  const used = trades.filter((t) => t.at >= start && t.at <= now).length;
  const limit = masteryRank == null || masteryRank < 2 ? (masteryRank == null ? null : 0) : masteryRank;
  return { limit, used, left: limit == null ? null : Math.max(0, limit - used), resets: start + 86_400_000 };
}

/**
 * Days of trading a pile of spare copies takes at your rank, `trades` a day with up to 6 copies
 * in each (the best case: buyers often take one): 4,840 mods at 24 trades a day is 34 days.
 */
export function daysToTrade(copies: number, tradesPerDay: number | null | undefined): number | null {
  if (!tradesPerDay || tradesPerDay <= 0) return null;
  return Math.ceil(copies / (tradesPerDay * ITEMS_PER_TRADE));
}
