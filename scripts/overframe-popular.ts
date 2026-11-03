// Builds public/data/overframe/popular.json from Overframe's build lists, as collected in a
// browser (see public/data/overframe/README.md), and matches each build's item name to
// orbiter's catalog. Run with tsx:
//
//   npx tsx scripts/overframe-popular.ts <collected.json> <catalog-generation.json> [collected ISO date]
//
// <collected.json> is an array of { id, path, title, item, author, score, formas, created, updated,
// patch, category }: the list pages' fields only, never a build page's contents. The catalog is
// TennoScope's catalog/catalog-generation.json (or the dev bundle's, { catalog: [...] }).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { normName } from "../src/lib/core/builds/match";
import { buildKindOf } from "../src/lib/core/buildsPage";
import type { CatalogItem } from "../src/lib/core/types";
import type { GearKind } from "../src/lib/core/builds";
import { OVERFRAME_CATEGORIES, OVERFRAME_PERMISSION, OVERFRAME_SOURCE, type OverframeCategory, type OverframeFile, type OverframeListed } from "../src/lib/core/builds/overframeList";

const [collectedPath, catalogPath, when] = process.argv.slice(2);
if (!collectedPath || !catalogPath) {
  console.error("usage: tsx scripts/overframe-popular.ts <collected.json> <catalog.json> [collected ISO date]");
  process.exit(2);
}

type Raw = Omit<OverframeListed, "uniqueName"> & { category: OverframeCategory };
const raw = JSON.parse(readFileSync(collectedPath, "utf8")) as Raw[];
const catJson = JSON.parse(readFileSync(catalogPath, "utf8")) as { catalog: CatalogItem[] } | CatalogItem[];
const catalog = Array.isArray(catJson) ? catJson : catJson.catalog;

/** The gear kinds each of Overframe's list pages holds (its Companions tab is "sentinels"). */
const KINDS: Record<OverframeCategory, GearKind[]> = {
  warframes: ["warframe", "necramech", "exalted"],
  "primary-weapons": ["primary", "exalted"],
  "secondary-weapons": ["secondary", "exalted"],
  "melee-weapons": ["melee", "exalted"],
  archwing: ["archwing", "archgun", "archmelee"],
  sentinels: ["companion", "companionWeapon"],
};

/** Overframe's names that orbiter's catalog spells differently (checked by hand). */
const ALIASES: Record<string, string> = {};
/** Names the catalog holds twice for the same kind, and the one players build (checked by hand). */
const CHOSEN: Record<string, string> = {
  // The other is Doppelganger's copy (TnDoppelgangerGrimoire).
  grimoire: "/Lotus/Weapons/Tenno/Grimoire/TnGrimoire",
};

const byName = new Map<string, { unique: string; kind: GearKind }[]>();
for (const c of catalog) {
  const kind = buildKindOf(c);
  if (!kind || !c.name) continue;
  const k = normName(c.name);
  const list = byName.get(k) ?? [];
  list.push({ unique: c.uniqueName, kind });
  byName.set(k, list);
}

const unmatched = new Map<string, number>();
let matched = 0;
const builds: OverframeListed[] = raw.map((b) => {
  const want = normName(ALIASES[b.item] ?? b.item);
  const all = byName.get(want) ?? [];
  const fits = all.filter((x) => KINDS[b.category].includes(x.kind));
  const chosen = CHOSEN[want] ? fits.find((x) => x.unique === CHOSEN[want]) : undefined;
  const pick = chosen ?? (fits.length === 1 ? fits[0] : fits.length === 0 && all.length === 1 ? all[0] : null);
  if (pick) matched++;
  else {
    const key = `${b.item} (${b.category}${all.length > 1 ? `, ${all.length} in the catalog` : ""})`;
    unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
  }
  const { category, ...rest } = b;
  return { ...rest, category, ...(pick ? { uniqueName: pick.unique } : {}) };
});
builds.sort((a, b) => b.score - a.score || a.id - b.id);

const out: OverframeFile = {
  collected: when ?? new Date().toISOString(),
  source: OVERFRAME_SOURCE,
  permission: OVERFRAME_PERMISSION,
  categories: [...OVERFRAME_CATEGORIES],
  builds,
};
const target = "public/data/overframe/popular.json";
mkdirSync(dirname(target), { recursive: true });
// One build per line, so a refresh reads as a diff.
const { builds: list, ...head } = out;
const lines = JSON.stringify(head).replace(/}$/, ',"builds":[\n') + list.map((b) => JSON.stringify(b)).join(",\n") + "\n]}\n";
writeFileSync(target, lines);
console.log(`${builds.length} builds, ${matched} matched to the catalog (${((matched / builds.length) * 100).toFixed(1)}%)`);
if (unmatched.size) console.log("Unmatched items:\n" + [...unmatched.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k} ×${n}`).join("\n"));
