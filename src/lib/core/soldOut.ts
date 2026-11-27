// A Sold from Orders while it is being sent to warframe.market. Orders writes a record in the
// settings as the send goes out and takes it away when warframe.market answers, in the same turn
// as the sale goes into the sales log (no save can come between them). Two kinds of record are
// left for the next start:
// - one still out when MyOrbiter went (quit, the window closed, a reload, an update's install or
//   restart, a crash): the sale may or may not have gone through;
// - one that failed while MyOrbiter was leaving (`answer`, `why`): the row that would have said
//   so, with Try again, is gone with the window. What is said depends on what is known
//   (`soldFailure`): warframe.market answered with a refusal; it wasn't sent; the listing was
//   already gone; or the answer didn't come or couldn't be read, which says no more than "maybe".
// The player is told once at the next start, with when the Sold was sent, and nothing is sent
// again by itself. If the window stays after all (an update that stopped: no longer on offer, the
// save before the install, the install or the restart failed), a failure kept is let go
// (`soldStayed`): its row shows it.
import { deferredUntil } from "./marketWait";

export interface SoldOut {
  /** Tells this send from another of the same listing (a Try again). */
  key: string;
  /** The listing's id on warframe.market. */
  id: string;
  item: string;
  rank: number | null;
  /** Copies being marked sold. */
  quantity: number;
  /** Each, as listed. */
  platinum: number;
  /** When the send went out (unix ms). */
  at: number;
  /** "That sale" for a trade from the game: the trade logged the sale already. */
  trade?: true;
  /** What became of it while MyOrbiter was leaving (soldFailure); none: no answer yet. */
  answer?: SoldFailure;
  /** The reason that came with it, as said. */
  why?: string;
}

/**
 * What a Sold's failure says is known:
 * - "refused": warframe.market answered no (a 4xx HTTP status, or its refusal of the sign-in);
 * - "unsent": MyOrbiter didn't send it, or warframe.market had asked to wait (not signed in, the
 *   sign-in couldn't be kept, a wait asked for, an id or count MyOrbiter itself turned down);
 * - "gone": nothing was sent, the listing was already gone from your listings (marketStore's sold);
 * - "unclear": anything else (unreachable, a 5xx server or gateway error, an answer that couldn't
 *   be read, words not known here): it may or may not have gone through.
 */
export type SoldFailure = "refused" | "unsent" | "gone" | "unclear";
const FAILURES: SoldFailure[] = ["refused", "unsent", "gone", "unclear"];

/** marketStore's reason when the listing is gone before anything was sent. */
export const NO_LONGER_LISTED = "it's no longer listed (already sold or removed)";

/**
 * The kind of a failure from its words: the Rust side's MarketError reaches the page as text
 * (src-tauri/src/market.rs, `Display`). Only words known to come from an answer say "refused";
 * anything not known says no more than "unclear".
 */
export function soldFailure(why: string): SoldFailure {
  const w = why.replace(/^Error:\s*/, "").trim();
  if (w === NO_LONGER_LISTED) return "gone";
  // Rejected after an answer carries its HTTP status first; the ones without are MyOrbiter's own checks, before sending.
  // A 4xx is a refusal; a 5xx (a server or gateway error) may come after the change was made.
  if (/^warframe\.market rejected the request: 5\d\d\b/.test(w)) return "unclear";
  if (/^warframe\.market rejected the request: 4\d\d\b/.test(w) || /^warframe\.market refused the sign-in\b/.test(w)) return "refused";
  if (/^warframe\.market rejected the request: /.test(w) || /^warframe\.market asked us to wait until\b/.test(w) || /^Not signed in to warframe\.market\b/.test(w) || /^couldn't keep the warframe\.market sign-in\b/.test(w)) return "unsent";
  return "unclear";
}

/** Records kept at the most: one per send out at a time, so a handful at most in practice. */
export const SOLD_OUT_MAX = 50;

const fine = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Settings' list as saved: records of the right shape only. */
export function soldOutOf(raw: unknown): SoldOut[] {
  if (!Array.isArray(raw)) return [];
  const out: SoldOut[] = [];
  for (const x of raw as Partial<SoldOut>[]) {
    if (!x || typeof x !== "object" || typeof x.key !== "string" || typeof x.id !== "string" || typeof x.item !== "string" || !x.item) continue;
    if (!fine(x.quantity) || !Number.isInteger(x.quantity) || x.quantity < 1 || !fine(x.platinum) || x.platinum < 0 || !fine(x.at)) continue;
    const rank = fine(x.rank) ? x.rank : null;
    const why = typeof x.why === "string" && x.why.trim() ? x.why.slice(0, 300) : undefined;
    // A reason without a known kind says no more than "unclear".
    const answer = FAILURES.includes(x.answer as SoldFailure) ? x.answer : why ? "unclear" : undefined;
    out.push({ key: x.key.slice(0, 100), id: x.id.slice(0, 100), item: x.item.slice(0, 200), rank, quantity: x.quantity, platinum: x.platinum, at: x.at, ...(x.trade === true ? { trade: true as const } : {}), ...(answer ? { answer } : {}), ...(why ? { why } : {}) });
    if (out.length >= SOLD_OUT_MAX) break;
  }
  return out;
}

/** The list with a record for a send going out. */
export const withSoldOut = (list: SoldOut[], r: SoldOut): SoldOut[] => [r, ...list.filter((x) => x.key !== r.key)].slice(0, SOLD_OUT_MAX);

/**
 * The list once that send is answered: its record taken away, or, when it failed while MyOrbiter
 * was leaving (`leaving`), kept with what is known of it (soldFailure) for the next start. A
 * failure while MyOrbiter stays is said on its row, with Try again: no record.
 */
export function soldAnswered(list: SoldOut[], key: string, answer: { ok: boolean; why: string; leaving: boolean }): SoldOut[] {
  if (answer.ok) {
    // Marked sold: a failure kept earlier for the same listing (a Try again since, the window
    // still open) is no longer worth telling, when this Sold was of at least as many copies. A
    // smaller one leaves the copies the failure was about unmarked: it is still told.
    const r = list.find((x) => x.key === key);
    return list.filter((x) => x.key !== key && !(r && x.answer && x.id === r.id && x.quantity <= r.quantity));
  }
  if (!answer.leaving) return list.filter((x) => x.key !== key);
  const why = answer.why.trim().slice(0, 300);
  return list.map((x) => (x.key === key ? { ...x, answer: why ? soldFailure(why) : "unclear", ...(why ? { why } : {}) } : x));
}

/**
 * The list once the window stays after all (backend.ts › stayed: an update that stopped, the save
 * before the install, the install or the restart failed): a failure kept while MyOrbiter was
 * leaving is on its row, with Try again, so it isn't told again at the next start. A send still
 * out keeps its record.
 */
export const soldStayed = (list: SoldOut[]): SoldOut[] => list.filter((x) => !x.answer);

/** When the Sold was sent, for a record told maybe days later: "at 14:05" today, "on Tue 24 Nov at 14:05" another day. */
export function sentWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? `at ${time}` : `on ${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}

/**
 * What the player is told at the next start about a send MyOrbiter didn't see through, and the
 * log line, which says the same. Never more than is known: "not marked sold" only when it is
 * known not to have gone through, "warframe.market refused" only when it answered so.
 */
export function soldOutNotice(r: SoldOut, now = Date.now()): { title: string; body: string; line: string } {
  const name = `${r.item}${r.rank != null ? ` R${r.rank}` : ""}`;
  const what = `${r.quantity} sold on warframe.market (${r.platinum}p each)`;
  const when = sentWhen(r.at, now);
  const log = r.trade ? "The trade from the game logged its sale already." : "No sale was logged.";
  // A wait asked for is said as the clock shows it ("until 14:05"), not as the Rust side's milliseconds.
  const until = r.why ? deferredUntil(r.why) : null;
  const why = (r.why ?? "").replace(/\b\d{12,14}\b/, (m) => (until != null && Number(m) === until ? new Date(until).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : m)).replace(/[.\s]+$/, "");
  let title: string, body: string;
  if (r.answer === "refused") {
    title = `${name}: not marked sold`;
    body = `warframe.market refused to mark ${what}, sent ${when} while MyOrbiter was closing: ${why}. ${log} Nothing was sent again: if it sold, mark it sold on Orders.`;
  } else if (r.answer === "unsent") {
    title = `${name}: not marked sold`;
    body = `The Sold of ${r.quantity} on warframe.market (${r.platinum}p each) ${when}, while MyOrbiter was closing, didn't go through: ${why}. ${log} Nothing was sent again: if it sold, mark it sold on Orders.`;
  } else if (r.answer === "gone") {
    title = `${name}: nothing sent`;
    body = `The Sold of ${r.quantity} (${r.platinum}p each) ${when}, while MyOrbiter was closing, wasn't sent: the listing was already gone from your listings (sold or removed). ${log} Nothing was sent again: look at the listing on Orders and at Sales.`;
  } else {
    title = `${name}: maybe not marked sold`;
    const marking = `MyOrbiter closed while it was marking ${what}, sent ${when}`;
    // Said as it happened: an answer that came is never said not to have come, and a server's
    // error is said without the words of a refusal.
    const w = (r.why ?? "").replace(/^Error:\s*/, "").trim();
    const server = /^warframe\.market rejected the request: (5\d\d)\b/.exec(w);
    const unread = /^warframe\.market answered with something MyOrbiter couldn't read\b:?\s*(.*)$/s.exec(w);
    const detail = unread ? unread[1].replace(/[.\s]+$/, "") : "";
    const how =
      r.answer !== "unclear"
        ? `${marking}, before warframe.market answered.`
        : server
          ? `${marking}, and warframe.market answered with a server error (${server[1]}), which doesn't say whether the sale was marked.`
          : unread
            ? `${marking}, and warframe.market answered, but MyOrbiter couldn't read the answer${detail ? ` (${detail})` : ""}.`
            : /^warframe\.market is unreachable\b/.test(w)
              ? `${marking}, and warframe.market's answer didn't come through, or not in full (${why}).`
              : `${marking}, and what warframe.market made of it isn't known${why ? ` (${why})` : ""}.`;
    body = `${how} It may or may not have gone through. ${log} Nothing was sent again: look at the listing on Orders before marking it sold again.`;
  }
  return { title, body, line: `${title}: ${body}` };
}
