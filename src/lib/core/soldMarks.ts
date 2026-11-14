// A Sold click on Orders and the marking of sales from the game's trades lower the same listings:
// what a click sends, and when it asks first because a trade lowered that listing just before.
import type { Sale, TradeLogEntry } from "../backend";
import { sameSaleItem } from "./sameSale";

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

/** The sales a trade logged of this item and rank in the last ten minutes without marking them sold (`unmarked`), newest first. */
const unmarkedOf = (item: { name: string; rank: number | null }, sales: readonly Sale[], now: number) =>
  sales.filter((s) => s.trade != null && s.unmarked && now - s.unmarked.at < SOLD_ASK_MS && sameSaleItem(s, item)).sort((a, b) => b.unmarked!.at - a.unmarked!.at);

/**
 * A Sold click on a listing of `item` (its name and rank) soon after a trade logged a sale of the
 * same item and rank but could not mark it sold (no sure listing, warframe.market refused, or the
 * listing had fewer copies): those copies, and the partner of the latest trade. Null when there
 * are none: the click goes ahead. Otherwise it asks first: the sale's notification sends the
 * player to Orders for that very sale, and logging it again would count it twice.
 */
export function soldAfterUnmarked(item: { name: string; rank: number | null }, sales: readonly Sale[], trades: readonly TradeLogEntry[], now: number): { count: number; partner: string | null } | null {
  const mine = unmarkedOf(item, sales, now);
  if (!mine.length) return null;
  const partner = trades.find((t) => t.key === mine[0].trade)?.partner ?? null;
  return { count: mine.reduce((n, s) => n + s.unmarked!.count, 0), partner };
}

/**
 * The copies each answer of that question sends: "that sale" the trades' `count` they could not
 * mark (and logs nothing), "another sale" the click's `n` (and logs it). The focus starts on the
 * one that sends least; on "that sale" when both send as many, as it logs nothing more.
 */
export const soldAnswers = (n: number, count: number) => ({ that: count, another: n, focus: count <= n ? ("that" as const) : ("another" as const) });

/**
 * "That sale": `sent` copies of `listing` were marked sold for the trades' sales of `item` that
 * soldAfterUnmarked counted, newest first. Each records its copies in `lowered` (so a further
 * click asks soldAfterTrade's question) and keeps in `unmarked` only what is still not marked. No
 * sale is added. A sale whose `lowered` names another listing had that listing closed by the
 * marking (it held fewer copies than were sold), so it is replaced.
 */
export function markedForTrade(sales: readonly Sale[], item: { name: string; rank: number | null }, listing: string, sent: number, now: number): Sale[] {
  const out = [...sales];
  let left = sent;
  for (const s of unmarkedOf(item, sales, now)) {
    if (left < 1) break;
    const u = s.unmarked!;
    const take = Math.min(left, u.count);
    left -= take;
    const had = s.lowered?.listing === listing ? s.lowered.count : 0;
    const next: Sale = { ...s, lowered: { listing, count: had + take, at: now } };
    if (take < u.count) next.unmarked = { ...u, count: u.count - take };
    else delete next.unmarked;
    out[out.indexOf(s)] = next;
  }
  return out;
}

/**
 * A sale typed on the Sales page at `at`, of `item`: the trades' sales of the same item and rank
 * from the ten minutes before (their copies, and the partner of the latest). Stats counts such a
 * trade by its own sale, so the typed one would be a second; the page says so before it adds it.
 * Null when there are none.
 */
export function tradeSaleNear(sales: readonly Sale[], trades: readonly TradeLogEntry[], item: { name: string; rank: number | null }, at: number): { count: number; partner: string | null } | null {
  const mine = sales.filter((s) => s.trade != null && at - s.at >= 0 && at - s.at < SOLD_ASK_MS && sameSaleItem(s, item)).sort((a, b) => b.at - a.at);
  if (!mine.length) return null;
  const partner = trades.find((t) => t.key === mine[0].trade)?.partner ?? null;
  return { count: mine.reduce((n, s) => n + s.quantity, 0), partner };
}
