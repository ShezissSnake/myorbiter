// Whether a sale logged by hand and a line of a sale trade from the game log are one sale: the
// question the trade marking (handLoggedSale, upkeep.ts) and Stats' revenue
// (salesCoveredByTrades, market.ts) both ask, each within its own window of time.
import type { Sale } from "../backend";

/** The log and warframe.market sometimes name a thing differently ("… Blueprint", "… Relic"). */
export const saleName = (n: string) => n.toLowerCase().replace(/ (blueprint|relic)$/, "");

/**
 * A rank as both sides write it: the game log gives an unranked arcane no rank (it has no pips)
 * and a mod its rank; a Sold click writes the listing's (0 for an unranked one). No rank is rank 0.
 */
const rankOf = (r: number | null | undefined) => r ?? 0;

/** The same item at the same rank: a hand-logged sale of another rank is another sale. */
export const sameSaleItem = (sale: Pick<Sale, "item" | "rank">, line: { name: string; rank: number | null }) =>
  saleName(sale.item) === saleName(line.name) && rankOf(sale.rank) === rankOf(line.rank);

/**
 * How many copies of a trade's line a hand-logged sale of the same item stands for: as many as
 * both have. A hand-logged sale of 1 and a trade of 3 are 1 copy of the trade (2 are not logged
 * yet); a hand-logged sale of 3 and a trade of 1 are that trade's copy and 2 sold some other way.
 */
export const copiesInCommon = (sale: Pick<Sale, "quantity">, line: { count: number }) => Math.max(0, Math.min(sale.quantity, line.count));
