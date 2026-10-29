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
