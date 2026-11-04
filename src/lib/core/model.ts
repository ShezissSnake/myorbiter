// One pass over the bundle that builds every lookup the views need.

import { imprintCounts, type ImprintRaw } from "./imprints";
import type { RecipeData } from "./buildPlan";
import { familyOf, GILDED, MOTE, MOTE_HELD_AS, type ModularHave } from "./modular";
import type { GearCopy } from "./notNeeded";
import type {
  Bundle,
  CatalogItem,
  Component,
  InventoryRow,
  Live,
  RelicEntry,
  RelicReward,
} from "./types";

export const REFINEMENTS = ["Intact", "Exceptional", "Flawless", "Radiant"] as const;
export type Refinement = (typeof REFINEMENTS)[number];
export const ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Vanguard"] as const;

const RARITY_CHANCE: Record<string, [string, number][]> = {
  Intact: [["Common", 25.33], ["Uncommon", 11], ["Rare", 2]],
  Exceptional: [["Common", 23.33], ["Uncommon", 13], ["Rare", 4]],
  Flawless: [["Common", 20], ["Uncommon", 17], ["Rare", 6]],
  Radiant: [["Common", 16.67], ["Uncommon", 20], ["Rare", 10]],
};

/**
 * A relic reward's rarity, read from its chance at that refinement. The relic data files commons
 * as "Uncommon" (25.33% at Intact), so the label it gives can't be trusted; a chance that matches
 * no tier (two rewards merged into one, an odd relic) keeps the label it came with.
 */
/**
 * Relics have one picture per era and refinement, not one each: any name that is a relic ("Lith
 * A13", "Neo V8 Radiant", "Axi C12 Relic", "Requiem Eterna Intact") gets its era's, intact unless
 * it names another refinement. The game files call Requiem relics "Immortal".
 */
const REFINEMENT_LETTER: Record<string, string> = { Exceptional: "A", Flawless: "B", Radiant: "C", Intact: "D" };
export function relicImage(name: string): string | null {
  const m = name.match(/^(Lith|Meso|Neo|Axi|Requiem) \S+(?: (Intact|Exceptional|Flawless|Radiant))?(?: Relic)?$/i);
  if (!m) return null;
  const era = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const ref = m[2] ? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : "Intact";
  return `Relic${era === "Requiem" ? "Immortal" : era}${REFINEMENT_LETTER[ref]}.png`;
}

export function relicRewardRarity(refinement: string, chance: number | null | undefined, given: string | null | undefined): string {
  const tiers = RARITY_CHANCE[refinement];
  if (tiers && chance != null) for (const [rarity, c] of tiers) if (Math.abs(chance - c) < 0.05) return rarity;
  return given ?? "";
}

/** Founders and other items nobody can get any more. Hidden from the mastery to-do by default. */
export const UNOBTAINABLE = new Set(["Excalibur Prime", "Skana Prime", "Lato Prime"]);

export interface PrimePart {
  fullName: string; // the trade name, e.g. "Rhino Prime Chassis Blueprint"
  componentUnique: string;
  parentUnique: string;
  parentName: string;
  required: number;
  ducats: number;
}

export interface RelicSource {
  base: string; // "Axi R1"
  rarity: string;
  chanceIntact: number;
  chanceRadiant: number;
  vaulted: boolean;
  resurgence: boolean;
}

export interface RelicGroup {
  base: string;
  era: string;
  vaulted: boolean;
  resurgence: boolean;
  byRefinement: Partial<Record<Refinement, RelicEntry>>;
}

export interface Model {
  observedAt: Date | null;
  priceDate: string | null;
  catalogByUnique: Map<string, CatalogItem>;
  inventoryByBase: Map<string, InventoryRow[]>;
  mastered: Set<string>;
  primeParents: CatalogItem[];
  partsByParent: Map<string, PrimePart[]>;
  partByName: Map<string, PrimePart[]>;
  /** Inventory rows by item name, for things whose path differs from warframe.market's. */
  inventoryByName: Map<string, InventoryRow[]>;
  /** Every item name in the catalog: an item it knows that you don't hold is a known zero. */
  catalogNames: Set<string>;
  /** Tradable prime parts in your inventory, by trade name. */
  ownedPartQty: Map<string, number>;
  /** Prime parts being crafted in the foundry (no longer tradable, but no longer needed either). */
  craftingPartQty: Map<string, number>;
  /** Copies of a prime part you have toward building its item: held plus being crafted. */
  partHave(name: string): number;
  relicGroups: Map<string, RelicGroup>;
  relicByUnique: Map<string, RelicEntry>;
  /** Display name for an item or component path, store paths included. */
  nameOf(path: string): string;
  /** WFCD image file name for an item, part, mod, arcane or relic ("Axi A1"), if known. */
  imageOf(name: string): string | null;
  sourcesByReward: Map<string, RelicSource[]>;
  ownedRelicCount: Map<string, number>; // by base, all refinements
  price(name: string): number | null;
  priceMax(name: string): number | null;
  tradesPerDay(name: string): number | null;
  /** On how many days it sold lately (TennoScope's trade count window). */
  saleDays(name: string): number | null;
  /** A relic's price on warframe.market: intact, or radiant when asked (null if unknown). */
  relicPrice(base: string, refinement?: string): number | null;
  /** Copies you hold, counting one being built in the foundry (you'll have it once it's claimed). */
  owned(unique: string): number;
  /** Copies of an item being built in the foundry right now. */
  building(unique: string): number;
  /** How many of this recipe are building in the foundry right now. */
  inFoundry(recipe: string): number;
  isMastered(unique: string): boolean;
  inResurgence(unique: string): boolean;
  live: Live;
  /** Imprints you hold, by the breed's companion path ("" for a breed orbiter couldn't read); null before TennoScope has passed any. */
  imprints: Map<string, number> | null;
  /** Every Foundry recipe, parts' own included (recipes.rs); null until read. */
  recipes: RecipeData | null;
  /** Each copy of your gear, as the patched TennoScope read it; null before it has. */
  gear: GearCopy[] | null;
  /**
   * Your copies of one item (by path), as the patched TennoScope read them: their Forma, feature
   * bits, slot polarities, archon shards and Helminth abilities (notNeeded.ts reads those). Empty
   * when you hold none, or before TennoScope has passed your gear.
   */
  gearOf(path: string): GearCopy[];
  /** The warframes you fed to the Helminth (their abilities are subsumed), by path; null before a patched TennoScope passed them. */
  consumedSuits: Set<string> | null;
  /**
   * A kitgun chamber, zaw strike, amp prism, MOA or hound model, Predasite or Vulpaphyla, or K-Drive
   * board: the parts you hold, the copies built from it and how many of those are gilded (modular.ts).
   * Null for anything else.
   */
  modular(unique: string): ModularHave | null;
}

export function baseId(itemId: string): string {
  const i = itemId.indexOf("#");
  return i < 0 ? itemId : itemId.slice(0, i);
}

/** One piece of a set that isn't prime: a blueprint or part its recipe takes. */
export interface GearSetPart {
  unique: string;
  /** warframe.market's name for it: "Mandonel Barrel". */
  name: string;
  required: number;
}

/**
 * What warframe.market sells together as a set that isn't prime ("Mandonel Set", "Lato Vandal
 * Set", "Voidrig Set"): the blueprint and the parts the recipe takes, not its resources. Null for prime sets
 * (partsByParent has those) and for anything without parts.
 */
export function gearSetParts(m: Model, unique: string): GearSetPart[] | null {
  if (m.partsByParent.has(unique)) return null;
  const item = m.catalogByUnique.get(unique);
  // Necramechs and their arch-guns (Voidrig, Cortege) keep their parts under /Resources/Mechs/,
  // and warframe.market's set is those parts alone: the blueprint (Necraloid's) isn't in it.
  const mech = (item?.components ?? []).some((c) => c.uniqueName.includes("/Resources/Mechs/"));
  const parts = (item?.components ?? [])
    .filter((c) => (mech ? c.uniqueName.includes("/Resources/Mechs/") : c.uniqueName.includes("/Recipes/")))
    .map((c) => ({ unique: baseId(c.uniqueName), name: c.name.startsWith(item!.name) ? c.name : `${item!.name} ${c.name}`, required: c.itemCount ?? 1 }));
  return parts.length ? parts : null;
}

/** How many of a thing you hold, every copy of it in your inventory. */
export function heldCount(m: Model, unique: string): number {
  return (m.inventoryByBase.get(unique) ?? []).reduce((n, r) => n + r.quantity, 0);
}

/**
 * Relics TennoScope only knows by their path show up under a name made from it ("T 4 Void
 * Projection Citrine Prime C Bronze"). Their real name comes from the relic list, which the drop
 * tables bring up to date (relicData.ts): "Axi C13 Intact".
 */
export function withKnownNames(bundle: Bundle): Bundle {
  const relic = (r: InventoryRow) => r.category === "relic" && !splitRelicName(r.name);
  // By the path without its rank ("…AvatarSlideBoostMod#5").
  const known = (r: InventoryRow) => NAME_BY_PATH[r.item_id.split("#")[0]];
  if (!bundle.inventory.some((r) => relic(r) || known(r))) return bundle;
  const byPath = new Map(bundle.relics.map((r) => [r.uniqueName, r.name]));
  return {
    ...bundle,
    inventory: bundle.inventory.map((r) => {
      if (known(r)) return { ...r, name: known(r) };
      if (!relic(r)) return r;
      const name = byPath.get(r.item_id);
      return name && splitRelicName(name) ? { ...r, name } : r;
    }),
  };
}

/**
 * Items the catalog doesn't carry, so TennoScope names them from their path: the Zid-An arcanes
 * ("Ultimate Invisibilty" is Zid-An Sek-Eel), a few mods ("Avatar Slide Boost Mod" is Maglev).
 * Names as warframe.market lists them by path.
 */
export const NAME_BY_PATH: Record<string, string> = {
  "/Lotus/Upgrades/CosmeticEnhancers/Antiques/UltimateInvisibilty": "Zid-An Sek-Eel",
  "/Lotus/Upgrades/CosmeticEnhancers/Antiques/StatusChanceOnUltimateHit": "Zid-An Asheir",
  "/Lotus/Upgrades/CosmeticEnhancers/Antiques/HeatStatusProcOnUltimateKill": "Zid-An Uskos",
  "/Lotus/Upgrades/CosmeticEnhancers/Antiques/AmmoEfficencyDuringUltimate": "Zid-An Haras",
  "/Lotus/Upgrades/CosmeticEnhancers/Antiques/VoidSlingsOverguardStrip": "Zid-An Osbok",
  // Mods the catalog has only as their Beginner versions.
  "/Lotus/Upgrades/Mods/Warframe/AvatarSlideBoostMod": "Maglev",
  "/Lotus/Upgrades/Mods/Warframe/AvatarPowerToHealthOnDeathMod": "Quick Thinking",
  "/Lotus/Weapons/Tenno/Melee/MeleeTrees/StaffCmbOneMeleeTree": "Clashing Forest",
  "/Lotus/Types/Sentinels/SentinelPrecepts/LocateCreatures": "Scan Aquatic Lifeforms",
};

export function splitRelicName(name: string): { base: string; refinement: Refinement } | null {
  // A read with a nameless row: no relic to split (withKnownNames may still name it by its path).
  if (typeof name !== "string") return null;
  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length < 3) return null;
  // Requiem Eterna can't be refined: the game calls it "Requiem Eterna Relic". It's an intact one.
  if (last === "Relic") return { base: parts.slice(0, -1).join(" "), refinement: "Intact" };
  if (!REFINEMENTS.includes(last as Refinement)) return null;
  return { base: parts.slice(0, -1).join(" "), refinement: last as Refinement };
}

const BLUEPRINT_SUFFIXED = new Set(["Neuroptics", "Chassis", "Systems", "Harness", "Wings"]);

/** Builds the name a part is traded and listed under from its parent and component name. */
export function partFullName(parent: CatalogItem, comp: Component): string {
  if (comp.name === "Blueprint") return `${parent.name} Blueprint`;
  // Necramech parts come named already ("Bonewidow Capsule").
  if (comp.name.startsWith(`${parent.name} `)) return comp.name;
  if (
    (parent.category === "Warframes" || parent.category === "Archwing") &&
    BLUEPRINT_SUFFIXED.has(comp.name)
  ) {
    return `${parent.name} ${comp.name} Blueprint`;
  }
  return `${parent.name} ${comp.name}`;
}

/** Varzia's stock uses StoreItems paths; strip that and a relic's refinement suffix. */
export function normaliseStoreUnique(unique: string): string {
  return unique.replace("/Lotus/StoreItems/", "/Lotus/").replace(/(Bronze|Silver|Gold|Platinum)$/, "");
}

/**
 * `foundry`: builds waiting in your foundry, by recipe path, as TennoScope last read them (null
 * when it hasn't this run). A part being crafted counts toward building its item (not as a part
 * you could trade); an item being built counts as owned.
 */
/**
 * Relic prices by refinement, read from warframe.market's sales (TennoScope's daily prices mostly
 * have the intact one only): by relic ("Axi A1"), then by refinement in its words ("radiant").
 * `how` marks prices taken as the middle sale (older reads averaged them, and are read again).
 */
export type RelicMarket = Record<string, { at: number; prices: Record<string, number>; how?: "median" }>;

/**
 * Things that give mastery but aren't in the catalog TennoScope carries (WFCD files them as parts,
 * not masterable): amp prisms (mastery goes by the prism, once the amp is gilded), the Infested
 * kitgun chambers, and the Plexus (Railjack: 200 a rank to 30). Added unless the catalog has them.
 */
export const EXTRA_MASTERABLE: CatalogItem[] = [
  {"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingBarrel", "name": "Mote Amp", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartA", "name": "Raplak Prism", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartB", "name": "Shwaak Prism", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartC", "name": "Granmu Prism", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set2/Barrel/SentAmpSet2BarrelPartA", "name": "Rahn Prism", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Barrel/CorpAmpSet1BarrelPartA", "name": "Cantic Prism", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Barrel/CorpAmpSet1BarrelPartB", "name": "Lega Prism", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Barrel/CorpAmpSet1BarrelPartC", "name": "Klamora Prism", "category": "Misc", "type": "Amp", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Infested/Pistols/InfKitGun/Barrels/InfBarrelEgg/InfModularBarrelEggPart", "name": "Sporelacer", "category": "Misc", "type": "Kitgun Component", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Weapons/Infested/Pistols/InfKitGun/Barrels/InfBarrelBeam/InfModularBarrelBeamPart", "name": "Vermisplicer", "category": "Misc", "type": "Kitgun Component", "masterable": true, "tradable": false},
  {"uniqueName": "/Lotus/Types/Game/CrewShip/RailJack/DefaultHarness", "name": "Plexus", "category": "Misc", "type": "Plexus", "masterable": true, "tradable": false}
];
/**
 * The Railjack's Plexus. The game lists it (with its XP) once you have one, but with no count: being
 * listed at all means you have one, on every page that asks what you own.
 */
const PLEXUS = "/Lotus/Types/Game/CrewShip/RailJack/DefaultHarness";
/** Held as something else: the game gives the Mote Amp as a built training amp. */
const HELD_AS: Record<string, string> = { [MOTE]: MOTE_HELD_AS };
/** The Plexus is mastered at rank 30: 200 a rank, so 1,000 × 30² affinity. */
const PLEXUS_MASTERED_XP = 900_000;

/** Categories the catalog TennoScope carries has wrong (WFCD and the wiki agree on these). */
const CATEGORY_NOW: Record<string, string> = { "/Lotus/Weapons/Tenno/Archwing/Melee/PrimeCorufell/PrimeCorufellScytheWeapon": "Melee" };

/**
 * Ducat values the game changed since the catalog TennoScope carries was made (wiki, WFCD). Not the
 * Bronco Prime Barrel: it is an uncommon reward and 45 ducats (the wiki's Ducats/Prices table), as
 * the catalog says; an override of 25 here once had the Bronco Prime Set's 75 ducats count as 55.
 */
const DUCATS_NOW: Record<string, number> = { "Nami Skyla Prime Blade": 65 };

/**
 * Catalog entries marked masterable that give no mastery of their own: Sirius & Orion's second son
 * (the pair counts once, under Sirius & Orion), and the second Grimoire the game keeps for the
 * Doppelganger (only the Tenno one counts). Left in, they'd sit on Mastery as never finished.
 */
export const NO_MASTERY = new Set(["/Lotus/Powersuits/SiriusOrion/OrionSuit", "/Lotus/Weapons/Tenno/Grimoire/TnDoppelgangerGrimoire"]);

interface CatalogPart {
  /** The catalog as the views read it: the extra masterables added, known mistakes fixed. */
  catalog: CatalogItem[];
  catalogByUnique: Map<string, CatalogItem>;
  primeParents: CatalogItem[];
  partsByParent: Map<string, PrimePart[]>;
  partByName: Map<string, PrimePart[]>;
  partByComponentUnique: Map<string, string>;
  /** Every item's own blueprint, primes and non-primes alike: blueprint path to the item's. */
  mainBlueprint: Map<string, string>;
  /** Each path's name: the items', then their prime parts' trade names. */
  nameByUnique: Map<string, string>;
  catalogNames: Set<string>;
  /** Image file names by name: each item's, then its parts' (the first of a name wins). */
  imageByName: Map<string, string>;
}

/**
 * The parts of a model worked out from a catalog alone, kept per catalog (a model never changes
 * what it's given). The length guards against a catalog grown in place.
 */
const catalogParts = new WeakMap<readonly CatalogItem[], { length: number; part: CatalogPart }>();
function catalogPart(raw: CatalogItem[]): CatalogPart {
  const hit = catalogParts.get(raw);
  if (hit && hit.length === raw.length) return hit.part;
  // Some items list the same component twice (Akbronco Prime: two Bronco Prime, one each); merge
  // them so it reads as one component needed twice.
  const known = new Set(raw.map((c) => c.uniqueName));
  const extra = new Map(EXTRA_MASTERABLE.map((x) => [x.uniqueName, x]));
  const catalog = [...raw, ...EXTRA_MASTERABLE.filter((x) => !known.has(x.uniqueName))].map((item) => {
    if (item.masterable && NO_MASTERY.has(item.uniqueName)) item = { ...item, masterable: false };
    // The catalog has it (orbiter-data keeps the prisms and Infested chambers now), but calls it
    // not masterable in an older read, and the Mote Amp "Mote Prism": the game's word wins.
    const x = extra.get(item.uniqueName);
    if (x && (!item.masterable || item.name !== x.name)) item = { ...item, masterable: true, name: x.name };
    const fixed = CATEGORY_NOW[item.uniqueName];
    if (fixed && item.category !== fixed) item = { ...item, category: fixed, type: fixed };
    // A few melee weapons come typed as rifles in the catalog (Venato, Prova, Ruvox…).
    if (item.category === "Melee" && /^(Rifle|Pistol|Shotgun)$/.test(item.type ?? "")) item = { ...item, type: "Melee" };
    // Ducat values that changed since the catalog was made.
    if (item.components?.some((c) => DUCATS_NOW[partFullName(item, c)] != null)) {
      item = { ...item, components: item.components.map((c) => (DUCATS_NOW[partFullName(item, c)] != null ? { ...c, ducats: DUCATS_NOW[partFullName(item, c)] } : c)) };
    }
    const comps = item.components;
    if (!comps || new Set(comps.map((c) => c.uniqueName)).size === comps.length) return item;
    const merged = new Map<string, Component>();
    for (const c of comps) {
      const prev = merged.get(c.uniqueName);
      merged.set(c.uniqueName, prev ? { ...prev, itemCount: (prev.itemCount ?? 1) + (c.itemCount ?? 1) } : { ...c });
    }
    return { ...item, components: [...merged.values()] };
  });

  const catalogByUnique = new Map<string, CatalogItem>();
  for (const item of catalog) catalogByUnique.set(item.uniqueName, item);

  // Prime parts: components that carry a ducat value.
  const primeParents: CatalogItem[] = [];
  const partsByParent = new Map<string, PrimePart[]>();
  const partByName = new Map<string, PrimePart[]>();
  const partByComponentUnique = new Map<string, string>();
  for (const item of catalog) {
    const parts: PrimePart[] = [];
    for (const comp of item.components ?? []) {
      if (comp.ducats == null || comp.tradable === false) continue;
      const part: PrimePart = {
        fullName: partFullName(item, comp),
        componentUnique: comp.uniqueName,
        parentUnique: item.uniqueName,
        parentName: item.name,
        required: comp.itemCount ?? 1,
        ducats: comp.ducats,
      };
      part.ducats = DUCATS_NOW[part.fullName] ?? part.ducats;
      parts.push(part);
      const same = partByName.get(part.fullName);
      if (same) same.push(part);
      else partByName.set(part.fullName, [part]);
      partByComponentUnique.set(comp.uniqueName, part.fullName);
    }
    if (parts.length) {
      primeParents.push(item);
      partsByParent.set(item.uniqueName, parts);
    }
  }

  const mainBlueprint = new Map<string, string>();
  for (const item of catalog) {
    for (const c of item.components ?? []) if (c.name === "Blueprint") mainBlueprint.set(c.uniqueName, item.uniqueName);
  }

  const nameByUnique = new Map<string, string>();
  for (const item of catalog) nameByUnique.set(item.uniqueName, item.name);
  for (const [u, name] of partByComponentUnique) nameByUnique.set(u, name);

  const imageByName = new Map<string, string>();
  for (const item of catalog) {
    if (item.imageName && !imageByName.has(item.name)) imageByName.set(item.name, item.imageName);
    for (const comp of item.components ?? []) {
      if (!comp.imageName) continue;
      const full = partFullName(item, comp);
      if (!imageByName.has(full)) imageByName.set(full, comp.imageName);
    }
  }

  const part: CatalogPart = { catalog, catalogByUnique, primeParents, partsByParent, partByName, partByComponentUnique, mainBlueprint, nameByUnique, catalogNames: new Set(catalog.map((c) => c.name)), imageByName };
  catalogParts.set(raw, { length: raw.length, part });
  return part;
}

interface RelicPart {
  /** The relic list with each reward once per relic. */
  relics: RelicEntry[];
  relicByUnique: Map<string, RelicEntry>;
  /** A relic's picture by its "Era Code" (the first relic of a code wins). */
  imageByBase: Map<string, string>;
  /** Groups and rewards' relics, by Varzia's stock they were worked out with (relicGroupsOf). */
  groups: WeakMap<object, { relicGroups: Map<string, RelicGroup>; sourcesByReward: Map<string, RelicSource[]> }>;
}

/** The parts of a model worked out from the relic list alone, kept per list (as catalogPart). */
const relicParts = new WeakMap<readonly RelicEntry[], { length: number; part: RelicPart }>();
function relicPart(raw: RelicEntry[]): RelicPart {
  const hit = relicParts.get(raw);
  if (hit && hit.length === raw.length) return hit.part;
  // Some relic entries list a reward twice ("2X Forma Blueprint" in Meso D1); merge them so every
  // reward name appears once per relic, with the chances added up.
  const relics = raw.map((r) => {
    const merged = new Map<string, RelicReward>();
    for (const rw of r.rewards) {
      const prev = merged.get(rw.name);
      merged.set(rw.name, prev ? { ...prev, chance: (prev.chance ?? 0) + (rw.chance ?? 0) } : { ...rw });
    }
    return merged.size === r.rewards.length ? r : { ...r, rewards: [...merged.values()] };
  });
  const relicByUnique = new Map<string, RelicEntry>();
  for (const relic of relics) relicByUnique.set(relic.uniqueName, relic);
  const imageByBase = new Map<string, string>();
  for (const relic of relics) {
    const split = splitRelicName(relic.name);
    if (split && relic.imageName && !imageByBase.has(split.base)) imageByBase.set(split.base, relic.imageName);
  }
  const part: RelicPart = { relics, relicByUnique, imageByBase, groups: new WeakMap() };
  relicParts.set(raw, { length: raw.length, part });
  return part;
}

/** No Varzia stock read: the key relicGroupsOf keeps that case under. */
const NO_RESURGENCE = {};
/**
 * Relics grouped by "Era Code" (vaulted, and in Varzia's stock), and each reward's relics. Kept
 * per relic list and stock: the worldstate keeps her stock as one object until it changes
 * (modelLive.ts).
 */
function relicGroupsOf(rel: RelicPart, resurgence: object | null, inResurgence: (unique: string) => boolean) {
  const key = resurgence ?? NO_RESURGENCE;
  const hit = rel.groups.get(key);
  if (hit) return hit;
  const relicGroups = new Map<string, RelicGroup>();
  for (const relic of rel.relics) {
    const split = splitRelicName(relic.name);
    if (!split) continue;
    let group = relicGroups.get(split.base);
    if (!group) {
      group = {
        base: split.base,
        era: split.base.split(" ")[0],
        vaulted: false,
        resurgence: false,
        byRefinement: {},
      };
      relicGroups.set(split.base, group);
    }
    group.byRefinement[split.refinement] = relic;
    if (split.refinement === "Intact") {
      group.vaulted = relic.vaulted === true;
      group.resurgence = inResurgence(relic.uniqueName);
    }
  }

  const sourcesByReward = new Map<string, RelicSource[]>();
  for (const group of relicGroups.values()) {
    const intact = group.byRefinement.Intact;
    if (!intact) continue;
    const radiant = group.byRefinement.Radiant;
    for (const reward of intact.rewards) {
      const rad = radiant?.rewards.find((r) => r.name === reward.name);
      const src: RelicSource = {
        base: group.base,
        rarity: relicRewardRarity("Intact", reward.chance, reward.rarity),
        chanceIntact: reward.chance ?? 0,
        chanceRadiant: rad?.chance ?? reward.chance ?? 0,
        vaulted: group.vaulted,
        resurgence: group.resurgence,
      };
      const list = sourcesByReward.get(reward.name);
      if (list) list.push(src);
      else sourcesByReward.set(reward.name, [src]);
    }
  }
  const out = { relicGroups, sourcesByReward };
  rel.groups.set(key, out);
  return out;
}

export function buildModel(bundle: Bundle, live: Live = { fissures: null, resurgence: null, resurgenceExpiry: null }, foundry: Record<string, number> | null = null, relicMarket: RelicMarket | null = null, imprints: ImprintRaw[] | null = null, recipes: RecipeData | null = null, gear: GearCopy[] | null = null, consumedSuits: string[] | null = null): Model {
  // A row without a path, or still without a name once the known ones are filled in (a damaged
  // read), is left out rather than breaking every page.
  const whole = (ok: (r: InventoryRow) => boolean) => (b: Bundle): Bundle => (b.inventory.every(ok) ? b : { ...b, inventory: b.inventory.filter(ok) });
  bundle = whole((r) => typeof r.name === "string")(withKnownNames(whole((r) => !!r && typeof r.item_id === "string")(bundle)));
  // The catalog and the relic list are most of the data and change only with a new game update:
  // the desktop app keeps them across syncs (backend.ts, bundleLoader), so what's worked out from
  // them alone is kept per list (catalogPart, relicPart) and a sync redoes only the inventory's part.
  const cat = catalogPart(bundle.catalog);
  const rel = relicPart(bundle.relics);
  bundle = { ...bundle, catalog: cat.catalog, relics: rel.relics };

  const { catalogByUnique, primeParents, partsByParent, partByName, partByComponentUnique, mainBlueprint } = cat;

  const inventoryByBase = new Map<string, InventoryRow[]>();
  const mastered = new Set<string>();
  for (const row of bundle.inventory) {
    const b = baseId(row.item_id);
    const list = inventoryByBase.get(b);
    if (list) list.push(row);
    else inventoryByBase.set(b, [row]);
    if (row.mastered) mastered.add(b);
  }
  /** Items being built in the foundry (filled in below, once the parts are known). */
  const building = new Map<string, number>();
  const held = (unique: string) => (inventoryByBase.get(unique) ?? []).reduce((n, r) => n + r.quantity, 0);

  // Modular builds, by the part their mastery goes by: a primary or a secondary kitgun both by its
  // chamber, a Predasite by its subspecies (held under its own path), the Mote Amp as the training amp.
  const copies = Array.isArray(gear) ? gear.filter((g) => g && typeof g.type === "string") : null;
  const copiesByType = new Map<string, GearCopy[]>();
  for (const g of copies ?? []) {
    const list = copiesByType.get(g.type);
    if (list) list.push(g);
    else copiesByType.set(g.type, [g]);
  }
  const builds = new Map<string, { built: number; gilded: number; sections: string[] }>();
  for (const g of copies ?? []) {
    const parts = Array.isArray(g.m) && g.m.length ? g.m : [g.type === MOTE_HELD_AS ? MOTE : g.type];
    for (const p of parts) {
      if (typeof p !== "string" || !familyOf(p)) continue;
      const b = builds.get(p) ?? { built: 0, gilded: 0, sections: [] };
      b.built++;
      if ((g.f & GILDED) !== 0) b.gilded++;
      if (g.s && !b.sections.includes(g.s)) b.sections.push(g.s);
      builds.set(p, b);
    }
    // The Plexus has one copy, ranked like a frame: mastered at 30.
    if (g.type === PLEXUS && (g.x ?? 0) >= PLEXUS_MASTERED_XP) mastered.add(PLEXUS);
  }
  const modular = (unique: string): ModularHave | null => {
    const family = familyOf(unique);
    if (!family) return null;
    const b = builds.get(unique);
    // Held whole (a revived Predasite, the training amp) or only as parts (the rest: built
    // kitguns, zaws, amps, MOAs, hounds and K-Drives aren't in the inventory TennoScope stores).
    const whole = family.assemble == null;
    const inArsenal = whole ? held(HELD_AS[unique] ?? unique) : 0;
    return {
      family,
      loose: whole ? 0 : held(unique),
      built: Math.max(inArsenal, b?.built ?? 0),
      gilded: b?.gilded ?? 0,
      known: copies != null,
      sections: b?.sections ?? [],
    };
  };
  const owned = (unique: string) => {
    // A kitgun chamber, zaw strike, amp prism, MOA or hound model or K-Drive board: the part you
    // hold and the builds made from it (the inventory only has the part). Either way you have it,
    // for everything that asks whether there's more to collect; Foundry and Mastery tell the two
    // apart (modular()).
    const family = familyOf(unique);
    if (family && family.assemble != null) return held(unique) + (builds.get(unique)?.built ?? 0) + (building.get(unique) ?? 0);
    const n = held(unique) + (HELD_AS[unique] ? held(HELD_AS[unique]) : 0) + (building.get(unique) ?? 0);
    return n === 0 && unique === PLEXUS && inventoryByBase.has(PLEXUS) ? 1 : n;
  };

  const resurgence = new Set<string>(
    (live.resurgence ?? []).map((v) => normaliseStoreUnique(v.uniqueName)),
  );
  const inResurgence = (unique: string) => resurgence.has(normaliseStoreUnique(unique));

  // Owned parts. TennoScope stores warframe part blueprints under a different path than the
  // catalog's component, so fall back to the name when the path does not match.
  const ownedPartQty = new Map<string, number>();
  const builtPartQty = new Map<string, number>();
  for (const row of bundle.inventory) {
    if (row.category !== "prime_part" && row.category !== "blueprint") continue;
    const name = partByComponentUnique.get(baseId(row.item_id)) ?? (partByName.has(row.name) ? row.name : null);
    if (!name || row.quantity <= 0) continue;
    // A part already built from its blueprint (…SystemsComponent, "Valkyr Prime Systems") can't be
    // traded: it counts toward building the item, not toward selling.
    if (/Component$/.test(baseId(row.item_id)) && !/Blueprint$/.test(row.name)) {
      builtPartQty.set(name, (builtPartQty.get(name) ?? 0) + row.quantity);
      continue;
    }
    ownedPartQty.set(name, (ownedPartQty.get(name) ?? 0) + row.quantity);
  }

  // The foundry. Building the item itself (its main blueprint) means you'll own it: its parts are
  // no longer needed. Crafting a part from its blueprint (…ChassisBlueprint → …ChassisComponent)
  // means you'll hold that part.
  const foundryRecipes = new Map<string, number>();
  const craftingPartQty = new Map<string, number>();
  for (const [path, count] of Object.entries(foundry ?? {})) {
    if (!(count > 0)) continue;
    const recipe = baseId(path);
    foundryRecipes.set(recipe, (foundryRecipes.get(recipe) ?? 0) + count);
    const parent = mainBlueprint.get(recipe);
    if (parent) {
      building.set(parent, (building.get(parent) ?? 0) + count);
      continue;
    }
    const part = partByComponentUnique.get(recipe) ?? partByComponentUnique.get(recipe.replace(/Blueprint$/, "Component"));
    if (part) craftingPartQty.set(part, (craftingPartQty.get(part) ?? 0) + count);
  }

  // Relics, grouped by "Era Code", and each reward's relics: kept with the relic list while Varzia's
  // stock is the same.
  const { relicGroups, sourcesByReward } = relicGroupsOf(rel, live.resurgence ?? null, inResurgence);

  // Names by path: the catalog's (its parts by their trade names), then the inventory's for the rest.
  const heldName = new Map<string, string>();
  for (const row of bundle.inventory) {
    const b = baseId(row.item_id);
    if (!cat.nameByUnique.has(b) && !heldName.has(b)) heldName.set(b, row.name);
  }
  const nameOf = (path: string) => {
    const u = path.replace("/Lotus/StoreItems/", "/Lotus/");
    const known = cat.nameByUnique.get(u) ?? heldName.get(u);
    if (known) return known;
    // Not in the trimmed catalog (Forma, resources): make the last path segment readable.
    const last = u.split("/").pop() ?? u;
    return last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  };

  // Rows you hold, by name.
  const inventoryByName = new Map<string, InventoryRow[]>();
  for (const row of bundle.inventory) {
    if (row.quantity <= 0) continue;
    const list = inventoryByName.get(row.name);
    if (list) list.push(row);
    else inventoryByName.set(row.name, [row]);
  }
  const catalogNames = cat.catalogNames;

  // Image file names by display name. Inventory names win: they are what the game shows. Then the
  // catalog's (items, then their parts), then a relic's by its "Era Code".
  const heldImage = new Map<string, string>();
  for (const row of bundle.inventory) if (row.image_name) heldImage.set(row.name, row.image_name);
  // A prime's main blueprint is filed under the generic blueprint picture, which the image set
  // doesn't have: show the item it builds instead.
  const own = (name: string) => {
    const f = heldImage.get(name) ?? cat.imageByName.get(name) ?? rel.imageByBase.get(name);
    return f && f !== "blueprint.png" ? f : undefined;
  };
  const imageOf = (name: string): string | null => {
    // A stack ("2X Forma Blueprint") looks like one of it.
    const one = name.replace(/^\d+\s*X\s+/i, "");
    return own(one) ?? own(one.replace(/ Blueprint$/, "")) ?? relicImage(one);
  };

  const relicByUnique = rel.relicByUnique;

  const ownedRelicCount = new Map<string, number>();
  for (const row of bundle.inventory) {
    if (row.category !== "relic") continue;
    const split = splitRelicName(row.name);
    if (!split || row.quantity <= 0) continue;
    ownedRelicCount.set(split.base, (ownedRelicCount.get(split.base) ?? 0) + row.quantity);
  }

  const p = bundle.prices ?? {};
  // The market's spelling can differ in case from the game's ("Zid-an Sek-eel"), so a name that
  // doesn't match exactly is looked up without case.
  const lowered = new Map<object, Map<string, string>>();
  const lookup = <T>(table: Record<string, T> | undefined, name: string): T | undefined => {
    if (!table) return undefined;
    if (name in table) return table[name];
    let low = lowered.get(table);
    if (!low) lowered.set(table, (low = new Map(Object.keys(table).map((k) => [k.toLowerCase(), k]))));
    const key = low.get(name.toLowerCase());
    return key == null ? undefined : table[key];
  };
  const price = (name: string) => lookup(p.prices, name) ?? null;
  const priceMax = (name: string) => lookup(p.max_rank_prices, name) ?? null;
  const tradesPerDay = (name: string) => {
    const t = lookup(p.trade_rate, name);
    return t ? t[0] : null;
  };
  /** On how many days it sold lately: a price from one or two days of sales can be a joke. */
  const saleDays = (name: string) => {
    const t = lookup(p.trade_rate, name);
    return t ? t[1] : null;
  };
  /** A relic's price at a refinement (intact when none is named): what it sold for lately on warframe.market, else TennoScope's daily price. */
  const relicPrice = (base: string, refinement?: string) => {
    const sold = relicMarket?.[base]?.prices[(refinement ?? "Intact").toLowerCase()];
    if (sold != null) return sold;
    const key = refinement === "Radiant" ? `${base} Relic (Radiant)` : `${base} Relic`;
    if (refinement && refinement !== "Intact" && refinement !== "Radiant") return null;
    return p.prices?.[key] ?? p.carried_relic_prices?.[key]?.[0] ?? null;
  };

  return {
    observedAt: bundle.observed_at ? new Date(bundle.observed_at * 1000) : null,
    priceDate: p.dump_date ?? null,
    catalogByUnique,
    inventoryByBase,
    mastered,
    primeParents,
    partsByParent,
    partByName,
    ownedPartQty,
    relicGroups,
    relicByUnique,
    nameOf,
    imageOf,
    inventoryByName,
    catalogNames,
    sourcesByReward,
    ownedRelicCount,
    price,
    priceMax,
    saleDays,
    tradesPerDay,
    relicPrice,
    owned,
    craftingPartQty,
    building: (unique) => building.get(unique) ?? 0,
    partHave: (name) => (ownedPartQty.get(name) ?? 0) + (builtPartQty.get(name) ?? 0) + (craftingPartQty.get(name) ?? 0),
    inFoundry: (recipe) => foundryRecipes.get(baseId(recipe)) ?? 0,
    isMastered: (u) => mastered.has(u),
    inResurgence,
    live,
    imprints: imprints ? imprintCounts(imprints, (path) => catalogByUnique.has(path)) : null,
    recipes,
    gear: copies,
    gearOf: (path) => copiesByType.get(path) ?? [],
    consumedSuits: Array.isArray(consumedSuits) ? new Set(consumedSuits.filter((s) => typeof s === "string")) : null,
    modular,
  };
}
