// What's in your Foundry and when each build is ready, from TennoScope's read of the inventory.
import { masteryPoints } from "./acquire";
import { baseId, type Model } from "./model";

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

type Product = { name: string; unique: string | null; parent: string };
/**
 * Each blueprint, by path: the item it builds (its own "Blueprint") or the part it makes. Worked
 * out once per catalog: the Foundry list is asked for on every clock tick, by several pages.
 */
const products = new WeakMap<Model["catalogByUnique"], Map<string, Product>>();
function productsOf(m: Model): Map<string, Product> {
  let product = products.get(m.catalogByUnique);
  if (product) return product;
  product = new Map<string, Product>();
  for (const item of m.catalogByUnique.values()) {
    for (const c of item.components ?? []) {
      if (!/\/Recipes\//.test(c.uniqueName)) continue;
      product.set(c.uniqueName, c.name === "Blueprint" ? { name: item.name, unique: item.uniqueName, parent: item.name } : { name: `${item.name} ${c.name.replace(/ Blueprint$/, "")}`, unique: null, parent: item.name });
    }
  }
  products.set(m.catalogByUnique, product);
  return product;
}

export function foundryBuilds(m: Model, ready: [string, number][], now = Date.now()): FoundryBuild[] {
  if (!ready.length) return [];
  const product = productsOf(m);
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

/** When each item being built in the Foundry is ready (its main blueprint), by the item's path. */
export function itemReadyTimes(m: Model, ready: [string, number][]): Map<string, number> {
  const byRecipe = new Map<string, string>();
  for (const item of m.catalogByUnique.values()) {
    for (const c of item.components ?? []) if (c.name === "Blueprint") byRecipe.set(c.uniqueName, item.uniqueName);
  }
  const out = new Map<string, number>();
  for (const [path, at] of ready) {
    const unique = byRecipe.get(baseId(path));
    if (unique && !(at >= (out.get(unique) ?? Infinity))) out.set(unique, at);
  }
  return out;
}

/**
 * Something you'll level for mastery: in your arsenal ("level"), built and waiting in the Foundry
 * ("claim"), or still building ("building", with when it's ready if TennoScope said).
 */
export type LevelStage = { stage: "level" } | { stage: "claim" } | { stage: "building"; readyAt: number | null };

export function levelStage(m: Model, unique: string, readyAt: Map<string, number>, now = Date.now()): LevelStage {
  const building = m.building(unique);
  if (building <= 0 || m.owned(unique) - building > 0) return { stage: "level" };
  const at = readyAt.get(unique) ?? null;
  return at != null && at <= now ? { stage: "claim" } : { stage: "building", readyAt: at };
}
