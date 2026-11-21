// Void Traces: what refining relics costs, and how many you can hold.
import type { Model } from "./model";

const VOID_TRACE = "/Lotus/Types/Items/MiscItems/VoidTearDrop";
/** Intact to Radiant: 100 traces (25 to Exceptional, 50 to Flawless; refining further pays the difference). */
export const TO_RADIANT = 100;

/** The traces you hold, as of the last inventory read. */
export const voidTraces = (m: Model) => (m.inventoryByBase.get(VOID_TRACE) ?? []).reduce((n, r) => n + r.quantity, 0);

/** The most you can hold: 100 + 50 a Mastery Rank. Past it, a crack's traces are lost. Null without a rank. */
export const traceCap = (masteryRank: number | null | undefined) => (masteryRank == null ? null : 100 + 50 * masteryRank);

/** Within one radiant refine of the cap: worth spending some before the next run. */
export const nearTraceCap = (traces: number, cap: number | null) => cap != null && traces >= cap - TO_RADIANT;

/**
 * The note for traces near, at or over the cap, the same wherever they show; null further under
 * (or with no cap). It shows in amber, so it starts with the "!" amber always carries.
 */
export function traceCapWord(traces: number, cap: number | null): string | null {
  if (cap == null || !nearTraceCap(traces, cap)) return null;
  return `! ${traces > cap ? "over" : traces === cap ? "at" : "near"} the cap: refine some`;
}
