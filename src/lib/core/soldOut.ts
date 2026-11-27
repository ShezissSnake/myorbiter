// A Sold from Orders while it is being sent to warframe.market. Orders writes a record in the
// settings as the send goes out and takes it away when warframe.market answers, in the same step
// as the sale goes into the sales log. A record found at the next start means MyOrbiter went
// (quit, the window closed, a reload, a crash) before the answer: the player is told once, and
// nothing is sent again by itself, since the sale may have gone through.

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
    out.push({ key: x.key.slice(0, 100), id: x.id.slice(0, 100), item: x.item.slice(0, 200), rank, quantity: x.quantity, platinum: x.platinum, at: x.at });
    if (out.length >= SOLD_OUT_MAX) break;
  }
  return out;
}

/** The list with a record for a send going out. */
export const withSoldOut = (list: SoldOut[], r: SoldOut): SoldOut[] => [r, ...list.filter((x) => x.key !== r.key)].slice(0, SOLD_OUT_MAX);

/** The list without that send's record (it was answered). */
export const withoutSoldOut = (list: SoldOut[], key: string): SoldOut[] => list.filter((x) => x.key !== key);

/** What the player is told at the next start about a send MyOrbiter didn't see answered. */
export function soldOutNotice(r: SoldOut): { title: string; body: string } {
  const name = `${r.item}${r.rank != null ? ` R${r.rank}` : ""}`;
  return {
    title: `${name}: maybe not marked sold`,
    body:
      `MyOrbiter closed while it was marking ${r.quantity} sold on warframe.market (${r.platinum}p each), before warframe.market answered. ` +
      `It may or may not have gone through, and no sale was logged. Nothing was sent again: look at the listing on Orders before marking it sold again.`,
  };
}
