// The Codex rings on Mastery, Foundry and Wishlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { codexRings, ringsFor, rowGroup } from "../src/lib/core/codex";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, mastered = false): InventoryRow => ({ item_id, name, category, quantity, mastered, image_name: null, rank: null, max_rank: null });
const item = (uniqueName: string, name: string, category: string, masterable = true) => ({ uniqueName, name, category, masterable, components: [] });
const bundle = (inventory: InventoryRow[]): Bundle =>
  ({
    observed_at: 1,
    inventory,
    catalog: [
      item("/W/Rhino", "Rhino", "Warframes"),
      item("/W/Mesa", "Mesa", "Warframes"),
      item("/P/Braton", "Braton", "Primary"),
      item("/A/Imperator", "Imperator", "Arch-Gun"),
      item("/A/Odonata", "Odonata", "Archwing"),
      item("/S/Carrier", "Carrier", "Sentinels"),
      item("/X/Thing", "Thing", "Resources", false),
    ],
    relics: [],
    prices: { prices: {}, max_rank_prices: {} },
  }) as unknown as Bundle;

test("the Codex rings count mastered of every masterable item, per category, in the Codex's order", () => {
  const m = buildModel(bundle([inv("/W/Rhino", "Rhino", "frame", 1, true), inv("/A/Imperator", "Imperator", "weapon", 1, true)]));
  const rings = codexRings(m).map((r) => [r.group, r.mastered, r.total]);
  // Arch-guns and archwings are one category; nothing in Secondary or Melee: no ring for them.
  // (Other holds the masterable things the model always knows, the amps and the like: last.)
  assert.deepEqual(rings.slice(0, 4), [["warframes", 1, 2], ["primary", 0, 1], ["companions", 0, 1], ["archwing", 1, 2]]);
  assert.ok(rings.slice(4).every(([g]) => g === "other"));
});

test("a wishlist's rings: only the categories of what you starred, each counted once", () => {
  const m = buildModel(bundle([inv("/W/Rhino", "Rhino", "frame", 1, true)]));
  const rings = ringsFor(m, ["/W/Rhino", "/W/Mesa", "/W/Mesa", "/P/Braton", "/Unknown/Thing"]).map((r) => [r.group, r.mastered, r.total]);
  assert.deepEqual(rings, [["warframes", 1, 2], ["primary", 0, 1]]);
});

test("a Mastery row's category: its catalog entry, or the kind the inventory gives it", () => {
  const m = buildModel(bundle([]));
  assert.equal(rowGroup(m, "/A/Imperator", "Arch-Gun"), "archwing");
  assert.equal(rowGroup(m, "/Not/InCatalog", "Warframe"), "warframes");
  assert.equal(rowGroup(m, "/Not/InCatalog", "Companion"), "companions");
  assert.equal(rowGroup(m, "/Not/InCatalog", "Weapon"), "other");
});
