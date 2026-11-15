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

/**
 * The stops a tour of these changes makes: those on a page this player has. Settings is a panel,
 * not a page, so its changes are left out. A tour's button counts these.
 */
export const tourKept = (stops: NewsItem[]): NewsItem[] => stops.filter((s) => !!s.open && tourGate.ok(parseTarget(s.open).page));

/** Starts a tour of these changes (the stops `tourKept` keeps). */
export function startTour(stops: NewsItem[]) {
  tour.at = 0;
  tour.stops = tourKept(stops);
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
