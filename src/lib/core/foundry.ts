// What's in your Foundry and when each build is ready, from TennoScope's read of the inventory.
import { masteryPoints } from "./acquire";
import type { Model } from "./model";

export interface FoundryBuild {
  /** Recipe path, and with readyAt what an alert is sent once for. */
  path: string;
  key: string;
  /** What comes out: the item, or the part a component blueprint makes. */
  name: string;
  readyAt: number;
  ready: boolean;
  /** Mastery it gives once built and levelled, when it's something you haven't mastered. */
  points: number | null;
  image: string | null;
}

export function foundryBuilds(m: Model, ready: [string, number][], now = Date.now()): FoundryBuild[] {
  // Each blueprint, by path: the item it builds (its own "Blueprint") or the part it makes.
  const product = new Map<string, { name: string; unique: string | null; parent: string }>();
  for (const item of m.catalogByUnique.values()) {
    for (const c of item.components ?? []) {
      if (!/\/Recipes\//.test(c.uniqueName)) continue;
      product.set(c.uniqueName, c.name === "Blueprint" ? { name: item.name, unique: item.uniqueName, parent: item.name } : { name: `${item.name} ${c.name.replace(/ Blueprint$/, "")}`, unique: null, parent: item.name });
    }
  }
  return ready
    .map(([path, at]) => {
      const p = product.get(path);
      const name = p?.name ?? m.nameOf(path).replace(/ Blueprint$/, "");
      const item = p?.unique ? m.catalogByUnique.get(p.unique) : undefined;
      const points = item?.masterable && !m.isMastered(item.uniqueName) ? masteryPoints(item) : null;
      return { path, key: `${path}|${at}`, name, readyAt: at, ready: at <= now, points, image: m.imageOf(name) ?? (p ? m.imageOf(p.parent) : null) };
    })
    .sort((a, b) => a.readyAt - b.readyAt);
}
