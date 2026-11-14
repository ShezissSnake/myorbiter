// The sale and trade logs as a settings file holds them, read back whole: an entry that isn't one
// (a damaged or hand-edited file) is left out, so Sales, Stats and their exports never meet half a
// sale. A good entry comes back as it was saved.
import type { Sale, TradeLogEntry } from "../backend";

const fine = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const rankOf = (r: unknown) => (r == null ? null : Number.isInteger(r) && (r as number) >= 0 ? (r as number) : undefined);

/** Logged sales: a time, an item, a whole quantity of at least 1 and a price. */
export function salesOf(raw: unknown): Sale[] {
  if (!Array.isArray(raw)) return [];
  const out: Sale[] = [];
  for (const x of raw) {
    if (!obj(x) || !fine(x.at) || typeof x.item !== "string" || !x.item || !Number.isInteger(x.quantity) || (x.quantity as number) < 1 || !fine(x.platinum) || x.platinum < 0) continue;
    const rank = rankOf(x.rank);
    if (rank === undefined) continue;
    const s: Sale = { ...(x as unknown as Sale), rank };
    if (s.median !== undefined && !fine(s.median)) delete s.median;
    if (s.trade !== undefined && typeof s.trade !== "string") delete s.trade;
    if (s.wfm !== undefined && typeof s.wfm !== "string") delete s.wfm;
    // Fields newer records carry; an older record has neither and loads as it was.
    if (s.wfmParts !== undefined) {
      const ids = Array.isArray(s.wfmParts) ? s.wfmParts.filter((id): id is string => typeof id === "string") : [];
      if (ids.length) s.wfmParts = ids;
      else delete s.wfmParts;
    }
    const l = s.lowered as unknown;
    if (l !== undefined && !(obj(l) && typeof l.listing === "string" && Number.isInteger(l.count) && (l.count as number) >= 1 && fine(l.at))) delete s.lowered;
    const u = s.unmarked as unknown;
    if (u !== undefined && !(obj(u) && (u.listing === null || typeof u.listing === "string") && Number.isInteger(u.count) && (u.count as number) >= 1 && fine(u.at))) delete s.unmarked;
    out.push(s);
  }
  return out;
}

const tradeItems = (xs: unknown) =>
  Array.isArray(xs) && xs.every((i) => obj(i) && typeof i.name === "string" && Number.isInteger(i.count) && (i.count as number) >= 1 && rankOf(i.rank) !== undefined) ? (xs as TradeLogEntry["offered"]) : null;

/** Logged trades: a key, a time, a partner, the items each way and the platinum each way. */
export function tradesOf(raw: unknown): TradeLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TradeLogEntry[] = [];
  for (const x of raw) {
    if (!obj(x) || typeof x.key !== "string" || !fine(x.at) || typeof x.partner !== "string" || !fine(x.platIn) || !fine(x.platOut)) continue;
    const offered = tradeItems(x.offered);
    const received = tradeItems(x.received);
    if (!offered || !received) continue;
    out.push({ ...(x as unknown as TradeLogEntry), offered, received });
  }
  return out;
}
