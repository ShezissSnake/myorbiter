// What's worth doing today, from the worldstate, marked against your collection: the Duviri
// Circuit's warframes and Incarnon adapters, Teshin's Steel Path offer, Nightwave, the Sortie and
// the Archon Hunt.
import type { Model } from "./model";
import type { Live } from "./types";

export interface CircuitChoice {
  name: string;
  /** Warframes: you haven't mastered it. Incarnon: you own the weapon and hold no adapter for it. */
  wanted: boolean;
  note: string;
  image: string | null;
}

export interface Today {
  circuit: { frames: CircuitChoice[]; incarnons: CircuitChoice[]; resets: string } | null;
  steelPath: { reward: string; cost: number; ends: string } | null;
  nightwave: { standing: number; challenges: { title: string; desc: string; reputation: number; kind: "daily" | "weekly" | "elite" }[]; ends: string } | null;
  sortie: { boss: string; missions: string[]; ends: string } | null;
  archon: { boss: string; shard: string; missions: string[]; ends: string } | null;
}

/** The Circuit's choices change weekly, Monday 00:00 UTC. */
export function nextMondayUtc(now = Date.now()): string {
  const d = new Date(now);
  const days = (8 - d.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)).toISOString();
}

/** An Incarnon Genesis fits every variant of its weapon: Braton Prime, MK1-Braton, Dera Vandal, Dex Sybaris… */
const VARIANT_PREFIX = ["MK1-", "Prisma ", "Dex ", "Sancti ", "Secura ", "Synoid ", "Telos ", "Rakta ", "Vaykor ", "Mara "];
const VARIANT_SUFFIX = [" Prime", " Vandal", " Wraith"];
export const genesisVariants = (name: string) => [name, ...VARIANT_SUFFIX.map((s) => name + s), ...VARIANT_PREFIX.map((p) => p + name)];

const SHARD: Record<string, string> = { "Archon Amar": "Crimson", "Archon Nira": "Amber", "Archon Boreal": "Azure" };

export function today(m: Model, live: Live, now = Date.now()): Today {
  const byName = new Map<string, { unique: string; category: string }>();
  for (const item of m.catalogByUnique.values()) if (item.masterable && !byName.has(item.name)) byName.set(item.name, { unique: item.uniqueName, category: item.category });
  const held = (name: string) => (m.inventoryByName.get(name) ?? []).reduce((n, r) => n + r.quantity, 0);
  const owns = (name: string) => {
    const it = byName.get(name);
    return !!it && (m.owned(it.unique) > 0 || m.isMastered(it.unique));
  };

  const cycle = live.duviriCycle;
  const normal = cycle?.choices.find((c) => c.category === "normal")?.choices ?? [];
  const hard = cycle?.choices.find((c) => c.category === "hard")?.choices ?? [];
  const circuit = cycle
    ? {
        frames: normal.map((name) => {
          const it = byName.get(name);
          const mastered = !!it && m.isMastered(it.unique);
          const has = !!it && m.owned(it.unique) > 0;
          return { name, wanted: !mastered && !has, note: mastered ? "mastered" : has ? "you have it" : "not mastered", image: m.imageOf(name) };
        }),
        incarnons: hard.map((name) => {
          const adapter = held(`${name} Incarnon Genesis`) > 0;
          const weapon = genesisVariants(name).some(owns);
          return {
            name,
            wanted: weapon && !adapter,
            note: adapter ? "adapter in hand" : weapon ? "you have the weapon" : "no weapon for it",
            image: m.imageOf(`${name} Incarnon Genesis`) ?? m.imageOf(name),
          };
        }),
        resets: nextMondayUtc(now),
      }
    : null;

  const sp = live.steelPath;
  const steelPath = sp?.currentReward ? { reward: sp.currentReward.name, cost: sp.currentReward.cost, ends: sp.expiry } : null;

  const nw = live.nightwave;
  const nightwave = nw
    ? {
        standing: nw.activeChallenges.reduce((n, c) => n + c.reputation, 0),
        challenges: [...nw.activeChallenges]
          .sort((a, b) => b.reputation - a.reputation)
          .map((c) => ({ title: c.title, desc: c.desc, reputation: c.reputation, kind: (c.isElite ? "elite" : c.isDaily ? "daily" : "weekly") as "daily" | "weekly" | "elite" })),
        ends: nw.expiry,
      }
    : null;

  const s = live.sortie;
  const sortie = s ? { boss: s.boss, missions: (s.variants ?? []).map((v) => `${v.missionType} · ${v.node}`), ends: s.expiry } : null;
  const a = live.archonHunt;
  const archon = a ? { boss: a.boss, shard: SHARD[a.boss] ?? "", missions: (a.missions ?? []).map((x) => `${x.type} · ${x.node}`), ends: a.expiry } : null;

  return { circuit, steelPath, nightwave, sortie, archon };
}
