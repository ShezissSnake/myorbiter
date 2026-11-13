// Sales from warframe.market's side: every order you closed there (marked sold on the site, by
// Auto-match, or by MyOrbiter after a trade) is in your profile's statistics. Importing them fills
// in sales from before MyOrbiter logged them, and ones you marked sold on the website.
import type { Sale } from "../backend";
import { saleName } from "./sameSale";

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
 * actually got. A part's closed order with no sale of that part is matched to a set sale of the
 * same trade time (within six hours) that the part is in (`setParts`): the parts were listed one
 * by one and sold together in one trade, which MyOrbiter logs as the set (foldSetSales). Its id
 * goes in the set sale's `wfmParts`. Returns the new log (newest first) and how many were added
 * and matched.
 */
export function importClosed(sales: Sale[], closed: ClosedOrder[], setParts: (set: string) => { name: string; required: number }[] | null = () => null): { sales: Sale[]; added: number; matched: number } {
  const out = sales.map((s) => ({ ...s, ...(s.wfmParts ? { wfmParts: [...s.wfmParts] } : {}) }));
  const known = new Set(out.flatMap((s) => [...(s.wfm ? [s.wfm] : []), ...(s.wfmParts ?? [])]));
  // Copies of each part a set sale can still take, by sale and part name (saleName).
  const byId = new Map(closed.map((c) => [c.id, c]));
  const room = new Map<Sale, Map<string, number>>();
  const roomOf = (s: Sale) => {
    let r = room.get(s);
    if (!r) {
      r = new Map();
      for (const p of setParts(s.item) ?? []) r.set(saleName(p.name), (r.get(saleName(p.name)) ?? 0) + p.required * s.quantity);
      // Parts matched by an earlier import: each takes its own part's room, by the closed order's
      // name (the profile lists every closed order each time). One no longer listed takes room
      // from any part, so it can't make room for an order to be matched twice.
      let taken = 0;
      for (const id of s.wfmParts ?? []) {
        const c = byId.get(id);
        const k = c ? saleName(c.name) : null;
        if (k != null && r.has(k)) r.set(k, Math.max(0, r.get(k)! - Math.max(1, c!.quantity)));
        else taken++;
      }
      for (const [k, n] of r) {
        const t = Math.min(n, taken);
        r.set(k, n - t);
        taken -= t;
      }
      room.set(s, r);
    }
    return r;
  };
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
      const name = saleName(c.name);
      const set = same || exact || c.rank != null ? null : out
        .filter((s) => !s.wfm && / set$/i.test(s.item) && Math.abs(s.at - at) < SAME_SALE_MS && (roomOf(s).get(name) ?? 0) >= Math.max(1, c.quantity))
        .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      if (same) {
        same.wfm = c.id;
        matched++;
      } else if (exact) left.push(f);
      else if (set) {
        roomOf(set).set(name, roomOf(set).get(name)! - Math.max(1, c.quantity));
        set.wfmParts = [...(set.wfmParts ?? []), c.id];
        matched++;
      } else {
        out.push({ at, item: c.name, rank: c.rank, quantity: Math.max(1, c.quantity), platinum: Math.round(c.platinum), wfm: c.id });
        added++;
      }
    }
  }
  out.sort((a, b) => b.at - a.at);
  return { sales: out, added, matched };
}
