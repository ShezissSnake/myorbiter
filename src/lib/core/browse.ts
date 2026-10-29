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
  ducats: number | null;
  /** How many you hold (sets: complete sets; relics: every refinement); null when unknown. */
  have: number | null;
  /** warframe.market's thumbnail, for items orbiter has no art for. */
  thumb: string | null;
}

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
      ducats: m.partByName.get(it.name)?.[0]?.ducats ?? null,
      have: held == null ? null : held.reduce((n, h) => n + h.count, 0),
      thumb: it.thumb ?? null,
    };
  });
}

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
    return true;
  });
}
