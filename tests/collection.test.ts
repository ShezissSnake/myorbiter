// Collection items and their parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { distinctComponents } from "../src/lib/core/collection";
import type { Component } from "../src/lib/core/types";

const comp = (name: string, uniqueName: string): Component => ({ name, uniqueName, itemCount: 1 }) as Component;

test("two parts with one name are told apart, so a list keyed by name doesn't break (Wrath's two Blades)", () => {
  const out = distinctComponents([
    comp("Blade", "/Lotus/Types/Recipes/Weapons/WeaponParts/OrionScytheBlade"),
    comp("Blueprint", "/Lotus/Types/Recipes/Weapons/OrionScytheBlueprint"),
    comp("Handle", "/Lotus/Types/Recipes/Weapons/WeaponParts/OrionScytheHandle"),
    comp("Blade", "/Lotus/Types/Recipes/Weapons/WeaponParts/SiriusScytheBlade"),
  ]).map((c) => c.name);
  assert.deepEqual(out, ["Orion Blade", "Blueprint", "Handle", "Sirius Blade"]);
  // Paths that don't tell them apart: numbered.
  assert.deepEqual(distinctComponents([comp("Blade", "/x/Blade"), comp("Blade", "/y/Blade")]).map((c) => c.name), ["Blade 1", "Blade 2"]);
  const plain = [comp("Blade", "/x/Blade"), comp("Hilt", "/x/Hilt")];
  assert.equal(distinctComponents(plain), plain, "nothing to do: the same list back");
});

test("items TennoScope names from their path get their real names: a new relic, a Zid-An arcane", async () => {
  const { withKnownNames } = await import("../src/lib/core/model");
  const row = (item_id: string, name: string, category: string) => ({ item_id, name, category, quantity: 5, mastered: false, image_name: null, rank: null, max_rank: null });
  const b = withKnownNames({
    observed_at: 1,
    inventory: [row("/Lotus/Types/Game/Projections/T4VoidProjectionCitrinePrimeCBronze", "T 4 Void Projection Citrine Prime C Bronze", "relic"), row("/Lotus/Upgrades/CosmeticEnhancers/Antiques/UltimateInvisibilty", "Ultimate Invisibilty", "arcane"), row("/x/Lith", "Lith A1 Intact", "relic")],
    catalog: [],
    relics: [{ uniqueName: "/Lotus/Types/Game/Projections/T4VoidProjectionCitrinePrimeCBronze", name: "Axi C13 Intact", rewards: [] }],
    prices: {},
  } as unknown as import("../src/lib/core/types").Bundle);
  assert.deepEqual(b.inventory.map((r) => r.name), ["Axi C13 Intact", "Zid-An Sek-Eel", "Lith A1 Intact"]);
});
