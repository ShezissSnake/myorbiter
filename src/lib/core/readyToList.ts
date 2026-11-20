// Home's Ready to list: the spares not listed yet. Copies already on warframe.market, shown or
// hidden, are taken out here. The listings' total on the same page counts the shown ones only.

/** One line of Ready to list: copies of an item and their platinum (no more than a month sells). */
export interface ReadyRow {
  name: string;
  /** Arcanes: maxed and unranked copies are separate lines; null where the rank doesn't matter. */
  rank?: number | null;
  quantity: number;
  /** Platinum each, when known. */
  each: number | null;
  plat: number;
}

/** A listing of yours: its item's name, its rank, how many it offers. */
export interface ListedCopies {
  name: string | undefined;
  rank: number | null;
  quantity: number;
}

const sameRank = (a: number | null | undefined, b: number | null) => a == null || b == null || a === b;

/**
 * `rows` less the copies `listed` already offers, each listing's copies taken once, from the first
 * line of its item and rank. A line's platinum keeps its share: no more than what was there, and
 * no more than its price each for the copies left. Lines with nothing left go.
 */
export function notListedYet<T extends ReadyRow>(rows: readonly T[], listed: readonly ListedCopies[]): T[] {
  const left = listed.map((l) => ({ ...l }));
  const out: T[] = [];
  for (const r of rows) {
    let quantity = r.quantity;
    for (const l of left) {
      if (!quantity) break;
      if (l.name !== r.name || !l.quantity || !sameRank(r.rank, l.rank)) continue;
      const take = Math.min(quantity, l.quantity);
      quantity -= take;
      l.quantity -= take;
    }
    if (quantity <= 0) continue;
    // `plat` is the price each for no more copies than a month sells: the copies left count up to that.
    const plat = r.each != null ? Math.min(r.plat, r.each * quantity) : (r.plat * quantity) / r.quantity;
    out.push(quantity === r.quantity ? r : { ...r, quantity, plat });
  }
  return out;
}
