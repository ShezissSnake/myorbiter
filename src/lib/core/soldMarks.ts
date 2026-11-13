// A Sold click on Orders and the marking of sales from the game's trades lower the same listings:
// what a click sends, and when it asks first because a trade lowered that listing just before.
import type { Sale, TradeLogEntry } from "../backend";

/** How long after a trade lowered a listing a Sold click on it asks first. */
export const SOLD_ASK_MS = 10 * 60_000;

/**
 * What a Sold click of `n` sends once its undo wait is over: the copies that left the listing
 * meanwhile (`quantityAtClick` to `quantityNow`: a trade's marking got there first) are taken off,
 * and never more than is listed. 0: nothing to send.
 */
export function copiesToSend(n: number, quantityAtClick: number, quantityNow: number): number {
  const already = Math.max(0, quantityAtClick - quantityNow);
  return n - already < 1 ? 0 : Math.min(n - already, quantityNow);
}

/**
 * What trades lowered this listing in the last ten minutes (the sales they logged say so in
 * `lowered`): the copies, and the partner of the latest. Null when none did: a Sold click goes
 * ahead. Otherwise it asks first, since the click may be the same sale.
 */
export function soldAfterTrade(listing: string, sales: readonly Sale[], trades: readonly TradeLogEntry[], now: number): { count: number; partner: string | null } | null {
  let count = 0;
  let latest: Sale | null = null;
  for (const s of sales) {
    const l = s.lowered;
    if (!l || l.listing !== listing || now - l.at >= SOLD_ASK_MS) continue;
    count += l.count;
    if (!latest || l.at > latest.lowered!.at) latest = s;
  }
  if (!latest) return null;
  const partner = trades.find((t) => t.key === latest!.trade)?.partner ?? null;
  return { count, partner };
}
