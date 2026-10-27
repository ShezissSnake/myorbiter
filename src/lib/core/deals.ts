// Cheap buys: someone in game lists a prime part you're missing, or an arcane you're collecting,
// well under its usual price. The watchlist is short on purpose: every item is one order-book
// request to warframe.market.
import { setGaps } from "./advice";
import { competitor, findItem, referencePrice, type BookOrder, type BookUser, type MarketIndex, type MarketItem, type Me } from "./market";
import type { Model } from "./model";
import { arcaneRows } from "./views";

export interface Watch {
  name: string;
  kind: "part" | "arcane";
  rank: number | null;
  /** Why it's on the list. */
  why: string;
}

/** A listing at most this share of the daily median counts as a deal. */
export const DEAL_SHARE = 0.6;
/** Below this daily median, a bargain isn't worth a whisper. */
export const DEAL_MIN_REF = 6;

/**
 * Missing parts of sets one or two parts from complete, and unranked copies of arcanes you're
 * collecting that you gave a tier (S or A first): the most valuable first, at most `limit`.
 */
export function watchlist(m: Model, tiers: Record<string, string>, limit = 20): Watch[] {
  const out: Watch[] = [];
  for (const g of setGaps(m, 2)) {
    for (const x of g.missing) out.push({ name: x.name, kind: "part", rank: null, why: `${g.missingCount === 1 ? "the last part" : "a missing part"} of ${g.set}` });
  }
  const order = ["S", "A", "B"];
  for (const a of arcaneRows(m)) {
    const t = tiers[a.name];
    if (a.complete || !t || !order.includes(t)) continue;
    out.push({ name: a.name, kind: "arcane", rank: 0, why: `tier ${t}, ${a.copies}/${a.needed} copies` });
  }
  const value = (w: Watch) => (w.kind === "arcane" ? (m.price(w.name) ?? 0) * 3 + (order.length - order.indexOf(tiers[w.name] ?? "B")) * 10 : (m.price(w.name) ?? 0));
  return out.sort((a, b) => value(b) - value(a)).slice(0, limit);
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
    const usual = referencePrice(m, it, rank, it.subtypes?.[0] ?? null);
    if (usual == null || usual < DEAL_MIN_REF) continue;
    const c = competitor({ rank, subtype: null }, book, me, it.subtypes?.[0] ?? null);
    if (c.price == null || !c.cheapest || c.price > usual * DEAL_SHARE) continue;
    out.push({
      key: `${it.slug}|${c.price}|${c.cheapest.name}`,
      name: it.name,
      slug: it.slug,
      rank,
      price: c.price,
      usual: Math.round(usual),
      seller: c.cheapest.name ?? "?",
      why: w.why,
      whisper: `/w ${c.cheapest.name} Hi! I want to buy: "${it.name}${rank != null ? ` (rank ${rank})` : ""}" for ${c.price} platinum. (warframe.market)`,
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
  const rank = it.maxRank != null ? (w.rank ?? 0) : null;
  if (rank != null && (o.rank ?? 0) !== rank) return null;
  const sub = it.subtypes?.[0] ?? null;
  if (sub && o.subtype && o.subtype !== sub) return null;
  const usual = referencePrice(m, it, rank, sub);
  if (usual == null || usual < DEAL_MIN_REF || o.platinum > usual * DEAL_SHARE) return null;
  return {
    key: `${it.slug}|${o.platinum}|${seller}`,
    name: it.name,
    slug: it.slug,
    rank,
    price: o.platinum,
    usual: Math.round(usual),
    seller,
    why: w.why,
    whisper: `/w ${seller} Hi! I want to buy: "${it.name}${rank != null ? ` (rank ${rank})` : ""}" for ${o.platinum} platinum. (warframe.market)`,
  };
}
