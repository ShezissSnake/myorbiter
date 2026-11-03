/**
 * Builds core: mod and arcane loadouts, pure TypeScript (no Svelte). For the Builds page.
 *
 * Storage: `settings.builds: Build[]` and `settings.buildsMaxAgeDays` (default 365, 0 = no limit),
 * sanitised on load in backend.ts. Replace the array to change it (saveBuild, removeBuild,
 * toggleFavourite all return a new one).
 *
 * Typical use, with `m` the Model and `item` a CatalogItem:
 *
 *   const kind = gearKindOf(item);                     // null: takes no build
 *   const read = parsePaste(text, item, m.catalogByUnique, { held: (p) => heldCount(m, p) });
 *   // read.build: the draft; read.unmatched: names to fix (each with suggestions);
 *   // read.leftOut: matched but not placed; read.notes: what was assumed.
 *   settings.builds = saveBuild(settings.builds, read.build);
 *
 *   const shown = filterByAge(buildsFor(settings.builds, item.uniqueName), settings.buildsMaxAgeDays);
 *   const t = tierOf(build, item, m.catalogByUnique);   // low | medium | high (New player, Intermediate,
 *                                                       // Veteran), limits, reasons, formaPlan, slots;
 *                                                       // capacityTier: what capacity alone needs
 *   availabilityOf(catalogItem);                        // a mod's or arcane's: new | intermediate | veteran
 *   const r = missing(build, m);                        // lines: item, parts, mods, arcanes, shards,
 *                                                       // catalyst, adapters, forma, helminth
 *
 * The editor: matchName(text, nameIndex(m.catalogByUnique), item, kind, "mod" | "arcane") for a
 * typed name; slotLayout(kind) for the slots; drainIn/bonusIn for one slot's drain; the
 * TierResult's `slots` for each slot's drain and polarity under the tier's plan.
 *
 * Not readable yet (TennoScope patch pending): slot polarities on your copy, installed shards,
 * the Helminth, the arcane adapter's bit. missing() says "unknown" for those, never "missing".
 * The catalog has no stance-slot polarity: tierOf counts it as none and says so.
 *
 * Sources: orbiter never fetches Overframe or the wiki. registerSource takes a BuildSource
 * suggestions; later a fetcher, only with the site's permission on record).
 */

export * from "./types";
export { gearKindOf, slotLayout, modFits, arcaneFits, arcaneNeedsAdapter, rankWith, usesReactor, doublerName, doublerShort, FORTY_BY_FORMA, NECRAMECH_RANK, type SlotLayout } from "./gear";
export { normName, nameIndex, matchName, suggest, type NameIndex, type Matched, type Unmatched, type MatchResult, type MatchVia } from "./match";
export { parsePaste, type PasteResult, type PasteOptions, type ReadName, type SlotRole } from "./parse";
export { tierOf, capacityOf, tierAllows, tierOfAvailability, drainIn, bonusIn, matches, TIERS, TIER_LABEL, CAPACITY_LABEL, TIER_AVAILABILITY, type Tier, type TierResult, type TierLimit, type CapacityResult, type FormaStep, type SlotDrain, type SlotRef } from "./capacity";
export { availability, availabilityOf, availableAt, availabilityRank, laterOf, sourceLevel, dropsLevel, hardDonorOf, AVAILABILITIES, AVAILABILITY_LABEL, AVAILABILITY_SOURCES, type Availability, type AvailabilityInfo, type AvailabilityRule } from "./availability";
export { missing, bestCopy, endoCost, ENDO_BASE, PATHS, SHARD_PATH, shardPath, type MissingReport, type MissingLine, type MissingKind, type Have } from "./missing";
export { buildDate, buildAgeDays, withinAge, filterByAge, buildsFor, toggleFavourite, saveBuild, removeBuild } from "./store";
export { registerSource, unregisterSource, buildSources, sourceBuilds, BLOCKED_HOSTS, type BuildSource, type SourceContext, type SourcePermission } from "./source";
