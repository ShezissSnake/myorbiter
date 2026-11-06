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
