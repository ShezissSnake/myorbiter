// Where the tests that check the bundled lists against a catalog read it from: the player's own
// `public/dev-*.json` when it is there (the real catalog, from `npm run dev-bundle` and
// `npm run dev-data`), else the invented account in `demo/`, which is committed and holds the same
// files made from @wfcd/items (scripts/demo-data.mjs). Never the dev server, never a network read.
import { existsSync, readFileSync } from "node:fs";

export type CatalogSource = "public/" | "demo/";

/** The file `name` (e.g. "dev-bundle.json") from `public/` when it is there, else from `demo/`. */
export function catalogFile(name: string): { url: URL; source: CatalogSource } {
  const own = new URL(`../../public/${name}`, import.meta.url);
  if (existsSync(own)) return { url: own, source: "public/" };
  return { url: new URL(`../../demo/${name}`, import.meta.url), source: "demo/" };
}

/**
 * Names the demo catalog lacks that the bundled lists rightly hold: the demo is the game's catalog
 * cut down by scripts/demo-data.mjs, and the real catalog has each of these. Used only when a test
 * read `demo/`; a test on `public/` has no excuses. Each entry's reason is the filter in the script
 * (or the pinned @wfcd/items 1.1276.48) that leaves it out; a name that is not on this list or
 * under DEMO_OUT_TYPES fails the test.
 */
export const DEMO_NAMED: Record<string, string> = {
  // `mods.filter((m) => heldUpgrades.has(m.uniqueName) || (m.tradable && …))` (demo-data.mjs, "the
  // catalog the bundle carries"): the Umbra set mods cannot be traded and the account holds none.
  "Umbral Fiber": "untradable set mod, not held",
  "Umbral Intensify": "untradable set mod, not held",
  "Umbral Vitality": "untradable set mod, not held",
  // The same filter. Guess: the pinned package lists these two as untradable (it is not here to
  // read); the real catalog has both, as a Melee Mod and a Primary Mod.
  "Primed Fury": "not tradable in the pinned package (guess), not held",
  "Primed Shred": "not tradable in the pinned package (guess), not held",
  // The demo bundle holds no companion weapon at all (`Companion Weapon` rows): they are not among
  // the files demo-data.mjs reads, or not in the pinned package (guess). The real catalog has both.
  "Verglas": "companion weapon: none in the demo catalog",
  "Verglas Prime": "companion weapon: none in the demo catalog",
};

/**
 * The mod types demo-data.mjs keeps out unless held ("Archwing, arch-gun, K-Drive and Necramech mods
 * only where held, to keep the file small"). A name the demo lacks is excused by this only when the
 * real catalog's own row for it (`real`, the Builds fixture) is of one of these types.
 */
export const DEMO_OUT_TYPES = /Archwing|Arch-Gun|Arch-Melee|K-Drive|Necramech/;

/**
 * Of `wanted`, the names `have` lacks, less what a demo read excuses (see DEMO_NAMED and
 * DEMO_OUT_TYPES). `real` is the Builds fixture's catalog, a cut of the real one, to check the type.
 */
export function lacking(source: CatalogSource, wanted: Iterable<string>, have: { has(n: string): boolean }, real: { name: string; type?: string }[]): string[] {
  const out: string[] = [];
  for (const n of wanted) {
    if (have.has(n)) continue;
    if (source === "demo/" && (n in DEMO_NAMED || real.some((r) => r.name === n && DEMO_OUT_TYPES.test(r.type ?? "")))) continue;
    out.push(n);
  }
  return out;
}

/** Reads `name` and parses it; `source` says which of the two folders it came from, for a test's name. */
export function readCatalogFile<T>(name: string): { data: T; source: CatalogSource } {
  const { url, source } = catalogFile(name);
  return { data: JSON.parse(readFileSync(url, "utf8")) as T, source };
}
