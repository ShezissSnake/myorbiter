// Data from the Warframe Wiki: the modular part tables (recipes.ts) and Arcane Dissolution's
// yields and packs (vosfor.ts). It's under the wiki's licence (CC BY-NC-SA 3.0), not orbiter's
// GPL, so it isn't compiled into orbiter's code: it ships beside it as plain files, with their
// licence, in public/data/wiki/ (the app's own files, /data/wiki/ in the window), and is read from
// there once at start. orbiter never fetches the wiki itself.

export interface WikiData {
  modularParts: unknown;
  modularExtra: unknown;
  vosfor: unknown;
}

/** The files, in public/data/wiki/ (LICENSE.md there says where each came from). */
export const WIKI_FILES: Record<keyof WikiData, string> = {
  modularParts: "modular-parts.json",
  modularExtra: "modular-parts-extra.json",
  vosfor: "vosfor.json",
};
export const WIKI_DIR = "/data/wiki/";

let data: WikiData | null = null;
let generation = 0;
let pending: Promise<void> | null = null;

/** Sets the data (the tests read the files themselves); null forgets it. */
export function setWikiData(d: WikiData | null): void {
  data = d;
  generation++;
}

/** The data, or null until it's loaded. */
export const wikiData = (): WikiData | null => data;
/** Changes whenever the data does: for views of it worked out once. */
export const wikiGeneration = (): number => generation;

const getJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

/** Reads the files from the app's own folder, once (again after a failure). */
export function loadWikiData(get: (url: string) => Promise<unknown> = getJson): Promise<void> {
  if (data) return Promise.resolve();
  pending ??= Promise.all((Object.keys(WIKI_FILES) as (keyof WikiData)[]).map(async (k) => [k, await get(WIKI_DIR + WIKI_FILES[k])] as const))
    .then((pairs) => setWikiData(Object.fromEntries(pairs) as unknown as WikiData))
    .finally(() => {
      pending = null;
    });
  return pending;
}
