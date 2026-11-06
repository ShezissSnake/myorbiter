// Cheap buys: someone in game lists a prime part you're missing, or an arcane you're collecting,
// well under its usual price. The watchlist is short on purpose: every item is one order-book
// request to warframe.market.
import { setGaps } from "./advice";
import { canTrade, competitor, findItem, referencePrice, type BookOrder, type BookUser, type MarketIndex, type MarketItem, type Me } from "./market";
import type { Model } from "./model";
import { arcaneRows } from "./views";

export interface Watch {
  name: string;
  kind: "part" | "arcane" | "alert";
  rank: number | null;
  /** Why it's on the list. */
  why: string;
  /** A price alert you set: any listing at or under this is news, whatever its usual price. */
  maxPrice?: number;
  /** The refinement or variant it's for ("radiant"), when the item has them. */
  subtype?: string | null;
}

/** A price alert: tell me when someone lists this at or under my price (set from Post a buy order). */
export interface BuyAlert {
  name: string;
  rank: number | null;
  /** The refinement or variant ("radiant", "blueprint"), when the item has them; the first one otherwise. */
  subtype?: string | null;
  maxPrice: number;
  /** When it was set (Unix ms). */
  at: number;
}

/** Your price alerts as watchlist entries: they go first, and don't count against the list's limit. */
export const alertWatches = (alerts: BuyAlert[]): Watch[] => alerts.map((a) => ({ name: a.name, kind: "alert", rank: a.rank, subtype: a.subtype ?? null, why: `your alert: ${a.maxPrice}p or less${a.subtype ? ` (${a.subtype})` : ""}`, maxPrice: a.maxPrice }));

/** A deal: at or under your alert's price, or at most DEAL_SHARE of the usual price. */
function isDeal(price: number, usual: number | null, w: Watch): boolean {
  if (w.maxPrice != null) return price <= w.maxPrice;
  return usual != null && price <= usual * DEAL_SHARE;
}

/** A listing at most this share of the daily median counts as a deal. */
export const DEAL_SHARE = 0.6;
/** Below this daily median, a bargain isn't worth a whisper. */
export const DEAL_MIN_REF = 6;

/**
 * Missing parts of sets one or two parts from complete, and unranked copies of arcanes you've
 * started collecting but not finished: the most valuable first, at most `limit`.
 */
export function watchlist(m: Model, limit = 20, alerts: BuyAlert[] = []): Watch[] {
  const mine = alertWatches(alerts);
  const taken = new Set(mine.map((w) => w.name));
  const out: Watch[] = [];
  for (const g of setGaps(m, 2)) {
    for (const x of g.missing) out.push({ name: x.name, kind: "part", rank: null, why: `${g.missingCount === 1 ? "the last part" : "a missing part"} of ${g.set}` });
  }
  for (const a of arcaneRows(m)) {
    if (a.complete || a.copies === 0 || !a.tradable) continue;
    out.push({ name: a.name, kind: "arcane", rank: 0, why: `${a.copies}/${a.needed} copies` });
  }
  // An arcane's copy is worth its price times the copies still needed, up to buying it maxed.
  const value = (w: Watch) => (m.price(w.name) ?? 0);
  return [...mine, ...out.filter((w) => !taken.has(w.name)).sort((a, b) => value(b) - value(a)).slice(0, limit)];
}

export interface Deal {
  key: string;
  name: string;
  slug: string;
  rank: number | null;
  price: number;
  usual: number;
  seller: string;
  why: string;
  /** What warframe.market's "Buy" copies: paste it in game chat. */
  whisper: string;
}

export function findDeals(m: Model, index: MarketIndex, books: Record<string, BookOrder[] | undefined>, watch: Watch[], me: Me): Deal[] {
  const out: Deal[] = [];
  for (const w of watch) {
    const it: MarketItem | null = findItem(index, w.name, null);
    if (!it) continue;
    const book = books[it.slug];
    if (!book) continue;
    const rank = it.maxRank != null ? (w.rank ?? 0) : null;
    const sub = w.subtype ?? it.subtypes?.[0] ?? null;
    const usual = referencePrice(m, it, rank, sub);
    if (w.maxPrice == null && (usual == null || usual < DEAL_MIN_REF)) continue;
    const c = competitor({ rank, subtype: sub }, book, me, it.subtypes?.[0] ?? null);
    // The cheapest, odd or not: one seller far under the rest is exactly the deal.
    const low = c.lowest;
    if (!low || !isDeal(low.platinum, usual, w)) continue;
    out.push({
      key: `${it.slug}|${low.platinum}|${low.name}`,
      name: it.name,
      slug: it.slug,
      rank,
      price: low.platinum,
      usual: Math.round(usual ?? w.maxPrice ?? low.platinum),
      seller: low.name ?? "?",
      why: w.why,
      whisper: `/w ${low.name} Hi! I want to buy: "${it.name}${rank != null ? ` (rank ${rank})` : ""}${w.subtype ? ` (${w.subtype})` : ""}" for ${low.platinum} platinum. (warframe.market)`,
    });
  }
  return out.sort((a, b) => b.usual - b.price - (a.usual - a.price));
}

/** An order from warframe.market's live feed of new orders (feed.rs passes on sell orders from players who are on). */
export interface FeedOrder {
  id: string;
  type: string;
  platinum: number;
  quantity?: number;
  rank?: number | null;
  subtype?: string | null;
  itemId: string;
  user: Partial<BookUser> & { ingameName?: string; id?: string };
}

/**
 * A new listing that's a deal on something you're after: the moment it goes up, from the live
 * feed, by the same rule as the order-book scan (at most DEAL_SHARE of the daily median). `watch`
 * by market slug.
 */
export function dealFromOrder(m: Model, index: MarketIndex, o: FeedOrder, watch: Map<string, Watch>, me: Me | null): Deal | null {
  if (o.type !== "sell") return null;
  const it = index.byId.get(o.itemId);
  if (!it) return null;
  const w = watch.get(it.slug);
  if (!w) return null;
  const seller = o.user.ingameName ?? "";
  if (!seller || (me && (o.user.id === me.id || seller === me.ingameName))) return null;
  // Only a seller you can trade with, as the order-book scan counts them (platform and crossplay).
  if (me && !canTrade(me, { platform: o.user.platform, crossplay: o.user.crossplay } as BookUser)) return null;
  const rank = it.maxRank != null ? (w.rank ?? 0) : null;
  if (rank != null && (o.rank ?? 0) !== rank) return null;
  const sub = w.subtype ?? it.subtypes?.[0] ?? null;
  if (sub && (o.subtype ?? it.subtypes?.[0] ?? null) !== sub) return null;
  const usual = referencePrice(m, it, rank, sub);
  if (w.maxPrice == null && (usual == null || usual < DEAL_MIN_REF)) return null;
  if (!isDeal(o.platinum, usual, w)) return null;
  return {
    key: `${it.slug}|${o.platinum}|${seller}`,
    name: it.name,
    slug: it.slug,
    rank,
    price: o.platinum,
    usual: Math.round(usual ?? w.maxPrice ?? o.platinum),
    seller,
    why: w.why,
    whisper: `/w ${seller} Hi! I want to buy: "${it.name}${rank != null ? ` (rank ${rank})` : ""}${w.subtype ? ` (${w.subtype})` : ""}" for ${o.platinum} platinum. (warframe.market)`,
  };
}
