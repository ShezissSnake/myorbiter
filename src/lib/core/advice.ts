// Two decisions: which relics are worth refining to Radiant, and whether a spare part (or set)
// should be sold for platinum or traded in for ducats.

import { splitRelicName, type Model } from "./model";
import { partRows, rewardPlat, setRows } from "./views";
import type { RelicEntry } from "./types";

// ---------------------------------------------------------------- radiant

/** Void Traces to refine an Intact relic up to each refinement. Refining further pays the difference. */
export const TRACE_COST: Record<string, number> = { Intact: 0, Exceptional: 25, Flawless: 50, Radiant: 100 };

export interface Outcome {
  chance: number; // 0..1
  value: number;
}

/**
 * What the best of `n` independent cracks is worth, on average. Everyone in a squad cracks a relic
 * and each player picks the best reward on the screen, so a radshare of 4 is "best of 4".
 */
export function expectedBest(outcomes: Outcome[], n: number): number {
  const sorted = [...outcomes].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, o) => s + o.chance, 0) || 1;
  let cdf = 0;
  let prev = 0;
  let ev = 0;
  for (const o of sorted) {
    cdf += o.chance / total;
    const atMost = Math.min(1, cdf) ** n;
    ev += o.value * (atMost - prev);
    prev = atMost;
  }
  return ev;
}

export type RadiantMetric = "plat" | "ducats" | "need";

export interface RadiantRow {
  base: string;
  era: string;
  vaulted: boolean;
  owned: Record<string, number>;
  /** Copies not yet Radiant, and what refining one of each would cost. */
  refinable: number;
  cheapestTraces: number;
  rare: { name: string; price: number | null; ducats: number | null; chanceIntact: number; chanceRadiant: number } | null;
  /** Expected value of a crack (best of the squad) at Intact and at Radiant, in the chosen metric. */
  intact: number;
  radiant: number;
  gain: number;
  /** Gain per Void Trace when refining from Intact. */
  perTrace: number;
  /** Each refinement you hold short of Radiant: copies, traces to take one to Radiant, and what that adds. */
  upgrades: { refinement: string; count: number; traces: number; gain: number }[];
  neededNames: string[];
}

const ERA_ORDER = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Vanguard"];

function outcomes(m: Model, entry: RelicEntry | undefined, metric: RadiantMetric, platPerDucat = 0): Outcome[] {
  if (!entry) return [];
  return entry.rewards.map((rw) => {
    const part = m.partByName.get(rw.name)?.[0];
    let value = 0;
    // Platinum: what it sells for, or its ducats at your rate when you'd rather trade it to Baro.
    if (metric === "plat") value = rewardPlat(m, rw.name, platPerDucat);
    else if (metric === "ducats") value = part?.ducats ?? 0;
    else if (part) {
      const done = m.isMastered(part.parentUnique) || m.owned(part.parentUnique) > 0;
      value = !done && m.partHave(rw.name) < part.required ? 1 : 0;
    }
    return { chance: (rw.chance ?? 0) / 100, value };
  });
}

const TRACES_TO_RADIANT = { Intact: 100, Exceptional: 75, Flawless: 50 } as const;

export function radiantRows(m: Model, opts: { squad: number; metric: RadiantMetric; platPerDucat?: number }): RadiantRow[] {
  const ownedByBase = new Map<string, Record<string, number>>();
  for (const [, rows] of m.inventoryByBase) {
    for (const r of rows) {
      if (r.category !== "relic" || r.quantity <= 0) continue;
      const split = splitRelicName(r.name);
      if (!split) continue;
      const rec = ownedByBase.get(split.base) ?? {};
      rec[split.refinement] = (rec[split.refinement] ?? 0) + r.quantity;
      ownedByBase.set(split.base, rec);
    }
  }
  const out: RadiantRow[] = [];
  for (const [base, owned] of ownedByBase) {
    const group = m.relicGroups.get(base);
    const intactEntry = group?.byRefinement.Intact;
    const radiantEntry = group?.byRefinement.Radiant;
    if (!group || !intactEntry || !radiantEntry) continue;
    const refinable = (owned.Intact ?? 0) + (owned.Exceptional ?? 0) + (owned.Flawless ?? 0);
    const cheapestTraces = owned.Flawless ? 50 : owned.Exceptional ? 75 : 100;
    const intact = expectedBest(outcomes(m, intactEntry, opts.metric, opts.platPerDucat), opts.squad);
    const radiant = expectedBest(outcomes(m, radiantEntry, opts.metric, opts.platPerDucat), opts.squad);
    const rareI = intactEntry.rewards.find((r) => r.rarity === "Rare");
    const rareR = radiantEntry.rewards.find((r) => r.name === rareI?.name);
    const part = rareI ? m.partByName.get(rareI.name)?.[0] : undefined;
    const needed = outcomes(m, intactEntry, "need")
      .map((o, i) => (o.value ? intactEntry.rewards[i].name : null))
      .filter((x): x is string => !!x);
    // Radiant from Intact costs 100 traces, from Exceptional 75, from Flawless 50, and each gains
    // only what's left between its own odds and Radiant's.
    const upgrades = (["Intact", "Exceptional", "Flawless"] as const)
      .filter((ref) => (owned[ref] ?? 0) > 0)
      .map((ref) => {
        const entry = group.byRefinement[ref] ?? intactEntry;
        const from = ref === "Intact" ? intact : expectedBest(outcomes(m, entry, opts.metric, opts.platPerDucat), opts.squad);
        return { refinement: ref, count: owned[ref] ?? 0, traces: TRACES_TO_RADIANT[ref], gain: radiant - from };
      });
    out.push({
      base,
      era: group.era,
      vaulted: group.vaulted,
      owned,
      refinable,
      cheapestTraces,
      rare: rareI
        ? {
            name: rareI.name,
            price: m.price(rareI.name),
            ducats: part?.ducats ?? null,
            chanceIntact: (rareI.chance ?? 0) / 100,
            chanceRadiant: (rareR?.chance ?? rareI.chance ?? 0) / 100,
          }
        : null,
      intact,
      radiant,
      gain: radiant - intact,
      perTrace: (radiant - intact) / 100,
      neededNames: needed,
      upgrades,
    });
  }
  return out.sort((a, b) => b.gain - a.gain || ERA_ORDER.indexOf(a.era) - ERA_ORDER.indexOf(b.era));
}

// ---------------------------------------------------------------- plat or ducats

export interface DucatOptions {
  /** What one ducat is worth to you in platinum (what Baro sells, turned into plat). */
  platPerDucat: number;
  /** Below this, a single sale isn't worth the time it takes to trade. */
  minPlat: number;
  /** Trades a day below which an item counts as slow to sell. */
  slowBelow: number;
  /** Arcanes: what Vosfor from dissolving them is worth (see vosfor.ts). */
  vosforLens?: "need" | "market";
  /** How you crack relics: 1 alone, 4 in radshares (best of four cards). What a relic is worth cracked depends on it. */
  squad?: number;
}

export type Verdict = "plat" | "ducats";

export interface DucatRow {
  kind: "part" | "set";
  name: string;
  image: string; // name to look the image up by
  quantity: number;
  plat: number | null;
  ducats: number;
  ducatsPerPlat: number | null;
  verdict: Verdict;
  reason: string;
  slow: boolean;
  tradesPerDay: number | null;
  /** Total for the copies, in the verdict's currency. */
  totalPlat: number;
  totalDucats: number;
  vaulted: boolean;
}

export function decide(plat: number | null, ducats: number, trades: number | null, o: DucatOptions): { verdict: Verdict; reason: string; slow: boolean } {
  const slow = trades != null && trades < o.slowBelow;
  if (plat == null) return { verdict: "ducats", reason: "No market price", slow };
  const baroWorth = ducats * o.platPerDucat;
  if (baroWorth >= plat) return { verdict: "ducats", reason: `${ducats}d is worth ~${Math.round(baroWorth * 10) / 10}p to you`, slow };
  if (plat < o.minPlat) return { verdict: "ducats", reason: `Under ${o.minPlat}p: not worth a trade`, slow };
  if (slow && baroWorth >= plat * 0.6) return { verdict: "ducats", reason: "Sells slowly and ducats come close", slow };
  return { verdict: "plat", reason: slow ? "Worth more as plat, but sells slowly" : `Sells for more than its ducats are worth`, slow };
}

export function ducatRows(m: Model, o: DucatOptions, includeSets: boolean): DucatRow[] {
  const rows: DucatRow[] = [];
  // With sets shown, the parts inside a sellable set are counted with the set, not again on their own.
  const sets = includeSets ? setRows(m).filter((s) => s.sellable > 0) : [];
  for (const row of partRows(m)) {
    const p = { ...row, spare: row.spare - (includeSets ? row.inSets : 0) };
    if (p.spare <= 0) continue;
    const d = decide(p.price, p.ducats, p.tradesPerDay, o);
    rows.push({
      kind: "part",
      name: p.name,
      image: p.name,
      quantity: p.spare,
      plat: p.price,
      ducats: p.ducats,
      ducatsPerPlat: p.price ? p.ducats / p.price : null,
      ...d,
      tradesPerDay: p.tradesPerDay,
      totalPlat: (p.price ?? 0) * p.spare,
      totalDucats: p.ducats * p.spare,
      vaulted: p.availability === "vaulted",
    });
  }
  if (includeSets) {
    // A complete set sells as one trade; compare it with trading every part in for ducats.
    for (const s of sets) {
      const d = decide(s.setPrice, s.ducats, s.tradesPerDay, o);
      rows.push({
        kind: "set",
        name: `${s.name} Set`,
        image: s.name,
        quantity: s.sellable,
        plat: s.setPrice,
        ducats: s.ducats,
        ducatsPerPlat: s.setPrice ? s.ducats / s.setPrice : null,
        ...d,
        tradesPerDay: s.tradesPerDay,
        totalPlat: (s.setPrice ?? 0) * s.sellable,
        totalDucats: s.ducats * s.sellable,
        vaulted: s.vaulted,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- crack to complete sets

const REF_RANK = ["Radiant", "Flawless", "Exceptional", "Intact"] as const;

export interface SetHit {
  reward: string;
  set: string; // "Rhino Prime"
  /** The only part (or copy) still missing for one more complete set. */
  last: boolean;
  chance: number; // 0..1 per crack, at the refinement you'd crack
}

export interface CrackRow {
  base: string;
  era: string;
  vaulted: boolean;
  owned: Record<string, number>;
  /** The refinement used for the odds: your best copy. */
  refinement: string;
  hits: SetHit[];
  /** Chance one crack gives you a part a near-complete set is missing. */
  chance: number;
  /** Expected set platinum one crack moves you toward (each part counts as its share of the set). */
  value: number;
  sets: string[];
}

export interface SetGap {
  set: string;
  unique: string;
  missing: { name: string; count: number }[];
  missingCount: number;
  setPrice: number | null;
  mastered: boolean;
  /** Relics you own that drop a missing part. */
  relicsOwned: number;
}

export function setGaps(m: Model, maxMissing: number): SetGap[] {
  return setRows(m)
    .map((s) => ({
      set: s.name,
      unique: s.unique,
      missing: s.missing.map((x) => ({ name: x.name, count: x.count })),
      missingCount: s.missing.reduce((n, x) => n + x.count, 0),
      setPrice: s.setPrice,
      mastered: s.mastered,
      relicsOwned: 0,
    }))
    .filter((g) => g.missingCount > 0 && g.missingCount <= maxMissing);
}

export function crackRows(m: Model, maxMissing: number): { relics: CrackRow[]; gaps: SetGap[] } {
  const gaps = setGaps(m, maxMissing);
  const wanted = new Map<string, { gap: SetGap }[]>();
  for (const g of gaps) for (const x of g.missing) wanted.set(x.name, [...(wanted.get(x.name) ?? []), { gap: g }]);

  const ownedByBase = new Map<string, Record<string, number>>();
  for (const [, rows] of m.inventoryByBase) {
    for (const r of rows) {
      if (r.category !== "relic" || r.quantity <= 0) continue;
      const split = splitRelicName(r.name);
      if (!split) continue;
      const rec = ownedByBase.get(split.base) ?? {};
      rec[split.refinement] = (rec[split.refinement] ?? 0) + r.quantity;
      ownedByBase.set(split.base, rec);
    }
  }

  const relics: CrackRow[] = [];
  const counted = new Map<string, Set<string>>(); // set -> relic bases that help
  for (const [base, owned] of ownedByBase) {
    const group = m.relicGroups.get(base);
    if (!group) continue;
    const refinement = REF_RANK.find((r) => owned[r] && group.byRefinement[r]) ?? "Intact";
    const entry = group.byRefinement[refinement] ?? group.byRefinement.Intact;
    if (!entry) continue;
    const hits: SetHit[] = [];
    let value = 0;
    for (const rw of entry.rewards) {
      for (const { gap } of wanted.get(rw.name) ?? []) {
        const chance = (rw.chance ?? 0) / 100;
        hits.push({ reward: rw.name, set: gap.set, last: gap.missingCount === 1, chance });
        value += chance * ((gap.setPrice ?? 0) / gap.missingCount);
        const c = counted.get(gap.set) ?? new Set<string>();
        c.add(base);
        counted.set(gap.set, c);
      }
    }
    if (!hits.length) continue;
    // One crack gives exactly one reward, so the chances of the wanted rewards add up.
    const chance = Math.min(1, [...new Set(hits.map((h) => h.reward))].reduce((p, name) => p + hits.find((h) => h.reward === name)!.chance, 0));
    relics.push({
      base,
      era: group.era,
      vaulted: group.vaulted,
      owned,
      refinement,
      hits,
      chance,
      value,
      sets: [...new Set(hits.map((h) => h.set))],
    });
  }
  for (const g of gaps) g.relicsOwned = counted.get(g.set)?.size ?? 0;
  relics.sort((a, b) => b.value - a.value || b.chance - a.chance);
  return { relics, gaps };
}

/**
 * The near-complete sets that go with the Planner's filters, the same ones its table takes: a set
 * matches the search by its name, a missing part, or a relic of yours that drops one; "vaulted
 * only" keeps sets a vaulted relic of yours helps finish, or, with no relic of yours for them,
 * whose missing parts only come from vaulted relics.
 */
export function filterGaps(m: Model, plan: { relics: CrackRow[]; gaps: SetGap[] }, vaultedOnly: boolean, match: (...fields: string[]) => boolean): SetGap[] {
  return plan.gaps.filter((g) => {
    const helpers = plan.relics.filter((r) => r.sets.includes(g.set));
    if (!match(g.set, ...g.missing.map((x) => x.name), ...helpers.map((r) => r.base))) return false;
    if (!vaultedOnly) return true;
    if (helpers.length) return helpers.some((r) => r.vaulted);
    return g.missing.every((x) => {
      const sources = m.sourcesByReward.get(x.name) ?? [];
      return sources.length > 0 && sources.every((s) => s.vaulted);
    });
  });
}
