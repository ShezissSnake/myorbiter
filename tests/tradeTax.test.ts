// The trading tax on a "Put my spares on sale" plan, from the wiki's Trading tax table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { planTax, taxEach, TAX } from "../src/lib/core/tradeTax";
import type { BulkAction } from "../src/lib/core/bulk";
import type { MarketItem, MyOrder } from "../src/lib/core/market";
import type { Bundle, CatalogItem } from "../src/lib/core/types";

const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const model = buildModel({
  observed_at: 1, inventory: [], relics: [], prices: { prices: {}, max_rank_prices: {} },
  catalog: [
    { uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [
      { uniqueName: "/R/Bp", name: "Blueprint", ducats: 15, itemCount: 1 },
      { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
      { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 100, itemCount: 1 },
      { uniqueName: "/R/Systems", name: "Systems", ducats: 15, itemCount: 1 },
    ] },
    { uniqueName: "/A/Energize", name: "Arcane Energize", category: "Arcanes", rarity: "Legendary" },
    { uniqueName: "/A/Grace", name: "Arcane Grace", category: "Arcanes", rarity: "Rare" },
    { uniqueName: "/M/Serration", name: "Serration", category: "Mods", rarity: "Uncommon" },
    { uniqueName: "/M/PrimedChamber", name: "Primed Chamber", category: "Mods", rarity: "Legendary" },
  ] as CatalogItem[],
} as Bundle);
const item = (name: string, gameRef: string | null, tags: string[]): MarketItem => ({ id: name, slug: name, gameRef, name, maxRank: null, subtypes: null, tags });

test("each kind's tax: parts and sets by their parts, mods and arcanes by rarity and rank, relics by era", () => {
  assert.equal(taxEach(model, "part", item("Rhino Prime Systems Blueprint", "/R/Systems", ["prime"])), 2_000);
  assert.equal(taxEach(model, "set", item("Rhino Prime Set", RHINO, ["set"])), 8_000, "four parts at 2,000");
  assert.equal(taxEach(model, "set", item("Mystery Set", "/Nope", ["set"])), null);
  assert.equal(taxEach(model, "mod", item("Serration", "/M/Serration", ["mod"])), 4_000);
  assert.equal(taxEach(model, "mod", item("Primed Chamber", "/M/PrimedChamber", ["mod"])), 1_000_000);
  assert.equal(taxEach(model, "mod", item("Odd Mod", null, ["mod", "rare"])), 8_000, "rarity from warframe.market's tags");
  assert.equal(taxEach(model, "mod", item("Unknown Mod", null, ["mod"])), null);
  assert.equal(taxEach(model, "arcane", item("Arcane Energize", "/A/Energize", ["arcane_enhancement"]), 5), 2_100_000);
  assert.equal(taxEach(model, "arcane", item("Arcane Grace", "/A/Grace", ["arcane_enhancement"]), 0), 8_000);
  assert.equal(taxEach(model, "arcane", item("Arcane Grace", "/A/Grace", ["arcane_enhancement"]), 5), 168_000);
  assert.equal(taxEach(model, "other", item("Lith K1 Relic", null, ["relic"])), 2_000);
  assert.equal(taxEach(model, "other", item("Axi A1 Relic", null, ["relic"])), 4_000);
  assert.equal(taxEach(model, "other", item("Requiem I Relic", null, ["relic"])), null);
  assert.equal(taxEach(model, "other", item("Rifle Riven Mod (Veiled)", null, ["mod"])), TAX.rare);
  assert.equal(taxEach(model, "other", item("Ayatan Anasa Sculpture", null, ["ayatan_sculpture"])), 4_000);
  assert.equal(taxEach(model, "imprint", item("Chesa Kubrow Imprint", null, ["imprint"])), 2_000);
});

test("a plan's tax: every copy of its new and resized listings; removals and skips cost nothing", () => {
  const order = (quantity: number, rank: number | null = null): MyOrder => ({ id: "o", itemId: "x", type: "sell", platinum: 10, quantity, rank, subtype: null, visible: true, updatedAt: null });
  const actions: BulkAction[] = [
    { type: "create", kind: "set", item: item("Rhino Prime Set", RHINO, ["set"]), rank: null, subtype: null, quantity: 2, platinum: 60, why: "", priceWhy: "" },
    { type: "update", kind: "arcane", item: item("Arcane Grace", "/A/Grace", ["arcane_enhancement"]), order: order(1, 5), quantity: 3, platinum: 30, why: "", priceWhy: "" },
    { type: "create", kind: "mod", item: item("Unknown Mod", null, ["mod"]), rank: 0, subtype: null, quantity: 1, platinum: 5, why: "", priceWhy: "" },
    { type: "remove", kind: "mod", item: item("Serration", "/M/Serration", ["mod"]), order: order(4), why: "" },
    { type: "skip", kind: "mod", name: "Serration", rank: 0, why: "" },
  ];
  const t = planTax(model, actions);
  assert.equal(t.credits, 2 * 8_000 + 3 * 168_000);
  assert.equal(t.maroo, Math.round(t.credits * 1.1));
  assert.equal(t.items, 5);
  assert.deepEqual(t.unknown, ["Unknown Mod"]);
  assert.deepEqual(planTax(model, []), { credits: 0, maroo: 0, items: 0, unknown: [] });
});
