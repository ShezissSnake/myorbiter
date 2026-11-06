// Two decisions: which relics are worth refining to Radiant, and whether a spare part (or set)
// should be sold for platinum or traded in for ducats.

import { splitRelicName, type Model } from "./model";
import { rewardPlat, setRows } from "./views";
import type { RelicEntry } from "./types";

// ---------------------------------------------------------------- radiant

export interface Outcome {
  chance: number; // 0..1
  value: number;
}

/**
 * What the best of `n` independent cracks is worth, on average. Everyone in a squad cracks a relic
 * and each player picks the best reward on the screen, so a radshare of 4 is "best of 4".
 */
export function expectedBest(outcomes: Outcome[], n: number): number {
  // Chances as fractions that don't reach 1 (a relic whose listed rewards come to 76%, the rest
  // something with no price): the rest is a reward worth nothing, as the solo figure counts it,
  // not spread over the listed ones.
  const listed = outcomes.reduce((s, o) => s + o.chance, 0);
  const all = listed > 0 && listed < 1 - 1e-6 ? [{ chance: 1 - listed, value: 0 }, ...outcomes] : outcomes;
  const sorted = [...all].sort((a, b) => a.value - b.value);
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

import { ITEMS_PER_TRADE } from "./tradeLimit";

/**
 * Whether selling `copies` at `each` is worth a trade: judged on one trade of up to six copies, not
 * one copy (five barrels at 3p go in one 15p trade). The floor is "Not worth a trade under Np"
 * (advice.minPlat). Null prices aren't worth one.
 */
export function worthATrade(each: number | null | undefined, copies: number, minPlat: number): boolean {
  if (each == null) return false;
  return each * Math.min(Math.max(1, copies), ITEMS_PER_TRADE) >= minPlat;
}

/**
 * Plat or ducats for a part (or set) at `plat` each. `copies`: how many you have to sell. The
 * smallest sale worth a trade is judged on the trade, not the copy: five barrels at 3p go in one
 * 15p trade.
 */
export function decide(plat: number | null, ducats: number, trades: number | null, o: DucatOptions, copies = 1): { verdict: Verdict; reason: string; slow: boolean } {
  const slow = trades != null && trades < o.slowBelow;
  if (plat == null) return { verdict: "ducats", reason: "No market price", slow };
  const baroWorth = ducats * o.platPerDucat;
  if (baroWorth >= plat) return { verdict: "ducats", reason: `${ducats}d is worth ~${Math.round(baroWorth * 10) / 10}p to you`, slow };
  const perTrade = Math.min(Math.max(1, copies), ITEMS_PER_TRADE);
  if (!worthATrade(plat, copies, o.minPlat)) return { verdict: "ducats", reason: perTrade > 1 ? `Under ${o.minPlat}p a trade, even ${perTrade} at once: not worth one` : `Under ${o.minPlat}p: not worth a trade`, slow };
  if (slow && baroWorth >= plat * 0.6) return { verdict: "ducats", reason: "Sells slowly and ducats come close", slow };
  return { verdict: "plat", reason: slow ? "Worth more as plat, but sells slowly" : `Sells for more than its ducats are worth`, slow };
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
  /** The refinement you hold most of (the reward list's odds are its). */
  refinement: string;
  /** Each refinement you hold, its copies and what one crack of it gives toward sets. */
  perRefinement: { refinement: string; copies: number; chance: number; value: number }[];
  hits: SetHit[];
  /**
   * Chance one crack gives you a part a near-complete set is missing: the average over the copies
   * you hold (one radiant among 18 intact barely moves it), solo or in a radshare (best of the squad's).
   */
  chance: number;
  /** Expected platinum one crack adds toward sets, on the same footing: each missing part at what it adds to its set (SetGap.partValue). */
  value: number;
  sets: string[];
}

export interface SetGap {
  set: string;
  unique: string;
  missing: { name: string; count: number }[];
  missingCount: number;
  setPrice: number | null;
  /**
   * What one missing part adds: the set's price over what the parts you hold already sell for
   * loose, shared between the parts still missing. A 70p set whose other parts sell for 50p
   * loose gains 20p from its last part, not 70p. Never under the part's own price.
   */
  partValue: Map<string, number>;
  mastered: boolean;
  /** Relics you own that drop a missing part. */
  relicsOwned: number;
}

export function setGaps(m: Model, maxMissing: number): SetGap[] {
  return setRows(m)
    .map((s) => {
      const missingCount = s.missing.reduce((n, x) => n + x.count, 0);
      const missingLoose = s.missing.every((x) => x.price != null) ? s.missing.reduce((n, x) => n + (x.price as number) * x.count, 0) : null;
      const heldLoose = s.partsPrice != null && missingLoose != null ? s.partsPrice - missingLoose : null;
      const share = s.setPrice == null || !missingCount ? 0 : Math.max(0, s.setPrice - (heldLoose ?? 0)) / missingCount;
      return {
        set: s.name,
        unique: s.unique,
        missing: s.missing.map((x) => ({ name: x.name, count: x.count })),
        missingCount,
        setPrice: s.setPrice,
        partValue: new Map(s.missing.map((x) => [x.name, Math.max(x.price ?? 0, share)])),
        mastered: s.mastered,
        relicsOwned: 0,
      };
    })
    .filter((g) => g.missingCount > 0 && g.missingCount <= maxMissing);
}

export function crackRows(m: Model, maxMissing: number, squad = 1): { relics: CrackRow[]; gaps: SetGap[] } {
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
  const k = Math.max(1, squad);
  for (const [base, owned] of ownedByBase) {
    const group = m.relicGroups.get(base);
    if (!group) continue;
    const per: CrackRow["perRefinement"] = [];
    let mostHits: SetHit[] = [];
    let most = -1;
    for (const refinement of REF_RANK) {
      const copies = owned[refinement] ?? 0;
      const entry = copies ? group.byRefinement[refinement] : undefined;
      if (!entry) continue;
      const hits: SetHit[] = [];
      let value = 0;
      for (const rw of entry.rewards) {
        for (const { gap } of wanted.get(rw.name) ?? []) {
          const chance = (rw.chance ?? 0) / 100;
          hits.push({ reward: rw.name, set: gap.set, last: gap.missingCount === 1, chance });
          value += chance * (gap.partValue.get(rw.name) ?? 0);
        }
      }
      if (!hits.length) continue;
      // One crack gives exactly one reward, so the chances of the wanted rewards add up. In a
      // radshare you take the best of the squad's: a wanted part comes if any of them gives one.
      const one = Math.min(1, [...new Set(hits.map((h) => h.reward))].reduce((p, name) => p + hits.find((h) => h.reward === name)!.chance, 0));
      const chance = 1 - (1 - one) ** k;
      per.push({ refinement, copies, chance, value: one > 0 ? (value * chance) / one : 0 });
      if (copies > most) {
        most = copies;
        mostHits = hits;
      }
    }
    if (!per.length) continue;
    for (const h of mostHits) {
      const c = counted.get(h.set) ?? new Set<string>();
      c.add(base);
      counted.set(h.set, c);
    }
    const total = per.reduce((n, x) => n + x.copies, 0);
    const best = per.find((x) => x.copies === most)!;
    relics.push({
      base,
      era: group.era,
      vaulted: group.vaulted,
      owned,
      refinement: best.refinement,
      perRefinement: per,
      hits: mostHits,
      chance: per.reduce((n, x) => n + x.chance * x.copies, 0) / total,
      value: per.reduce((n, x) => n + x.value * x.copies, 0) / total,
      sets: [...new Set(mostHits.map((h) => h.set))],
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

/** A prime part worth buying to trade to Baro: ducats for little platinum. */
export interface DucatBuy {
  name: string;
  ducats: number;
  /** Daily median. */
  price: number;
  /** Ducats per platinum at that price. */
  rate: number;
  tradesPerDay: number | null;
}

/**
 * Prime parts that turn platinum into ducats cheapest, for a Baro week: ducats per platinum at
 * the daily median, best first. Only parts that sell at least once a day: a median of one sale
 * isn't a price you'll find again.
 */
export function ducatBuys(m: Model, opts: { limit?: number } = {}): DucatBuy[] {
  const out: DucatBuy[] = [];
  for (const [name, parts] of m.partByName) {
    const ducats = parts[0]?.ducats ?? 0;
    const price = m.price(name);
    const tradesPerDay = m.tradesPerDay(name);
    if (!ducats || price == null || price <= 0 || (tradesPerDay ?? 0) < 1) continue;
    out.push({ name, ducats, price, rate: ducats / price, tradesPerDay });
  }
  return out.sort((a, b) => b.rate - a.rate || b.ducats - a.ducats).slice(0, opts.limit ?? 15);
}
