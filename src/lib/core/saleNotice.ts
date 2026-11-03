// The notification for a sale in game: what you sold, to whom, for how much. Every trade where
// you gave items and got only platinum back is told once, whether or not you're signed in to
// warframe.market; when orbiter also marked the listing sold there, that goes on a second line.
import type { Trade, TradeItem } from "./types";

/** What became of one item of a sale on warframe.market, when orbiter marked sales from the game. */
export type SaleOutcome = "marked" | "still listed" | "not listed" | "hand";

/** One line of a sale: an item (a whole set when the trade was one), with what became of its listing. */
export interface SoldLine extends TradeItem {
  outcome?: SaleOutcome;
}

/** A sale: items out, only platinum in. Buying (platinum out), swaps and gifts aren't. */
export const isSale = (t: Trade) => t.platinum_received > 0 && t.platinum_offered <= 0 && t.offered.length > 0 && t.received.length === 0;

/** How long after a trade it's still worth telling (and acting on): as the marking of sales does. */
export const TELL_WINDOW = 30 * 60_000;

/**
 * Whether a trade is recent enough to tell: from the last half hour. A trade with no time (the
 * log's session start wasn't seen) only once it turns up after this run's first read of its
 * session: the first read can be hours late, after orbiter was closed.
 */
export const recentTrade = (t: Trade, now: number, firstRead: boolean) => (t.at ? now - t.at * 1000 < TELL_WINDOW : !firstRead);

/** "3 × Gauss Prime Neuroptics Blueprint", "Arcane Energize (rank 5)". */
export function soldName(x: TradeItem): string {
  return `${x.count > 1 ? `${x.count} × ` : ""}${x.name}${x.rank != null && x.rank > 0 ? ` (rank ${x.rank})` : ""}`;
}

/** The second line, when every item came out the same; `many`: more than one item. */
const outcomeLine = (o: SaleOutcome, many: boolean) =>
  ({
    marked: "Marked sold on warframe.market and logged.",
    "still listed": `Logged, but still listed on warframe.market: ${many ? "they" : "it"} couldn't be marked sold (see Orders).`,
    "not listed": `Logged; ${many ? "they weren't" : "it wasn't"} listed on warframe.market.`,
    hand: "Already in your sales log.",
  })[o];
const OUTCOME_WORD: Record<SaleOutcome, string> = {
  marked: "marked sold",
  "still listed": "still listed",
  "not listed": "not listed",
  hand: "logged by hand",
};

/**
 * The words of a sale's notification. `lines`: the items as orbiter logged them, with what became
 * of each listing, when it marked the sale on warframe.market; else the trade's own items.
 * One item: the title says it all. Several: the title has the count and the total, and the body
 * one line each. What became of the listings is the last line, or beside each item when they differ.
 */
export function saleNotice(t: Trade, lines: SoldLine[] | null = null): { title: string; body: string } {
  const items: SoldLine[] = lines?.length ? lines : t.offered;
  const plat = `${t.platinum_received} platinum`;
  const copies = items.reduce((n, x) => n + x.count, 0);
  const title = items.length === 1 ? `You sold ${soldName(items[0])} to ${t.partner} for ${plat}` : `You sold ${copies} items to ${t.partner} for ${plat}`;
  const outcomes = [...new Set(items.map((x) => x.outcome))];
  const one = outcomes.length === 1 ? outcomes[0] : undefined;
  const body: string[] = [];
  if (items.length > 1) for (const x of items) body.push(`${soldName(x)}${!one && x.outcome ? ` (${OUTCOME_WORD[x.outcome]})` : ""}`);
  if (one) body.push(outcomeLine(one, items.length > 1));
  return { title, body: body.join("\n") };
}

/**
 * Which of the game log's trades to tell now, and the keys to remember as looked at. A trade is
 * looked at once (its key goes in `seen`, kept across restarts), told only when it's a sale and
 * recent (see recentTrade).
 */
export function salesToTell<T extends Trade>(trades: T[], key: (t: T) => string, seen: Iterable<string>, now: number, firstRead: boolean): { tell: T[]; fresh: string[] } {
  const had = new Set(seen);
  const fresh = trades.filter((t) => !had.has(key(t)));
  return { tell: fresh.filter((t) => isSale(t) && recentTrade(t, now, firstRead)), fresh: fresh.map(key) };
}

/** How long a notification's +rep button stays: the same day's reach as automatic +rep. */
export const REP_OFFER_WINDOW = 24 * 60 * 60_000;

/**
 * Whether a sale's notification offers +rep for its buyer: you give +rep by hand (automatic +rep
 * off), you're signed in, the buyer is on warframe.market, and neither this trade has been given
 * or let go (Not now) nor the player given +rep on another trade (warframe.market takes one per player).
 */
export function repOffered(o: { key: string; partner: string; at: number; now: number; autoRep: boolean; linked: boolean; onMarket: boolean; rep: Record<string, "given" | "skipped">; trades: { key: string; partner: string }[] }): boolean {
  if (o.autoRep || !o.linked || !o.onMarket || o.rep[o.key] || o.now - o.at > REP_OFFER_WINDOW) return false;
  const who = o.partner.toLowerCase();
  return !o.trades.some((x) => x.partner.toLowerCase() === who && o.rep[x.key] === "given");
}
