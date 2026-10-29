// Everything tradable you hold more of than you need, and why the rest is kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { spareRows, needsByUnique, gearSetRows } from "../src/lib/core/spares";
import { sellTargets, kindOfItem, defaultBulkRules } from "../src/lib/core/bulk";
import { holdings, indexItems, type MarketItem } from "../src/lib/core/market";
import { defaultAdvice } from "../src/lib/backend";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const PARTS = "/Lotus/Types/Recipes/Weapons/WeaponParts/";
const GEM = "/Lotus/Types/Items/Gems/Solaris/SolarisCommonGemBCutItem";
const bundle = (inventory: InventoryRow[], extra: Partial<Bundle> = {}): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [
    {
      uniqueName: "/Lotus/Weapons/Mandonel", name: "Mandonel", category: "Arch-Gun", masterable: true,
      components: [
        { uniqueName: "/Lotus/Types/Recipes/Weapons/TnConcreteArchgunBlueprint", name: "Blueprint", itemCount: 1 },
        { uniqueName: `${PARTS}TnConcreteArchgunBarrel`, name: "Barrel", itemCount: 1 },
        { uniqueName: GEM, name: "Heart Noctrul", itemCount: 10 },
      ],
    },
    { uniqueName: "/Lotus/Weapons/Moa", name: "Lambeo Moa", category: "Sentinels", masterable: true, components: [{ uniqueName: GEM, name: "Heart Noctrul", itemCount: 5 }] },
  ],
  relics: [],
  prices: {
    prices: { "Mandonel Barrel": 4, "Mandonel Blueprint": 6, "Heart Noctrul": 4, "Corpus Depository Scene": 4, "Melee Riven Mod (Veiled)": 9, "Ayatan Anasa Sculpture": 7 },
    max_rank_prices: {},
    trade_rate: { "Mandonel Barrel": [3, 0, ""], "Heart Noctrul": [20, 0, ""], "Corpus Depository Scene": [2, 0, ""], "Melee Riven Mod (Veiled)": [600, 0, ""], "Ayatan Anasa Sculpture": [500, 0, ""] },
  },
  ...extra,
} as unknown as Bundle);

const held = [
  inv(`${PARTS}TnConcreteArchgunBarrel`, "Tn Concrete Archgun Barrel", "resource", 16),
  inv(GEM, "Heart Noctrul", "resource", 207),
  inv("/Lotus/Types/Items/MiscItems/PhotoboothTileCorpusShipLargeCargo", "Corpus Depository Scene", "resource", 22),
  inv("/Lotus/Upgrades/Mods/Randomized/RawMeleeRandomMod", "Melee Riven Mod", "mod", 12),
  inv("/Lotus/Upgrades/Mods/Randomized/PlayerMeleeWeaponRandomModRare", "Melee Riven Mod", "mod", 2),
  inv("/Lotus/Types/Items/FusionTreasures/OroFusexF", "Ayatan Anasa Sculpture", "resource", 4),
];
const row = (rows: ReturnType<typeof spareRows>, name: string) => rows.find((r) => r.name === name);

test("an unbuilt weapon keeps its parts and resources; what's over goes", () => {
  const rows = spareRows(buildModel(bundle(held)));
  const barrel = row(rows, "Mandonel Barrel")!;
  assert.equal(barrel.heldAs, "Tn Concrete Archgun Barrel", "the game's internal name, listed under the market's");
  assert.deepEqual([barrel.keep, barrel.spare, barrel.why], [1, 15, "For Mandonel"]);
  const gem = row(rows, "Heart Noctrul")!;
  assert.deepEqual([gem.keep, gem.spare, gem.worth], [15, 192, 768]);
  assert.match(gem.why, /Mandonel \(10\), Lambeo Moa \(5\)/);
});

test("built or mastered, nothing is kept for it", () => {
  const m = buildModel(bundle([...held, inv("/Lotus/Weapons/Mandonel", "Mandonel", "weapon", 1)]));
  assert.equal(needsByUnique(m).get(`${PARTS}TnConcreteArchgunBarrel`), undefined);
  const rows = spareRows(m);
  assert.deepEqual([row(rows, "Mandonel Barrel")!.spare, row(rows, "Heart Noctrul")!.keep], [16, 5]);
});

test("one Captura scene is kept; sculptures can all go; veiled rivens only when you sell them; unveiled rivens aren't here", () => {
  const rows = spareRows(buildModel(bundle(held)), null, { veiledRivens: true, relicsWorthSelling: false });
  assert.deepEqual([row(rows, "Corpus Depository Scene")!.keep, row(rows, "Corpus Depository Scene")!.type], [1, "Captura scene"]);
  assert.equal(row(rows, "Ayatan Anasa Sculpture")!.spare, 4);
  const riven = row(rows, "Melee Riven Mod (Veiled)")!;
  assert.deepEqual([riven.quantity, riven.spare, riven.type], [12, 12, "Veiled riven"]);
  assert.equal(rows.filter((r) => /Riven/.test(r.name)).length, 1, "the two unveiled ones are left to Rivens");
  const kept = row(spareRows(buildModel(bundle(held))), "Melee Riven Mod (Veiled)")!;
  assert.deepEqual([kept.keep, kept.spare], [12, 0], "kept unless you choose to sell them");
});

test("hound, MOA, kitgun and zaw parts are kept while anything in the family is unmastered", () => {
  const raiju = inv("/Lotus/Types/Recipes/ZanukaPetParts/ZanukaPetPartBodyCBlueprint", "Zanuka Pet Part Body C Blueprint", "blueprint", 2);
  const hound = { uniqueName: "/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetParts/ZanukaPetPartHeadB", name: "Bhaira Hound", category: "Pets", masterable: true };
  const b = (mastered: boolean) => {
    const x = bundle([raiju], {} as Partial<Bundle>) as Bundle & { catalog: unknown[]; prices: { prices: Record<string, number> } };
    x.catalog.push(hound);
    x.prices.prices["Zanuka Pet Part Body C Blueprint"] = 15;
    if (mastered) x.inventory.push(inv(hound.uniqueName, "Bhaira Hound", "companion", 1, { mastered: true }));
    return x;
  };
  const unmastered = row(spareRows(buildModel(b(false))), "Zanuka Pet Part Body C Blueprint")!;
  assert.deepEqual([unmastered.keep, unmastered.spare], [2, 0]);
  assert.match(unmastered.why, /Hound part: you have 1 hound still to master/);
  assert.equal(row(spareRows(buildModel(b(true))), "Zanuka Pet Part Body C Blueprint")!.spare, 2);
});

test("veiled rivens are counted for listings by the game's veiled path, not the market's", () => {
  const m = buildModel(bundle(held));
  const it = { id: "v", slug: "melee_riven_mod_(veiled)", gameRef: "/Lotus/Upgrades/Mods/Randomized/PlayerMeleeWeaponRandomModRare", name: "Melee Riven Mod (Veiled)", maxRank: null, subtypes: null, tags: ["mod", "riven_mod", "veiled_riven"] } as MarketItem;
  assert.deepEqual(holdings(m, it), [{ rank: null, subtype: null, count: 12 }]);
  assert.equal(kindOfItem(m, it), "other");
});

test("'everything else' lists what sells daily, under the market's names", () => {
  const items = indexItems([
    { id: "b", slug: "mandonel_barrel", gameRef: `${PARTS}TnConcreteArchgunBarrel`, name: "Mandonel Barrel", maxRank: null, subtypes: null, tags: ["weapon", "component"] },
  ] as MarketItem[]);
  const targets = sellTargets(buildModel(bundle(held)), { ...defaultBulkRules(), sets: false, arcanes: false, mods: false, other: true }, defaultAdvice(), items, { veiledRivens: true, relicsWorthSelling: false });
  assert.deepEqual(
    targets.map((t) => [t.name, t.quantity]).sort(),
    [["Ayatan Anasa Sculpture", 4], ["Corpus Depository Scene", 21], ["Heart Noctrul", 192], ["Mandonel Barrel", 15], ["Melee Riven Mod (Veiled)", 12]].sort(),
  );
  assert.ok(targets.every((t) => t.kind === "other"));
  const keepingRivens = sellTargets(buildModel(bundle(held)), { ...defaultBulkRules(), sets: false, arcanes: false, mods: false, other: true }, defaultAdvice(), items);
  assert.ok(!keepingRivens.some((t) => /Riven/.test(t.name)), "veiled rivens stay unless you sell them");
  // With mods ticked, veiled rivens aren't kept two to a name.
  const mods = sellTargets(buildModel(bundle(held)), { ...defaultBulkRules(), sets: false, arcanes: false, mods: true, other: false }, defaultAdvice());
  assert.ok(!mods.some((t) => /Riven/.test(t.name)));
});

test("sets that aren't prime: whole spare sets are sold as the set, only the loose parts on their own", () => {
  const BP = "/Lotus/Types/Recipes/Weapons/TnConcreteArchgunBlueprint";
  const m = buildModel(bundle([...held, inv(BP, "Tn Concrete Archgun Blueprint", "blueprint", 3)]));
  const items = indexItems([
    { id: "ms", slug: "mandonel_set", gameRef: "/Lotus/Weapons/Mandonel", name: "Mandonel Set", maxRank: null, subtypes: null, tags: ["archwing", "primary", "weapon", "set"] },
    { id: "mb", slug: "mandonel_barrel", gameRef: `${PARTS}TnConcreteArchgunBarrel`, name: "Mandonel Barrel", maxRank: null, subtypes: null, tags: ["weapon", "component"] },
    { id: "mp", slug: "mandonel_blueprint", gameRef: BP, name: "Mandonel Blueprint", maxRank: null, subtypes: null, tags: ["weapon", "blueprint"] },
  ] as MarketItem[]);
  // 16 barrels and 3 blueprints, one of each kept to build Mandonel: 3 sets, 2 spare. The gems aren't part of the set.
  const set = gearSetRows(m, items).find((s) => s.name === "Mandonel")!;
  assert.deepEqual([set.completeSets, set.sellable, set.keptForBuild, set.prime], [3, 2, true, false]);
  assert.deepEqual(set.parts.map((p) => [p.name, p.owned]), [["Mandonel Blueprint", 3], ["Mandonel Barrel", 16]]);
  assert.deepEqual(holdings(m, items.byId.get("ms")!), [{ rank: null, subtype: null, count: 3 }]);
  assert.equal(kindOfItem(m, items.byId.get("ms")!), "set");
  const rules = { ...defaultBulkRules(), arcanes: false, mods: false, sets: true, other: true };
  const targets = sellTargets(m, rules, defaultAdvice(), items);
  const q = (n: string) => targets.find((t) => t.name === n)?.quantity;
  assert.deepEqual([q("Mandonel Set"), q("Mandonel Barrel"), q("Mandonel Blueprint")], [2, 13, undefined], "the 2 barrels and blueprints in the sets aren't listed again");
  // Without "Sets I don't need", the parts go one by one.
  const loose = sellTargets(m, { ...rules, sets: false }, defaultAdvice(), items);
  assert.deepEqual([loose.find((t) => t.name === "Mandonel Barrel")?.quantity, loose.find((t) => t.name === "Mandonel Blueprint")?.quantity], [15, undefined], "a blueprint without a daily trade count isn't listed alone");
  assert.match(spareRows(m, items).find((r) => r.name === "Mandonel Barrel")!.why, /2 of the spare ones make whole sets/);
});

test("a relic's crack counts each reward's ducats at your rate when they're worth more than its price", async () => {
  const { relicRows, rewardPlat } = await import("../src/lib/core/views");
  const b = bundle([]) as Bundle & { catalog: unknown[]; prices: { prices: Record<string, number> } };
  b.catalog.push({ uniqueName: "/Lotus/Powersuits/Rhino/RhinoPrime", name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [{ uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 100, itemCount: 1 }] });
  b.prices.prices["Rhino Prime Neuroptics Blueprint"] = 4;
  const m = buildModel(b);
  assert.equal(rewardPlat(m, "Rhino Prime Neuroptics Blueprint"), 4, "no rate: the price");
  assert.equal(rewardPlat(m, "Rhino Prime Neuroptics Blueprint", 0.1), 10, "100 ducats at 0.1p beat 4p");
  assert.equal(rewardPlat(m, "Rhino Prime Neuroptics Blueprint", 0.02), 4, "2p of ducats don't");
  assert.equal(rewardPlat(m, "Heart Noctrul", 0.1), 4, "no ducats: the price");
  assert.deepEqual(relicRows(m, { platPerDucat: 0.1 }), [], "only relics you hold");
});

test("a whole Mandonel handed over in one trade is a Mandonel Set sale, not three part sales", async () => {
  const { salesFromTrade } = await import("../src/lib/core/trades");
  const BP = "/Lotus/Types/Recipes/Weapons/TnConcreteArchgunBlueprint";
  const b = bundle([]) as Bundle & { catalog: { uniqueName: string; components?: unknown[] }[] };
  b.catalog[0].components!.push({ uniqueName: `${PARTS}TnConcreteArchgunReceiver`, name: "Receiver", itemCount: 1 });
  const m = buildModel(b);
  const items = indexItems([
    { id: "ms", slug: "mandonel_set", gameRef: "/Lotus/Weapons/Mandonel", name: "Mandonel Set", maxRank: null, subtypes: null, tags: ["weapon", "set"] },
    { id: "mb", slug: "mandonel_barrel", gameRef: `${PARTS}TnConcreteArchgunBarrel`, name: "Mandonel Barrel", maxRank: null, subtypes: null, tags: ["weapon", "component"] },
    { id: "mr", slug: "mandonel_receiver", gameRef: `${PARTS}TnConcreteArchgunReceiver`, name: "Mandonel Receiver", maxRank: null, subtypes: null, tags: ["weapon", "component"] },
    { id: "mp", slug: "mandonel_blueprint", gameRef: BP, name: "Mandonel Blueprint", maxRank: null, subtypes: null, tags: ["weapon", "blueprint"] },
  ] as MarketItem[]);
  const trade = { uptime: 1, at: 1, partner: "Buyer", offered: ["Mandonel Blueprint", "Mandonel Barrel", "Mandonel Receiver", "Heart Noctrul"].map((name) => ({ name, rank: null, count: 1 })), received: [], platinum_offered: 0, platinum_received: 30 };
  const set = { id: "o1", itemId: "ms", type: "sell" as const, platinum: 25, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null };
  const sales = salesFromTrade(trade, [set], items, m)!;
  assert.deepEqual(sales.map((s) => [s.name, s.count, s.order?.id ?? null]), [["Mandonel Set", 1, "o1"], ["Heart Noctrul", 1, null]]);
});

test("a pile of spares counts for no more than the market sells in a month", async () => {
  const { sellableCopies } = await import("../src/lib/core/spares");
  assert.equal(sellableCopies(232, 1.9), 57, "232 Lasting Stings at 1.9 a day: 57 sell in a month");
  assert.equal(sellableCopies(5, 10), 5);
  assert.equal(sellableCopies(40, null), 40, "no pace known (relics): all of them");
});

test("a boss key is kept while the fight still drops a part you need, and spare once it doesn't", () => {
  const MESA = "/Lotus/Types/Recipes/WarframeRecipes/";
  const coord = inv("/Lotus/Types/Items/MiscItems/InfestedAladCoordinate", "Mutalist Alad V Nav Coordinate", "resource", 1);
  const mesa = {
    uniqueName: "/Lotus/Powersuits/Cowgirl/Cowgirl", name: "Mesa", category: "Warframes", masterable: true,
    components: ["Neuroptics", "Chassis", "Systems"].map((p) => ({
      uniqueName: `${MESA}Cowgirl${p === "Neuroptics" ? "Helmet" : p}Blueprint`, name: p, itemCount: 1,
      drops: [{ location: "Eris/Mutalist Alad V (Assassination)", type: "Mesa " + p, chance: 0.2 }],
    })),
  };
  const withMesa = (have: InventoryRow[]) => {
    const b = bundle([coord, ...have]);
    b.catalog.push(mesa as never);
    (b.prices!.prices as Record<string, number>)["Mutalist Alad V Nav Coordinate"] = 10;
    return spareRows(buildModel(b));
  };
  const missing = row(withMesa([inv(`${MESA}CowgirlHelmetBlueprint`, "Cowgirl Helmet Blueprint", "blueprint", 1), inv(`${MESA}CowgirlChassisBlueprint`, "Cowgirl Chassis Blueprint", "blueprint", 1)]), "Mutalist Alad V Nav Coordinate")!;
  assert.deepEqual([missing.keep, missing.spare], [1, 0]);
  assert.match(missing.why, /Mesa Systems/);
  const done = row(withMesa([inv("/Lotus/Powersuits/Cowgirl/Cowgirl", "Mesa", "frame", 1)]), "Mutalist Alad V Nav Coordinate")!;
  assert.deepEqual([done.keep, done.spare], [0, 1]);
});
