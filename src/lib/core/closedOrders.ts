// Sales from warframe.market's side: every order you closed there (marked sold on the site, by
// Auto-match, or by orbiter after a trade) is in your profile's statistics. Importing them fills
// in sales from before orbiter logged them, and ones you marked sold on the website.
import type { Sale } from "../backend";

/** One closed order, as src-tauri/src/market.rs `ClosedOrder` reads it. */
export interface ClosedOrder {
  id: string;
  kind: string;
  slug: string;
  name: string;
  rank: number | null;
  quantity: number;
  platinum: number;
  closedAt: string;
}

/** A sale logged within this long of a closed order of the same item is that order. */
const SAME_SALE_MS = 6 * 3_600_000;

/**
 * Your closed sell orders that the sale log doesn't have yet. A sale already logged for the same
 * item (and rank) within six hours is the same sale (one of the same quantity first, then the
 * nearest): it gets the order's id, so it's never imported twice, and keeps the platinum you
 * actually got. Returns the new log (newest first) and
 * how many were added and matched.
 */
export function importClosed(sales: Sale[], closed: ClosedOrder[]): { sales: Sale[]; added: number; matched: number } {
  const out = sales.map((s) => ({ ...s }));
  const known = new Set(out.flatMap((s) => (s.wfm ? [s.wfm] : [])));
  const fresh: { c: ClosedOrder; at: number }[] = [];
  for (const c of closed) {
    if (c.kind !== "sell" || known.has(c.id)) continue;
    const at = Date.parse(c.closedAt);
    if (!Number.isFinite(at) || !c.name) continue;
    known.add(c.id);
    fresh.push({ c, at });
  }
  let added = 0;
  let matched = 0;
  // Two passes: orders that match a logged sale of the same quantity take theirs first, so a sale
  // of 1 logged after a trade isn't taken by 2 marked sold on the website the same day. Then the
  // rest, by the nearest logged sale left.
  const left: { c: ClosedOrder; at: number }[] = [];
  for (const exact of [true, false]) {
    for (const f of exact ? fresh : left) {
      const { c, at } = f;
      const same = out
        .filter((s) => !s.wfm && s.item.toLowerCase() === c.name.toLowerCase() && (c.rank == null || s.rank == null || s.rank === c.rank) && Math.abs(s.at - at) < SAME_SALE_MS && (!exact || s.quantity === Math.max(1, c.quantity)))
        .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      if (same) {
        same.wfm = c.id;
        matched++;
      } else if (exact) left.push(f);
      else {
        out.push({ at, item: c.name, rank: c.rank, quantity: Math.max(1, c.quantity), platinum: Math.round(c.platinum), wfm: c.id });
        added++;
      }
    }
  }
  out.sort((a, b) => b.at - a.at);
  return { sales: out, added, matched };
}
