// The Codex rings on Mastery, Foundry and Wishlist: for each category (Warframes, Primary,
// Secondary, Melee, Companions, Archwing, Amps, K-Drives), how many you've mastered of how many
// there are. The same counting as Foundry's category tabs: every masterable item in those
// categories. A kitgun chamber is in Primary and Secondary both, and counted once in All.
import type { Model } from "./model";
import { GROUPS, groupsOf, inCodex, type Group } from "./collection";
import type { CatalogItem } from "./types";

export interface CodexRing {
  group: Group;
  label: string;
  mastered: number;
  total: number;
  /** Of those, what's counted in another ring too (a kitgun chamber, in Primary and Secondary): left out of All. */
  shared: { mastered: number; total: number };
}

const empty = (): Map<Group, CodexRing> => new Map(GROUPS.map((g) => [g.v, { group: g.v, label: g.label, mastered: 0, total: 0, shared: { mastered: 0, total: 0 } }]));

/** Counts an item in each ring it belongs to; past its own (the first), as shared. */
function count(rings: Map<Group, CodexRing>, item: CatalogItem, mastered: boolean) {
  groupsOf(item).forEach((g, i) => {
    const r = rings.get(g)!;
    r.total++;
    if (mastered) r.mastered++;
    if (i > 0) {
      r.shared.total++;
      if (mastered) r.shared.mastered++;
    }
  });
}

/** Mastered of all, per category, in the Codex's order. Categories with nothing in them are left out. */
export function codexRings(m: Model): CodexRing[] {
  const rings = empty();
  for (const item of m.catalogByUnique.values()) if (inCodex(item)) count(rings, item, m.isMastered(item.uniqueName));
  return [...rings.values()].filter((r) => r.total > 0);
}

/** The same rings for a list of items (what you starred): mastered of starred, per category. */
export function ringsFor(m: Model, uniques: string[]): CodexRing[] {
  const rings = empty();
  for (const u of new Set(uniques)) {
    const item = m.catalogByUnique.get(u);
    if (item) count(rings, item, m.isMastered(u));
  }
  return [...rings.values()].filter((r) => r.total > 0);
}

/**
 * A Mastery row's categories: by its catalog entry, or, for gear only the inventory knows, by the
 * kind Mastery shows it as ("Warframe", "Companion"; a weapon it can't place is Other).
 */
export function rowGroups(m: Model, unique: string, category: string): Group[] {
  const item = m.catalogByUnique.get(unique);
  if (item) {
    const groups = groupsOf(item);
    return groups.length ? groups : ["other"];
  }
  return [category === "Warframe" ? "warframes" : category === "Companion" ? "companions" : "other"];
}

/** Every ring added up: mastered of all, across the categories shown (the "All" ring), each item once. */
export function ringTotal(rings: CodexRing[]): { mastered: number; total: number } {
  return rings.reduce((t, r) => ({ mastered: t.mastered + r.mastered - (r.shared?.mastered ?? 0), total: t.total + r.total - (r.shared?.total ?? 0) }), { mastered: 0, total: 0 });
}

/** How many you starred in each category: the gold mark on Wishlist's rings. */
export function starredBy(m: Model, uniques: string[]): Partial<Record<Group, number>> {
  return Object.fromEntries(ringsFor(m, uniques).map((r) => [r.group, r.total]));
}

/** "Gauss, Lavos +7": the first few names, then how many more. */
export function someNames(names: string[], max = 2): string {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}
