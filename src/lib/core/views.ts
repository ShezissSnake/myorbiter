// Each function turns the model into the rows one tab shows. Pure, so they are tested directly.

import { REFINEMENTS, UNOBTAINABLE, baseId, relicRewardRarity, splitRelicName, type Model, type PrimePart, type Refinement, type RelicSource } from "./model";
export { relicRewardRarity };
import type { CatalogItem, InventoryRow } from "./types";
import { acquisition, masteryPoints, type Acquisition } from "./acquire";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Vaulted unless a relic that drops it is still in the drop tables or with Varzia. */
export function partAvailability(m: Model, partName: string): "farmable" | "resurgence" | "vaulted" | "unknown" {
  const sources = m.sourcesByReward.get(partName) ?? [];
  if (sources.some((s) => !s.vaulted)) return "farmable";
  // Varzia sells special relics for the items she has in stock; match on the item itself.
  const parent = m.partByName.get(partName)?.[0]?.parentUnique;
  if (sources.some((s) => s.resurgence) || (parent && m.inResurgence(parent))) return "resurgence";
  if (!sources.length) return "unknown";
  return "vaulted";
}

/**
 * Whether a prime is vaulted: by its parts, as the drop tables have them (a part from no relic that
 * still drops), else by the catalog's flag. The flag lags: Nyx Prime's parts drop from Railjack
 * cache relics while it says vaulted. Varzia's stock counts as vaulted.
 */
export function primeVaulted(m: Model, item: { uniqueName: string; vaulted?: boolean }): boolean {
  const parts = m.partsByParent.get(item.uniqueName) ?? [];
  const avail = parts.map((p) => partAvailability(m, p.fullName)).filter((a) => a !== "unknown");
  if (!avail.length) return item.vaulted === true;
  return avail.some((a) => a !== "farmable");
}

// ---------------------------------------------------------------- 1. complete sets

export interface SetRow {
  name: string; // "Rhino Prime"
  unique: string;
  category: string;
  completeSets: number;
  sellable: number;
  keptForBuild: boolean;
  mastered: boolean;
  ownedBuilt: boolean;
  setPrice: number | null;
  partsPrice: number | null;
  ducats: number;
  vaulted: boolean;
  tradesPerDay: number | null;
  /** Parts still missing for one more set, after the complete ones. */
  missing: { name: string; count: number; price: number | null }[];
  parts: { name: string; owned: number; required: number }[];
  /** A prime set (with ducats and relics), or one of the gear sets warframe.market also trades. */
  prime: boolean;
}

export function setRows(m: Model): SetRow[] {
  const rows: SetRow[] = [];
  for (const parent of m.primeParents) {
    const parts = m.partsByParent.get(parent.uniqueName)!;
    const owned = parts.map((p) => m.ownedPartQty.get(p.fullName) ?? 0);
    if (owned.every((n) => n === 0)) continue;
    const complete = Math.min(...parts.map((p, i) => Math.floor(owned[i] / p.required)));
    const mastered = m.isMastered(parent.uniqueName);
    const ownedBuilt = m.owned(parent.uniqueName) > 0;
    const keptForBuild = complete > 0 && !mastered && !ownedBuilt;
    const partPrices = parts.map((p) => m.price(p.fullName));
    rows.push({
      name: parent.name,
      unique: parent.uniqueName,
      category: parent.category,
      completeSets: complete,
      sellable: Math.max(0, complete - (keptForBuild ? 1 : 0)),
      keptForBuild,
      mastered,
      ownedBuilt,
      setPrice: m.price(`${parent.name} Set`),
      partsPrice: partPrices.every((x) => x != null)
        ? sum(parts.map((p, i) => (partPrices[i] as number) * p.required))
        : null,
      ducats: sum(parts.map((p) => p.ducats * p.required)),
      vaulted: primeVaulted(m, parent),
      tradesPerDay: m.tradesPerDay(`${parent.name} Set`),
      missing: parts
        .map((p, i) => ({
          name: p.fullName,
          count: Math.max(0, p.required - (owned[i] - complete * p.required)),
          price: partPrices[i],
        }))
        .filter((x) => x.count > 0),
      parts: parts.map((p, i) => ({ name: p.fullName, owned: owned[i], required: p.required })),
      prime: true,
    });
  }
  return rows;
}

// ---------------------------------------------------------------- 2. prime parts

export interface PartRow {
  name: string;
  quantity: number;
  parentName: string;
  parentUnique: string;
  parentMastered: boolean;
  parentOwned: boolean;
  /** Copies held back so you can still build and master the item (none once it is mastered or built). */
  keep: number;
  /** Copies not needed for a set you would still build (parent not mastered, not owned). */
  spare: number;
  /** Spare copies that go into complete sets you can sell (sell those as a set). */
  inSets: number;
  price: number | null;
  ducats: number;
  ducatsPerPlat: number | null;
  availability: ReturnType<typeof partAvailability>;
  tradesPerDay: number | null;
}

export function partRows(m: Model): PartRow[] {
  const rows: PartRow[] = [];
  // Parts that make up complete sets you can sell: you'd rather sell those as a set.
  const inSets = new Map<string, number>();
  for (const s of setRows(m)) {
    if (s.sellable <= 0) continue;
    for (const p of m.partsByParent.get(s.unique) ?? []) inSets.set(p.fullName, (inSets.get(p.fullName) ?? 0) + s.sellable * p.required);
  }
  for (const [name, qty] of m.ownedPartQty) {
    const part: PrimePart | undefined = m.partByName.get(name)?.[0];
    if (!part) continue;
    const parentMastered = m.isMastered(part.parentUnique);
    const parentOwned = m.owned(part.parentUnique) > 0;
    // Copies already being crafted in the foundry count toward the build: fewer held ones are kept.
    const keep = parentMastered || parentOwned ? 0 : Math.max(0, part.required - (m.craftingPartQty.get(name) ?? 0));
    const price = m.price(name);
    rows.push({
      name,
      quantity: qty,
      parentName: part.parentName,
      parentUnique: part.parentUnique,
      parentMastered,
      parentOwned,
      keep: Math.min(qty, keep),
      spare: Math.max(0, qty - keep),
      inSets: Math.min(Math.max(0, qty - keep), inSets.get(name) ?? 0),
      price,
      ducats: part.ducats,
      ducatsPerPlat: price ? part.ducats / price : null,
      availability: partAvailability(m, name),
      tradesPerDay: m.tradesPerDay(name),
    });
  }
  return rows;
}

// ---------------------------------------------------------------- 3. mastery to-do

export type MasteryStatus = "level" | "build" | "parts" | "missing";

export interface MasteryRow {
  name: string;
  unique: string;
  category: string;
  type: string;
  masteryReq: number;
  isPrime: boolean;
  status: MasteryStatus;
  unobtainable: boolean;
  vaulted: boolean;
  setPrice: number | null;
  partsOwned: number;
  partsTotal: number;
  /** For primes: missing parts with their relics. */
  missingParts: { name: string; /** Copies still to get. */ need: number; availability: string; sources: (RelicSource & { owned: number })[] }[];
  /** Relics you own that drop a missing part. */
  ownedRelicsForIt: number;
  /** For non-primes: where its blueprint or parts drop, if known. */
  sources: string[];
  wiki: string | null;
  /** How to get it and how hard that is. */
  acq: Acquisition;
  /** Mastery points at max rank. */
  points: number;
  /** Primes: plat for the parts you're missing, at the daily median. */
  buyFor: number | null;
}

export const MASTERY_CATEGORIES: Record<string, string> = {
  Warframes: "Warframe",
  Primary: "Primary",
  Secondary: "Secondary",
  Melee: "Melee",
  "Arch-Gun": "Arch-Gun",
  "Arch-Melee": "Arch-Melee",
  Archwing: "Archwing",
  Sentinels: "Companion",
  Pets: "Companion",
  Misc: "Other",
};

/** Inventory rows filed as weapons/companions that are really consumables or tools. */
const NOT_GEAR = /Genetic Code|Heartcell|Arcane Adapter|Training Amp|Pulsar Mk/i;

const INVENTORY_KIND: Record<string, string> = { frame: "Warframe", weapon: "Weapon", companion: "Companion" };

export function masteryRows(m: Model): MasteryRow[] {
  const rows: MasteryRow[] = [];
  const seen = new Set<string>();
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable || !(item.category in MASTERY_CATEGORIES)) continue;
    seen.add(item.uniqueName);
    if (m.isMastered(item.uniqueName)) continue;
    rows.push(masteryRow(m, item));
  }
  // Things the game says you have but the catalog does not list as masterable (modular parts...).
  for (const [unique, invRows] of m.inventoryByBase) {
    const r = invRows[0];
    if (seen.has(unique) || !(r.category in INVENTORY_KIND) || m.isMastered(unique)) continue;
    if (r.quantity <= 0 || NOT_GEAR.test(r.name)) continue;
    rows.push({
      name: r.name,
      unique,
      category: INVENTORY_KIND[r.category],
      type: INVENTORY_KIND[r.category],
      masteryReq: 0,
      isPrime: / Prime\b/.test(r.name),
      status: "level",
      unobtainable: false,
      vaulted: false,
      setPrice: null,
      partsOwned: 0,
      partsTotal: 0,
      missingParts: [],
      ownedRelicsForIt: 0,
      sources: [],
      wiki: null,
      acq: { method: "level", difficulty: 0, how: "You have it: take it to max rank.", icon: "mastery", available: true, tradable: false, researched: false, wiki: null },
      buyFor: null,
      points: masteryPoints({ name: r.name, category: r.category === "frame" ? "Warframes" : r.category === "companion" ? "Pets" : "Primary" }),
    });
  }
  return rows;
}

export function masteryRow(m: Model, item: CatalogItem): MasteryRow {
  const owned = m.owned(item.uniqueName) > 0;
  const parts = m.partsByParent.get(item.uniqueName) ?? [];
  const isPrime = parts.length > 0 || item.isPrime === true;
  let partsOwned = 0;
  const missingParts: MasteryRow["missingParts"] = [];
  const relicsForIt = new Set<string>();
  // Already built: only levelling is left, so parts and relics do not matter.
  for (const p of owned ? [] : parts) {
    const have = m.partHave(p.fullName);
    if (have >= p.required) {
      partsOwned++;
      continue;
    }
    const sources = (m.sourcesByReward.get(p.fullName) ?? []).map((s) => ({
      ...s,
      owned: m.ownedRelicCount.get(s.base) ?? 0,
    }));
    for (const s of sources) if (s.owned > 0) relicsForIt.add(s.base);
    sources.sort((a, b) => b.owned - a.owned || Number(a.vaulted) - Number(b.vaulted) || b.chanceRadiant - a.chanceRadiant);
    missingParts.push({ name: p.fullName, need: p.required - have, availability: partAvailability(m, p.fullName), sources });
  }

  // Non-prime: blueprint/parts drop locations and whether the market sells it.
  const sources: string[] = [];
  if (!isPrime) {
    const locs = new Map<string, number>();
    for (const c of item.components ?? []) {
      for (const d of c.drops ?? []) {
        const loc = d.location.replace(/,\s*Rotation [ABC]$/, "");
        locs.set(loc, Math.max(locs.get(loc) ?? 0, d.chance));
      }
    }
    if (item.bpCost || item.marketCost) sources.push("Market");
    sources.push(...[...locs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => l));
  }

  // Built from other weapons too (Akbronco Prime takes two Bronco Primes): every part in hand
  // isn't enough to build it without those.
  const lackingWeapons = owned ? [] : (item.components ?? []).filter((c) => m.catalogByUnique.get(c.uniqueName)?.masterable && m.owned(c.uniqueName) < (c.itemCount ?? 1));
  let status: MasteryStatus = "missing";
  if (owned) status = "level";
  else if (parts.length && partsOwned === parts.length && !lackingWeapons.length) status = "build";
  else if (partsOwned > 0) status = "parts";

  const vaulted = isPrime && missingParts.some((p) => p.availability === "vaulted");
  const partPrices = missingParts.map((p) => m.price(p.name));
  // Each missing copy is bought: two Blades still to get cost two Blades.
  const buyFor = missingParts.length && partPrices.every((x) => x != null) ? Math.round(missingParts.reduce((a, p, i) => a + (partPrices[i] as number) * p.need, 0)) : null;
  const acq = acquisition(m, item, {
    isPrime,
    owned,
    buildable: status === "build",
    partsTotal: parts.length,
    unobtainable: UNOBTAINABLE.has(item.name),
    missingParts,
    ownedRelicsForIt: relicsForIt.size,
    buyFor,
  });
  return {
    name: item.name,
    unique: item.uniqueName,
    category: MASTERY_CATEGORIES[item.category],
    type: item.type ?? item.category,
    masteryReq: item.masteryReq ?? 0,
    isPrime,
    status,
    unobtainable: UNOBTAINABLE.has(item.name),
    vaulted: primeVaulted(m, item) || vaulted,
    setPrice: isPrime ? m.price(`${item.name} Set`) : null,
    partsOwned,
    partsTotal: parts.length,
    missingParts,
    ownedRelicsForIt: relicsForIt.size,
    sources,
    wiki: item.wikiaUrl ?? null,
    acq,
    points: masteryPoints(item),
    buyFor: isPrime ? buyFor : null,
  };
}

// ---------------------------------------------------------------- 4. arcanes

/** Copies it takes to reach a rank: 1, 3, 6, 10, 15, 21. */
export const copiesForRank = (rank: number) => ((rank + 1) * (rank + 2)) / 2;

export interface ArcaneRow {
  name: string;
  unique: string;
  type: string;
  rarity: string;
  maxRank: number;
  /** Rank-0 copies you hold, counting fused copies at what they cost. */
  copies: number;
  needed: number;
  highestRank: number | null;
  hasMaxed: boolean;
  /** Copies at max rank. */
  maxedCopies: number;
  /** Maxed copies beyond the one you keep: sell these at the max-rank price. */
  extraMaxed: number;
  /**
   * Whole maxed arcanes your copies make beyond the one you keep, fused or not: 43 copies of a
   * 21-copy arcane make two, so one extra. Sold at the max-rank price.
   */
  extraSets: number;
  /** Of those, how many you still have to fuse in game before you can trade them. */
  toFuse: number;
  /** Unranked copies you hold. */
  unranked: number;
  complete: boolean;
  /** Copies beyond one maxed arcane (sellable). */
  spare: number;
  missing: number;
  price: number | null;
  priceMax: number | null;
  /** Cheapest way to finish: buy the missing copies or one maxed copy. */
  costToFinish: number | null;
  tradesPerDay: number | null;
  tradable: boolean;
}

export function arcaneRows(m: Model): ArcaneRow[] {
  const rows: ArcaneRow[] = [];
  const seen = new Set<string>();
  const make = (unique: string, item: CatalogItem | undefined, inv: InventoryRow[]) => {
    const name = item?.name ?? inv[0]?.name ?? unique;
    const maxRank = inv.find((r) => r.max_rank)?.max_rank ?? (item?.maxRank && item.maxRank > 0 ? item.maxRank : 5);
    const copies = sum(inv.map((r) => r.quantity * copiesForRank(r.rank ?? 0)));
    const ranks = inv.filter((r) => r.quantity > 0).map((r) => r.rank ?? 0);
    const highestRank = ranks.length ? Math.max(...ranks) : null;
    const needed = copiesForRank(maxRank);
    const hasMaxed = highestRank != null && highestRank >= maxRank;
    const maxedCopies = sum(inv.filter((r) => (r.rank ?? 0) >= maxRank).map((r) => r.quantity));
    const complete = hasMaxed || copies >= needed;
    const missing = Math.max(0, needed - copies);
    const price = m.price(name);
    const priceMax = m.priceMax(name);
    const options = [price != null ? missing * price : null, priceMax].filter((x): x is number => x != null);
    // Spare = rank-0 copies beyond the one maxed arcane you keep.
    const spare = complete ? Math.max(0, copies - needed) : 0;
    rows.push({
      name,
      unique,
      type: (item?.type ?? "Arcane").replace(/ Arcane$/, "") || "Arcane",
      rarity: item?.rarity ?? "",
      maxRank,
      copies,
      needed,
      highestRank,
      hasMaxed,
      maxedCopies,
      extraMaxed: Math.max(0, maxedCopies - 1),
      extraSets: copies >= needed ? Math.floor(copies / needed) - 1 : 0,
      toFuse: Math.max(0, (copies >= needed ? Math.floor(copies / needed) - 1 : 0) - Math.max(0, maxedCopies - 1)),
      unranked: sum(inv.filter((r) => !r.rank).map((r) => r.quantity)),
      complete,
      spare,
      missing,
      price,
      priceMax,
      costToFinish: complete ? 0 : options.length ? Math.min(...options) : null,
      tradesPerDay: m.tradesPerDay(name),
      tradable: item?.tradable !== false,
    });
  };
  // The catalog lists some arcanes under more than one path; one row per name.
  const byName = new Map<string, { unique: string; item?: CatalogItem; inv: InventoryRow[] }>();
  const entry = (name: string, unique: string) => {
    let e = byName.get(name);
    if (!e) byName.set(name, (e = { unique, inv: [] }));
    return e;
  };
  for (const item of m.catalogByUnique.values()) {
    if (item.category !== "Arcanes" || !item.name.trim()) continue;
    const e = entry(item.name, item.uniqueName);
    e.item ??= item;
    e.inv.push(...(m.inventoryByBase.get(item.uniqueName) ?? []));
    seen.add(item.uniqueName);
  }
  for (const [unique, inv] of m.inventoryByBase) {
    if (seen.has(unique) || inv[0].category !== "arcane") continue;
    entry(inv[0].name, unique).inv.push(...inv);
  }
  for (const e of byName.values()) make(e.unique, e.item, e.inv);
  return rows;
}

// ---------------------------------------------------------------- 5. duplicate mods

export interface ModRow {
  name: string;
  unique: string;
  total: number;
  extras: number;
  ranks: { rank: number; count: number }[];
  maxRank: number | null;
  rarity: string;
  type: string;
  tradable: boolean;
  price: number | null;
  priceMax: number | null;
  extrasValue: number | null;
  tradesPerDay: number | null;
  augment: boolean;
}

/**
 * Mod copies you can spare, by rank (`ranks` best first). Two copies are always kept: your best one,
 * to use, and one of the lowest rank, to give a new player. So a mod you hold one or two of is
 * never sold.
 */
export const MOD_KEEP = 2;
export function modSpares(ranks: { rank: number; count: number }[]): { rank: number; count: number }[] {
  const left = ranks.map((r) => ({ ...r }));
  if (left.length) left[0].count--; // your best copy
  const lowest = [...left].reverse().find((r) => r.count > 0);
  if (lowest) lowest.count--; // one to give away
  return left.filter((r) => r.count > 0);
}

export function modRows(m: Model): ModRow[] {
  const rows: ModRow[] = [];
  for (const [unique, inv] of m.inventoryByBase) {
    if (inv[0].category !== "mod" || unique.includes("/Randomized/")) continue;
    const total = sum(inv.map((r) => r.quantity));
    if (total <= 0) continue;
    const item = m.catalogByUnique.get(unique);
    const name = item?.name ?? inv[0].name;
    const byRank = new Map<number, number>();
    for (const r of inv) byRank.set(r.rank ?? 0, (byRank.get(r.rank ?? 0) ?? 0) + r.quantity);
    const price = m.price(name);
    const extras = Math.max(0, total - MOD_KEEP);
    rows.push({
      name,
      unique,
      total,
      extras,
      ranks: [...byRank.entries()].filter(([, c]) => c > 0).sort((a, b) => b[0] - a[0]).map(([rank, count]) => ({ rank, count })),
      // The game's own number (TennoScope reads it) beats the catalog's.
      maxRank: inv.find((r) => r.max_rank != null)?.max_rank ?? item?.maxRank ?? null,
      rarity: item?.rarity ?? "",
      type: item?.type ?? "",
      tradable: item?.tradable !== false,
      price,
      priceMax: m.priceMax(name),
      // Extras are the lowest-ranked copies; price them unranked.
      extrasValue: price != null ? price * extras : null,
      tradesPerDay: m.tradesPerDay(name),
      augment: item?.isAugment === true,
    });
  }
  return rows;
}

// ---------------------------------------------------------------- 6/7. relics

export interface RelicRewardRow {
  name: string;
  rarity: string;
  chance: number;
  /** The same reward's chance from a Radiant relic, when known. */
  chanceRadiant?: number;
  price: number | null;
  ducats: number | null;
  owned: number;
  /** A part of something you have not mastered and do not have enough of yet. */
  needed: boolean;
  parentMastered: boolean | null;
}

export interface RelicRow {
  base: string;
  era: string;
  owned: Record<string, number>;
  total: number;
  vaulted: boolean;
  resurgence: boolean;
  relicPrice: number | null;
  rewards: RelicRewardRow[];
  neededCount: number;
  /** Expected platinum per crack, intact and radiant, solo: each reward at its price, or its ducats at your rate when that's more. */
  evIntact: number | null;
  evRadiant: number | null;
  /** Radiant minus intact, per crack. */
  evGain: number | null;
  /** (chance 0..1, plat) per reward, to work out squad cracks (best of n). */
  outIntact: { chance: number; value: number }[];
  outRadiant: { chance: number; value: number }[];
  /**
   * Every refinement's rewards and solo crack value: exceptional and flawless have odds of their
   * own. `ev` is null when a prime part among the rewards has no price (see evIntact).
   */
  byRefinement: Partial<Record<Refinement, { ev: number | null; out: { chance: number; value: number }[] }>>;
  evDucatsIntact: number;
}

/** Relics you hold that TennoScope's relic data doesn't list yet (newly added ones), by base. */
export function unknownRelics(m: Model): { base: string; era: string; owned: Record<string, number>; total: number }[] {
  const out = new Map<string, { base: string; era: string; owned: Record<string, number>; total: number }>();
  for (const [, inv] of m.inventoryByBase) {
    for (const r of inv) {
      if (r.category !== "relic" || r.quantity <= 0) continue;
      const split = splitRelicName(r.name);
      if (!split || m.relicGroups.has(split.base)) continue;
      const e = out.get(split.base) ?? { base: split.base, era: split.base.split(" ")[0], owned: {}, total: 0 };
      e.owned[split.refinement] = (e.owned[split.refinement] ?? 0) + r.quantity;
      e.total += r.quantity;
      out.set(split.base, e);
    }
  }
  return [...out.values()].sort((a, b) => a.base.localeCompare(b.base, "en", { numeric: true }));
}

/** Each reward's chance by rarity and refinement (percent): 3 common, 2 uncommon, 1 rare. */
/**
 * Platinum a relic reward is worth to you: its market price, or its ducats at your rate (Prime
 * parts, Your rates) when that's more, since you'd trade it to Baro instead. 0 for things that
 * neither sell nor give ducats (Forma, Kuva, Riven Sliver…).
 */
export function rewardPlat(m: Model, name: string, platPerDucat = 0): number {
  const ducats = m.partByName.get(name)?.[0]?.ducats ?? 0;
  return Math.max(m.price(name) ?? 0, ducats * platPerDucat);
}

export function relicRows(m: Model, opts: { includeUnowned?: boolean; platPerDucat?: number } = {}): RelicRow[] {
  const rate = opts.platPerDucat ?? 0;
  const ownedByBase = new Map<string, Record<string, number>>();
  for (const [, inv] of m.inventoryByBase) {
    for (const r of inv) {
      if (r.category !== "relic" || r.quantity <= 0) continue;
      const split = splitRelicName(r.name);
      if (!split) continue;
      const rec = ownedByBase.get(split.base) ?? {};
      rec[split.refinement] = (rec[split.refinement] ?? 0) + r.quantity;
      ownedByBase.set(split.base, rec);
    }
  }
  const rows: RelicRow[] = [];
  for (const group of m.relicGroups.values()) {
    const owned = ownedByBase.get(group.base) ?? {};
    const total = sum(Object.values(owned));
    if (!total && !opts.includeUnowned) continue;
    const intact = group.byRefinement.Intact;
    const radiant = group.byRefinement.Radiant;
    if (!intact) continue;
    const rewards: RelicRewardRow[] = intact.rewards.map((rw) => {
      const part = m.partByName.get(rw.name)?.[0];
      const have = m.partHave(rw.name);
      const parentDone = part ? m.isMastered(part.parentUnique) || m.owned(part.parentUnique) > 0 : null;
      return {
        name: rw.name,
        rarity: relicRewardRarity("Intact", rw.chance, rw.rarity),
        chance: rw.chance ?? 0,
        chanceRadiant: radiant?.rewards.find((x) => x.name === rw.name)?.chance ?? undefined,
        price: m.price(rw.name),
        ducats: part?.ducats ?? null,
        owned: have,
        needed: part ? !parentDone && have < part.required : false,
        parentMastered: part ? m.isMastered(part.parentUnique) : null,
      };
    });
    const out = (entry: typeof intact | undefined) =>
      (entry?.rewards ?? []).map((rw) => ({ chance: (rw.chance ?? 0) / 100, value: rewardPlat(m, rw.name, rate) }));
    const ev = (entry: typeof intact | undefined) => {
      if (!entry) return null;
      // A prime part with no price yet (a new one, say) makes the average meaningless: its ducats
      // alone could make a valuable relic look cheap. Anything else unpriced is worth 0.
      if (entry.rewards.some((rw) => m.price(rw.name) == null && m.partByName.has(rw.name))) return null;
      return Math.round(sum(out(entry).map((o) => o.chance * (o.value ?? 0))) * 10) / 10;
    };
    const evIntact = ev(intact);
    const evRadiant = ev(radiant);
    rows.push({
      base: group.base,
      era: group.era,
      owned,
      total,
      vaulted: group.vaulted,
      resurgence: group.resurgence,
      relicPrice: m.relicPrice(group.base),
      rewards,
      neededCount: rewards.filter((r) => r.needed).length,
      evIntact,
      evRadiant,
      evGain: evIntact != null && evRadiant != null ? Math.round((evRadiant - evIntact) * 10) / 10 : null,
      outIntact: out(intact),
      outRadiant: out(radiant),
      byRefinement: Object.fromEntries(REFINEMENTS.filter((f) => group.byRefinement[f]).map((f) => [f, { ev: ev(group.byRefinement[f]), out: out(group.byRefinement[f]) }])),
      evDucatsIntact: Math.round(sum(rewards.map((r) => ((r.chance ?? 0) / 100) * (r.ducats ?? 0)))),
    });
  }
  return rows;
}

// ---------------------------------------------------------------- inventory (everything you own)

export type InventoryKind = "gear" | "part" | "relic" | "mod" | "arcane" | "resource" | "blueprint";

const KIND: Record<string, InventoryKind> = {
  frame: "gear",
  weapon: "gear",
  companion: "gear",
  prime_part: "part",
  relic: "relic",
  mod: "mod",
  arcane: "arcane",
  resource: "resource",
  blueprint: "blueprint",
};

export interface InventoryItem {
  /** One row per item, or per item and rank for mods and arcanes. */
  key: string;
  name: string;
  unique: string;
  kind: InventoryKind;
  /** "Warframe", "Primary"..., or the inventory's own category. */
  type: string;
  quantity: number;
  rank: number | null;
  maxRank: number | null;
  mastered: boolean;
  /** Each, at this rank where the market prices ranks. */
  price: number | null;
  ducats: number | null;
  worth: number | null;
  tradesPerDay: number | null;
  /** warframe.market's name for it ("Lith A1 Relic"), when it trades there. */
  marketName: string | null;
  /** Relics: the refinement as warframe.market spells it. */
  subtype: string | null;
}

const TYPE_NAME: Record<string, string> = { frame: "Warframe", weapon: "Weapon", companion: "Companion", prime_part: "Prime part", relic: "Relic", mod: "Mod", arcane: "Arcane", resource: "Resource", blueprint: "Blueprint" };

export function inventoryRows(m: Model): InventoryItem[] {
  const rows = new Map<string, InventoryItem>();
  for (const [unique, inv] of m.inventoryByBase) {
    for (const r of inv) {
      if (r.quantity <= 0) continue;
      // Genetic codes, Heartcells, adapters and the like are filed as gear but are consumables.
      const kind = KIND[r.category] === "gear" && NOT_GEAR.test(r.name) ? "resource" : KIND[r.category];
      if (!kind) continue;
      const ranked = kind === "mod" || kind === "arcane";
      const rank = ranked ? (r.rank ?? 0) : null;
      // TennoScope names some parts differently from the market and the Parts page ("Valkyr Prime
      // Systems" for the Systems Blueprint): use the part's own name so prices and spares line up.
      // A warframe part already built from its blueprint (…SystemsComponent) can't be traded.
      const built = kind === "part" && /Component$/.test(unique) && !/Blueprint$/.test(r.name);
      const canon = kind === "part" && !built ? m.nameOf(unique) : r.name;
      // Veiled rivens (…/Randomized/Raw…) and unveiled ones share a name in the game's data; the
      // market sells the veiled ones as "Rifle Riven Mod (Veiled)", the unveiled ones by auction.
      const veiled = kind === "mod" && /\/Randomized\/Raw/.test(unique);
      const name = kind === "part" && !built && m.partByName.has(canon) ? canon : veiled ? `${r.name} (Veiled)` : r.name;
      const key = `${kind}:${name}:${rank ?? ""}`;
      const have = rows.get(key);
      if (have) {
        have.quantity += r.quantity;
        have.worth = have.price == null ? null : have.price * have.quantity;
        continue;
      }
      const item = m.catalogByUnique.get(unique);
      const relic = kind === "relic" ? splitRelicName(name) : null;
      const maxRank = ranked ? (r.max_rank ?? item?.maxRank ?? null) : null;
      const atMax = maxRank != null && rank != null && rank >= maxRank && maxRank > 0;
      const tradeName = relic ? `${relic.base} Relic` : name;
      // A relic at its own refinement; the intact price stands in when that one isn't known.
      const price = built ? null : relic ? (m.relicPrice(relic.base, relic.refinement) ?? m.relicPrice(relic.base)) : atMax ? (m.priceMax(name) ?? m.price(name)) : m.price(name);
      const part = kind === "part" ? m.partByName.get(name)?.[0] : undefined;
      const tradable = (kind === "part" && !built) || kind === "relic" || ((kind === "mod" || kind === "arcane") && item?.tradable !== false) || price != null;
      rows.set(key, {
        key,
        name,
        unique,
        kind,
        type: built ? "Built part" : kind === "gear" ? (item?.category ? (MASTERY_CATEGORIES[item.category] ?? TYPE_NAME[r.category]) : TYPE_NAME[r.category]) : TYPE_NAME[r.category],
        quantity: r.quantity,
        rank,
        maxRank,
        mastered: kind === "gear" ? m.isMastered(unique) || r.mastered : false,
        price,
        ducats: part?.ducats ?? null,
        worth: price == null ? null : price * r.quantity,
        tradesPerDay: relic || built ? null : m.tradesPerDay(name),
        // Resources list only when warframe.market prices them (Heart Noctrul, fish, gems).
        marketName: tradable && kind !== "gear" && (kind !== "resource" || price != null) ? tradeName : null,
        subtype: relic ? relic.refinement.toLowerCase() : null,
      });
    }
  }
  return [...rows.values()];
}

/**
 * What you can spare of something warframe.market lists, by the same rules as the pages: a set kept
 * for anything unbuilt, two copies of each mod (your best and one to give away), one maxed arcane. Null: no rule, use what
 * you hold. `rank` is the rank to list at, when it matters.
 */
export function spareOf(m: Model, name: string, tags: string[] | null): { rank: number | null; quantity: number } | null {
  if (tags?.includes("set")) {
    const set = setRows(m).find((s) => `${s.name} Set` === name);
    return set ? { rank: null, quantity: set.sellable } : { rank: null, quantity: 0 };
  }
  const part = partRows(m).find((p) => p.name === name);
  if (part) return { rank: null, quantity: part.spare };
  if (tags?.includes("mod")) {
    const mod = modRows(m).find((r) => r.name === name);
    if (!mod) return null;
    const lowest = modSpares(mod.ranks).at(-1);
    return { rank: lowest?.rank ?? 0, quantity: lowest?.count ?? 0 };
  }
  if (tags?.includes("arcane_enhancement") || tags?.includes("arcane")) {
    const a = arcaneRows(m).find((r) => r.name === name);
    if (!a) return null;
    const loose = Math.min(a.unranked, a.spare);
    if (loose > 0) return { rank: 0, quantity: loose };
    return { rank: a.maxRank, quantity: a.extraMaxed };
  }
  return null;
}

// ---------------------------------------------------------------- in mission (EE.log)

const REFINEMENT_SUFFIX: Record<string, string> = { Bronze: "Intact", Silver: "Exceptional", Gold: "Flawless", Platinum: "Radiant" };
const TIER_ERA: Record<string, string> = { T1: "Lith", T2: "Meso", T3: "Neo", T4: "Axi", T5: "Requiem" };

export interface SquadRelic {
  path: string;
  name: string; // "Meso G7"
  refinement: string;
  known: boolean;
  status: "farmable" | "vaulted" | "resurgence";
  /** How many of this relic at this refinement you hold (one of them may be the one in play). */
  youOwn: number;
  /** Copies of this relic at other refinements. */
  ownOther: number;
  rewards: (RelicRewardRow & { chance: number })[];
  neededCount: number;
  ev: number | null;
}

export function squadRelics(m: Model, paths: string[]): SquadRelic[] {
  return paths.map((path) => {
    const suffix = path.match(/(Bronze|Silver|Gold|Platinum)$/)?.[1] ?? "Bronze";
    const refinement = REFINEMENT_SUFFIX[suffix];
    const entry = m.relicByUnique.get(path);
    const tier = path.match(/\/(T\d)VoidProjection/)?.[1] ?? "";
    // Varzia's resurgence relics ("...VaultA...") are sometimes missing from the relic data.
    const resurgenceRelic = /Vault[A-Z]?(Bronze|Silver|Gold|Platinum)$/.test(path);
    if (!entry) {
      return {
        path,
        name: `${TIER_ERA[tier] ?? "Unknown"} ${resurgenceRelic ? "Prime Resurgence " : ""}relic`,
        refinement,
        known: false,
        status: "vaulted",
        youOwn: 0,
        ownOther: 0,
        rewards: [],
        neededCount: 0,
        ev: null,
      };
    }
    const split = splitRelicName(entry.name);
    const base = split?.base ?? entry.name;
    const group = m.relicGroups.get(base);
    const youOwn = (m.inventoryByBase.get(path) ?? []).reduce((n, r) => n + r.quantity, 0);
    const rewards = entry.rewards.map((rw) => {
      const part = m.partByName.get(rw.name)?.[0];
      const have = m.partHave(rw.name);
      const parentDone = part ? m.isMastered(part.parentUnique) || m.owned(part.parentUnique) > 0 : null;
      return {
        name: rw.name,
        rarity: relicRewardRarity(refinement, rw.chance, rw.rarity),
        chance: rw.chance ?? 0,
        price: m.price(rw.name),
        ducats: part?.ducats ?? null,
        owned: have,
        needed: part ? !parentDone && have < part.required : false,
        parentMastered: part ? m.isMastered(part.parentUnique) : null,
      };
    });
    let ev: number | null = 0;
    for (const r of rewards) {
      if (r.price == null && m.partByName.has(r.name)) { ev = null; break; }
      ev += (r.chance / 100) * (r.price ?? 0);
    }
    return {
      path,
      name: base,
      refinement,
      known: true,
      // Resurgence only while Varzia actually stocks it; otherwise its vault flag decides.
      status: group?.resurgence ? "resurgence" : entry.vaulted ? "vaulted" : "farmable",
      youOwn,
      ownOther: Math.max(0, (m.ownedRelicCount.get(base) ?? 0) - youOwn),
      rewards,
      neededCount: rewards.filter((r) => r.needed).length,
      ev: ev == null ? null : Math.round(ev * 10) / 10,
    };
  });
}

/** Every reward the squad's relics can give, best platinum first, duplicates merged. */
export function squadPool(relics: SquadRelic[]) {
  const pool = new Map<string, RelicRewardRow & { from: string[] }>();
  for (const r of relics) {
    for (const rw of r.rewards) {
      const e = pool.get(rw.name);
      if (e) e.from.push(`${r.name} ${r.refinement[0]}`);
      else pool.set(rw.name, { ...rw, from: [`${r.name} ${r.refinement[0]}`] });
    }
  }
  return [...pool.values()].sort((a, b) => Number(b.needed) - Number(a.needed) || (b.price ?? -1) - (a.price ?? -1));
}

export { baseId };
