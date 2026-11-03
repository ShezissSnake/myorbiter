// Builds: what you're missing for a build, against the inventory (missing.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import type { GearCopy } from "../src/lib/core/notNeeded";
import type { Bundle, InventoryRow } from "../src/lib/core/types";
import {
  endoCost,
  missing,
} from "../src/lib/core/builds";
import { CATALOG, P, build } from "./support/buildsCatalog";

// ---------------------------------------------------------------- what you're missing

const row = (item_id: string, name: string, category: string, quantity: number, rank: number | null = null): InventoryRow => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank, max_rank: null });

function model(inventory: InventoryRow[], gear: GearCopy[] | null, foundry: Record<string, number> | null = null) {
  const bundle: Bundle = { observed_at: null, inventory, catalog: CATALOG, relics: [], prices: { prices: { "Split Chamber": 12 } } };
  return buildModel(bundle, undefined, foundry, null, null, null, gear);
}

test("Endo to rank a mod: base by rarity, doubling each rank", () => {
  assert.equal(endoCost("Common", 0, 10), 10_230);
  assert.equal(endoCost("Rare", 0, 10), 30_690);
  assert.equal(endoCost("Legendary", 0, 10), 40_920);
  assert.equal(endoCost("Uncommon", 5, 10), 19_840);
  assert.equal(endoCost("Rare", 5, 3), 0);
  assert.equal(endoCost("Peculiar", 0, 3), null);
});

test("what you're missing: the item, mods at rank with Endo, arcane copies, Catalyst, adapters, Forma", () => {
  const m = model(
    [
      row(P.braton, "Braton", "weapon", 1),
      row(`${P.serration}#5`, "Serration", "mod", 1, 5),
      row(P.serration, "Serration", "mod", 2),
      row(`${P.pointStrike}#5`, "Point Strike", "mod", 1, 5),
      row(P.merciless, "Primary Merciless", "arcane", 3),
      row(`${P.merciless}#2`, "Primary Merciless", "arcane", 1, 2),
      row("/Lotus/Types/Items/MiscItems/OrokinCatalyst", "Orokin Catalyst", "resource", 1),
      row("/Lotus/Types/Recipes/Components/WeaponUtilityUnlockerBlueprint", "Exilus Weapon Adapter Blueprint", "blueprint", 1),
      row("/Lotus/Types/Items/MiscItems/Forma", "Forma", "resource", 1),
      row("/Lotus/Types/Recipes/Components/FormaBlueprint", "Forma Blueprint", "blueprint", 2),
    ],
    [{ type: P.braton, f: 0, p: 1 }, { type: P.braton, f: 1, p: 0 }],
    { "/Lotus/Types/Recipes/Components/FormaBlueprint": 1 },
  );
  const b = build(P.braton, [P.serration, P.splitChamber, P.vitalSense, P.pointStrike, P.hellfire, P.infectedClip, P.stormbringer, P.vigilante], { arcanes: [{ path: P.merciless }], exilus: { path: P.hellfire } });
  b.mods[4] = { path: P.serrationMid };
  const r = missing(b, m);
  const line = (kind: string, name?: string) => r.lines.find((l) => l.kind === kind && (!name || l.name === name))!;
  assert.equal(line("item").have, "ok");
  const serr = line("mod", "Serration");
  assert.equal(serr.have, "short");
  assert.equal(serr.heldRank, 5);
  assert.equal(serr.endo, 19_840);
  assert.equal(serr.text, "Held at rank 5, wanted at 10: 19,840 Endo to rank it.");
  const split = line("mod", "Split Chamber");
  assert.equal(split.have, "missing");
  assert.equal(split.price, 12);
  assert.match(split.how ?? "", /about 12 platinum/);
  assert.equal(line("mod", "Point Strike").have, "ok");
  const arc = line("arcane");
  assert.equal(arc.held, 3 + 6);
  assert.equal(arc.need, 21);
  assert.equal(arc.text, "9 of 21 copies for rank 5: 12 to go.");
  // The copy with the Catalyst is the one checked.
  assert.equal(r.copy?.f, 1);
  assert.equal(line("catalyst").have, "ok");
  assert.equal(line("catalyst").text, "Already on your copy.");
  const ex = line("exilus");
  assert.equal(ex.have, "short");
  assert.equal(ex.blueprints, 1);
  assert.equal(line("arcaneAdapter").have, "unknown", "the arcane adapter's bit isn't verified");
  const forma = line("forma");
  assert.ok(forma.need! > 0);
  assert.equal(forma.held, 1);
  assert.equal(forma.building, 1);
  assert.equal(forma.blueprints, 2);
  assert.ok(r.endo >= 19_840);
  assert.equal(r.todo, r.lines.filter((l) => l.have === "short" || l.have === "missing").length);
});

test("without TennoScope's gear read, what's on your copy is unknown, not missing", () => {
  const m = model([row(P.braton, "Braton", "weapon", 1)], null);
  const r = missing(build(P.braton, [P.serration, P.splitChamber, P.vitalSense, P.pointStrike]), m);
  const cat = r.lines.find((l) => l.kind === "catalyst")!;
  assert.equal(cat.have, "unknown");
  assert.equal(cat.onCopy, null);
});

test("shards by colour (a Tauforged one does a plain one's job), Helminth unknown, an item you lack says how", () => {
  const SHARD = "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystal";
  const m = model([row(`${SHARD}BorealMythic`, "Tauforged Azure Archon Shard", "resource", 2), row(`${SHARD}Amar`, "Crimson Archon Shard", "resource", 1)], []);
  const b = build(P.rhino, [P.vitality], {
    shards: [{ colour: "azure", tauforged: true }, { colour: "azure", tauforged: false }, { colour: "crimson", tauforged: true }, { colour: "emerald", tauforged: false }],
    helminth: { ability: "Nourish", replaces: "Roar" },
  });
  const r = missing(b, m);
  const shard = (c: string) => r.lines.find((l) => l.kind === "shard" && l.name.startsWith(c))!;
  assert.equal(shard("Azure").have, "ok");
  assert.equal(shard("Crimson").have, "short", "a plain shard doesn't do a Tauforged one's job");
  assert.equal(shard("Emerald").have, "missing");
  assert.equal(r.lines.find((l) => l.kind === "helminth")?.have, "unknown");
  const it = r.lines.find((l) => l.kind === "item")!;
  assert.equal(it.have, "missing");
  assert.equal(typeof it.how, "string");
});
