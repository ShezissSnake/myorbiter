// Things the inventory files as a frame, weapon or companion that give no mastery (the Gravimag,
// loose MOA, hound and zaw parts, Infested mutagens, Railjack armaments) are not gear to level:
// not a row on Mastery, and no "level it" on Inventory. Where the catalog knows an item it says so;
// only an item the catalog doesn't list is taken for gear.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { inventoryRows, masteryRows } from "../src/lib/core/views";
import { spareRows } from "../src/lib/core/spares";
import { sellTargets, defaultBulkRules } from "../src/lib/core/bulk";
import { indexItems, type MarketItem } from "../src/lib/core/market";
import { defaultAdvice } from "../src/lib/backend";
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
  // Inventory draws "level it" and the "Not mastered" corner on gear that isn't mastered, unless `levels` says it gives no mastery.
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
  assert.equal(row.kind, "gear", "still gear for Sell spares, which skips it");
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
  assert.deepEqual(rows.map((r) => r.type).sort(), ["Railjack armament", "Railjack armament", "Weapon"], "Pulsar is left out of gear by name, as before");
});

test("Sell spares offers none of them", () => {
  const catalog = [
    { uniqueName: "/Lotus/Types/Items/MiscItems/HeavyWeaponCatalyst", name: "Gravimag", category: "Misc", type: "Rifle", masterable: false },
    { uniqueName: "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetPayloadDarta", name: "Harpen Gyro", category: "Pets", type: "Pet Resource", masterable: false },
    { uniqueName: "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Balance/BalanceSpeedI", name: "Jai", category: "Melee", type: "Zaw Component", masterable: false },
  ] as CatalogItem[];
  const held = [inv(catalog[0].uniqueName, "Gravimag", "weapon", 2), inv(catalog[1].uniqueName, "Harpen Gyro", "companion", 2), inv(catalog[2].uniqueName, "Jai", "weapon", 2),
    inv("/Lotus/Weapons/CrewShip/Pilot/Carcinnox/VidarCarcinnoxWeapon", "Vidar Carcinnox Mk III", "weapon", 2)];
  const prices = Object.fromEntries(["Gravimag", "Harpen Gyro", "Jai", "Vidar Carcinnox Mk III"].map((n) => [n, 20]));
  // The market lists every one of them, by path and by name, with a price: still not offered.
  const index = indexItems([
    { id: "1", slug: "gravimag", gameRef: catalog[0].uniqueName, name: "Gravimag", maxRank: null, subtypes: null, tags: ["component"] },
    { id: "2", slug: "harpen_gyro", gameRef: catalog[1].uniqueName, name: "Harpen Gyro", maxRank: null, subtypes: null, tags: ["component"] },
    { id: "3", slug: "jai", gameRef: catalog[2].uniqueName, name: "Jai", maxRank: null, subtypes: null, tags: ["component"] },
    { id: "4", slug: "vidar_carcinnox_mk_iii", gameRef: "/Lotus/Weapons/CrewShip/Pilot/Carcinnox/VidarCarcinnoxWeapon", name: "Vidar Carcinnox Mk III", maxRank: null, subtypes: null, tags: ["component"] },
  ] as MarketItem[]);
  const m = buildModel({ ...bundle(held, catalog), prices: { prices, max_rank_prices: {} } });
  assert.deepEqual(spareRows(m).map((r) => r.name), []);
  assert.deepEqual(spareRows(m, index).map((r) => r.name), []);
  const targets = sellTargets(m, { ...defaultBulkRules(), sets: false, arcanes: false, mods: false, other: true }, defaultAdvice(), index);
  assert.deepEqual(targets.map((t) => t.name), []);
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

test("Khora's Venari and the Orion row the model zeroes (neither gives mastery) are not gear to level", () => {
  const venari = { uniqueName: "/Lotus/Powersuits/Khora/Kavat/KhoraKavatPowerSuit", name: "Venari", category: "Pets", type: "Warframe", productCategory: "SpecialItems", masterable: false } as CatalogItem;
  const held = [inv(venari.uniqueName, "Venari", "frame", 1)];
  assert.deepEqual(toLevel(held, [venari]), { mastery: [], inventory: [] });
  assert.equal(inventoryRows(buildModel(bundle(held, [venari])))[0].type, "Warframe");
  // The catalog marks Sirius & Orion's second son masterable, and the model zeroes it (the pair counts once).
  const orion = { uniqueName: "/Lotus/Powersuits/SiriusOrion/OrionSuit", name: "Orion", category: "Warframes", type: "Warframe", masterable: true } as CatalogItem;
  assert.deepEqual(toLevel([inv(orion.uniqueName, "Orion", "frame", 1)], [orion]), { mastery: [], inventory: [] });
});

test("with the catalog as the data crate slims it (the demo's), a held Gravimag and a Railjack armament are not gear to level", () => {
  // The crate keeps a Misc item only if it is masterable (or typed as a weapon, since it was fixed to),
  // and the demo's catalog was built before: it has no Gravimag entry, and the row's path is all there is.
  const demo = JSON.parse(readFileSync(new URL("../demo/dev-bundle.json", import.meta.url), "utf8")) as Bundle;
  assert.ok(!demo.catalog.some((c) => c.name === "Gravimag"), "the demo's catalog doesn't list the Gravimag");
  const held = [
    inv("/Lotus/Types/Items/MiscItems/HeavyWeaponCatalyst", "Gravimag", "weapon", 1),
    inv("/Lotus/Weapons/CrewShip/Laser/Blaster/BlasterTierC", "Carcinnox Mk Iii", "weapon", 1),
  ];
  const m = buildModel({ ...demo, inventory: [...demo.inventory, ...held] });
  const mine = (u: string) => held.some((h) => h.item_id === u);
  assert.deepEqual(masteryRows(m).filter((r) => mine(r.unique)).map((r) => r.name), []);
  assert.deepEqual(inventoryRows(m).filter((r) => mine(r.unique)).map((r) => [r.name, r.kind, r.levels]), [["Gravimag", "gear", false], ["Carcinnox Mk Iii", "gear", false]]);
});

// A built kitgun, zaw, amp, MOA or hound is held under a path of its own (never masterable); its mastery
// goes by the chamber, strike, prism or model, which has its own row. Inventory said "level it" with the
// "Not mastered" corner on it for good, even with the chamber mastered. Names are not touched here.
const CHAMBER = "/Lotus/Weapons/SolarisUnited/Secondary/SUModularSecondarySet1/Barrel/SUModularSecondaryBarrelAPart";
const MODEL = "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetHeadLambeo";
const BUILT = [
  ["/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimaryBeam", "Lotus Modular Primary Beam", "weapon"],
  ["/Lotus/Weapons/Ostron/Melee/LotusModularMelee", "Lotus Modular Melee", "weapon"],
  ["/Lotus/Weapons/Sentients/OperatorAmplifiers/OperatorAmpWeapon", "Operator Amp Weapon", "weapon"],
  ["/Lotus/Types/Friendly/Pets/MoaPets/MoaPetPowerSuit", "Moa Pet Power Suit", "companion"],
  ["/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetAPowerSuit", "Zanuka Pet A Power Suit", "companion"],
  ["/Lotus/Types/Vehicles/Hoverboard/HoverboardSuit", "Hoverboard Suit", "frame"],
] as const;

test("built modular gear is not 'level it' on Inventory, as it is not a row on Mastery", () => {
  const catalog = [
    { uniqueName: CHAMBER, name: "Catchmoon", category: "Misc", type: "Kitgun Component", productCategory: "Pistols", masterable: true },
    { uniqueName: MODEL, name: "Lambeo Moa", category: "Pets", type: "Pets", productCategory: "Pistols", masterable: true },
  ] as CatalogItem[];
  const held = [inv(CHAMBER, "Catchmoon", "weapon", 0, { mastered: true }), inv(MODEL, "Lambeo Moa", "companion", 0, { mastered: true }), ...BUILT.map(([id, name, cat]) => inv(id, name, cat, 1))];
  const m = buildModel(bundle(held, catalog));
  const built = (u: string) => BUILT.some(([id]) => id === u);
  assert.deepEqual(masteryRows(m).filter((r) => built(r.unique)).map((r) => r.name), [], "Mastery leaves them out");
  const rows = inventoryRows(m).filter((r) => built(r.unique));
  assert.equal(rows.length, BUILT.length, "they are still held gear on Inventory (and for Sell spares)");
  assert.deepEqual(rows.filter((r) => r.kind === "gear" && r.levels && !r.mastered).map((r) => r.name), [], "no 'level it' and no 'Not mastered' corner");
  assert.deepEqual(rows.map((r) => [r.name, r.kind, r.levels, r.type]), BUILT.map(([, name, cat]) => [name, "gear", false, cat === "weapon" ? "Weapon" : cat === "companion" ? "Companion" : "Warframe"]), "names and kinds as before");
  // An ordinary masterable weapon is still gear to level.
  const braton = { uniqueName: "/Lotus/Weapons/Tenno/Rifle/Braton", name: "Braton", category: "Primary", type: "Rifle", masterable: true } as CatalogItem;
  const row = inventoryRows(buildModel(bundle([inv(braton.uniqueName, "Braton", "weapon", 1)], [braton])))[0];
  assert.deepEqual([row.levels, row.mastered], [true, false]);
});
