// The tour of an update (What's New, Take the tour): one change at a time, each on its page with
// its spot lit. The bar at the bottom of the window (ui/TourBar.svelte) shows where you are; App
// opens each stop's page as `tour.at` moves.

import type { NewsItem } from "./whatsNew";
import { parseTarget } from "./intent.svelte";

export const tour = $state({
  /** The changes to step through, in order; empty when no tour is on. */
  stops: [] as NewsItem[],
  at: 0,
});

/** The stop shown now, or null when no tour is on. */
export const tourStop = (): NewsItem | null => tour.stops[tour.at] ?? null;

/** Whether a page can be opened here (App sets it: a console player has fewer pages). */
export const tourGate = { ok: (_page: string) => true };

/** Starts a tour of these changes, leaving out any on a page this player doesn't have. */
export function startTour(stops: NewsItem[]) {
  tour.at = 0;
  tour.stops = stops.filter((s) => !!s.open && tourGate.ok(parseTarget(s.open).page));
}

/** One stop on (1) or back (-1); past the last ends the tour. */
export function stepTour(by: 1 | -1) {
  const next = tour.at + by;
  if (next >= tour.stops.length) return endTour();
  tour.at = Math.max(0, next);
}

export function endTour() {
  tour.stops = [];
  tour.at = 0;
}
