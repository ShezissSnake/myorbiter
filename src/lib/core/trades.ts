// Trades read from EE.log, turned into sales: you gave items and got only platinum back. Each item
// is matched to your warframe.market listing for it, so MyOrbiter can mark that listing sold.
import { findItem, type MarketIndex, type MarketItem, type MyOrder } from "./market";
import { gearSetParts, type Model } from "./model";
import { imprintSale, type ImprintNaming, type ImprintRaw } from "./imprints";
import type { Trade, TradeItem } from "./types";
import type { Sale, TradeLogEntry } from "../backend";
import { recentTrade } from "./saleNotice";

/** What makes a trade unique: the game session's start and the trade's time in it. */
export const tradeKey = (sessionStart: number | null | undefined, t: Trade) => `${sessionStart ?? "?"}|${t.uptime}`;

export interface TradeSale {
  /** The name as the game logged it. */
  name: string;
  rank: number | null;
  count: number;
  /** Platinum for each copy, from what you received. */
  platinumEach: number;
  /** Your listing it sold from, if you had one. */
  order: MyOrder | null;
}

/** The market's imprints and the inventory's imprint rows, for `imprintSaleName`. */
export function imprintNaming(index: MarketIndex, rows: ImprintRaw[] | null): ImprintNaming {
  const imprints = [...index.byId.values()].filter((it) => it.tags?.includes("imprint"));
  const byBreed = new Map(imprints.filter((it) => it.gameRef).map((it) => [it.gameRef!, it.name]));
  return { rows, itemFor: (breed) => byBreed.get(breed) ?? null, names: imprints.map((it) => it.name) };
}

/**
 * The sales in a trade, or null when it wasn't one (you paid platinum, swapped items, or got
 * nothing). Platinum is shared out by your listing prices when every item was listed, else evenly.
 */
export function salesFromTrade(t: Trade, orders: MyOrder[], index: MarketIndex, m: Model | null = null, imprints: ImprintRaw[] | null = null): TradeSale[] | null {
  if (t.platinum_received <= 0 || t.received.length > 0 || !t.offered.length || t.platinum_offered > 0) return null;
  const listed = (name: string) => {
    const it = findItem(index, name, null);
    return !!it && orders.some((o) => o.itemId === it.id && o.type === "sell");
  };
  const folded = foldSets(t.offered, m, listed, index);
  const sales: TradeSale[] = folded.map((x) => {
    const split = splitRefinement(x.name);
    // An imprint is logged by its pet's name ("Imprint of Biscuit"): by its breed, it's a market item.
    // Its listing is closed only when the inventory said the breed, not a breed read from the name.
    const imprint = /^\s*imprint of\s/i.test(split.name) ? imprintSale(split.name, imprintNaming(index, imprints)) : null;
    const name = imprint?.item ?? split.name;
    const { subtype } = split;
    const it = findItem(index, name, null);
    // What one copy went for is known only when the trade was this item alone: it picks between
    // several listings of it at different prices (listingFor).
    const paidEach = folded.length === 1 ? t.platinum_received / x.count : null;
    const order = it && (!imprint || imprint.by === "inventory") ? listingFor(it, x.rank, subtype, orders, paidEach) : null;
    return { name: it?.name ?? x.name, rank: x.rank, count: x.count, platinumEach: 0, order };
  });
  const weights = sales.every((s) => s.order) ? sales.map((s) => s.order!.platinum * s.count) : sales.map((s) => s.count);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  sales.forEach((s, i) => (s.platinumEach = Math.round((t.platinum_received * weights[i]) / total / s.count)));
  // Paid far from the listings' prices (under half, over double): likely another copy than the
  // one listed (an unranked mod for your maxed listing), so the listings are left alone. Only
  // when every item was listed: otherwise the platinum was shared out evenly, not by price.
  if (sales.every((s) => s.order)) {
    const asked = sales.reduce((n, s) => n + s.order!.platinum * s.count, 0);
    if (t.platinum_received * 2 < asked || t.platinum_received > asked * 2) for (const s of sales) s.order = null;
  }
  return sales;
}

const REFINEMENT = /\s*[[(]?\b(Intact|Exceptional|Flawless|Radiant)\b[\])]?/i;

/** A relic's refinement, when the trade names it ("Axi A1 Relic [Radiant]"), and the name without it. */
export function splitRefinement(name: string): { name: string; subtype: string | null } {
  const hit = REFINEMENT.exec(name);
  if (!hit) return { name, subtype: null };
  const rest = name.replace(REFINEMENT, "").trim();
  // Only a relic's: "Radiant Zodian" is a gem, not a radiant Zodian.
  if (!/\bRelic\b/i.test(rest) && !/^(Lith|Meso|Neo|Axi|Requiem)\s/i.test(rest)) return { name, subtype: null };
  return { name: rest, subtype: hit[1].toLowerCase() };
}

/**
 * Your listing a traded item sold from. Only a sure match: closing the wrong listing (a maxed
 * arcane for an unranked one, a radiant relic for an intact one) costs more than missing one.
 *
 * Several listings of the same item, rank and variant (warframe.market allows three at different
 * prices): the one whose price is exactly what a copy went for (`paidEach`, known only when the
 * trade was this item alone). Paid a price none of them asks, or not known: none, and the
 * listings stay as they are. Several at one price are the same offer: the first is closed.
 */
export function listingFor(it: MarketItem, rank: number | null, subtype: string | null, orders: MyOrder[], paidEach: number | null = null): MyOrder | null {
  let mine = orders.filter((o) => o.itemId === it.id && o.type === "sell");
  if (it.maxRank != null) {
    // The log shows an arcane's rank as pips: an unranked one has none, so no rank means rank 0.
    const r = rank ?? (it.tags?.includes("arcane_enhancement") ? 0 : null);
    // Another ranked item with no rank logged: only when there's one listing it could be.
    mine = r == null ? (mine.length === 1 ? mine : []) : mine.filter((o) => (o.rank ?? 0) === r);
  }
  if (it.tags?.includes("relic")) {
    const of = (o: MyOrder) => o.subtype ?? "intact";
    // Refinement not logged: only when you list just one refinement of it.
    mine = subtype ? mine.filter((o) => of(o) === subtype) : new Set(mine.map(of)).size === 1 ? mine : [];
  } else if (it.subtypes?.length) {
    // Other variants (regular or atragraph, a fish's size): the log doesn't say which was traded,
    // so only the first variant, the one a plain name stands for.
    const def = it.subtypes[0];
    mine = mine.filter((o) => (o.subtype ?? def) === def);
  }
  if (new Set(mine.map((o) => o.platinum)).size > 1) mine = paidEach == null ? [] : mine.filter((o) => o.platinum === paidEach);
  return mine[0] ?? null;
}

/**
 * Which trades of a read of the game log to act on (mark sold, log the sale): `fresh`, the keys of
 * the ones not seen before, to remember whether or not they're acted on; `recent`, those of them
 * from the last half hour (recentTrade). A trade already seen (the same game session and time,
 * read again after a restart) is never acted on twice.
 */
export function tradesToMark(trades: Trade[], session: number | null, seen: Iterable<string>, now: number, firstRead: boolean): { fresh: string[]; recent: Trade[] } {
  const had = new Set(seen);
  const fresh = trades.filter((t) => !had.has(tradeKey(session, t)));
  return { fresh: fresh.map((t) => tradeKey(session, t)), recent: fresh.filter((t) => recentTrade(t, now, firstRead)) };
}

/**
 * Whether the sales log already has this trade's sale of `item` (by the trade's identity, not
 * its partner or time): a trade handled again is logged once. Two trades of the same item with
 * the same partner are two keys, and two sales.
 */
export const tradeSaleLogged = (sales: Sale[], key: string, item: string) => sales.some((s) => s.trade === key && s.item === item);

/**
 * Every part of a prime set handed over in one trade is a set sale ("Styanax Prime Set"), when you
 * list the set or none of its parts on their own: the game lists the parts one by one.
 */
export function foldSets(offered: TradeItem[], m: Model | null, listed: (name: string) => boolean, index: MarketIndex | null = null): TradeItem[] {
  if (!m) return offered;
  const left = new Map<string, number>();
  for (const x of offered) if (x.rank == null) left.set(x.name, (left.get(x.name) ?? 0) + x.count);
  const sets: TradeItem[] = [];
  // Every set a part here could finish: its name and its parts, by the names the trade shows.
  const candidates: { name: string; parts: { name: string; required: number }[] }[] = [];
  const parents = new Set(offered.flatMap((x) => (x.rank == null ? (m.partByName.get(x.name) ?? []).map((p) => p.parentUnique) : [])));
  for (const parent of parents) {
    const parts = m.partsByParent.get(parent);
    if (parts?.length) candidates.push({ name: `${parts[0].parentName} Set`, parts: parts.map((p) => ({ name: p.fullName, required: p.required })) });
  }
  // Sets that aren't prime (Mandonel, Lato Vandal…): the trade names their parts as
  // warframe.market does, so each recipe part is found by its path there.
  if (index) for (const g of gearSetsOf(m, index)) if (g.parts.some((p) => left.has(p.name))) candidates.push(g);
  for (const c of candidates) {
    const n = Math.min(...c.parts.map((p) => Math.floor((left.get(p.name) ?? 0) / p.required)));
    if (n < 1) continue;
    if (!listed(c.name) && c.parts.some((p) => listed(p.name))) continue;
    for (const p of c.parts) left.set(p.name, (left.get(p.name) ?? 0) - n * p.required);
    sets.push({ name: c.name, rank: null, count: n });
  }
  if (!sets.length) return offered;
  const rest: TradeItem[] = [];
  for (const x of offered) {
    if (x.rank != null) {
      rest.push(x);
      continue;
    }
    const n = left.get(x.name) ?? 0;
    if (n > 0) rest.push({ ...x, count: Math.min(n, x.count) });
    left.set(x.name, n - Math.min(n, x.count));
  }
  return [...sets, ...rest];
}

/** warframe.market's sets that aren't prime, with their parts by its names (cached per model and item list). */
const gearCache = new WeakMap<Model, WeakMap<MarketIndex, { name: string; parts: { name: string; required: number }[] }[]>>();
function gearSetsOf(m: Model, index: MarketIndex) {
  let byIndex = gearCache.get(m);
  if (!byIndex) gearCache.set(m, (byIndex = new WeakMap()));
  const hit = byIndex.get(index);
  if (hit) return hit;
  const out: { name: string; parts: { name: string; required: number }[] }[] = [];
  for (const it of index.byId.values()) {
    if (!it.gameRef || !it.tags?.includes("set") || it.tags.includes("prime")) continue;
    const parts = gearSetParts(m, it.gameRef);
    if (!parts) continue;
    const named = parts.map((p) => ({ name: findItem(index, p.name, p.unique)?.name ?? p.name, required: p.required }));
    out.push({ name: it.name, parts: named });
  }
  byIndex.set(index, out);
  return out;
}

/**
 * Sales logged before MyOrbiter knew a trade could be a whole set: every part of a set, sold in one
 * trade and logged as one sale each, becomes one "X Prime Set" sale at the platinum they made
 * together. Null when there's nothing to fold.
 */
export function foldSetSales(sales: Sale[], trades: TradeLogEntry[], m: Model): Sale[] | null {
  let out: Sale[] | null = null;
  for (const t of trades) {
    if (t.platIn <= 0 || t.received.length || !t.offered.length) continue;
    const sets = foldSets(t.offered, m, () => false).filter((x) => / Set$/.test(x.name) && !t.offered.some((o) => o.name === x.name));
    for (const set of sets) {
      const parent = m.primeParents.find((p) => `${p.name} Set` === set.name);
      const parts = parent ? (m.partsByParent.get(parent.uniqueName) ?? []) : [];
      if (!parts.length) continue;
      const list: Sale[] = out ?? sales;
      // This trade's part sales: logged by the trade itself, at its time.
      const near = (x: Sale) => x.rank == null && Math.abs(x.at - t.at) < 60_000 && (x.trade == null || x.trade === t.key);
      const mine = parts.map((p) => list.find((x) => near(x) && x.item === p.fullName && x.quantity === p.required * set.count));
      if (mine.some((x) => !x) || list.some((x) => near(x) && x.item === set.name)) continue;
      const platinum = Math.round(mine.reduce((n, x) => n + x!.platinum * x!.quantity, 0) / set.count);
      const folded: Sale = { at: t.at, item: set.name, rank: null, quantity: set.count, platinum, ...(mine[0]!.trade ? { trade: mine[0]!.trade } : {}) };
      const drop = new Set(mine);
      const at = list.indexOf(mine[0]!);
      out = list.filter((x) => !drop.has(x));
      out.splice(Math.min(at, out.length), 0, folded);
    }
  }
  return out;
}

/** How far back automatic +rep reaches: the game log only holds this game session's trades anyway. */
export const AUTO_REP_WINDOW = 24 * 60 * 60_000;

/**
 * The trades whose partner should get +rep automatically, oldest first, one per partner: trades
 * of the last day not yet given or skipped, with a partner not already given +rep for an earlier
 * trade (warframe.market takes one review per player).
 */
export function repCandidates(trades: TradeLogEntry[], rep: Record<string, "given" | "skipped">, now: number): TradeLogEntry[] {
  const given = new Set(trades.filter((t) => rep[t.key] === "given").map((t) => t.partner.toLowerCase()));
  const out: TradeLogEntry[] = [];
  const picked = new Set<string>();
  for (const t of [...trades].sort((a, b) => a.at - b.at)) {
    const who = t.partner.toLowerCase();
    if (rep[t.key] || given.has(who) || picked.has(who) || now - t.at > AUTO_REP_WINDOW) continue;
    picked.add(who);
    out.push(t);
  }
  return out;
}
