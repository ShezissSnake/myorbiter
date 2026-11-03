// What orbiter reads from its own backend and from warframe.market, checked before the pages use
// it. A file that came back empty, cut short or in an older shape should leave a page saying it
// has nothing, not throw halfway through drawing it.
import type { MarketItem } from "./market";
import type { RecipeData } from "./buildPlan";
import type { RelicData } from "./relicData";
import type { RivenMeta } from "./rivens";

const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const strOrNull = (x: unknown) => (typeof x === "string" ? x : null);
const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : null);

/** warframe.market's item list: the entries with an id, slug and name; anything else is no items. */
export function marketItemsOf(raw: unknown): MarketItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketItem[] = [];
  for (const x of raw) {
    if (!isObject(x) || typeof x.id !== "string" || typeof x.slug !== "string" || typeof x.name !== "string") continue;
    out.push({
      ...(x as unknown as MarketItem),
      gameRef: strOrNull(x.gameRef),
      maxRank: typeof x.maxRank === "number" ? x.maxRank : null,
      subtypes: strings(x.subtypes),
      tags: strings(x.tags),
    });
  }
  return out;
}

/** The Foundry recipes, or null when they aren't in the shape the Foundry reads. */
export function recipeDataOf(raw: unknown): RecipeData | null {
  if (!isObject(raw) || !isObject(raw.recipes) || !isObject(raw.names)) return null;
  const recipes: RecipeData["recipes"] = {};
  for (const [k, r] of Object.entries(raw.recipes)) {
    if (isObject(r) && typeof r.c === "number" && Array.isArray(r.i)) recipes[k] = { c: r.c, i: r.i.filter((p): p is [string, number] => Array.isArray(p) && typeof p[0] === "string" && typeof p[1] === "number") };
  }
  const names: RecipeData["names"] = {};
  for (const [k, n] of Object.entries(raw.names)) if (isObject(n) && typeof n.n === "string") names[k] = n as RecipeData["names"][string];
  return { checkedAt: typeof raw.checkedAt === "number" ? raw.checkedAt : 0, recipes, names };
}

/** The official drop tables' relics, or null when they aren't in the shape the relic pages read. */
export function relicDataOf(raw: unknown): RelicData | null {
  if (!isObject(raw) || !Array.isArray(raw.relics) || !isObject(raw.drops) || !isObject(raw.paths)) return null;
  const relics = raw.relics.filter((r): r is RelicData["relics"][number] => isObject(r) && typeof r.name === "string" && Array.isArray(r.rewards));
  return { ...(raw as unknown as RelicData), relics };
}

/** Riven weapons and stats; throws when they aren't there, so Rivens says it couldn't read them. */
export function rivenMetaOf(raw: unknown): RivenMeta {
  if (!isObject(raw) || !Array.isArray(raw.weapons) || !Array.isArray(raw.attributes)) throw new Error("warframe.market's riven list came back in a shape orbiter can't read");
  return {
    weapons: raw.weapons
      .filter((w): w is Record<string, unknown> => isObject(w) && typeof w.slug === "string" && typeof w.name === "string")
      .map((w) => ({ ...(w as unknown as RivenMeta["weapons"][number]), gameRef: typeof w.gameRef === "string" ? w.gameRef : "", group: typeof w.group === "string" ? w.group : "", rivenType: typeof w.rivenType === "string" ? w.rivenType : "" })),
    attributes: raw.attributes.filter((a): a is RivenMeta["attributes"][number] => isObject(a) && typeof a.slug === "string" && typeof a.name === "string"),
  };
}
