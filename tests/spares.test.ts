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
  const rows = spareRows(buildModel(bundle(held)), null, { veiledRivens: true, relicsWorthSelling: false, saveForSets: false });
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

test("kitgun parts are kept while an Infested chamber is unmastered (its path says Barrels)", () => {
  // The catalog here has no Solaris chambers: the only kitguns are the Infested ones (Sporelacer,
  // Vermisplicer) the model always knows.
  const grip = inv("/Lotus/Weapons/Infested/Pistols/InfKitGun/Handles/InfHandleA/InfModularHandleABlueprint", "Infested Kitgun Grip Blueprint", "blueprint", 1);
  const b = (mastered: boolean) => {
    const x = bundle([grip]) as Bundle & { prices: { prices: Record<string, number> } };
    x.prices.prices["Infested Kitgun Grip Blueprint"] = 10;
    if (mastered) {
      x.inventory.push(inv("/Lotus/Weapons/Infested/Pistols/InfKitGun/Barrels/InfBarrelEgg/InfModularBarrelEggPart", "Sporelacer", "weapon", 0, { mastered: true }));
      x.inventory.push(inv("/Lotus/Weapons/Infested/Pistols/InfKitGun/Barrels/InfBarrelBeam/InfModularBarrelBeamPart", "Vermisplicer", "weapon", 0, { mastered: true }));
    }
    return x;
  };
  const kept = row(spareRows(buildModel(b(false))), "Infested Kitgun Grip Blueprint")!;
  assert.deepEqual([kept.keep, kept.spare], [1, 0]);
  assert.match(kept.why, /Kitgun part: you have 2 kitguns still to master/);
  assert.equal(row(spareRows(buildModel(b(true))), "Infested Kitgun Grip Blueprint")!.spare, 1);
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
  const targets = sellTargets(buildModel(bundle(held)), { ...defaultBulkRules(), sets: false, arcanes: false, mods: false, other: true }, defaultAdvice(), items, { veiledRivens: true, relicsWorthSelling: false, saveForSets: false });
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
  assert.equal(sellableCopies(40, null), 0, "no pace known: nothing says it sells");
  assert.equal(sellableCopies(40, 1), 30, "relics are passed about one a day");
});

test("Inventory's figures: market, easy and spare one way, spare traced by kind", async () => {
  const { inventoryValue } = await import("../src/lib/core/spares");
  const row = (key: string, kind: string, quantity: number, price: number | null, tradesPerDay: number | null) =>
    ({ key, name: key, unique: key, kind, type: kind, quantity, rank: null, maxRank: null, mastered: false, price, ducats: null, worth: price == null ? null : price * quantity, tradesPerDay, marketName: key, subtype: null }) as never;
  const spare = (key: string, n: number, price: number | null, tradesPerDay: number | null) => [key, { key, spare: n, price, tradesPerDay }] as const;
  const rows = [row("mod", "mod", 100, 3, 2), row("slow", "part", 40, 10, 0.25), row("relic", "relic", 50, 5, null), row("frame", "gear", 1, 300, 1)];
  const ledger = new Map([spare("mod", 98, 3, 2), spare("slow", 40, 10, 0.25), spare("relic", 50, 5, null)]) as never;
  const v = inventoryValue(rows, ledger);
  // Built gear has no price unless it's in the ledger.
  assert.equal(v.market, 100 * 3 + 40 * 10 + 50 * 5);
  // Easy: what trades daily (relics count), a month's sales of each: 60 mods, 30 relics.
  assert.equal(v.easy, 60 * 3 + 30 * 5);
  // Spare: slow sellers too, capped: 60 mods, 8 slow parts, 30 relics.
  assert.equal(v.spare, 60 * 3 + 8 * 10 + 30 * 5);
  assert.equal(v.byKind.get("part"), 80);
});

test("a boss key is kept while the fight still drops a part you need, and spare once it doesn't", () => {
  const MESA = "/Lotus/Types/Recipes/WarframeRecipes/";
  const coord = inv("/Lotus/Types/Items/MiscItems/InfestedAladCoordinate", "Mutalist Alad V Nav Coordinate", "resource", 1);
  const mesa = {
    uniqueName: "/Lotus/Powersuits/Cowgirl/Cowgirl", name: "Mesa", category: "Warframes", masterable: true,
    components: ["Neuroptics", "Chassis", "Systems"].map((p) => ({
      uniqueName: `${MESA}Cowgirl${p === "Neuroptics" ? "Helmet" : p}Component`, name: p, itemCount: 1,
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
  // The boss drops the Systems blueprint: holding it (not yet built) is enough.
  const dropped = row(withMesa([inv(`${MESA}CowgirlHelmetComponent`, "Cowgirl Helmet Component", "blueprint", 1), inv(`${MESA}CowgirlChassisBlueprint`, "Cowgirl Chassis Blueprint", "blueprint", 1), inv(`${MESA}CowgirlSystemsBlueprint`, "Cowgirl Systems Blueprint", "blueprint", 1)]), "Mutalist Alad V Nav Coordinate")!;
  assert.deepEqual([dropped.keep, dropped.spare], [0, 1]);
  const done = row(withMesa([inv("/Lotus/Powersuits/Cowgirl/Cowgirl", "Mesa", "frame", 1)]), "Mutalist Alad V Nav Coordinate")!;
  assert.deepEqual([done.keep, done.spare], [0, 1]);
});

test("damaged necramech parts are kept, one per component still to build", () => {
  const MECH = "/Lotus/Types/Gameplay/InfestedMicroplanet/Resources/Mechs/";
  const b = bundle([inv(`${MECH}DamagedMechPartEngineItem`, "Damaged Necramech Engine", "resource", 4), inv(`${MECH}DamagedMechWeaponBarrelItem`, "Damaged Necramech Weapon Barrel", "resource", 1)]);
  b.catalog.push(
    { uniqueName: "/Lotus/Powersuits/EntratiMech/ThanoTech", name: "Bonewidow", category: "Warframes", masterable: true, components: [{ uniqueName: `${MECH}ThanomechPartEngineItem`, name: "Bonewidow Engine", itemCount: 1 }] } as never,
    { uniqueName: "/Lotus/Powersuits/EntratiMech/NechroTech", name: "Voidrig", category: "Warframes", masterable: true, components: [{ uniqueName: `${MECH}NecromechPartEngineItem`, name: "Voidrig Engine", itemCount: 1 }] } as never,
    { uniqueName: "/Lotus/Weapons/Morgha", name: "Morgha", category: "Arch-Gun", masterable: true, components: [{ uniqueName: `${MECH}ThanotechGrenadeLauncherBarrelItem`, name: "Morgha Barrel", itemCount: 1 }] } as never,
  );
  Object.assign(b.prices!.prices!, { "Damaged Necramech Engine": 5, "Damaged Necramech Weapon Barrel": 10 });
  const rows = spareRows(buildModel({ ...b, inventory: [...b.inventory, inv("/Lotus/Powersuits/EntratiMech/NechroTech", "Voidrig", "frame", 1)] }));
  const engine = row(rows, "Damaged Necramech Engine")!;
  assert.deepEqual([engine.keep, engine.spare, engine.why], [1, 3, "To build Bonewidow Engine"]);
  assert.deepEqual([row(rows, "Damaged Necramech Weapon Barrel")!.keep, row(rows, "Damaged Necramech Weapon Barrel")!.why], [1, "To build Morgha Barrel"]);
});

test("parts with no ducats and no market price (Sagek Prime's) aren't offered for sale", () => {
  const b = bundle([inv("/Lotus/Types/Recipes/Weapons/SagekPrimeBlueprint", "Sagek Prime Blueprint", "prime_part", 1)]);
  b.catalog.push({ uniqueName: "/Lotus/Weapons/SagekPrime", name: "Sagek Prime", category: "Secondary", masterable: true, components: [{ uniqueName: "/Lotus/Types/Recipes/Weapons/SagekPrimeBlueprint", name: "Blueprint", itemCount: 1, tradable: false }] } as never);
  assert.equal(row(spareRows(buildModel(b)), "Sagek Prime Blueprint"), undefined);
});

test("mods the catalog doesn't know and the market doesn't price aren't counted as spare", () => {
  const rows = spareRows(buildModel(bundle([inv("/Lotus/Upgrades/Stickers/EjectButtonSticker", "Eject Button Sticker", "mod", 4)])));
  assert.equal(row(rows, "Eject Button Sticker"), undefined);
});

test("prices are found whatever the case of the market's spelling", () => {
  const b = bundle([]);
  Object.assign(b.prices!.prices!, { "Zid-an Sek-eel": 3, "EMP Aura": 10 });
  const m = buildModel(b);
  assert.deepEqual([m.price("Zid-An Sek-Eel"), m.price("Emp Aura"), m.price("Mandonel Barrel"), m.price("Nothing Like It")], [3, 10, 4, null]);
});

test("a weapon part's blueprint is kept for the part the recipe lists, unless that part is built", () => {
  const W = "/Lotus/Types/Recipes/Weapons/WeaponParts/";
  const aeolak = { uniqueName: "/Lotus/Weapons/Aeolak", name: "Aeolak", category: "Primary", masterable: true, components: [{ uniqueName: `${W}DuviriRifleBarrel`, name: "Barrel", itemCount: 1 }, { uniqueName: `${W}DuviriRifleStock`, name: "Stock", itemCount: 1 }] };
  const b = bundle([inv(`${W}DuviriRifleBarrelBlueprint`, "Duviri Rifle Barrel Blueprint", "blueprint", 1), inv(`${W}DuviriRifleStockBlueprint`, "Duviri Rifle Stock Blueprint", "blueprint", 2), inv(`${W}DuviriRifleBarrel`, "Duviri Rifle Barrel", "resource", 1)]);
  b.catalog.push(aeolak as never);
  Object.assign(b.prices!.prices!, { "Aeolak Barrel Blueprint": 5, "Aeolak Stock Blueprint": 5 });
  const items = [
    { id: "a", slug: "aeolak_barrel_blueprint", gameRef: `${W}DuviriRifleBarrelBlueprint`, name: "Aeolak Barrel Blueprint", maxRank: null, subtypes: null, tags: ["weapon", "blueprint"] },
    { id: "b", slug: "aeolak_stock_blueprint", gameRef: `${W}DuviriRifleStockBlueprint`, name: "Aeolak Stock Blueprint", maxRank: null, subtypes: null, tags: ["weapon", "blueprint"] },
  ] as MarketItem[];
  const rows = spareRows(buildModel(b), indexItems(items));
  const stock = row(rows, "Aeolak Stock Blueprint")!;
  assert.deepEqual([stock.keep, stock.spare, stock.why], [1, 1, "For Aeolak"]);
  const barrel = row(rows, "Aeolak Barrel Blueprint")!;
  assert.deepEqual([barrel.keep, barrel.spare], [0, 1]);
  assert.match(barrel.why, /already hold the built part/);
});

test("a prime's parts are kept while an unbuilt weapon made from it needs more of it (Akvasto Prime)", async () => {
  const { partRows, setRows } = await import("../src/lib/core/views");
  const R = "/Lotus/Types/Recipes/Weapons/";
  const VASTO = "/Lotus/Weapons/VastoPrime";
  const vasto = { uniqueName: VASTO, name: "Vasto Prime", category: "Secondary", masterable: true, components: [{ uniqueName: `${R}VastoPrimeBlueprint`, name: "Blueprint", itemCount: 1, ducats: 15 }, { uniqueName: `${R}WeaponParts/VastoPrimeReceiver`, name: "Receiver", itemCount: 1, ducats: 15 }] };
  const akvasto = { uniqueName: "/Lotus/Weapons/AkvastoPrime", name: "Akvasto Prime", category: "Secondary", masterable: true, components: [{ uniqueName: `${R}AkvastoPrimeBlueprint`, name: "Blueprint", itemCount: 1, ducats: 15 }, { uniqueName: VASTO, name: "Vasto Prime", itemCount: 2 }] };
  const held = (mastered: boolean, more: InventoryRow[] = []) => {
    const b = bundle([inv(VASTO, "Vasto Prime", "weapon", 1, { mastered }), inv(`${R}VastoPrimeBlueprint`, "Vasto Prime Blueprint", "prime_part", 3), inv(`${R}WeaponParts/VastoPrimeReceiver`, "Vasto Prime Receiver", "prime_part", 2), ...more]);
    b.catalog.push(vasto as never, akvasto as never);
    return buildModel(b);
  };
  // One Vasto Prime built, Akvasto takes two: one more set's worth is kept.
  const m = held(true);
  assert.deepEqual(partRows(m).map((r) => [r.name, r.keep, r.keptFor]), [["Vasto Prime Blueprint", 1, "Akvasto Prime"], ["Vasto Prime Receiver", 1, "Akvasto Prime"]]);
  assert.deepEqual(setRows(m).filter((s) => s.name === "Vasto Prime").map((s) => [s.completeSets, s.sellable]), [[2, 1]]);
  // Akvasto built: nothing kept.
  assert.ok(partRows(held(true, [inv("/Lotus/Weapons/AkvastoPrime", "Akvasto Prime", "weapon", 1)])).every((r) => r.keep === 0));
});

test("sets that aren't prime: a loose part waits for the set when you keep getting the part it's missing", async () => {
  const { gearSetSaves } = await import("../src/lib/core/spares");
  const { saveForSets } = await import("../src/lib/core/views");
  const { dropCounts } = await import("../src/lib/core/drops");
  const BP = "/Lotus/Types/Recipes/Weapons/TnConcreteArchgunBlueprint";
  // Two barrels and a blueprint, Mandonel unbuilt: one of each kept to build it, one barrel loose.
  const m = buildModel(bundle([inv(`${PARTS}TnConcreteArchgunBarrel`, "Tn Concrete Archgun Barrel", "resource", 2), inv(BP, "Tn Concrete Archgun Blueprint", "blueprint", 1)], {
    prices: { prices: { "Mandonel Set": 15, "Mandonel Barrel": 4, "Mandonel Blueprint": 6 }, max_rank_prices: {}, trade_rate: { "Mandonel Barrel": [3, 0, ""] } },
  } as Partial<Bundle>));
  const items = indexItems([
    { id: "ms", slug: "mandonel_set", gameRef: "/Lotus/Weapons/Mandonel", name: "Mandonel Set", maxRank: null, subtypes: null, tags: ["weapon", "set"] },
    { id: "mb", slug: "mandonel_barrel", gameRef: `${PARTS}TnConcreteArchgunBarrel`, name: "Mandonel Barrel", maxRank: null, subtypes: null, tags: ["weapon", "component"] },
    { id: "mp", slug: "mandonel_blueprint", gameRef: BP, name: "Mandonel Blueprint", maxRank: null, subtypes: null, tags: ["weapon", "blueprint"] },
  ] as MarketItem[]);
  // The drop log names the parts the same way.
  assert.deepEqual(dropCounts(m), { "Mandonel Barrel": 2, "Mandonel Blueprint": 1 });
  const sell = { veiledRivens: false, relicsWorthSelling: false, saveForSets: true };
  // No relic drops the blueprint: without having got one lately, the barrel is sold.
  assert.equal(gearSetSaves(m, items, saveForSets(sell, 0)!).size, 0);
  assert.equal(row(spareRows(m, items, sell), "Mandonel Barrel")!.spare, 1);
  const got = new Map([["Mandonel Blueprint", 2]]);
  const s = gearSetSaves(m, items, saveForSets(sell, 0, got)!).get("/Lotus/Weapons/Mandonel")!;
  assert.deepEqual([s.held, s.missing], [[{ name: "Mandonel Barrel", count: 1 }], [{ name: "Mandonel Blueprint", count: 1, from: "dropped", got: 2 }]]);
  const barrel = row(spareRows(m, items, sell, 0, 1, got), "Mandonel Barrel")!;
  assert.equal(barrel.spare, 0);
  assert.match(barrel.why, /1 saved for a Mandonel Set \(15p, 10p as parts\): 1 part to go/);
});
