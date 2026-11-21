// The relic tables and the recipes are asked for at start and every 3 hours, and nearly always come
// back the same, as new objects. A new object rebuilds the collection's model (and every page's
// rows), so the page keeps the object it holds when the answer is the same. These tests count the
// rebuilds two same answers cause.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keepSame, type RelicData } from "../src/lib/core/relicData";
import type { RecipeData } from "../src/lib/core/buildPlan";

const LITH = "/Lotus/Types/Game/Projections/T1VoidProjectionABronze";
const tables = (checkedAt: number, paths: Record<string, string> = { [LITH]: "Lith A1 Intact" }): RelicData => ({
  hash: "h1",
  modified: 1_790_000_000_000,
  checkedAt,
  relics: [{ name: "Lith A1 Intact", rewards: [{ name: "Forma Blueprint", chance: 25.33, rarity: "Common" }] as RelicData["relics"][number]["rewards"] }],
  drops: { "Lith A1": [] },
  paths,
  bounties: [],
  sortie: [],
});
const BP = "/Lotus/Types/Recipes/ExampleBlueprint";
const recipes = (checkedAt: number, credits = 15_000): RecipeData => ({
  checkedAt,
  recipes: { [BP]: { c: credits, i: [["/Lotus/Types/Items/MiscItems/Rubedo", 2300]] } },
  names: { [BP]: { n: "Example", img: "", r: "", k: "chart" } },
});

/** Model rebuilds for these answers: one each time the object held changes. */
function rebuilds<T extends { checkedAt: number }>(answers: T[]): number {
  let held: T | null = null;
  let n = 0;
  for (const a of answers) {
    const next: T = keepSame(held, a);
    if (next !== held) {
      held = next;
      n++;
    }
  }
  return n;
}

test("two same answers of the relic tables build the model once, even checked at another time", () => {
  assert.equal(rebuilds([tables(1), tables(1)]), 1);
  assert.equal(rebuilds([tables(1), tables(2), tables(3)]), 1, "checkedAt says when it was checked, not what it holds");
});

test("two same answers of the recipes build the model once", () => {
  assert.equal(rebuilds([recipes(1), recipes(2)]), 1);
});

test("an answer that differs is taken: new paths, new tables, new recipes", () => {
  assert.equal(rebuilds([tables(1), tables(1, { [LITH]: "Lith A1 Intact", [`${LITH}2`]: "Lith A1 Intact" })]), 2, "a relic path more");
  assert.equal(rebuilds([tables(1), { ...tables(1), hash: "h2" }]), 2);
  assert.equal(rebuilds([recipes(1), recipes(1, 20_000)]), 2);
  const first = tables(1);
  assert.equal(keepSame(null, first), first, "the first answer is taken");
});

test("the page keeps what it holds for each answer of the tables and the recipes", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  assert.equal((app.match(/relicTables = keepSame\(relicTables, d\)/g) ?? []).length, 1);
  assert.equal((app.match(/recipes = keepSame\(recipes, r\)/g) ?? []).length, 2, "at start and on the 3-hour timer");
  assert.doesNotMatch(app, /\brelicTables = d\b|\brecipes = r\b/);
});
