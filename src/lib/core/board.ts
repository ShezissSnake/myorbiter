// The world board on Home: every open void fissure, by kind and era, and the bounties on offer in
// each open world and hub, with what each pays.
//
// Bounties come from two places. Cetus, Fortuna and the Necralisk list their bounties in the
// worldstate, each with its own reward table. The Zariman, Albrecht's Laboratories (Cavia) and
// Höllvania (1999) don't: their missions rotate in game, but each level tier always pays from the
// same table, which the official drop tables carry (relicdata.rs keeps them).
import type { Fissure } from "./types";
import { TIERS } from "./timers";

// ---------------------------------------------------------------- fissures

export type FissureMode = "normal" | "steel" | "storm";

export const modeOf = (f: Fissure): FissureMode => (f.isStorm ? "storm" : f.isHard ? "steel" : "normal");

const open = (fs: Fissure[] | null, now: number) => (fs ?? []).filter((f) => Date.parse(f.expiry) > now);

/** How many are open of each kind. */
export function fissureCounts(fs: Fissure[] | null, now: number): Record<FissureMode, number> {
  const out: Record<FissureMode, number> = { normal: 0, steel: 0, storm: 0 };
  for (const f of open(fs, now)) out[modeOf(f)]++;
  return out;
}

/** The open fissures of one kind, by era (Lith first), each era's soonest to close first. Eras with none are left out. */
export function fissuresByEra(fs: Fissure[] | null, mode: FissureMode, now: number): { era: string; list: Fissure[] }[] {
  const mine = open(fs, now).filter((f) => modeOf(f) === mode);
  const eras = [...TIERS, ...new Set(mine.map((f) => f.tier).filter((t) => !(TIERS as readonly string[]).includes(t)))];
  return eras
    .map((era) => ({ era, list: mine.filter((f) => f.tier === era).sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry)) }))
    .filter((e) => e.list.length > 0);
}

// ---------------------------------------------------------------- bounties

/** A syndicate's bounties as api.warframestat.us gives them (`syndicateMissions`). */
export interface SyndicateMission {
  syndicate: string;
  syndicateKey?: string;
  expiry: string;
  jobs?: {
    type?: string;
    enemyLevels?: number[];
    standingStages?: number[];
    minMR?: number;
    rewardPool?: string[];
    rewardPoolDrops?: { item: string; rarity?: string; chance?: number }[];
    isVault?: boolean;
    timeBound?: string | null;
    /** The reward table the game pays from: "…/TierATableCRewards" (table C). */
    uniqueName?: string;
  }[];
}

/**
 * One tier's rewards from the drop tables: for the places the worldstate doesn't list, and for the
 * open worlds when their bounties come from the game's own worldstate, which names no rewards.
 */
export interface BountyTable {
  place: "zariman" | "cavia" | "hex" | "cetus" | "fortuna" | "necralisk" | "vault";
  level: string;
  /** In the open worlds, which of the level's three tables (A, B, C) this is. */
  rotation?: string;
  rewards: { name: string; chance: number; rarity: string }[];
}

export interface BountyReward {
  name: string;
  /** Percent, the best chance it has at any stage. Null when the source didn't say. */
  chance: number | null;
  rarity: string;
}

export interface BountyJob {
  name: string;
  levels: string;
  /** Standing for doing every stage. */
  standing: number | null;
  minMR: number;
  rewards: BountyReward[];
  /** The one worth naming: something you need, else the rarest that isn't credits, endo or a stack of resources. */
  headline: BountyReward | null;
  /** headline is something you need. */
  wanted: boolean;
  /** Narmer bounties run only by day or by night. */
  when: string | null;
  vault: boolean;
}

export interface BountyBoard {
  key: string;
  label: string;
  /** Where: "Cetus, Plains of Eidolon". */
  where: string;
  expiry: string | null;
  jobs: BountyJob[];
  /** The tiers are fixed, the missions rotate in game: the worldstate doesn't name them. */
  rotating: boolean;
}

const LISTED: { syndicate: string; key: "cetus" | "fortuna" | "necralisk"; label: string; where: string }[] = [
  { syndicate: "Ostrons", key: "cetus", label: "Cetus", where: "Plains of Eidolon" },
  { syndicate: "Solaris United", key: "fortuna", label: "Fortuna", where: "Orb Vallis" },
  { syndicate: "Entrati", key: "necralisk", label: "Necralisk", where: "Cambion Drift" },
];
const ROTATING: { place: BountyTable["place"]; syndicate: string; key: string; label: string; where: string }[] = [
  { place: "zariman", syndicate: "The Holdfasts", key: "zariman", label: "Zariman", where: "Chrysalith" },
  { place: "cavia", syndicate: "Cavia", key: "cavia", label: "Cavia", where: "Albrecht's Laboratories" },
  { place: "hex", syndicate: "The Hex", key: "hex", label: "Höllvania", where: "1999" },
];

/** Credits, endo, standing items and stacks of resources: what every bounty pays, never worth naming. */
const FILLER = /(^|\s)(Endo|Credits?|Credits Cache)$|^[\d,]+\s*X\s|^[\d,]+ (Endo|Credits)|Cache$/i;

function uniqueRewards(rs: BountyReward[]): BountyReward[] {
  const by = new Map<string, BountyReward>();
  for (const r of rs) {
    const had = by.get(r.name);
    if (!had || (r.chance ?? 0) > (had.chance ?? 0)) by.set(r.name, r);
  }
  // Rarest first: that's what people look a bounty up for.
  return [...by.values()].sort((a, b) => (a.chance ?? 101) - (b.chance ?? 101) || a.name.localeCompare(b.name));
}

function headlineOf(rs: BountyReward[], need: (name: string) => boolean): { headline: BountyReward | null; wanted: boolean } {
  const wanted = rs.find((r) => need(r.name));
  if (wanted) return { headline: wanted, wanted: true };
  return { headline: rs.find((r) => !FILLER.test(r.name)) ?? rs[0] ?? null, wanted: false };
}

const sum = (xs: number[] | undefined) => (xs?.length ? xs.reduce((n, x) => n + x, 0) : null);

/**
 * The boards Home shows, in a fixed order: the three with listed bounties, then the three with
 * rotating ones. `need`: whether you'd want a reward (a part for something you haven't mastered).
 */
export function bountyBoards(missions: SyndicateMission[] | null, tables: BountyTable[] | null, need: (name: string) => boolean = () => false): BountyBoard[] {
  const out: BountyBoard[] = [];
  const bySyndicate = new Map((missions ?? []).map((m) => [m.syndicate, m]));
  for (const l of LISTED) {
    const m = bySyndicate.get(l.syndicate);
    if (!m?.jobs?.length) continue;
    const jobs = m.jobs.map((j): BountyJob => {
      const lv = j.enemyLevels ?? [];
      // No pool (read from the game's worldstate): the drop table for the bounty's level.
      const place = j.isVault ? "vault" : l.key;
      // The table this rotation pays from (its letter is in the job's reward path); all three
      // together only when the path doesn't say.
      const letter = /Table([ABC])Rewards/.exec(j.uniqueName ?? "")?.[1];
      const level = (tables ?? []).filter((t) => lv.length >= 2 && t.place === place && t.level === `${lv[0]} - ${lv[1]}`);
      const exact = letter ? level.filter((t) => t.rotation === letter) : [];
      const table = (exact.length ? exact : level).flatMap((t) => t.rewards);
      const rewards = uniqueRewards(
        j.rewardPoolDrops?.length
          ? j.rewardPoolDrops.map((d) => ({ name: d.item, chance: typeof d.chance === "number" ? d.chance : null, rarity: d.rarity ?? "" }))
          : j.rewardPool?.length
            ? j.rewardPool.map((name) => ({ name, chance: null, rarity: "" }))
            : table.map((x) => ({ name: x.name, chance: x.chance, rarity: x.rarity })),
      );
      return {
        name: j.type ?? "Bounty",
        levels: lv.length >= 2 ? (lv[0] === lv[1] ? `${lv[0]}` : `${lv[0]}–${lv[1]}`) : "",
        standing: sum(j.standingStages),
        minMR: j.minMR ?? 0,
        rewards,
        ...headlineOf(rewards, need),
        when: j.timeBound ?? null,
        vault: !!j.isVault,
      };
    });
    out.push({ key: l.key, label: l.label, where: l.where, expiry: m.expiry ?? null, jobs, rotating: false });
  }
  for (const r of ROTATING) {
    // One row a level: its tables put together (the best chance each reward has in any of them).
    const tiers = new Map<string, BountyTable["rewards"]>();
    for (const t of (tables ?? []).filter((t) => t.place === r.place)) tiers.set(t.level, [...(tiers.get(t.level) ?? []), ...t.rewards]);
    if (!tiers.size) continue;
    const jobs = [...tiers].map(([level, pool]): BountyJob => {
      const rewards = uniqueRewards(pool.map((x) => ({ name: x.name, chance: x.chance, rarity: x.rarity })));
      return { name: `Level ${level.replace(" - ", "–")}`, levels: level.replace(" - ", "–"), standing: null, minMR: 0, rewards, ...headlineOf(rewards, need), when: null, vault: false };
    });
    out.push({ key: r.key, label: r.label, where: r.where, expiry: bySyndicate.get(r.syndicate)?.expiry ?? null, jobs, rotating: true });
  }
  return out;
}
