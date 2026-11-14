// Invasions that reward a part you need: a blueprint or component of something you haven't
// mastered or built, that you don't already hold enough of. Invasion rewards are mostly weapon
// parts (Dera Vandal, Twin Vipers Wraith…), the only regular way to get those.
import type { Model } from "./model";
import { masteryHelp, RARE_REWARD } from "./worldNeeds";

export interface InvasionReward {
  uniqueName: string;
  type: string;
  count: number;
}
export interface Invasion {
  id: string;
  node: string;
  desc?: string;
  completed?: boolean;
  completion?: number;
  vsInfestation?: boolean;
  attacker?: { faction?: string; reward?: { countedItems?: InvasionReward[] } | null };
  defender?: { faction?: string; reward?: { countedItems?: InvasionReward[] } | null };
}

export interface InvasionNeed {
  /** Invasion id plus the reward: what a notification is sent once for. */
  key: string;
  /** The reward's path, as the world state gives it. */
  uniqueName: string;
  node: string;
  reward: string;
  count: number;
  /** The faction to side with to earn it. */
  side: string;
  /** What it builds. */
  item: string;
  itemImage: string | null;
  points: number;
  have: number;
  needed: number;
  /** How far the invasion is, 0–100: the attackers' share of the tug of war. */
  completion: number | null;
  /** Both sides, attacker first, for the tug-of-war bar ("Grineer", "Corpus"); null when unknown. */
  attacker: string | null;
  defender: string | null;
}

export function invasionNeeds(m: Model, invasions: Invasion[] | null | undefined): InvasionNeed[] {
  if (!invasions?.length) return [];
  const out: InvasionNeed[] = [];
  for (const inv of invasions) {
    if (inv.completed) continue;
    for (const side of [inv.attacker, inv.defender]) {
      for (const r of side?.reward?.countedItems ?? []) {
        // The same rule as an alert's reward (worldNeeds.ts): a blueprint or part of something you
        // haven't mastered or built, that you don't hold enough of.
        if (!/\/Recipes\//.test(r.uniqueName)) continue;
        const part = masteryHelp(m, { uniqueName: r.uniqueName, name: r.type });
        if (!part || part.whole) continue;
        out.push({
          key: `${inv.id}|${r.uniqueName}`,
          uniqueName: r.uniqueName,
          node: inv.node,
          reward: r.type,
          count: r.count,
          side: side?.faction ?? "?",
          item: part.item,
          itemImage: m.imageOf(part.item),
          points: part.points,
          have: part.have,
          needed: part.needed,
          completion: typeof inv.completion === "number" ? inv.completion : null,
          attacker: inv.attacker?.faction ?? null,
          defender: inv.defender?.faction ?? null,
        });
      }
    }
  }
  return out;
}

/** An invasion paying something rare: an Orokin Catalyst or Reactor blueprint, Forma, an Exilus Adapter blueprint… */
export interface InvasionRare {
  /** Invasion id plus the reward: what a notification is sent once for. */
  key: string;
  node: string;
  /** "Orokin Reactor Blueprint", or "3 × Forma Blueprint". */
  reward: string;
  /** The reward itself, without the count: its path and name. */
  item: { uniqueName?: string; name: string };
  side: string;
  completion: number | null;
}

/**
 * Running invasions with a rare reward (`RARE_REWARD`, as for alerts). Needs no inventory, so it
 * works on a console too. One entry per invasion and reward.
 */
export function invasionRares(invasions: Invasion[] | null | undefined): InvasionRare[] {
  const out: InvasionRare[] = [];
  for (const inv of invasions ?? []) {
    if (!inv || inv.completed) continue;
    for (const side of [inv.attacker, inv.defender]) {
      for (const r of side?.reward?.countedItems ?? []) {
        if (!r?.type || !RARE_REWARD.test(r.type)) continue;
        out.push({
          key: `${inv.id}|${r.uniqueName ?? r.type}`,
          node: inv.node,
          reward: (r.count ?? 1) > 1 ? `${r.count} × ${r.type}` : r.type,
          item: { uniqueName: r.uniqueName, name: r.type },
          side: side?.faction ?? "?",
          completion: typeof inv.completion === "number" ? inv.completion : null,
        });
      }
    }
  }
  return out;
}
