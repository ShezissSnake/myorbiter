// The Codex rings on Mastery, Foundry and Wishlist: for each category (Warframes, Primary,
// Secondary, Melee, Companions, Archwing, Other), how many you've mastered of how many there are.
// The same counting as Foundry's category tabs: every masterable item in those categories.
import type { Model } from "./model";
import { GROUPS, groupOf, type Group } from "./collection";

export interface CodexRing {
  group: Group;
  label: string;
  mastered: number;
  total: number;
}

const empty = (): Map<Group, CodexRing> => new Map(GROUPS.map((g) => [g.v, { group: g.v, label: g.label, mastered: 0, total: 0 }]));

/** Mastered of all, per category, in the Codex's order. Categories with nothing in them are left out. */
export function codexRings(m: Model): CodexRing[] {
  const rings = empty();
  for (const item of m.catalogByUnique.values()) {
    const g = item.masterable ? groupOf(item.category) : null;
    if (!g) continue;
    const r = rings.get(g)!;
    r.total++;
    if (m.isMastered(item.uniqueName)) r.mastered++;
  }
  return [...rings.values()].filter((r) => r.total > 0);
}

/** The same rings for a list of items (what you starred): mastered of starred, per category. */
export function ringsFor(m: Model, uniques: string[]): CodexRing[] {
  const rings = empty();
  for (const u of new Set(uniques)) {
    const item = m.catalogByUnique.get(u);
    const g = item ? groupOf(item.category) : null;
    if (!g) continue;
    const r = rings.get(g)!;
    r.total++;
    if (m.isMastered(u)) r.mastered++;
  }
  return [...rings.values()].filter((r) => r.total > 0);
}

/**
 * A Mastery row's category: by its catalog entry, or, for gear only the inventory knows, by the
 * kind Mastery shows it as ("Warframe", "Companion"; a weapon it can't place is Other).
 */
export function rowGroup(m: Model, unique: string, category: string): Group {
  const item = m.catalogByUnique.get(unique);
  if (item) return groupOf(item.category) ?? "other";
  return category === "Warframe" ? "warframes" : category === "Companion" ? "companions" : "other";
}
