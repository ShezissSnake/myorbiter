// Orders' Will set when Reprice would leave a price as it is: why, in a word and a tooltip. One
// text per reason `plan` (core/market.ts) can return; "already" splits in two, since a raise that
// stops at the cheapest seller (`plan`'s cap) ends there too.

import { BAND_WORDS, DRIFT } from "./drift";
import type { Plan } from "./market";

export interface Unchanged {
  word: string;
  title: string;
}

/**
 * Why Reprice leaves `price` as it is under `p` (a plan with no change). `p.target` is the price
 * itself then; the competitor still says where the market is.
 */
export function unchangedWhy(p: Pick<Plan, "reason" | "competitor" | "floor">, price: number): Unchanged {
  const market = p.competitor.price;
  const lowest = p.competitor.lowest?.platinum ?? null;
  const why: Record<Plan["reason"], () => Unchanged> = {
    // A raise goes no higher than the cheapest seller online or in game: under the market price,
    // with that seller at or under this price, it stays.
    already: () =>
      market != null && market > price && lowest != null && lowest <= price
        ? { word: "held at cheapest", title: `The market price is ${market}p, but a raise goes no higher than the cheapest seller online or in game (${lowest}p), so Reprice leaves it at ${price}p` }
        : { word: "matched", title: `Already at the market price (${market ?? price}p)` },
    steady: () => ({ word: `within ${DRIFT.bandPlat}p/${Math.round(DRIFT.bandShare * 100)}%`, title: `Where Reprice would set it is within ${BAND_WORDS} of ${price}p: too small a change to send` }),
    floor: () => ({ word: "on its floor", title: `At its floor (${p.floor}p): Reprice never sets it lower` }),
    "no-sellers": () => ({ word: "no market price", title: "Fewer than two sellers online or in game: no market price to follow, so the price stays" }),
    // A change of these is never "no change" (`plan` turns a target equal to the price into
    // "already"); said all the same, so every reason has its words.
    match: () => ({ word: "matched", title: `Already at the market price (${market ?? price}p)` }),
    median: () => ({ word: "matched", title: `Already at what it sells for (${price}p)` }),
  };
  return why[p.reason]();
}
