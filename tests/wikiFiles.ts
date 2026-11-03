// The wiki's data files (public/data/wiki/), read the way the app reads them at start: imported
// for its effect by the tests that need them.
import { readFileSync } from "node:fs";
import { setWikiData, WIKI_FILES, type WikiData } from "../src/lib/core/wikiData";

export const wikiFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../public/data/wiki/${name}`, import.meta.url), "utf8"));

setWikiData(Object.fromEntries(Object.entries(WIKI_FILES).map(([k, f]) => [k, wikiFile(f)])) as unknown as WikiData);
