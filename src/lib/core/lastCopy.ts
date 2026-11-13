// While a buyer is whispering you, your last copy of something shouldn't draw a second buyer.
//
// The game log says someone whispered you, and who, but not what they want, so on any new whisper
// every listing down to its last copy is hidden from warframe.market. Each comes back after a while
// unless it sold in the meantime (the sale closes the listing) or the player showed or hid it by
// hand since (the player's last word wins: it leaves the list). A copy can also sell in game without
// warframe.market hearing of it (Mark sales sold off), so a listing comes back only once an
// inventory read taken after it was hidden still holds the copy; until then it waits.

import type { MyOrder } from "./market";

/** A listing MyOrbiter hid on a whisper, and when (unix ms). */
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
 * What to do with the listings MyOrbiter hid: the ones whose wait is over and are still listed and
 * hidden, to show again; and the list to keep. A listing that's gone (sold, or taken down) or that
 * was shown since is dropped from the list, and never touched. `readAt` is when the newest
 * inventory read was taken (unix ms; null: none): a listing is shown again only against a read
 * taken after it was hidden. One whose wait is over without such a read stays on the list with its
 * time, and is in `waiting` too.
 */
export function dueToShow(
  hidden: HiddenForWhisper[],
  orders: MyOrder[],
  now: number,
  minutes: number,
  readAt: number | null,
): { show: MyOrder[]; keep: HiddenForWhisper[]; waiting: HiddenForWhisper[] } {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const show: MyOrder[] = [];
  const keep: HiddenForWhisper[] = [];
  const waiting: HiddenForWhisper[] = [];
  for (const h of hidden) {
    const o = byId.get(h.id);
    if (!o || o.visible) continue;
    if (now - h.at < minutes * 60_000) keep.push(h);
    else if (readAt != null && readAt > h.at) show.push(o);
    else {
      keep.push(h);
      waiting.push(h);
    }
  }
  return { show, keep, waiting };
}

/** The list without `ids`: the player showed or hid them by hand, and that word wins. */
export function forget(hidden: HiddenForWhisper[], ids: string[]): HiddenForWhisper[] {
  const gone = new Set(ids);
  return hidden.some((h) => gone.has(h.id)) ? hidden.filter((h) => !gone.has(h.id)) : hidden;
}
