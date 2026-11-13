// What building something takes from where you are: each part (built, its blueprint in hand,
// building, or still to get), and every resource still needed, the parts' own blueprints
// included. With Saryn's Neuroptics and Chassis built and only the Systems blueprint, that's the
// Systems' Morphics, Plastids, Salvage and Control Module plus Saryn's own Orokin Cell.
//
// How easy it is to build now comes from what's short:
//   now    every part and resource in hand
//   farm   only star-chart resources short (Orokin Cells, Morphics…): a few missions
//   hard   something from an open world or an event is short (Narmer Isoplast, Lazulite Toroid)
//   parts  a part is still to get, blueprint and all
import type { Model } from "./model";
import type { CatalogItem } from "./types";
import { distinctComponents, partState } from "./collection";

/** recipe-data.json (recipes.rs). */
export interface RecipeData {
  checkedAt: number;
  recipes: Record<string, { c: number; i: [string, number][] }>;
  names: Record<string, { n: string; img: string; r: string; k: "chart" | "world" }>;
}

export type BuildTier = "now" | "farm" | "hard" | "parts";

export const TIER_LABEL: Record<BuildTier, string> = {
  now: "Build now",
  farm: "Farm resources",
  hard: "Needs rare resources",
  parts: "Parts to get",
};
export const TIER_TIP: Record<BuildTier, string> = {
  now: "Every part and resource in hand",
  farm: "Every part in hand; some resources short that drop on the star chart",
  hard: "Every part in hand, but building needs resources from an open world or an event",
  parts: "A part is still to get",
};

/** The tag classes (app.css, `.tag.ok` and the rest) a state is drawn in; none is the plain tag. */
export type TagTone = "ok" | "warn" | "bad" | "";

/** Where the tag is drawn: an item card, a Foundry row (which names what is short) or the item's sheet. */
export type TagForm = "card" | "row" | "sheet";

/**
 * The tag for a build state: its words and its tone. Every state has words (a tag with none is a
 * bare coloured bar). `short` is what the plan says is still short; the Foundry's row names the
 * first of it.
 */
export function buildTag(tier: BuildTier, short: readonly string[] = [], form: TagForm = "card"): { label: string; tone: TagTone } {
  const more = short.length > 1 ? ` +${short.length - 1}` : "";
  switch (tier) {
    case "now":
      return { label: "Can build now", tone: "ok" };
    case "farm":
      return { label: `Parts ready · ${form === "row" && short.length ? `farm ${short[0]}${more}` : form === "sheet" ? "farm resources" : "farm"}`, tone: "warn" };
    case "hard":
      return { label: `Parts ready · ${form === "row" && short.length ? `needs ${short[0]}${more}` : form === "sheet" ? "needs rare resources" : "rare resources"}`, tone: "bad" };
    default:
      return { label: "Parts to get", tone: "" };
  }
}

export interface ResourceNeed {
  path: string;
  name: string;
  image: string | null;
  need: number;
  have: number;
  /** chart: drops on the star chart; world: an open world, an event, fishing or mining; item: a weapon or the like. */
  kind: "chart" | "world" | "item";
  /** What it's for: "Systems", or the item itself. */
  for: string[];
}

export interface PartPlan {
  label: string;
  name: string;
  image: string | null;
  state: "built" | "blueprint" | "building" | "missing";
  /** What its blueprint takes, when it's held as a blueprint. */
  needs: { name: string; need: number }[];
}

export interface BuildPlan {
  parts: PartPlan[];
  /** Every resource still to use, totalled: the item's own and its parts' that aren't built yet. */
  resources: ResourceNeed[];
  /** The resources you don't have enough of. */
  short: ResourceNeed[];
  /** Credits for every build still to do. */
  credits: number;
  tier: BuildTier;
  /** False when MyOrbiter has no recipes for the parts (offline the first time): only the item's own blueprint counted. */
  complete: boolean;
}

const COMPONENT = /Component$/;

function nameOf(m: Model, recipes: RecipeData | null, path: string): { name: string; image: string | null; kind: ResourceNeed["kind"] } {
  const n = recipes?.names[path];
  if (n) return { name: n.n, image: n.img || m.imageOf(n.n), kind: n.k };
  const item = m.catalogByUnique.get(path);
  if (item) return { name: item.name, image: item.imageName ?? m.imageOf(item.name), kind: "item" };
  const name = m.nameOf(path);
  return { name, image: m.imageOf(name), kind: /\/MiscItems\/|\/Research\//.test(path) ? "chart" : "world" };
}

export function buildPlan(m: Model, item: CatalogItem, recipes: RecipeData | null = null): BuildPlan {
  const totals = new Map<string, ResourceNeed>();
  const add = (path: string, count: number, forWhat: string) => {
    let t = totals.get(path);
    if (!t) {
      const n = nameOf(m, recipes, path);
      t = { path, name: n.name, image: n.image, need: 0, have: m.owned(path), kind: n.kind, for: [] };
      totals.set(path, t);
    }
    t.need += count;
    if (!t.for.includes(forWhat)) t.for.push(forWhat);
  };
  let credits = 0;
  let complete = true;
  const building = m.building(item.uniqueName) > 0;
  if (!building) credits += recipes?.recipes[item.uniqueName]?.c ?? 0;
  const parts: PartPlan[] = [];
  for (const c of distinctComponents(item.components ?? [])) {
    const s = partState(m, item, c);
    if (s.resource) {
      if (!building) add(c.uniqueName, s.required, item.name);
      continue;
    }
    // The item's own blueprint, or a whole weapon it's built from (Akbronco takes two Broncos).
    const isPartBp = COMPONENT.test(c.uniqueName);
    const built = isPartBp ? m.owned(c.uniqueName) : 0;
    let state: PartPlan["state"];
    if (building || s.building) state = "building";
    else if (!isPartBp) state = s.have >= s.required ? "built" : "missing";
    else if (built >= s.required) state = "built";
    else if (s.have >= s.required) state = "blueprint";
    else state = "missing";
    const needs: PartPlan["needs"] = [];
    if (state === "blueprint") {
      const r = recipes?.recipes[c.uniqueName];
      if (!r) complete = false;
      else {
        credits += r.c * (s.required - built);
        for (const [path, count] of r.i) {
          add(path, count * (s.required - built), s.label);
          needs.push({ name: nameOf(m, recipes, path).name, need: count * (s.required - built) });
        }
      }
    }
    parts.push({ label: s.label, name: s.name, image: s.image, state, needs });
  }
  const resources = [...totals.values()].sort((a, b) => Number(b.need > b.have) - Number(a.need > a.have) || a.name.localeCompare(b.name));
  const short = resources.filter((r) => r.have < r.need);
  const tier: BuildTier = parts.some((p) => p.state === "missing")
    ? "parts"
    : !short.length
      ? "now"
      : short.some((r) => r.kind !== "chart")
        ? "hard"
        : "farm";
  return { parts, resources, short, credits, tier, complete: complete && !!recipes };
}

/** "3 Orokin Cell, 550 Salvage and 1 more": what's short, in a line. */
export function shortLine(short: ResourceNeed[], max = 3): string {
  const xs = short.map((r) => `${(r.need - r.have).toLocaleString("en")} ${r.name}`);
  return xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`;
}
