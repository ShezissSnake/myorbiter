/**
 * Builds core: mod and arcane loadouts, pure TypeScript (no Svelte). For the Builds page.
 *
 * Storage: `settings.builds: Build[]` and `settings.buildsMaxAgeDays` (default 365, 0 = no limit),
 * sanitised on load in backend.ts. Replace the array to change it (saveBuild, removeBuild,
 * toggleFavourite all return a new one).
 *
 * Sources: orbiter never fetches Overframe or the wiki. registerSource takes a BuildSource
 * (orbiter's suggestions; later a fetcher, only with the site's permission on record).
 */

export * from "./types";
export { gearKindOf, slotLayout, modFits, arcaneFits, arcaneNeedsAdapter, rankWith, usesReactor, doublerName, doublerShort, FORTY_BY_FORMA, NECRAMECH_RANK, type SlotLayout } from "./gear";
export { buildDate, buildAgeDays, withinAge, filterByAge, buildsFor, toggleFavourite, saveBuild, removeBuild } from "./store";
export { registerSource, unregisterSource, buildSources, sourceBuilds, BLOCKED_HOSTS, type BuildSource, type SourceContext, type SourcePermission } from "./source";
