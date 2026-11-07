// Everything warframe.market trades, priced: for browsing the market by category, price and how
// often things sell, owned or not. Prices are TennoScope's daily medians of what sold; the live
// order book (cheapest seller, best buyer) is a click away, in the buy order form.
import { holdings, type MarketItem } from "./market";
import type { Model } from "./model";

export type MarketCategory =
  | "scene"
  | "relic"
  | "set"
  | "prime"
  | "arcane"
  | "mod"
  | "gear"
  | "fish"
  | "gem"
  | "ayatan"
  | "cosmetic"
  | "other";

/** In the order the category menu lists them, each with its label. */
export const CATEGORIES: { v: MarketCategory; label: string }[] = [
  { v: "prime", label: "Prime parts" },
  { v: "set", label: "Sets" },
  { v: "relic", label: "Relics" },
  { v: "mod", label: "Mods" },
  { v: "arcane", label: "Arcanes" },
  { v: "gear", label: "Weapons and parts" },
  { v: "scene", label: "Captura scenes" },
  { v: "ayatan", label: "Ayatan sculptures" },
  { v: "fish", label: "Fish" },
  { v: "gem", label: "Gems" },
  { v: "cosmetic", label: "Cosmetics" },
  { v: "other", label: "Everything else" },
];

/** Which category an item goes under, by warframe.market's tags; the first that fits. */
export function categoryOf(tags: string[] | null): MarketCategory {
  const t = new Set(tags ?? []);
  if (t.has("scene")) return "scene";
  if (t.has("relic")) return "relic";
  if (t.has("set")) return "set";
  if (t.has("prime") && (t.has("component") || t.has("blueprint"))) return "prime";
  if (t.has("arcane_enhancement")) return "arcane";
  if (t.has("mod")) return "mod";
  if (t.has("fish")) return "fish";
  if (t.has("gem")) return "gem";
  if (t.has("ayatan_sculpture")) return "ayatan";
  if (t.has("skin") || t.has("emote") || t.has("imprint")) return "cosmetic";
  if (t.has("weapon") || t.has("component") || t.has("blueprint") || t.has("warframe")) return "gear";
  return "other";
}

export interface MarketRow {
  name: string;
  slug: string;
  gameRef: string | null;
  category: MarketCategory;
  /** What it sold for lately (daily median); a relic's is intact, a mod's or arcane's unranked. */
  price: number | null;
  /** The same for a maxed mod or arcane. */
  priceMax: number | null;
  maxRank: number | null;
  tradesPerDay: number | null;
  /** On how many days it sold lately. */
  saleDays: number | null;
  ducats: number | null;
  /** How many you hold (sets: complete sets; relics: every refinement); null when unknown. */
  have: number | null;
  /** warframe.market's thumbnail, for items MyOrbiter has no art for. */
  thumb: string | null;
}

/** Arcane copies you hold, at any rank (a rank-5 one counts once). */
const arcaneCopies = (m: Model, unique: string) => (m.inventoryByBase.get(unique) ?? []).reduce((n, r) => n + r.quantity, 0);

/** Every item on warframe.market with its price, trade rate, ducats and how many you hold. */
export function marketRows(m: Model, items: MarketItem[]): MarketRow[] {
  return items.map((it) => {
    const held = holdings(m, it);
    const relic = categoryOf(it.tags) === "relic" ? it.name.replace(/ Relic$/, "") : null;
    return {
      name: it.name,
      slug: it.slug,
      gameRef: it.gameRef,
      category: categoryOf(it.tags),
      // Relics: what they sold for lately on warframe.market, else the daily price (intact).
      price: relic ? m.relicPrice(relic) : m.price(it.name),
      priceMax: it.maxRank ? m.priceMax(it.name) : null,
      maxRank: it.maxRank,
      tradesPerDay: m.tradesPerDay(it.name),
      saleDays: m.saleDays(it.name),
      ducats: m.partByName.get(it.name)?.[0]?.ducats ?? null,
      // Arcanes: holdings also counts the maxed ones your copies would make, so use the copies.
      have: held == null ? null : categoryOf(it.tags) === "arcane" ? (it.gameRef ? arcaneCopies(m, it.gameRef) : 0) : held.reduce((n, h) => n + h.count, 0),
      thumb: it.thumb ?? null,
    };
  });
}

/** Sales a day that make a price believable: about one a week… */
export const WEEKLY = 1 / 7;
/** …on at least this many different days: Xiphos Set "sold" for 80,000p on three. */
export const SALE_DAYS = 5;
export const steady = (r: MarketRow) => (r.tradesPerDay ?? 0) >= WEEKLY && (r.saleDays ?? 0) >= SALE_DAYS;

export interface MarketFilter {
  category: MarketCategory | "all";
  /**
   * At least / at most this many platinum. A mod or arcane counts at its maxed price for "at least"
   * and its unranked one for "at most": either way, there's a copy at that price.
   */
  min: number | null;
  max: number | null;
  /** Sells at least this many times a day. */
  minTrades: number | null;
  /** Only what you hold. */
  owned: boolean;
  /**
   * Only what sells at least once a week, on several days (steady): a price from one or two days
   * of sales can be a joke (Xiphos Set "sold" for 80,000p).
   */
  weekly?: boolean;
}

/** The price a row is filtered by: the higher of its unranked and maxed prices. */
export const topPrice = (r: MarketRow) => (r.priceMax != null && (r.price == null || r.priceMax > r.price) ? r.priceMax : r.price);

export function filterRows(rows: MarketRow[], f: MarketFilter): MarketRow[] {
  return rows.filter((r) => {
    if (f.category !== "all" && r.category !== f.category) return false;
    const top = topPrice(r);
    const low = r.price ?? r.priceMax;
    if (f.min != null && (top == null || top < f.min)) return false;
    if (f.max != null && (low == null || low > f.max)) return false;
    if (f.minTrades != null && (r.tradesPerDay ?? 0) < f.minTrades) return false;
    if (f.owned && !r.have) return false;
    if (f.weekly && !steady(r)) return false;
    return true;
  });
}

/**
 * The category menu's counts: what each category would show under the rest of the filters (the
 * category itself left out), and "all" for every category together.
 */
export function categoryCounts(rows: MarketRow[], f: MarketFilter): Map<MarketCategory | "all", number> {
  const shown = filterRows(rows, { ...f, category: "all" });
  const out = new Map<MarketCategory | "all", number>([["all", shown.length]]);
  for (const r of shown) out.set(r.category, (out.get(r.category) ?? 0) + 1);
  return out;
}
