import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, normaliseStoreUnique, partFullName, splitRelicName } from "../src/lib/core/model";
import { arcaneRows, copiesForRank, masteryRows, modRows, partRows, relicRows, setRows } from "../src/lib/core/views";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});

const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [
    {
      uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, vaulted: true,
      components: [
        { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 },
        { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 45, itemCount: 1 },
        { uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 },
        { uniqueName: "/Lotus/Types/Items/MiscItems/OrokinCell", name: "Orokin Cell", itemCount: 5 },
      ],
    },
    { uniqueName: "/A/Energize", name: "Arcane Energize", category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true },
    { uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10, tradable: true },
  ],
  relics: [
    { uniqueName: "/Relic/R1Bronze", name: "Axi R1 Intact", vaulted: true, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 2 }, { name: "Forma Blueprint", rarity: "Common", chance: 98 }] },
    { uniqueName: "/Relic/R1Platinum", name: "Axi R1 Radiant", vaulted: true, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 10 }, { name: "Forma Blueprint", rarity: "Common", chance: 90 }] },
  ],
  prices: {
    prices: { "Rhino Prime Set": 60, "Rhino Prime Blueprint": 20, "Rhino Prime Chassis Blueprint": 5, "Rhino Prime Neuroptics Blueprint": 10, "Rhino Prime Systems Blueprint": 30, "Arcane Energize": 8, "Serration": 3 },
    max_rank_prices: { "Arcane Energize": 160 },
  },
});

const fullSet = (n: number) => [
  inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", n),
  inv("/R/Chassis", "Rhino Prime Chassis Blueprint", "prime_part", n),
  // warframe part blueprints live under another path in TennoScope; matched by name
  inv("/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeHelmetBlueprint", "Rhino Prime Neuroptics Blueprint", "prime_part", n),
  inv("/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeSystemsBlueprint", "Rhino Prime Systems Blueprint", "prime_part", n + 1),
];

test("names", () => {
  assert.deepEqual(splitRelicName("Lith C13 Intact"), { base: "Lith C13", refinement: "Intact" });
  assert.equal(splitRelicName("Lith C13"), null);
  assert.equal(partFullName({ uniqueName: "", name: "Rhino Prime", category: "Warframes" }, { uniqueName: "", name: "Chassis" }), "Rhino Prime Chassis Blueprint");
  assert.equal(partFullName({ uniqueName: "", name: "Boar Prime", category: "Primary" }, { uniqueName: "", name: "Stock" }), "Boar Prime Stock");
  assert.equal(normaliseStoreUnique("/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionXBronze"), "/Lotus/Types/Game/Projections/T1VoidProjectionX");
});

test("keeps one set when the frame is neither owned nor mastered", () => {
  const [row] = setRows(buildModel(bundle(fullSet(2))));
  assert.equal(row.completeSets, 2);
  assert.equal(row.sellable, 1);
  assert.equal(row.keptForBuild, true);
  assert.equal(row.ducats, 205);
  assert.equal(row.partsPrice, 65);
});

test("all sets are sellable once mastered", () => {
  const rows = [...fullSet(2), inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })];
  const [row] = setRows(buildModel(bundle(rows)));
  assert.equal(row.sellable, 2);
  assert.deepEqual(row.missing.map((x) => x.name), ["Rhino Prime Blueprint", "Rhino Prime Chassis Blueprint", "Rhino Prime Neuroptics Blueprint"]);
});

test("prime parts know their parent's mastery and vault state", () => {
  const rows = [...fullSet(1), inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })];
  const parts = partRows(buildModel(bundle(rows)));
  const sys = parts.find((p) => p.name === "Rhino Prime Systems Blueprint")!;
  assert.equal(sys.parentMastered, true);
  assert.equal(sys.quantity, 2);
  assert.equal(sys.spare, 2);
  assert.equal(sys.availability, "vaulted");
});

test("vaulted relic in Varzia's stock counts as resurgence", () => {
  const m2 = buildModel({ ...bundle(fullSet(1)), relics: bundle([]).relics.map((r) => ({ ...r, uniqueName: r.uniqueName.replace("/Relic/", "/Lotus/Types/Relic/") })) },
    { fissures: null, resurgence: [{ uniqueName: "/Lotus/StoreItems/Types/Relic/R1Bronze", item: "Axi R1" }], resurgenceExpiry: null });
  assert.equal(partRows(m2).find((p) => p.name === "Rhino Prime Systems Blueprint")!.availability, "resurgence");
});

test("an item in Varzia's stock makes its vaulted parts resurgence", () => {
  const m = buildModel(bundle(fullSet(1)), { fissures: null, resurgence: [{ uniqueName: "/Lotus/StoreItems/Powersuits/Rhino/RhinoPrime", item: "Rhino Prime" }], resurgenceExpiry: null });
  assert.equal(partRows(m).find((p) => p.name === "Rhino Prime Systems Blueprint")!.availability, "resurgence");
});

test("mastery to-do lists the missing prime with its relics", () => {
  const rows = masteryRows(buildModel(bundle([inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", 1), inv("/Relic/R1Platinum", "Axi R1 Radiant", "relic", 2)])));
  const rhino = rows.find((r) => r.name === "Rhino Prime")!;
  assert.equal(rhino.status, "parts");
  assert.equal(rhino.partsOwned, 1);
  assert.equal(rhino.ownedRelicsForIt, 1);
  assert.equal(rhino.vaulted, true);
});

test("arcane collection counts fused copies", () => {
  assert.equal(copiesForRank(5), 21);
  const m = buildModel(bundle([
    inv("/A/Energize#3", "Arcane Energize", "arcane", 1, { rank: 3 }),
    inv("/A/Energize", "Arcane Energize", "arcane", 4),
  ]));
  const a = arcaneRows(m).find((r) => r.name === "Arcane Energize")!;
  assert.equal(a.copies, 14);
  assert.equal(a.complete, false);
  assert.equal(a.missing, 7);
  assert.equal(a.costToFinish, 56); // 7 x 8p beats 160p for a maxed one
  const done = arcaneRows(buildModel(bundle([inv("/A/Energize#5", "Arcane Energize", "arcane", 1, { rank: 5 }), inv("/A/Energize", "Arcane Energize", "arcane", 2)])))[0];
  assert.equal(done.complete, true);
  assert.equal(done.spare, 2);
});

test("duplicate mods keep your best copy and one to give away", () => {
  const [mod] = modRows(buildModel(bundle([inv("/M/Serration#10", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 3)])));
  assert.equal(mod.total, 4);
  assert.equal(mod.extras, 2);
  assert.equal(mod.extrasValue, 6);
  assert.deepEqual(mod.ranks, [{ rank: 10, count: 1 }, { rank: 0, count: 3 }]);
});

test("relic rows flag parts you still need", () => {
  const [relic] = relicRows(buildModel(bundle([inv("/Relic/R1Platinum", "Axi R1 Radiant", "relic", 2)])));
  assert.equal(relic.vaulted, true);
  assert.equal(relic.neededCount, 1);
  assert.equal(relic.evIntact, 0.6);
  assert.equal(relic.evRadiant, 3);
});

test("squad relics from the log resolve refinement and vault state", async () => {
  const { squadRelics, squadPool } = await import("../src/lib/core/views");
  const m = buildModel(bundle([inv("/Relic/R1Platinum", "Axi R1 Radiant", "relic", 2)]));
  const [known, unknown] = squadRelics(m, ["/Relic/R1Platinum", "/Lotus/Types/Game/Projections/T2VoidProjectionTitaniaGaraVaultBPlatinum"]);
  assert.equal(known.name, "Axi R1");
  assert.equal(known.refinement, "Radiant");
  assert.equal(known.status, "vaulted");
  assert.equal(known.youOwn, 2);
  assert.equal(known.neededCount, 1);
  assert.equal(known.ev, 3);
  assert.equal(unknown.known, false);
  assert.equal(unknown.name, "Meso Prime Resurgence relic");
  assert.equal(unknown.status, "vaulted");
  assert.equal(squadPool([known])[0].name, "Rhino Prime Systems Blueprint");
});
