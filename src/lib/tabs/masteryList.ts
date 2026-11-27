// Mastery's lists and the two switches' counts, as plain functions so they can be tested (the page,
// Mastery.svelte, only binds them). Easiest first lists what's available, adding trade-only primes
// when Vaulted is ticked and what can't be got now when Show unavailable is. Buy with plat always
// lists trade-only primes (platinum is how they're got) and draws only what platMastery prices.
import type { Model } from "../core/model";
import type { MasteryRow } from "../core/views";
import { platMastery } from "../core/platMastery";

export type MasteryView = "effort" | "plat";
export interface Switches {
  vaulted: boolean;
  unavailable: boolean;
}

/** The rows a view is given, with the filters (fits) and the two switches as they stand. */
export function viewRows(all: MasteryRow[], fits: (r: MasteryRow) => boolean, view: MasteryView, on: Switches): MasteryRow[] {
  if (view === "plat") return all.filter((r) => (r.acq.available || r.acq.tradeOnly || on.unavailable) && fits(r));
  return all.filter((r) => (r.acq.available || (r.acq.tradeOnly ? on.vaulted : on.unavailable)) && fits(r));
}

/** What each switch holds back (or adds, when on) in a view, with the filters as they stand. */
export function switchCounts(m: Model, all: MasteryRow[], fits: (r: MasteryRow) => boolean, view: MasteryView): { vaulted: number; unavailable: number } {
  const unavailable = all.filter((r) => !r.acq.available && !r.acq.tradeOnly && fits(r));
  return {
    vaulted: all.filter((r) => r.acq.tradeOnly && fits(r)).length,
    // Buy with plat draws only what it can price (platMastery goes row by row), so it counts those.
    unavailable: view === "plat" ? platMastery(m, unavailable).length : unavailable.length,
  };
}

/**
 * The vault chip for a prime's missing parts: the worst of them, Vaulted before Resurgence. A part
 * no relic in the drop tables gives reads No relic, never Farmable, though the lists count it as
 * farmable.
 */
export function missingChip(parts: { availability: string }[]): "vaulted" | "resurgence" | "unknown" | "farmable" {
  const has = (a: string) => parts.some((p) => p.availability === a);
  return has("vaulted") ? "vaulted" : has("resurgence") ? "resurgence" : has("unknown") ? "unknown" : "farmable";
}
