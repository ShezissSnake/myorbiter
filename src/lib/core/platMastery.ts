// Mastery for platinum: what you haven't mastered that platinum gets you, cheapest first. A prime
// costs its missing parts (or the whole set, when that's cheaper) from other players on
// warframe.market; anything else tradable costs its own price there; and what the in-game Market
// sells built costs its platinum price there. Each item goes by its cheapest way.
import type { Model } from "./model";
import type { MasteryRow } from "./views";

export interface PlatBuy {
  /** What to buy: a part, a set, or the item. */
  name: string;
  /** Copies. */
  need: number;
  /** Each, at the daily median. */
  price: number;
}

export interface PlatMastery {
  row: MasteryRow;
  plat: number;
  /** warframe.market (from players, a buy order works) or the in-game Market. */
  where: "market" | "ingame";
  /** What to buy on warframe.market. Empty for the in-game Market. */
  buys: PlatBuy[];
  /** Platinum per 1,000 mastery points. */
  perK: number;
}

export function platMastery(m: Model, rows: MasteryRow[]): PlatMastery[] {
  const out: PlatMastery[] = [];
  for (const r of rows) {
    if (r.status === "level" || r.unobtainable || !r.points) continue;
    const options: Omit<PlatMastery, "row" | "perK">[] = [];
    if (r.isPrime && r.missingParts.length) {
      const parts = r.missingParts.map((p) => ({ name: p.name, need: p.need, price: m.price(p.name) }));
      if (parts.every((p) => p.price != null)) {
        options.push({ plat: Math.round(parts.reduce((n, p) => n + p.price! * p.need, 0)), where: "market", buys: parts.map((p) => ({ ...p, price: Math.round(p.price!) })) });
      }
      // None of it yet: the set may be cheaper than its parts one by one.
      if (r.partsOwned === 0 && r.setPrice != null) options.push({ plat: Math.round(r.setPrice), where: "market", buys: [{ name: `${r.name} Set`, need: 1, price: Math.round(r.setPrice) }] });
    } else if (!r.isPrime) {
      const item = m.catalogByUnique.get(r.unique);
      const own = m.price(r.name) ?? m.price(`${r.name} Set`);
      if (own != null && item?.tradable !== false) options.push({ plat: Math.round(own), where: "market", buys: [{ name: m.price(r.name) != null ? r.name : `${r.name} Set`, need: 1, price: Math.round(own) }] });
      if (item?.marketCost) options.push({ plat: item.marketCost, where: "ingame", buys: [] });
    }
    if (!options.length) continue;
    const best = options.reduce((a, b) => (b.plat < a.plat ? b : a));
    out.push({ row: r, ...best, perK: Math.round((best.plat / r.points) * 1000 * 10) / 10 });
  }
  return out.sort((a, b) => a.plat - b.plat || b.row.points - a.row.points);
}
