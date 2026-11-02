// Edge cases that once went wrong: relics without refinements, gems named "Radiant", Necramech
// sets, items sold both as the blueprint and built, and the Orders search for sets that aren't prime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, gearSetParts } from "../src/lib/core/model";
import { craftVariantOf, heldFor, holdings, indexItems, type MarketItem } from "../src/lib/core/market";
import { splitRefinement } from "../src/lib/core/trades";
import { spareOf } from "../src/lib/core/views";
import { spareRows } from "../src/lib/core/spares";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const bundle = (inventory: InventoryRow[], catalog: unknown[] = []): Bundle => ({ observed_at: 1_700_000_000, inventory, catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } }) as unknown as Bundle;
const item = (o: Partial<MarketItem> & { name: string }): MarketItem => ({ id: o.name, slug: o.name.toLowerCase().replace(/ /g, "_"), maxRank: null, subtypes: null, tags: [], ...o }) as MarketItem;

test("a relic without refinements (Requiem Eterna) is held as intact", () => {
  const ETERNA = "/Lotus/Types/Game/Projections/T5VoidProjectionImmortalOmniA";
  const m = buildModel(bundle([inv(ETERNA, "Requiem Eterna Intact", "relic", 8)]));
  const it = item({ name: "Requiem Eterna Relic", gameRef: ETERNA, tags: ["relic", "requiem"], subtypes: ["intact", "exceptional", "flawless", "radiant"] });
  assert.deepEqual(holdings(m, it), [{ rank: null, subtype: "intact", count: 8 }]);
  assert.equal(heldFor(m, it, { rank: null, subtype: "intact" }), 8);
});

test("only a relic's name loses its refinement: Radiant Zodian is a gem", () => {
  assert.deepEqual(splitRefinement("Radiant Zodian"), { name: "Radiant Zodian", subtype: null });
  assert.deepEqual(splitRefinement("Axi A1 Relic [Radiant]"), { name: "Axi A1 Relic", subtype: "radiant" });
  assert.deepEqual(splitRefinement("Lith G1 Radiant"), { name: "Lith G1", subtype: "radiant" });
});

test("a Necramech set's parts are its Capsule, Casing, Engine and Weapon Pod, not just the blueprint", () => {
  const VOIDRIG = "/Lotus/Powersuits/EntratiMech/NecroMech";
  const MECH = "/Lotus/Types/Gameplay/InfestedMicroplanet/Resources/Mechs/";
  const m = buildModel(bundle([], [{
    uniqueName: VOIDRIG, name: "Voidrig", category: "Misc", masterable: true,
    components: [
      { uniqueName: "/Lotus/Types/Recipes/DeimosRecipes/Mechs/NecromechBlueprint", name: "Blueprint", itemCount: 1 },
      { uniqueName: `${MECH}NecromechPartSystemsItem`, name: "Voidrig Capsule", itemCount: 1 },
      { uniqueName: `${MECH}NecromechPartChassisItem`, name: "Voidrig Casing", itemCount: 1 },
      { uniqueName: "/Lotus/Types/Items/MiscItems/Morphic", name: "Morphics", itemCount: 10 },
    ],
  }]));
  assert.deepEqual(gearSetParts(m, VOIDRIG)?.map((p) => p.name), ["Voidrig Blueprint", "Voidrig Capsule", "Voidrig Casing"]);
});

test("a part sold both as the blueprint and built is listed as the variant you hold", () => {
  const BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/CrpArSniperBarrel";
  const LIMB = "/Lotus/Types/Recipes/Weapons/WeaponParts/DaxDuviriAsymmetricalLongBowLowerLimbBlueprint";
  const idx = indexItems([
    item({ name: "Ambassador Barrel", gameRef: BARREL, subtypes: ["blueprint", "crafted"], tags: ["weapon", "component"] }),
    item({ name: "Cinta Lower Limb Blueprint", gameRef: LIMB, subtypes: ["crafted", "blueprint"], tags: ["weapon", "blueprint"] }),
  ]);
  assert.deepEqual(craftVariantOf(idx, `${BARREL}Blueprint`)?.subtype, "blueprint");
  assert.deepEqual(craftVariantOf(idx, BARREL)?.subtype, "crafted");
  assert.deepEqual(craftVariantOf(idx, LIMB)?.subtype, "blueprint");
  assert.deepEqual(craftVariantOf(idx, LIMB.replace(/Blueprint$/, ""))?.subtype, "crafted");
  const m = buildModel(bundle([inv(`${BARREL}Blueprint`, "Ambassador Barrel Blueprint", "blueprint", 3), inv(BARREL, "Ambassador Barrel", "resource", 2)]));
  const amb = idx.byName.get("ambassador barrel")!;
  assert.deepEqual(holdings(m, amb), [{ rank: null, subtype: "blueprint", count: 3 }, { rank: null, subtype: "crafted", count: 2 }]);
  assert.equal(heldFor(m, amb, { rank: null, subtype: "crafted" }), 2);
  const rows = spareRows(m, idx).filter((r) => r.name === "Ambassador Barrel");
  assert.deepEqual(rows.map((r) => [r.subtype, r.quantity]).sort(), [["blueprint", 3], ["crafted", 2]]);
});

test("the Orders search counts sets that aren't prime by what you hold", () => {
  const m = buildModel(bundle([]));
  assert.equal(spareOf(m, "Mandonel Set", ["weapon", "set"]), null);
  assert.deepEqual(spareOf(m, "Rhino Prime Set", ["warframe", "set", "prime"]), { rank: null, quantity: 0 });
});
