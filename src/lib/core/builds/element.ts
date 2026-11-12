// The bonus element of a Kuva, Tenet or Coda weapon: which one to pick for a build, and why.
//
// A Kuva or Tenet weapon gets a bonus element when it is made (the progenitor Warframe's element);
// a Coda weapon comes with one too. The game offers Heat, Cold, Electricity, Toxin, Impact,
// Magnetic and Radiation. No build source MyOrbiter reads names it: Nox's Frame has a field for it
// (`valence`) whose filled-in form MyOrbiter hasn't seen yet, so it stays in the build's note there.
// So it is worked out from the build's own mods: the element whose mod the bonus can replace with
// the build's elements unchanged, which frees that mod's slot.
//
// How elements combine, as the wiki describes it (not checked in game by MyOrbiter): mods' elements
// in slot order, each new base element combining with the first one still on its own; an element
// already present adds to it. The weapon's innate elements come after the mods, its own in the
// order Heat, Cold, Electricity, Toxin, then the bonus.

import type { CatalogItem } from "../types";
import type { Build, GearKind } from "./types";

export type BaseElement = "heat" | "cold" | "electricity" | "toxin";
export type CombinedElement = "blast" | "corrosive" | "gas" | "magnetic" | "radiation" | "viral";
export type Element = BaseElement | CombinedElement;
/** What the bonus can be. */
export type BonusChoice = BaseElement | "impact" | "magnetic" | "radiation";

export const ELEMENT_LABEL: Record<Element | "impact", string> = {
  heat: "Heat", cold: "Cold", electricity: "Electricity", toxin: "Toxin",
  blast: "Blast", corrosive: "Corrosive", gas: "Gas", magnetic: "Magnetic", radiation: "Radiation", viral: "Viral", impact: "Impact",
};
const BASE: BaseElement[] = ["heat", "cold", "electricity", "toxin"];
const COMBINED: Record<string, CombinedElement> = {
  "cold+heat": "blast",
  "electricity+toxin": "corrosive",
  "heat+toxin": "gas",
  "cold+electricity": "magnetic",
  "electricity+heat": "radiation",
  "cold+toxin": "viral",
};
const combine = (a: BaseElement, b: BaseElement): CombinedElement => COMBINED[[a, b].sort().join("+")];
const PARTS: Record<CombinedElement, [BaseElement, BaseElement]> = Object.fromEntries(Object.entries(COMBINED).map(([k, v]) => [v, k.split("+") as [BaseElement, BaseElement]])) as Record<CombinedElement, [BaseElement, BaseElement]>;

/** Weapons that get a bonus element: Kuva, Tenet and Coda ones (not Paracesis, which only shares their ranks). */
export const takesBonusElement = (item: Pick<CatalogItem, "name">, kind: GearKind): boolean =>
  /^(Kuva|Tenet|Coda|Dual Coda) /.test(item.name) && (kind === "primary" || kind === "secondary" || kind === "melee" || kind === "archgun");

const STAT = /^\+\d+(?:\.\d+)?% <DT_(?:FIRE|FREEZE|ELECTRICITY|POISON)_COLOR>(Heat|Cold|Electricity|Toxin)$/;

/** The base element a mod adds (Hellfire: heat), from its max-rank stats; null for none. */
export function elementOfMod(m: Pick<CatalogItem, "maxStats"> | undefined): BaseElement | null {
  for (const line of m?.maxStats ?? []) {
    const hit = STAT.exec(line.trim());
    if (hit) return hit[1].toLowerCase() as BaseElement;
  }
  return null;
}

/** The elements a list of base elements (in order) and innate combined ones end up as, in order. */
export function combineElements(order: BaseElement[], innateCombined: CombinedElement[] = []): Element[] {
  const out: Element[] = [];
  for (const e of order) {
    if (out.some((x) => x === e || (x in PARTS && PARTS[x as CombinedElement].includes(e)))) continue;
    const alone = out.findIndex((x) => (BASE as string[]).includes(x));
    if (alone >= 0) out[alone] = combine(out[alone] as BaseElement, e);
    else out.push(e);
  }
  for (const c of innateCombined) if (!out.includes(c)) out.push(c);
  return out;
}

export interface BonusElement {
  /** The element to pick, or null when the build gives nothing to go on. */
  element: BonusChoice | null;
  /** One line, without the element's name: why it suits this build, or why MyOrbiter can't say. */
  why: string;
  /** The mod whose slot it frees. */
  frees?: { path: string; name: string };
  /** What the build's elements are, with and without it the same ("Viral and Heat"). */
  result: Element[];
}

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));
const named = (es: Element[]) => list(es.map((e) => ELEMENT_LABEL[e]));

/**
 * The bonus element that suits a build of a Kuva, Tenet or Coda weapon, worked out from its mods;
 * null for any other weapon. `catalog`: the model's catalogByUnique.
 */
export function bonusElement(build: Pick<Build, "kind" | "mods">, item: CatalogItem, catalog: ReadonlyMap<string, CatalogItem>): BonusElement | null {
  if (!takesBonusElement(item, build.kind)) return null;
  const mods = build.mods
    .map((m) => (m ? { path: m.path, c: catalog.get(m.path) } : null))
    .map((m) => (m ? { path: m.path, name: m.c?.name ?? m.path, element: elementOfMod(m.c) } : null))
    .filter((m): m is { path: string; name: string; element: BaseElement | null } => !!m);
  const own = BASE.filter((e) => (item.damage?.[e] ?? 0) > 0);
  const ownCombined = (Object.keys(PARTS) as CombinedElement[]).filter((e) => (item.damage?.[e] ?? 0) > 0);
  const elems = (ms: typeof mods, bonus: BaseElement | null) => combineElements([...ms.map((m) => m.element).filter((e): e is BaseElement => !!e), ...own, ...(bonus ? [bonus] : [])], ownCombined);
  const result = elems(mods, null);
  if (!mods.some((m) => m.element)) return { element: null, why: "No elemental mods in this build, so MyOrbiter can't tell which bonus element suits it.", result };

  const same = (a: Element[], b: Element[]) => a.length === b.length && a.every((x) => b.includes(x));
  // Each elemental mod in slot order: can the bonus take its place with nothing else changing?
  for (const [i, m] of mods.entries()) {
    if (!m.element) continue;
    if (!same(elems(mods.filter((_, k) => k !== i), m.element), result)) continue;
    const label = ELEMENT_LABEL[m.element];
    const into = result.find((r) => r in PARTS && PARTS[r as CombinedElement].includes(m.element!));
    const why = into
      ? `The build still makes ${ELEMENT_LABEL[into]} with it, so ${m.name}'s slot is free for another mod.`
      : `The build keeps ${label} on its own${result.length > 1 ? ` beside ${named(result.filter((r) => r !== m.element))}` : ""}, so the bonus does ${m.name}'s job and frees its slot.`;
    return { element: m.element, why, frees: { path: m.path, name: m.name }, result };
  }
  return { element: null, why: `No bonus element can stand in for one of this build's elemental mods without changing its ${named(result)}.`, result };
}
