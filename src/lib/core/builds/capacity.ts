// Mod capacity, and the tier a build needs.
//
// The tiers are player progression (defined 3 Nov), with the internal ids kept:
// - low, "New player": no Orokin Catalyst or Reactor, no Forma, no Exilus Adapter, no Archon
//   shards, no arcanes, no Helminth, and only "new" mods (availability.ts).
// - medium, "Intermediate": a Catalyst or Reactor, the Exilus Adapter, regular Forma (no Umbra
//   Forma), the Helminth, and "intermediate" mods and arcanes (Corrupted, augments, Lua and
//   spy-vault mods, easy arcanes). No shards, no Primed, Archon or Umbral mods.
// - high, "Veteran": everything (an Arcane Adapter for a weapon too: Steel Path Honors sells them).
// tierOf returns the lowest tier whose rules the build meets, with a reason for each thing that
// lifted it above New player; the capacity facts (rank, drain, Forma plan, slots) stay as they were,
// with `capacityTier` for what capacity alone needs (fits as is, with a doubler, or with Forma).
//
// Capacity:
//
// The rules (as researched on 3 Nov):
// - Capacity is the item's rank: 30; 40 for Necramechs; Kuva, Tenet and Coda weapons and
//   Paracesis gain two ranks a Forma, to 40 at five. An Orokin Catalyst (weapons) or Reactor
//   (frames, companions, archwings, Necramechs) doubles it.
// - A mod drains its base drain plus its rank. In a slot of its polarity it drains half, rounded
//   up; in a slot of another polarity 25% more, rounded up. No polarity on either: as listed.
// - An aura (or stance) adds its drain's size plus its rank: twice that on its own polarity, 20%
//   less on another (rounded down here: MyOrbiter would rather say a build doesn't fit than that it
//   does). Unverified: no source found gives the rounding for this one. The aura slot's polarity is
//   the catalog's `aura`, the stance slot's its `stancePolarity` (none when the weapon has none).
// - Omni ("universal") matches every mod but Umbra ones. Umbra slots come only from Umbra Forma
//   (warframes); a non-Umbra mod in one is counted as mismatched (unverified, the cautious reading).
// - The exilus slot needs an adapter and drains like any slot. Arcanes, shards and Helminth take
//   no capacity.
//
// Which physical slot carries an innate polarity isn't in the catalog, only how many of each; mods
// can go in any slot, so only the counts matter. Slot numbers in the reasons are the build's own
// order (its first mod is slot 1).

import type { CatalogItem } from "../types";
import { arcaneNeedsAdapter, doublerName, doublerShort, FORTY_BY_FORMA, rankWith, slotLayout } from "./gear";
import { polarityOf, POLARITY_LABEL, POLARITY_SYMBOL, type Build, type BuildMod, type GearKind, type Polarity } from "./types";
import { AVAILABILITY_LABEL, availability, availabilityRank, hardDonorOf, type Availability } from "./availability";

export type Tier = "low" | "medium" | "high";
export const TIERS: Tier[] = ["low", "medium", "high"];
/** The tiers' names: player progression. */
export const TIER_LABEL: Record<Tier, string> = { low: "New player", medium: "Intermediate", high: "Veteran" };
/** What capacity alone needs, in the old words (TierResult.capacityTier). */
export const CAPACITY_LABEL: Record<Tier, string> = { low: "No Catalyst", medium: "Catalyst", high: "Catalyst, Forma and adapters" };
/** A tier and the availability level it allows. */
export const TIER_AVAILABILITY: Record<Tier, Availability> = { low: "new", medium: "intermediate", high: "veteran" };
export const tierOfAvailability = (a: Availability): Tier => (a === "new" ? "low" : a === "intermediate" ? "medium" : "high");
const TIER_RANK: Record<Tier, number> = { low: 0, medium: 1, high: 2 };

/** One thing that lifts a build above New player, and the tier it needs. */
export interface TierLimit {
  kind: "mod" | "arcane" | "doubler" | "forma" | "umbraForma" | "exilusAdapter" | "arcaneAdapter" | "shards" | "helminth";
  tier: Tier;
  /** What it is: a mod's name, "an Orokin Reactor", "2 Forma". */
  what: string;
  /** Why it needs that tier ("Primed, from Baro Ki'Teer"). */
  why: string;
  path?: string;
  source?: string;
}

/** Where a Forma goes: a mod slot (the build's 1-based order), the aura, exilus or stance slot, or any slot just for rank. */
export type SlotRef = number | "aura" | "exilus" | "stance" | "any";

export interface FormaStep {
  slot: SlotRef;
  polarity: Polarity | null;
  /** The mod it's for (null for a Forma taken only for the two ranks). */
  mod: string | null;
  /** Capacity it frees or adds. */
  gain: number;
  umbra: boolean;
}

export interface SlotDrain {
  slot: SlotRef;
  path: string;
  name: string;
  /** Its slot's polarity under this plan. */
  polarity: Polarity | null;
  /** Drain (negative for the capacity an aura or stance adds). */
  drain: number;
}

export interface TierResult {
  /** The lowest tier whose rules the build meets (player progression). */
  tier: Tier;
  /** What capacity alone needs: low fits as is, medium with a Catalyst/Reactor, high with Forma or adapters. */
  capacityTier: Tier;
  /** Everything that lifts the build above New player, the highest first. */
  limits: TierLimit[];
  /** False when even the high tier doesn't fit: `reasons` says by how much. */
  fits: boolean;
  /** The rank (base capacity) counted. */
  rank: number;
  /** Rank doubled or not, plus the aura and stance. */
  capacity: number;
  drain: number;
  catalyst: boolean;
  /** Forma, Umbra Forma among them. */
  forma: number;
  umbraForma: number;
  formaPlan: FormaStep[];
  exilusAdapter: boolean;
  arcaneAdapter: boolean;
  /** Each slot as this tier has it. */
  slots: SlotDrain[];
  /** Why: the tier's reasons ("Uses Primed Flow (Primed, from Baro Ki'Teer), which is Veteran."), then capacity's. */
  reasons: string[];
  /** Mods in the build MyOrbiter doesn't know (left out of the count). */
  unknown: string[];
}

/** A mod's drain in a slot of `slot` polarity (null: none). */
export function drainIn(cost: number, mod: Polarity | null, slot: Polarity | null): number {
  if (!slot || !mod || mod === "universal") return cost;
  return matches(mod, slot) ? Math.ceil(cost / 2) : Math.ceil(cost * 1.25);
}

/** The capacity an aura or stance adds in a slot of `slot` polarity. */
export function bonusIn(size: number, mod: Polarity | null, slot: Polarity | null): number {
  if (!slot || !mod || mod === "universal") return size;
  return matches(mod, slot) ? size * 2 : Math.floor(size * 0.8);
}

/** Whether a slot's polarity counts as the mod's. */
export function matches(mod: Polarity, slot: Polarity): boolean {
  return mod === slot || (slot === "universal" && mod !== "umbra");
}

interface Piece {
  /** The build's slot: 0-based mod index, or aura/exilus/stance. */
  at: number | "aura" | "exilus" | "stance";
  path: string;
  name: string;
  pol: Polarity | null;
  /** Base drain plus rank (for an aura or stance: the capacity it adds). */
  cost: number;
}

/** A build mod against the catalog: what it costs at its rank. Null when the catalog doesn't know it. */
function pieceOf(m: BuildMod, at: Piece["at"], catalog: ReadonlyMap<string, CatalogItem>): Piece | null {
  const c = catalog.get(m.path);
  if (!c || c.baseDrain == null) return null;
  const max = c.maxRank ?? 0;
  const rank = Math.max(0, Math.min(max, m.rank ?? max));
  return { at, path: m.path, name: c.name, pol: polarityOf(c.polarity), cost: Math.abs(c.baseDrain) + rank };
}

/**
 * Mods into slots of these polarities so they drain least: each on its own polarity first (the
 * costliest first), mods without a polarity into polarized slots nobody matches, then the rest
 * into blank slots (costliest first), and only then into mismatched ones.
 */
function assign(slotPols: (Polarity | null)[], mods: Piece[]): { pol: Polarity | null; mod: Piece | null }[] {
  const slots = slotPols.map((pol) => ({ pol, mod: null as Piece | null }));
  const free = (f: (s: (typeof slots)[number]) => boolean) => slots.find((s) => !s.mod && f(s));
  const sorted = [...mods].sort((a, b) => b.cost - a.cost);
  const rest: Piece[] = [];
  for (const m of sorted) {
    if (!m.pol || m.pol === "universal") {
      rest.push(m);
      continue;
    }
    const s = free((s) => s.pol === m.pol) ?? free((s) => s.pol === "universal" && m.pol !== "umbra");
    if (s) s.mod = m;
    else rest.push(m);
  }
  const neutral = rest.filter((m) => !m.pol || m.pol === "universal");
  const polar = rest.filter((m) => m.pol && m.pol !== "universal");
  for (const m of neutral) (free((s) => !!s.pol) ?? free(() => true))!.mod = m;
  for (const m of polar) (free((s) => !s.pol) ?? free(() => true))!.mod = m;
  return slots;
}

interface Plan {
  slotPols: (Polarity | null)[];
  aura: Polarity | null;
  exilus: Polarity | null;
  stance: Polarity | null;
  forma: FormaStep[];
}

function evaluate(plan: Plan, pieces: { mods: Piece[]; aura: Piece | null; exilus: Piece | null; stance: Piece | null }, base: number) {
  const slots = assign(plan.slotPols, pieces.mods);
  let drain = 0;
  const out: SlotDrain[] = [];
  for (const s of slots) {
    if (!s.mod) continue;
    const d = drainIn(s.mod.cost, s.mod.pol, s.pol);
    drain += d;
    out.push({ slot: (s.mod.at as number) + 1, path: s.mod.path, name: s.mod.name, polarity: s.pol, drain: d });
  }
  if (pieces.exilus) {
    const d = drainIn(pieces.exilus.cost, pieces.exilus.pol, plan.exilus);
    drain += d;
    out.push({ slot: "exilus", path: pieces.exilus.path, name: pieces.exilus.name, polarity: plan.exilus, drain: d });
  }
  let capacity = base;
  for (const k of ["aura", "stance"] as const) {
    const p = pieces[k];
    if (!p) continue;
    const b = bonusIn(p.cost, p.pol, plan[k]);
    capacity += b;
    out.push({ slot: k, path: p.path, name: p.name, polarity: plan[k], drain: -b });
  }
  out.sort((a, b) => order(a.slot) - order(b.slot));
  return { slots, drain, capacity, out };
}
const order = (s: SlotRef) => (s === "aura" ? -2 : s === "stance" ? -1 : s === "exilus" ? 99 : s === "any" ? 100 : s);

const polWord = (p: Polarity) => `${POLARITY_LABEL[p]} (${POLARITY_SYMBOL[p]})`;
const slotWord = (s: SlotRef) => (s === "any" ? "any slot" : typeof s === "number" ? `slot ${s}` : `the ${s} slot`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What capacity alone needs: TierResult without the progression part (tier is capacityTier). */
export type CapacityResult = Omit<TierResult, "capacityTier" | "limits">;

/**
 * What capacity alone needs on an item, and why: low (fits without a Catalyst/Reactor), medium
 * (needs one), high (Catalyst plus the fewest Forma, worked out greedily by capacity freed, and
 * adapters). `catalog`: the model's catalogByUnique. `kind` defaults to the build's.
 */
export function capacityOf(build: Build, item: CatalogItem, catalog: ReadonlyMap<string, CatalogItem>, kind: GearKind = build.kind): CapacityResult {
  const layout = slotLayout(kind);
  const unknown: string[] = [];
  const piece = (m: BuildMod | null | undefined, at: Piece["at"]) => {
    if (!m) return null;
    const p = pieceOf(m, at, catalog);
    if (!p) unknown.push(m.path);
    return p;
  };
  const mods = build.mods.slice(0, layout.mods).map((m, i) => piece(m, i)).filter((p): p is Piece => !!p);
  const pieces = {
    mods,
    aura: layout.aura ? piece(build.aura, "aura") : null,
    exilus: piece(build.exilus, "exilus"),
    stance: layout.stance ? piece(build.stance, "stance") : null,
  };
  const innate = (item.polarities ?? []).map(polarityOf).slice(0, layout.mods);
  const startPlan: Plan = {
    slotPols: Array.from({ length: Math.max(layout.mods, mods.length) }, (_, i) => innate[i] ?? null),
    aura: polarityOf(Array.isArray(item.aura) ? item.aura[0] : item.aura),
    exilus: polarityOf(item.exilusPolarity),
    // The weapon's own stance polarity (the catalog's `stancePolarity`); none when it has none.
    stance: polarityOf(item.stancePolarity),
    forma: [],
  };
  const exilusAdapter = !!build.exilus;
  const arcaneAdapter = build.arcanes.length > 0 && arcaneNeedsAdapter(item, kind);
  const fortyByForma = kind !== "necramech" && FORTY_BY_FORMA(item.name);
  const doubler = doublerName(kind);

  const reasonsFor = (r: Omit<CapacityResult, "reasons" | "tier">, tier: Tier): string[] => {
    const out: string[] = [];
    // "with the Steel Charge aura on its Madurai slot": what the aura or stance adds, doubled on its own polarity.
    const bonusPart = (k: "aura" | "stance") => {
      const p = pieces[k];
      const pol = r.slots.find((x) => x.slot === k)?.polarity ?? null;
      return p ? `the ${p.name} ${k}${pol && p.pol && matches(p.pol, pol) ? ` on its ${POLARITY_LABEL[pol]} slot` : ""}` : "";
    };
    const bonuses = [bonusPart("aura"), bonusPart("stance")].filter(Boolean);
    const auraPart = bonuses.length ? ` with ${bonuses.join(" and ")}` : "";
    const adapters = [r.exilusAdapter ? "an Exilus Adapter" : "", r.arcaneAdapter ? `an Arcane Adapter (${kind === "melee" ? "Melee" : kind === "archgun" ? "Archgun" : kind === "secondary" ? "Secondary" : "Primary"})` : ""].filter(Boolean);
    if (tier === "low") out.push(`Fits in ${r.rank}${auraPart}: drain ${r.drain} of ${r.capacity}.`);
    else if (tier === "medium") out.push(`Needs ${doubler}: drain ${r.drain}, capacity ${r.capacity - r.rank} without it and ${r.capacity} with it${auraPart}.`);
    else {
      const needs = [r.catalyst ? doubler : "", r.forma ? plural(r.forma, "Forma", "Forma") : "", ...adapters].filter(Boolean);
      const list = needs.length > 1 ? `${needs.slice(0, -1).join(", ")} and ${needs[needs.length - 1]}` : needs[0] ?? "nothing more";
      out.push(r.fits ? `Needs ${list}.` : `Doesn't fit even with ${list}: drain ${r.drain} of ${r.capacity}, ${r.drain - r.capacity} over.`);
      if (r.formaPlan.length) {
        // One line per polarity: "Madurai (V) for Serration (slot 2), Split Chamber (slot 5)".
        const by = new Map<string, FormaStep[]>();
        for (const f of r.formaPlan) {
          const k = f.polarity ? polWord(f.polarity) : "Forma for rank";
          by.set(k, [...(by.get(k) ?? []), f]);
        }
        const parts = [...by].map(([k, fs]) => (k === "Forma for rank" ? `${plural(fs.length, "Forma")} only for the two ranks each (${slotWord("any")})` : `${k} for ${fs.map((f) => (f.mod ? `${f.mod} (${slotWord(f.slot)})` : slotWord(f.slot))).join(", ")}`));
        out.push(`Forma: ${parts.join("; ")}.`);
      }
      if (r.umbraForma) out.push(r.umbraForma === 1 ? "One of them is an Umbra Forma." : `${r.umbraForma} of them are Umbra Forma.`);
    }
    if (fortyByForma) out.push(`Rank 40 needs five Forma (two ranks each): ${r.rank} counted.`);
    if (layout.stance && pieces.stance && item.stancePolarity == null) out.push("The stance slot's own polarity isn't in MyOrbiter's data: counted as none.");
    if (unknown.length) out.push(`${plural(unknown.length, "mod")} MyOrbiter doesn't know left out of the count.`);
    return out;
  };

  const at = (catalyst: boolean, plan: Plan) => {
    const formaN = plan.forma.length;
    const rank = rankWith(item, kind, fortyByForma ? formaN : 0);
    const e = evaluate(plan, pieces, rank * (catalyst ? 2 : 1));
    return { e, rank };
  };
  const result = (tier: Tier, catalyst: boolean, plan: Plan, withAdapters: boolean): CapacityResult => {
    const { e, rank } = at(catalyst, plan);
    const r = {
      fits: e.drain <= e.capacity,
      rank,
      capacity: e.capacity,
      drain: e.drain,
      catalyst,
      forma: plan.forma.length,
      umbraForma: plan.forma.filter((f) => f.umbra).length,
      formaPlan: plan.forma,
      exilusAdapter: withAdapters && exilusAdapter,
      arcaneAdapter: withAdapters && arcaneAdapter,
      slots: e.out,
      unknown,
    };
    return { tier, ...r, reasons: reasonsFor(r, tier) };
  };

  // Without the Catalyst, then with it, before any Forma. Adapters make it high whatever it takes.
  const adapters = exilusAdapter || arcaneAdapter;
  for (const catalyst of [false, true]) {
    const { e } = at(catalyst, startPlan);
    if (e.drain <= e.capacity) return result(adapters ? "high" : catalyst ? "medium" : "low", catalyst, startPlan, adapters);
  }

  // High: the Catalyst, then Forma one at a time, each where it frees the most.
  let plan = startPlan;
  for (let n = 0; n < 24; n++) {
    const { e } = at(true, plan);
    if (e.drain <= e.capacity) break;
    const rankGain = fortyByForma && plan.forma.length < 5 ? 4 : 0;
    const options: { plan: Plan; gain: number }[] = [];
    // A mod slot to its mod's polarity.
    e.slots.forEach((s, i) => {
      const m = s.mod;
      if (!m || !m.pol || m.pol === "universal" || (s.pol && matches(m.pol, s.pol))) return;
      if (m.pol === "umbra" && kind !== "warframe") return;
      const gain = drainIn(m.cost, m.pol, s.pol) - Math.ceil(m.cost / 2) + rankGain;
      const slotPols = [...plan.slotPols];
      slotPols[i] = m.pol;
      options.push({ plan: { ...plan, slotPols, forma: [...plan.forma, { slot: (m.at as number) + 1, polarity: m.pol, mod: m.name, gain, umbra: m.pol === "umbra" }] }, gain });
    });
    // The exilus slot to its mod's polarity.
    const x = pieces.exilus;
    if (x?.pol && x.pol !== "universal" && x.pol !== "umbra" && !(plan.exilus && matches(x.pol, plan.exilus))) {
      const gain = drainIn(x.cost, x.pol, plan.exilus) - Math.ceil(x.cost / 2) + rankGain;
      options.push({ plan: { ...plan, exilus: x.pol, forma: [...plan.forma, { slot: "exilus", polarity: x.pol, mod: x.name, gain, umbra: false }] }, gain });
    }
    // The aura or stance slot to its mod's polarity.
    for (const k of ["aura", "stance"] as const) {
      const p = pieces[k];
      const now = plan[k];
      if (!p?.pol || p.pol === "universal" || p.pol === "umbra" || (now && matches(p.pol, now))) continue;
      const gain = p.cost * 2 - bonusIn(p.cost, p.pol, now) + rankGain;
      options.push({ plan: { ...plan, [k]: p.pol, forma: [...plan.forma, { slot: k, polarity: p.pol, mod: p.name, gain, umbra: false }] }, gain });
    }
    // Nothing left to match: a Forma for its two ranks (Kuva, Tenet, Coda, Paracesis).
    if (!options.length && rankGain) options.push({ plan: { ...plan, forma: [...plan.forma, { slot: "any", polarity: null, mod: null, gain: rankGain, umbra: false }] }, gain: rankGain });
    // The biggest gain; on a tie, the first found.
    const best = options.filter((o) => o.gain > 0).sort((a, b) => b.gain - a.gain)[0];
    if (!best) break;
    plan = best.plan;
  }
  return result("high", true, plan, true);
}

// ---------------------------------------------------------------- the progression tier

const a = (n: number, one: string, many = `${one}s`) => (n === 1 ? `a${/^[AEIOU]/.test(one) ? "n" : ""} ${one}` : `${n} ${many}`);

/**
 * The tier a build needs: the lowest one whose rules it meets (see the top of this file), from what
 * capacity needs and from each mod's and arcane's availability. `catalog`: the model's
 * catalogByUnique. `kind` defaults to the build's.
 */
export function tierOf(build: Build, item: CatalogItem, catalog: ReadonlyMap<string, CatalogItem>, kind: GearKind = build.kind): TierResult {
  const cap = capacityOf(build, item, catalog, kind);
  const limits: TierLimit[] = [];
  const add = (l: TierLimit) => limits.push(l);
  const doubler = doublerName(kind);

  // Capacity: a doubler or regular Forma are Intermediate, Umbra Forma Veteran.
  if (cap.catalyst) add({ kind: "doubler", tier: "medium", what: doubler, why: `drain ${cap.drain} is over the ${cap.rank} it has without one` });
  const plain = cap.forma - cap.umbraForma;
  if (plain > 0) add({ kind: "forma", tier: "medium", what: a(plain, "Forma", "Forma"), why: "to fit the mods" });
  if (cap.umbraForma > 0) add({ kind: "umbraForma", tier: "high", what: a(cap.umbraForma, "Umbra Forma", "Umbra Forma"), why: "for its Umbral mods" });
  if (build.exilus) add({ kind: "exilusAdapter", tier: "medium", what: "an Exilus Adapter", why: "for its exilus mod" });
  if (cap.arcaneAdapter) add({ kind: "arcaneAdapter", tier: "high", what: "an Arcane Adapter", why: "Steel Path Honors sells them", source: "https://wiki.warframe.com/w/The_Steel_Path" });

  // Mods and arcanes by availability.
  const seen = new Set<string>();
  const each = (m: BuildMod | null | undefined, kind2: "mod" | "arcane") => {
    if (!m || seen.has(m.path)) return;
    seen.add(m.path);
    const c = catalog.get(m.path);
    if (!c) return;
    const av = availability(c);
    if (av.level === "new") return;
    add({ kind: kind2, tier: tierOfAvailability(av.level), what: c.name, why: av.why, path: m.path, ...(av.source ? { source: av.source } : {}) });
  };
  for (const m of [build.aura, build.stance, ...build.mods, build.exilus]) each(m, "mod");
  for (const m of build.arcanes) each(m, "arcane");

  // Shards (Veteran: Archon hunts), the Helminth (Intermediate; a hard donor's ability Veteran).
  if (build.shards.length) add({ kind: "shards", tier: "high", what: a(build.shards.length, "Archon Shard"), why: "Archon shards come from Archon hunts" });
  if (build.helminth) {
    const hard = hardDonorOf(build.helminth.ability);
    if (hard) add({ kind: "helminth", tier: "high", what: `${build.helminth.ability} on the Helminth`, why: `it comes from ${hard.frame}: ${hard.why}`, source: hard.source });
    else add({ kind: "helminth", tier: "medium", what: "the Helminth", why: "Heart of Deimos, then the Helminth segment from Son at Entrati rank 3", source: "https://www.highgroundgaming.com/warframe-helminth/" });
  }

  limits.sort((x, y) => TIER_RANK[y.tier] - TIER_RANK[x.tier]);
  const tier: Tier = !cap.fits ? "high" : limits[0]?.tier ?? "low";
  const lead =
    limits.length === 0 ? [`${TIER_LABEL.low}: basic mods only, and it fits without a ${doublerShort(kind)}.`]
    : limits.map((l) => `${l.kind === "mod" || l.kind === "arcane" ? `Uses ${l.what} (${l.why})` : `Needs ${l.what} (${l.why})`}, which is ${TIER_LABEL[l.tier]}.`);
  return { ...cap, tier, capacityTier: cap.tier, limits, reasons: [...lead, ...cap.reasons] };
}

/** Whether a tier allows an availability level. */
export const tierAllows = (tier: Tier, level: Availability): boolean => availabilityRank(level) <= TIER_RANK[tier];
/** The availability label for a level, for reasons. */
export { AVAILABILITY_LABEL };
