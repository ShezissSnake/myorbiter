import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { alertNeeds, masteryHelp, type WorldAlert } from "../src/lib/core/worldNeeds";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const LANKA = "/Lotus/Weapons/Corpus/LongGuns/CrpBFG/Lanka";
const catalog = [
  {
    uniqueName: LANKA, name: "Lanka", category: "Primary", masterable: true, isPrime: false,
    components: [
      { uniqueName: "/Lotus/Types/Recipes/Weapons/LankaBlueprint", name: "Blueprint", ducats: 0, itemCount: 1 },
      { uniqueName: "/Lotus/Types/Items/MiscItems/OrokinCell", name: "Orokin Cell", ducats: 0, itemCount: 10 },
    ],
  },
  {
    uniqueName: "/Lotus/Weapons/Tenno/Melee/Glaive/Glaive", name: "Glaive", category: "Melee", masterable: true, isPrime: false,
    components: [{ uniqueName: "/Lotus/Types/Recipes/Weapons/GlaiveBlueprint", name: "Blueprint", ducats: 0, itemCount: 1 }],
  },
] as CatalogItem[];
const bundle = (inventory: InventoryRow[]): Bundle => ({ observed_at: 1_700_000_000, inventory, catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } });
const alert = (id: string, reward: { countedItems?: { uniqueName?: string; type: string; count?: number }[]; items?: string[] }, expiry = "2099-01-01T00:00:00Z"): WorldAlert =>
  ({ id, expiry, mission: { node: "Xini (Eris)", type: "Survival", faction: "Infested", reward } });

test("a blueprint for something you haven't mastered helps; resources and mastered items don't", () => {
  const m = buildModel(bundle([]));
  const h = masteryHelp(m, { uniqueName: "/Lotus/Types/Recipes/Weapons/LankaBlueprint", name: "Lanka Blueprint" });
  assert.equal(h?.item, "Lanka");
  assert.equal(h?.whole, false);
  assert.equal(h?.points, 3000);
  assert.equal(masteryHelp(m, { uniqueName: "/Lotus/Types/Items/MiscItems/OrokinCell", name: "Orokin Cell" }), null, "a resource many things take");
  // By name too, for alerts that only give names.
  assert.equal(masteryHelp(m, { name: "Glaive Blueprint" })?.item, "Glaive");
  const mastered = buildModel(bundle([inv(LANKA, "Lanka", "Primary", 0, { mastered: true })]));
  assert.equal(masteryHelp(mastered, { uniqueName: "/Lotus/Types/Recipes/Weapons/LankaBlueprint", name: "Lanka Blueprint" }), null);
  const held = buildModel(bundle([inv("/Lotus/Types/Recipes/Weapons/LankaBlueprint", "Lanka Blueprint", "blueprint", 1)]));
  assert.equal(masteryHelp(held, { uniqueName: "/Lotus/Types/Recipes/Weapons/LankaBlueprint", name: "Lanka Blueprint" }), null, "you hold the blueprint already");
});

test("alerts: mastery rewards and rare rewards, expired ones left out", () => {
  const m = buildModel(bundle([]));
  const alerts = [
    alert("a", { countedItems: [{ uniqueName: "/Lotus/Types/Recipes/Weapons/LankaBlueprint", type: "Lanka Blueprint" }] }),
    alert("b", { items: ["Orokin Catalyst Blueprint"] }),
    alert("c", { countedItems: [{ uniqueName: "/Lotus/Types/Gameplay/Events/X", type: "Road To Tau Event Resource", count: 50 }] }),
    alert("d", { items: ["Forma Blueprint"] }, "2000-01-01T00:00:00Z"),
  ];
  const r = alertNeeds(m, alerts, Date.parse("2026-10-28T00:00:00Z"));
  assert.deepEqual(r.mastery.map((x) => x.help?.item), ["Lanka"]);
  assert.deepEqual(r.rare.map((x) => x.reward), ["Orokin Catalyst Blueprint"]);
  // No inventory (a console): rare rewards still count, mastery can't be known.
  assert.equal(alertNeeds(null, alerts, Date.parse("2026-10-28T00:00:00Z")).rare.length, 1);
  assert.equal(alertNeeds(null, alerts, Date.parse("2026-10-28T00:00:00Z")).mastery.length, 0);
});
