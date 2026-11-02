// warframe.market listings: matching items, and the repricing rule.
//
// The rule: a sell order follows the cheapest visible sell order from a player who is in game
// right now, for the same rank and subtype, on a platform that can trade with you, not counting
// your own. It never drops below a floor: the one you set for that order, or a share of the
// item's daily market price, whichever is higher.

import type { Model } from "./model";
import { baseId, gearSetParts, heldCount } from "./model";
import type { Sale, TradeLogEntry } from "../backend";

export interface MarketItem {
  id: string;
  slug: string;
  gameRef: string | null;
  name: string;
  maxRank: number | null;
  subtypes: string[] | null;
  tags: string[] | null;
  /** warframe.market's thumbnail, as orbiter's image cache names it ("wfm." and its file name). */
  thumb?: string | null;
}

export interface MyOrder {
  id: string;
  itemId: string;
  type: string;
  platinum: number;
  quantity: number;
  rank: number | null;
  subtype: string | null;
  visible: boolean;
  updatedAt: string | null;
  /** An Ayatan sculpture's stars put in (absent on anything else). */
  amberStars?: number | null;
  cyanStars?: number | null;
}

export interface BookUser {
  id: string;
  ingameName: string | null;
  status: string | null; // ingame | online | offline
  platform: string | null;
  crossplay: boolean | null;
}

export interface BookOrder {
  id: string;
  type: string;
  platinum: number;
  quantity: number;
  rank: number | null;
  subtype: string | null;
  visible: boolean;
  amberStars?: number | null;
  cyanStars?: number | null;
  user: BookUser;
}

export interface Me {
  id: string;
  ingameName?: string | null;
  platform?: string | null;
  crossplay?: boolean | null;
  status?: string | null;
}

export interface Competitor {
  /** The price to match: the cheapest in game, unless it's one seller far under everyone else (see `lowest`). */
  price: number | null;
  /** In-game sellers at any price, for the same listing. */
  sellers: number;
  cheapest: { name: string | null; platinum: number } | null;
  /**
   * The cheapest in game, odd or not: a deal to buy. When it's under a third of the next one (and
   * 5p or more under it), one forgotten or mistyped listing, `price` and `cheapest` skip it, so
   * your listings don't follow it down.
   */
  lowest: { name: string | null; platinum: number } | null;
  /** The next few in-game prices, cheapest first, to show what the order is matching. */
  ladder: number[];
  /**
   * What sellers on the site ask, in game or not: the middle ask (with only one or two, the
   * dearer), so a few odd listings at either end don't set it. Buyers see the offline ones too,
   * and most relic sellers are offline (dozens ask 2–3p while the few in game ask 30p). Null when
   * nobody but you sells it.
   */
  askLevel: number | null;
}

const sameRank = (a: number | null | undefined, b: number | null | undefined) => (a ?? null) === (b ?? null);
type Stars = { amberStars?: number | null; cyanStars?: number | null };
/** Ayatan sculptures: a full one and an empty one are different listings. */
const sameStars = (a: Stars, b: Stars) => (a.amberStars ?? 0) === (b.amberStars ?? 0) && (a.cyanStars ?? 0) === (b.cyanStars ?? 0);
export const hasStars = (o: Stars) => (o.amberStars ?? 0) + (o.cyanStars ?? 0) > 0;

/**
 * Can this seller trade with me? Same platform, or both have cross-play on. Not platinum between
 * Switch and the other platforms: the game doesn't allow it, and a sale is items for platinum.
 */
export function canTrade(me: Me, user: BookUser): boolean {
  if (!me.platform || !user.platform) return true;
  if (user.platform === me.platform) return true;
  if (user.platform === "switch" || me.platform === "switch") return false;
  return user.crossplay === true && me.crossplay === true;
}

/** `defaultSubtype`: on items with variants (Serration: regular/atragraph, relics: intact…radiant)
 * an order without a subtype counts as the first variant. */
export function competitor(order: Pick<MyOrder, "rank" | "subtype"> & Stars, book: BookOrder[], me: Me, defaultSubtype: string | null = null): Competitor {
  const mine = order.subtype ?? defaultSubtype;
  const rivals = book
    .filter(
      (o) =>
        o.type === "sell" &&
        o.visible &&
        o.user.status === "ingame" &&
        o.user.id !== me.id &&
        sameRank(o.rank, order.rank) &&
        sameStars(o, order) &&
        (o.subtype ?? defaultSubtype) === mine &&
        canTrade(me, o.user),
    )
    .sort((a, b) => a.platinum - b.platinum);
  // One seller far under the next: a forgotten or mistyped listing, not the market.
  const odd = rivals.length >= 2 && rivals[0].platinum * 3 < rivals[1].platinum && rivals[1].platinum - rivals[0].platinum >= 5;
  const best = rivals[odd ? 1 : 0];
  const asks = book
    .filter((o) => o.type === "sell" && o.visible && o.user.id !== me.id && sameRank(o.rank, order.rank) && sameStars(o, order) && (o.subtype ?? defaultSubtype) === mine && canTrade(me, o.user))
    .map((o) => o.platinum)
    .sort((a, b) => a - b);
  return {
    price: best?.platinum ?? null,
    sellers: rivals.length,
    cheapest: best ? { name: best.user.ingameName, platinum: best.platinum } : null,
    lowest: rivals[0] ? { name: rivals[0].user.ingameName, platinum: rivals[0].platinum } : null,
    ladder: rivals.slice(odd ? 1 : 0, (odd ? 1 : 0) + 5).map((o) => o.platinum),
    askLevel: asks.length ? asks[asks.length < 3 ? asks.length - 1 : asks.length >> 1] : null,
  };
}

/**
 * What something is realistically worth now: what it sold for lately, but no more than what
 * sellers on the site ask (a few big sales can lift the recent price far above where the
 * market is: Axi Y2 sold at 100p twice while dozens ask 2p). Null when neither is known.
 */
export function marketValue(reference: number | null | undefined, comp: Pick<Competitor, "askLevel">): number | null {
  if (reference == null) return comp.askLevel;
  if (comp.askLevel == null) return reference;
  return Math.min(reference, comp.askLevel);
}

export interface Plan {
  target: number;
  change: boolean;
  /** "median": everyone in game asks far more than it sells for, so it's priced at what it sells for. */
  reason: "match" | "floor" | "no-sellers" | "already" | "median";
  competitor: Competitor;
  floor: number;
  /** What it's realistically worth, as the floor and the far-above check went by. */
  value: number | null;
}

export interface FloorRule {
  /** Your own minimum for this listing, if any. */
  floor: number | null;
  /** Never below this share of the item's daily market price (0–1). */
  minShare: number;
  /** The daily market price TennoScope downloaded, if known. */
  reference: number | null;
  /** The item's first variant, for orders that don't name one. */
  defaultSubtype?: string | null;
  /** Your minimum for anything you sell (Orders): never repriced below it. */
  min?: number;
  /**
   * Hold the reference to what sellers on the site ask (relics: a few lucky sales say little
   * about what one sells for now).
   */
  capByAsks?: boolean;
}

export function plan(order: MyOrder, book: BookOrder[], me: Me, rule: FloorRule): Plan {
  const comp = competitor(order, book, me, rule.defaultSubtype ?? null);
  const value = rule.capByAsks ? marketValue(rule.reference, comp) : (rule.reference ?? null);
  const floor = Math.max(1, rule.floor ?? 0, rule.min ?? 0, value != null ? Math.ceil(value * rule.minShare) : 0);
  // Nobody in game: the price stays, unless it's under the floor (you raised it since).
  if (comp.price == null) {
    if (order.platinum < floor) return { target: floor, change: true, reason: "floor", competitor: comp, floor, value };
    return { target: order.platinum, change: false, reason: "no-sellers", competitor: comp, floor, value };
  }
  let target = comp.price;
  let reason: Plan["reason"] = "match";
  const sells = overAsked(comp.price, value);
  if (sells != null) {
    target = sells;
    reason = "median";
  }
  if (target < floor) {
    target = floor;
    reason = "floor";
  }
  if (target === order.platinum) reason = reason === "floor" ? "floor" : "already";
  return { target, change: target !== order.platinum, reason, competitor: comp, floor, value };
}

/**
 * When everyone in game asks more than twice what something has sold for lately (a thin market:
 * a few sellers at 30p for a relic that goes for 4p), matching them means it never sells. Then
 * the price is what it sells for, rounded; null when matching the cheapest is fine.
 */
export const OVER_ASKED = 2;
export function overAsked(cheapest: number, reference: number | null | undefined): number | null {
  return reference != null && reference > 0 && cheapest > reference * OVER_ASKED ? Math.max(1, Math.round(reference)) : null;
}

/** Stable key for per-listing settings (floor, paused): item, rank and subtype. */
export const listingKey = (o: Pick<MyOrder, "itemId" | "rank" | "subtype">) => `${o.itemId}|${o.rank ?? ""}|${o.subtype ?? ""}`;

// ---------------------------------------------------------------- matching to your collection

export interface MarketIndex {
  byId: Map<string, MarketItem>;
  byGameRef: Map<string, MarketItem>;
  byName: Map<string, MarketItem>;
}

export function indexItems(items: MarketItem[]): MarketIndex {
  const byId = new Map<string, MarketItem>();
  const byGameRef = new Map<string, MarketItem>();
  const byName = new Map<string, MarketItem>();
  for (const it of items) {
    byId.set(it.id, it);
    if (it.gameRef) byGameRef.set(it.gameRef, it);
    if (it.name) byName.set(it.name.toLowerCase(), it);
  }
  return { byId, byGameRef, byName };
}

/** The market listing for something in your collection: by game path first, then by name. */
export function findItem(idx: MarketIndex, name: string, unique?: string | null): MarketItem | null {
  if (unique) {
    const hit = idx.byGameRef.get(baseId(unique));
    if (hit) return hit;
  }
  return idx.byName.get(name.toLowerCase()) ?? null;
}

/** TennoScope's daily price for a listing, by rank when the item has ranks, by refinement for relics. */
export function referencePrice(m: Model, item: MarketItem, rank: number | null, subtype: string | null = null): number | null {
  if (item.tags?.includes("relic")) {
    const base = item.name.replace(/ Relic$/, "");
    // By refinement: "radiant" → "Radiant"; none named is intact.
    return subtype ? m.relicPrice(base, subtype.charAt(0).toUpperCase() + subtype.slice(1)) : m.relicPrice(base);
  }
  // The daily prices are for an item's first variant: a regular Serration, not an atragraph one,
  // a small fish, a blueprint. Another variant has none.
  const def = item.subtypes?.[0] ?? null;
  if (subtype && def && subtype !== def) return null;
  // Ranked items: the daily prices are for unranked and maxed copies only. A copy in between (a
  // rank-9 Cutting Edge) has no reference, and a maxed one without a maxed price none either:
  // the unranked price would drag the listing down to a few platinum.
  if (item.maxRank != null && (rank ?? 0) > 0) return rank! >= item.maxRank ? m.priceMax(item.name) : null;
  return m.price(item.name);
}

const REFINEMENT_SUBTYPE: Record<string, string> = { Bronze: "intact", Silver: "exceptional", Gold: "flawless", Platinum: "radiant" };

/**
 * How many of what a listing sells you hold: same rank (for ranked items) and same variant.
 * Null when orbiter can't tell (an item TennoScope doesn't track, a set whose parts it doesn't
 * know): callers leave such a listing alone rather than treat it as "you hold none".
 */
export function heldFor(m: Model, item: MarketItem, o: { rank: number | null; subtype: string | null } & Stars): number | null {
  const def = item.subtypes?.[0] ?? null;
  // Your inventory tells relic refinements apart, not other variants (an atragraph Serration, a
  // large fish, a crafted item): for any but the first, what you hold is unknown, not none.
  if (!item.tags?.includes("relic") && (o.subtype ?? def) !== def) return null;
  // Nor which of your sculptures have stars in.
  if (hasStars(o)) return null;
  const held = holdings(m, item);
  if (!held) return null;
  return held
    .filter((h) => (item.maxRank == null || (h.rank ?? 0) === (o.rank ?? 0)) && (h.subtype ?? def) === (o.subtype ?? def))
    .reduce((n, h) => n + h.count, 0);
}

type Holding = { rank: number | null; subtype: string | null; count: number };

/** What you hold of a market item, by rank and variant; [] when you hold none; null when unknown. */
export function holdings(m: Model, item: MarketItem): Holding[] | null {
  // No inventory read at all (a console player, a Mac, TennoScope not set up yet): what you hold
  // is unknown, not none, so no listing is flagged or taken down for it.
  if (!m.observedAt && m.inventoryByBase.size === 0) return null;
  // Relics: the market lists one item per relic with refinements as subtypes; your inventory
  // has one entry per refinement (…Bronze … …Platinum).
  if (item.gameRef && item.tags?.includes("relic")) {
    const out: Holding[] = [];
    for (const [suffix, subtype] of Object.entries(REFINEMENT_SUBTYPE)) {
      const count = (m.inventoryByBase.get(item.gameRef + suffix) ?? []).reduce((n, r) => n + r.quantity, 0);
      if (count > 0) out.push({ rank: null, subtype, count });
    }
    return out;
  }
  // Imprints share the companion's path, but what you sell is the imprint, not your pet: count the
  // imprints TennoScope passed, and say unknown before it has passed any.
  if (item.tags?.includes("imprint")) {
    if (!m.imprints || !item.gameRef) return null;
    const count = m.imprints.get(item.gameRef) ?? 0;
    return count ? [{ rank: null, subtype: null, count }] : [];
  }
  // Sets share the built item's path; what you can sell is complete sets of parts, not the item.
  // A set whose parts orbiter doesn't know (newest Prime Access, cosmetics) can't be counted.
  if (item.tags?.includes("set")) {
    const parts = item.gameRef ? m.partsByParent.get(item.gameRef) : undefined;
    // Sets that aren't prime (Mandonel, Lato Vandal…): their blueprint and parts, from the recipe.
    const gear = !parts?.length && item.gameRef ? gearSetParts(m, item.gameRef) : null;
    if (!parts?.length && !gear) return null;
    const sets = parts?.length
      ? Math.min(...parts.map((p) => Math.floor((m.ownedPartQty.get(p.fullName) ?? 0) / p.required)))
      : Math.min(...gear!.map((p) => Math.floor(heldCount(m, p.unique) / p.required)));
    return sets > 0 ? [{ rank: null, subtype: null, count: sets }] : [];
  }
  // Veiled rivens: warframe.market files them under the unveiled riven's path, but what you hold
  // veiled is the game's …/Randomized/Raw… item of the same name.
  if (/ \(Veiled\)$/.test(item.name)) {
    const count = (m.inventoryByName.get(item.name.replace(/ \(Veiled\)$/, "")) ?? []).filter((r) => /\/Randomized\/Raw/.test(r.item_id)).reduce((n, r) => n + r.quantity, 0);
    return count ? [{ rank: null, subtype: null, count }] : [];
  }
  // By path, else by name (some mods' paths differ: …SPMod in the game, …SPSubMod on the market).
  let rows = item.gameRef ? (m.inventoryByBase.get(item.gameRef) ?? []) : [];
  if (!rows.length && !m.partByName.has(item.name)) rows = m.inventoryByName.get(item.name) ?? [];
  if (rows.length) {
    const byRank = new Map<number | null, number>();
    for (const r of rows) {
      const rank = item.maxRank != null ? (r.rank ?? 0) : null;
      byRank.set(rank, (byRank.get(rank) ?? 0) + r.quantity);
    }
    // Arcanes: every whole maxed one your copies make counts as held at max rank, fused or not
    // (you fuse them in game before the trade). 43 copies of a 21-copy arcane hold two.
    if (item.maxRank && item.tags?.includes("arcane_enhancement")) {
      const copies = (rank: number) => ((rank + 1) * (rank + 2)) / 2;
      const total = rows.reduce((n, r) => n + r.quantity * copies(r.rank ?? 0), 0);
      const sets = Math.floor(total / copies(item.maxRank));
      if (sets > (byRank.get(item.maxRank) ?? 0)) byRank.set(item.maxRank, sets);
    }
    return [...byRank.entries()].filter(([, c]) => c > 0).map(([rank, count]) => ({ rank, subtype: null, count }));
  }
  // Prime parts are matched by name (their inventory path can differ from the market's).
  if (m.partByName.has(item.name)) {
    const parts = m.ownedPartQty.get(item.name) ?? 0;
    return parts ? [{ rank: null, subtype: null, count: parts }] : [];
  }
  // Something the catalog knows and you don't hold: none. Anything else: orbiter can't tell.
  if ((item.gameRef && m.catalogByUnique.has(item.gameRef)) || m.catalogNames.has(item.name)) return [];
  return null;
}

// ------------------------------------------------------------ the sales log

/** The item name you typed, spelled the way orbiter knows it (any case), or null when it doesn't know it. */
export function knownName(names: readonly string[], typed: string): string | null {
  const t = typed.trim().toLowerCase();
  return t ? (names.find((n) => n.toLowerCase() === t) ?? null) : null;
}

/** How far apart a sale logged by hand and an unclaimed sale trade of the same item can be and still be one sale. */
export const HAND_SALE_MS = 24 * 3_600_000;

/**
 * The sales whose platinum a sale trade from the game log counts already, so revenue doesn't
 * count them twice. A sale a trade logged (or matched) names it in `trade`. One logged by hand
 * pairs with the nearest sale trade of the same item, within a day, that no other sale has: each
 * trade stands for one sale at most.
 */
export function salesCoveredByTrades(sales: readonly Sale[], saleTrades: readonly TradeLogEntry[]): Set<Sale> {
  const out = new Set<Sale>();
  const keys = new Set(saleTrades.map((t) => t.key));
  const used = new Set<string>();
  for (const s of sales) {
    if (s.trade == null) continue;
    used.add(s.trade);
    if (keys.has(s.trade)) out.add(s);
  }
  // The log and warframe.market sometimes name a thing differently ("… Blueprint", "… Relic").
  const norm = (n: string) => n.toLowerCase().replace(/ (blueprint|relic)$/, "");
  const byItem = new Map<string, TradeLogEntry[]>();
  for (const t of saleTrades) {
    if (used.has(t.key)) continue;
    for (const name of new Set(t.offered.map((x) => norm(x.name)))) byItem.set(name, [...(byItem.get(name) ?? []), t]);
  }
  const pairs: { s: Sale; key: string; gap: number }[] = [];
  for (const s of sales) {
    if (s.trade != null) continue;
    for (const t of byItem.get(norm(s.item)) ?? []) {
      const gap = Math.abs(t.at - s.at);
      if (gap < HAND_SALE_MS) pairs.push({ s, key: t.key, gap });
    }
  }
  for (const p of pairs.sort((a, b) => a.gap - b.gap)) {
    if (out.has(p.s) || used.has(p.key)) continue;
    out.add(p.s);
    used.add(p.key);
  }
  return out;
}

/**
 * Your listings as trade chat lines: "WTS [Arcane Reaper] R0 30p [Serration] 9p", dearest first,
 * each line within the chat's length, for posting in game alongside warframe.market.
 */
export function wtsLines(listings: { name: string; rank: number | null; platinum: number }[], max = 180): string[] {
  const items = [...listings].sort((a, b) => b.platinum - a.platinum).map((l) => `[${l.name}]${l.rank != null ? ` R${l.rank}` : ""} ${l.platinum}p`);
  const lines: string[] = [];
  let line = "WTS";
  for (const it of items) {
    if (line.length + 1 + it.length > max && line !== "WTS") {
      lines.push(line);
      line = "WTS";
    }
    line += ` ${it}`;
  }
  if (line !== "WTS") lines.push(line);
  return lines;
}
