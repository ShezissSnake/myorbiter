// orbiter's own build suggestions: a rule-based starting point for an item, at three tiers of
// player progression (New player, Intermediate, Veteran: see capacity.ts and availability.ts),
// from the mods the player owns. Pure: no I/O, no Svelte.
//
// Tiers: each suggestion uses only what its tier allows. New player: no Catalyst/Reactor, Forma,
// exilus, arcanes, shards or Helminth, and only "new" mods. Intermediate: a Catalyst/Reactor,
// regular Forma, an exilus mod, the Helminth, "intermediate" mods and arcanes. Veteran: all of it,
// Umbra Forma and Tauforged shards included. Within the tier, owned mods first; better mods of
// the tier the player doesn't own are the upgrades.
//
// Variants (variantsFor): 1–3 per warframe where they differ meaningfully, each tagged (tags.ts):
// a tank's "Tank / Steel Path" and "Caster / Star Chart", a caster's "Star Chart" and "Steel Path"
// (a "Steel Path nuke" for strength-and-range frames), a shield-gating build for the frames that
// gate. The variant decides the mods: survival up front for the Steel Path, efficiency and range
// for a nuke, Brief Respite and Catalyzing Shields for gating. Weapons get one build, tagged by
// what they're built around (Crit, Status, Hybrid).
//
// What it does, in order:
//  1. Works out what the item is (gearKindOf) and, for weapons, what it's built around from its
//     catalog stats (focusOf: crit, status, hybrid or base damage).
//  2. Lays out a priority list of "picks", each a chain of mods best first (Primed Point Blank,
//     then Point Blank). Weapons: the standard core players run. Warframes: role templates from
//     orbiter's curated table (src/lib/data/frame-roles.json), with explicit rules for what isn't
//     numbers: energy mods when a frame spams abilities, Primed Sure Footed where knockdowns
//     matter, Adaptation and Rolling Guard for tanks.
//  3. Takes the first owned mod of each pick, fits them into the tier's capacity (fit()), and
//     lists the better mods the player doesn't own as upgrades.
//
// Every suggestion says it is orbiter's (`source: "orbiter"`), gives a one-line reason per slot,
// and ends with an honest note.
//
// Optional fields a page can render (all backwards compatible; absent means "nothing to show"):
//  - `loadout` (warframes): shards, helminth, weapons, arcanes, companion, focus, note, and
//     - `loadout.shards`: Veteran only, always Tauforged (a plain shard is worth less). A pick's `fuse` says how
//       to turn the plain shards the player holds of that colour into Tauforged ones (Ascent Fusion).
//     - `loadout.element`: the element the frame's kit deals and the shard colour that feeds on it.
//     - `loadout.primer`: a companion that primes enemies with status, picked by the kit's element,
//       with its precept, and for a robotic one a bond mod and a companion weapon. You bring one
//       companion: this is the alternative to `loadout.companion` when status matters.
//     - `loadout.sets`: mod sets that fit the frame's role. Each `set` is {name, pieces: [{name,
//       path, slotKind, owned, aura?, replaces?}], bonus, reason, cost, companion?, tier, source}.
//       `slotKind` is where the piece goes: warframe (aura: true for the aura slot), primary,
//       secondary, melee, companion (the companion itself) or companionWeapon (a beast's claws).
//  - `riven` (primary, secondary, melee, arch-gun and companion weapons): {ideal, yours?}, from
//    ./riven.ts. `ideal` = {positives: [{stat, why, basis}], negatives, disposition, basedOn:
//    {auctions, since}, label}: `basis` is "rule" (orbiter's rule), "market" (what players pay
//    most for on warframe.market) or "both". `yours`: the player's rivens for the weapon with
//    {riven, fit: {wanted, of, negative, text: "2 of 3 wanted stats, harmless negative (−Zoom)"}}.
//
// Shapes: the minimal Build fields used here are declared locally below (the same names as
// ./types's Build). `toBuild` is the one place that turns a Suggestion into a saved Build;
// switching to ./types means replacing the local block with
// `import type { Build, BuildMod, GearKind, Polarity } from "./types"` and deleting it.

import type { CatalogItem, InventoryRow } from "../types";
import type { ShardColour } from "./types";
import type { Riven } from "../rivens";
import frameRoles from "../../data/frame-roles.json";
import synergies from "../../data/loadout-synergies.json";
import { idealRiven, rivenFit, rivensFor, type IdealRiven, type RivenFit, type RivenMarketData } from "./riven";
import { availabilityOf, availabilityRank, hardDonorOf, type Availability } from "./availability";

// ---------------------------------------------------------------- local stand-ins for ./types

export type Polarity = "madurai" | "vazarin" | "naramon" | "zenurik" | "unairu" | "penjaga" | "umbra" | "universal";
export type GearKind = "warframe" | "primary" | "secondary" | "melee" | "companion" | "companionWeapon" | "archwing" | "archgun" | "archmelee" | "necramech" | "exalted";
/** A mod or arcane in a build. `rank` absent: max rank. */
export interface BuildMod {
  path: string;
  rank?: number | null;
}
/** The fields of Build that a suggestion fills (see src/lib/core/builds/types.ts). */
export interface Build {
  id: string;
  item: string;
  kind: GearKind;
  title?: string;
  aura?: BuildMod | null;
  exilus?: BuildMod | null;
  stance?: BuildMod | null;
  mods: (BuildMod | null)[];
  polarities?: { aura?: Polarity | null; exilus?: Polarity | null; stance?: Polarity | null; mods?: (Polarity | null)[] };
  arcanes: BuildMod[];
  shards: never[];
  catalyst?: boolean | null;
  adapters?: { exilus?: boolean; arcane?: boolean };
  forma?: number | null;
  source: "orbiter";
  importedAt: number;
  note?: string;
  tags?: string[];
}

// ---------------------------------------------------------------- public shapes

export type Tier = "low" | "medium" | "high";
export const TIERS: Tier[] = ["low", "medium", "high"];
/** The tiers named as player progression (the same as capacity.ts's TIER_LABEL). */
export const TIER_NAME: Record<Tier, string> = { low: "New player", medium: "Intermediate", high: "Veteran" };
/** The availability level each tier allows (availability.ts). */
const TIER_LEVEL: Record<Tier, Availability> = { low: "new", medium: "intermediate", high: "veteran" };
/** Whether a mod or arcane is within a tier. */
export const allowedAt = (m: CatalogItem, tier: Tier): boolean => availabilityRank(availabilityOf(m)) <= availabilityRank(TIER_LEVEL[tier]);

/**
 * A build variant: what the build is for, which decides its mods. `survival` puts survival mods up
 * front (health and armour, or shield gating); `nuke` puts efficiency and range up front; `roles`
 * reorders the frame's curated roles.
 */
export interface Variant {
  id: string;
  label: string;
  tags: string[];
  roles?: Role[];
  survival?: "health" | "shieldGate" | null;
  nuke?: boolean;
}

/** What a weapon is built around. */
export type Focus = "crit" | "status" | "hybrid" | "base";
export type Role = "tank" | "strength" | "range" | "efficiency";

/** A better mod or arcane the player doesn't own. */
export interface Upgrade {
  name: string;
  path: string;
  /** The owned mod it would replace, or null if it fills a slot the build leaves out. */
  replaces: string | null;
  reason: string;
}

/** orbiter's suggestion: a Build plus why each slot holds what it holds. */
export interface Suggestion extends Build {
  source: "orbiter";
  tier: Tier;
  /** Weapons: crit, status, hybrid or base. Warframes: the curated roles ("strength + range"). */
  focus: string;
  capacity: { max: number; used: number };
  /** Forma spent on polarities (included in `forma`), and how many of them are Umbra Forma. */
  formaSlots: number;
  umbraForma: number;
  reasons: { aura?: string; exilus?: string; stance?: string; mods: (string | null)[]; arcanes: string[] };
  /** Display names, parallel to the paths above, so a page can show them without a lookup. */
  names: { aura?: string; exilus?: string; stance?: string; mods: (string | null)[]; arcanes: string[] };
  upgrades: Upgrade[];
  note: string;
  /** Warframes only: what goes around the build (shards, Helminth, support weapons, arcanes, companion, Focus). */
  loadout?: Loadout;
  /** Weapons that take a riven: the ideal one, and the player's against it (./riven.ts). */
  riven?: WeaponRiven;
  /** What it's for (tags.ts's words), from its variant. */
  tags: string[];
  /** The variant it was built as. */
  variant: { id: string; label: string };
}

/** The ideal riven for a weapon, and the player's rivens for it with how close each comes. */
export interface WeaponRiven {
  ideal: IdealRiven;
  yours?: { riven: Riven; fit: RivenFit }[];
}

/** What suggest() can use for rivens: the player's rivens (parsed) and what's listed for the weapon. */
export interface RivenContext {
  mine?: Riven[];
  market?: RivenMarketData | null;
}

/**
 * One piece of a warframe's loadout, from orbiter's curated facts (src/lib/data/loadout-synergies.json).
 * Shards carry ./types's BuildShard fields (colour, tauforged, stat); the Helminth pick its
 * BuildHelminth fields (ability, replaces), so a page can save them into a Build as they are.
 */
export interface LoadoutPick {
  name: string;
  path?: string;
  /** true: you hold it; false: you don't; null: orbiter can't see it yet (Focus schools, the Helminth). */
  owned: boolean | null;
  reason: string;
  /** The lowest tier whose loadout has this pick. */
  tier: Tier;
  /** The page the fact was read on, by hand (orbiter never fetches it). */
  source: string;
  /** A mod or arcane: what it goes on ("Grimoire", "Nautilus Prime", "a gilded kitgun"). */
  on?: string;
  colour?: ShardColour;
  tauforged?: boolean;
  stat?: string;
  ability?: string;
  replaces?: string;
  /** Shards: how to make Tauforged ones from the plain ones of this colour you hold. */
  fuse?: string;
}

/** Where a set piece goes. */
export type SlotKind = "warframe" | "primary" | "secondary" | "melee" | "companion" | "companionWeapon";

/** One piece of a mod set. */
export interface SetPiece {
  name: string;
  path?: string;
  slotKind: SlotKind;
  /** The aura slot (a warframe piece). */
  aura?: boolean;
  /** The plain mod a frame piece stands in for. */
  replaces?: string;
  owned: boolean;
}

/** A mod set that fits the frame, with what it costs. */
export interface SetPick {
  name: string;
  pieces: SetPiece[];
  bonus: string;
  reason: string;
  /** The slots it takes ("4 Warframe slots, 2 secondary slots"). */
  cost: string;
  /** The companion the set bonus needs, if any. */
  companion?: { name: string; path: string; owned: boolean | null };
  /** medium: you hold every piece (and the companion); high: something to get. */
  tier: Tier;
  source: string;
}

/** The element a frame's kit deals, and the Archon Shard stat that feeds on it (if any). */
export interface KitElement {
  element: Element;
  ability: string;
  colour: ShardColour | null;
  stat: string | null;
  /** Where orbiter read it: the catalog's ability text, or the page for a curated frame. */
  source: string;
  /** For an element no shard feeds. */
  note?: string;
}
export type Element = "electricity" | "corrosive" | "toxin" | "radiation" | "heat" | "cold" | "blast" | "viral";

/**
 * What goes around a warframe build, by tier. Low (New player): only what costs nothing extra (a
 * Focus school, a companion, primer and support weapon you already hold). Medium (Intermediate):
 * also the Helminth, the arcanes you hold that the tier allows and sets you hold every piece of.
 * High (Veteran): also Tauforged Archon Shards, a hard donor's Helminth ability (Grendel's Nourish)
 * and what you'd still have to get. Shards are always Tauforged, never plain.
 */
export interface Loadout {
  shards: LoadoutPick[];
  helminth: LoadoutPick | null;
  weapons: LoadoutPick[];
  arcanes: LoadoutPick[];
  companion: LoadoutPick[];
  focus: LoadoutPick | null;
  note: string;
  /** The kit's element and the shard colour that feeds on it. */
  element?: KitElement | null;
  /** A companion that primes status, instead of `companion` (you bring one). */
  primer?: LoadoutPick[];
  /** Mod sets that fit the frame's role (medium: all held; high: to get). */
  sets?: SetPick[];
}

/** Everything the inventory holds, by path (no "#rank"): quantities summed over ranks. */
export type Held = Map<string, number>;

/** Mods and arcanes by name, the canonical copy of each (see modIndex). */
export interface ModIndex {
  byName: Map<string, CatalogItem>;
  byPath: Map<string, CatalogItem>;
  /** Stances by weapon class ("Heavy Blade"). */
  stances: Map<string, CatalogItem[]>;
}

/** Owned mods and arcanes: path (no "#rank") → the highest rank held. */
export type Owned = Map<string, number>;

// ---------------------------------------------------------------- catalog and inventory

// The catalog repeats some names: the starter copies (/Beginner/, /Intermediate/), unreleased
// /Expert/ copies of ordinary mods (Primed mods also live under /Expert/, under their own names),
// Focus and Railjack nodes. The canonical copy is the plain one; these are the two exceptions.
const CANONICAL: Record<string, string> = {
  Adaptation: "/Lotus/Upgrades/Mods/Warframe/AvatarResistanceOnDamageMod",
  "Pressure Point": "/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod",
};
const SECONDARY_COPY = /\/(Beginner|Intermediate|Expert)\//;

export function modIndex(catalog: CatalogItem[]): ModIndex {
  const byName = new Map<string, CatalogItem>();
  const byPath = new Map<string, CatalogItem>();
  const stances = new Map<string, CatalogItem[]>();
  const rank = (x: CatalogItem) => (CANONICAL[x.name] === x.uniqueName ? -1 : SECONDARY_COPY.test(x.uniqueName) ? 1 : 0);
  for (const x of catalog) {
    if (x.category !== "Mods" && x.category !== "Arcanes") continue;
    if (x.type === "Focus Way" || x.type === "Plexus Mod" || x.type === "Railjack Mod") continue;
    byPath.set(x.uniqueName, x);
    const had = byName.get(x.name);
    if (!had || rank(x) < rank(had)) byName.set(x.name, x);
  }
  for (const x of byName.values()) {
    if (x.type !== "Stance Mod" || !x.compatName) continue;
    const list = stances.get(x.compatName) ?? [];
    list.push(x);
    stances.set(x.compatName, list);
  }
  return { byName, byPath, stances };
}

/** The mods and arcanes held, from TennoScope's inventory rows ("path" or "path#rank"). */
export function ownedFrom(inventory: InventoryRow[]): Owned {
  const out: Owned = new Map();
  for (const r of inventory) {
    if (r.category !== "mod" && r.category !== "arcane") continue;
    if (r.quantity <= 0) continue;
    const [path, tail] = r.item_id.split("#");
    const rank = r.rank ?? (tail ? Number(tail) || 0 : 0);
    out.set(path, Math.max(out.get(path) ?? -1, rank));
  }
  return out;
}

/** What the inventory holds, any category (Archon Shards, companions, weapons): path → quantity. */
export function heldFrom(inventory: InventoryRow[]): Held {
  const out: Held = new Map();
  for (const r of inventory) {
    if (r.quantity <= 0) continue;
    const path = r.item_id.split("#")[0];
    out.set(path, (out.get(path) ?? 0) + r.quantity);
  }
  return out;
}

// ---------------------------------------------------------------- what the item is

/** The kind of gear (the same rules as gear.ts's gearKindOf, plus exalted weapons), or null. */
export function gearKindOf(item: Pick<CatalogItem, "category" | "type" | "productCategory">): GearKind | null {
  const { category: cat, type: t, productCategory: pc } = item;
  if (t === "Exalted Weapon") return "exalted";
  if (t === "Necramech" || pc === "MechSuits") return "necramech";
  if (pc === "Suits" || (cat === "Warframes" && t === "Warframe")) return "warframe";
  if (pc === "SpaceSuits" || cat === "Archwing") return "archwing";
  if (pc === "SpaceGuns" || cat === "Arch-Gun") return "archgun";
  if (pc === "SpaceMelee" || cat === "Arch-Melee") return "archmelee";
  if (pc === "SentinelWeapons") return "companionWeapon";
  if (cat === "Sentinels" || (cat === "Pets" && t === "Pets")) return "companion";
  if (cat === "Melee" && t !== "Zaw Component") return "melee";
  if (cat === "Primary") return pc === "OperatorAmps" ? null : "primary";
  if (cat === "Secondary") return "secondary";
  return null;
}

/** Which family of weapon mods an item takes. */
type WeaponClass = "rifle" | "shotgun" | "pistol" | "melee" | "archgun" | "archmelee";

// Exalted weapons the catalog may carry, and the mods they take. Others aren't suggested.
const EXALTED: Record<string, WeaponClass> = {
  "Exalted Blade": "melee",
  "Exalted Umbra Blade": "melee",
  "Exalted Prime Blade": "melee",
  "Iron Staff": "melee",
  "Iron Staff Prime": "melee",
  Diwata: "melee",
  "Diwata Prime": "melee",
  "Valkyr Talons": "melee",
  "Valkyr Prime Talons": "melee",
  "Desert Wind": "melee",
  "Garuda Talons": "melee",
  "Garuda Prime Talons": "melee",
  Regulators: "pistol",
  "Regulators Prime": "pistol",
  "Dex Pixia": "pistol",
  "Dex Pixia Prime": "pistol",
  "Balefire Charger": "pistol",
  "Artemis Bow": "rifle",
  "Artemis Bow Prime": "rifle",
};

function weaponClassOf(item: CatalogItem, kind: GearKind): WeaponClass | null {
  switch (kind) {
    case "primary":
      return item.type === "Shotgun" ? "shotgun" : "rifle";
    case "secondary":
      return "pistol";
    case "melee":
      return "melee";
    case "archgun":
      return "archgun";
    case "archmelee":
      return "archmelee";
    case "exalted":
      return EXALTED[item.name] ?? null;
    case "companionWeapon": {
      // Companion weapons take the mods of what they are; the catalog doesn't say, the paths do.
      const p = item.uniqueName;
      if (/Shotgun/i.test(p)) return "shotgun";
      if (/Pistol/i.test(p)) return "pistol";
      if (/Glaive|MeleeWeapon/i.test(p) || !item.trigger) return "melee";
      return "rifle";
    }
    default:
      return null;
  }
}

/** Whether orbiter can suggest a build for this item. */
export function canSuggest(item: CatalogItem): boolean {
  const kind = gearKindOf(item);
  if (!kind) return false;
  if (kind === "exalted" || kind === "companionWeapon") return weaponClassOf(item, kind) !== null;
  return true;
}

const statusLine = (item: CatalogItem) =>
  `crit ${pct(item.criticalChance)} ×${(item.criticalMultiplier ?? 0).toFixed(1)}, status ${pct(item.procChance)}`;
const pct = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;

/** What a weapon is built around, from its own stats. */
export function focusOf(item: CatalogItem, cls: WeaponClass): Focus {
  const cc = item.criticalChance ?? 0;
  const cd = item.criticalMultiplier ?? 0;
  const sc = item.procChance ?? 0;
  // Crit mods multiply the base: 20% and ×2.0 is where they start to pay. Shotguns roll status per
  // pellet, so a lower per-pellet chance is already a lot per shot.
  const crit = cc >= 0.2 && cd >= 2;
  const status = sc >= (cls === "shotgun" ? 0.12 : 0.2);
  if (crit && status) return "hybrid";
  if (crit) return "crit";
  if (status) return "status";
  return "base";
}

// ---------------------------------------------------------------- the picks

/** One slot's worth of choice: the mods for it, best first, and why it's there. */
interface ModPick {
  key: string;
  chain: string[];
  why: string;
  /** An element, so the order rule can put Toxin and Cold together before Heat. */
  element?: "toxin" | "cold" | "heat" | "electricity";
}

interface WeaponFamily {
  base: string[];
  ms: string[];
  ms2: string[];
  cd: string[];
  cc: string[];
  status: string[];
  hybrid?: string[];
  speed: string[];
  tox60: string[];
  cold60: string[];
  heat60: string[];
  elec60: string[];
  tox90: string[];
  cold90: string[];
  heat90: string[];
}

const FAMILIES: Record<Exclude<WeaponClass, "melee" | "archmelee">, WeaponFamily> = {
  rifle: {
    base: ["Serration", "Amalgam Serration", "Heavy Caliber"],
    ms: ["Split Chamber"],
    ms2: ["Galvanized Chamber", "Vigilante Armaments"],
    cd: ["Vital Sense"],
    cc: ["Point Strike", "Critical Delay", "Argon Scope", "Galvanized Scope"],
    status: ["Galvanized Aptitude", "Rifle Aptitude"],
    hybrid: ["Hammer Shot"],
    speed: ["Speed Trigger", "Primed Shred", "Shred", "Vile Acceleration"],
    tox60: ["Malignant Force", "Infected Clip"],
    cold60: ["Rime Rounds", "Primed Cryo Rounds", "Cryo Rounds"],
    heat60: ["Thermite Rounds", "Hellfire"],
    elec60: ["High Voltage", "Stormbringer"],
    tox90: ["Infected Clip", "Malignant Force"],
    cold90: ["Primed Cryo Rounds", "Cryo Rounds", "Rime Rounds"],
    heat90: ["Hellfire", "Thermite Rounds"],
  },
  shotgun: {
    base: ["Primed Point Blank", "Point Blank", "Vicious Spread"],
    ms: ["Hell's Chamber"],
    ms2: ["Galvanized Hell"],
    cd: ["Primed Ravage", "Ravage"],
    cc: ["Blunderbuss", "Critical Deceleration", "Laser Sight"],
    status: ["Galvanized Savvy", "Shotgun Savvy"],
    speed: ["Shotgun Barrage", "Amalgam Shotgun Barrage", "Frail Momentum"],
    tox60: ["Toxic Barrage", "Contagious Spread"],
    cold60: ["Frigid Blast", "Primed Chilling Grasp", "Chilling Grasp"],
    heat60: ["Scattering Inferno", "Incendiary Coat"],
    elec60: ["Shell Shock", "Primed Charged Shell", "Charged Shell"],
    tox90: ["Contagious Spread", "Toxic Barrage"],
    cold90: ["Primed Chilling Grasp", "Chilling Grasp", "Frigid Blast"],
    heat90: ["Incendiary Coat", "Scattering Inferno"],
  },
  pistol: {
    base: ["Hornet Strike"],
    ms: ["Barrel Diffusion", "Amalgam Barrel Diffusion"],
    ms2: ["Galvanized Diffusion", "Lethal Torrent"],
    cd: ["Primed Target Cracker", "Target Cracker", "Hollow Point"],
    cc: ["Primed Pistol Gambit", "Pistol Gambit", "Creeping Bullseye", "Galvanized Crosshairs"],
    status: ["Galvanized Shot", "Sure Shot"],
    speed: ["Gunslinger", "Lethal Torrent", "Anemic Agility"],
    tox60: ["Pistol Pestilence", "Pathogen Rounds"],
    cold60: ["Frostbite", "Deep Freeze"],
    heat60: ["Scorch", "Primed Heated Charge", "Heated Charge"],
    elec60: ["Jolt", "Convulsion"],
    tox90: ["Pathogen Rounds", "Pistol Pestilence"],
    cold90: ["Deep Freeze", "Frostbite"],
    heat90: ["Primed Heated Charge", "Heated Charge", "Scorch"],
  },
  archgun: {
    base: ["Primed Rubedo-Lined Barrel", "Rubedo-Lined Barrel"],
    ms: ["Primed Dual Rounds", "Dual Rounds"],
    ms2: ["Containment Breach"],
    cd: ["Hollowed Bullets"],
    cc: ["Parallax Scope", "Critical Focus"],
    status: ["Modified Munitions"],
    speed: ["Automatic Trigger"],
    tox60: ["Contamination Casing", "Primed Venomous Clip", "Venomous Clip"],
    cold60: ["Hypothermic Shell", "Primed Polar Magazine", "Polar Magazine"],
    heat60: ["Magma Chamber", "Primed Combustion Rounds", "Combustion Rounds"],
    elec60: ["Charged Bullets", "Primed Electrified Barrel", "Electrified Barrel"],
    tox90: ["Primed Venomous Clip", "Venomous Clip", "Contamination Casing"],
    cold90: ["Primed Polar Magazine", "Polar Magazine", "Hypothermic Shell"],
    heat90: ["Primed Combustion Rounds", "Combustion Rounds", "Magma Chamber"],
  },
};

const MELEE = {
  base: ["Primed Pressure Point", "Pressure Point", "Spoiled Strike"],
  co: ["Condition Overload"],
  br: ["Blood Rush"],
  ww: ["Weeping Wounds"],
  cd: ["Organ Shatter", "Gladiator Might"],
  reach: ["Primed Reach", "Reach"],
  speed: ["Primed Fury", "Berserker Fury", "Fury"],
  tox60: ["Virulent Scourge", "Primed Fever Strike", "Fever Strike"],
  cold60: ["Vicious Frost", "North Wind"],
  heat60: ["Volcanic Edge", "Molten Impact"],
  elec60: ["Voltaic Strike", "Shocking Touch"],
};

const ARCH_MELEE = {
  base: ["Cutting Edge"],
  cc: ["Tempered Blade", "Critical Meltdown"],
  cd: ["Bleeding Edge"],
  status: ["Sudden Impact"],
  speed: ["Furor"],
  range: ["Extend"],
  tox60: ["Infectious Injection", "Poisonous Sting"],
  cold60: ["Cryo Coating", "Glacial Edge"],
  heat60: ["Searing Steel", "Blazing Steel"],
  elec60: ["Ion Infusion", "Conductive Blade"],
};

function weaponPicks(item: CatalogItem, cls: WeaponClass, focus: Focus, meleeClass: string | null): ModPick[] {
  const s = statusLine(item);
  const P = (key: string, chain: string[], why: string, element?: ModPick["element"]): ModPick => ({ key, chain, why, element });
  const tox = (chain: string[]) => P("toxin", chain, "Toxin, paired with Cold to make Viral, the community's all-round element.", "toxin");
  const cold = (chain: string[]) => P("cold", chain, "Cold, paired with Toxin to make Viral: more damage on every status hit.", "cold");
  const heat = (chain: string[]) => P("heat", chain, "Heat on its own, after the Viral pair: armour strip and a second damage-over-time.", "heat");
  const elec = (chain: string[]) => P("electricity", chain, "Electricity, a fourth status type and more chances to proc.", "electricity");

  if (cls === "melee") {
    const m = MELEE;
    const base = P("base", m.base, "Base melee damage: every other mod multiplies it.");
    const co = P("co", m.co, "Condition Overload: more damage for each status type on the target; the core of status melee.");
    const br = P("br", m.br, `Blood Rush: crit chance that grows with combo; ${pct(item.criticalChance)} base crit is enough to carry it.`);
    const ww = P("ww", m.ww, `Weeping Wounds: status chance that grows with combo, on a ${pct(item.procChance)} base.`);
    const cd = P("cd", m.cd, `Crit damage, on a ×${(item.criticalMultiplier ?? 0).toFixed(1)} multiplier.`);
    const speed = P("speed", m.speed, "Attack speed: more hits, faster combo.");
    const reachFits = meleeClass !== "Glaives" && meleeClass !== "Whips";
    const reach = P("reach", m.reach, "Range: hits more enemies per swing, which most melee players want.");
    const list: ModPick[] =
      focus === "crit" ? [br, cd, base, co, tox(m.tox60), cold(m.cold60), reach, speed]
      : focus === "hybrid" ? [co, br, ww, cd, base, tox(m.tox60), cold(m.cold60), reach, heat(m.heat60)]
      : focus === "status" ? [co, ww, base, tox(m.tox60), cold(m.cold60), heat(m.heat60), elec(m.elec60), reach, speed]
      : [co, base, tox(m.tox60), cold(m.cold60), heat(m.heat60), speed, reach, elec(m.elec60)];
    return reachFits ? list : list.filter((p) => p.key !== "reach");
  }
  if (cls === "archmelee") {
    const m = ARCH_MELEE;
    const base = P("base", m.base, "Base damage: every other mod multiplies it.");
    const cc = P("cc", m.cc, `Crit chance, on ${pct(item.criticalChance)} base.`);
    const cd = P("cd", m.cd, `Crit damage, on a ×${(item.criticalMultiplier ?? 0).toFixed(1)} multiplier.`);
    const st = P("status", m.status, `Status chance, on ${pct(item.procChance)} base.`);
    const speed = P("speed", m.speed, "Attack speed.");
    const range = P("range", m.range, "Range, so each swing reaches more.");
    return focus === "crit" || focus === "hybrid"
      ? [base, cc, cd, tox(m.tox60), cold(m.cold60), heat(m.heat60), speed, range]
      : [base, st, tox(m.tox60), cold(m.cold60), heat(m.heat60), elec(m.elec60), speed, range];
  }
  const f = FAMILIES[cls];
  const base = P("base", f.base, "Base damage: every other mod multiplies it.");
  const ms = P("ms", f.ms, "Multishot: more projectiles, so more of everything, ammo cost aside.");
  const ms2 = P("ms2", f.ms2, f.ms2[0].startsWith("Galvanized") ? "More multishot, stacking further on kills." : "More multishot.");
  const cd = P("cd", f.cd, `Crit damage: ${item.name} has ${s}, and a ×${(item.criticalMultiplier ?? 0).toFixed(1)} multiplier rewards it.`);
  const cc = P("cc", f.cc, `Crit chance, from ${pct(item.criticalChance)} base toward red crits.`);
  const st = P("status", f.status, `Status chance on ${pct(item.procChance)} base; the Galvanized one adds damage per status type.`);
  const hy = f.hybrid ? P("hybrid", f.hybrid, "Crit damage and status chance in one slot, the usual hybrid pick.") : null;
  const speed = P("speed", f.speed, "Fire rate: more shots, more procs.");
  switch (focus) {
    case "crit":
      return [base, ms, cd, cc, tox(f.tox90), cold(f.cold90), ms2, heat(f.heat90)];
    case "hybrid":
      return [base, ms, cd, cc, tox(f.tox60), cold(f.cold60), ms2, heat(f.heat60), hy ?? st];
    case "status":
      return [base, ms, tox(f.tox60), cold(f.cold60), st, ms2, heat(f.heat60), elec(f.elec60)];
    default:
      return [base, ms, tox(f.tox90), cold(f.cold90), heat(f.heat90), ms2, speed, elec(f.elec60)];
  }
}

// ---------------------------------------------------------------- melee class (for the stance)

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
};
const stem = (name: string) => name.replace(/\s+(Prime|Wraith|Vandal)$/, "").replace(/^Prisma\s+/, "");

/** The melee class for stances ("Heavy Blade"), or null when orbiter can't tell. */
export function meleeClassOf(item: CatalogItem): string | null {
  const byName = MELEE_NAME[item.name] ?? MELEE_NAME[stem(item.name)];
  if (byName) return byName;
  const parts = item.uniqueName.split("/");
  const at = parts.indexOf("Melee");
  const folder = at >= 0 ? parts[at + 1] : undefined;
  return folder ? MELEE_FOLDER[folder] ?? null : null;
}

// ---------------------------------------------------------------- warframes

interface FrameInfo {
  roles: Role[];
  spam?: boolean;
  duration?: boolean;
  knockdown?: boolean;
  shields?: boolean;
  noEnergy?: boolean;
  guess?: boolean;
  augment?: string;
  why: string;
}
const FRAMES = (frameRoles as { frames: Record<string, FrameInfo> }).frames;

/** orbiter's curated line for a frame (Primes and Umbra use the base frame's). */
export function frameInfo(name: string): FrameInfo | null {
  return FRAMES[name] ?? FRAMES[name.replace(/\s+(Prime|Umbra)$/, "")] ?? null;
}
export const FRAME_NAMES = Object.keys(FRAMES);

const DEFAULT_FRAME: FrameInfo = { roles: ["strength", "efficiency"], why: "orbiter has no line for this frame yet: a balanced caster default." };

const ROLE_TAG: Record<Role, string> = { tank: "Tank", strength: "Caster", range: "Crowd control", efficiency: "Support" };
const FOCUS_TAG: Record<Focus, string | null> = { crit: "Crit", status: "Status", hybrid: "Hybrid", base: null };

/**
 * The builds orbiter suggests for an item, first the default. Warframes, from the curated roles:
 *  - a tank (tank first): "Tank / Steel Path" (survival up front), and "Caster / Star Chart" when
 *    its abilities scale with strength;
 *  - a caster (strength or range first): "Star Chart", and "Steel Path" with survival up front, a
 *    "Steel Path nuke" (efficiency and range too) when strength and range are its two roles;
 *  - support (efficiency first): "Support / Star Chart" and "Support / Steel Path";
 *  - frames that shield-gate (loadout-synergies.json's list) gate in their Steel Path variant
 *    instead of stacking health, unless they spend no energy (Hildryn's shields are her tank).
 * Other gear: one build, tagged by what a weapon is built around.
 */
export function variantsFor(item: CatalogItem): Variant[] {
  const kind = gearKindOf(item);
  if (kind !== "warframe") {
    const cls = kind ? weaponClassOf(item, kind) : null;
    const tag = cls ? FOCUS_TAG[focusOf(item, cls)] : null;
    return [{ id: "default", label: cls ? "All-round" : "Default", tags: cls ? ["All-round", ...(tag ? [tag] : [])] : [] }];
  }
  const info = frameInfo(item.name) ?? DEFAULT_FRAME;
  const roles = info.roles;
  const gates = SYN.shieldGating.frames.includes(baseName(item.name));
  const survival: Variant["survival"] = gates && !info.noEnergy ? "shieldGate" : "health";
  const survivalTag = gates ? "Shield gating" : info.shields ? "Shield gating" : "Health tank";
  if (roles[0] === "tank") {
    const out: Variant[] = [{ id: "tank", label: "Tank / Steel Path", tags: ["Tank", "Steel Path", survivalTag], roles, survival: info.shields || !gates ? "health" : survival }];
    // Its abilities on strength, with efficiency to cast them (range instead for a frame that spends no energy).
    if (roles.includes("strength")) out.push({ id: "caster", label: "Caster / Star Chart", tags: ["Caster", "Star Chart"], roles: ["strength", info.noEnergy ? "range" : "efficiency"] });
    return out;
  }
  const role = ROLE_TAG[roles[0]];
  if (roles[0] === "efficiency") {
    return [
      { id: "starChart", label: "Support / Star Chart", tags: ["Support", "Star Chart"], roles },
      { id: "steelPath", label: survival === "shieldGate" ? "Support / Shield gating" : "Support / Steel Path", tags: ["Support", "Steel Path", survival === "shieldGate" ? "Shield gating" : "Health tank"], roles, survival },
    ];
  }
  const nuke = roles[0] === "strength" && roles[1] === "range";
  const sp: Variant = nuke
    ? { id: "steelPath", label: survival === "shieldGate" ? "Steel Path nuke, shield gating" : "Steel Path nuke", tags: [role, "Steel Path", "Nuke", survival === "shieldGate" ? "Shield gating" : "Health tank"], roles, survival, nuke: true }
    : { id: "steelPath", label: survival === "shieldGate" ? "Steel Path, shield gating" : "Steel Path", tags: [role, "Steel Path", survival === "shieldGate" ? "Shield gating" : "Health tank"], roles, survival };
  return [{ id: "starChart", label: "Star Chart", tags: [role, "Star Chart", ...(nuke ? ["Nuke"] : [])], roles }, sp];
}

function framePicks(info: FrameInfo, tier: Tier, variant: Variant | null = null): ModPick[] {
  const high = tier === "high";
  // Umbral mods only pay off with Umbra Forma, and Archon ones drain more than the plain ones for
  // the same stat: below the high tier the plain ones come first.
  const kin = (n: string) => (n.startsWith("Umbral") ? 2 : n.startsWith("Archon") ? 1 : 0);
  const byTier = (chain: string[]) => (high ? chain : [...chain].sort((x, y) => kin(x) - kin(y)));
  const P = (key: string, chain: string[], why: string): ModPick => ({ key, chain: byTier(chain), why });
  const STR = P("str", ["Umbral Intensify", "Archon Intensify", "Intensify"], "Ability strength: the main multiplier on this frame's abilities.");
  const TF = P("tf", ["Transient Fortitude"], "More strength for a little duration, the usual second strength mod.");
  const BR = P("blind", ["Blind Rage"], "The biggest strength boost, paid for with efficiency.");
  const DUR = P("dur", ["Primed Continuity", "Archon Continuity", "Continuity"], "Ability duration: buffs and effects last longer between casts.");
  const NARROW = P("narrow", ["Narrow Minded"], "A lot of duration for range this frame doesn't need.");
  const RANGE = P("range", ["Stretch", "Archon Stretch"], "Ability range: reach more enemies per cast.");
  const OVER = P("over", ["Overextended"], "Huge range for strength this kit doesn't lean on.");
  const AUGUR_REACH = P("augurReach", ["Augur Reach"], "A little more range at a low drain.");
  const EFF = P("eff", ["Streamline"], "Ability efficiency: cheaper casts.");
  const FLEET = P("fleet", ["Fleeting Expertise"], "Much cheaper casts for duration this frame doesn't need.");
  const FLOW = P("flow", ["Primed Flow", "Archon Flow", "Flow"], "Energy max: a bigger pool for a frame that casts a lot.");
  const VIT = P("vit", ["Umbral Vitality", "Archon Vitality", "Vitality"], "Health, the base every other defence multiplies.");
  const SHIELD = P("vit", ["Primed Redirection", "Redirection"], "Shield capacity: this frame lives on its shields.");
  const FIBER = P("fiber", ["Umbral Fiber", "Steel Fiber"], "Armour on top of the health.");
  const ADAPT = P("adapt", ["Adaptation"], "Stacking resistance to whatever is hitting you; standard on tanks.");
  const ROLL = P("roll", ["Rolling Guard"], "A dodge clears status effects and gives a moment of invulnerability.");
  const GATE = P("gate", ["Catalyzing Shields"], "Shield gating: a much longer moment of invulnerability when your shields break, for far less shield capacity.");

  const roleList: Record<Role, ModPick[]> = {
    strength: [STR, TF, RANGE, DUR, BR],
    range: [RANGE, OVER, AUGUR_REACH, DUR],
    efficiency: [EFF, FLEET, FLOW, DUR, STR],
    tank: [info.shields ? SHIELD : VIT, FIBER, ADAPT, STR, ROLL],
  };
  const roles0 = variant?.roles ?? info.roles;
  const [first, second] = roles0;
  const a = roleList[first] ?? [];
  const b = second ? roleList[second] ?? [] : [];
  // Two of the main role's picks for each of the second role's.
  const merged: ModPick[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length) merged.push(a[i++]);
    if (i < a.length) merged.push(a[i++]);
    if (j < b.length) merged.push(b[j++]);
  }
  let list = merged.filter((p, k) => merged.findIndex((x) => x.key === p.key) === k);

  // The rules for what isn't numbers.
  const put = (p: ModPick, at: number) => {
    list = list.filter((x) => x.key !== p.key);
    list.splice(Math.min(at, list.length), 0, p);
  };
  if (info.duration) put(DUR, 2);
  if (info.spam && !info.noEnergy) {
    put(EFF, 2);
    put(FLOW, 4);
  }
  if (info.augment) put(P("augment", [info.augment], "The augment most builds for this frame carry."), 4);
  // The variant's rules: a nuke wants efficiency and range early; the Steel Path survival early.
  if (variant?.nuke) {
    if (!info.noEnergy) put(EFF, 1);
    put(RANGE, 2);
  }
  if (variant?.survival === "shieldGate") {
    put(GATE, 2);
    if (!info.noEnergy) put(FLOW, 3);
  } else if (variant?.survival === "health") {
    put(info.shields ? SHIELD : VIT, 2);
    put(ADAPT, 3);
    if (!info.shields) put(FIBER, 4);
  }
  // Survival everyone runs some of, at the end.
  for (const p of [info.shields ? SHIELD : VIT, ADAPT, ROLL, FIBER]) if (!list.some((x) => x.key === p.key)) list.push(p);

  // Mods that undo what the frame needs.
  const roles = new Set(roles0);
  list = list.filter((p) => {
    if (p.key === "over" && roles.has("strength")) return false;
    if (p.key === "narrow" && roles.has("range")) return false;
    if (p.key === "fleet" && info.duration) return false;
    if (info.noEnergy && (p.key === "eff" || p.key === "fleet" || p.key === "flow")) return false;
    // Blind Rage halves efficiency: only with something to pay for it.
    if (p.key === "blind" && !list.some((x) => x.key === "eff" || x.key === "fleet")) return false;
    return true;
  });
  // A frame on duration without range gets Narrow Minded right after Continuity.
  if (info.duration && !roles.has("range") && !list.some((x) => x.key === "range")) put(NARROW, 3);
  return list;
}

function frameAura(info: FrameInfo, variant: Variant | null = null): { chain: string[]; why: string } {
  if (variant?.survival === "shieldGate" && !info.noEnergy) return { chain: ["Brief Respite", "Energy Siphon", "Corrosive Projection"], why: "Brief Respite: energy you spend refills the squad's shields, so a broken shield gate comes straight back." };
  const r = (variant?.roles ?? info.roles)[0];
  if (r === "strength" && !info.spam) return { chain: ["Growing Power", "Corrosive Projection", "Energy Siphon"], why: "Growing Power: more ability strength whenever your weapons proc status." };
  if (r === "tank" || (r === "strength" && info.noEnergy)) return { chain: ["Corrosive Projection", "Growing Power", "Energy Siphon"], why: "Corrosive Projection: strips armour from enemies, which the whole squad's damage feels." };
  if (info.noEnergy) return { chain: ["Corrosive Projection", "Growing Power"], why: "Corrosive Projection: armour strip for the squad; this frame doesn't need energy." };
  return { chain: ["Energy Siphon", "Corrosive Projection", "Growing Power"], why: "Energy Siphon: steady energy for a frame that casts a lot." };
}

function frameExilus(info: FrameInfo, variant: Variant | null = null): { chain: string[]; why: string } {
  if (info.knockdown) return { chain: ["Primed Sure Footed", "Sure Footed"], why: "Knockdown immunity: this frame fights up close and loses its channel or combo when knocked down." };
  const r = (variant?.roles ?? info.roles)[0];
  if (r === "range") return { chain: ["Cunning Drift"], why: "A little more range in the exilus slot." };
  if (r === "efficiency") return { chain: ["Coaction Drift"], why: "Makes the aura stronger for you and the squad." };
  return { chain: ["Power Drift"], why: "A little more strength and some knockdown resistance in the exilus slot." };
}

function frameArcanes(info: FrameInfo): { chain: string[]; why: Record<string, string> } {
  const why: Record<string, string> = {
    "Molt Augmented": "Strength that builds up with kills.",
    "Arcane Energize": "Energy for you and allies on energy pickups.",
    "Molt Reconstruct": "Heals you and allies as you spend energy.",
    "Arcane Grace": "Health regeneration when you're hurt.",
  };
  const r = info.roles[0];
  let chain =
    r === "tank" ? ["Arcane Grace", "Molt Augmented"]
    : r === "efficiency" ? ["Arcane Energize", "Molt Reconstruct"]
    : r === "range" ? ["Arcane Energize", "Molt Augmented"]
    : ["Molt Augmented", "Arcane Energize"];
  if (info.noEnergy) chain = ["Molt Augmented", "Arcane Grace"];
  return { chain, why };
}

// ---------------------------------------------------------------- companions, archwings, Necramechs

function companionPicks(item: CatalogItem): ModPick[] {
  const sentinel = item.category === "Sentinels";
  const robotic = sentinel || /Moa|Zanuka/i.test(item.uniqueName);
  const P = (key: string, chain: string[], why: string): ModPick => ({ key, chain, why });
  const loot = robotic ? P("loot", ["Vacuum"], "Picks up loot around you, the slot nobody leaves out.") : P("loot", ["Fetch"], "Picks up loot around you, the slot nobody leaves out.");
  return [
    loot,
    ...(sentinel ? [P("regen", ["Primed Regen", "Regen"], "Brings the sentinel back when it goes down.")] : []),
    P("linkVit", ["Link Vitality"], "Health from your warframe's: companions die fast without it."),
    P("linkFiber", ["Link Fiber"], "Armour from your warframe's."),
    P("vit", ["Enhanced Vitality"], "More health on top."),
    P("fiber", ["Metal Fiber"], "More armour on top."),
    P("radar", ["Primed Animal Instinct", "Animal Instinct"], "Loot and enemy radar."),
    ...(robotic ? [P("shield", ["Link Redirection"], "Shields from your warframe's.")] : [P("medi", ["Medi-Pet Kit"], "Health regeneration and a faster recovery.")]),
    ...(robotic ? [] : [P("bond", ["Vicious Bond"], "Its attacks strip armour for you.")]),
    P("loyal", ["Loyal Companion"], "Damage reduction for you when your health is low."),
    P("redir", ["Calculated Redirection"], "More shields."),
  ];
}

function archwingPicks(): ModPick[] {
  const P = (key: string, chain: string[], why: string): ModPick => ({ key, chain, why });
  return [
    P("speed", ["Hyperion Thrusters"], "Flight speed: most archwing time is spent getting somewhere."),
    P("vit", ["Enhanced Durability"], "Health."),
    P("str", ["Primed Morphic Transformer", "Morphic Transformer"], "Ability strength."),
    P("eff", ["System Reroute"], "Ability efficiency."),
    P("range", ["Energy Amplifier"], "Ability range."),
    P("armor", ["Argon Plating"], "Armour."),
    P("shield", ["Energy Inversion"], "Shields."),
    P("dur", ["Efficient Transferral"], "Ability duration."),
    P("energy", ["Auxiliary Power"], "Energy max."),
  ];
}

function necramechPicks(item: CatalogItem): ModPick[] {
  const P = (key: string, chain: string[], why: string): ModPick => ({ key, chain, why });
  // Bonewidow fights with Ironbride; the others shoot and cast.
  const melee = /Bonewidow/i.test(item.name) || /ThanoTech/i.test(item.uniqueName);
  const survive = [
    P("vit", ["Necramech Vitality"], "Health: Necramechs are tanks first."),
    P("fiber", ["Necramech Steel Fiber"], "Armour on that health."),
    P("rage", ["Necramech Rage"], "Damage taken refills energy, so abilities keep going."),
  ];
  const cast = [
    P("str", ["Necramech Intensify"], "Ability strength."),
    P("flow", ["Necramech Flow"], "A bigger energy pool."),
    P("eff", ["Necramech Streamline"], "Cheaper abilities."),
    P("dur", ["Necramech Continuity"], "Ability duration."),
    P("range", ["Necramech Stretch"], "Ability range."),
  ];
  const tail = [
    P("repair", ["Necramech Repair"], "Heals when health drops low."),
    P("shield", ["Necramech Redirection"], "Shield capacity."),
    P("engine", ["Necramech Efficiency"], "Longer hovering on the engine."),
    P("augur", ["Necramech Augur"], "Energy spent becomes shields."),
  ];
  if (melee) {
    const m = [
      P("melee", ["Necramech Pressure Point"], "Ironbride's damage."),
      P("fury", ["Necramech Fury"], "Ironbride's attack speed."),
      P("reach", ["Necramech Reach"], "Ironbride's range."),
    ];
    return [...survive, m[0], cast[0], cast[1], cast[2], m[1], cast[3], m[2], ...tail, cast[4]];
  }
  return [...survive, ...cast, ...tail];
}

// ---------------------------------------------------------------- capacity

const polarityOf = (v: unknown): Polarity | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "aura" || s === "any" || s === "omni") return "universal";
  return (["madurai", "vazarin", "naramon", "zenurik", "unairu", "penjaga", "umbra", "universal"] as string[]).includes(s) ? (s as Polarity) : null;
};

/** A mod's own polarity, or null when it has none that matters (universal mods drain as listed). */
const modPolarity = (m: CatalogItem): Polarity | null => {
  const p = polarityOf(m.polarity);
  return p === "universal" ? null : p;
};
const matches = (slot: Polarity | null, mod: Polarity | null) => !!slot && !!mod && (slot === mod || (slot === "universal" && mod !== "umbra"));

/** What a mod drains at a rank in a slot: matching halves it (rounded up), mismatching adds a quarter. */
export function drainIn(m: CatalogItem, rank: number, slot: Polarity | null): number {
  const base = (m.baseDrain ?? 0) + rank;
  const mp = modPolarity(m);
  if (!slot || !mp) return base;
  return matches(slot, mp) ? Math.ceil(base / 2) : Math.ceil(base * 1.25);
}

/** What an aura or stance adds: doubled in a matching slot, a fifth less in a mismatched one. */
export function bonusIn(m: CatalogItem, rank: number, slot: Polarity | null): number {
  const base = -(m.baseDrain ?? 0) + rank;
  const mp = modPolarity(m);
  if (!slot || !mp) return base;
  return matches(slot, mp) ? base * 2 : Math.floor(base * 0.8);
}

interface Placed {
  pick: ModPick;
  mod: CatalogItem;
  rank: number;
}

/**
 * Puts mods in slots for the least drain: each mod takes a matching slot if one is free (biggest
 * drains first), then the largest drains take the unpolarized slots, and the cheapest go last to
 * mismatched ones. Returns the slot index per mod and the total.
 */
function assign(mods: Placed[], slots: (Polarity | null)[]): { at: number[]; drain: number } {
  const at = new Array<number>(mods.length).fill(-1);
  const free = new Set(slots.map((_, i) => i));
  const order = mods.map((_, i) => i).sort((a, b) => (mods[b].mod.baseDrain ?? 0) + mods[b].rank - ((mods[a].mod.baseDrain ?? 0) + mods[a].rank));
  for (const i of order) {
    const mp = modPolarity(mods[i].mod);
    const s = [...free].find((k) => matches(slots[k], mp));
    if (s !== undefined) {
      at[i] = s;
      free.delete(s);
    }
  }
  for (const i of order) {
    if (at[i] >= 0) continue;
    const s = [...free].find((k) => !slots[k]) ?? [...free][0];
    if (s === undefined) continue;
    at[i] = s;
    free.delete(s);
  }
  let drain = 0;
  mods.forEach((p, i) => (drain += drainIn(p.mod, p.rank, slots[at[i]] ?? null)));
  return { at, drain };
}

// ---------------------------------------------------------------- resolving picks

interface Resolved {
  pick: ModPick;
  /** The owned mod used, or null when none of the chain is owned. */
  mod: CatalogItem | null;
  /** The best of the chain, when it isn't the one used (an upgrade). */
  better: CatalogItem | null;
}

function resolve(pick: ModPick, owned: Owned, index: ModIndex, tier: Tier): Resolved {
  // Only what the tier allows: a Primed mod is no upgrade for a new player.
  const chain = pick.chain.map((n) => index.byName.get(n)).filter((m): m is CatalogItem => !!m && allowedAt(m, tier));
  const mod = chain.find((m) => owned.has(m.uniqueName)) ?? null;
  const best = chain[0] ?? null;
  return { pick, mod, better: best && best !== mod ? best : null };
}

// ---------------------------------------------------------------- suggest

/** The most Forma a high-tier suggestion spends on polarities: a heavily invested build, not a maxed one. */
export const MAX_FORMA = 6;
const FORTY_BY_FORMA = (name: string) => /^(Kuva|Tenet|Coda|Dual Coda) /.test(name) || name === "Paracesis";

interface Layout {
  mods: number;
  aura: number;
  exilus: boolean;
  stance: boolean;
  arcanes: number;
  arcaneAdapter: boolean;
}

function layoutOf(kind: GearKind): Layout {
  switch (kind) {
    case "warframe":
      // Jade has two aura slots, but a Build holds one aura: the second is left to the player (see the note).
      return { mods: 8, aura: 1, exilus: true, stance: false, arcanes: 2, arcaneAdapter: false };
    case "necramech":
      return { mods: 12, aura: 0, exilus: false, stance: false, arcanes: 0, arcaneAdapter: false };
    case "companion":
      return { mods: 10, aura: 0, exilus: false, stance: false, arcanes: 0, arcaneAdapter: false };
    case "melee":
      return { mods: 8, aura: 0, exilus: true, stance: true, arcanes: 1, arcaneAdapter: true };
    case "primary":
    case "secondary":
      return { mods: 8, aura: 0, exilus: true, stance: false, arcanes: 1, arcaneAdapter: true };
    default:
      return { mods: 8, aura: 0, exilus: false, stance: false, arcanes: 0, arcaneAdapter: false };
  }
}

const usesReactor = (kind: GearKind) => kind === "warframe" || kind === "companion" || kind === "archwing" || kind === "necramech" || kind === "exalted";

function weaponExilus(item: CatalogItem, cls: WeaponClass, kind: GearKind): { chain: string[]; why: string } | null {
  if (kind !== "primary" && kind !== "secondary") return null;
  const why = "Ammo: the exilus slot takes utility mods, and this keeps the gun fed.";
  if (cls === "shotgun") return { chain: ["Primed Shotgun Ammo Mutation", "Shotgun Ammo Mutation"], why };
  if (cls === "pistol") return { chain: ["Primed Pistol Ammo Mutation", "Pistol Ammo Mutation"], why };
  if (item.type === "Rifle") return { chain: ["Primed Rifle Ammo Mutation", "Rifle Ammo Mutation"], why };
  return null;
}

function weaponArcane(item: CatalogItem, cls: WeaponClass, focus: Focus): { chain: string[]; why: string } | null {
  if (cls === "melee") return (item.criticalChance ?? 0) >= 0.2
    ? { chain: ["Melee Duplicate"], why: "Base crits strike twice; worth it on a crit melee." }
    : { chain: ["Melee Crescendo"], why: "Finishers raise your starting combo for the mission." };
  if (cls === "pistol") return focus === "status"
    ? { chain: ["Secondary Encumber"], why: "Each status proc can add another." }
    : { chain: ["Secondary Merciless", "Secondary Deadhead"], why: "Damage that stacks up with kills." };
  if (cls === "rifle" || cls === "shotgun") return item.type === "Sniper" || item.type === "Bow"
    ? { chain: ["Primary Deadhead", "Primary Merciless"], why: "Big damage stacks from headshot kills, which this weapon gets." }
    : { chain: ["Primary Merciless", "Primary Deadhead"], why: "Damage that stacks up with kills." };
  return null;
}

/**
 * orbiter's suggestion for an item at a tier, built from the mods the player owns.
 * Warframes also get a `loadout` (shards, Helminth, support weapons, arcanes, companion, Focus);
 * pass `held` (heldFrom the inventory) so it can mark what you hold. Weapons that take a riven
 * get `riven`: the ideal one, from `rivens.market` (what's listed for the weapon) and orbiter's
 * rule, and `rivens.mine` (the player's parsed rivens) scored against it.
 * Throws if the item takes no build (check canSuggest first).
 */
export function suggest(item: CatalogItem, tier: Tier, owned: Owned, index: ModIndex, now = 0, held: Held | null = null, rivens: RivenContext | null = null, variantId: string | null = null): Suggestion {
  const kind = gearKindOf(item);
  if (!kind || !canSuggest(item)) throw new Error(`orbiter has no suggestion for ${item.name}`);
  const layout = layoutOf(kind);
  const high = tier === "high";
  // A Catalyst/Reactor, Forma and the exilus slot from Intermediate on.
  const doubled = tier !== "low";
  const variants = variantsFor(item);
  const variant = variants.find((v) => v.id === variantId) ?? variants[0];
  const forty = kind === "necramech" || (doubled && FORTY_BY_FORMA(item.name));
  const capacity = (forty ? 40 : 30) * (doubled ? 2 : 1);

  // What to put in, best first.
  let picks: ModPick[];
  let focus: string;
  let info: FrameInfo | null = null;
  let cls: WeaponClass | null = null;
  let wFocus: Focus = "base";
  let meleeClass: string | null = null;
  if (kind === "warframe") {
    info = frameInfo(item.name) ?? DEFAULT_FRAME;
    picks = framePicks(info, tier, variant);
    focus = info.roles.join(" + ");
  } else if (kind === "companion") {
    picks = companionPicks(item);
    focus = "companion";
  } else if (kind === "archwing") {
    picks = archwingPicks();
    focus = "archwing";
  } else if (kind === "necramech") {
    picks = necramechPicks(item);
    focus = "necramech";
  } else {
    cls = weaponClassOf(item, kind)!;
    wFocus = focusOf(item, cls);
    meleeClass = cls === "melee" && kind === "melee" ? meleeClassOf(item) : null;
    picks = weaponPicks(item, cls, wFocus, meleeClass);
    focus = wFocus;
  }

  // Two picks can land on the same mod (a chain's fallback): the first keeps it.
  const seen = new Set<string>();
  const resolved = picks.map((p) => resolve(p, owned, index, tier)).filter((r) => {
    const path = (r.mod ?? r.better)?.uniqueName;
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
  const upgrades: Upgrade[] = [];
  const addUpgrade = (m: CatalogItem, replaces: string | null, reason: string) => {
    if (!upgrades.some((u) => u.path === m.uniqueName)) upgrades.push({ name: m.name, path: m.uniqueName, replaces, reason });
  };

  // Aura(s), stance, exilus: owned only; the better ones become upgrades.
  const slotPols = Array.from({ length: layout.mods }, (_, k) => polarityOf(item.polarities?.[k]));
  const rawAura = item.aura as unknown;
  const auraPols: (Polarity | null)[] = Array.isArray(rawAura) ? rawAura.map(polarityOf) : [polarityOf(rawAura)];
  const auras: { mod: CatalogItem; why: string; pol: Polarity | null }[] = [];
  if (layout.aura && info) {
    const a = frameAura(info, variant);
    const chain = [...a.chain, "Corrosive Projection", "Energy Siphon", "Growing Power", "Steel Charge"].filter((n, k, all) => all.indexOf(n) === k);
    const ownedAuras = chain.map((n) => index.byName.get(n)).filter((m): m is CatalogItem => !!m && owned.has(m.uniqueName) && allowedAt(m, tier));
    const want = index.byName.get(a.chain[0]);
    const best = want && allowedAt(want, tier) ? want : undefined;
    for (let k = 0; k < layout.aura && k < ownedAuras.length; k++) {
      const m = ownedAuras[k];
      auras.push({ mod: m, why: k === 0 && m === best ? a.why : k === 0 ? `${m.name}: the aura you have closest to ${a.chain[0]}; any aura adds capacity.` : `${m.name}: a second aura, for its capacity and effect.`, pol: auraPols[k] ?? null });
    }
    if (best && !owned.has(best.uniqueName)) addUpgrade(best, auras[0]?.mod.name ?? null, a.why);
  }
  let stance: { mod: CatalogItem; why: string } | null = null;
  if (layout.stance && meleeClass) {
    const all = index.stances.get(meleeClass) ?? [];
    const mine = all.filter((m) => owned.has(m.uniqueName) && allowedAt(m, tier));
    if (mine.length) stance = { mod: mine[0], why: `A ${meleeClass} stance: pick whichever you like to play; it mostly adds capacity.` };
    else if (all[0]) addUpgrade(all[0], null, `Any ${meleeClass} stance: it adds capacity and combos.`);
  }
  let exilus: { mod: CatalogItem; why: string } | null = null;
  if (doubled && layout.exilus) {
    const e = info ? frameExilus(info, variant) : cls ? weaponExilus(item, cls, kind) : null;
    if (e) {
      const r = resolve({ key: "exilus", chain: e.chain, why: e.why }, owned, index, tier);
      if (r.mod) exilus = { mod: r.mod, why: r.mod.name === e.chain[0] ? e.why : `${e.why} (${r.mod.name} until you have ${e.chain[0]})` };
      if (r.better) addUpgrade(r.better, r.mod?.name ?? null, e.why);
    }
  }
  const exilusPol = polarityOf(item.exilusPolarity);

  // ---- fit the mods
  const owners = resolved.filter((r) => r.mod);
  let placed: Placed[] = owners.slice(0, layout.mods).map((r) => ({ pick: r.pick, mod: r.mod!, rank: r.mod!.maxRank ?? 0 }));
  let rest = owners.slice(layout.mods);
  const pols = [...slotPols];
  const auraSlots = [...auraPols];
  let stancePol = polarityOf((item as { stancePolarity?: string }).stancePolarity);
  let exPol = exilusPol;
  let forma = 0;
  let umbra = 0;
  const polarize = (to: Polarity) => {
    if (to === "umbra") umbra++;
    forma++;
  };

  const fixedBonus = () => {
    let b = 0;
    auras.forEach((a, k) => (b += bonusIn(a.mod, a.mod.maxRank ?? 0, auraSlots[k] ?? null)));
    if (stance) b += bonusIn(stance.mod, stance.mod.maxRank ?? 0, stancePol);
    if (exilus) b -= drainIn(exilus.mod, exilus.mod.maxRank ?? 0, exPol);
    return b;
  };
  const used = () => assign(placed, pols).drain - fixedBonus();

  if (doubled) {
    // The aura, stance and exilus slots first: a matching aura doubles what it gives.
    auras.forEach((a, k) => {
      const mp = modPolarity(a.mod);
      if (mp && !matches(auraSlots[k] ?? null, mp)) {
        auraSlots[k] = mp;
        polarize(mp);
      }
    });
    if (stance) {
      const mp = modPolarity(stance.mod);
      if (mp && !matches(stancePol, mp)) {
        stancePol = mp;
        polarize(mp);
      }
    }
    if (exilus) {
      const mp = modPolarity(exilus.mod);
      if (mp && !matches(exPol, mp) && used() > capacity) {
        exPol = mp;
        polarize(mp);
      }
    }
    // Then a Forma at a time where it saves the most, until it fits, up to MAX_FORMA. Kuva,
    // Tenet and Coda weapons take five Forma to reach rank 40 anyway, so those five polarize
    // slots for free.
    const free = FORTY_BY_FORMA(item.name) ? 5 : 0;
    for (let guard = 0; guard < layout.mods && forma < MAX_FORMA; guard++) {
      if (used() <= capacity && forma >= free) break;
      const { at } = assign(placed, pols);
      let bestGain = 0;
      let bestSlot = -1;
      let bestPol: Polarity | null = null;
      placed.forEach((p, i) => {
        const mp = modPolarity(p.mod);
        const s = at[i];
        if (!mp || s < 0 || matches(pols[s], mp)) return;
        const gain = drainIn(p.mod, p.rank, pols[s]) - drainIn(p.mod, p.rank, mp);
        if (gain > bestGain) {
          bestGain = gain;
          bestSlot = s;
          bestPol = mp;
        }
      });
      if (bestSlot < 0 || !bestPol) break;
      pols[bestSlot] = bestPol;
      polarize(bestPol);
    }
  }
  const formaSlots = forma;
  if (doubled && FORTY_BY_FORMA(item.name)) forma = Math.max(forma, 5);

  // Still over: keep the first k mods for the k that's worth most, lowering the least valuable
  // ones a rank at a time (down to a third of their ranks) until they fit. A mod's worth is its
  // priority weight times the share of its effect left at that rank.
  const top = placed.map((p) => ({ ...p }));
  if (used() > capacity) {
    const floorOf = (m: CatalogItem) => Math.ceil((m.maxRank ?? 0) / 3);
    const worth = (ps: Placed[]) => ps.reduce((s, p, i) => s + (1 - i * 0.07) * ((p.rank + 1) / ((p.mod.maxRank ?? 0) + 1)), 0);
    let best: Placed[] = [];
    let bestWorth = -1;
    for (let k = top.length; k >= 1; k--) {
      placed = top.slice(0, k).map((p) => ({ ...p }));
      for (let i = k - 1; i >= 0 && used() > capacity; i--) while (used() > capacity && placed[i].rank > floorOf(placed[i].mod)) placed[i].rank--;
      if (used() > capacity) continue;
      const w = worth(placed);
      if (w > bestWorth) {
        bestWorth = w;
        best = placed;
      }
    }
    placed = best;
    rest = [...owners.slice(placed.length, layout.mods), ...rest];
    // Room left: lower-priority mods that fit, at full rank or at least a third of it.
    while (placed.length < layout.mods && rest.length) {
      const r = rest[0];
      rest = rest.slice(1);
      const p: Placed = { pick: r.pick, mod: r.mod!, rank: r.mod!.maxRank ?? 0 };
      placed.push(p);
      while (used() > capacity && p.rank > floorOf(p.mod)) p.rank--;
      if (used() > capacity) placed.pop();
    }
  }
  const capacityBound = placed.length < Math.min(layout.mods, owners.length);

  // Slot order, with Toxin and Cold ahead of Heat so they combine into Viral.
  let { at } = assign(placed, pols);
  const elemAt = (e: ModPick["element"]) => placed.findIndex((p) => p.pick.element === e);
  const hi = elemAt("heat");
  const pair = [elemAt("toxin"), elemAt("cold")].filter((i) => i >= 0);
  let orderNote = "";
  if (hi >= 0 && pair.length === 2) {
    const lastPair = pair.reduce((x, y) => (at[x] > at[y] ? x : y));
    if (at[hi] < at[lastPair]) {
      const swapped = [...at];
      [swapped[hi], swapped[lastPair]] = [swapped[lastPair], swapped[hi]];
      const d = placed.reduce((s, p, i) => s + drainIn(p.mod, p.rank, pols[swapped[i]] ?? null), 0) - fixedBonus();
      if (d <= capacity) at = swapped;
      else orderNote = ` In game, keep ${placed[hi].mod.name} after ${placed[pair[0]].mod.name} and ${placed[pair[1]].mod.name}, so Toxin and Cold combine into Viral.`;
    }
  }

  const finalUsed = placed.reduce((sum, p, i) => sum + drainIn(p.mod, p.rank, pols[at[i]] ?? null), 0) - fixedBonus();
  const mods: (BuildMod | null)[] = new Array(layout.mods).fill(null);
  const modNames: (string | null)[] = new Array(layout.mods).fill(null);
  const modReasons: (string | null)[] = new Array(layout.mods).fill(null);
  placed.forEach((p, i) => {
    const s = at[i];
    const max = p.mod.maxRank ?? 0;
    mods[s] = p.rank === max ? { path: p.mod.uniqueName } : { path: p.mod.uniqueName, rank: p.rank };
    modNames[s] = p.mod.name;
    modReasons[s] = p.rank === max ? p.pick.why : `${p.pick.why} Rank ${p.rank} of ${max}, to fit ${capacity} capacity.`;
  });

  // Upgrades: a better mod than the one used, and the picks that would be in with more mods.
  const inBuild = new Set(placed.map((p) => p.pick.key));
  for (const r of resolved) {
    if (r.mod && inBuild.has(r.pick.key) && r.better) addUpgrade(r.better, r.mod.name, r.pick.why);
  }
  for (const r of resolved.slice(0, layout.mods)) {
    if (!r.mod && r.better) addUpgrade(r.better, null, r.pick.why);
  }

  // Arcanes: warframes from medium; weapons at the high tier, with an Arcane Adapter.
  const arcanes: BuildMod[] = [];
  const arcaneNames: string[] = [];
  const arcaneReasons: string[] = [];
  let arcaneAdapter = false;
  const arcaneOK = layout.arcanes > 0 && (layout.arcaneAdapter ? high : doubled);
  if (arcaneOK) {
    const plan = info
      ? (() => {
          const a = frameArcanes(info);
          return a.chain.map((n) => ({ chain: [n], why: a.why[n] ?? "" }));
        })()
      : cls
        ? [weaponArcane(item, cls, wFocus)].filter((x): x is { chain: string[]; why: string } => !!x)
        : [];
    for (const a of plan.slice(0, layout.arcanes)) {
      const r = resolve({ key: "arcane", chain: a.chain, why: a.why }, owned, index, tier);
      if (r.mod) {
        arcanes.push({ path: r.mod.uniqueName });
        arcaneNames.push(r.mod.name);
        arcaneReasons.push(a.why);
        if (layout.arcaneAdapter) arcaneAdapter = true;
      }
      if (r.better) addUpgrade(r.better, r.mod?.name ?? null, a.why);
    }
  }

  const s: Suggestion = {
    id: variant === variants[0] ? `orbiter-${tier}-${item.uniqueName}` : `orbiter-${tier}-${variant.id}-${item.uniqueName}`,
    item: item.uniqueName,
    kind,
    title: `orbiter's suggestion (${TIER_NAME[tier]}${variants.length > 1 ? `, ${variant.label}` : ""})`,
    mods,
    polarities: {
      mods: pols,
      ...(layout.aura ? { aura: auraSlots[0] ?? null } : {}),
      ...(layout.exilus ? { exilus: exPol } : {}),
      ...(layout.stance ? { stance: stancePol } : {}),
    },
    arcanes,
    shards: [],
    catalyst: doubled,
    adapters: { exilus: !!exilus, arcane: arcaneAdapter },
    forma,
    source: "orbiter",
    importedAt: now,
    tier,
    focus,
    capacity: { max: capacity, used: finalUsed },
    formaSlots,
    umbraForma: umbra,
    reasons: { mods: modReasons, arcanes: arcaneReasons },
    names: { mods: modNames, arcanes: arcaneNames },
    upgrades,
    note: "",
    tags: [...variant.tags],
    variant: { id: variant.id, label: variant.label },
  };
  if (auras[0]) {
    s.aura = { path: auras[0].mod.uniqueName };
    s.reasons.aura = auras[0].why;
    s.names.aura = auras[0].mod.name;
  }
  if (stance) {
    s.stance = { path: stance.mod.uniqueName };
    s.reasons.stance = stance.why;
    s.names.stance = stance.mod.name;
  }
  if (exilus) {
    s.exilus = { path: exilus.mod.uniqueName };
    s.reasons.exilus = exilus.why;
    s.names.exilus = exilus.mod.name;
  }
  s.note = noteFor(item, kind, tier, info, cls, wFocus, meleeClass, layout, s, capacityBound) + orderNote + variantNote(variant, variants);
  const loadout = loadoutFor(item, tier, owned, index, held);
  if (loadout) s.loadout = loadout;
  const riven = rivenFor(item, kind, rivens);
  if (riven) s.riven = riven;
  return s;
}

/** The kinds of gear a riven goes on. */
const TAKES_RIVEN = new Set<GearKind>(["primary", "secondary", "melee", "archgun", "companionWeapon"]);

/** The ideal riven for a weapon and the player's rivens against it, or null for gear that takes none. */
export function rivenFor(item: CatalogItem, kind: GearKind | null, rivens: RivenContext | null): WeaponRiven | null {
  if (!kind || !TAKES_RIVEN.has(kind)) return null;
  const ideal = idealRiven(item, rivens?.market ?? null);
  const out: WeaponRiven = { ideal };
  if (rivens?.mine) out.yours = rivensFor(item, rivens.mine).map((riven) => ({ riven, fit: rivenFit(riven, ideal) })).sort((a, b) => b.fit.score - a.fit.score);
  return out;
}

/** Every variant of an item at a tier (variantsFor), the default first. */
export function suggestVariants(item: CatalogItem, tier: Tier, owned: Owned, index: ModIndex, now = 0, held: Held | null = null, rivens: RivenContext | null = null): Suggestion[] {
  return variantsFor(item).map((v) => suggest(item, tier, owned, index, now, held, rivens, v.id));
}

function variantNote(v: Variant, all: Variant[]): string {
  if (all.length < 2) return "";
  const what =
    v.survival === "shieldGate" ? "shield gating up front (Catalyzing Shields, Brief Respite), for content that hits hard"
    : v.survival === "health" ? "survival up front, for the Steel Path and longer runs"
    : v.nuke ? "efficiency and range up front"
    : "damage and utility first, for the normal star chart";
  return ` This is the ${v.label} variant: ${what}${v.nuke && v.survival ? ", with efficiency and range for clearing rooms" : ""}. Other variants: ${all.filter((x) => x !== v).map((x) => x.label).join(", ")}.`;
}

/** The three tiers at once (each tier's default variant). */
export function suggestAll(item: CatalogItem, owned: Owned, index: ModIndex, now = 0, held: Held | null = null, rivens: RivenContext | null = null): Record<Tier, Suggestion> {
  return { low: suggest(item, "low", owned, index, now, held, rivens), medium: suggest(item, "medium", owned, index, now, held, rivens), high: suggest(item, "high", owned, index, now, held, rivens) };
}

function noteFor(item: CatalogItem, kind: GearKind, tier: Tier, info: FrameInfo | null, cls: WeaponClass | null, focus: Focus, meleeClass: string | null, layout: Layout, s: Suggestion, capacityBound: boolean): string {
  const parts: string[] = [];
  const doubler = usesReactor(kind) ? "Orokin Reactor" : "Orokin Catalyst";
  const invest =
    tier === "low" ? `New player: basic mods only, no ${doubler}, no Forma: ${s.capacity.max} capacity.`
    : `${TIER_NAME[tier]}${tier === "medium" ? " (no Primed, Archon or Umbral mods, no shards)" : ""}: with an ${doubler}${s.forma ? `, ${s.forma} Forma${s.umbraForma ? ` (${s.umbraForma} Umbra)` : ""}` : ""}${s.adapters?.exilus ? ", an Exilus Adapter" : ""}${s.adapters?.arcane ? " and an Arcane Adapter" : ""}: ${s.capacity.max} capacity.`;
  if (kind === "warframe" && info) {
    parts.push(`orbiter's suggestion: a starting point from ${item.name}'s usual role (${info.roles.join(" and ")}) in orbiter's curated table, not from a player's build.${info.guess ? " orbiter knows this frame only from its ability text, so treat the role as a guess." : ""}`);
    parts.push("Not everything is numbers: how often you cast decides the energy mods, and where you fight decides knockdown protection.");
    if (Array.isArray(item.aura as unknown)) parts.push(`${item.name} has a second aura slot; orbiter's builds hold one aura for now, so put any other aura you hold there for more capacity.`);
    if (info.roles.includes("strength")) parts.push("Players often swap a strength mod for range or duration once they know which ability they lean on.");
    else parts.push("Players often trade a utility mod for more survivability on harder missions.");
  } else if (cls) {
    const what = { crit: "crit-focused", status: "status-focused", hybrid: "a crit and status hybrid", base: "neither crit nor status heavy, so it leans on raw damage and elements" }[focus];
    parts.push(`orbiter's suggestion: a starting point from ${item.name}'s stats (${statusLine(item)}: ${what}), with the core most players run.`);
    parts.push("Elements default to Viral and Heat for general use; against armoured Grineer, players often swap Heat for Electricity to make Corrosive with the Toxin, or run Corrosive outright.");
    if (cls === "melee" && kind === "melee" && !meleeClass) parts.push("orbiter can't tell this weapon's class, so pick any stance you hold for it: it adds capacity.");
    if (cls === "melee") parts.push("Heavy-attack players swap Blood Rush and Weeping Wounds for heavy-attack mods.");
    if (kind === "companionWeapon") parts.push("Companion weapons take the mods of what they are; orbiter reads that from the weapon's game path.");
  } else if (kind === "necramech") {
    parts.push(`orbiter's suggestion: a simple Necramech template (survival first, then abilities), not from a player's build.`);
  } else if (kind === "companion") {
    parts.push("orbiter's suggestion: a simple companion template (loot and survival); players often add the precepts their companion is known for.");
  } else {
    parts.push("orbiter's suggestion: a simple archwing template, flight speed and survival first.");
  }
  parts.push(invest);
  const empty = s.mods.filter((m) => !m).length;
  if (empty) parts.push(capacityBound ? `${empty} of ${layout.mods} slots left empty: ${s.capacity.max} capacity runs out first.` : `${empty} of ${layout.mods} slots left empty: you don't hold a mod orbiter would put there; see the upgrades.`);
  return parts.join(" ");
}

// ---------------------------------------------------------------- the loadout around a warframe build

// The facts (stats, effects, the page each was read on) live in loadout-synergies.json; the rules
// for which of them suit a frame are here, from the same curated roles and flags the mods use.

interface ShardStat {
  colour: ShardColour;
  stat: string;
  value: string;
  tauforged: string;
}
interface Named {
  name: string;
  path: string;
}
type Need = "strength" | "energy" | "efficiency" | "duration";
type School = "Zenurik" | "Vazarin" | "Madurai";
interface SetDef {
  pieces: { name: string; slot: SlotKind; aura?: boolean; replaces?: string }[];
  bonus: string;
  companion?: "kubrow" | "charger" | "beast";
  fit: SetFit | null;
  why: string;
  source: string;
}
type SetFit = "shieldGate" | "statusKit" | "healthTank" | "spamTank";
interface PrimerDef {
  items: Named[];
  mod: string;
  element: Element;
  effect: string;
  source: string;
  bond?: { name: string; effect: string; source: string };
  weapon?: { items: Named[]; mod: string; effect: string; source: string };
}
interface Synergies {
  shards: {
    source: string;
    slots: number;
    tauforgedNote: string;
    stats: ShardStat[];
    fusion: { name: string; ratio: number; cost: string; needs: string; since: string; effect: string; source: string };
    elements: Record<Element, { colour: ShardColour | null; stat: string | null; note?: string }>;
  };
  kitElements: Record<string, { element: Element; ability: string; source: string }>;
  shieldGating: { frames: string[]; source: string; note: string };
  sets: Record<string, SetDef>;
  primers: Record<string, PrimerDef>;
  helminth: { frames: Record<string, { ability: string; replaces: string; from: string | null; fromPath: string | null; alt: string; why: string; source: string }> };
  grimoire: { name: string; path: string; note: string; source: string; invocations: Record<Need, { name: string; effect: string; source: string }> };
  kitgun: { name: string; on: string; effect: string; note: string; source: string };
  arcanes: { source: string; effects: Record<string, string> };
  companions: Record<string, { items: Named[]; mod: string; effect: string; source: string }>;
  focus: Record<School, { effect: string; source: string }>;
}
const SYN = synergies as unknown as Synergies;

/** Archon Shard paths by colour; the Tauforged one adds "Mythic" (the same as missing.ts's SHARD_PATH). */
export const SHARD_PATHS: Record<ShardColour, string> = {
  crimson: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalAmar",
  azure: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalBoreal",
  amber: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalNira",
  violet: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalViolet",
  topaz: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalOrange",
  emerald: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalGreen",
};
const SHARD_NAME: Record<ShardColour, string> = { crimson: "Crimson", azure: "Azure", amber: "Amber", violet: "Violet", topaz: "Topaz", emerald: "Emerald" };

const TIER_RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };
const atLeast = (tier: Tier, from: Tier) => TIER_RANK[tier] >= TIER_RANK[from];

const TAG_ELEMENT: Record<string, Element> = {
  DT_CORROSIVE_COLOR: "corrosive",
  DT_ELECTRICITY_COLOR: "electricity",
  DT_RADIATION_COLOR: "radiation",
  DT_POISON_COLOR: "toxin",
  DT_FIRE_COLOR: "heat",
  DT_FREEZE_COLOR: "cold",
  DT_EXPLOSION_COLOR: "blast",
  DT_VIRAL_COLOR: "viral",
};
const baseName = (name: string) => name.replace(/\s+(Prime|Umbra)$/, "");

/**
 * The elements a frame's kit deals, in ability order: from the catalog's ability text tags
 * (<DT_*_COLOR>), else from orbiter's curated list for frames the text doesn't tag (Ember, Gyre).
 */
export function kitElements(item: CatalogItem): KitElement[] {
  const abilities = ((item as { abilities?: { name?: string; description?: string }[] }).abilities ?? []).filter((a) => a.description);
  const out: KitElement[] = [];
  const add = (element: Element, ability: string, source: string) => {
    if (out.some((e) => e.element === element)) return;
    const e = SYN.shards.elements[element];
    out.push({ element, ability, colour: e?.colour ?? null, stat: e?.stat ?? null, source, ...(e?.note ? { note: e.note } : {}) });
  };
  for (const a of abilities) {
    for (const m of a.description!.matchAll(/<(DT_[A-Z_]+)>/g)) {
      const el = TAG_ELEMENT[m[1]];
      if (el) add(el, a.name ?? "", "the catalog's ability text");
    }
  }
  if (!out.length) {
    const c = SYN.kitElements[baseName(item.name)];
    if (c) add(c.element, c.ability, c.source);
  }
  return out;
}

// The shard stats an element can feed, best first: ability damage, then Toxin's status damage.
const SHARD_ELEMENT_ORDER: Element[] = ["corrosive", "electricity", "radiation", "toxin"];

/** The kit element a shard feeds on, if any (Saryn's Corrosive Spores, Volt's Electricity). */
export function shardElement(item: CatalogItem): KitElement | null {
  const els = kitElements(item).filter((e) => e.stat);
  return SHARD_ELEMENT_ORDER.map((el) => els.find((e) => e.element === el)).find((e) => !!e) ?? null;
}

function kitElement(item: CatalogItem): { stat: string; why: string } | null {
  const e = shardElement(item);
  if (!e) return null;
  const name = { corrosive: "Corrosive", electricity: "Electricity", radiation: "Radiation", toxin: "Toxin" }[e.element as "corrosive"];
  return { stat: e.stat!, why: `${e.ability} deals ${name}, so this one feeds on the kit's own hits.` };
}

/** The five shard stats for a frame, from its roles and flags. */
function shardPlan(item: CatalogItem, info: FrameInfo): { stat: string; why: string }[] {
  const roles = new Set(info.roles);
  const first = info.roles[0];
  const plan: { stat: string; why: string }[] = [];
  const add = (stat: string, why: string, n = 1) => {
    for (let k = 0; k < n; k++) plan.push({ stat, why });
  };
  if (first === "tank") {
    if (info.shields) add("Shield Capacity", "flat shields, which this frame lives on.", 3);
    else {
      add("Armor", "flat armour on top of the frame's own, the base of a tank.", 2);
      add("Health", "flat health for the armour to multiply.");
    }
    if (roles.has("strength")) add("Ability Strength", "its defensive abilities scale with strength.");
  } else if (first === "strength") {
    add("Ability Strength", "strength is this frame's main multiplier.", 2);
  } else {
    add("Ability Duration", "this kit's effects are timers, and duration keeps them up.", 2);
    if (roles.has("strength")) add("Ability Strength", "its buffs and damage scale with strength.");
  }
  add("Casting Speed", "faster casts, less time standing still.");
  if (info.spam && !info.noEnergy) add("Energy Orb Effectiveness", "each energy orb gives more, for a frame that casts all the time.");
  const el = roles.has("strength") ? kitElement(item) : null;
  if (el) add(el.stat, el.why);
  if (info.duration && !plan.some((p) => p.stat === "Ability Duration")) add("Ability Duration", "its key abilities are timers.");
  while (plan.length < SYN.shards.slots) {
    if (first === "tank") add(info.shields ? "Shield Capacity" : "Health", "more survival in the last free slot.");
    else if (roles.has("strength")) add("Ability Strength", "more strength in the last free slot.");
    else add("Ability Duration", "more duration in the last free slot.");
  }
  return plan.slice(0, SYN.shards.slots);
}

function shardPicks(item: CatalogItem, info: FrameInfo, tier: Tier, held: Held | null): LoadoutPick[] {
  // Archon shards are Veteran: Archon hunts come late.
  if (!atLeast(tier, "high")) return [];
  // Tauforged only, at every tier: a plain shard is the same stat at two thirds of the value.
  // Each Tauforged shard you hold marks one pick: three picks of a colour with two held marks two.
  const left = new Map<string, number>();
  const f = SYN.shards.fusion;
  // The fusion note goes on the first pick of a colour you don't hold, once.
  const noted = new Set<ShardColour>();
  return shardPlan(item, info).map(({ stat, why }) => {
    const s = SYN.shards.stats.find((x) => x.stat === stat)!;
    const path = SHARD_PATHS[s.colour] + "Mythic";
    const have = left.get(path) ?? held?.get(path) ?? 0;
    left.set(path, have - 1);
    const plain = held?.get(SHARD_PATHS[s.colour]) ?? 0;
    const pick: LoadoutPick = {
      name: `Tauforged ${SHARD_NAME[s.colour]} Archon Shard`,
      path,
      owned: held ? have > 0 : null,
      reason: `${s.stat} ${s.tauforged}: ${why}`,
      tier: "high",
      source: SYN.shards.source,
      colour: s.colour,
      tauforged: true,
      stat: s.stat,
    };
    if (held && have <= 0 && plain > 0 && !noted.has(s.colour)) {
      noted.add(s.colour);
      const make = Math.floor(plain / f.ratio);
      pick.fuse = `You hold ${plain} plain ${SHARD_NAME[s.colour]} shard${plain === 1 ? "" : "s"}: ${f.name} ${f.effect} (${f.ratio} for 1, ${f.cost}; needs ${f.needs}; since ${f.since}).${make ? ` Yours make ${make}.` : ` You need ${f.ratio - (plain % f.ratio)} more for one.`}`;
    }
    return pick;
  });
}

function helminthPick(item: CatalogItem, tier: Tier, held: Held | null): LoadoutPick | null {
  if (!atLeast(tier, "medium")) return null;
  const h = SYN.helminth.frames[item.name.replace(/\s+(Prime|Umbra)$/, "")];
  if (!h) return null;
  // The Helminth is Intermediate; an ability from a hard frame to get (Grendel's Nourish) Veteran.
  const hard = hardDonorOf(h.ability);
  if (hard && tier !== "high") return null;
  // The base frame (never a Prime) is what gets subsumed. Held: you can do it now. Not held: you
  // may have already, and orbiter can't see the Helminth until TennoScope reads it.
  const canFeed = !!(held && h.fromPath && (held.get(h.fromPath) ?? 0) > 0);
  const donor = h.from ? ` It comes from a base ${h.from} (not a Prime) fed to the Helminth${canFeed ? ", and you hold one" : ""}.` : " It's one of the Helminth's own abilities.";
  const hardNote = hard ? ` Veteran: ${hard.why}.` : "";
  return { name: h.ability, owned: canFeed ? true : null, reason: `${h.ability} over ${h.replaces}: ${h.why}${donor} ${h.alt}${hardNote}`, tier: hard ? "high" : "medium", source: hard ? `${h.source} ; ${hard.source}` : h.source, ability: h.ability, replaces: h.replaces };
}

/** What the frame's one Grimoire Invocation should give it. */
function grimoireNeed(info: FrameInfo): Need {
  const roles = new Set(info.roles);
  const energy = info.spam && !info.noEnergy;
  const first = info.roles[0];
  if (first === "strength" || (first === "tank" && roles.has("strength"))) return "strength";
  if (first === "efficiency") return energy ? "energy" : info.duration || info.noEnergy ? "duration" : "efficiency";
  if (first === "range") return info.duration ? "duration" : energy ? "energy" : roles.has("strength") ? "strength" : "duration";
  return "duration";
}

function supportWeaponPicks(info: FrameInfo, tier: Tier, owned: Owned, held: Held | null, index: ModIndex): LoadoutPick[] {
  const out: LoadoutPick[] = [];
  const g = SYN.grimoire;
  const need = grimoireNeed(info);
  const inv = g.invocations[need];
  const mod = index.byName.get(inv.name);
  const haveBook = held ? (held.get(g.path) ?? 0) > 0 : null;
  const haveMod = !!mod && owned.has(mod.uniqueName);
  // Below the high tier only when you hold both: nothing to get.
  const both = haveBook === true && haveMod;
  if (both || tier === "high") {
    const t: Tier = both ? "low" : "high";
    const swap = need === "strength" && info.spam && !info.noEnergy ? ` Short on energy? ${g.invocations.energy.name} instead: ${g.invocations.energy.effect}.` : "";
    out.push({ name: g.name, path: g.path, owned: haveBook, reason: `A secondary that feeds this frame's ${need}. ${g.note}`, tier: t, source: g.source });
    out.push({ name: inv.name, path: mod?.uniqueName, owned: haveMod, reason: `On the Grimoire: ${inv.effect}.${swap}`, tier: t, source: inv.source, on: g.name });
  }
  const k = SYN.kitgun;
  if (tier === "high" && (info.roles.includes("strength") || (info.spam && !info.noEnergy))) {
    const pax = index.byName.get(k.name);
    out.push({ name: k.name, path: pax?.uniqueName, owned: !!pax && owned.has(pax.uniqueName), reason: `On ${k.on}: ${k.effect}. ${k.note}`, tier: "high", source: k.source, on: k.on });
  }
  return out;
}

function arcanePicks(info: FrameInfo, tier: Tier, owned: Owned, index: ModIndex): LoadoutPick[] {
  if (!atLeast(tier, "medium")) return [];
  const plan = [...frameArcanes(info).chain];
  // A frame whose key abilities are timers gets the duration arcane as a third choice.
  const swap = info.duration && !plan.includes("Molt Efficiency") ? "Molt Efficiency" : null;
  if (swap) plan.push(swap);
  const out: LoadoutPick[] = [];
  for (const name of plan) {
    const m = index.byName.get(name);
    // Only arcanes the tier allows (Arcane Energize is an Eidolon one: Veteran).
    if (m && !allowedAt(m, tier)) continue;
    const has = !!m && owned.has(m.uniqueName);
    if (!has && tier !== "high") continue;
    out.push({
      name,
      path: m?.uniqueName,
      owned: has,
      reason: `${SYN.arcanes.effects[name] ?? ""}${name === swap ? " A swap for one of the two above when your key abilities need to last." : ""}`,
      tier: has ? "medium" : "high",
      source: name === "Molt Efficiency" ? "https://wiki.warframe.com/w/Molt_Efficiency" : SYN.arcanes.source,
    });
  }
  return out;
}

const COMPANION_WHY: Record<string, string> = {
  Nautilus: "It gathers enemies into your area abilities.",
  "Smeeta Kavat": "Free casts now and then, for a frame that spends energy.",
  "Panzer Vulpaphyla": "It keeps fighting beside a frame that stands in the fire.",
};

/** The companions a frame wants, best first. */
function companionOrder(info: FrameInfo): string[] {
  const roles = new Set(info.roles);
  if (info.roles[0] === "tank" || (roles.has("tank") && info.knockdown)) return ["Panzer Vulpaphyla", "Smeeta Kavat", "Nautilus"];
  if (roles.has("range") || info.roles[0] === "efficiency") return ["Nautilus", "Smeeta Kavat", "Panzer Vulpaphyla"];
  return ["Smeeta Kavat", "Nautilus", "Panzer Vulpaphyla"];
}

function companionLoadout(info: FrameInfo, tier: Tier, owned: Owned, held: Held | null, index: ModIndex): LoadoutPick[] {
  const order = companionOrder(info);
  const heldItem = (c: string) => SYN.companions[c].items.find((x) => (held?.get(x.path) ?? 0) > 0) ?? null;
  // Below the high tier, the best one you hold; at the high tier, the best one.
  const pick = tier === "high" ? order[0] : order.find((c) => heldItem(c)) ?? null;
  if (!pick) return [];
  const c = SYN.companions[pick];
  const have = heldItem(pick);
  const it = have ?? c.items[0];
  const t: Tier = have ? "low" : "high";
  const mod = index.byName.get(c.mod);
  const haveMod = !!mod && owned.has(mod.uniqueName);
  const out: LoadoutPick[] = [
    { name: it.name, path: it.path, owned: held ? !!have : null, reason: `${COMPANION_WHY[pick]}${pick === order[0] ? "" : ` ${order[0]} suits it better (high tier).`}`, tier: t, source: c.source },
  ];
  if ((have && haveMod) || tier === "high") out.push({ name: c.mod, path: mod?.uniqueName, owned: haveMod, reason: c.effect, tier: have && haveMod ? "low" : "high", source: c.source, on: it.name });
  return out;
}

function focusPick(info: FrameInfo): LoadoutPick {
  const school: School =
    info.spam && !info.noEnergy ? "Zenurik"
    : info.roles[0] === "tank" || info.roles[0] === "efficiency" ? "Vazarin"
    : info.roles.includes("strength") ? "Madurai"
    : "Zenurik";
  const why = { Zenurik: "Energy for a frame that casts a lot.", Vazarin: "Keeps you and the squad standing.", Madurai: "More strength between casts." }[school];
  const f = SYN.focus[school];
  return { name: school, owned: null, reason: `${why} ${f.effect}`, tier: "low", source: f.source };
}

/** The primers a frame wants, best first: the one that applies the kit's own element, then Viral. */
function primerOrder(item: CatalogItem, info: FrameInfo): string[] {
  const roles = new Set(info.roles);
  // Tanks and support frames don't live on status; their companion stays as it is.
  if (info.roles[0] === "tank" || info.roles[0] === "efficiency") return [];
  if (!roles.has("strength") && !roles.has("range")) return [];
  const els = kitElements(item).map((e) => e.element);
  const order: string[] = [];
  if (els.includes("electricity")) order.push("Diriga");
  if (els.includes("corrosive") || els.includes("toxin")) order.push("Helminth Charger");
  order.push("Panzer Vulpaphyla", "Diriga", "Helminth Charger");
  return order.filter((n, k) => order.indexOf(n) === k);
}

function primerPicks(item: CatalogItem, info: FrameInfo, tier: Tier, owned: Owned, held: Held | null, index: ModIndex): LoadoutPick[] {
  const order = primerOrder(item, info);
  if (!order.length) return [];
  const heldItem = (items: Named[]) => items.find((x) => (held?.get(x.path) ?? 0) > 0) ?? null;
  // Below the high tier, the best one you hold; at the high tier, the best one.
  const pick = tier === "high" ? order[0] : order.find((c) => heldItem(SYN.primers[c].items)) ?? null;
  if (!pick) return [];
  const p = SYN.primers[pick];
  const have = heldItem(p.items);
  const it = have ?? p.items[0];
  const why = (() => {
    const kit = kitElements(item).find((e) => e.element === p.element || (p.element === "corrosive" && e.element === "toxin"));
    const shard = shardElement(item);
    if (kit && shard && (shard.element === p.element || (p.element === "corrosive" && shard.element === "toxin"))) return `It primes the ${p.element === "corrosive" ? "Corrosion and Toxin" : p.element} your kit deals (${kit.ability}), which the ${SHARD_NAME[shard.colour!]} shard feeds on.`;
    if (kit) return `It primes the ${p.element} your kit deals (${kit.ability}) on enemies your abilities haven't reached yet.`;
    return "Viral on everything near you, for a kit that deals damage.";
  })();
  const better = pick === order[0] ? "" : ` ${order[0]} suits it better (high tier).`;
  const out: LoadoutPick[] = [
    { name: it.name, path: it.path, owned: held ? !!have : null, reason: `Instead of the companion above, to prime status: ${why}${better}`, tier: have ? "low" : "high", source: p.source },
  ];
  const showRest = !!have || tier === "high";
  if (!showRest) return out;
  const modPick = (name: string, reason: string, source: string, on: string): LoadoutPick | null => {
    const m = index.byName.get(name);
    const has = !!m && owned.has(m.uniqueName);
    if (!has && tier !== "high") return null;
    return { name, path: m?.uniqueName, owned: has, reason, tier: has && have ? "low" : "high", source, on };
  };
  const precept = modPick(p.mod, p.effect, p.source, it.name);
  if (precept) out.push(precept);
  if (p.bond) {
    const b = modPick(p.bond.name, `On ${it.name}: ${p.bond.effect}, so it spreads what your gun applies too.`, p.bond.source, it.name);
    if (b) out.push(b);
  }
  if (p.weapon) {
    const wHave = heldItem(p.weapon.items);
    const w = wHave ?? p.weapon.items[0];
    if (wHave || tier === "high") {
      out.push({ name: w.name, path: w.path, owned: held ? !!wHave : null, reason: `${it.name}'s weapon: ${p.weapon.effect}.`, tier: wHave && have ? "low" : "high", source: p.weapon.source, on: it.name });
      const wm = modPick(p.weapon.mod, `On ${it.name}: enemies it kills spread part of their status effects to enemies nearby.`, p.weapon.source, it.name);
      if (wm) out.push(wm);
    }
  }
  return out;
}

const KUBROW = /^\/Lotus\/Types\/Game\/KubrowPet\/(?!Charger)/;
const BEAST = /^\/Lotus\/Types\/(Game\/(KubrowPet|CatbrowPet)|Friendly\/Pets\/CreaturePets)\//;
// The Kubrows by name, so a page can say which of the player's the set uses (paths from the catalog).
const KUBROWS: Named[] = [
  { name: "Sunika Kubrow", path: "/Lotus/Types/Game/KubrowPet/HunterKubrowPetPowerSuit" },
  { name: "Chesa Kubrow", path: "/Lotus/Types/Game/KubrowPet/RetrieverKubrowPetPowerSuit" },
  { name: "Huras Kubrow", path: "/Lotus/Types/Game/KubrowPet/FurtiveKubrowPetPowerSuit" },
  { name: "Raksa Kubrow", path: "/Lotus/Types/Game/KubrowPet/GuardKubrowPetPowerSuit" },
  { name: "Sahasa Kubrow", path: "/Lotus/Types/Game/KubrowPet/AdventurerKubrowPetPowerSuit" },
];
const SET_COMPANION: Record<NonNullable<SetDef["companion"]>, { name: string; test: (path: string) => boolean; fallback: Named }> = {
  kubrow: { name: "a Kubrow", test: (p) => KUBROW.test(p), fallback: KUBROWS[0] },
  charger: { name: "the Helminth Charger", test: (p) => p === "/Lotus/Types/Game/KubrowPet/ChargerKubrowPetPowerSuit", fallback: { name: "Helminth Charger", path: "/Lotus/Types/Game/KubrowPet/ChargerKubrowPetPowerSuit" } },
  beast: { name: "a beast companion", test: (p) => BEAST.test(p), fallback: { name: "Panzer Vulpaphyla", path: "/Lotus/Types/Friendly/Pets/CreaturePets/ArmoredInfestedCatbrowPetPowerSuit" } },
};

/** Whether a set's rule fits the frame. */
function setFits(fit: SetFit, item: CatalogItem, info: FrameInfo): boolean {
  const roles = new Set(info.roles);
  switch (fit) {
    case "shieldGate":
      // Augur turns energy spent into shields: nothing for a frame that spends none (Hildryn).
      return SYN.shieldGating.frames.includes(baseName(item.name)) && !info.noEnergy;
    case "statusKit":
      return info.roles[0] !== "tank" && (roles.has("strength") || roles.has("range")) && kitElements(item).length > 0;
    case "healthTank":
      return info.roles[0] === "tank" && !info.shields;
    case "spamTank":
      return roles.has("tank") && !info.shields && !!info.spam && !info.noEnergy;
  }
}

const SLOT_WORD: Record<SlotKind, string> = { warframe: "Warframe", primary: "primary", secondary: "secondary", melee: "melee", companion: "companion", companionWeapon: "companion weapon" };

/** At most two sets a frame, medium only when you hold every piece. */
function setPicks(item: CatalogItem, info: FrameInfo, tier: Tier, owned: Owned, held: Held | null, index: ModIndex): SetPick[] {
  if (!atLeast(tier, "medium")) return [];
  const out: SetPick[] = [];
  for (const [name, d] of Object.entries(SYN.sets)) {
    if (name.startsWith("_") || !d.fit || !setFits(d.fit, item, info)) continue;
    const pieces: SetPiece[] = d.pieces.map((p) => {
      const m = index.byName.get(p.name);
      return { name: p.name, path: m?.uniqueName, slotKind: p.slot, ...(p.aura ? { aura: true } : {}), ...(p.replaces ? { replaces: p.replaces } : {}), owned: !!m && owned.has(m.uniqueName) };
    });
    let companion: SetPick["companion"];
    if (d.companion) {
      const c = SET_COMPANION[d.companion];
      const mine = held ? [...held.entries()].find(([path, n]) => n > 0 && c.test(path)) : undefined;
      const known = [...KUBROWS, ...Object.values(SET_COMPANION).map((x) => x.fallback), ...SYN.companions["Smeeta Kavat"].items];
      // The player's own first: a named one they hold, else any that fits.
      const mineKnown = held ? known.find((x) => c.test(x.path) && (held.get(x.path) ?? 0) > 0) : undefined;
      companion = mineKnown ? { ...mineKnown, owned: true } : mine ? { name: `your ${c.name.replace(/^an? |^the /, "")}`, path: mine[0], owned: true } : { name: c.fallback.name, path: c.fallback.path, owned: held ? false : null };
    }
    const all = pieces.every((p) => p.owned) && (!companion || companion.owned === true);
    if (!all && tier !== "high") continue;
    // Every piece within the tier (the Umbral set is Veteran).
    const inTier = pieces.every((p) => {
      const m = p.path ? index.byPath.get(p.path) : undefined;
      return !m || allowedAt(m, tier);
    });
    if (!inTier) continue;
    const counts = new Map<string, number>();
    for (const p of pieces) {
      const k = p.aura ? "the aura slot" : SLOT_WORD[p.slotKind];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const swaps = pieces.filter((p) => p.replaces).map((p) => `${p.name} for ${p.replaces}`);
    const cost = [...counts].map(([k, n]) => (k === "the aura slot" ? k : `${n} ${k} slot${n === 1 ? "" : "s"}`)).join(", ") + (swaps.length ? `; on the frame, ${swaps.join(", ")}, a weaker copy of each.` : ".");
    const note = d.fit === "shieldGate" ? ` ${SYN.shieldGating.note}` : "";
    out.push({ name, pieces, bonus: d.bonus, reason: `${d.why}${note}${companion ? ` The bonus needs ${SET_COMPANION[d.companion!].name}${companion.owned ? `: your ${companion.name}` : ""}.` : ""}`, cost, ...(companion ? { companion } : {}), tier: all ? "medium" : "high", source: d.source });
    if (out.length >= 2) break;
  }
  return out;
}

/** Why a frame gets no set it might look like it should. */
function setNote(item: CatalogItem, info: FrameInfo): string {
  if (SYN.shieldGating.frames.includes(baseName(item.name)) && info.noEnergy) return ` ${item.name} shield-gates, but spends no energy, so the Augur set (energy spent into shields) gives her nothing.`;
  return "";
}

/**
 * The loadout around a warframe suggestion at a tier, or null for anything else. `held` is the
 * whole inventory (heldFrom); without it, what orbiter can't check is `owned: null`.
 */
export function loadoutFor(item: CatalogItem, tier: Tier, owned: Owned, index: ModIndex, held: Held | null = null): Loadout | null {
  if (gearKindOf(item) !== "warframe") return null;
  const info = frameInfo(item.name) ?? DEFAULT_FRAME;
  const els = kitElements(item);
  return {
    shards: shardPicks(item, info, tier, held),
    helminth: helminthPick(item, tier, held),
    weapons: supportWeaponPicks(info, tier, owned, held, index),
    arcanes: arcanePicks(info, tier, owned, index),
    companion: companionLoadout(info, tier, owned, held, index),
    focus: focusPick(info),
    note: `orbiter's suggestion around the build: facts read by hand on the page each pick names (orbiter doesn't fetch them); which pick suits which frame is orbiter's own rule. Archon Shards are always Tauforged.${setNote(item, info)}`,
    element: shardElement(item) ?? els[0] ?? null,
    primer: primerPicks(item, info, tier, owned, held, index),
    sets: setPicks(item, info, tier, owned, held, index),
  };
}

/** Every loadout name that should be a catalog mod or arcane, for the tests. */
export function loadoutModNames(): string[] {
  const out = new Set<string>(Object.keys(SYN.arcanes.effects));
  for (const i of Object.values(SYN.grimoire.invocations)) out.add(i.name);
  out.add(SYN.kitgun.name);
  for (const c of Object.values(SYN.companions)) out.add(c.mod);
  for (const [n, p] of Object.entries(SYN.primers)) {
    if (n.startsWith("_")) continue;
    out.add(p.mod);
    if (p.bond) out.add(p.bond.name);
    if (p.weapon) out.add(p.weapon.mod);
  }
  for (const [n, d] of Object.entries(SYN.sets)) if (!n.startsWith("_")) for (const p of d.pieces) out.add(p.name);
  return [...out].sort();
}

/** Every item the loadout names by path (Grimoire, companions, Helminth donors), with its catalog name. */
export function loadoutItems(): Named[] {
  const out: Named[] = [{ name: SYN.grimoire.name, path: SYN.grimoire.path }];
  for (const c of Object.values(SYN.companions)) out.push(...c.items);
  for (const [n, p] of Object.entries(SYN.primers)) if (!n.startsWith("_")) out.push(...p.items, ...(p.weapon?.items ?? []));
  for (const c of Object.values(SET_COMPANION)) out.push(c.fallback);
  out.push(...KUBROWS);
  for (const h of Object.values(SYN.helminth.frames)) if (h.from && h.fromPath) out.push({ name: h.from, path: h.fromPath });
  return out.filter((x, k) => out.findIndex((y) => y.path === x.path) === k);
}

// ---------------------------------------------------------------- the switch to ./types's Build

/** The suggestion as a plain Build for `settings.builds` (drops orbiter's own extra fields). */
export function toBuild(s: Suggestion, now = Date.now()): Build {
  const b: Build = {
    id: s.id,
    item: s.item,
    kind: s.kind,
    title: s.title,
    mods: s.mods,
    polarities: s.polarities,
    arcanes: s.arcanes,
    shards: [],
    catalyst: s.catalyst,
    adapters: s.adapters,
    forma: s.forma,
    source: "orbiter",
    importedAt: now,
    note: s.note,
  };
  if (s.tags.length) b.tags = [...s.tags];
  if (s.aura) b.aura = s.aura;
  if (s.exilus) b.exilus = s.exilus;
  if (s.stance) b.stance = s.stance;
  return b;
}

/** Every mod and arcane name the engine can put in a build, for the catalog check in the tests. */
export function suggestionNames(): string[] {
  const names = new Set<string>();
  const add = (chain: string[]) => chain.forEach((n) => names.add(n));
  for (const f of Object.values(FAMILIES)) for (const chain of Object.values(f)) add(chain as string[]);
  for (const chain of Object.values(MELEE)) add(chain);
  for (const chain of Object.values(ARCH_MELEE)) add(chain);
  const tiers: Tier[] = ["low", "high"];
  const shapes: (Variant | null)[] = [null, { id: "g", label: "", tags: [], survival: "shieldGate" }, { id: "h", label: "", tags: [], survival: "health", nuke: true }];
  for (const frame of [...Object.values(FRAMES), DEFAULT_FRAME]) {
    for (const t of tiers) for (const v of shapes) framePicks(frame, t, v).forEach((p) => add(p.chain));
    for (const v of shapes) add(frameAura(frame, v).chain);
    add(frameExilus(frame).chain);
    add(frameArcanes(frame).chain);
  }
  add(["Corrosive Projection", "Energy Siphon", "Growing Power", "Steel Charge"]);
  const fakeSentinel = { category: "Sentinels", uniqueName: "", name: "" } as CatalogItem;
  const fakeBeast = { category: "Pets", uniqueName: "", name: "" } as CatalogItem;
  for (const p of [...companionPicks(fakeSentinel), ...companionPicks(fakeBeast), ...archwingPicks(), ...necramechPicks({ name: "Bonewidow", uniqueName: "" } as CatalogItem), ...necramechPicks({ name: "Voidrig", uniqueName: "" } as CatalogItem)]) add(p.chain);
  for (const n of ["Primed Shotgun Ammo Mutation", "Shotgun Ammo Mutation", "Primed Pistol Ammo Mutation", "Pistol Ammo Mutation", "Primed Rifle Ammo Mutation", "Rifle Ammo Mutation"]) names.add(n);
  for (const n of ["Melee Duplicate", "Melee Crescendo", "Secondary Encumber", "Secondary Merciless", "Secondary Deadhead", "Primary Deadhead", "Primary Merciless"]) names.add(n);
  for (const f of Object.values(FRAMES)) if (f.augment) names.add(f.augment);
  return [...names].sort();
}
