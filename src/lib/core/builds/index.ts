/**
 * Builds core: mod and arcane loadouts, pure TypeScript (no Svelte). For the Builds page.
 *
 * Storage: `settings.builds: Build[]` and `settings.buildsMaxAgeDays` (default 730, 0 = no limit),
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
 *   tagsInText(text, title);                            // build tags a paste names; TAG_FAMILY for chips (tags.ts)
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
 * Overframe's popular builds (overframeList.ts): a list bundled with the app, collected by hand in
 * a browser with Overframe's permission (lists only), never fetched by orbiter:
 *
 *   const file = await loadOverframe();                     // public/data/overframe/popular.json
 *   const { builds } = overframeFor(file, item.uniqueName, { name: item.name });   // ≤ 5, ≤ 2 years
 *
 * Sources: orbiter never fetches Overframe or the wiki. registerSource takes a BuildSource
 * (orbiter's suggestions; a fetcher only with the site's permission, or its terms as checked, on record).
 *
 * Nox's Frame (noxsframe.ts; Rust: src-tauri/src/noxsframe.rs), read on demand only:
 *
 *   const nox = makeNox(noxFetcher, () => settings.buildsFromNox);   // noxFetcher: backend.ts
 *   registerSource(nox.source);            // once; sourceBuilds then includes builds already opened
 *   const list = await nox.listing(item, ctx);              // top-voted, ≤ 10: one request a week at most
 *   const got = await nox.open(item, list.entries[0].path, ctx);   // one build: got.build, got.notes
 *   const pasted = await parseNoxCode(code, item, m.catalogByUnique, noxFetcher.decode);
 */

export * from "./types";
export { gearKindOf, slotLayout, modFits, arcaneFits, arcaneNeedsAdapter, rankWith, usesReactor, doublerName, doublerShort, FORTY_BY_FORMA, NECRAMECH_RANK, type SlotLayout } from "./gear";
export { normName, nameIndex, matchName, suggest, type NameIndex, type Matched, type Unmatched, type MatchResult, type MatchVia } from "./match";
export { parsePaste, type PasteResult, type PasteOptions, type ReadName, type SlotRole } from "./parse";
export { tierOf, capacityOf, tierAllows, tierOfAvailability, drainIn, bonusIn, matches, TIERS, TIER_LABEL, CAPACITY_LABEL, TIER_AVAILABILITY, type Tier, type TierResult, type TierLimit, type CapacityResult, type FormaStep, type SlotDrain, type SlotRef } from "./capacity";
export { availability, availabilityOf, availableAt, availabilityRank, laterOf, sourceLevel, dropsLevel, hardDonorOf, AVAILABILITIES, AVAILABILITY_LABEL, AVAILABILITY_SOURCES, type Availability, type AvailabilityInfo, type AvailabilityRule } from "./availability";
export { TAGS, NOX_TAGS, TAG_FAMILY, TAG_FAMILIES, familyOfTag, byFamily, canonicalTag, tagsInText, onlyTags, type TagFamily } from "./tags";
export { missing, bestCopy, endoCost, ENDO_BASE, PATHS, SHARD_PATH, shardPath, type MissingReport, type MissingLine, type MissingKind, type Have } from "./missing";
export { buildDate, buildAgeDays, withinAge, filterByAge, buildsFor, toggleFavourite, saveBuild, removeBuild } from "./store";
export { registerSource, unregisterSource, buildSources, sourceBuilds, BLOCKED_HOSTS, TERMS_HOSTS, type BuildSource, type SourceContext, type SourcePermission } from "./source";
export { overframeFor, overframeWithinAge, overframeBuildUrl, parseOverframeFile, loadOverframe, resetOverframe, matchRate, isBuildPath, updatedAt, OVERFRAME_SITE, OVERFRAME_ORIGIN, OVERFRAME_SOURCE, OVERFRAME_PERMISSION, OVERFRAME_FILE, OVERFRAME_CATEGORIES, OVERFRAME_SHOWN, OVERFRAME_MAX_AGE_DAYS, type OverframeListed, type OverframeFile, type OverframeCategory, type OverframeOptions, type OverframeResult } from "./overframeList";
export { makeNox, noxToBuild, noxListedWithinAge, noxItems, parseNoxCode, looksLikeNoxCode, NOX_SITE, NOX_HOST, NOX_PERMISSION, NOX_SETTING, NOX_MODES, NOX_LISTED, type Nox, type NoxFetcher, type NoxAnswer, type NoxListing, type NoxListed, type NoxListResult, type NoxPage, type NoxMapped, type NoxOpened, type NoxCodeResult } from "./noxsframe";
