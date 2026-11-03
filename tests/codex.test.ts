// The Codex rings on Mastery, Foundry and Wishlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { codexRings, ringsFor, ringTotal, rowGroups, someNames, starredBy } from "../src/lib/core/codex";
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
  // Arch-guns and archwings are one category; nothing in Melee: no ring for it. The model always
  // knows the Infested kitgun chambers (Primary and Secondary both), the Plexus (Companions) and the
  // amps (their own ring); nothing is left in Other, so it has no ring.
  assert.deepEqual(rings, [["warframes", 1, 2], ["primary", 0, 3], ["secondary", 0, 2], ["companions", 0, 2], ["archwing", 1, 2], ["amps", 0, 8]]);
});

test("a wishlist's rings: only the categories of what you starred, each counted once", () => {
  const m = buildModel(bundle([inv("/W/Rhino", "Rhino", "frame", 1, true)]));
  const rings = ringsFor(m, ["/W/Rhino", "/W/Mesa", "/W/Mesa", "/P/Braton", "/Unknown/Thing"]).map((r) => [r.group, r.mastered, r.total]);
  assert.deepEqual(rings, [["warframes", 1, 2], ["primary", 0, 1]]);
});

test("a Mastery row's category: its catalog entry, or the kind the inventory gives it", () => {
  const m = buildModel(bundle([]));
  assert.deepEqual(rowGroups(m, "/A/Imperator", "Arch-Gun"), ["archwing"]);
  assert.deepEqual(rowGroups(m, "/Not/InCatalog", "Warframe"), ["warframes"]);
  assert.deepEqual(rowGroups(m, "/Not/InCatalog", "Companion"), ["companions"]);
  assert.deepEqual(rowGroups(m, "/Not/InCatalog", "Weapon"), ["other"]);
});

test("the All ring adds up every category's, each item once (a kitgun chamber is in two)", () => {
  const m = buildModel(bundle([inv("/W/Rhino", "Rhino", "frame", 1, true), inv("/A/Imperator", "Imperator", "weapon", 1, true)]));
  const rings = codexRings(m);
  const t = ringTotal(rings);
  assert.equal(t.mastered, rings.reduce((n, r) => n + r.mastered, 0));
  // Sporelacer and Vermisplicer are in Primary and Secondary: counted once.
  assert.equal(t.total, rings.reduce((n, r) => n + r.total, 0) - 2);
  assert.equal(t.total, m.catalogByUnique.size - 1, "every masterable item once (the resource isn't one)");
  assert.deepEqual(ringTotal([]), { mastered: 0, total: 0 });
});

test("Wishlist's marks: how many you starred in each category, each item once", () => {
  const m = buildModel(bundle([]));
  assert.deepEqual(starredBy(m, ["/W/Rhino", "/W/Mesa", "/W/Mesa", "/A/Imperator", "/Unknown/Thing"]), { warframes: 2, archwing: 1 });
  assert.deepEqual(starredBy(m, []), {});
});

test("a few names, then how many more", () => {
  assert.equal(someNames([]), "");
  assert.equal(someNames(["Gauss"]), "Gauss");
  assert.equal(someNames(["Gauss", "Lavos"]), "Gauss, Lavos");
  assert.equal(someNames(["Gauss", "Lavos", "Ash", "Mesa"]), "Gauss, Lavos +2");
  assert.equal(someNames(["Gauss", "Lavos", "Ash"], 1), "Gauss +2");
});
