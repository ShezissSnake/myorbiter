// What the world's notifications say once: an era opening for the wishlist, a cheap buy, the
// Duviri Circuit's week. Each takes what was announced before and gives what is news now.
import { ERAS } from "./model";
import { crackableIn, openEras } from "./wishlist";
import type { Fissure } from "./types";

/**
 * Eras whose relics became crackable since `before` (null: nothing to compare with yet), among the
 * ones `wished` has relics for. An era is crackable while its own fissure or an Omnia one is open
 * (Omnia takes any relic but a Requiem one: wishlist.ts › crackableIn, as the Wishlist page has
 * it), so an era's own fissure opening beside an open Omnia one isn't news again.
 *
 * `current` (worldAge.ts › liveCurrent): the world state is current. While it isn't (the computer
 * slept, or the reads fail), what the 30 s prune takes out of it isn't the game closing a fissure:
 * `baseline` stays what the last current list had, and the first fresh read is compared with that.
 */
export function wishlistNews(before: Set<string> | null, fissures: Fissure[], now: number, current: boolean, wished: { has(era: string): boolean }): { baseline: Set<string> | null; fresh: string[] } {
  if (!current) return { baseline: before, fresh: [] };
  const open = openEras(fissures, now);
  const openNow = new Set<string>(ERAS.filter((e) => crackableIn(e, open)));
  return { baseline: openNow, fresh: before ? [...openNow].filter((e) => !before.has(e) && wished.has(e)) : [] };
}

export interface DealSeen {
  slug: string;
  rank: number | null;
  price: number;
}

/** No item is announced as a cheap buy more than once in this long. */
export const DEAL_AGAIN_MS = 3_600_000;

/**
 * Cheap buys that are news, and what to remember of them (settings.game.dealsNotified, kept across
 * restarts). The rule ("When that deal is gone"):
 * - an item announced is remembered with its price and when it was announced
 *   (`slug|rank@price@at`);
 * - it is forgotten once it isn't on the Cheap buys list (`deals`: the last scan's finds and what
 *   the live feed caught since): a later deal on it is news again. Nothing is forgotten before the
 *   first scan this run (`scanned`), nor an item whose order book the last scan meant to read and
 *   couldn't (`unread`): of those the list says nothing;
 * - while it stays on the list, a lower price than the one announced is news, another seller at
 *   the same price or dearer isn't;
 * - either way, never within DEAL_AGAIN_MS (an hour) of the item's last announcement, counted from
 *   the time kept with it, so a restart doesn't shorten it. A deal held back by the hour is news
 *   at the first scan past it, if it's still listed.
 * Entries an earlier version kept (`slug|rank@price`) count as announced long ago at that price.
 */
export function dealNews<D extends DealSeen>(deals: D[], unread: readonly string[], notified: string[], now: number, scanned: boolean): { fresh: D[]; notified: string[] } {
  const said = (d: DealSeen) => `${d.slug}|${d.rank ?? ""}`;
  const listed = new Set(deals.map(said));
  const unknown = new Set(unread);
  // What's remembered of each item: the price announced (null once forgotten) and when.
  const memo = new Map<string, { price: number | null; at: number }>();
  for (const k of notified) {
    const [item, price, at] = k.split("@");
    if (!item || memo.has(item)) continue;
    const p = price ? +price : NaN;
    memo.set(item, { price: Number.isFinite(p) ? p : null, at: at ? +at || 0 : 0 });
  }
  for (const [item, m] of memo) {
    if (scanned && m.price != null && !listed.has(item) && !unknown.has(item.slice(0, item.lastIndexOf("|")))) m.price = null;
  }
  // The cheapest deal per item: one announcement each.
  const best = new Map<string, D>();
  for (const d of deals) {
    const b = best.get(said(d));
    if (!b || d.price < b.price) best.set(said(d), d);
  }
  const fresh = [...best.values()].filter((d) => {
    const m = memo.get(said(d));
    if (!m) return true;
    if (now - m.at < DEAL_AGAIN_MS) return false;
    return m.price == null || d.price < m.price;
  });
  for (const d of fresh) memo.set(said(d), { price: d.price, at: now });
  // Most recent first; a forgotten item is kept only while its hour runs.
  const out = [...memo]
    .filter(([, m]) => m.price != null || now - m.at < DEAL_AGAIN_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .map(([item, m]) => `${item}@${m.price ?? ""}@${m.at}`)
    .slice(0, 300);
  return { fresh: deals.filter((d) => fresh.includes(d)), notified: out };
}

export interface CircuitWeek {
  resets: string;
  frames: { name: string; wanted: boolean }[];
  incarnons: { name: string; wanted: boolean }[];
}

/**
 * The Circuit's wanted picks to announce, and the keys that mark them announced
 * (settings.game.worldNotified): once per week (`resets`) and wanted item. One the wanted list
 * gains mid-week (a weapon bought, the gear read in later) is announced alone; one it loses and
 * gains again isn't announced again. A week an earlier version announced as one list
 * (`circuit|<resets>|A,B`) counts each name in it as announced.
 */
export function circuitNews(c: CircuitWeek, known: readonly string[]): { frames: string[]; incarnons: string[]; keys: string[] } {
  const head = `circuit|${c.resets}|`;
  const said = new Set(known.filter((k) => k.startsWith(head)).flatMap((k) => k.slice(head.length).split(",")));
  const fresh = (xs: { name: string; wanted: boolean }[]) => [...new Set(xs.filter((x) => x.wanted && !said.has(x.name)).map((x) => x.name))];
  const frames = fresh(c.frames);
  const incarnons = fresh(c.incarnons).filter((n) => !frames.includes(n));
  return { frames, incarnons, keys: [...frames, ...incarnons].map((n) => head + n) };
}
