// "Worth selling": what your spares come to on the selling pages (Prime parts, Mods, Arcanes) and
// on Home's Ready to list, worked out one way per kind so the four always agree. Your spares, less
// the ones better traded to Baro for ducats or dissolved for Vosfor, less what isn't worth a trade,
// and no more copies of each than the market sells in a month (as Inventory's Spare value counts
// them). Inventory's Spare value is the wider figure: every kind, slow sellers and small change too.
import { decide, worthATrade, type DucatOptions } from "./advice";
import type { Model } from "./model";
import { sellableCopies, type SellChoices } from "./spares";
import { arcaneRows, modRows, partRows, saveForSets, type ModRow, type PartRow } from "./views";
import { packValues, spareArcanes, vosforWorth, type SpareArcane } from "./vosfor";

export type WorthKind = "part" | "mod" | "arcane";

/** One thing worth selling, at one price. */
export interface WorthItem {
  kind: WorthKind;
  name: string;
  /** Arcanes: maxed copies are one item, loose unranked ones another (each at its own price). */
  rank: number | null;
  /** The copies to sell. */
  copies: number;
  /** Of those, the ones the market takes in a month: what `plat` counts. */
  counted: number;
  each: number;
  plat: number;
}

const item = (kind: WorthKind, name: string, rank: number | null, copies: number, each: number, tradesPerDay: number | null): WorthItem => {
  const counted = sellableCopies(copies, tradesPerDay);
  return { kind, name, rank, copies, counted, each, plat: each * counted };
};

/**
 * Prime parts: the spare copies not going out inside a whole set you can sell (Sets), worth more as
 * platinum than as ducats at your rate and worth a trade (Best as: Sell).
 */
export function partsWorthSelling(rows: PartRow[], advice: DucatOptions): WorthItem[] {
  const out: WorthItem[] = [];
  for (const r of rows) {
    const loose = r.spare - r.inSets;
    if (loose <= 0 || r.price == null) continue;
    if (decide(r.price, r.ducats, r.tradesPerDay, advice, loose).verdict === "ducats") continue;
    out.push(item("part", r.name, null, loose, r.price, r.tradesPerDay));
  }
  return out;
}

/**
 * Mods: the spare copies (beyond your best and one to give away) of tradable mods that sell at least
 * once a day, as Sell spares lists them, and only where they're worth a trade. Rivens go
 * under everything else on Inventory.
 */
export function modsWorthSelling(rows: ModRow[], minPlat: number): WorthItem[] {
  const out: WorthItem[] = [];
  for (const r of rows) {
    if (!r.tradable || r.extras <= 0 || r.extrasValue == null || / Riven Mod/.test(r.name)) continue;
    if ((r.tradesPerDay ?? 0) < 1) continue;
    const each = r.extrasValue / r.extras;
    if (!worthATrade(each, r.extras, minPlat)) continue;
    out.push(item("mod", r.name, null, r.extras, each, r.tradesPerDay));
  }
  return out;
}

/**
 * Arcanes: the spares marked Sell (not Dissolve, which also takes the ones under a trade's worth):
 * maxed copies at the max-rank price, loose ones at their share of a maxed one (vosfor.ts).
 */
export function arcanesWorthSelling(spares: SpareArcane[]): WorthItem[] {
  const out: WorthItem[] = [];
  for (const x of spares) {
    if (x.verdict !== "sell" || x.sellPlat == null) continue;
    if (x.maxed > 0 && x.row.priceMax != null) out.push(item("arcane", x.row.name, x.row.maxRank, x.maxed, x.row.priceMax, x.row.tradesPerDay));
    if (x.unranked > 0 && x.each != null) out.push(item("arcane", x.row.name, 0, x.unranked, x.each, x.row.tradesPerDay));
  }
  return out;
}

/** The spare arcanes, sorted into sell and dissolve with your Vosfor lens (as Arcanes shows them). */
export function arcaneSpares(m: Model, advice: DucatOptions): SpareArcane[] {
  const rows = arcaneRows(m);
  const lens = advice.vosforLens ?? "need";
  const { perVosfor } = vosforWorth(packValues(m, rows), lens);
  return spareArcanes(m, rows, perVosfor, { lens, minPrice: advice.minPlat });
}

/** Every kind at once, for Home: the same items each selling page counts. */
export function worthSelling(m: Model, advice: DucatOptions, sell?: SellChoices, drops: ReadonlyMap<string, number> = new Map()): WorthItem[] {
  return [
    ...partsWorthSelling(partRows(m, saveForSets(sell, advice.platPerDucat, drops)), advice),
    ...modsWorthSelling(modRows(m), advice.minPlat),
    ...arcanesWorthSelling(arcaneSpares(m, advice)),
  ];
}

/** The platinum a list of them comes to, rounded once. */
export const worthTotal = (items: WorthItem[]) => Math.round(items.reduce((n, x) => n + x.plat, 0));
