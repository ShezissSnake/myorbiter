// Keeping builds in `settings.builds`: the age filter, favourites, and adding or removing one.
// Every helper returns a new array (Svelte state is replaced, not mutated).

import type { Build } from "./types";

const DAY = 86_400_000;

/** A build's date for the age filter: when its source last changed it, else when orbiter got it. */
export const buildDate = (b: Build): number => b.updatedAt ?? b.importedAt;

/** Its age in whole days at `now`. */
export const buildAgeDays = (b: Build, now = Date.now()): number => Math.max(0, Math.floor((now - buildDate(b)) / DAY));

/**
 * Whether a build passes the age filter (`settings.buildsMaxAgeDays`; 0: no limit). Your own builds
 * and orbiter's suggestions are never too old: the filter is for what other people posted.
 */
export function withinAge(b: Build, maxAgeDays: number, now = Date.now()): boolean {
  if (b.source === "mine" || b.source === "orbiter" || !(maxAgeDays > 0)) return true;
  return now - buildDate(b) <= maxAgeDays * DAY;
}

export const filterByAge = (builds: readonly Build[], maxAgeDays: number, now = Date.now()): Build[] => builds.filter((b) => withinAge(b, maxAgeDays, now));

/** One item's builds: favourites first, then the newest. */
export function buildsFor(builds: readonly Build[], item: string): Build[] {
  return builds.filter((b) => b.item === item).sort((a, b) => Number(!!b.favourite) - Number(!!a.favourite) || buildDate(b) - buildDate(a));
}

/** The builds with one's favourite star flipped. */
export function toggleFavourite(builds: readonly Build[], id: string): Build[] {
  return builds.map((b) => (b.id === id ? { ...b, favourite: !b.favourite } : b));
}

/** The builds with this one saved: in place if its id is there, else first. */
export function saveBuild(builds: readonly Build[], build: Build): Build[] {
  const i = builds.findIndex((b) => b.id === build.id);
  return i < 0 ? [build, ...builds] : builds.map((b, j) => (j === i ? build : b));
}

export const removeBuild = (builds: readonly Build[], id: string): Build[] => builds.filter((b) => b.id !== id);
