// Mod and arcane availability: how far into the game a player is before they can have it.
//
// The definitions (3 Nov):
// - New player: very few mods, no catalysts; basic mods only, no Forma, shards or arcanes.
// - Intermediate: Corrupted mods, easy arcanes (Molt Augmented and the like), Orokin Catalysts and
//   Reactors, Lua puzzle-room and spy-vault mods, the Exilus Adapter, augments and Forma; not yet
//   Archon or Primed mods, Archon shards, hard arcanes or Umbra Forma (so not the Umbral set).
// - Veteran: everything.
//
// The rules, in order (the first that applies decides):
//  1. The curated override list (src/lib/data/mod-availability.json, `overrides`), by path then name.
//  2. Arcanes: never "new". From their drop sources (see sourceLevel): the easiest source decides,
//     Eidolons, Archimedea, Steel Path, Arbitrations and Railjack are veteran; open worlds, the
//     Zariman, Duviri and the star chart intermediate. No drop listed: a vendor's, intermediate.
//  3. Mods by family, from the catalog's own path and name:
//     Primed (Baro Ki'Teer), Umbral, Archon, Galvanized (the Arbitrations vendor), Amalgam,
//     Sacrificial and Rivens are veteran; Corrupted (Orokin Derelict vaults), augments, Drift mods
//     (Lua's Halls of Ascension), Nightwave and syndicate offerings and Conclave mods intermediate.
//  4. Mods from their drop sources, the easiest one: a common enemy or an early star-chart planet
//     (Mercury to Saturn) is "new"; spy vaults, the Derelict, open worlds, later planets and special
//     enemies intermediate; Steel Path, Arbitrations, Archon hunts, Netracells and Eidolons veteran.
//  5. Anything else (no drop listed, no family): intermediate. orbiter only calls a mod "new" when
//     the drop tables show a common star-chart drop.
//
// Drops: orbiter's catalog keeps at most eight drop sources per item, best chance first, so a mod
// that drops everywhere at a low chance can look like a spy-vault exclusive (Serration). The data
// file's `fullDrops` table holds the level worked out from the full drop tables (DE's, via the
// WFCD catalog TennoScope downloads) for the items where the eight differ from the whole list;
// scripts/mod-availability-drops.mjs regenerates it.
//
// Pure: no I/O, no Svelte.

import type { CatalogItem, Drop } from "../types";
import data from "../../data/mod-availability.json";

export type Availability = "new" | "intermediate" | "veteran";
export const AVAILABILITIES: Availability[] = ["new", "intermediate", "veteran"];
export const AVAILABILITY_LABEL: Record<Availability, string> = { new: "New player", intermediate: "Intermediate", veteran: "Veteran" };
const RANK: Record<Availability, number> = { new: 0, intermediate: 1, veteran: 2 };
export const availabilityRank = (a: Availability): number => RANK[a];
/** The later of two levels. */
export const laterOf = (a: Availability, b: Availability): Availability => (RANK[a] >= RANK[b] ? a : b);
const earlierOf = (a: Availability, b: Availability): Availability => (RANK[a] <= RANK[b] ? a : b);

/** What decided an item's level. */
export type AvailabilityRule =
  | "override"
  | "arcane"
  | "primed"
  | "umbral"
  | "archon"
  | "galvanized"
  | "amalgam"
  | "sacrificial"
  | "riven"
  | "corrupted"
  | "augment"
  | "drift"
  | "nightwave"
  | "syndicate"
  | "conclave"
  | "drops"
  | "noDrops";

export interface AvailabilityInfo {
  level: Availability;
  rule: AvailabilityRule;
  /** Why, in a few words: "Primed (Baro Ki'Teer)", "a Corrupted mod, from Orokin Derelict vaults". */
  why: string;
  /** The page the rule was read on, when there is one. */
  source?: string;
}

interface Override {
  level: Availability;
  why: string;
  source: string;
}
interface DataFile {
  sources: Record<string, string>;
  corrupted: string[];
  overrides: Record<string, Override>;
  fullDrops: { _about?: string; levels: Record<string, Availability> };
  hardFrames: Record<string, { abilities: string[]; why: string; source: string }>;
}
const DATA = data as unknown as DataFile;
const SRC = DATA.sources;
const CORRUPTED = new Set(DATA.corrupted);

/** The item fields the classifier reads. */
export type Classifiable = Pick<CatalogItem, "uniqueName" | "name" | "category"> & Partial<Pick<CatalogItem, "type" | "drops">>;

// ---------------------------------------------------------------- drop sources

// Planets a new player reaches first: the star chart up to Saturn.
// The drop tables write a node as "Planet/Node (Mission)", a few older rows as "Planet - Node".
const EARLY_PLANET = /^(Mercury|Venus|Earth|Mars|Phobos|Ceres|Jupiter|Europa|Saturn)( - |\/)/;
// Steel Path, Arbitrations (all star-chart nodes first), Archon hunts, Netracells and Archimedea,
// Eidolons (Plains at night, Operator gear), Railjack (Proxima and skirmishes), Duviri's Steel Path
// ("Hard"), Lich and Sister ascension.
const VETERAN_SOURCE = /Steel Path|Arbitration|Archimedea|Netracell|Archon|Eidolon|Proxima|\(Skirmish\)|Orphix|\(Hard\)|Ascension Mode/;
// The Stalker's Acolytes: they spawn in Steel Path missions (the wiki's Steel Path page).
const ACOLYTE = /^(Angst|Malice|Mania|Misery|Torment|Violence)\b/;
// Not the plain star chart, or not early: vaults and spy vaults, open worlds and their bounties,
// the Zariman, Duviri, Höllvania, Lua and the Void, Liches and Sisters, sorties, Conclave.
const INTERMEDIATE_SOURCE =
  /Derelict|\(Spy\)|Conclave|Bounty|Caches|Isolation Vault|Cetus|Vallis|Cambion|Drift|Necralisk|Zariman|Höllvania|Duviri|Circuit|Sanctum|Albrecht|Kuva|Lich|Sister|Requiem|Sortie|Nightmare|Necramech|Profit-Taker|Exploiter|Granum|Relic|Operation|Nokko|Descendia|Mirror|Undercroft|Murmur|Whisper|Suzerain/;
// Enemies a new player doesn't meet: open-world, Deimos, Duviri and Zariman fauna, Sentients, the
// Stalker, Amalgams, the Kuva, Narmer and Drekar Grineer, Höllvania's Techrot and Scaldra, late bosses.
const SPECIAL_ENEMY =
  /^(Deimos |Amalgam|Thrax|Void Angel|Ravenous Void|Kuva |Corrupted |Narmer|Techrot|Scaldra|Archimedean|Zealoid|Stalker|Shadow Stalker|Protector Stalker|Hunhow|Erra|Conculyst|Battalyst|Ortholyst|Summulyst|Symbilyst|Decaying |Tyro |Mimic|Commandeered|Ropalolyst|Jordas|J3 |Wolf Of Saturn|Lephantis|Vay Hek|Raptor|Profit|Exploiter|Hemocyte|Ghoul|Tusk|Terra |Scrofa |Syzygy |Necramech|H-09|Mocking|Scathing|The Fragmented|\w+ Specter$|Drekar|\w* ?Raknoid|Coildrive|\w+ Commander$|\w* ?Diploid|\w* ?Thrasher|Undying|Orb |Ghoul|Vapos|Kavor|Osprey Commander)/;

/** How far in a player is before they reach one drop source. */
export function sourceLevel(location: string): Availability {
  if (VETERAN_SOURCE.test(location) || ACOLYTE.test(location)) return "veteran";
  if (INTERMEDIATE_SOURCE.test(location)) return "intermediate";
  if (EARLY_PLANET.test(location)) return "new";
  // "Planet/Node (Mission)" past Saturn, quests and events.
  if (location.includes("/") || location.includes(" - ") || location.includes(", Rotation")) return "intermediate";
  // An enemy.
  return SPECIAL_ENEMY.test(location) ? "intermediate" : "new";
}

/** The easiest level among drop sources, or null with none listed. */
export function dropsLevel(drops: readonly Drop[] | undefined): Availability | null {
  let best: Availability | null = null;
  for (const d of drops ?? []) {
    const l = sourceLevel(d.location);
    best = best ? earlierOf(best, l) : l;
    if (best === "new") break;
  }
  return best;
}

/** The drop level for an item: the full tables' when the data file has it, else the catalog's eight. */
function itemDropsLevel(item: Classifiable): Availability | null {
  const slim = dropsLevel(item.drops);
  const full = DATA.fullDrops.levels[item.uniqueName];
  if (full && slim) return earlierOf(full, slim);
  return full ?? slim;
}

// ---------------------------------------------------------------- the classifier

const isArcane = (item: Classifiable) => item.category === "Arcanes" || /\/CosmeticEnhancers\//.test(item.uniqueName);
const info = (level: Availability, rule: AvailabilityRule, why: string, source?: string): AvailabilityInfo => ({ level, rule, why, ...(source ? { source } : {}) });

/** An item's level and why. Gear that isn't a mod or an arcane is "new" (rule "drops", nothing to say). */
export function availability(item: Classifiable): AvailabilityInfo {
  const o = DATA.overrides[item.uniqueName] ?? DATA.overrides[item.name];
  if (o) return info(o.level, "override", o.why, o.source);
  const p = item.uniqueName;
  const n = item.name;

  if (isArcane(item)) {
    const d = itemDropsLevel(item);
    if (!d) return info("intermediate", "arcane", "an arcane no drop table lists: a vendor's, for standing", SRC.arcanes);
    const level = laterOf(d, "intermediate");
    return info(level, "arcane", level === "veteran" ? "an arcane from endgame content (Eidolons, Archimedea, Steel Path, Arbitrations or Railjack)" : "an arcane from mid-game content (open worlds, the Zariman, Duviri or the star chart)", SRC.arcanes);
  }
  if (item.category !== "Mods") return info("new", "drops", "");

  if (/\/Randomized\//.test(p) || /Riven Mod$/.test(n)) return info("veteran", "riven", "a Riven mod", SRC.riven);
  if (/^Primed /.test(n)) return info("veteran", "primed", "Primed, from Baro Ki'Teer", SRC.primed);
  if (/\/Sets\/Umbra\//.test(p) || /^Umbral /.test(n)) return info("veteran", "umbral", "Umbral, from The Sacrifice and Simaris; it wants Umbra Forma", SRC.umbral);
  if (/\/Warframe\/Kahl\//.test(p) || /^Archon /.test(n)) return info("veteran", "archon", "an Archon mod", SRC.archon);
  if (/^Galvanized /.test(n)) return info("veteran", "galvanized", "Galvanized, from the Arbitrations vendor", SRC.galvanized);
  if (/\/DualSource\//.test(p) || /^Amalgam /.test(n)) return info("veteran", "amalgam", "an Amalgam mod", SRC.amalgam);
  if (/\/Sets\/Sacrifice\//.test(p) || /^Sacrificial /.test(n)) return info("veteran", "sacrificial", "a Sacrificial mod", SRC.sacrificial);
  if (/\/PvPMods\//.test(p) || /PvPAugmentCard$/.test(p)) return info("intermediate", "conclave", "a Conclave mod, from Teshin for Conclave standing", SRC.conclave);
  if (CORRUPTED.has(n) || /\/DualStat\/Corrupted/.test(p) || (item.drops ?? []).some((d) => d.location === "Derelict Vault")) return info("intermediate", "corrupted", "a Corrupted mod, from Orokin Derelict vaults", SRC.corrupted);
  if (/^\/Lotus\/Powersuits\/.*Augment\w*Card$/.test(p) || /^\/Lotus\/Upgrades\/Mods\/Syndicate\//.test(p)) return info("intermediate", "augment", "an augment, from syndicates, quests and Nightwave", SRC.augment);
  if (/\/OrokinChallenge\//.test(p)) return info("intermediate", "drift", "a Drift mod, from Lua's Halls of Ascension", SRC.drift);
  if (/\/Nightwave\//.test(p)) return info("intermediate", "nightwave", "a Nightwave offering", SRC.nightwave);

  const d = itemDropsLevel(item);
  if (d === "new") return info("new", "drops", "a common star-chart drop");
  if (d === "veteran") return info("veteran", "drops", "drops only in endgame content (Steel Path, Arbitrations, Archon hunts, Eidolons)");
  if (d === "intermediate") {
    const spy = (item.drops ?? []).every((x) => /\(Spy\)/.test(x.location));
    return info("intermediate", "drops", spy ? "a spy-vault reward" : "drops past the early star chart (open worlds, later planets, special enemies)");
  }
  return info("intermediate", "noDrops", "no drop table lists it, so orbiter can't call it a common drop");
}

/** An item's level: "new", "intermediate" or "veteran". */
export function availabilityOf(item: Classifiable): Availability {
  return availability(item).level;
}

/** Whether a player at `tier` can have the item. */
export function availableAt(item: Classifiable, at: Availability): boolean {
  return RANK[availabilityOf(item)] <= RANK[at];
}

/**
 * A Helminth ability whose donor frame is hard enough to get that only veterans have fed it (the
 * data file's `hardFrames`: Grendel, whose parts need Arbitration locators). Null: not listed, so
 * the Helminth is Intermediate (Heart of Deimos, then Son's segment at Entrati rank 3).
 */
export function hardDonorOf(ability: string | null | undefined): { frame: string; why: string; source: string } | null {
  if (!ability) return null;
  const a = ability.trim().toLowerCase();
  for (const [frame, f] of Object.entries(DATA.hardFrames)) if (f.abilities.some((x) => x.toLowerCase() === a)) return { frame, why: f.why, source: f.source };
  return null;
}

/** The pages the rules were read on, by rule (for a page that wants to cite them). */
export const AVAILABILITY_SOURCES: Readonly<Record<string, string>> = SRC;
