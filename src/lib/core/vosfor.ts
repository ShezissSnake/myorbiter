// Arcane Dissolution: Loid turns arcanes into Vosfor, and sells packs of three random arcanes from
// a collection for 200 Vosfor. For each spare arcane: sell it, or dissolve it for packs?
// The yields and pack contents come from the wiki (src/lib/data/vosfor.json).
import data from "../data/vosfor.json";
import type { Model } from "./model";
import { copiesForRank, type ArcaneRow } from "./views";

interface Pool {
  rarity: string;
  chance: number;
  arcanes: string[];
}
interface Pack {
  name: string;
  vosfor: number;
  credits: number;
  arcanesPerPack: number;
  pools: Pool[];
}
const DATA = data as { yield: Record<string, number>; packs: Pack[] };

/**
 * An arcane that trades fewer times a day than this doesn't count as sellable when weighing
 * selling against dissolving: not as a sale (it's dissolved), and not toward what a pack is worth
 * at market prices (you couldn't sell what it gives you).
 */
export const SELLS_DAILY = 5;

/** Loid's collections ("Eidolon", "Duviri"…), each with the arcanes its packs can hold. */
export const COLLECTIONS: { name: string; arcanes: Set<string> }[] = DATA.packs.map((p) => ({
  name: p.name.replace(/ Arcane Collection$/, ""),
  arcanes: new Set(p.pools.flatMap((pool) => pool.arcanes)),
}));

/** Vosfor for dissolving one unranked copy, or null if it can't be dissolved. */
export const vosforYield = (name: string): number | null => DATA.yield[name] ?? null;

export const VOSFOR_UNIQUE = "/Lotus/Types/Items/MiscItems/DistillPoints";
export const vosforHeld = (m: Model) => (m.inventoryByBase.get(VOSFOR_UNIQUE) ?? []).reduce((n, r) => n + r.quantity, 0);

/**
 * What Vosfor is worth, two ways:
 * - market: the average platinum of a pack's three arcanes at unranked prices, if you sold them
 *   (arcanes trading under SELLS_DAILY a day count for nothing: they wouldn't sell).
 * - need: only the arcanes you're still collecting count, at what buying those copies would cost.
 */
export type VosforLens = "market" | "need";

export interface PackValue {
  name: string;
  vosfor: number;
  credits: number;
  /** Expected platinum per pack, all three arcanes at unranked prices. */
  plat: number;
  /** Expected copies per pack of arcanes you haven't finished. */
  needCopies: number;
  /** Expected platinum per pack of those copies (what you'd otherwise pay for them). */
  needPlat: number;
  /** Each arcane you still need from it, with the chance per pack of getting at least one. */
  wanted: { name: string; chance: number }[];
}

/**
 * What one unranked copy is worth: its own price, but never more than its share of a maxed one
 * (a maxed arcane is 21 copies). Single unranked copies are many small trades; fused, they're one.
 */
function copyValue(m: Model, name: string, r: ArcaneRow | undefined): number {
  const each = r?.price ?? m.price(name);
  const maxed = r?.priceMax ?? m.priceMax(name);
  const share = maxed != null ? maxed / (r?.needed ?? 21) : null;
  if (each == null) return share ?? 0;
  return share == null ? each : Math.min(each, share);
}

export function packValues(m: Model, rows: ArcaneRow[]): PackValue[] {
  const byName = new Map(rows.map((r) => [r.name, r]));
  return DATA.packs.map((p) => {
    let plat = 0;
    let needCopies = 0;
    let needPlat = 0;
    const wanted: PackValue["wanted"] = [];
    for (const pool of p.pools) {
      const each = pool.chance / pool.arcanes.length; // per slot
      for (const a of pool.arcanes) {
        const r = byName.get(a);
        const price = copyValue(m, a, r);
        if ((r?.tradesPerDay ?? m.tradesPerDay(a) ?? 0) >= SELLS_DAILY) plat += p.arcanesPerPack * each * price;
        if (r && !r.complete) {
          needCopies += p.arcanesPerPack * each;
          needPlat += p.arcanesPerPack * each * price;
          wanted.push({ name: a, chance: 1 - (1 - each) ** p.arcanesPerPack });
        }
      }
    }
    wanted.sort((a, b) => b.chance - a.chance);
    return { name: p.name, vosfor: p.vosfor, credits: p.credits, plat, needCopies, needPlat, wanted };
  });
}

/** Platinum per Vosfor through the best pack for the lens, and that pack. */
export function vosforWorth(packs: PackValue[], lens: VosforLens): { perVosfor: number; best: PackValue | null } {
  let best: PackValue | null = null;
  let perVosfor = 0;
  for (const p of packs) {
    const v = (lens === "market" ? p.plat : p.needPlat) / p.vosfor;
    if (v > perVosfor) {
      perVosfor = v;
      best = p;
    }
  }
  return { perVosfor, best };
}

export interface SpareArcane {
  row: ArcaneRow;
  /** Maxed copies beyond the one you keep. */
  maxed: number;
  /** Loose unranked copies beyond what your kept copy needs. */
  unranked: number;
  /** Selling them all: maxed at the max-rank price, unranked at the unranked price. */
  sellPlat: number | null;
  /** Dissolving them all. */
  vosfor: number | null;
  /** That Vosfor in platinum, through the best pack for the lens. */
  dissolvePlat: number | null;
  verdict: "sell" | "dissolve";
  why: string;
}

export interface SpareOptions {
  lens: VosforLens;
  /** Below this a sale isn't worth a trade. */
  minPrice: number;
}

/** Every arcane you hold more of than you need, with the better of selling and dissolving. */
export function spareArcanes(m: Model, rows: ArcaneRow[], perVosfor: number, opts: SpareOptions): SpareArcane[] {
  const out: SpareArcane[] = [];
  for (const r of rows) {
    // Whole maxed arcanes beyond the one you keep, fused or still to fuse, then what's left loose.
    const maxed = r.extraSets;
    const unranked = r.complete ? Math.max(0, Math.min(r.unranked, r.spare) - r.toFuse * r.needed) : 0;
    if (maxed <= 0 && unranked <= 0) continue;
    const y = vosforYield(r.name);
    const copies = maxed * copiesForRank(r.maxRank) + unranked;
    const vosfor = y == null ? null : y * copies;
    const dissolvePlat = vosfor == null ? null : vosfor * perVosfor;
    const sellMaxed = maxed ? (r.priceMax == null ? null : maxed * r.priceMax) : 0;
    const sellLoose = unranked ? (r.price == null ? null : unranked * r.price) : 0;
    const sellPlat = !r.tradable || sellMaxed == null || sellLoose == null ? null : sellMaxed + sellLoose;
    // Each sale is one trade: a maxed copy, or the loose copies together.
    const eachTrade = sellPlat == null ? null : maxed ? (r.priceMax ?? 0) : sellPlat;

    let verdict: SpareArcane["verdict"] = "sell";
    let why = "";
    if (vosfor == null) why = "Can't be dissolved";
    else if (sellPlat == null) {
      verdict = "dissolve";
      why = r.tradable ? "No market price" : "Can't be traded";
    } else if (eachTrade != null && eachTrade < opts.minPrice) {
      verdict = "dissolve";
      why = `Sells for under ${opts.minPrice}p a trade`;
    } else if ((r.tradesPerDay ?? 0) < SELLS_DAILY) {
      verdict = "dissolve";
      why = `Trades under ${SELLS_DAILY} times a day: Vosfor is the sure thing`;
    } else if (dissolvePlat != null && dissolvePlat > sellPlat) {
      verdict = "dissolve";
      why = opts.lens === "need" ? "Worth more as packs toward arcanes you're collecting" : "Worth more as Vosfor packs";
    } else why = "Sells for more than its Vosfor is worth";
    out.push({ row: r, maxed, unranked, sellPlat, vosfor, dissolvePlat, verdict, why });
  }
  return out;
}
