// Builds: which catalog entry a name means, one rule for pasted text, the editor and MyOrbiter's
// suggestions (match.ts's entryFor). The item data has three "Pressure Point" entries: the Flawed
// one (rank 3), the plain one (rank 5) and WeaponMeleeDamageOnHeavyKillMod (rank 10, its stat
// line a raw label the game doesn't show); "Primed Pressure Point" is rank 10.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { entryFor, entryPenalty, matchName, nameIndex, parsePaste, slotNames } from "../src/lib/core/builds";
import { modIndex } from "../src/lib/core/builds/suggest";
import type { CatalogItem } from "../src/lib/core/types";

const catalog = (JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] }).catalog;
const PLAIN = "/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod";
const OTHER = "/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageOnHeavyKillMod";
const PRIMED = "/Lotus/Upgrades/Mods/Melee/Expert/WeaponMeleeDamageModExpert";
const nikana = catalog.find((c) => c.name === "Nikana Prime")!;
const byPath = new Map(catalog.map((c) => [c.uniqueName, c]));
const rankOf = (path: string | undefined) => (path ? byPath.get(path)?.maxRank : undefined);
// The catalog in either order, and a player who holds either copy.
const orders: [string, CatalogItem[]][] = [["as listed", catalog], ["reversed", [...catalog].reverse()]];
const holders: [string, (p: string) => number][] = [["holding nothing", () => 0], ["holding the rank-10 entry", (p) => (p === OTHER ? 3 : 0)], ["holding the plain one", (p) => (p === PLAIN ? 3 : 0)]];

test("the fixture holds both Pressure Point entries and the Primed one, with the item data's ranks", () => {
  assert.equal(rankOf(PLAIN), 5);
  assert.equal(rankOf(OTHER), 10);
  assert.equal(rankOf(PRIMED), 10);
  assert.equal(byPath.get(OTHER)?.name, "Pressure Point");
});

test("MyOrbiter's suggestions: Pressure Point by name is rank 5, Primed Pressure Point 10, whatever the catalog's order", () => {
  for (const [how, cat] of orders) {
    const idx = modIndex(cat);
    assert.equal(idx.byName.get("Pressure Point")?.uniqueName, PLAIN, how);
    assert.equal(idx.byName.get("Pressure Point")?.maxRank, 5, how);
    assert.equal(idx.byName.get("Primed Pressure Point")?.maxRank, 10, how);
    assert.equal(idx.byName.get("Adaptation")?.uniqueName, "/Lotus/Upgrades/Mods/Warframe/AvatarResistanceOnDamageMod", `${how}: not the Nemesis copy`);
  }
});

test("a pasted build: Pressure Point is rank 5 and Primed Pressure Point 10, whichever copy the player holds", () => {
  for (const [how, cat] of orders) {
    const map = new Map(cat.map((c) => [c.uniqueName, c]));
    for (const [who, held] of holders) {
      const r = parsePaste("Pressure Point, Primed Pressure Point", nikana, map, { held });
      const paths = r.build.mods.filter(Boolean).map((m) => m!.path);
      assert.deepEqual(paths.map(rankOf), [5, 10], `${how}, ${who}`);
    }
  }
});

test("the editor: a typed Pressure Point is rank 5, Primed Pressure Point 10, and both are offered for a melee", () => {
  for (const [how, cat] of orders) {
    const idx = nameIndex(cat);
    for (const [who, held] of holders) {
      // The editor's slot commits through matchName with what the player holds (BuildEditor.svelte's commit).
      const r = matchName("Pressure Point", idx, nikana, "melee", "mod", held);
      assert.ok(r.ok);
      assert.equal(r.item.maxRank, 5, `${how}, ${who}`);
      const p = matchName("Primed Pressure Point", idx, nikana, "melee", "mod", held);
      assert.ok(p.ok);
      assert.equal(p.item.maxRank, 10, `${how}, ${who}`);
    }
    // The list it offers reads each name as the same entry.
    assert.equal(entryFor(idx.byName.get("pressure point")!)?.uniqueName, PLAIN, how);
    const names = slotNames(idx, nikana, "melee", true);
    assert.ok(names.mod.includes("Pressure Point") && names.mod.includes("Primed Pressure Point"), how);
  }
});

test("a raw label in an entry's stats marks it as one the game doesn't show; ordinary stat text doesn't", () => {
  const base = { uniqueName: "/Lotus/Upgrades/Mods/X", name: "X", category: "Mods" } as CatalogItem;
  assert.equal(entryPenalty({ ...base, maxStats: ["+200% Melee Damage", "+120% COMBO COUNT CHANCE"] }), 20);
  assert.equal(entryPenalty({ ...base, maxStats: ["+120% Melee Damage"] }), 0);
  assert.equal(entryPenalty({ ...base, maxStats: ["WHILE IN VOID SLING: Press <PRE_ATTACK> to dissipate the endpoint in a 10m radius."] }), 0);
  assert.equal(entryPenalty({ ...base, maxStats: ["+30% Critical Chance for Heavy Attacks"] }), 0);
});
