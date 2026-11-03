// Warframe's trading tax: credits charged per item handed over in a trade, by the item's kind and
// rarity (the wiki's Trading page, "Trade Tax", November 2026). This is the base tax; trading in
// Maroo's Bazaar adds 10%, a clan dojo whatever its treasurers set (0–100%). Whoever hands an item
// over pays its tax: a seller pays for the items, a buyer 500 credits for each platinum.
import type { BulkAction, BulkKind } from "./bulk";
import type { MarketItem } from "./market";
import { gearSetParts, type Model } from "./model";

export const TAX = { common: 2_000, uncommon: 4_000, rare: 8_000, legendary: 1_000_000 } as const;
/** Arcanes by rarity, unranked to rank 5. */
export const ARCANE_TAX: Record<"common" | "uncommon" | "rare" | "legendary", number[]> = {
  common: [2_000, 6_000, 12_000, 20_000, 30_000, 42_000],
  uncommon: [4_000, 12_000, 24_000, 40_000, 60_000, 84_000],
  rare: [8_000, 24_000, 48_000, 80_000, 120_000, 168_000],
  legendary: [100_000, 300_000, 600_000, 1_000_000, 1_500_000, 2_100_000],
};
/** Maroo's Bazaar's hub tax on top of the base: 10%. */
export const MAROO_HUB = 0.1;

type Rarity = keyof typeof TAX;
const RARITIES: Rarity[] = ["common", "uncommon", "rare", "legendary"];

/** The item's rarity: the catalog's, else a warframe.market tag. */
function rarityOf(m: Model, it: MarketItem): Rarity | null {
  const c = it.gameRef ? m.catalogByUnique.get(it.gameRef) : undefined;
  const r = c?.rarity?.toLowerCase();
  if (r && (RARITIES as string[]).includes(r)) return r as Rarity;
  return RARITIES.find((x) => it.tags?.includes(x)) ?? null;
}

/**
 * The base tax on one of this item (one set: every part in it), in credits; null when orbiter
 * can't tell (an unknown rarity, a Requiem relic, a set whose parts it doesn't know).
 */
export function taxEach(m: Model, kind: BulkKind, it: MarketItem, rank: number | null = null): number | null {
  const tags = it.tags ?? [];
  if (kind === "set") {
    const parts = it.gameRef ? (m.partsByParent.get(it.gameRef)?.map((p) => p.required) ?? gearSetParts(m, it.gameRef)?.map((p) => p.required)) : null;
    // A set goes over as its parts, each a common-tier item.
    return parts?.length ? parts.reduce((n, k) => n + k, 0) * TAX.common : null;
  }
  if (kind === "part" || kind === "imprint") return TAX.common;
  if (/ \(Veiled\)$/.test(it.name) || tags.includes("riven_mod")) return TAX.rare;
  if (kind === "mod") {
    const r = rarityOf(m, it);
    return r ? TAX[r] : null;
  }
  if (kind === "arcane") {
    const r = rarityOf(m, it);
    return r ? ARCANE_TAX[r][Math.max(0, Math.min(5, rank ?? 0))] : null;
  }
  // Everything else orbiter lists.
  if (tags.includes("relic") || / Relic$/.test(it.name)) {
    if (/^(Lith|Meso) /.test(it.name)) return TAX.common;
    if (/^(Neo|Axi) /.test(it.name)) return TAX.uncommon;
    return null;
  }
  if (tags.includes("ayatan_star")) return TAX.rare;
  if (tags.includes("ayatan_sculpture")) return TAX.uncommon;
  // Gems, fish, Captura scenes, lenses, blueprints and weapon parts: common-tier.
  return TAX.common;
}

export interface PlanTax {
  /** The base tax for selling everything the plan leaves listed by it (new listings and resized ones), in credits. */
  credits: number;
  /** The same in Maroo's Bazaar. */
  maroo: number;
  /** How many copies go into it. */
  items: number;
  /** Listings whose tax orbiter can't tell (left out of `credits`). */
  unknown: string[];
}

/**
 * What selling the plan's new and changed listings would cost in trading tax, every copy sold.
 * Listings the plan takes down or leaves alone don't count.
 */
export function planTax(m: Model, actions: BulkAction[]): PlanTax {
  let credits = 0;
  let items = 0;
  const unknown: string[] = [];
  for (const a of actions) {
    if (a.type !== "create" && a.type !== "update") continue;
    const rank = a.type === "create" ? a.rank : a.order.rank;
    const each = taxEach(m, a.kind, a.item, rank);
    if (each == null) {
      unknown.push(a.item.name);
      continue;
    }
    credits += each * a.quantity;
    items += a.quantity;
  }
  return { credits, maroo: Math.round(credits * (1 + MAROO_HUB)), items, unknown };
}
