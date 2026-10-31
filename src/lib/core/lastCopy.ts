// While a buyer is whispering you, your last copy of something shouldn't draw a second buyer.
//
// The game log says someone whispered you, and who, but not what they want, so on any new whisper
// every listing down to its last copy is hidden from warframe.market. Each comes back after a while
// unless it sold in the meantime (the sale closes the listing) or you showed it again yourself.

import type { MyOrder } from "./market";

/** A listing orbiter hid on a whisper, and when (unix ms). */
export interface HiddenForWhisper {
  id: string;
  at: number;
}

export const DEFAULT_HIDE_MINUTES = 10;

/** Sell listings still shown with one copy left: the ones a second buyer would find already gone. */
export function lastCopies(orders: MyOrder[]): MyOrder[] {
  return orders.filter((o) => o.type === "sell" && o.visible && o.quantity === 1);
}

/**
 * The hidden list after hiding `orders` now. One already on the list keeps its time: whispers
 * come one after another while you trade, and restarting the wait on each kept listings hidden
 * for hours.
 */
export function hideNow(hidden: HiddenForWhisper[], orders: MyOrder[], now: number): HiddenForWhisper[] {
  const ids = new Set(hidden.map((h) => h.id));
  return [...hidden, ...orders.filter((o) => !ids.has(o.id)).map((o) => ({ id: o.id, at: now }))];
}

/**
 * What to do with the listings orbiter hid: the ones whose wait is over and are still listed and
 * hidden, to show again; and the list to keep. A listing that's gone (sold, or taken down) or that
 * you showed yourself is dropped from the list, and never touched.
 */
export function dueToShow(hidden: HiddenForWhisper[], orders: MyOrder[], now: number, minutes: number): { show: MyOrder[]; keep: HiddenForWhisper[] } {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const show: MyOrder[] = [];
  const keep: HiddenForWhisper[] = [];
  for (const h of hidden) {
    const o = byId.get(h.id);
    if (!o || o.visible) continue;
    if (now - h.at >= minutes * 60_000) show.push(o);
    else keep.push(h);
  }
  return { show, keep };
}
