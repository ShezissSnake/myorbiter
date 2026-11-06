// Parts of the saved game state read back whole (loadSettings): an entry a damaged or hand-edited
// settings file turned into something else is left out, so the page that draws it (Stats, Rivens,
// Inventory, the notification bell) still opens. A good entry comes back as it was saved.
import type { ValuePoint } from "../backend";
import type { Notice } from "../notices";
import type { RelicRun } from "./relicRuns";
import type { GearCopy } from "./notNeeded";
import type { RivenRaw } from "./rivens";

const fine = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
const keep = <T,>(raw: unknown, ok: (x: Record<string, unknown>) => boolean): T[] => (Array.isArray(raw) ? (raw.filter((x) => obj(x) && ok(x)) as T[]) : []);

/** Inventory value over time: a time and the two worths at least. */
export const valueHistoryOf = (raw: unknown) => keep<ValuePoint>(raw, (x) => fine(x.at) && fine(x.worth) && fine(x.liquid) && (x.platinum == null || fine(x.platinum)) && (x.held === undefined || obj(x.held)));

/** Reward screens seen: a time, the cards and the squad's relics. */
export const relicRunsOf = (raw: unknown) => keep<RelicRun>(raw, (x) => fine(x.at) && strings(x.cards) && strings(x.relics) && (x.before === undefined || obj(x.before)));

/** The notification history. */
export const noticesOf = (raw: unknown) => keep<Notice>(raw, (x) => typeof x.id === "string" && fine(x.at) && typeof x.kind === "string" && typeof x.title === "string" && typeof x.body === "string" && typeof x.read === "boolean");

/** Gear copies from the last read; null when there's no list (as before one was read). */
export const gearOf = (raw: unknown): GearCopy[] | null => (Array.isArray(raw) ? keep<GearCopy>(raw, (x) => typeof x.type === "string" && fine(x.f) && fine(x.p)) : null);

/** Rivens from the last read; null when there's no list. */
export const rivensOf = (raw: unknown): RivenRaw[] | null => (Array.isArray(raw) ? keep<RivenRaw>(raw, (x) => typeof x.type === "string" && typeof x.id === "string" && obj(x.fp) && (x.pending === undefined || x.pending === null || obj(x.pending))) : null);
