// Parts of the saved game state read back whole (loadSettings): an entry a damaged or hand-edited
// settings file turned into something else is left out, so the page that draws it (Stats, Rivens,
// Inventory, the notification bell) still opens. A good entry comes back as it was saved. The drops
// log's counts are the exception: read whole, or the log starts again (dropLogOf).
import type { RivenWatch, ValuePoint } from "../backend";
import { outcomeOf, type Notice } from "../notices";
import type { RelicRun } from "./relicRuns";
import type { GearCopy } from "./notNeeded";
import type { RivenRaw, RivenSnap } from "./rivens";
import type { DropLog, DropWindow } from "./drops";

const fine = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
const keep = <T,>(raw: unknown, ok: (x: Record<string, unknown>) => boolean): T[] => (Array.isArray(raw) ? (raw.filter((x) => obj(x) && ok(x)) as T[]) : []);

/** Inventory value over time: a time and the two worths at least. */
export const valueHistoryOf = (raw: unknown) => keep<ValuePoint>(raw, (x) => fine(x.at) && fine(x.worth) && fine(x.liquid) && (x.platinum == null || fine(x.platinum)) && (x.held === undefined || obj(x.held)));

/** Reward screens seen: a time, the cards and the squad's relics. */
export const relicRunsOf = (raw: unknown) => keep<RelicRun>(raw, (x) => fine(x.at) && strings(x.cards) && strings(x.relics) && (x.before === undefined || obj(x.before)));

/**
 * The notification history: each id once (the first, the newest, kept: the bell's list is keyed by
 * it). A page to open that isn't text, or a +rep that isn't a trade's key and its buyer, is left off;
 * the notice itself stays and opens its kind's page.
 */
export const noticesOf = (raw: unknown) => {
  const ids = new Set<string>();
  return keep<Notice>(raw, (x) => typeof x.id === "string" && fine(x.at) && typeof x.kind === "string" && typeof x.title === "string" && typeof x.body === "string" && typeof x.read === "boolean")
    .filter((n) => !ids.has(n.id) && !!ids.add(n.id))
    .map((n) => {
      // What became of its pop-up: kept when it reads as one, else left off (the entry itself stays).
      const { outcome, to, rep, ...rest } = n;
      const o = outcomeOf(outcome);
      return { ...rest, ...(typeof to === "string" ? { to } : {}), ...(obj(rep) && typeof rep.key === "string" && typeof rep.partner === "string" ? { rep } : {}), ...(o ? { outcome: o } : {}) } as Notice;
    });
};

const texts = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
/** The entries of an object whose values pass `ok`; anything but an object is none. */
const record = <T,>(raw: unknown, ok: (v: unknown) => boolean): Record<string, T> => (obj(raw) ? (Object.fromEntries(Object.entries(raw).filter(([, v]) => ok(v))) as Record<string, T>) : {});
const numOrNull = (x: unknown) => (fine(x) ? x : null);

/** A count the drops log holds of a part: a whole number, none below zero. */
const tally = (n: unknown): n is number => fine(n) && Number.isInteger(n) && n >= 0;
/** Counts read whole: an object whose every entry is a tally; null for anything else. */
const tallies = (raw: unknown): Record<string, number> | null => (obj(raw) && Object.values(raw).every(tally) ? (raw as Record<string, number>) : null);

/**
 * The drops log (core/drops.ts): a time to count from, else a new log. Its counts (what was held
 * of each part, and what was being built) are read whole or not at all: with one entry missing,
 * the next read would take every copy of that part as a drop. Counts that cannot be read whole
 * make the log a new baseline (at 0, the next read sets the counts and logs no drop); the drops
 * already logged stay. Inside the rest, odd entries are left out.
 */
export function dropLogOf(raw: unknown): DropLog {
  if (!obj(raw) || !fine(raw.at)) return { at: 0, counts: {}, windows: [] };
  const windows = keep<DropWindow>(raw.windows, (w) => fine(w.from) && fine(w.at) && obj(w.gains)).map((w) => ({ ...w, gains: record<number>(w.gains, fine) }));
  const counts = tallies(raw.counts);
  const building = raw.building === undefined ? undefined : tallies(raw.building);
  if (!counts || building === null) return { at: 0, counts: {}, windows };
  const out: DropLog = { at: raw.at, counts: { ...counts }, windows };
  if (fine(raw.lowAt)) out.lowAt = raw.lowAt;
  if (Array.isArray(raw.gone)) out.gone = texts(raw.gone);
  if (building) out.building = { ...building };
  if (fine(raw.tracks)) out.tracks = raw.tracks;
  return out;
}

/** Each riven's rolls as seen: by riven id, the snapshots whole. */
const rivenHistoryOf = (raw: unknown): Record<string, RivenSnap[]> =>
  Object.fromEntries(Object.entries(record<unknown[]>(raw, Array.isArray)).map(([id, snaps]) => [id, keep<RivenSnap>(snaps, (x) => fine(x.at) && fine(x.rerolls) && Array.isArray(x.buffs) && Array.isArray(x.curses))]));

/**
 * The rest of the saved game state that is read as it was saved: TennoScope's last figures, the
 * Foundry's ready times, the lists of what was already told, the chats seen, the sets being saved
 * for and the drops log. An entry of the wrong kind is left out and the rest kept (but for the
 * drops log's counts: dropLogOf); a figure that isn't a number reads as not known.
 */
export function gameStateOf(raw: unknown) {
  const g = obj(raw) ? raw : {};
  return {
    foundryReady: Array.isArray(g.foundryReady) ? g.foundryReady.filter((x): x is [string, number] => Array.isArray(x) && typeof x[0] === "string" && fine(x[1])) : [],
    masteryRank: numOrNull(g.masteryRank),
    platinum: numOrNull(g.platinum),
    credits: numOrNull(g.credits),
    endo: numOrNull(g.endo),
    rivenHistory: rivenHistoryOf(g.rivenHistory),
    foundryNotified: texts(g.foundryNotified),
    whispersSeen: texts(g.whispersSeen),
    chatsSeen: record<string>(g.chatsSeen, (v) => typeof v === "string"),
    dealsNotified: texts(g.dealsNotified),
    fissuresNotified: texts(g.fissuresNotified),
    rivensNotified: texts(g.rivensNotified),
    cyclesNotified: texts(g.cyclesNotified),
    shortNotified: texts(g.shortNotified),
    worldNotified: texts(g.worldNotified),
    savingFor: record<{ set: string; complete: number }>(g.savingFor, (v) => obj(v) && typeof v.set === "string" && fine(v.complete)),
    drops: dropLogOf(g.drops),
  };
}

/** Gear copies from the last read; null when there's no list (as before one was read). */
export const gearOf = (raw: unknown): GearCopy[] | null => (Array.isArray(raw) ? keep<GearCopy>(raw, (x) => typeof x.type === "string" && fine(x.f) && fine(x.p)) : null);

/** Rivens from the last read; null when there's no list. */
export const rivensOf = (raw: unknown): RivenRaw[] | null => (Array.isArray(raw) ? keep<RivenRaw>(raw, (x) => typeof x.type === "string" && typeof x.id === "string" && obj(x.fp) && (x.pending === undefined || x.pending === null || obj(x.pending))) : null);

/** Riven alerts: a weapon, its stats and your price. */
export const rivenWatchOf = (raw: unknown) =>
  keep<RivenWatch>(raw, (x) => typeof x.id === "string" && typeof x.weapon === "string" && typeof x.weaponName === "string" && strings(x.positive) && (x.negative === null || typeof x.negative === "string") && fine(x.maxPrice));
