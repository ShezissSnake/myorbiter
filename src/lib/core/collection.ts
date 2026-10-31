// The Foundry browser: every masterable item, with the state of each thing it's built from (the
// blueprint, its parts and resources), whether you own and have mastered it, and what it's worth.
import { masteryPoints } from "./acquire";
import { partFullName, UNOBTAINABLE, type Model } from "./model";
import { primeVaulted } from "./views";
import type { CatalogItem, Component } from "./types";
import { buildPlan, type BuildTier } from "./buildPlan";

export type Group = "warframes" | "primary" | "secondary" | "melee" | "companions" | "archwing" | "other";

export const GROUPS: { v: Group; label: string }[] = [
  { v: "warframes", label: "Warframes" },
  { v: "primary", label: "Primary" },
  { v: "secondary", label: "Secondary" },
  { v: "melee", label: "Melee" },
  { v: "companions", label: "Companions" },
  { v: "archwing", label: "Archwing" },
  { v: "other", label: "Other" },
];

const GROUP_OF: Record<string, Group> = {
  Warframes: "warframes",
  Primary: "primary",
  Secondary: "secondary",
  Melee: "melee",
  Sentinels: "companions",
  Pets: "companions",
  Archwing: "archwing",
  "Arch-Gun": "archwing",
  "Arch-Melee": "archwing",
  Misc: "other",
};

export interface PartState {
  /** The component's own name: "Blueprint", "Chassis", "Orokin Cell". */
  label: string;
  /** What it's traded and listed as, for prime parts ("Mesa Prime Chassis Blueprint"). */
  name: string;
  image: string | null;
  required: number;
  /** Blueprints and built parts together, or the resource count. */
  have: number;
  /** A resource (Orokin Cell, Morphics…) rather than a blueprint or part. */
  resource: boolean;
  /** Its blueprint or the part is being built in your foundry. */
  building: boolean;
  /** Trade price at the daily median, for tradable prime parts. */
  price: number | null;
  ducats: number | null;
  tradable: boolean;
  /** The main blueprint: drawn as the item's own art, tinted blue (WFCD's generic blueprint image is missing). */
  blueprint?: boolean;
}

export interface CollectionItem {
  unique: string;
  name: string;
  group: Group;
  category: string;
  type: string;
  image: string | null;
  owned: boolean;
  mastered: boolean;
  /** Its main blueprint is building in the foundry. */
  building: boolean;
  isPrime: boolean;
  vaulted: boolean;
  resurgence: boolean;
  unobtainable: boolean;
  masteryReq: number;
  points: number;
  parts: PartState[];
  /** Every part (not resources) in hand: ready to build. */
  buildable: boolean;
  /** Resources it takes that you don't have enough of ("Mortus Horn"), parts' own blueprints included once the recipes are read. */
  short: string[];
  /** Every part in hand: how easy building is now (buildPlan.ts); null otherwise. */
  tier: BuildTier | null;
  /** Set price at the daily median, for primes. */
  setPrice: number | null;
  wiki: string | null;
}

// Necramech parts (Capsule, Casing, Engine, Weapon Pod) live under Resources but are parts you
// build or find, counted and shown like any other part.
const isResource = (c: Component) => !/\/Recipes\//.test(c.uniqueName) && !/\/Weapons\//.test(c.uniqueName) && !/\/Resources\/Mechs\//.test(c.uniqueName);

/** The blueprint and built-part paths a component goes by: …ChassisBlueprint and …ChassisComponent. */
function paths(unique: string): string[] {
  if (/Component$/.test(unique)) return [unique, unique.replace(/Component$/, "Blueprint")];
  if (/Blueprint$/.test(unique)) return [unique, unique.replace(/Blueprint$/, "Component")];
  return [unique];
}

export function partState(m: Model, item: CatalogItem, c: Component): PartState {
  const resource = isResource(c);
  const name = resource ? c.name : partFullName(item, c);
  const traded = !resource && c.ducats != null && c.tradable !== false;
  const blueprint = !resource && c.name === "Blueprint";
  let have = 0;
  let building = false;
  if (resource) {
    have = m.owned(c.uniqueName);
  } else {
    for (const p of paths(c.uniqueName)) {
      have += m.owned(p);
      if (m.inFoundry(p) > 0) building = true;
    }
    // Prime part blueprints sit under a different path in TennoScope's inventory: count by name.
    if (traded) have = Math.max(have, m.ownedPartQty.get(name) ?? 0);
  }
  return {
    label: c.name,
    name,
    image: blueprint ? (item.imageName ?? m.imageOf(item.name)) : (c.imageName ?? m.imageOf(name)),
    required: c.itemCount ?? 1,
    have,
    resource,
    building,
    price: traded ? m.price(name) : null,
    ducats: traded ? (c.ducats ?? null) : null,
    tradable: traded,
    blueprint,
  };
}

/**
 * Components with the same name told apart: Wrath has two Blades (an Orion one and a Sirius one),
 * which become "Orion Blade" and "Sirius Blade" from their paths, or "Blade 1" and "Blade 2".
 */
export function distinctComponents(components: Component[]): Component[] {
  const count = new Map<string, number>();
  for (const c of components) count.set(c.name, (count.get(c.name) ?? 0) + 1);
  if (![...count.values()].some((n) => n > 1)) return components;
  const seen = new Map<string, number>();
  const word = (c: Component) => {
    const last = c.uniqueName.split("/").pop() ?? "";
    const stem = last.replace(/(Blueprint|Component)$/, "").replace(new RegExp(`${c.name.replace(/\s+/g, "")}$`), "");
    return stem.match(/^[A-Z][a-z]+/)?.[0] ?? null;
  };
  const words = new Map<Component, string | null>(components.map((c) => [c, count.get(c.name)! > 1 ? word(c) : null]));
  return components.map((c) => {
    if (count.get(c.name)! < 2) return c;
    const n = (seen.get(c.name) ?? 0) + 1;
    seen.set(c.name, n);
    const w = words.get(c);
    // A word that tells this one apart from its namesakes, else a number.
    const unique = w && components.filter((x) => x.name === c.name && words.get(x) === w).length === 1;
    return { ...c, name: unique ? `${w} ${c.name}` : `${c.name} ${n}` };
  });
}

export function collectionItem(m: Model, item: CatalogItem): CollectionItem {
  const parts = distinctComponents(item.components ?? []).map((c) => partState(m, item, c));
  // Blueprint first, then parts, then resources, as the game lists them.
  parts.sort((a, b) => Number(a.resource) - Number(b.resource) || Number(b.label === "Blueprint") - Number(a.label === "Blueprint"));
  const isPrime = item.isPrime === true || / Prime$/.test(item.name);
  const building = m.building(item.uniqueName) > 0;
  // Held built, not counting the one in the foundry: that one shows as Building.
  const owned = m.owned(item.uniqueName) - m.building(item.uniqueName) > 0;
  const pieces = parts.filter((p) => !p.resource);
  const buildable = !owned && !building && pieces.length > 0 && pieces.every((p) => p.have >= p.required || p.building);
  const plan = buildable && m.recipes ? buildPlan(m, item, m.recipes) : null;
  return {
    unique: item.uniqueName,
    name: item.name,
    group: GROUP_OF[item.category] ?? "other",
    category: item.category,
    // The catalog files Kubrows, Kavats and the like as "Pets": Mastery calls them companions.
    type: (item.type === "Pets" ? "Companion" : item.type) ?? item.category,
    image: item.imageName ?? m.imageOf(item.name),
    owned,
    mastered: m.isMastered(item.uniqueName),
    building,
    isPrime,
    vaulted: isPrime ? primeVaulted(m, item) : item.vaulted === true,
    resurgence: isPrime && m.inResurgence(item.uniqueName),
    unobtainable: UNOBTAINABLE.has(item.name),
    masteryReq: item.masteryReq ?? 0,
    points: masteryPoints(item),
    parts,
    buildable,
    short: plan ? plan.short.map((r) => r.name) : parts.filter((p) => p.resource && p.have < p.required).map((p) => p.label),
    tier: plan?.tier ?? null,
    setPrice: isPrime ? m.price(`${item.name} Set`) : null,
    wiki: item.wikiaUrl ?? null,
  };
}

/** Every masterable item orbiter knows, by name. */
export function collection(m: Model): CollectionItem[] {
  const out: CollectionItem[] = [];
  for (const item of m.catalogByUnique.values()) {
    // Not `excludeFromCodex`: the hound weapons (Akaten, Batoten, Lacerten) carry it but give
    // mastery all the same, as Mastery counts them. Orion's second suit is dropped as NO_MASTERY.
    if (!item.masterable || !(item.category in GROUP_OF)) continue;
    out.push(collectionItem(m, item));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
