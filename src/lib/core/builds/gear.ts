// What a piece of gear takes: its kind, slots, rank, and which mods and arcanes fit it.

import { familyOf } from "../modular";
import type { CatalogItem } from "../types";
import type { GearKind } from "./types";

/** The kind of gear a catalog item is, or null for anything that takes no build. */
export function gearKindOf(item: Pick<CatalogItem, "uniqueName" | "category" | "type" | "productCategory">): GearKind | null {
  const { category: cat, type: t, productCategory: pc } = item;
  if (t === "Necramech" || pc === "MechSuits") return "necramech";
  if (pc === "Suits" || cat === "Warframes") return "warframe";
  if (pc === "SpaceSuits" || cat === "Archwing") return "archwing";
  if (pc === "SpaceGuns" || cat === "Arch-Gun") return "archgun";
  if (pc === "SpaceMelee" || cat === "Arch-Melee") return "archmelee";
  if (pc === "SentinelWeapons") return "companionWeapon";
  if (t === "Amp") return "amp";
  if (t === "K-Drive Component") return "kdrive";
  if (cat === "Sentinels" || cat === "Pets" || pc === "Sentinels" || pc === "KubrowPets") return "companion";
  if (t === "Kitgun Component") return "secondary";
  if (t === "Zaw Component" || cat === "Melee") return "melee";
  if (cat === "Primary") return pc === "OperatorAmps" ? "secondary" : "primary";
  if (cat === "Secondary") return "secondary";
  return null;
}

/** The slots a kind of gear has. */
export interface SlotLayout {
  mods: number;
  aura: boolean;
  exilus: boolean;
  stance: boolean;
  /** Arcane slots (weapons' one needs an adapter, see arcaneNeedsAdapter). */
  arcanes: number;
}

export function slotLayout(kind: GearKind): SlotLayout {
  switch (kind) {
    case "warframe":
      return { mods: 8, aura: true, exilus: true, stance: false, arcanes: 2 };
    case "necramech":
      return { mods: 12, aura: false, exilus: false, stance: false, arcanes: 0 };
    // Companions have ten mod slots (two rows of five). Unverified against the game's data.
    case "companion":
      return { mods: 10, aura: false, exilus: false, stance: false, arcanes: 0 };
    case "melee":
      return { mods: 8, aura: false, exilus: true, stance: true, arcanes: 1 };
    case "primary":
    case "secondary":
      return { mods: 8, aura: false, exilus: true, stance: false, arcanes: 1 };
    case "archgun":
      return { mods: 8, aura: false, exilus: false, stance: false, arcanes: 1 };
    case "amp":
      return { mods: 0, aura: false, exilus: false, stance: false, arcanes: 2 };
    case "exalted":
      return { mods: 8, aura: false, exilus: false, stance: true, arcanes: 0 };
    default:
      return { mods: 8, aura: false, exilus: false, stance: false, arcanes: 0 };
  }
}

/** Kuva, Tenet and Coda weapons and Paracesis: each Forma adds two ranks, to 40 at five (the same test as acquire.ts' masteryPoints). */
export const FORTY_BY_FORMA = (name: string) => /^(Kuva|Tenet|Coda|Dual Coda) /.test(name) || name === "Paracesis";
/** Necramechs reach rank 40 by affinity alone, no Forma. Unverified: the sources say rank 40, not how. */
export const NECRAMECH_RANK = 40;

/** The rank (so the base capacity) an item reaches with this much Forma on it. */
export function rankWith(item: Pick<CatalogItem, "name">, kind: GearKind, forma: number): number {
  if (kind === "necramech") return NECRAMECH_RANK;
  if (FORTY_BY_FORMA(item.name)) return 30 + 2 * Math.min(5, Math.max(0, forma));
  return 30;
}

/** Orokin Reactor for frames, companions, archwings and Necramechs; Catalyst for weapons. */
export function usesReactor(kind: GearKind): boolean {
  return kind === "warframe" || kind === "companion" || kind === "archwing" || kind === "necramech" || kind === "exalted";
}
export const doublerName = (kind: GearKind) => (kind === "exalted" ? "the frame's Orokin Reactor" : usesReactor(kind) ? "an Orokin Reactor" : "an Orokin Catalyst");
export const doublerShort = (kind: GearKind) => (usesReactor(kind) ? "Reactor" : "Catalyst");

// ---------------------------------------------------------------- what fits

/** compatName values that cover a whole class, not one item. */
const GENERIC_COMPAT = new Set(["warframe", "aura", "any", "primary", "rifle", "shotgun", "pistol", "melee", "assault rifle", "sniper", "bow", "archgun", "archmelee", "archwing", "necramech", "companion", "robotic", "beast", "claws", "hound", "moa", "sentinel", "kavat", "k-drive", "thrown melee", "thrown", "tome", "parazon", "unique"]);

/** Mod types each kind of gear takes. */
const MOD_TYPES: Record<GearKind, string[]> = {
  warframe: ["Warframe Mod", "Peculiar Mod"],
  primary: ["Primary Mod", "Shotgun Mod"],
  secondary: ["Secondary Mod"],
  melee: ["Melee Mod", "Stance Mod"],
  companion: ["Companion Mod"],
  // Companion weapons take rifle, shotgun, pistol or melee mods by what they are; the catalog doesn't say which.
  companionWeapon: ["Primary Mod", "Shotgun Mod", "Secondary Mod", "Melee Mod"],
  archwing: ["Archwing Mod"],
  archgun: ["Arch-Gun Mod"],
  archmelee: ["Arch-Melee Mod"],
  necramech: ["Necramech Mod"],
  exalted: ["Melee Mod", "Primary Mod", "Secondary Mod", "Stance Mod"],
  amp: [],
  kdrive: ["K-Drive Mod"],
};

const base = (s: string) => s.toLowerCase().replace(/\s+(prime|umbra|vandal|wraith|prisma|kuva|tenet|coda|mk1-)$/, "").trim();

/**
 * Whether a mod fits an item: true, false, or "maybe" when the catalog can't tell (a stance for a
 * weapon class, a mod for one kind of companion weapon). `why` says what it is for when it doesn't.
 */
export function modFits(mod: CatalogItem, item: CatalogItem, kind: GearKind): { fits: true | false | "maybe"; why?: string } {
  const types = MOD_TYPES[kind];
  const t = mod.type ?? "";
  if (!types.includes(t)) return { fits: false, why: t ? `a ${t.replace(/ Mod$/, "").toLowerCase()} mod` : "not a mod for this" };
  const compat = (mod.compatName ?? "").trim().toLowerCase();
  // Shotguns take shotgun mods (and the few for every primary); rifles, bows and snipers the rest.
  if (kind === "primary" && item.type === "Shotgun" && t === "Primary Mod" && compat !== "primary" && GENERIC_COMPAT.has(compat)) return { fits: false, why: "a rifle mod" };
  if (kind === "primary" && item.type !== "Shotgun" && t === "Shotgun Mod") return { fits: false, why: "a shotgun mod" };
  if (kind === "primary" && compat === "sniper" && item.type !== "Sniper") return { fits: false, why: "for snipers" };
  if (kind === "primary" && compat === "bow" && item.type !== "Bow") return { fits: false, why: "for bows" };
  if (kind === "primary" && compat === "assault rifle" && item.type !== "Rifle") return { fits: false, why: "for assault rifles" };
  if (kind === "secondary" && compat === "thrown" && item.type !== "Throwing") return { fits: false, why: "for thrown secondaries" };
  if (kind === "companion") {
    const robotic = item.category === "Sentinels" || /Moa|Zanuka|Hound/i.test(item.uniqueName);
    if ((compat === "robotic" || compat === "sentinel") && !robotic) return { fits: false, why: `for ${compat === "robotic" ? "robotic companions" : "sentinels"}` };
    if ((compat === "beast" || compat === "claws" || compat === "kavat") && robotic) return { fits: false, why: "for beasts" };
    if (compat === "moa" && !/Moa/i.test(item.uniqueName)) return { fits: false, why: "for MOAs" };
    if (compat === "hound" && !/Zanuka|Hound/i.test(item.uniqueName)) return { fits: false, why: "for Hounds" };
  }
  if (t === "Stance Mod") return kind === "melee" || kind === "exalted" ? { fits: "maybe" } : { fits: false, why: "a stance" };
  if (kind === "companionWeapon" || kind === "exalted") return { fits: "maybe" };
  if (compat && !GENERIC_COMPAT.has(compat)) {
    // An augment or a mod for one item ("Excalibur", "Paris Prime", "Ripkas"): only that item, or its versions.
    const name = item.name.toLowerCase();
    if (name.includes(compat) || base(name) === base(compat)) return { fits: true };
    return { fits: false, why: `for ${mod.compatName}` };
  }
  return { fits: true };
}

/** Arcane types each kind of gear takes. */
export function arcaneFits(arcane: CatalogItem, item: CatalogItem, kind: GearKind): { fits: true | false | "maybe"; why?: string } {
  const t = arcane.type ?? "";
  const fam = familyOf(item.uniqueName)?.id;
  const ok: string[] =
    kind === "warframe" ? ["Warframe Arcane"]
    : kind === "primary" ? ["Primary Arcane", ...(item.type === "Shotgun" ? ["Shotgun Arcane"] : []), ...(item.type === "Bow" ? ["Bow Arcane"] : []), ...(fam === "kitgun" ? ["Kitgun Arcane"] : [])]
    : kind === "secondary" ? ["Secondary Arcane", ...(fam === "kitgun" ? ["Kitgun Arcane"] : [])]
    : kind === "melee" ? ["Melee Arcane", ...(fam === "zaw" ? ["Zaw Arcane"] : [])]
    : kind === "amp" ? ["Amp Arcane"]
    : [];
  if (ok.includes(t)) return { fits: true };
  // A few arcanes are filed as plain "Arcane" (the Zid-An ones and the like): can't tell.
  if (t === "Arcane" && ok.length) return { fits: "maybe" };
  return { fits: false, why: t ? `a ${t.replace(/ Arcane$/, "").toLowerCase()} arcane` : "not an arcane for this" };
}

/**
 * Whether an arcane on this gear needs an Arcane Adapter: primaries, secondaries, melee and arch-guns
 * do, kitguns and zaws have a slot of their own. Unverified for Tenet and Incarnon weapons.
 */
export function arcaneNeedsAdapter(item: CatalogItem, kind: GearKind): boolean {
  const fam = familyOf(item.uniqueName)?.id;
  if (fam === "kitgun" || fam === "zaw") return false;
  return kind === "primary" || kind === "secondary" || kind === "melee" || kind === "archgun";
}
