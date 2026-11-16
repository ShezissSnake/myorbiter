// What a piece of gear takes: its kind, slots, rank, and which mods and arcanes fit it.

import { familyOf } from "../modular";
import type { CatalogItem } from "../types";
import type { GearKind } from "./types";

/**
 * Items the catalog files with gear that take no mods in the game: the Helminth (under Warframes,
 * as `/PowersuitAbilities/Helminth`) and a frame's own companion, Khora's Venari and Venari Prime
 * (under Pets, with paths under `/Lotus/Powersuits/`).
 */
export function takesNoBuild(item: Pick<CatalogItem, "uniqueName" | "category">): boolean {
  const u = item.uniqueName ?? "";
  return /\/PowersuitAbilities\//.test(u) || (item.category === "Pets" && u.startsWith("/Lotus/Powersuits/"));
}

/** The kind of gear a catalog item is, or null for anything that takes no build. */
export function gearKindOf(item: Pick<CatalogItem, "uniqueName" | "category" | "type" | "productCategory">): GearKind | null {
  const { category: cat, type: t, productCategory: pc } = item;
  if (takesNoBuild(item)) return null;
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

// ---------------------------------------------------------------- melee class (for stances and class mods)

// The catalog doesn't say a melee weapon's class, so the stance comes from this: folders in the
// weapon's path that name one clearly, then a short list of popular weapons whose folders don't.
const MELEE_FOLDER: Record<string, string> = {
  Polearms: "Polearms",
  Polearm: "Polearms",
  Staff: "Staves",
  Hammer: "Hammers",
  Whip: "Whips",
  Whips: "Whips",
  Glaive: "Glaives",
  Glaives: "Glaives",
  Nunchaku: "Nunchaku",
  Tonfa: "Tonfas",
  Warfan: "Warfans",
  Gunblade: "Gunblade",
  Scythe: "Scythes",
  HeavyScythe: "Heavy Scythe",
  DualDagger: "Dual Daggers",
  DualDaggers: "Dual Daggers",
  Dagger: "Daggers",
  Claws: "Claws",
  GrineerClaws: "Claws",
  Gauntlet: "Fists",
  Fist: "Fists",
  SwordsAndBoards: "Sword And Shield",
  LongSword: "Swords",
  DualShortSword: "Dual Swords",
  GreatSword: "Heavy Blade",
  Nikana: "Nikanas",
  Tonfas: "Tonfas",
  CrpTonfa: "Tonfas",
  DualKamas: "Dual Swords",
  PrimeDualKamas: "Dual Swords",
  InfWarfan: "Warfans",
  InfBoomerang: "Glaives",
  GrnBoomerang: "Glaives",
  GrineerCombatKnife: "Daggers",
  GrnTrident: "Polearms",
  GrineerHalberd: "Polearms",
  GrineerJetPoweredPolearm: "Hammers",
  KickAndPunch: "Sparring",
  GrnSparring: "Sparring",
  PersianMachete: "Machetes",
  Maces: "Hammers",
  InfEmbolistScythe: "Scythes",
  InfTransformClaw: "Claws",
};
const MELEE_NAME: Record<string, string> = {
  Gram: "Heavy Blade",
  Galatine: "Heavy Blade",
  Scindo: "Heavy Blade",
  Paracesis: "Heavy Blade",
  Zenistar: "Heavy Blade",
  Nikana: "Nikanas",
  "Dragon Nikana": "Nikanas",
  Skiajati: "Nikanas",
  Tatsu: "Two-Handed Nikana",
  "Broken War": "Swords",
  "Dakra Prime": "Swords",
  Cronus: "Swords",
  "Jaw Sword": "Swords",
  Krohkur: "Swords",
  Destreza: "Rapiers",
  Lacera: "Blade And Whip",
  "Ceti Lacera": "Blade And Whip",
  Atterax: "Whips",
  Lesion: "Polearms",
  Ripkas: "Claws",
  Venka: "Claws",
  Kogake: "Sparring",
  Hirudo: "Sparring",
  "Coda Hirudo": "Sparring",
  Ankyros: "Fists",
  Tekko: "Fists",
  Fragor: "Hammers",
  Volnus: "Hammers",
  "Kuva Shildeg": "Hammers",
  "Arca Titron": "Hammers",
  "Ack & Brunt": "Sword And Shield",
  "Silva & Aegis": "Sword And Shield",
  "Cobra & Crane": "Sword And Shield",
  "Tenet Agendus": "Sword And Shield",
  "Tenet Grigori": "Scythes",
  "Kuva Ghoulsaw": "Assault Saw",
  Ghoulsaw: "Assault Saw",
  "Dual Zoren": "Dual Swords",
  "Twin Basolk": "Dual Swords",
  "Dual Ichor": "Dual Swords",
  Orthos: "Polearms",
  Guandao: "Polearms",
  Reaper: "Scythes",
  Bo: "Staves",
  Tipedo: "Staves",
  Kronen: "Tonfas",
  Ninkondi: "Nunchaku",
  Fang: "Dual Daggers",
  Redeemer: "Gunblade",
  Stropha: "Gunblade",
  Sarpa: "Gunblade",
  Vastilok: "Gunblade",
  War: "Heavy Blade",
  Pennant: "Heavy Blade",
  Sarofang: "Heavy Blade",
  "Tenet Exec": "Heavy Blade",
  "Broken Scepter": "Staves",
  "Mk1-Bo": "Staves",
  "Mk1-Furax": "Fists",
  "Dark Sword": "Swords",
  "Dark Split-Sword": "Dual Swords",
  "Dex Dakra": "Swords",
  "Dex Nikana": "Nikanas",
  "Heat Sword": "Swords",
  "Plasma Sword": "Swords",
  "Pangolin Sword": "Swords",
  Pangolin: "Swords",
  Mire: "Swords",
  "Coda Mire": "Swords",
  "Nami Skyla": "Dual Swords",
  "Dual Keres": "Dual Swords",
  "Dual Kamas": "Dual Swords",
  "Dual Raza": "Dual Swords",
  "Dual Cleavers": "Dual Swords",
  "Twin Krohkur": "Dual Swords",
  Okina: "Dual Daggers",
  Karyst: "Daggers",
  "Rakta Dark Dagger": "Daggers",
  Endura: "Rapiers",
  Kama: "Machetes",
  Machete: "Machetes",
  Halikar: "Glaives",
  "Coda Pathocyst": "Glaives",
  "Coda Caustacyst": "Scythes",
  "Coda Motovore": "Hammers",
  "Sancti Magistar": "Hammers",
  "Synoid Heliocor": "Hammers",
  "Telos Boltace": "Tonfas",
  "Secura Lecta": "Whips",
  "Vaykor Sydon": "Polearms",
  Korumm: "Polearms",
};
const stem = (name: string) => name.replace(/\s+(Prime|Wraith|Vandal)$/, "").replace(/^Prisma\s+/, "");

/** The melee class for stances ("Heavy Blade"), or null when MyOrbiter can't tell. */
export function meleeClassOf(item: CatalogItem): string | null {
  const byName = MELEE_NAME[item.name] ?? MELEE_NAME[stem(item.name)];
  if (byName) return byName;
  const parts = item.uniqueName.split("/");
  const at = parts.indexOf("Melee");
  const folder = at >= 0 ? parts[at + 1] : undefined;
  return folder ? MELEE_FOLDER[folder] ?? null : null;
}

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

/**
 * What a mod is for, by slot: an aura (the catalog's compatName "AURA"), a stance, or a mod for the
 * regular slots (the exilus slot among them).
 */
export type ModRole = "aura" | "stance" | "mod";
export function modRole(mod: Pick<CatalogItem, "compatName" | "type">): ModRole {
  if ((mod.compatName ?? "").trim().toUpperCase() === "AURA") return "aura";
  if (mod.type === "Stance Mod") return "stance";
  return "mod";
}

/** Melee classes a melee mod's compatName can name ("Polearms", "Dual Daggers"): the classes meleeClassOf gives. */
const MELEE_CLASSES = new Set([...Object.values(MELEE_FOLDER), ...Object.values(MELEE_NAME)].map((c) => c.toLowerCase()));

/**
 * Beast claws a companion mod's compatName can name, by the companion's path: Kubrows and Kavats
 * under /Types/Game/, the Helminth Charger (a Kubrow) by its own. Predasites and Vulpaphylas
 * (/CreaturePets/, "…PredatorKubrowPet…", "…InfestedCatbrowPet…") are left as "can't tell".
 */
const CLAWS: Record<string, { fits: RegExp; maybe: RegExp | null; what: string }> = {
  "kubrow claws": { fits: /\/Game\/KubrowPet\//, maybe: /\/CreaturePets\/\w*KubrowPet/, what: "Kubrows" },
  "kavat claws": { fits: /\/Game\/CatbrowPet\//, maybe: /\/CreaturePets\/\w*CatbrowPet/, what: "Kavats" },
  "helminth claws": { fits: /\/Game\/KubrowPet\/ChargerKubrowPet/, maybe: null, what: "the Helminth Charger" },
};

/**
 * A name without what marks a version of the same frame or weapon: Prime, Umbra, Vandal or Wraith
 * after it, Prisma, MK1-, Kuva, Tenet, Coda, Carmine or a syndicate's word before it ("Vaykor Hek"
 * is a Hek).
 */
const ownName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(prime|umbra|vandal|wraith)$/, "")
    .replace(/^(mk1-\s*|(prisma|kuva|tenet|coda|carmine|vaykor|rakta|secura|sancti|synoid|telos)\s+)/, "");

/**
 * Whether a mod fits an item: true, false, or "maybe" when the catalog can't tell (a stance for a
 * weapon class, a mod for one kind of companion weapon, a class mod on a weapon of no class MyOrbiter
 * knows, a condition such as "(No Aoe)"). `why` says what it is for when it doesn't.
 */
export function modFits(mod: CatalogItem, item: CatalogItem, kind: GearKind): { fits: true | false | "maybe"; why?: string } {
  const types = MOD_TYPES[kind];
  const t = mod.type ?? "";
  if (!types.includes(t)) return { fits: false, why: t ? `a ${t.replace(/ Mod$/, "").toLowerCase()} mod` : "not a mod for this" };
  const raw = (mod.compatName ?? "").trim().toLowerCase();
  // A class with a condition ("Pistol (No Aoe)", "Rifle (No Aoe)"): the class's rules, and "maybe"
  // at the end, since the catalog doesn't say which weapons the condition leaves out.
  const qualified = /^(.+?)\s*\(([^)]*)\)$/.exec(raw);
  const compat = qualified && GENERIC_COMPAT.has(qualified[1]) ? qualified[1] : raw;
  const fitting = compat !== raw ? ({ fits: "maybe" } as const) : ({ fits: true } as const);
  // Shotguns take shotgun mods (and the few for every primary); rifles, bows and snipers the rest.
  if (kind === "primary" && item.type === "Shotgun" && t === "Primary Mod" && compat !== "primary" && GENERIC_COMPAT.has(compat)) return { fits: false, why: "a rifle mod" };
  if (kind === "primary" && item.type !== "Shotgun" && t === "Shotgun Mod") return { fits: false, why: "a shotgun mod" };
  if (kind === "primary" && compat === "sniper" && item.type !== "Sniper") return { fits: false, why: "for snipers" };
  if (kind === "primary" && compat === "bow" && item.type !== "Bow") return { fits: false, why: "for bows" };
  if (kind === "primary" && compat === "assault rifle" && item.type !== "Rifle") return { fits: false, why: "for assault rifles" };
  if (kind === "secondary" && compat === "thrown" && item.type !== "Throwing") return { fits: false, why: "for thrown secondaries" };
  if (kind === "companion") {
    const robotic = item.category === "Sentinels" || /Moa|Zanuka|Hound/i.test(item.uniqueName);
    const claws = CLAWS[compat];
    if ((compat === "robotic" || compat === "sentinel") && !robotic) return { fits: false, why: `for ${compat === "robotic" ? "robotic companions" : "sentinels"}` };
    if ((compat === "beast" || compat === "claws" || compat === "kavat" || claws) && robotic) return { fits: false, why: "for beasts" };
    if (compat === "moa" && !/Moa/i.test(item.uniqueName)) return { fits: false, why: "for MOAs" };
    if (compat === "hound" && !/Zanuka|Hound/i.test(item.uniqueName)) return { fits: false, why: "for Hounds" };
    if (claws) return claws.fits.test(item.uniqueName) ? { fits: true } : claws.maybe?.test(item.uniqueName) ? { fits: "maybe" } : { fits: false, why: `for ${claws.what}` };
    // A mod for one breed ("Kubrow", "Predasite", "Vulpaphyla"): a companion whose name ends in that word.
    if (compat && !GENERIC_COMPAT.has(compat) && !compat.includes(" ")) {
      return item.name.toLowerCase().split(/\s+/).includes(compat) ? { fits: true } : { fits: false, why: `for ${mod.compatName}` };
    }
  }
  if (t === "Stance Mod") return kind === "melee" || kind === "exalted" ? { fits: "maybe" } : { fits: false, why: "a stance" };
  if (kind === "companionWeapon" || kind === "exalted") return { fits: "maybe" };
  // A melee mod for one class ("Polearms", "Dual Daggers"): the weapons of that class.
  if (t === "Melee Mod" && MELEE_CLASSES.has(compat)) {
    const cls = meleeClassOf(item);
    if (!cls) return { fits: "maybe" };
    return cls.toLowerCase() === compat ? { fits: true } : { fits: false, why: `for ${mod.compatName}` };
  }
  if (compat && !GENERIC_COMPAT.has(compat)) {
    // An augment or a mod for one item ("Excalibur", "Paris Prime", "Ripkas"): that item's own name,
    // whole, or a version of it (Excalibur Umbra, Prisma Skana), never one that only contains it
    // (Akmagnus, Dual Skana).
    if (ownName(item.name) === ownName(compat)) return { fits: true };
    return { fits: false, why: `for ${mod.compatName}` };
  }
  return fitting;
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
