// Things the inventory files as a frame, weapon or companion that give no mastery (the Gravimag,
// loose MOA, hound and zaw parts, Infested mutagens, Railjack armaments) are not gear to level:
// not a row on Mastery, and no "level it" on Inventory. Where the catalog knows an item it says so;
// only an item the catalog doesn't list is taken for gear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { inventoryRows, masteryRows } from "../src/lib/core/views";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const bundle = (inventory: InventoryRow[], catalog: CatalogItem[] = []): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog,
  relics: [],
  prices: { prices: {}, max_rank_prices: {} },
});

/** What the player sees as gear to level: Mastery's rows for these items, and Inventory's "level it" rows. */
function toLevel(held: InventoryRow[], catalog: CatalogItem[]) {
  const m = buildModel(bundle(held, catalog));
  const mine = (unique: string) => held.some((h) => h.item_id === unique);
  const mastery = masteryRows(m).filter((r) => mine(r.unique)).map((r) => `${r.name} · ${r.category} · ${r.status} · ${r.points}`);
  // `levels` is what Inventory draws "level it" and the "Not mastered" corner by.
  const inventory = inventoryRows(m).filter((r) => r.kind === "gear" && r.levels !== false && !r.mastered).map((r) => `${r.name} · ${r.type}`);
  return { mastery, inventory };
}

test("the Gravimag (Misc, typed Rifle, not masterable) is not gear to level", () => {
  const gravimag = { uniqueName: "/Lotus/Types/Items/MiscItems/HeavyWeaponCatalyst", name: "Gravimag", category: "Misc", type: "Rifle", masterable: false, tradable: false } as CatalogItem;
  const held = [inv(gravimag.uniqueName, "Gravimag", "weapon", 1)];
  assert.deepEqual(toLevel(held, [gravimag]), { mastery: [], inventory: [] });
  // On Inventory it stays, as what it is: a part, not a weapon.
  const row = inventoryRows(buildModel(bundle(held, [gravimag]))).find((r) => r.name === "Gravimag")!;
  assert.equal(row.type, "Part");
  assert.equal(row.levels, false);
});

test("a held MOA gyro, a zaw link and an Infested mutagen are not gear to level", () => {
  const catalog = [
    { uniqueName: "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetPayloadDarta", name: "Harpen Gyro", category: "Pets", type: "Pet Resource", productCategory: "Pistols", masterable: false },
    { uniqueName: "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Balance/BalanceSpeedI", name: "Jai", category: "Melee", type: "Zaw Component", productCategory: "Pistols", masterable: false },
    { uniqueName: "/Lotus/Types/Friendly/Pets/CreaturePets/CreaturePetParts/Deimos/InfestedCritterMutagenA", name: "Adra Mutagen", category: "Pets", type: "Pet Parts", productCategory: "Pistols", masterable: false },
  ] as CatalogItem[];
  const held = [
    inv(catalog[0].uniqueName, "Harpen Gyro", "companion", 1),
    inv(catalog[1].uniqueName, "Jai", "weapon", 1),
    inv(catalog[2].uniqueName, "Adra Mutagen", "companion", 3),
  ];
  assert.deepEqual(toLevel(held, catalog), { mastery: [], inventory: [] });
});

test("Railjack armaments are not gear to level, listed in the catalog or not", () => {
  const listed = { uniqueName: "/Lotus/Weapons/CrewShip/Laser/Blaster/LavanBlasterTierC", name: "Lavan Carcinnox Mk Iii", category: "Railjack", type: "Railjack Turret", masterable: false } as CatalogItem;
  const held = [
    inv(listed.uniqueName, "Lavan Carcinnox Mk Iii", "weapon", 1),
    // The catalog doesn't list this one yet: its path says what it is.
    inv("/Lotus/Weapons/CrewShip/Pilot/Carcinnox/VidarCarcinnoxWeapon", "Vidar Carcinnox Mk III", "weapon", 2),
    inv("/Lotus/Weapons/CrewShip/Pilot/Pulsar/LavanPulsarWeapon", "Lavan Pulsar Mk III", "weapon", 1),
  ];
  assert.deepEqual(toLevel(held, [listed]), { mastery: [], inventory: [] });
  const rows = inventoryRows(buildModel(bundle(held, [listed])));
  assert.deepEqual(rows.filter((r) => r.kind === "gear").map((r) => r.type).sort(), ["Railjack armament", "Railjack armament"], "Pulsar is left out of gear by name, as before");
});

test("masterable modular parts still count: a chamber, a strike, a prism and a MOA model", () => {
  const catalog = [
    { uniqueName: "/Lotus/Weapons/SolarisUnited/Secondary/SUModularSecondarySet1/Barrel/SUModularSecondaryBarrelAPart", name: "Catchmoon", category: "Misc", type: "Kitgun Component", productCategory: "Pistols", masterable: true },
    { uniqueName: "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Tips/Tip/TipA", name: "Plague Keewar", category: "Melee", type: "Zaw Component", productCategory: "Pistols", masterable: true },
    { uniqueName: "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartA", name: "Raplak Prism", category: "Misc", type: "Amp", masterable: true },
    { uniqueName: "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetHeadLambeo", name: "Lambeo Moa", category: "Pets", type: "Pets", productCategory: "Pistols", masterable: true },
  ] as CatalogItem[];
  const held = [
    inv(catalog[0].uniqueName, "Catchmoon", "weapon", 1),
    inv(catalog[1].uniqueName, "Plague Keewar", "weapon", 1),
    inv(catalog[2].uniqueName, "Raplak Prism", "weapon", 1),
    inv(catalog[3].uniqueName, "Lambeo Moa", "companion", 1),
  ];
  const { mastery, inventory } = toLevel(held, catalog);
  assert.equal(mastery.length, 4, mastery.join("\n"));
  assert.equal(inventory.length, 4, inventory.join("\n"));
});

test("an item the catalog doesn't list is still taken for gear to level", () => {
  const held = [inv("/Lotus/Weapons/Tenno/Rifle/BrandNewRifle", "Brand New Rifle", "weapon", 1)];
  const { mastery, inventory } = toLevel(held, []);
  assert.deepEqual(mastery, ["Brand New Rifle · Weapon · level · 3000"]);
  assert.deepEqual(inventory, ["Brand New Rifle · Weapon"]);
});

test("a masterable weapon outside every Codex group is still gear to level", () => {
  const odd = { uniqueName: "/Lotus/Weapons/Odd/OddThing", name: "Odd Thing", category: "Sigils", masterable: true } as CatalogItem;
  const { mastery } = toLevel([inv(odd.uniqueName, "Odd Thing", "weapon", 1)], [odd]);
  assert.equal(mastery.length, 1);
});
