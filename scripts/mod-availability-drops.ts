// Regenerates `fullDrops` in src/lib/data/mod-availability.json.
//
// MyOrbiter's catalog keeps eight drop sources per item (crates/myorbiter-data, slim_drops), best
// chance first, so a mod that drops everywhere at a low chance (Serration) can look like a
// spy-vault exclusive. This reads the full catalog TennoScope downloads (WFCD's, with DE's drop
// tables) and records, by path, the level from the full list wherever it is earlier than the
// level from MyOrbiter's eight.
//
//   npx tsx scripts/mod-availability-drops.ts <catalog-generation.json> <dev-bundle.json>
//
// Both files are read, nothing is fetched.

import { readFileSync, writeFileSync } from "node:fs";
import { dropsLevel, availabilityRank } from "../src/lib/core/builds/availability";
import type { CatalogItem, Drop } from "../src/lib/core/types";

const [fullPath, bundlePath] = process.argv.slice(2);
if (!fullPath || !bundlePath) {
  console.error("usage: tsx scripts/mod-availability-drops.ts <catalog-generation.json> <dev-bundle.json>");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(fullPath, "utf8")) as { catalog: CatalogItem[] } | CatalogItem[];
const full = Array.isArray(raw) ? raw : raw.catalog;
const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as { catalog: CatalogItem[] };
const slim = new Map(bundle.catalog.map((c) => [c.uniqueName, c]));

const levels: Record<string, string> = {};
for (const c of full) {
  if (c.category !== "Mods" && c.category !== "Arcanes") continue;
  const all = (c.drops ?? []).filter((d: Drop) => d && typeof d.location === "string");
  const whole = dropsLevel(all);
  const eight = dropsLevel(slim.get(c.uniqueName)?.drops);
  if (whole && (!eight || availabilityRank(whole) < availabilityRank(eight))) levels[c.uniqueName] = whole;
}

const file = new URL("../src/lib/data/mod-availability.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
data.fullDrops.levels = Object.fromEntries(Object.entries(levels).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`${Object.keys(levels).length} items whose full drop table is earlier than MyOrbiter's eight`);
