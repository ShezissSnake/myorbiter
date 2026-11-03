// Your wishlist (the items you starred), and how to get each missing part fastest: crack a relic
// you hold (and whether its era has a fissure open right now), farm a relic that still drops, buy
// the part, or Varzia. Also the odds of finishing an item from the relics you already hold.
import { collectionItem, type CollectionItem } from "./collection";
import { researchedStep, vendorBlueprint } from "./acquire";
import { REFINEMENTS, splitRelicName, type Model, type Refinement } from "./model";
import type { Fissure } from "./types";

export interface RelicChance {
  base: string;
  era: string;
  /** Copies you hold, by refinement. */
  owned: Partial<Record<Refinement, number>>;
  total: number;
  /** Chance per crack of your best copy (percent). */
  best: number;
  bestRefinement: Refinement;
  vaulted: boolean;
  resurgence: boolean;
  rarity: string;
}

export interface FarmSpot {
  relic: string;
  location: string;
  chance: number;
}

export interface WantedPart {
  name: string;
  label: string;
  image: string | null;
  required: number;
  have: number;
  building: boolean;
  price: number | null;
  /** Relics you hold that drop it, best chance first. */
  yours: RelicChance[];
  /** Relics that still drop it but you don't hold, and where to farm them. */
  farm: FarmSpot[];
  /** Every relic for it is vaulted (and none of yours drop it): buy it, or wait for Varzia. */
  vaulted: boolean;
  resurgence: boolean;
  /** Chance of the copies still needed from cracking every relic you hold for it once (0..1). */
  odds: number;
  /** For parts that don't come from relics: where they drop (bosses, bounties…), best first. */
  drops: { location: string; chance: number }[];
  /** A part with no drops at all (a vendor's blueprint: a kitgun chamber's, a K-Drive board's): where to get it, researched. */
  how: string | null;
}

export interface WishItem {
  c: CollectionItem;
  missing: WantedPart[];
  /** Chance of every missing part from the relics you hold (0..1); null when nothing's missing. */
  odds: number | null;
  /** Buying the missing parts at the daily median. */
  buyCost: number | null;
}

const ownedCache = new WeakMap<Model, Map<string, Partial<Record<Refinement, number>>>>();
function ownedByRefinement(m: Model) {
  let out = ownedCache.get(m);
  if (out) return out;
  out = new Map();
  for (const rows of m.inventoryByBase.values()) {
    for (const r of rows) {
      if (r.category !== "relic" || r.quantity <= 0) continue;
      const split = splitRelicName(r.name);
      if (!split) continue;
      const e = out.get(split.base) ?? {};
      e[split.refinement] = (e[split.refinement] ?? 0) + r.quantity;
      out.set(split.base, e);
    }
  }
  ownedCache.set(m, out);
  return out;
}

/** A reward's chance (percent) from one relic at one refinement. */
function chanceAt(m: Model, base: string, ref: Refinement, reward: string): number {
  const g = m.relicGroups.get(base);
  const entry = g?.byRefinement[ref] ?? g?.byRefinement.Intact;
  return entry?.rewards.find((r) => r.name === reward)?.chance ?? 0;
}

/** The relics you hold that drop a part, with the chance of your best copy. */
export function relicsFor(m: Model, part: string): RelicChance[] {
  const owned = ownedByRefinement(m);
  const out: RelicChance[] = [];
  for (const s of m.sourcesByReward.get(part) ?? []) {
    const o = owned.get(s.base);
    if (!o) continue;
    let best = 0;
    let bestRefinement: Refinement = "Intact";
    for (const ref of REFINEMENTS) {
      if (!o[ref]) continue;
      const c = chanceAt(m, s.base, ref, part);
      if (c > best) {
        best = c;
        bestRefinement = ref;
      }
    }
    out.push({ base: s.base, era: s.base.split(" ")[0], owned: o, total: Object.values(o).reduce((a, b) => a + (b ?? 0), 0), best, bestRefinement, vaulted: s.vaulted, resurgence: s.resurgence, rarity: s.rarity });
  }
  return out.sort((a, b) => b.best - a.best || b.total - a.total);
}

/** The most copies of one relic at one refinement finishOdds counts. */
export const ODDS_COPIES = 200;

/**
 * Chance that cracking every relic you hold for these parts, each copy once, gives every copy you
 * need. Worked out exactly: one crack gives one reward, so a relic that drops two of the parts can
 * only give one of them, and a part needed twice needs two cracks to land.
 */
export function finishOdds(m: Model, parts: { name: string; need: number }[]): number {
  const want = parts.filter((p) => p.need > 0);
  if (!want.length) return 1;
  const owned = ownedByRefinement(m);
  // Each copy you hold, as its chance (0..1) of giving each wanted part.
  const copies: number[][] = [];
  const bases = new Set(want.flatMap((p) => (m.sourcesByReward.get(p.name) ?? []).map((s) => s.base)));
  for (const base of bases) {
    const o = owned.get(base);
    if (!o) continue;
    for (const ref of REFINEMENTS) {
      const n = o[ref] ?? 0;
      const odds = want.map((p) => chanceAt(m, base, ref, p.name) / 100);
      // Past a couple of hundred copies of one relic the chance has levelled off, and a count
      // that big (a bad read) would otherwise build an array too long to make.
      if (n && odds.some((x) => x > 0)) for (let i = 0; i < Math.min(n, ODDS_COPIES); i++) copies.push(odds);
    }
  }
  // Probability of each "copies still needed" state, crack by crack.
  let dist = new Map<string, number>([[want.map((p) => p.need).join(","), 1]]);
  for (const odds of copies) {
    const next = new Map<string, number>();
    const add = (k: string, p: number) => next.set(k, (next.get(k) ?? 0) + p);
    for (const [k, pr] of dist) {
      const rem = k.split(",").map(Number);
      let stay = 1;
      rem.forEach((r, i) => {
        if (r <= 0 || !odds[i]) return;
        const moved = [...rem];
        moved[i]--;
        add(moved.join(","), pr * odds[i]);
        stay -= odds[i];
      });
      add(k, pr * stay);
    }
    dist = next;
  }
  return dist.get(want.map(() => 0).join(",")) ?? 0;
}

/**
 * How easy the parts a set is missing are to get by cracking relics: the chance the relics you hold
 * give them all (each copy cracked once, finishOdds), and about how many cracks it takes, each part
 * at the best chance you can crack for it (your best copy, or an intact relic that still drops or
 * Varzia sells). Cracks is null when some part comes from no relic you can crack.
 */
export function finishEase(m: Model, missing: { name: string; count: number }[]): { odds: number; cracks: number | null } {
  const odds = finishOdds(m, missing.map((x) => ({ name: x.name, need: x.count })));
  let cracks = 0;
  for (const x of missing) {
    const yours = relicsFor(m, x.name)[0]?.best ?? 0;
    const farm = Math.max(0, ...(m.sourcesByReward.get(x.name) ?? []).filter((s) => !s.vaulted || s.resurgence).map((s) => s.chanceIntact));
    const p = Math.max(yours, farm) / 100;
    if (!(p > 0)) return { odds, cracks: null };
    cracks += x.count / p;
  }
  return { odds, cracks: Math.ceil(cracks) };
}

/** Chance of `need` copies of a part from the relics you hold, cracking each once. */
export const partOdds = (m: Model, part: string, need = 1) => finishOdds(m, [{ name: part, need }]);

/** Where to farm the relics for a part that still drop: the best few spots. */
export function farmFor(m: Model, part: string, limit = 3): FarmSpot[] {
  const owned = ownedByRefinement(m);
  const spots: FarmSpot[] = [];
  for (const s of m.sourcesByReward.get(part) ?? []) {
    if (s.vaulted || owned.has(s.base)) continue;
    const entry = m.relicGroups.get(s.base)?.byRefinement.Intact;
    for (const d of entry?.drops ?? []) spots.push({ relic: s.base, location: d.location, chance: d.chance });
  }
  // One line per place: the relic that drops best there.
  const byPlace = new Map<string, FarmSpot>();
  for (const sp of spots.sort((a, b) => b.chance - a.chance)) if (!byPlace.has(sp.location)) byPlace.set(sp.location, sp);
  return [...byPlace.values()].slice(0, limit);
}

/** Where a part that isn't from relics drops: each place once (its rotations as one, at the best chance), best first. */
export function dropSpots(drops: { location: string; chance: number }[], limit = 3): { location: string; chance: number }[] {
  const best = new Map<string, number>();
  for (const d of drops) {
    const location = d.location.replace(/,\s*Rotation [ABC]$/, "");
    best.set(location, Math.max(best.get(location) ?? 0, d.chance));
  }
  return [...best].map(([location, chance]) => ({ location, chance })).sort((a, b) => b.chance - a.chance).slice(0, limit);
}

export function wishItem(m: Model, unique: string): WishItem | null {
  const item = m.catalogByUnique.get(unique);
  if (!item) return null;
  const c = collectionItem(m, item);
  const missing: WantedPart[] = [];
  // A modular part in hand or built: nothing left to collect, only to assemble, gild or level.
  if (!c.owned && !c.mastered && !c.building && !c.step && !c.partBuilt) {
    // A vendor's blueprint (a zaw strike's at Hok) says where to buy it, never Conclave's twin's drops.
    const vendor = vendorBlueprint(item.name, unique);
    for (const p of c.parts) {
      if (p.resource || p.have >= p.required || p.building) continue;
      const sources = m.sourcesByReward.get(p.name) ?? [];
      missing.push({
        name: p.name,
        label: p.label,
        image: p.image,
        required: p.required,
        have: p.have,
        building: p.building,
        price: p.price,
        yours: relicsFor(m, p.name),
        farm: farmFor(m, p.name),
        vaulted: sources.length > 0 && sources.every((s) => s.vaulted),
        resurgence: sources.some((s) => s.resurgence) || m.inResurgence(unique),
        odds: partOdds(m, p.name, p.required - p.have),
        drops: sources.length || (vendor && p.label === "Blueprint") ? [] : dropSpots(item.components?.find((x) => x.name === p.label)?.drops ?? []),
        how: null,
      });
      const last = missing[missing.length - 1];
      if (!sources.length && !last.drops.length && p.label === "Blueprint") last.how = vendor?.step ?? researchedStep(item.name);
    }
  }
  const relicParts = missing.filter((p) => (m.sourcesByReward.get(p.name) ?? []).length);
  // Only meaningful when every missing part comes from relics.
  const odds = missing.length && relicParts.length === missing.length ? finishOdds(m, missing.map((p) => ({ name: p.name, need: p.required - p.have }))) : null;
  const prices = missing.map((p) => (p.price == null ? null : p.price * (p.required - p.have)));
  return { c, missing, odds, buyCost: missing.length && prices.every((x) => x != null) ? Math.round(prices.reduce((a: number, b) => a + (b ?? 0), 0)) : null };
}

/** Open fissures by era (normal and Steel Path; Omnia takes any relic but a Requiem one). */
export function openEras(fissures: Fissure[] | null, now = Date.now()): Record<string, Fissure[]> {
  const out: Record<string, Fissure[]> = {};
  for (const f of fissures ?? []) {
    if (f.isStorm || Date.parse(f.expiry) <= now) continue;
    (out[f.tier] ??= []).push(f);
  }
  return out;
}

/** The relics you hold for a wished-for item whose era has a fissure open now (an Omnia one takes any but Requiem). */
export function crackableNow(w: WishItem, open: Record<string, Fissure[]>): string[] {
  const isOpen = (era: string) => (open[era]?.length ?? 0) + (era === "Requiem" ? 0 : (open.Omnia?.length ?? 0)) > 0;
  return [...new Set(w.missing.flatMap((p) => p.yours.filter((r) => isOpen(r.era)).map((r) => r.base)))];
}

/** Your wishlist with what you can crack a relic for right now first; otherwise in the order you starred them. */
export function crackableFirst(ws: WishItem[], open: Record<string, Fissure[]>): WishItem[] {
  const now = ws.filter((w) => crackableNow(w, open).length);
  return [...now, ...ws.filter((w) => !now.includes(w))];
}

/** The relics you hold for your wishlist, by era: what an open fissure of that era lets you crack. */
export function wishlistEras(m: Model, uniques: string[]): Map<string, { relic: string; part: string; item: string }[]> {
  const out = new Map<string, { relic: string; part: string; item: string }[]>();
  for (const u of uniques) {
    const w = wishItem(m, u);
    if (!w) continue;
    for (const p of w.missing) {
      for (const r of p.yours) {
        const list = out.get(r.era) ?? [];
        if (!list.some((x) => x.relic === r.base && x.part === p.name)) list.push({ relic: r.base, part: p.name, item: w.c.name });
        out.set(r.era, list);
      }
    }
  }
  return out;
}

/** The relics you hold for your wishlist, by relic: the parts each could give, and for what. */
export function wishlistRelics(m: Model, uniques: string[]): Map<string, { part: string; item: string }[]> {
  const out = new Map<string, { part: string; item: string }[]>();
  for (const list of wishlistEras(m, uniques).values()) {
    for (const x of list) out.set(x.relic, [...(out.get(x.relic) ?? []), { part: x.part, item: x.item }]);
  }
  return out;
}
