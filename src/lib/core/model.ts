// One pass over the bundle that builds every lookup the views need.

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
 * Set"): the blueprint and the parts the recipe takes, not its resources. Null for prime sets
 * (partsByParent has those) and for anything without parts.
 */
export function gearSetParts(m: Model, unique: string): GearSetPart[] | null {
  if (m.partsByParent.has(unique)) return null;
  const item = m.catalogByUnique.get(unique);
  const parts = (item?.components ?? [])
    .filter((c) => c.uniqueName.includes("/Recipes/"))
    .map((c) => ({ unique: baseId(c.uniqueName), name: c.name.startsWith(item!.name) ? c.name : `${item!.name} ${c.name}`, required: c.itemCount ?? 1 }));
  return parts.length ? parts : null;
}

/** How many of a thing you hold, every copy of it in your inventory. */
export function heldCount(m: Model, unique: string): number {
  return (m.inventoryByBase.get(unique) ?? []).reduce((n, r) => n + r.quantity, 0);
}

export function splitRelicName(name: string): { base: string; refinement: Refinement } | null {
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

/** Ducat values the game changed since the catalog TennoScope carries was made (wiki, WFCD). */
const DUCATS_NOW: Record<string, number> = { "Bronco Prime Barrel": 25 };

/**
 * Catalog entries marked masterable that give no mastery of their own: Sirius & Orion's second son
 * (the pair counts once, under Sirius & Orion), and the second Grimoire the game keeps for the
 * Doppelganger (only the Tenno one counts). Left in, they'd sit on Mastery as never finished.
 */
export const NO_MASTERY = new Set(["/Lotus/Powersuits/SiriusOrion/OrionSuit", "/Lotus/Weapons/Tenno/Grimoire/TnDoppelgangerGrimoire"]);

export function buildModel(bundle: Bundle, live: Live = { fissures: null, resurgence: null, resurgenceExpiry: null }, foundry: Record<string, number> | null = null, relicMarket: RelicMarket | null = null): Model {
  // Some relic entries list a reward twice ("2X Forma Blueprint" in Meso D1); merge them so every
  // reward name appears once per relic, with the chances added up.
  // Some items list the same component twice (Akbronco Prime: two Bronco Prime, one each); merge
  // them so it reads as one component needed twice.
  bundle = {
    ...bundle,
    catalog: bundle.catalog.map((item) => {
      if (item.masterable && NO_MASTERY.has(item.uniqueName)) item = { ...item, masterable: false };
      const comps = item.components;
      if (!comps || new Set(comps.map((c) => c.uniqueName)).size === comps.length) return item;
      const merged = new Map<string, Component>();
      for (const c of comps) {
        const prev = merged.get(c.uniqueName);
        merged.set(c.uniqueName, prev ? { ...prev, itemCount: (prev.itemCount ?? 1) + (c.itemCount ?? 1) } : { ...c });
      }
      return { ...item, components: [...merged.values()] };
    }),
  };
  bundle = {
    ...bundle,
    relics: bundle.relics.map((r) => {
      const merged = new Map<string, RelicReward>();
      for (const rw of r.rewards) {
        const prev = merged.get(rw.name);
        merged.set(rw.name, prev ? { ...prev, chance: (prev.chance ?? 0) + (rw.chance ?? 0) } : { ...rw });
      }
      return merged.size === r.rewards.length ? r : { ...r, rewards: [...merged.values()] };
    }),
  };

  const catalogByUnique = new Map<string, CatalogItem>();
  for (const item of bundle.catalog) catalogByUnique.set(item.uniqueName, item);

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
  const owned = (unique: string) =>
    (inventoryByBase.get(unique) ?? []).reduce((n, r) => n + r.quantity, 0) + (building.get(unique) ?? 0);

  const resurgence = new Set<string>(
    (live.resurgence ?? []).map((v) => normaliseStoreUnique(v.uniqueName)),
  );
  const inResurgence = (unique: string) => resurgence.has(normaliseStoreUnique(unique));

  // Prime parts: components that carry a ducat value.
  const primeParents: CatalogItem[] = [];
  const partsByParent = new Map<string, PrimePart[]>();
  const partByName = new Map<string, PrimePart[]>();
  const partByComponentUnique = new Map<string, string>();
  for (const item of bundle.catalog) {
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
  // Every item's own blueprint, primes and non-primes alike.
  const mainBlueprint = new Map<string, string>();
  for (const item of bundle.catalog) {
    for (const c of item.components ?? []) if (c.name === "Blueprint") mainBlueprint.set(c.uniqueName, item.uniqueName);
  }
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

  // Relics, grouped by "Era Code".
  const relicGroups = new Map<string, RelicGroup>();
  for (const relic of bundle.relics) {
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

  const nameByUnique = new Map<string, string>();
  for (const item of bundle.catalog) nameByUnique.set(item.uniqueName, item.name);
  for (const [u, name] of partByComponentUnique) nameByUnique.set(u, name);
  for (const row of bundle.inventory) if (!nameByUnique.has(baseId(row.item_id))) nameByUnique.set(baseId(row.item_id), row.name);
  const nameOf = (path: string) => {
    const u = path.replace("/Lotus/StoreItems/", "/Lotus/");
    const known = nameByUnique.get(u);
    if (known) return known;
    // Not in the trimmed catalog (Forma, resources): make the last path segment readable.
    const last = u.split("/").pop() ?? u;
    return last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  };

  // Image file names by display name. Inventory names win: they are what the game shows.
  const inventoryByName = new Map<string, InventoryRow[]>();
  for (const row of bundle.inventory) {
    if (row.quantity <= 0) continue;
    const list = inventoryByName.get(row.name);
    if (list) list.push(row);
    else inventoryByName.set(row.name, [row]);
  }
  const catalogNames = new Set(bundle.catalog.map((c) => c.name));

  const imageByName = new Map<string, string>();
  for (const item of bundle.catalog) {
    if (item.imageName && !imageByName.has(item.name)) imageByName.set(item.name, item.imageName);
    for (const comp of item.components ?? []) {
      if (!comp.imageName) continue;
      const full = partFullName(item, comp);
      if (!imageByName.has(full)) imageByName.set(full, comp.imageName);
    }
  }
  for (const row of bundle.inventory) if (row.image_name) imageByName.set(row.name, row.image_name);
  for (const relic of bundle.relics) {
    const split = splitRelicName(relic.name);
    if (split && relic.imageName && !imageByName.has(split.base)) imageByName.set(split.base, relic.imageName);
  }
  // A prime's main blueprint is filed under the generic blueprint picture, which the image set
  // doesn't have: show the item it builds instead.
  const own = (name: string) => {
    const f = imageByName.get(name);
    return f && f !== "blueprint.png" ? f : undefined;
  };
  const imageOf = (name: string) => own(name) ?? own(name.replace(/ Blueprint$/, "")) ?? null;

  const relicByUnique = new Map<string, RelicEntry>();
  for (const relic of bundle.relics) relicByUnique.set(relic.uniqueName, relic);

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

  const ownedRelicCount = new Map<string, number>();
  for (const row of bundle.inventory) {
    if (row.category !== "relic") continue;
    const split = splitRelicName(row.name);
    if (!split || row.quantity <= 0) continue;
    ownedRelicCount.set(split.base, (ownedRelicCount.get(split.base) ?? 0) + row.quantity);
  }

  const p = bundle.prices ?? {};
  const price = (name: string) => p.prices?.[name] ?? null;
  const priceMax = (name: string) => p.max_rank_prices?.[name] ?? null;
  const tradesPerDay = (name: string) => {
    const t = p.trade_rate?.[name];
    return t ? t[0] : null;
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
  };
}
