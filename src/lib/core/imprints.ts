// Kubrow and Kavat imprints (and Vulpaphyla, Predasite and Helminth Charger ones): the patched
// TennoScope passes your inventory's imprint rows through whole. warframe.market lists them by breed
// ("Sunika Kubrow Imprint"), under the companion's own path, so what matters in a row is which breed
// it carries.

/** One imprint as the inventory gives it (`KubrowPetPrints`). */
export type ImprintRaw = Record<string, unknown>;

/** Companion paths end in …PowerSuit: Kubrows, Kavats, Vulpaphylas, Predasites, the Charger. */
const BREED = /PowerSuit$/;

function strings(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

/**
 * The breed an imprint carries: the companion path it names, looked for in its dominant traits
 * first (what hatches from it), then the rest of the row, recessive traits last (a recessive breed
 * doesn't hatch). Null when it names no companion `isBreed` knows.
 */
export function imprintBreed(raw: ImprintRaw, isBreed: (path: string) => boolean): string | null {
  const { DominantTraits, RecessiveTraits, ...rest } = raw;
  for (const part of [DominantTraits, rest, RecessiveTraits]) {
    const found = strings(part, []).find((s) => BREED.test(s) && isBreed(s));
    if (found) return found;
  }
  return null;
}

/** How many imprints you hold of each breed, by companion path; unread breeds under "". */
export function imprintCounts(raws: ImprintRaw[], isBreed: (path: string) => boolean): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of raws) {
    // A row that isn't one (a damaged settings file keeps the last read) is no imprint.
    if (!raw || typeof raw !== "object") continue;
    const breed = imprintBreed(raw, isBreed) ?? "";
    out.set(breed, (out.get(breed) ?? 0) + 1);
  }
  return out;
}

/**
 * What it takes to name a traded imprint the way warframe.market lists it: the imprints of the
 * last inventory read (each row names the pet it was taken from) and the market's imprint items.
 */
export interface ImprintNaming {
  /** The inventory's imprint rows (`KubrowPetPrints`), null before TennoScope has passed any. */
  rows: ImprintRaw[] | null;
  /** The market's imprint item for a companion path ("Huras Kubrow Imprint"), or null. */
  itemFor: (breed: string) => string | null;
  /** The name of every imprint the market lists. */
  names: string[];
}

/** How the game's trade log names an imprint: after the pet it was taken from ("Imprint of Biscuit"). */
const IMPRINT_OF = /^\s*imprint of\s+(.+?)\s*$/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The market item a traded imprint is ("Huras Kubrow Imprint"), from the log's "Imprint of <pet>":
 * the pet's name looked up in the inventory's imprints, which say its breed; failing that (the
 * imprint is gone from the last read, or two of that name are of different breeds), a breed named
 * in the text itself. Null when neither settles it on exactly one item: no guess, so no price.
 */
export function imprintSaleName(text: string, n: ImprintNaming): string | null {
  const hit = IMPRINT_OF.exec(text);
  if (!hit) return null;
  const pet = hit[1];
  const items = new Set<string>();
  for (const raw of n.rows ?? []) {
    if (!raw || typeof raw !== "object" || typeof raw.Name !== "string") continue;
    if (raw.Name.trim().toLowerCase() !== pet.toLowerCase()) continue;
    const breed = imprintBreed(raw, (p) => n.itemFor(p) != null);
    const item = breed ? n.itemFor(breed) : null;
    if (item) items.add(item);
  }
  if (items.size === 1) return [...items][0];
  // A breed in the text ("Imprint of Huras Kubrow"): the longest one named, when the others named
  // are part of it ("Kubrow" in "Huras Kubrow"); two different breeds settle nothing.
  const named = n.names
    .map((name) => ({ name, breed: name.replace(/\s+Imprint$/i, "") }))
    .filter(({ breed }) => breed && new RegExp(`(^|\\W)${escape(breed)}(\\W|$)`, "i").test(pet))
    .sort((a, b) => b.breed.length - a.breed.length);
  if (!named.length) return null;
  const longest = named[0];
  return named.every((x) => longest.breed.toLowerCase().includes(x.breed.toLowerCase())) ? longest.name : null;
}
