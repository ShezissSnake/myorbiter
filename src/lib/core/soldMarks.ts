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

/** A listing as the trade's-sale question sees it: its id, its item's name, its rank and its subtype (a relic's refinement, a variant). */
export interface SoldListing {
  id: string;
  name: string;
  rank: number | null;
  subtype: string | null;
}

/**
 * The sale a trade's line logs (placeTradeLine's `left` copies, at the platinum each it was paid),
 * with what its marking did: `lowered`, the `marked` copies sold on its listing; `unmarked`, the
 * copies logged but not marked (warframe.market refused, no listing was a sure match, or the
 * listing held fewer), with the listing it tried while that listing still holds them (none when
 * no listing was a sure match, or the marking closed it), and the refinement the line names.
 */
export function tradeLineSale(o: { at: number; name: string; rank: number | null; subtype: string | null; left: number; platinumEach: number; key: string; order: { id: string } | null; marked: number; now: number }): Sale {
  const sale: Sale = { at: o.at, item: o.name, rank: o.rank, quantity: o.left, platinum: o.platinumEach, trade: o.key };
  if (o.order && o.marked > 0) sale.lowered = { listing: o.order.id, count: o.marked, at: o.now };
  const short = o.left - o.marked;
  if (short > 0) sale.unmarked = { listing: o.marked > 0 ? null : (o.order?.id ?? null), count: short, at: o.now, ...(o.subtype ? { subtype: o.subtype } : {}) };
  return sale;
}

/**
 * Whether a trade's copies not marked may be this listing's: only the listing the trade tried,
 * when it is known; else a listing of the refinement the trade's line names, when it names one (a
 * relic's: a listing without one is intact, as listingFor reads it); else any listing of the item.
 */
const mayBe = (u: NonNullable<Sale["unmarked"]>, l: SoldListing) => (u.listing != null ? u.listing === l.id : !u.subtype || (l.subtype ?? "intact") === u.subtype);

/** The sales a trade logged in the last ten minutes without marking them sold that may be this listing's (same item and rank, mayBe), newest first. */
const unmarkedFor = (l: SoldListing, sales: readonly Sale[], now: number) =>
  sales.filter((s) => s.trade != null && s.unmarked && now - s.unmarked.at < SOLD_ASK_MS && sameSaleItem(s, l) && mayBe(s.unmarked, l)).sort((a, b) => b.unmarked!.at - a.unmarked!.at);

/**
 * A Sold click on `listing` soon after a trade logged a sale of it but could not mark it sold:
 * the copies not marked, summed over `trades` trades, and the partner of the latest. `guess`: one
 * of them knows no listing and no refinement, so the question says which listing "that sale"
 * lowers. `busy`: a "that sale" for one of these trades is out already (claimTradeSale). Null
 * when there are none: the click goes ahead. Otherwise it asks first: the sale's notification
 * sends the player to Orders for that very sale, and logging it again would count it twice.
 */
export function soldAfterUnmarked(listing: SoldListing, sales: readonly Sale[], trades: readonly TradeLogEntry[], now: number, out: ReadonlySet<string> = new Set()): { count: number; partner: string | null; trades: number; guess: boolean; busy: boolean } | null {
  const mine = unmarkedFor(listing, sales, now);
  if (!mine.length) return null;
  const keys = new Set(mine.map((s) => s.trade!));
  return {
    count: mine.reduce((n, s) => n + s.unmarked!.count, 0),
    partner: trades.find((t) => t.key === mine[0].trade)?.partner ?? null,
    trades: keys.size,
    guess: mine.some((s) => s.unmarked!.listing == null && !s.unmarked!.subtype),
    busy: [...keys].some((k) => out.has(k)),
  };
}

/**
 * What a Sold click on `listing` asks first, if anything: `marked`, copies a trade's sale marked
 * sold on this listing in the last ten minutes (soldAfterTrade); `unmarked`, copies of a trade's
 * sale that wait, not marked, for this listing (soldAfterUnmarked). Null: neither, and the click
 * goes ahead. With `marked` alone it asks whether one more sold since; with `unmarked` whether the
 * click is that sale. With both, one question with three answers (soldAnswers): that sale (marks
 * the copies that wait, logs nothing), the one already marked (sends nothing), or another (marks
 * and logs). Whichever was sold, an answer is true and logs no sale a trade already logged.
 */
export function soldQuestion(listing: SoldListing, sales: readonly Sale[], trades: readonly TradeLogEntry[], now: number, out: ReadonlySet<string> = new Set()): { marked: { count: number; partner: string | null } | null; unmarked: ReturnType<typeof soldAfterUnmarked> } | null {
  const marked = soldAfterTrade(listing.id, sales, trades, now);
  const unmarked = listing.name ? soldAfterUnmarked(listing, sales, trades, now, out) : null;
  return marked || unmarked ? { marked, unmarked } : null;
}

/**
 * Before "that sale" (or its Try again) is sent: the trades whose copies it marks, added to `out`
 * (the trades with a "that sale" out), and `send`, the copies to send: the fewer of `asked` (what
 * the question showed) and what is still not marked for them now, as an answer from another
 * listing may have marked some since the question opened. `send` 0, with no keys: nothing is
 * waiting any more, and nothing is sent. Null when one of them is out already, from this listing
 * or another: nothing is sent. So two answers never close the same copies twice. The caller takes
 * the keys out of `out` once its call is back.
 */
export function claimTradeSale(listing: SoldListing, sales: readonly Sale[], now: number, out: Set<string>, asked: number): { keys: string[]; send: number } | null {
  const mine = unmarkedFor(listing, sales, now);
  const keys = [...new Set(mine.map((s) => s.trade!))];
  if (keys.some((k) => out.has(k))) return null;
  const send = Math.min(asked, mine.reduce((n, s) => n + s.unmarked!.count, 0));
  if (send < 1) return { keys: [], send: 0 };
  for (const k of keys) out.add(k);
  return { keys, send };
}

/**
 * The row's line once "that sale" is back: `Sold n` when all `asked` went. When fewer went, the
 * rest was marked from another listing or is past the ten minutes. The record can't always tell
 * which (it may still call copies another listing closed unmarked), so the line names both and
 * sends the player to the listing's count, never to Sold.
 */
export function tradeSaleLine(send: number, asked: number): string {
  if (send >= asked) return `Sold ${send}`;
  return `${send ? `${send} marked: the rest of that trade` : "None marked: that trade"} was marked already or is past the ten minutes; check this listing's count.`;
}

/**
 * "That sale" (or its Try again) for `listing`, asked with the `asked` copies the question showed:
 * claims the trades' copies still not marked (claimTradeSale), sets the row's `words` for what is
 * sent, sends nothing when nothing is left, else closes `send` copies with `close` (the store's
 * `sold` for the listing) and records what it closed on the trades' sales (markedForTrade). The
 * claim is given back whatever the call did. Throws when the call fails or another answer for
 * these trades is out. `io.sales` is read when needed, so the record is made on the sales as they
 * are when the call is back.
 */
export async function markTradeSale(
  listing: SoldListing,
  asked: number,
  words: { working: string; done: string },
  io: {
    sales: () => readonly Sale[];
    setSales: (sales: Sale[]) => void;
    out: Set<string>;
    now: () => number;
    close: (n: number, failed: (why: string) => void) => Promise<{ quantity: number } | null>;
    phase?: (working: string) => void;
  },
): Promise<void> {
  // Never more than is still not marked: another listing's answer may have marked some.
  const claim = claimTradeSale(listing, io.sales(), io.now(), io.out, asked);
  if (!claim) throw new Error("already being marked sold from another listing");
  // Set afresh on each try (Try again runs this again): the count sent.
  words.done = tradeSaleLine(claim.send, asked);
  words.working = `Sending ${claim.send} sold…`;
  io.phase?.(words.working);
  // A close call with 0 would close a copy: the store raises any count under 1 to 1.
  if (!claim.send) return;
  try {
    let why = "";
    const sale = await io.close(claim.send, (r) => (why = r));
    if (!sale) throw new Error(why || "warframe.market didn't take it");
    io.setSales(markedForTrade(io.sales(), listing, sale.quantity, io.now()));
  } finally {
    for (const k of claim.keys) io.out.delete(k);
  }
}

/**
 * The copies each answer of that question sends: "that sale" the trades' `count` they could not
 * mark (and logs nothing), "another sale" the click's `n` (and logs it). The focus starts on the
 * one that sends least; on "that sale" when both send as many, as it logs nothing more. `marked`:
 * copies of a trade were also marked sold on this listing in the last ten minutes (soldQuestion),
 * so a third answer, `same`, says the click was that sale: it sends nothing, and the focus starts
 * there.
 */
export const soldAnswers = (n: number, count: number, marked = false) => ({
  that: count,
  another: n,
  same: marked,
  focus: marked ? ("same" as const) : count <= n ? ("that" as const) : ("another" as const),
});

/**
 * "That sale": `sent` copies of `listing` were marked sold for the trades' sales that
 * soldAfterUnmarked counted, newest first. Each records its copies in `lowered` (so a further
 * click asks soldAfterTrade's question) and keeps in `unmarked` only what is still not marked. No
 * sale is added. A sale whose `lowered` names another listing had that listing closed by the
 * marking (it held fewer copies than were sold), so it is replaced.
 */
export function markedForTrade(sales: readonly Sale[], listing: SoldListing, sent: number, now: number): Sale[] {
  const out = [...sales];
  let left = sent;
  for (const s of unmarkedFor(listing, sales, now)) {
    if (left < 1) break;
    const u = s.unmarked!;
    const take = Math.min(left, u.count);
    left -= take;
    const had = s.lowered?.listing === listing.id ? s.lowered.count : 0;
    const next: Sale = { ...s, lowered: { listing: listing.id, count: had + take, at: now } };
    if (take < u.count) next.unmarked = { ...u, count: u.count - take };
    else delete next.unmarked;
    out[out.indexOf(s)] = next;
  }
  return out;
}

/**
 * A sale typed on the Sales page at `at`, of `item`: the trades' sales of the same item and rank
 * from the ten minutes before (their copies, summed over `trades` trades, and the partner of the
 * latest). Stats counts such a trade by its own sale, so the typed one would be a second; the page
 * says so before it adds it. Null when there are none.
 */
export function tradeSaleNear(sales: readonly Sale[], trades: readonly TradeLogEntry[], item: { name: string; rank: number | null }, at: number): { count: number; partner: string | null; trades: number } | null {
  const mine = sales.filter((s) => s.trade != null && at - s.at >= 0 && at - s.at < SOLD_ASK_MS && sameSaleItem(s, item)).sort((a, b) => b.at - a.at);
  if (!mine.length) return null;
  const partner = trades.find((t) => t.key === mine[0].trade)?.partner ?? null;
  return { count: mine.reduce((n, s) => n + s.quantity, 0), partner, trades: new Set(mine.map((s) => s.trade)).size };
}

/**
 * The Sales page's Add, a second time for the same sale after it named a trade: the second,
 * explicit press only when it comes at least `SECOND_PRESS_MS` after the first (a double press or
 * double-click is one), with the same fields.
 */
export const SECOND_PRESS_MS = 600;
export const secondPress = (asked: { key: string; at: number } | null, key: string, now: number) => !!asked && asked.key === key && now - asked.at >= SECOND_PRESS_MS;
