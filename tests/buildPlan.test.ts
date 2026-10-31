import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { masteryRows } from "../src/lib/core/views";
import { buildPlan, shortLine, type RecipeData } from "../src/lib/core/buildPlan";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const W = "/Lotus/Types/Recipes/WarframeRecipes/";
const M = "/Lotus/Types/Items/MiscItems/";
const SARYN = "/Lotus/Powersuits/Saryn/Saryn";
const HILDRYN = "/Lotus/Powersuits/IronFrame/IronFrame";
const inv = (item_id: string, name: string, category: string, quantity: number): InventoryRow => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
const part = (uniqueName: string, name: string) => ({ uniqueName, name, itemCount: 1, drops: [] });
const frame = (unique: string, name: string, stem: string, cells: number): CatalogItem =>
  ({ uniqueName: unique, name, category: "Warframes", masterable: true, components: [
    part(`${W}${stem}Blueprint`, "Blueprint"),
    part(`${W}${stem}ChassisComponent`, "Chassis"),
    part(`${W}${stem}HelmetComponent`, "Neuroptics"),
    { uniqueName: `${M}OrokinCell`, name: "Orokin Cell", itemCount: cells, drops: [] },
    part(`${W}${stem}SystemsComponent`, "Systems"),
  ] }) as CatalogItem;
const catalog = [frame(SARYN, "Saryn", "Saryn", 1), frame(HILDRYN, "Hildryn", "Ironframe", 3)];
const bundle = (inventory: InventoryRow[]): Bundle => ({ observed_at: 1_700_000_000, inventory, catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } });
const recipes: RecipeData = {
  checkedAt: 0,
  recipes: {
    [SARYN]: { c: 25000, i: [] },
    [`${W}SarynSystemsComponent`]: { c: 15000, i: [[`${M}Morphic`, 1], [`${M}Salvage`, 550]] },
    [`${W}IronframeChassisComponent`]: { c: 15000, i: [["/Lotus/Types/Gameplay/Venus/Resources/ArachnoidCamperTerraItem", 2], [`${M}Rubedo`, 2300]] },
  },
  names: {
    [`${M}Morphic`]: { n: "Morphics", img: "", r: "RARE", k: "chart" },
    [`${M}Salvage`]: { n: "Salvage", img: "", r: "COMMON", k: "chart" },
    [`${M}Rubedo`]: { n: "Rubedo", img: "", r: "UNCOMMON", k: "chart" },
    "/Lotus/Types/Gameplay/Venus/Resources/ArachnoidCamperTerraItem": { n: "Lazulite Toroid", img: "", r: "RARE", k: "world" },
    [`${M}OrokinCell`]: { n: "Orokin Cell", img: "", r: "RARE", k: "chart" },
  },
};

test("Saryn with two parts built and the Systems blueprint: the Systems' resources and Saryn's own", () => {
  const m = buildModel(bundle([
    inv(`${W}SarynBlueprint`, "Saryn Blueprint", "blueprint", 1),
    inv(`${W}SarynChassisComponent`, "Saryn Chassis", "resource", 1),
    inv(`${W}SarynHelmetComponent`, "Saryn Neuroptics", "resource", 1),
    inv(`${W}SarynSystemsBlueprint`, "Saryn Systems Blueprint", "blueprint", 1),
    inv(`${M}Salvage`, "Salvage", "resource", 10_000),
  ]), undefined, null, null, null, recipes);
  const p = buildPlan(m, catalog[0], recipes);
  assert.deepEqual(p.parts.map((x) => [x.label, x.state]), [["Blueprint", "built"], ["Chassis", "built"], ["Neuroptics", "built"], ["Systems", "blueprint"]]);
  assert.deepEqual(p.short.map((r) => [r.name, r.need, r.have]), [["Morphics", 1, 0], ["Orokin Cell", 1, 0]]);
  assert.equal(p.tier, "farm");
  assert.equal(p.credits, 40000);
  assert.equal(shortLine(p.short), "1 Morphics, 1 Orokin Cell");
  const row = masteryRows(m).find((r) => r.name === "Saryn")!;
  assert.equal(row.status, "build", "every part in hand");
  assert.deepEqual([row.buildTier, row.acq.difficulty], ["farm", 2]);
});

test("Hildryn with her part blueprints but no Lazulite Toroid: not 'build it'", () => {
  const m = buildModel(bundle([
    inv(`${W}IronframeBlueprint`, "Hildryn Blueprint", "blueprint", 1),
    inv(`${W}IronframeChassisBlueprint`, "Hildryn Chassis Blueprint", "blueprint", 1),
    inv(`${W}IronframeHelmetComponent`, "Hildryn Neuroptics", "resource", 1),
    inv(`${W}IronframeSystemsComponent`, "Hildryn Systems", "resource", 1),
    inv(`${M}OrokinCell`, "Orokin Cell", "resource", 50),
    inv(`${M}Rubedo`, "Rubedo", "resource", 9000),
  ]), undefined, null, null, null, recipes);
  const row = masteryRows(m).find((r) => r.name === "Hildryn")!;
  assert.equal(row.buildTier, "hard");
  assert.ok(row.acq.difficulty >= 4);
  assert.match(row.acq.how, /2 Lazulite Toroid/);
});

test("everything in hand: build now", () => {
  const m = buildModel(bundle([
    inv(`${W}SarynBlueprint`, "Saryn Blueprint", "blueprint", 1),
    inv(`${W}SarynChassisComponent`, "Saryn Chassis", "resource", 1),
    inv(`${W}SarynHelmetComponent`, "Saryn Neuroptics", "resource", 1),
    inv(`${W}SarynSystemsComponent`, "Saryn Systems", "resource", 1),
    inv(`${M}OrokinCell`, "Orokin Cell", "resource", 3),
  ]), undefined, null, null, null, recipes);
  assert.equal(buildPlan(m, catalog[0], recipes).tier, "now");
});
