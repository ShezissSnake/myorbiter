// Drops: the parts that turned up in your inventory between two reads, whatever they came from:
// relic rewards, mission and bounty drops (a Lato Vandal part), anything. Each inventory read is
// compared with the one before; a part you hold more of now is a gain. What came in a trade isn't
// a drop, and the trade log can arrive after the read that saw the copy, so trades are taken off
// when the totals are worked out rather than when a read is recorded.
//
// Tracked: prime parts, and the blueprint parts of other gear (the sets warframe.market trades
// whole: Lato Vandal, Mandonel…).

import { gearSetParts, heldCount, type Model } from "./model";

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
  /** When a read with under half the parts was skipped; a later one in a row is believed (you sold or traded in a lot). */
  lowAt?: number;
  /** Parts a read showed none of, kept at their last count until a second read agrees (one read missing a whole category isn't a sale). */
  gone?: string[];
  /** What was being built of each tracked part in the foundry then: one claimed since isn't a drop. */
  building?: Record<string, number>;
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
    for (const p of gearSetParts(m, item.uniqueName) ?? []) if (!out.has(p.unique)) out.set(p.unique, p.name);
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

/** What's being built in the foundry of each tracked part (a Duviri weapon's barrel, say), by name. */
export function dropBuilding(m: Model): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [u, name] of gearParts(m)) {
    const n = m.inFoundry(`${u}Blueprint`) + m.inFoundry(u);
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
 * its last count until the next read agrees, unless a trade since took it (`tradedAway`, the names
 * you gave in trades since the last read): then it was sold. A part that left the foundry since
 * (`building`, what the foundry held of each part) was built, not dropped. Null when nothing
 * changes (an older or the same read).
 */
export function recordRead(log: DropLog, counts: Record<string, number>, at: number, now = at, building: Record<string, number> = {}, tradedAway: string[] = []): DropLog | null {
  if (at <= log.at) return null;
  const sum = total(counts);
  const withBuilding = (l: DropLog): DropLog => (Object.keys(building).length ? { ...l, building } : l);
  if (!log.at) return sum > 0 ? withBuilding({ at, counts, windows: [] }) : null;
  const before = total(log.counts);
  // The same read again (the model rebuilt) isn't a second one.
  if (sum < before / 2) return log.lowAt != null && at > log.lowAt ? withBuilding({ at, counts, windows: log.windows }) : log.lowAt === at ? null : { ...log, lowAt: at };
  // Parts that are gone: traded away, they were sold; otherwise the read may have missed them, so
  // they keep their last count for one read.
  const base: Record<string, number> = { ...counts };
  const sold = new Set(tradedAway.map(norm));
  const gone = Object.keys(log.counts).filter((name) => !(name in counts) && !log.gone?.includes(name) && !sold.has(norm(name)));
  for (const name of gone) base[name] = log.counts[name];
  const gains: Record<string, number> = {};
  for (const [name, n] of Object.entries(counts)) {
    // Copies that left the foundry since the last read were claimed, not dropped.
    const claimed = Math.max(0, (log.building?.[name] ?? 0) - (building[name] ?? 0));
    const more = n - (log.counts[name] ?? 0) - claimed;
    if (more > 0) gains[name] = more;
  }
  const kept = log.windows.filter((w) => w.at >= now - KEEP_DAYS * DAY);
  const any = Object.keys(gains).length > 0;
  // Nothing new and nothing to forget: no need to save the log again.
  if (!any && kept.length === log.windows.length && log.lowAt == null && !gone.length && !log.gone?.length && same(base, log.counts) && same(building, log.building ?? {})) return null;
  const next: DropLog = withBuilding({ at, counts: base, windows: any ? [...kept, { from: log.at, at, gains }] : kept });
  if (gone.length) next.gone = gone;
  return next;
}

/**
 * The foundry's report can arrive after the inventory read it belongs with: a part claimed just
 * before a read then still shows as building, and its copy as a drop. When a later report (`now`
 * within a few minutes of the read) shows fewer building than the read recorded, and that read
 * counted the part as a drop, the claimed copies come off it. Anything else waits for the next read,
 * which counts a claim the usual way.
 */
export function laterClaims(log: DropLog, building: Record<string, number>, now: number): DropLog | null {
  const last = log.windows.at(-1);
  if (!log.building || !last || last.at !== log.at || now - log.at > LATE_REPORT_MS) return null;
  const gains = { ...last.gains };
  const was = { ...log.building };
  let changed = false;
  for (const [name, n] of Object.entries(log.building)) {
    const claimed = Math.min(n - (building[name] ?? 0), gains[name] ?? 0);
    if (claimed <= 0) continue;
    changed = true;
    gains[name] -= claimed;
    if (!gains[name]) delete gains[name];
    was[name] = n - claimed;
    if (!was[name]) delete was[name];
  }
  if (!changed) return null;
  const windows = Object.keys(gains).length ? [...log.windows.slice(0, -1), { ...last, gains }] : log.windows.slice(0, -1);
  const next: DropLog = { ...log, windows, building: was };
  if (!Object.keys(was).length) delete next.building;
  return next;
}

/** How late the foundry's report may come after an inventory read and still belong with it. */
const LATE_REPORT_MS = 5 * 60_000;

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

/** Whether two drop maps hold the same parts and counts. */
export function sameDrops(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

const versions = new WeakMap<object, number>();
let latest: ReadonlyMap<string, number> | null = null;
let latestVersion = 0;
/**
 * A number for what a drop map holds, for a cache key (core/memo.ts keys objects by identity, and
 * the map is rebuilt on every inventory read): a map with the contents of the last one seen has
 * its version, and different contents get the next number.
 */
export function dropsVersion(m: ReadonlyMap<string, number> | null | undefined): string {
  if (m == null) return "-";
  let v = versions.get(m);
  if (v == null) {
    if (!latest || !sameDrops(latest, m)) latestVersion++;
    latest = m;
    versions.set(m, (v = latestVersion));
  }
  return `d${v}`;
}
