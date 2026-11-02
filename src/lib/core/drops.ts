// Drops: the parts that turned up in your inventory between two reads, whatever they came from:
// relic rewards, mission and bounty drops (a Lato Vandal part), anything. Each inventory read is
// compared with the one before; a part you hold more of now is a gain. What came in a trade isn't
// a drop, and the trade log can arrive after the read that saw the copy, so trades are taken off
// when the totals are worked out rather than when a read is recorded.
//
// Tracked: prime parts, and the blueprint parts of other gear (the sets warframe.market trades
// whole: Lato Vandal, Mandonel…).

import { baseId, heldCount, type Model } from "./model";

/** What one read added over the read before it, by part name. */
export interface DropWindow {
  /** The read before (Unix ms). */
  from: number;
  /** This read (Unix ms). */
  at: number;
  gains: Record<string, number>;
}

export interface DropLog {
  /** The last read taken in. */
  at: number;
  /** What you held of each tracked part then. */
  counts: Record<string, number>;
  /** Reads that added something, oldest first. */
  windows: DropWindow[];
  /** A read with under half the parts was skipped; a second one in a row is believed (you sold or traded in a lot). */
  low?: boolean;
  /** Parts a read showed none of, kept at their last count until a second read agrees (one read missing a whole category isn't a sale). */
  gone?: string[];
}

export const emptyDropLog = (): DropLog => ({ at: 0, counts: {}, windows: [] });

/** Gains older than this are dropped from the log. */
export const KEEP_DAYS = 90;
/** The window the totals cover by default. */
export const RECENT_DAYS = 30;
const DAY = 86_400_000;

/** The non-prime parts tracked: every recipe part of a catalog item, by path, named as gearSetParts names them. */
const gearMemo = new WeakMap<Model, Map<string, string>>();
function gearParts(m: Model): Map<string, string> {
  let out = gearMemo.get(m);
  if (out) return out;
  out = new Map();
  gearMemo.set(m, out);
  for (const item of m.catalogByUnique.values()) {
    if (m.partsByParent.has(item.uniqueName)) continue;
    for (const c of item.components ?? []) {
      if (!c.uniqueName.includes("/Recipes/")) continue;
      const u = baseId(c.uniqueName);
      if (!out.has(u)) out.set(u, c.name.startsWith(item.name) ? c.name : `${item.name} ${c.name}`);
    }
  }
  return out;
}

/** What you hold of every tracked part, by name; parts you hold none of are left out. */
export function dropCounts(m: Model): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, n] of m.ownedPartQty) if (n > 0) out[name] = n;
  for (const [u, name] of gearParts(m)) {
    const n = heldCount(m, u);
    if (n > 0) out[name] = (out[name] ?? 0) + n;
  }
  return out;
}

const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

const same = (a: Record<string, number>, b: Record<string, number>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/**
 * Takes in an inventory read. The first one holding anything sets the baseline. Partial reads don't
 * become drops: a read showing under half the parts the last one did is skipped, unless the next
 * one agrees (then it's the new baseline, with nothing counted); a part a read shows none of keeps
 * its last count until the next read agrees. Null when nothing changes (an older or the same read).
 */
export function recordRead(log: DropLog, counts: Record<string, number>, at: number, now = at): DropLog | null {
  if (at <= log.at) return null;
  const sum = total(counts);
  if (!log.at) return sum > 0 ? { at, counts, windows: [] } : null;
  const before = total(log.counts);
  if (sum < before / 2) return log.low ? { at, counts, windows: log.windows } : { ...log, low: true };
  // A part that's gone: kept at its last count for one read.
  const base: Record<string, number> = { ...counts };
  const gone: string[] = [];
  for (const [name, n] of Object.entries(log.counts)) {
    if (name in counts || log.gone?.includes(name)) continue;
    base[name] = n;
    gone.push(name);
  }
  const gains: Record<string, number> = {};
  for (const [name, n] of Object.entries(counts)) {
    const more = n - (log.counts[name] ?? 0);
    if (more > 0) gains[name] = more;
  }
  const kept = log.windows.filter((w) => w.at >= now - KEEP_DAYS * DAY);
  const any = Object.keys(gains).length > 0;
  // Nothing new and nothing to forget: no need to save the log again.
  if (!any && kept.length === log.windows.length && !log.low && !gone.length && !log.gone?.length && same(base, log.counts)) return null;
  const next: DropLog = { at, counts: base, windows: any ? [...kept, { from: log.at, at, gains }] : kept };
  if (gone.length) next.gone = gone;
  return next;
}

/** A trade, as far as the totals need it: when, and what came in. */
export interface ReceivedTrade {
  at: number;
  received: { name: string; count: number }[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+blueprint$/, "").replace(/\s+/g, " ").trim();

/**
 * What you got of each part since `since` (Unix ms), from anything but a trade: each read's gains,
 * less what trades between that read and the one before brought in.
 */
export function dropTotals(log: DropLog, trades: ReceivedTrade[], since: number): Map<string, number> {
  const out = new Map<string, number>();
  const windows = log.windows.filter((w) => w.at >= since);
  if (!windows.length) return out;
  // Trade names are the game's ("Rhino Prime Neuroptics"); the log's may end in "Blueprint".
  const names = new Map<string, string>();
  for (const w of windows) for (const n of Object.keys(w.gains)) names.set(norm(n), n);
  const traded = new Map<DropWindow, Map<string, number>>();
  for (const t of trades) {
    const w = windows.find((x) => t.at > x.from && t.at <= x.at);
    if (!w) continue;
    const map = traded.get(w) ?? new Map<string, number>();
    traded.set(w, map);
    for (const r of t.received) {
      const n = names.get(norm(r.name));
      if (n) map.set(n, (map.get(n) ?? 0) + r.count);
    }
  }
  for (const w of windows) {
    const less = traded.get(w);
    for (const [n, g] of Object.entries(w.gains)) {
      const got = g - (less?.get(n) ?? 0);
      if (got > 0) out.set(n, (out.get(n) ?? 0) + got);
    }
  }
  return out;
}

/** The last `days` days' totals. */
export const recentDrops = (log: DropLog, trades: ReceivedTrade[], now = Date.now(), days = RECENT_DAYS) => dropTotals(log, trades, now - days * DAY);
