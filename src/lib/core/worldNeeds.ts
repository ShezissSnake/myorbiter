// What the worldstate offers that you'd want: alerts that reward something you haven't mastered
// (or a blueprint or part toward it), alerts with rare rewards, and the summaries the mastery
// notifications send for Baro, Varzia and the Duviri Circuit. Invasions have their own file
// (invasions.ts): their rewards are nearly always weapon parts.
import { masteryPoints } from "./acquire";
import { normaliseStoreUnique, type Model } from "./model";
import type { CatalogItem } from "./types";

export interface AlertReward {
  uniqueName?: string;
  type: string;
  count?: number;
}
export interface WorldAlert {
  id: string;
  activation?: string;
  expiry: string;
  tag?: string;
  mission: {
    node: string;
    type: string;
    faction?: string;
    description?: string;
    reward?: { items?: string[]; countedItems?: AlertReward[]; credits?: number } | null;
  };
}

/** A reward that helps toward mastery: the item itself, or one of its blueprints or parts. */
export interface MasteryHelp {
  /** The masterable item it's for. */
  item: string;
  unique: string;
  points: number;
  /** The reward is the item itself, ready to use. */
  whole: boolean;
  /** Parts: how many you hold and how many building it takes. */
  have: number;
  needed: number;
}

interface Index {
  byUnique: Map<string, { item: CatalogItem; needed: number; whole: boolean }>;
  byName: Map<string, { item: CatalogItem; needed: number; whole: boolean }>;
}
const indexes = new WeakMap<Model, Index>();

/** Every masterable item and each of its blueprints and parts, by path and by name. */
function indexOf(m: Model): Index {
  const had = indexes.get(m);
  if (had) return had;
  const byUnique: Index["byUnique"] = new Map();
  const byName: Index["byName"] = new Map();
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable) continue;
    byUnique.set(item.uniqueName, { item, needed: 1, whole: true });
    if (!byName.has(item.name)) byName.set(item.name, { item, needed: 1, whole: true });
    for (const c of item.components ?? []) {
      // Resources (Orokin Cell, Neurodes…) are components too, of many things: not a part of this one.
      if (!/\/Recipes\/|Blueprint|Component/.test(c.uniqueName) && c.name !== "Blueprint") continue;
      const entry = { item, needed: c.itemCount ?? 1, whole: false };
      if (!byUnique.has(c.uniqueName)) byUnique.set(c.uniqueName, entry);
      const full = c.name === "Blueprint" ? `${item.name} Blueprint` : `${item.name} ${c.name}`;
      if (!byName.has(full)) byName.set(full, entry);
    }
  }
  const index = { byUnique, byName };
  indexes.set(m, index);
  return index;
}

/**
 * What a reward does for your mastery, if anything: null when it isn't masterable or part of
 * something masterable, or you've mastered (or own) that already, or you hold enough of the part.
 */
export function masteryHelp(m: Model, reward: { uniqueName?: string | null; name: string }): MasteryHelp | null {
  const ix = indexOf(m);
  const path = reward.uniqueName ? normaliseStoreUnique(reward.uniqueName) : null;
  const hit = (path ? (ix.byUnique.get(path) ?? ix.byUnique.get(reward.uniqueName!)) : undefined) ?? ix.byName.get(reward.name.replace(/\s+/g, " ").trim());
  if (!hit) return null;
  const { item } = hit;
  if (m.isMastered(item.uniqueName) || m.owned(item.uniqueName) > 0) return null;
  let have = 0;
  if (!hit.whole) {
    const at = path ?? reward.uniqueName ?? "";
    have = (m.inventoryByBase.get(at) ?? []).reduce((n, r) => n + r.quantity, 0) || (m.inventoryByName.get(reward.name) ?? []).reduce((n, r) => n + r.quantity, 0);
    if (have >= hit.needed) return null;
  }
  return { item: item.name, unique: item.uniqueName, points: masteryPoints(item), whole: hit.whole, have, needed: hit.needed };
}

/** Rewards worth an alert of their own: what you'd otherwise buy with platinum or grind for. */
export const RARE_REWARD = /\b(Orokin (Catalyst|Reactor)|(Umbra |Aura |Stance )?Forma|Exilus (Weapon )?Adapter|Nitain Extract|Kavat Genetic Code|Kubrow Egg)\b/i;

export interface AlertNeed {
  /** Alert id and reward: what a notification is sent once for. */
  key: string;
  node: string;
  mission: string;
  faction: string;
  reward: string;
  expiry: string;
  /** For mastery: what it's toward. Null for a rare reward. */
  help: MasteryHelp | null;
}

const rewardsOf = (a: WorldAlert): { uniqueName?: string; name: string; count: number }[] => [
  ...(a.mission.reward?.countedItems ?? []).map((r) => ({ uniqueName: r.uniqueName, name: r.type, count: r.count ?? 1 })),
  ...(a.mission.reward?.items ?? []).filter((x): x is string => typeof x === "string").map((name) => ({ name, count: 1 })),
];

/**
 * Running alerts with a reward you'd want. `mastery`: toward something you haven't mastered (needs
 * your inventory). `rare`: catalysts, reactors, Forma and the like (works without one).
 */
export function alertNeeds(m: Model | null, alerts: WorldAlert[] | null | undefined, now = Date.now()): { mastery: AlertNeed[]; rare: AlertNeed[] } {
  const mastery: AlertNeed[] = [];
  const rare: AlertNeed[] = [];
  for (const a of alerts ?? []) {
    if (!a?.mission || Date.parse(a.expiry) <= now) continue;
    for (const r of rewardsOf(a)) {
      const base = { key: `${a.id}|${r.uniqueName ?? r.name}`, node: a.mission.node, mission: a.mission.type, faction: a.mission.faction ?? "", reward: r.count > 1 ? `${r.count} × ${r.name}` : r.name, expiry: a.expiry };
      const help = m ? masteryHelp(m, r) : null;
      if (help) mastery.push({ ...base, help });
      else if (RARE_REWARD.test(r.name)) rare.push({ ...base, help: null });
    }
  }
  return { mastery, rare };
}

/** "Lanka Blueprint (toward Lanka, 3,000 mastery)". */
export function describeHelp(reward: string, h: MasteryHelp): string {
  const pts = `${h.points.toLocaleString("en")} mastery`;
  if (h.whole) return `${reward} (${pts})`;
  return `${reward}, toward ${h.item} (${pts}${h.needed > 1 ? `; you have ${h.have} of ${h.needed}` : ""})`;
}
