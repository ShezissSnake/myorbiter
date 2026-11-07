// Modular recipes: for a kitgun chamber, zaw strike, amp prism, MOA or Hound model, or Predasite or
// Vulpaphyla subspecies, every combination of the other parts, with its stats, ranked for a goal,
// and which of its parts you hold.
//
// The numbers are the Warframe Wiki's (Module:Modular/data and the Amp, Predasite and Vulpaphyla
// pages), shipped beside the app as public/data/wiki/modular-parts*.json under their own licence
// (CC BY-NC-SA 3.0, see LICENSE.md there) and read at start (wikiData.ts), never compiled in;
// MyOrbiter never fetches the wiki. The ranking is MyOrbiter's own, from
// those part stats, with the simple formulas written out below. It isn't "the meta", and the UI
// says so (RANKING_LABEL).
//
// Not covered: the Mote Amp and Sirocco (they come whole), K-Drives (no stats), and amp damage
// (the Amp page has none per part: amps rank by what their scaffold and brace do).
import pathsData from "../data/modular-parts-paths.json";
import { wikiData, wikiGeneration } from "./wikiData";
import research from "../data/acquisition.json";
import { heldCount, type Model } from "./model";
import type { GearCopy } from "./notNeeded";

export const RANKING_LABEL = "MyOrbiter's ranking from part stats";

// ---------------------------------------------------------------------------------------------
// The bundled data, typed.

type Num = Record<string, number>;
interface KitChamber {
  Name: string;
  Damage: Record<string, Num>;
  FireRate: Num;
  ChargeTime?: Num;
  CritChance: number;
  CritMultiplier: number;
  StatusChance: number;
  Magazine: Num;
  Multishot?: number;
  AmmoCost?: number;
  Trigger: string;
}
interface KitLoader { Name: string; CritChance: number; CritMultiplier: number; StatusChance: number; Magazine: string; Reload: number }
interface KitSlot { Chamber: Record<string, KitChamber>; Grip: Record<string, { Name: string }>; Loader: Record<string, KitLoader> }
interface ZawStrike { Name: string; CritChance: number; CritMultiplier: number; StatusChance: number; Speed: number; Damage: Num; Type: { OneHanded: string; TwoHanded: string } }
interface ZawGrip { Name: string; Damage: number; Speed: number; Type: "OneHanded" | "TwoHanded" }
interface ZawLink { Name: string; Damage: number; Speed: number; CritChance: number; StatusChance: number }
interface Durability { Health?: number; Shield?: number; Armor?: number }
interface CompanionPart extends Durability { Name: string; Precepts?: string[]; Polarities?: string[]; Weapons?: string[] }
interface Modular {
  KitgunSecondary: KitSlot;
  KitgunPrimary: KitSlot;
  Zaw: { Strike: Record<string, ZawStrike>; Grip: Record<string, ZawGrip>; Link: Record<string, ZawLink> };
  MOA: { Model: Record<string, CompanionPart>; Core: Record<string, CompanionPart>; Gyro: Record<string, CompanionPart>; Bracket: Record<string, CompanionPart> };
  Hound: { Model: Record<string, CompanionPart>; Core: Record<string, CompanionPart>; Bracket: Record<string, CompanionPart>; Stabilizer: Record<string, CompanionPart> };
}
interface AmpPart { series: number; syndicate: string; rank: string; fire?: string; effect?: string; energyPool?: number; rechargeDelay?: number; rechargeRate?: number; critChance?: number; statusChance?: number }
interface CreaturePart { resists?: string[]; polarity?: string; standing: number; rank: number; rankName: string }
interface Creature {
  base: { health: number; armor: number; shields: number };
  Subspecies: Record<string, { precepts: string[]; claws: { damage: number; statusChance: number; critChance: number; critMultiplier: number } }>;
  Mutagen: Record<string, CreaturePart>;
  Antigen: Record<string, CreaturePart>;
  _gaps: string;
}
interface Extra {
  Amp: { Prism: Record<string, AmpPart>; Scaffold: Record<string, AmpPart>; Brace: Record<string, AmpPart>; standing: { "The Quills": Record<string, number> }; _gaps: string };
  Predasite: Creature;
  Vulpaphyla: Creature;
}
type Paths = Record<string, Record<string, { u: string; bp?: string }>>;

/** The wiki's tables, once loaded (loadWikiData, at start). */
function modular(): Modular {
  const d = wikiData();
  if (!d) throw new Error("the modular part data isn't loaded yet (loadWikiData)");
  return d.modularParts as Modular;
}
function extra(): Extra {
  const d = wikiData();
  if (!d) throw new Error("the modular part data isn't loaded yet (loadWikiData)");
  return d.modularExtra as Extra;
}
const PATHS = pathsData as unknown as Paths;
const HOW = research as unknown as Record<string, { how?: string } | undefined>;

// ---------------------------------------------------------------------------------------------
// What the API hands out.

export type RecipeFamily = "kitgun" | "zaw" | "amp" | "moa" | "hound" | "predasite" | "vulpaphyla";
export type KitgunSlot = "primary" | "secondary";
export type PartRole =
  | "chamber" | "grip" | "loader"
  | "strike" | "link"
  | "prism" | "scaffold" | "brace"
  | "model" | "core" | "gyro" | "bracket" | "stabilizer"
  | "subspecies" | "mutagen" | "antigen";

export interface GoalInfo {
  id: string;
  label: string;
  /** The formula, in a sentence. */
  explain: string;
}

export interface Stat {
  id: string;
  label: string;
  value: number | string;
  /** How to show a number: "%" (a 0–1 fraction), "x" (a multiplier), "s", "/s"; none for a plain number. */
  unit?: "%" | "x" | "s" | "/s";
}

export interface RecipePart {
  role: PartRole;
  name: string;
  /** The part's game path; null for a Weakened subspecies (caught, not held as a part). */
  unique: string | null;
  blueprint: string | null;
  /** Built parts you hold, counting ones in the foundry. */
  held: number;
  /** Its blueprints you hold. */
  blueprints: number;
  status: "held" | "blueprint" | "missing";
  /** Where to get it. */
  where: string;
  /** The part the recipe is for (the chamber, strike, prism, model or subspecies). */
  identifying: boolean;
}

export interface RecipeCombo {
  /** "Catchmoon/Gibber/Killstream". */
  key: string;
  /** "Catchmoon · Gibber · Killstream". */
  name: string;
  slot?: KitgunSlot;
  parts: RecipePart[];
  stats: Stat[];
  /** The goal's score: the first number the combos are sorted by. */
  score: number;
  /** The score in words: "412 sustained DPS". */
  scoreLabel: string;
  rank: number;
  /** Parts you'd still have to build or buy: not held built (a blueprint counts as missing a build). */
  missing: number;
  /** You already have a copy of exactly this combination (needs the patched TennoScope's gear). */
  built: boolean;
}

export interface RecipeResult {
  family: RecipeFamily;
  /** The identifying part's name: "Catchmoon", "Raplak Prism", "Para Moa". */
  item: string;
  unique: string;
  goal: GoalInfo;
  goals: GoalInfo[];
  label: typeof RANKING_LABEL;
  /** How the identifying part is got (acquisition.json), when researched. */
  how: string | null;
  /** Companions: the precepts its model or subspecies brings, and MyOrbiter's role for it. */
  precepts?: string[];
  role?: string;
  /** Amps: whether the prism's fire mode suits the goal, in words. */
  fit?: string;
  combos: RecipeCombo[];
  /** What the data doesn't have, for this family. */
  gaps: string[];
}

/** What you hold: built parts and blueprints by path, and your built gear (for "you have this one"). */
export interface Holdings {
  held(unique: string): number;
  gear?: GearCopy[] | null;
}

/** Holdings from MyOrbiter's model: inventory rows by path, plus what's building in the foundry. */
export function holdingsOf(m: Model): Holdings {
  return { held: (u) => heldCount(m, u) + m.building(u), gear: m.gear };
}

const NONE: Holdings = { held: () => 0, gear: null };
function asHoldings(inv: Model | Holdings | null | undefined): Holdings {
  if (!inv) return NONE;
  return "inventoryByBase" in inv ? holdingsOf(inv as Model) : (inv as Holdings);
}

// ---------------------------------------------------------------------------------------------
// The items recipes exist for.

export interface RecipeItem {
  family: RecipeFamily;
  /** The key in the data: "Catchmoon", "Raplak", "Para". */
  key: string;
  /** The game's name: "Catchmoon", "Raplak Prism", "Para Moa". */
  name: string;
  unique: string;
}

function path(group: string, name: string): { u: string; bp?: string } | null {
  return PATHS[group]?.[name] ?? null;
}

let itemsMemo: { gen: number; items: RecipeItem[] } | null = null;
const ITEMS_OF = (): RecipeItem[] => [
  ...Object.keys(modular().KitgunSecondary.Chamber).map((k) => ({ family: "kitgun" as const, key: k, name: k, unique: path("KitgunChamber", k)!.u })),
  ...Object.keys(modular().Zaw.Strike).map((k) => ({ family: "zaw" as const, key: k, name: k, unique: path("ZawStrike", k)!.u })),
  ...Object.keys(extra().Amp.Prism).map((k) => ({ family: "amp" as const, key: k, name: `${k} Prism`, unique: path("AmpPrism", k)!.u })),
  ...Object.keys(modular().MOA.Model).map((k) => ({ family: "moa" as const, key: k, name: `${k} Moa`, unique: path("MoaModel", k)!.u })),
  ...Object.keys(modular().Hound.Model).map((k) => ({ family: "hound" as const, key: k, name: `${k} Hound`, unique: path("HoundModel", k)!.u })),
  ...Object.keys(extra().Predasite.Subspecies).map((k) => ({ family: "predasite" as const, key: k, name: `${k} Predasite`, unique: path("PredasiteSubspecies", k)!.u })),
  ...Object.keys(extra().Vulpaphyla.Subspecies).map((k) => ({ family: "vulpaphyla" as const, key: k, name: `${k} Vulpaphyla`, unique: path("VulpaphylaSubspecies", k)!.u })),
];

function items(): RecipeItem[] {
  if (itemsMemo?.gen !== wikiGeneration()) itemsMemo = { gen: wikiGeneration(), items: ITEMS_OF() };
  return itemsMemo.items;
}

/** Every item MyOrbiter has recipes for. */
export function recipeItems(): RecipeItem[] {
  // The wiki's file didn't load (it's read at start): no recipes rather than a broken page.
  if (!wikiData()) return [];
  return items();
}

/** The recipe item for a path or a name ("Catchmoon", "raplak prism", "Raplak", "Para Moa"); null otherwise. */
export function recipeItem(itemPathOrName: string): RecipeItem | null {
  if (!wikiData()) return null;
  const q = itemPathOrName.trim().toLowerCase();
  return items().find((i) => i.unique === itemPathOrName || i.name.toLowerCase() === q || i.key.toLowerCase() === q) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Goals and their formulas.

const KITGUN_GOALS: GoalInfo[] = [
  { id: "sustained", label: "Sustained", explain: "Average damage per second over a whole magazine and its reload: hit × crit average × shots ÷ (shots × time per shot + reload)." },
  { id: "burst", label: "Burst", explain: "Average damage per second while firing, before reloading: hit × crit average ÷ time per shot." },
  { id: "crit", label: "Crit", explain: "Highest base crit chance first (crit mods multiply it), then crit multiplier, then sustained DPS." },
  { id: "status", label: "Status", explain: "Status effects per second, reloads counted: status chance × pellets × shots per second over a magazine and its reload." },
];
const ZAW_GOALS: GoalInfo[] = [
  { id: "crit", label: "Crit", explain: "Highest crit chance first (strike + link), then damage × attack speed." },
  { id: "status", label: "Status", explain: "Status chance × attack speed: status effects per swing-second." },
  { id: "heavy", label: "Heavy attack", explain: "Heavy attacks scale with base damage and crits, not attack speed: total damage × crit average." },
  { id: "fast", label: "Fast", explain: "Highest attack speed (strike + grip + link) first, then damage × attack speed." },
];
const AMP_GOALS: GoalInfo[] = [
  { id: "single", label: "Single target", explain: "A scaffold that hits one target hard (charged, homing beam), then the brace's crit." },
  { id: "crowds", label: "Crowds", explain: "A scaffold that hits an area (grenades, cluster bombs, bouncing shots), then the brace's crit and status." },
  { id: "pool", label: "Energy pool", explain: "The brace's energy pool bonus, then the shortest recharge delay." },
  { id: "recharge", label: "Recharge", explain: "The brace's shortest recharge delay, then its recharge rate, then its energy pool." },
  { id: "crit", label: "Crit", explain: "The brace's crit chance, then its status chance." },
];
// Every MOA core and gyro adds up to the same total (+15% and +5%), and every Hound core and
// bracket nearly so: they trade one stat for another, so the goals pick a stat, not a total.
const DURABLE_GOALS: GoalInfo[] = [
  { id: "health", label: "Health", explain: "The most health, then armor, then shields." },
  { id: "shields", label: "Shields", explain: "The most shields, then health, then armor." },
  { id: "armor", label: "Armor", explain: "The most armor, then health, then shields." },
];
const POLARITIES = ["Vazarin", "Madurai", "Naramon", "Penjaga"];
const polarityGoals = (part: string, list: string[]): GoalInfo[] =>
  list.map((p) => ({ id: p.toLowerCase(), label: `${p} slot`, explain: `A ${part} that gives a ${p} slot, then the most health.` }));
const CREATURE_GOALS: GoalInfo[] = [
  { id: "cheapest", label: "Cheapest", explain: "The least Entrati standing for the mutagen and antigen blueprints (and the lowest rank with Son)." },
  ...POLARITIES.map((p) => ({ id: p.toLowerCase(), label: `${p} slot`, explain: `An antigen that gives a ${p} slot, then the cheapest.` })),
];

/** The goals a recipe item can be ranked by; the first is the default. */
export function goalsFor(itemPathOrName: string): GoalInfo[] {
  if (!wikiData()) return [];
  const item = recipeItem(itemPathOrName);
  if (!item) return [];
  switch (item.family) {
    case "kitgun": return KITGUN_GOALS;
    case "zaw": return ZAW_GOALS;
    case "amp": return AMP_GOALS;
    case "moa": return [...DURABLE_GOALS, ...polarityGoals("bracket", ["Madurai", "Naramon", "Vazarin"])];
    case "hound": {
      // A Hound's bracket and stabilizer each bring a precept: rank for one of them.
      const precepts = [...Object.values(modular().Hound.Bracket), ...Object.values(modular().Hound.Stabilizer)].flatMap((p) => p.Precepts ?? []);
      return [
        ...DURABLE_GOALS,
        ...precepts.map((p) => ({ id: `precept:${p}`, label: p, explain: `Combos with ${p} first, then the most health.` })),
        ...polarityGoals("stabilizer", ["Madurai", "Naramon", "Vazarin"]),
      ];
    }
    default: return CREATURE_GOALS;
  }
}

// ---------------------------------------------------------------------------------------------
// Where each part comes from (researched by hand, from the wiki pages above).

function kitgunWhere(role: PartRole, unique: string): string {
  const infested = unique.includes("/Infested/");
  if (role === "chamber") return infested ? "Father in the Necralisk (Entrati, Neutral, 500 standing; needs Heart of Deimos)" : "Rude Zuud in Fortuna (Solaris United, Neutral, 500 standing)";
  return infested ? "Father in the Necralisk (Entrati; needs Heart of Deimos)" : "Rude Zuud in Fortuna (Solaris United)";
}
function zawWhere(role: PartRole, name: string): string {
  if (name.startsWith("Plague ")) return "Nakak in Cetus, only during Operation: Plague Star";
  return role === "strike" ? "Hok in Cetus (Ostron, Neutral, 1,000 standing)" : "Hok in Cetus (Ostron)";
}
function ampWhere(p: AmpPart, role: PartRole): string {
  const quills = p.syndicate === "The Quills";
  const cost = quills ? extra().Amp.standing["The Quills"][String(p.series)] : role === "prism" ? 3000 : null;
  const at = quills ? "Onkko in Cetus" : "Little Duck in Fortuna";
  return `${at} (${p.syndicate}, ${p.rank}${cost ? `, ${cost.toLocaleString("en-US")} standing` : ""})`;
}
const MOA_MODEL_WHERE: Record<string, string> = {
  Para: "Legs in Fortuna (Solaris United, Neutral, 500 standing)",
  Lambeo: "Legs in Fortuna (Solaris United, Outworlder, 1,000 standing)",
  Oloro: "Legs in Fortuna (Solaris United, Rapscallion, 2,000 standing)",
  Nychus: "Legs in Fortuna (Solaris United, Doer, 3,000 standing)",
};
const HOUND_WHERE = "No vendor: each Sister of Parvos you vanquish drops a random Hound part blueprint; they're tradable, so players sell them";

// ---------------------------------------------------------------------------------------------
// Ownership.

function part(h: Holdings, role: PartRole, name: string, group: string, where: string, identifying = false): RecipePart {
  const p = path(group, name);
  const unique = p?.u ?? null;
  const blueprint = p?.bp ?? null;
  const held = unique ? h.held(unique) : 0;
  const blueprints = blueprint ? h.held(blueprint) : 0;
  return { role, name, unique, blueprint, held, blueprints, status: held > 0 ? "held" : blueprints > 0 ? "blueprint" : "missing", where, identifying };
}

const SLOT_SECTION: Record<KitgunSlot, string> = { primary: "LongGuns", secondary: "Pistols" };

/** A built copy made of exactly these parts (and, for a kitgun, in that slot). */
function isBuilt(h: Holdings, parts: RecipePart[], slot?: KitgunSlot): boolean {
  const need = parts.map((p) => p.unique).filter((u): u is string => !!u);
  return (h.gear ?? []).some((g) => {
    if (!Array.isArray(g.m) || !g.m.length) return false;
    if (slot && g.s && g.s !== SLOT_SECTION[slot]) return false;
    return need.every((u) => g.m!.includes(u));
  });
}

// ---------------------------------------------------------------------------------------------
// Stats and scores, family by family. Each returns the combo's stats and its sort keys (higher is
// better, compared in order).

interface Scored { stats: Stat[]; keys: number[]; scoreLabel: string }

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const sum = (o: Num) => Object.values(o).reduce((a, b) => a + b, 0);
/** The average damage multiplier crits give: 1 + chance × (multiplier − 1). Holds past 100% too. */
const critAverage = (chance: number, multiplier: number) => 1 + chance * (multiplier - 1);

export interface KitgunStats {
  damage: number;
  damageTypes: Num;
  pellets: number;
  fireRate: number;
  chargeTime: number | null;
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  magazine: number;
  reload: number;
  burstDps: number;
  sustainedDps: number;
  statusPerSecond: number;
  trigger: string;
}

/**
 * A kitgun's stats, the way the wiki's tables put them together: the chamber's damage and fire rate
 * for that grip, the chamber's crit and status plus the loader's, the chamber's magazine for the
 * loader's size, the loader's reload. Then:
 * - hit = damage per pellet × pellets (Vermisplicer fires 5);
 * - time per shot = 1 ÷ fire rate, or the charge time if longer (primary Tombfinger);
 * - shots per magazine = magazine ÷ ammo cost (beams use half an ammo a tick);
 * - burst DPS = hit × crit average ÷ time per shot;
 * - sustained DPS = hit × crit average × shots ÷ (shots × time per shot + reload).
 * No mods, no falloff, no status damage: a comparison of parts, not a DPS calculator.
 */
export function kitgunStats(slot: KitgunSlot, chamber: string, grip: string, loader: string): KitgunStats | null {
  const s = slot === "primary" ? modular().KitgunPrimary : modular().KitgunSecondary;
  const c = s.Chamber[chamber];
  const l = s.Loader[loader];
  const types = c?.Damage[grip];
  if (!c || !l || !types || !s.Grip[grip]) return null;
  const pellets = c.Multishot ?? 1;
  const damage = sum(types);
  const fireRate = c.FireRate[grip];
  const chargeTime = c.ChargeTime?.[grip] ?? null;
  const shotTime = Math.max(1 / fireRate, chargeTime ?? 0);
  const critChance = r4(c.CritChance + l.CritChance);
  const critMultiplier = r4(c.CritMultiplier + l.CritMultiplier);
  const statusChance = r4(c.StatusChance + l.StatusChance);
  const magazine = c.Magazine[l.Magazine];
  const shots = magazine / (c.AmmoCost ?? 1);
  const cycle = shots * shotTime + l.Reload;
  const avgHit = damage * pellets * critAverage(critChance, critMultiplier);
  return {
    damage,
    damageTypes: types,
    pellets,
    fireRate,
    chargeTime,
    critChance,
    critMultiplier,
    statusChance,
    magazine,
    reload: l.Reload,
    burstDps: r2(avgHit / shotTime),
    sustainedDps: r2((avgHit * shots) / cycle),
    statusPerSecond: r2((statusChance * pellets * shots) / cycle),
    trigger: c.Trigger,
  };
}

function kitgunScored(k: KitgunStats, goal: string): Scored {
  const stats: Stat[] = [
    { id: "damage", label: k.pellets > 1 ? `Damage (×${k.pellets} pellets)` : "Damage", value: r2(k.damage) },
    { id: "fireRate", label: "Fire rate", value: k.fireRate, unit: "/s" },
    ...(k.chargeTime != null ? [{ id: "chargeTime", label: "Charge", value: k.chargeTime, unit: "s" as const }] : []),
    { id: "critChance", label: "Crit", value: k.critChance, unit: "%" },
    { id: "critMultiplier", label: "Crit multiplier", value: k.critMultiplier, unit: "x" },
    { id: "statusChance", label: "Status", value: k.statusChance, unit: "%" },
    { id: "magazine", label: "Magazine", value: k.magazine },
    { id: "reload", label: "Reload", value: k.reload, unit: "s" },
    { id: "burstDps", label: "Burst DPS", value: k.burstDps },
    { id: "sustainedDps", label: "Sustained DPS", value: k.sustainedDps },
    { id: "trigger", label: "Trigger", value: k.trigger },
  ];
  switch (goal) {
    case "burst": return { stats, keys: [k.burstDps, k.sustainedDps], scoreLabel: `${Math.round(k.burstDps)} burst DPS` };
    case "crit": return { stats, keys: [k.critChance, k.critMultiplier, k.sustainedDps], scoreLabel: `${Math.round(k.critChance * 100)}% crit, ${k.critMultiplier}x` };
    case "status": return { stats, keys: [k.statusPerSecond, k.sustainedDps], scoreLabel: `${k.statusPerSecond} status effects/s` };
    default: return { stats, keys: [k.sustainedDps, k.burstDps], scoreLabel: `${Math.round(k.sustainedDps)} sustained DPS` };
  }
}

export interface ZawStats {
  damage: number;
  damageTypes: Num;
  attackSpeed: number;
  critChance: number;
  critMultiplier: number;
  statusChance: number;
  /** The weapon type the strike and grip make: "Dagger", "Staff". */
  type: string;
  hands: "OneHanded" | "TwoHanded";
  /** Damage × crit average × attack speed: a like-for-like figure, not a real DPS. */
  damageRate: number;
}

/**
 * A zaw's stats: the strike's damage plus the grip's and link's (shared across the strike's damage
 * types in its proportions), attack speed = grip + strike + link, crit and status = strike + link,
 * the strike's crit multiplier, and the type its grip's hands make. The module's attack-type
 * multipliers (slide, wall, leap) aren't applied.
 */
export function zawStats(strike: string, grip: string, link: string): ZawStats | null {
  const s = modular().Zaw.Strike[strike];
  const g = modular().Zaw.Grip[grip];
  const l = modular().Zaw.Link[link];
  if (!s || !g || !l) return null;
  const base = sum(s.Damage);
  const damage = r2(base + g.Damage + l.Damage);
  const damageTypes = Object.fromEntries(Object.entries(s.Damage).map(([t, v]) => [t, r2((v / base) * damage)]));
  const attackSpeed = r4(g.Speed + s.Speed + l.Speed);
  const critChance = r4(s.CritChance + l.CritChance);
  const statusChance = r4(s.StatusChance + l.StatusChance);
  return {
    damage,
    damageTypes,
    attackSpeed,
    critChance,
    critMultiplier: s.CritMultiplier,
    statusChance,
    type: s.Type[g.Type],
    hands: g.Type,
    damageRate: r2(damage * critAverage(critChance, s.CritMultiplier) * attackSpeed),
  };
}

function zawScored(z: ZawStats, goal: string): Scored {
  const stats: Stat[] = [
    { id: "type", label: "Type", value: z.type },
    { id: "damage", label: "Damage", value: z.damage },
    { id: "attackSpeed", label: "Attack speed", value: z.attackSpeed },
    { id: "critChance", label: "Crit", value: z.critChance, unit: "%" },
    { id: "critMultiplier", label: "Crit multiplier", value: z.critMultiplier, unit: "x" },
    { id: "statusChance", label: "Status", value: z.statusChance, unit: "%" },
    { id: "damageRate", label: "Damage × speed", value: z.damageRate },
  ];
  const heavy = r2(z.damage * critAverage(z.critChance, z.critMultiplier));
  switch (goal) {
    case "status": {
      const v = r4(z.statusChance * z.attackSpeed);
      return { stats, keys: [v, z.damageRate], scoreLabel: `${Math.round(z.statusChance * 100)}% status at ${z.attackSpeed} speed` };
    }
    case "heavy": return { stats, keys: [heavy, z.critChance], scoreLabel: `${Math.round(heavy)} average heavy-attack damage` };
    case "fast": return { stats, keys: [z.attackSpeed, z.damageRate], scoreLabel: `${z.attackSpeed} attack speed` };
    default: return { stats, keys: [z.critChance, z.damageRate], scoreLabel: `${Math.round(z.critChance * 100)}% crit` };
  }
}

/** MyOrbiter's reading of each scaffold's fire mode (from the Amp page's words): area, or one target. */
const SCAFFOLD_AREA: Record<string, boolean> = { Pencha: false, Klebrik: false, Shraksun: true, Phahd: true, Exard: true, Dissic: true, Propa: true };
/** And each prism's: precise long-range fire suits single targets, the rest crowds. */
const PRISM_AREA: Record<string, boolean> = { Raplak: false, Rahn: false, Cantic: false, Shwaak: true, Granmu: true, Lega: true, Klamora: true };

function ampScored(prism: string, scaffold: string, brace: string, goal: string): Scored {
  const sc = extra().Amp.Scaffold[scaffold];
  const b = extra().Amp.Brace[brace];
  const crit = b.critChance ?? 0;
  const status = b.statusChance ?? 0;
  const stats: Stat[] = [
    { id: "prism", label: "Primary fire", value: extra().Amp.Prism[prism].fire ?? "" },
    { id: "scaffold", label: "Alt fire", value: sc.fire ?? "" },
    { id: "brace", label: "Brace", value: b.effect ?? "" },
    { id: "series", label: "Series", value: `${extra().Amp.Prism[prism].series}${sc.series}${b.series}` },
  ];
  switch (goal) {
    case "crowds": return { stats, keys: [SCAFFOLD_AREA[scaffold] ? 1 : 0, crit + status], scoreLabel: SCAFFOLD_AREA[scaffold] ? "Area alt fire" : "Single-target alt fire" };
    case "pool": return { stats, keys: [b.energyPool ?? 0, -(b.rechargeDelay ?? 0)], scoreLabel: b.effect ?? "" };
    case "recharge": return { stats, keys: [-(b.rechargeDelay ?? 0), b.rechargeRate ?? 0, b.energyPool ?? 0], scoreLabel: b.effect ?? "" };
    case "crit": return { stats, keys: [crit, status], scoreLabel: crit ? `+${Math.round(crit * 100)}% crit` : "No crit from the brace" };
    default: return { stats, keys: [SCAFFOLD_AREA[scaffold] ? 0 : 1, crit], scoreLabel: SCAFFOLD_AREA[scaffold] ? "Area alt fire" : "Single-target alt fire" };
  }
}

const pct = (n: number) => r4(n);
/** `slot`: the polarity the combo's bracket or stabilizer gives ("None" for none). */
function durableScored(health: number, shield: number, armor: number, goal: string, extra: Stat[], percent: boolean, slot: string): Scored {
  const unit = percent ? ("%" as const) : undefined;
  const stats: Stat[] = [
    { id: "health", label: "Health", value: percent ? pct(health) : Math.round(health), unit },
    { id: "shield", label: "Shields", value: percent ? pct(shield) : Math.round(shield), unit },
    { id: "armor", label: "Armor", value: percent ? pct(armor) : Math.round(armor), unit },
    ...extra,
  ];
  const fmt = (n: number) => (percent ? `${n >= 0 ? "+" : ""}${r2(n * 100)}%` : `${Math.round(n)}`);
  // Last, a polarity slot over none.
  const slotted = slot === "None" ? 0 : 1;
  const pol = POLARITIES.find((p) => p.toLowerCase() === goal);
  if (pol) {
    const has = slot.split(", ").includes(pol);
    return { stats, keys: [has ? 1 : 0, health, armor, shield], scoreLabel: has ? `${pol} slot, ${fmt(health)} health` : `No ${pol} slot` };
  }
  switch (goal) {
    case "shields": return { stats, keys: [shield, health, armor, slotted], scoreLabel: `${fmt(shield)} shields` };
    case "armor": return { stats, keys: [armor, health, shield, slotted], scoreLabel: `${fmt(armor)} armor` };
    default: return { stats, keys: [health, armor, shield, slotted], scoreLabel: `${fmt(health)} health` };
  }
}

/** MyOrbiter's role for each Predasite and Vulpaphyla, from what the pages say its precepts do. */
const CREATURE_ROLE: Record<string, string> = {
  Vizier: "Support: heals you (Iatric Mycelium) and corrodes and blinds (Acidic Spittle)",
  Medjay: "Crowd control: slows and opens enemies to finishers (Paralytic Spores)",
  Pharaoh: "Damage buff: spore clouds that raise your damage (Anabolic Pollination), and holds enemies (Endoparasitic Vector)",
  Crescent: "Damage: throws enemies into each other (Crescent Charge)",
  Panzer: "Damage: Viral Quills (going by its name; the page doesn't describe it)",
  Sly: "Survival: a decoy that draws fire when you bullet jump (Survival Instinct)",
};

// ---------------------------------------------------------------------------------------------
// The combos.

interface Raw { slot?: KitgunSlot; parts: RecipePart[]; scored: Scored }

function kitgunCombos(item: RecipeItem, goal: string, h: Holdings, slots: KitgunSlot[]): Raw[] {
  const out: Raw[] = [];
  for (const slot of slots) {
    const s = slot === "primary" ? modular().KitgunPrimary : modular().KitgunSecondary;
    const chamber = part(h, "chamber", item.key, "KitgunChamber", kitgunWhere("chamber", item.unique), true);
    for (const grip of Object.keys(s.Grip)) {
      for (const loader of Object.keys(s.Loader)) {
        const k = kitgunStats(slot, item.key, grip, loader);
        if (!k) continue;
        const g = part(h, "grip", grip, "KitgunGrip", kitgunWhere("grip", path("KitgunGrip", grip)?.u ?? ""));
        const l = part(h, "loader", loader, "KitgunLoader", kitgunWhere("loader", path("KitgunLoader", loader)?.u ?? ""));
        out.push({ slot, parts: [chamber, g, l], scored: kitgunScored(k, goal) });
      }
    }
  }
  return out;
}

function zawCombos(item: RecipeItem, goal: string, h: Holdings): Raw[] {
  const out: Raw[] = [];
  const strike = part(h, "strike", item.key, "ZawStrike", zawWhere("strike", item.key), true);
  for (const grip of Object.keys(modular().Zaw.Grip)) {
    for (const link of Object.keys(modular().Zaw.Link)) {
      const z = zawStats(item.key, grip, link)!;
      out.push({ parts: [strike, part(h, "grip", grip, "ZawGrip", zawWhere("grip", grip)), part(h, "link", link, "ZawLink", zawWhere("link", link))], scored: zawScored(z, goal) });
    }
  }
  return out;
}

function ampCombos(item: RecipeItem, goal: string, h: Holdings): Raw[] {
  const out: Raw[] = [];
  const prism = part(h, "prism", item.key, "AmpPrism", ampWhere(extra().Amp.Prism[item.key], "prism"), true);
  for (const [sn, sc] of Object.entries(extra().Amp.Scaffold)) {
    for (const [bn, b] of Object.entries(extra().Amp.Brace)) {
      out.push({
        parts: [prism, part(h, "scaffold", sn, "AmpScaffold", ampWhere(sc, "scaffold")), part(h, "brace", bn, "AmpBrace", ampWhere(b, "brace"))],
        scored: ampScored(item.key, sn, bn, goal),
      });
    }
  }
  return out;
}

const polarity = (p: CompanionPart) => (p.Polarities ?? []).filter((x) => x !== "None").join(", ") || "None";

function moaCombos(item: RecipeItem, goal: string, h: Holdings): Raw[] {
  const out: Raw[] = [];
  const model = part(h, "model", item.key, "MoaModel", MOA_MODEL_WHERE[item.key] ?? "Legs in Fortuna (Solaris United)", true);
  const legs = "Legs in Fortuna (Solaris United)";
  for (const [cn, c] of Object.entries(modular().MOA.Core)) {
    for (const [gn, g] of Object.entries(modular().MOA.Gyro)) {
      for (const [bn, b] of Object.entries(modular().MOA.Bracket)) {
        // The core's and gyro's bonuses add up (fractions of the MOA's base stats).
        const hp = r4((c.Health ?? 0) + (g.Health ?? 0));
        const sh = r4((c.Shield ?? 0) + (g.Shield ?? 0));
        const ar = r4((c.Armor ?? 0) + (g.Armor ?? 0));
        const scored = durableScored(hp, sh, ar, goal, [{ id: "polarity", label: "Bracket polarity", value: polarity(b) }], true, polarity(b));
        out.push({ parts: [model, part(h, "core", cn, "MoaCore", legs), part(h, "gyro", gn, "MoaGyro", legs), part(h, "bracket", bn, "MoaBracket", legs)], scored });
      }
    }
  }
  return out;
}

function houndCombos(item: RecipeItem, goal: string, h: Holdings): Raw[] {
  const out: Raw[] = [];
  const model = part(h, "model", item.key, "HoundModel", HOUND_WHERE, true);
  const want = goal.startsWith("precept:") ? goal.slice("precept:".length) : null;
  for (const [cn, c] of Object.entries(modular().Hound.Core)) {
    for (const [bn, b] of Object.entries(modular().Hound.Bracket)) {
      for (const [sn, s] of Object.entries(modular().Hound.Stabilizer)) {
        // The core gives flat health, shields and armor; MyOrbiter's estimate applies the bracket's
        // percentages to them.
        const hp = (c.Health ?? 0) * (1 + (b.Health ?? 0));
        const sh = (c.Shield ?? 0) * (1 + (b.Shield ?? 0));
        const ar = (c.Armor ?? 0) * (1 + (b.Armor ?? 0));
        const precepts = [...(modular().Hound.Model[item.key].Precepts ?? []), ...(b.Precepts ?? []), ...(s.Precepts ?? [])];
        const scored = durableScored(hp, sh, ar, want ? "health" : goal, [
          { id: "precepts", label: "Precepts", value: precepts.join(", ") },
          { id: "polarity", label: "Stabilizer polarity", value: polarity(s) },
        ], false, polarity(s));
        if (want) {
          const has = precepts.includes(want);
          scored.keys = [has ? 1 : 0, ...scored.keys];
          scored.scoreLabel = has ? `${want}; ${scored.scoreLabel}` : `No ${want}`;
        }
        out.push({ parts: [model, part(h, "core", cn, "HoundCore", HOUND_WHERE), part(h, "bracket", bn, "HoundBracket", HOUND_WHERE), part(h, "stabilizer", sn, "HoundStabilizer", HOUND_WHERE)], scored });
      }
    }
  }
  return out;
}

function creatureCombos(item: RecipeItem, goal: string, h: Holdings): Raw[] {
  const kind = item.family === "predasite" ? "Predasite" : "Vulpaphyla";
  const data = extra()[kind];
  const out: Raw[] = [];
  // The subspecies is caught (Conservation), not held as a part: MyOrbiter can't see a Weakened one.
  const sub: RecipePart = {
    role: "subspecies", name: item.key, unique: null, blueprint: null, held: 0, blueprints: 0, status: "missing", identifying: true,
    where: `Catch a Weakened ${item.name} by Conservation in the Cambion Drift (Deimos), once Infested have weakened it`,
  };
  const son = (p: CreaturePart) => `Son in the Necralisk (Entrati, ${p.rankName}, ${p.standing.toLocaleString("en-US")} standing)`;
  const claws = data.Subspecies[item.key].claws;
  for (const [mn, m] of Object.entries(data.Mutagen)) {
    for (const [an, a] of Object.entries(data.Antigen)) {
      const standing = m.standing + a.standing;
      const rank = Math.max(m.rank, a.rank);
      const stats: Stat[] = [
        { id: "resists", label: "Resists", value: (m.resists ?? []).join(", ") },
        { id: "polarity", label: "Polarity", value: a.polarity ?? "" },
        { id: "standing", label: "Standing", value: standing },
        { id: "rank", label: "Son rank", value: rank === m.rank ? m.rankName : a.rankName },
        { id: "health", label: "Health", value: data.base.health },
        { id: "shield", label: "Shields", value: data.base.shields },
        { id: "armor", label: "Armor", value: data.base.armor },
        { id: "clawDamage", label: "Claw damage", value: claws.damage },
        { id: "clawCrit", label: "Claw crit", value: claws.critChance, unit: "%" },
        { id: "clawStatus", label: "Claw status", value: claws.statusChance, unit: "%" },
      ];
      const pol = POLARITIES.find((p) => p.toLowerCase() === goal);
      const scored: Scored = pol
        ? { stats, keys: [a.polarity === pol ? 1 : 0, -standing], scoreLabel: a.polarity === pol ? `${pol} slot, ${standing.toLocaleString("en-US")} standing` : `No ${pol} slot` }
        : { stats, keys: [-standing, -rank], scoreLabel: `${standing.toLocaleString("en-US")} standing` };
      out.push({ parts: [sub, part(h, "mutagen", mn, `${kind}Mutagen`, son(m)), part(h, "antigen", an, `${kind}Antigen`, son(a))], scored });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The API.

export interface RecipeOptions {
  /** Kitguns: only one slot's combos (default both, ranked together). */
  slot?: KitgunSlot;
  /** Keep the first n combos. */
  limit?: number;
}

const GAPS = (): Record<RecipeFamily, string[]> => ({
  kitgun: ["Mods, falloff and status damage aren't counted: the numbers compare parts, not a finished build."],
  zaw: ["Slide, wall and leap attack multipliers aren't applied; grip and link damage is shared across the strike's damage types in proportion."],
  amp: [extra().Amp._gaps, "Scaffolds are read as area or single-target from the page's words; that reading is MyOrbiter's."],
  moa: ["Core and gyro bonuses are fractions of the MOA's base stats, which the data doesn't give."],
  hound: ["Health, shields and armor apply the bracket's percentages to the core's values: MyOrbiter's estimate.", "Precept effects aren't in the data."],
  predasite: [extra().Predasite._gaps, "MyOrbiter can't see a caught Weakened subspecies in your inventory."],
  vulpaphyla: [extra().Vulpaphyla._gaps, "MyOrbiter can't see a caught Weakened subspecies in your inventory."],
});

/**
 * Every combination of parts for a modular item, with its stats, ranked for a goal, and what you
 * hold of each part. `itemPathOrName` is the identifying part: a kitgun chamber, zaw strike, amp
 * prism, MOA or Hound model, or Predasite or Vulpaphyla subspecies, by path or name. `goal` is one of
 * goalsFor(item) (the first when unknown or left out). `inventory` is MyOrbiter's model, or any
 * Holdings; null ranks without ownership.
 *
 * Sorted by the goal's keys (higher first), then by fewest parts still missing, then by name.
 * Returns null for anything else (the Mote Amp, Sirocco, K-Drives, a Braton).
 */
export function recipesFor(itemPathOrName: string, goal?: string | null, inventory?: Model | Holdings | null, opts: RecipeOptions = {}): RecipeResult | null {
  if (!wikiData()) return null;
  const item = recipeItem(itemPathOrName);
  if (!item) return null;
  const goals = goalsFor(item.unique);
  const g = goals.find((x) => x.id === goal) ?? goals[0];
  const h = asHoldings(inventory);
  let raw: Raw[];
  switch (item.family) {
    case "kitgun": raw = kitgunCombos(item, g.id, h, opts.slot ? [opts.slot] : ["secondary", "primary"]); break;
    case "zaw": raw = zawCombos(item, g.id, h); break;
    case "amp": raw = ampCombos(item, g.id, h); break;
    case "moa": raw = moaCombos(item, g.id, h); break;
    case "hound": raw = houndCombos(item, g.id, h); break;
    default: raw = creatureCombos(item, g.id, h);
  }
  const combos = raw.map((x) => {
    const names = x.parts.map((p) => p.name);
    const combo: RecipeCombo = {
      key: `${x.slot ? `${x.slot}:` : ""}${names.join("/")}`,
      name: names.join(" · "),
      ...(x.slot ? { slot: x.slot } : {}),
      parts: x.parts,
      stats: x.scored.stats,
      score: x.scored.keys[0],
      scoreLabel: x.scored.scoreLabel,
      rank: 0,
      missing: x.parts.filter((p) => p.status !== "held").length,
      built: isBuilt(h, x.parts, x.slot),
    };
    return { combo, keys: x.scored.keys };
  });
  combos.sort((a, b) => {
    for (let i = 0; i < Math.max(a.keys.length, b.keys.length); i++) {
      const d = (b.keys[i] ?? 0) - (a.keys[i] ?? 0);
      if (Math.abs(d) > 1e-9) return d;
    }
    return a.combo.missing - b.combo.missing || a.combo.key.localeCompare(b.combo.key);
  });
  const ranked = combos.slice(0, opts.limit ?? combos.length).map((c, i) => ({ ...c.combo, rank: i + 1 }));
  const result: RecipeResult = {
    family: item.family,
    item: item.name,
    unique: item.unique,
    goal: g,
    goals,
    label: RANKING_LABEL,
    how: HOW[item.name]?.how ?? null,
    combos: ranked,
    gaps: GAPS()[item.family],
  };
  if (item.family === "moa") result.precepts = modular().MOA.Model[item.key].Precepts ?? [];
  if (item.family === "hound") result.precepts = modular().Hound.Model[item.key].Precepts ?? [];
  if (item.family === "predasite" || item.family === "vulpaphyla") {
    const kind = item.family === "predasite" ? "Predasite" : "Vulpaphyla";
    result.precepts = extra()[kind].Subspecies[item.key].precepts;
    result.role = CREATURE_ROLE[item.key];
  }
  if (item.family === "amp") {
    const area = PRISM_AREA[item.key];
    const fire = extra().Amp.Prism[item.key].fire ?? "";
    result.fit = g.id === "crowds" ? `${item.name}: ${fire} ${area ? "Suits crowds." : "Better on single targets."}`
      : g.id === "single" ? `${item.name}: ${fire} ${area ? "Better on crowds." : "Suits single targets."}`
      : `${item.name}: ${fire}`;
  }
  return result;
}
