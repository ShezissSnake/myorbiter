// Trades read from EE.log, turned into sales: you gave items and got only platinum back. Each item
// is matched to your warframe.market listing for it, so MyOrbiter can mark that listing sold.
import { findItem, type MarketIndex, type MarketItem, type MyOrder } from "./market";
import { gearSetParts, type Model } from "./model";
import { imprintSale, type ImprintNaming, type ImprintRaw } from "./imprints";
import type { Trade, TradeItem } from "./types";
import type { Sale, TradeLogEntry } from "../backend";
import { recentTrade } from "./saleNotice";
import { handLoggedSale } from "./upkeep";
import { sameSaleItem } from "./sameSale";

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
 * The sales this trade logged before (by the trade's identity, not its partner or time), to take
 * from as the trade's lines are handled again: a trade handled twice is logged once. Read once,
 * before any line is logged, so two lines of one trade (two refinements of a relic, a mod at two
 * ranks) are two sales; two trades of the same item with the same partner are two keys.
 */
export const loggedForTrade = (sales: Sale[], key: string): Sale[] => sales.filter((s) => s.trade === key);

/**
 * Takes this line's copies from `logged` (loggedForTrade): how many of them this trade logged
 * before. The trade's logged copies of one item and rank are one count, shared by its lines of
 * that item and rank whichever line logged them (a line may be split between hand-logged sales
 * and the rest, placeTradeLine; an older record may hold a hand-logged sale claimed whole, more
 * copies than its line): each line takes up to its own count from what is left, so when the
 * copies the trade logged cover all its lines, nothing is left to log or mark for any, in
 * whatever order they come. Only the copies are taken: `logged` holds copies of the sales, never
 * the saved ones changed.
 */
export function takeLogged(logged: Sale[], line: { name: string; rank: number | null; count: number }): number {
  let copies = 0;
  for (let i = 0; i < logged.length && copies < line.count; ) {
    const s = logged[i];
    if (!sameSaleItem(s, line)) {
      i++;
      continue;
    }
    const n = Math.min(s.quantity, line.count - copies);
    copies += n;
    if (n === s.quantity) logged.splice(i, 1);
    else logged[i++] = { ...s, quantity: s.quantity - n };
  }
  return copies;
}

/**
 * One line of a sale trade, put in the sales log before its listing is marked sold. Copies this
 * trade logged before (it's handled again) and copies you logged by hand around then
 * (handLoggedSale: the same item and rank) are not logged again; each hand-logged sale it
 * counts is claimed with the trade's key, as many as the line's copies take. A hand-logged sale
 * of more copies than are left is split: those copies take the key, the rest stay a sale of
 * their own. Returns the log as it now is
 * and `left`, the copies still to log and mark sold.
 */
export function placeTradeLine(sales: Sale[], logged: Sale[], line: { name: string; rank: number | null; count: number }, at: number, key: string): { sales: Sale[]; left: number } {
  let left = Math.max(0, line.count - takeLogged(logged, line));
  let out = sales;
  // Every hand-logged sale it takes, nearest first, until the line's copies are counted: two
  // Sold clicks of one each and a trade of 2 are one sale.
  for (let hand = left ? handLoggedSale(out, { ...line, count: left }, at) : null; hand; hand = left ? handLoggedSale(out, { ...line, count: left }, at) : null) {
    const h = out[hand.index];
    out = [...out];
    if (h.quantity > left) {
      // The closed order's id stays with the claimed part, so an import doesn't add it again.
      const rest: Sale = { ...h, quantity: h.quantity - left };
      delete rest.wfm;
      out.splice(hand.index, 1, { ...h, quantity: left, trade: key }, rest);
    } else out[hand.index] = { ...h, trade: key };
    left -= hand.copies;
  }
  return { sales: out, left };
}

/** The listing a trade's line is to lower, if it is still listed (one an earlier line or a Sold click closed is not). */
export const stillListed = (order: MyOrder | null, orders: MyOrder[]): MyOrder | null => (order && orders.some((o) => o.id === order.id) ? order : null);

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
 * together, under the trade's key. Null when there's nothing to fold.
 *
 * Only part sales without a trade's key: a trade logs its parts one by one only when they were
 * listed one by one (foldSets), so those sold as parts and closed part listings on
 * warframe.market. The closed orders' ids the parts had (an import made first) go with the set
 * sale (`wfmParts`), so importing again doesn't add the parts back.
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
      // This trade's part sales, at its time, logged before sales carried their trade's key.
      const near = (x: Sale) => x.rank == null && Math.abs(x.at - t.at) < 60_000 && x.trade == null;
      const mine = parts.map((p) => list.find((x) => near(x) && x.item === p.fullName && x.quantity === p.required * set.count));
      const setSale = (x: Sale) => x.item === set.name && (x.trade === t.key || (x.trade == null && Math.abs(x.at - t.at) < 60_000));
      if (mine.some((x) => !x) || list.some(setSale)) continue;
      const platinum = Math.round(mine.reduce((n, x) => n + x!.platinum * x!.quantity, 0) / set.count);
      const ids = mine.flatMap((x) => [...(x!.wfm ? [x!.wfm] : []), ...(x!.wfmParts ?? [])]);
      const folded: Sale = { at: t.at, item: set.name, rank: null, quantity: set.count, platinum, trade: t.key, ...(ids.length ? { wfmParts: ids } : {}) };
      const drop = new Set(mine);
      const at = list.indexOf(mine[0]!);
      out = list.filter((x) => !drop.has(x));
      out.splice(Math.min(at, out.length), 0, folded);
    }
  }
  return out;
}

/** A prime set's parts by name and how many of each it takes ("Nekros Prime Set"), or null: for importClosed. */
export function setPartsOf(m: Model): (set: string) => { name: string; required: number }[] | null {
  return (set) => {
    const parent = m.primeParents.find((p) => `${p.name} Set` === set);
    const parts = parent ? m.partsByParent.get(parent.uniqueName) : null;
    return parts?.length ? parts.map((p) => ({ name: p.fullName, required: p.required })) : null;
  };
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
