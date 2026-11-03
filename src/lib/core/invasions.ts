// Invasions that reward a part you need: a blueprint or component of something you haven't
// mastered or built, that you don't already hold enough of. Invasion rewards are mostly weapon
// parts (Dera Vandal, Twin Vipers Wraith…), the only regular way to get those.
import { masteryPoints } from "./acquire";
import type { Model } from "./model";

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
  // Every component of something masterable, by its path.
  const byComponent = new Map<string, { parent: string; parentName: string; needed: number; points: number }>();
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable) continue;
    for (const c of item.components ?? []) {
      if (!/\/Recipes\//.test(c.uniqueName)) continue;
      byComponent.set(c.uniqueName, { parent: item.uniqueName, parentName: item.name, needed: c.itemCount ?? 1, points: masteryPoints(item) });
    }
  }
  const out: InvasionNeed[] = [];
  for (const inv of invasions) {
    if (inv.completed) continue;
    for (const side of [inv.attacker, inv.defender]) {
      for (const r of side?.reward?.countedItems ?? []) {
        const part = byComponent.get(r.uniqueName);
        if (!part) continue;
        if (m.isMastered(part.parent) || m.owned(part.parent) > 0) continue;
        const have = (m.inventoryByBase.get(r.uniqueName) ?? []).reduce((n, x) => n + x.quantity, 0);
        if (have >= part.needed) continue;
        out.push({
          key: `${inv.id}|${r.uniqueName}`,
          node: inv.node,
          reward: r.type,
          count: r.count,
          side: side?.faction ?? "?",
          item: part.parentName,
          itemImage: m.imageOf(part.parentName),
          points: part.points,
          have,
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
