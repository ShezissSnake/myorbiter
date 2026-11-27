// A Sold from Orders while it is being sent to warframe.market. Orders writes a record in the
// settings as the send goes out and takes it away when warframe.market answers, in the same step
// as the sale goes into the sales log. Two kinds of record are left for the next start:
// - one still out when MyOrbiter went (quit, the window closed, a reload, a crash): the sale may or
//   may not have gone through;
// - one warframe.market refused while MyOrbiter was leaving (`why`): the row that would have said
//   so, with Try again, is gone with the window.
// The player is told once at the next start, and nothing is sent again by itself.

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
  /** warframe.market refused it while MyOrbiter was leaving: why. */
  why?: string;
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
    out.push({ key: x.key.slice(0, 100), id: x.id.slice(0, 100), item: x.item.slice(0, 200), rank, quantity: x.quantity, platinum: x.platinum, at: x.at, ...(x.trade === true ? { trade: true as const } : {}), ...(why ? { why } : {}) });
    if (out.length >= SOLD_OUT_MAX) break;
  }
  return out;
}

/** The list with a record for a send going out. */
export const withSoldOut = (list: SoldOut[], r: SoldOut): SoldOut[] => [r, ...list.filter((x) => x.key !== r.key)].slice(0, SOLD_OUT_MAX);

/**
 * The list once that send is answered: its record taken away, or, when warframe.market refused it
 * while MyOrbiter was leaving (`leaving`), kept with the reason for the next start.
 */
export function soldAnswered(list: SoldOut[], key: string, answer: { ok: boolean; why: string; leaving: boolean }): SoldOut[] {
  if (answer.ok || !answer.leaving) return list.filter((x) => x.key !== key);
  return list.map((x) => (x.key === key ? { ...x, why: (answer.why || "warframe.market didn't take it").slice(0, 300) } : x));
}

/** What the player is told at the next start about a send MyOrbiter didn't see through. */
export function soldOutNotice(r: SoldOut): { title: string; body: string } {
  const name = `${r.item}${r.rank != null ? ` R${r.rank}` : ""}`;
  const what = `${r.quantity} sold on warframe.market (${r.platinum}p each)`;
  const log = r.trade ? "The trade from the game logged its sale already." : "No sale was logged.";
  if (r.why) {
    return {
      title: `${name}: not marked sold`,
      body: `warframe.market refused to mark ${what} while MyOrbiter was closing: ${r.why.replace(/[.\s]+$/, "")}. ${log} Nothing was sent again: if it sold, mark it sold on Orders.`,
    };
  }
  return {
    title: `${name}: maybe not marked sold`,
    body: `MyOrbiter closed while it was marking ${what}, before warframe.market answered. It may or may not have gone through. ${log} Nothing was sent again: look at the listing on Orders before marking it sold again.`,
  };
}
