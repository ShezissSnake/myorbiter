// Modular gear (kitguns, zaws, amps, MOAs, hounds, Predasites, K-Drives): where each shows, what
// it's worth once, and the next step for it (modular.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { collection, collectionItem, groupsOf } from "../src/lib/core/collection";
import { codexRings, ringTotal, ringsFor } from "../src/lib/core/codex";
import { masteryRows } from "../src/lib/core/views";
import { wishItem } from "../src/lib/core/wishlist";
import { needsByUnique } from "../src/lib/core/spares";
import { familyOf, modularNext } from "../src/lib/core/modular";
import type { GearCopy } from "../src/lib/core/notNeeded";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const CATCHMOON = "/Lotus/Weapons/SolarisUnited/Secondary/SUModularSecondarySet1/Barrel/SUModularSecondaryBarrelAPart";
const SPORELACER = "/Lotus/Weapons/Infested/Pistols/InfKitGun/Barrels/InfBarrelEgg/InfModularBarrelEggPart";
const PARA = "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetHeadPara";
const RAPLAK = "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartA";
const MOTE = "/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingBarrel";
const TRAINING_AMP = "/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/OperatorTrainingAmpWeapon";
const BAD_BABY = "/Lotus/Types/Vehicles/Hoverboard/HoverboardParts/PartComponents/HoverboardSolarisA/HoverboardSolarisADeck";
const BALLA = "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Tip/TipOne";
const VIZIER = "/Lotus/Types/Friendly/Pets/CreaturePets/VizierPredatorKubrowPetPowerSuit";
const PLEXUS = "/Lotus/Types/Game/CrewShip/RailJack/DefaultHarness";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const SLUDGE = { uniqueName: "/Lotus/Types/Gameplay/Venus/Resources/CoolantItem", name: "Thermal Sludge", itemCount: 20, drops: [{ location: "Solaris United (Nokko), Neutral", chance: 100, rarity: "Common" }] };
const CATALOG: CatalogItem[] = [
  {
    uniqueName: CATCHMOON, name: "Catchmoon", category: "Misc", type: "Kitgun Component", masterable: true,
    components: [{ uniqueName: `${CATCHMOON}Blueprint`, name: "Blueprint", itemCount: 1 }, { uniqueName: "/Lotus/Types/Gameplay/Venus/Resources/FungusHeartItem", name: "Mytocardia Spore", itemCount: 15, drops: [{ location: "Solaris United (Nokko), Neutral", chance: 100, rarity: "Common" }] }],
  },
  { uniqueName: PARA, name: "Para Moa", category: "Pets", type: "Pets", masterable: true, components: [{ uniqueName: "/Lotus/Types/Recipes/MoaPetParts/MoaPetHeadParaBlueprint", name: "Blueprint", itemCount: 1 }] },
  {
    uniqueName: BAD_BABY, name: "Bad Baby", category: "Misc", type: "K-Drive Component", masterable: true,
    components: [{ uniqueName: `${BAD_BABY}Blueprint`, name: "Blueprint", itemCount: 1 }, SLUDGE],
  },
  { uniqueName: BALLA, name: "Balla", category: "Melee", type: "Zaw Component", masterable: true, components: [] },
  { uniqueName: "/Lotus/Weapons/Ostron/Melee/ModularMelee01/Tip/PvPVariantTipOne", name: "Balla", category: "Melee", type: "Zaw Component", masterable: false, excludeFromCodex: true },
  { uniqueName: VIZIER, name: "Vizier Predasite", category: "Pets", type: "Pets", masterable: true, productCategory: "KubrowPets" },
  { uniqueName: "/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetMeleeWeaponPS", name: "Akaten", category: "Primary", type: "Companion Weapon", masterable: true, productCategory: "SentinelWeapons" },
  { uniqueName: "/Lotus/Weapons/Operator/Pistols/DrifterPistol/DrifterPistolPlayerWeapon", name: "Sirocco", category: "Primary", type: "Pistol", masterable: true, productCategory: "OperatorAmps" },
  // How an older catalog read has the Mote Amp: named for its prism, not masterable.
  { uniqueName: MOTE, name: "Mote Prism", category: "Misc", type: "Amp", masterable: false },
] as CatalogItem[];
const bundle = (inventory: InventoryRow[] = []): Bundle => ({ observed_at: 1, inventory, catalog: CATALOG, relics: [], prices: { prices: {}, max_rank_prices: {} } }) as unknown as Bundle;
const copy = (type: string, s: string, m: string[] | undefined, f = 0, x?: number): GearCopy => ({ type, f, p: 0, s, ...(m ? { m } : {}), ...(x ? { x } : {}) });
const row = (m: ReturnType<typeof buildModel>, name: string) => masteryRows(m).find((r) => r.name === name);

test("each family's part is known by its path; Conclave's twin strikes and the blueprints aren't", () => {
  assert.equal(familyOf(CATCHMOON)?.id, "kitgun");
  assert.equal(familyOf(SPORELACER)?.id, "kitgun");
  assert.equal(familyOf(BALLA)?.id, "zaw");
  assert.equal(familyOf("/Lotus/Weapons/Ostron/Melee/ModularMeleeInfested/Tips/InfestedTipOne")?.id, "zaw");
  assert.equal(familyOf("/Lotus/Weapons/Ostron/Melee/ModularMelee01/Tip/PvPVariantTipOne"), null);
  assert.equal(familyOf("/Lotus/Weapons/Corpus/OperatorAmplifiers/Set1/Barrel/CorpAmpSet1BarrelPartC")?.gildAt, "Little Duck");
  assert.equal(familyOf(MOTE)?.id, "amp");
  assert.equal(familyOf("/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Chassis/SentAmpSet1ChassisPartA"), null, "a scaffold");
  assert.equal(familyOf(PARA)?.id, "moa");
  assert.equal(familyOf("/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetParts/ZanukaPetPartHeadB")?.id, "hound");
  assert.equal(familyOf("/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetParts/ZanukaPetPartBodyB"), null, "a hound's core");
  assert.equal(familyOf(VIZIER)?.id, "creature");
  assert.equal(familyOf(BAD_BABY)?.id, "kdrive");
  assert.equal(familyOf(`${BAD_BABY}Blueprint`), null);
  for (const bp of ["/Lotus/Types/Recipes/MoaPetParts/MoaPetHeadParaBlueprint", `${BALLA}Blueprint`, `${RAPLAK}Blueprint`, `${CATCHMOON}Blueprint`]) assert.equal(familyOf(bp), null, bp);
});

test("Codex categories: kitgun chambers in Primary and Secondary, amps and K-Drives their own, companion weapons and the Plexus with Companions", () => {
  const m = buildModel(bundle());
  const g = (name: string) => groupsOf([...m.catalogByUnique.values()].find((i) => i.name === name)!);
  assert.deepEqual(g("Catchmoon"), ["secondary", "primary"]);
  assert.deepEqual(g("Sporelacer"), ["secondary", "primary"]);
  assert.deepEqual(g("Balla"), ["melee"]);
  assert.deepEqual(g("Raplak Prism"), ["amps"]);
  assert.deepEqual(g("Mote Amp"), ["amps"]);
  assert.deepEqual(g("Sirocco"), ["amps"]);
  assert.deepEqual(g("Bad Baby"), ["kdrives"]);
  assert.deepEqual(g("Akaten"), ["companions"]);
  assert.deepEqual(g("Plexus"), ["companions"]);
  assert.deepEqual(g("Para Moa"), ["companions"]);
  // Nothing masterable is left in Other.
  assert.ok(!codexRings(m).some((r) => r.group === "other"));
  assert.ok(collection(m).every((c) => c.group !== "other"));
});

test("one chamber in two rings: counted in each, once in All, once in Mastery's points", () => {
  const m = buildModel(bundle());
  const rings = new Map(codexRings(m).map((r) => [r.group, r]));
  const all = collection(m);
  const kitguns = all.filter((c) => c.groups.includes("primary") && c.groups.includes("secondary")).length;
  assert.equal(kitguns, 3, "Catchmoon, Sporelacer, Vermisplicer");
  assert.equal(rings.get("primary")!.total, all.filter((c) => c.groups.includes("primary")).length);
  assert.equal(rings.get("secondary")!.total, all.filter((c) => c.groups.includes("secondary")).length);
  assert.equal(rings.get("primary")!.shared.total, 3);
  // All, Foundry's "of all" and Mastery's rows agree: every item once.
  assert.equal(ringTotal(codexRings(m)).total, all.length);
  const rows = masteryRows(m);
  assert.equal(rows.filter((r) => r.name === "Catchmoon").length, 1);
  assert.equal(rows.length, all.length + 0, "nothing mastered: a row for everything in the Codex");
  assert.equal(rows.find((r) => r.name === "Catchmoon")!.points, 3000);
  // A wishlist with the chamber: in both rings, one starred thing.
  const wished = ringsFor(m, [CATCHMOON]);
  assert.deepEqual(wished.map((r) => [r.group, r.total]), [["primary", 1], ["secondary", 1]]);
  assert.equal(ringTotal(wished).total, 1);
});

test("nothing in hand: the researched way to get it (the chamber's blueprint from Rude Zuud)", () => {
  const r = row(buildModel(bundle()), "Catchmoon")!;
  assert.equal(r.status, "missing");
  assert.match(r.acq.how, /^Buy the chamber blueprint at Rude Zuud \(Solaris United, Neutral, 500\)/);
  assert.equal(r.acq.difficulty, 2);
  assert.equal(r.category, "Kitgun");
});

test("a built kitgun is read from each copy's parts, a primary build or a secondary one", () => {
  for (const [type, s] of [["/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimary", "LongGuns"], ["/Lotus/Weapons/SolarisUnited/Secondary/LotusModularSecondary", "Pistols"]]) {
    const parts = [CATCHMOON, "/Lotus/Weapons/SolarisUnited/Primary/SUModularPrimarySet1/Handles/SUModularPrimaryHandleAPart"];
    const ungilded = buildModel(bundle(), undefined, null, null, null, null, [copy(type, s, parts)]);
    assert.deepEqual(ungilded.modular(CATCHMOON), { family: ungilded.modular(CATCHMOON)!.family, loose: 0, built: 1, gilded: 0, known: true, sections: [s] });
    const r = row(ungilded, "Catchmoon")!;
    assert.equal(r.status, "gild", s);
    assert.match(r.acq.how, /^Gild it at Rude Zuud in Fortuna \(Solaris United, Doer: 10 Shelter Debt-Bonds and 5,000 standing\), once it's rank 30/);
    assert.equal(r.stepTag, "Built · gild it");
    const c = collectionItem(ungilded, ungilded.catalogByUnique.get(CATCHMOON)!);
    assert.equal(c.owned, true);
    assert.equal(c.step, "gild");

    const gilded = buildModel(bundle(), undefined, null, null, null, null, [copy(type, s, parts, 8)]);
    const g = row(gilded, "Catchmoon")!;
    assert.equal(g.status, "level");
    assert.equal(g.acq.difficulty, 0);
    assert.match(g.acq.how, /^Level it \(gilded\)/);
  }
  // A primary and a secondary from the same chamber: one item, gilded if either is.
  const both = buildModel(bundle(), undefined, null, null, null, null, [copy("/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimary", "LongGuns", [CATCHMOON]), copy("/Lotus/Weapons/SolarisUnited/Secondary/LotusModularSecondary", "Pistols", [CATCHMOON], 8)]);
  assert.deepEqual([both.modular(CATCHMOON)!.built, both.modular(CATCHMOON)!.gilded, both.modular(CATCHMOON)!.sections], [2, 1, ["LongGuns", "Pistols"]]);
  assert.equal(row(both, "Catchmoon")!.status, "level");
});

test("a built kitgun's own row (named from its path) gives way to its chamber's", () => {
  const m = buildModel(bundle([inv("/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimaryShotgun", "Lotus Modular Primary Shotgun", "weapon", 1)]));
  assert.ok(!masteryRows(m).some((r) => /Lotus Modular/.test(r.name)));
});

test("a MOA model you hold is assembled at Legs; a built one is gilded, then levelled", () => {
  const loose = buildModel(bundle([inv(PARA, "Para Moa", "companion", 1)]));
  const r = row(loose, "Para Moa")!;
  assert.equal(r.status, "assemble");
  assert.match(r.acq.how, /^Assemble it at Legs in Fortuna, with a core, a gyro and a bracket \(4,000 credits\); then rank it to 30 and gild it at Legs/);
  assert.equal(r.stepTag, "Model in hand · assemble");
  assert.equal(r.acq.difficulty, 1);
  const c = collectionItem(loose, loose.catalogByUnique.get(PARA)!);
  assert.deepEqual([c.owned, c.step], [false, "assemble"], "a part in hand isn't the MOA");
  assert.deepEqual(wishItem(loose, PARA)!.missing, [], "nothing left to collect");
  assert.equal(needsByUnique(loose).get("/Lotus/Types/Recipes/MoaPetParts/MoaPetHeadParaBlueprint"), undefined, "its blueprint isn't kept for it");
  assert.equal(needsByUnique(buildModel(bundle())).get("/Lotus/Types/Recipes/MoaPetParts/MoaPetHeadParaBlueprint")?.[0].item, "Para Moa");

  const built = buildModel(bundle(), undefined, null, null, null, null, [copy("/Lotus/Types/Friendly/Pets/MoaPets/MoaPetPowerSuit", "MoaPets", [PARA, "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetEngineArmor"])]);
  assert.equal(row(built, "Para Moa")!.status, "gild");
  assert.match(row(built, "Para Moa")!.acq.how, /Legs in Fortuna \(Solaris United, Doer: 10 Training Debt-Bonds/);
  const gilded = buildModel(bundle(), undefined, null, null, null, null, [copy("/Lotus/Types/Friendly/Pets/MoaPets/MoaPetPowerSuit", "MoaPets", [PARA], 8)]);
  assert.equal(row(gilded, "Para Moa")!.stepTag, "Gilded · level it");
  // Mastered: gone from the list, whatever's held.
  assert.ok(!row(buildModel(bundle([inv(PARA, "Para Moa", "companion", 1, { mastered: true })])), "Para Moa"));
});

test("an ungilded amp: gild it with Onkko or Little Duck; the Mote Amp is held as the training amp", () => {
  const amp = buildModel(bundle(), undefined, null, null, null, null, [copy("/Lotus/Weapons/Sentients/OperatorAmplifiers/OperatorAmpWeapon", "OperatorAmps", [RAPLAK, "/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Chassis/SentAmpSet1ChassisPartA"])]);
  const r = row(amp, "Raplak Prism")!;
  assert.equal(r.status, "gild");
  assert.match(r.acq.how, /^Gild it at Onkko in Cetus \(The Quills, Adherent\) or Little Duck in Fortuna \(Vox Solaris, Hand\), for 5,000 standing, once it's rank 30/);
  assert.equal(r.acq.icon, "quills");

  // The older catalog's "Mote Prism" is the Mote Amp, and gives mastery.
  const held = [inv(TRAINING_AMP, "Operator Training Amp Weapon", "weapon", 1)];
  const mote = buildModel(bundle(held), undefined, null, null, null, null, [copy(TRAINING_AMP, "OperatorAmps", undefined)]);
  assert.equal(mote.catalogByUnique.get(MOTE)!.name, "Mote Amp");
  assert.equal(mote.catalogByUnique.get(MOTE)!.masterable, true);
  assert.equal(row(mote, "Mote Amp")!.status, "gild");
  const gilded = buildModel(bundle(held), undefined, null, null, null, null, [copy(TRAINING_AMP, "OperatorAmps", undefined, 8)]);
  assert.equal(row(gilded, "Mote Amp")!.stepTag, "Gilded · level it");
  // Without each copy read (TennoScope unpatched), it's in the arsenal, gilded or not.
  assert.equal(row(buildModel(bundle(held)), "Mote Amp")!.stepTag, "Owned · gild, then level");
});

test("a revived Predasite is held whole: gild it with Son", () => {
  const held = [inv(VIZIER, "Vizier Predasite", "companion", 1)];
  const m = buildModel(bundle(held), undefined, null, null, null, null, [copy(VIZIER, "KubrowPets", undefined)]);
  const r = row(m, "Vizier Predasite")!;
  assert.equal(r.status, "gild");
  assert.match(r.acq.how, /Son in the Necralisk \(Entrati, Associate: 10 Son Tokens/);
});

test("K-Drives: the board's blueprint is a part, not a resource; a built one only needs levelling", () => {
  const bp = buildModel(bundle([inv(`${BAD_BABY}Blueprint`, "Bad Baby Blueprint", "blueprint", 1)]));
  const c = collectionItem(bp, bp.catalogByUnique.get(BAD_BABY)!);
  assert.deepEqual(c.parts.filter((p) => !p.resource).map((p) => [p.label, p.have]), [["Blueprint", 1]]);
  assert.equal(c.buildable, true);
  // The resource's own vendor isn't where the board comes from.
  assert.doesNotMatch(row(buildModel(bundle()), "Bad Baby")!.acq.how, /Thermal Sludge from/);

  const built = buildModel(bundle(), undefined, null, null, null, null, [copy("/Lotus/Types/Vehicles/Hoverboard/HoverboardSuit", "Hoverboards", [BAD_BABY])]);
  const r = row(built, "Bad Baby")!;
  assert.deepEqual([r.status, r.stepTag, r.points], ["level", "Owned · level it", 6000]);
});

test("a resource under Gameplay is a resource: its vendor isn't the item's source", () => {
  const item = { ...CATALOG[0], uniqueName: "/Test/Chamber", name: "Testchamber" } as CatalogItem;
  const m = buildModel({ ...bundle(), catalog: [item] } as Bundle);
  assert.doesNotMatch(row(m, "Testchamber")!.acq.how, /Mytocardia Spore from/);
});

test("the Plexus is mastered at rank 30, read from its copy", () => {
  const m = buildModel(bundle([inv(PLEXUS, "Default Harness", "resource", 0)]), undefined, null, null, null, null, [copy(PLEXUS, "CrewShipHarnesses", undefined, 0, 900_000)]);
  assert.ok(m.isMastered(PLEXUS));
  assert.ok(!row(m, "Plexus"));
  const half = buildModel(bundle([inv(PLEXUS, "Default Harness", "resource", 0)]), undefined, null, null, null, null, [copy(PLEXUS, "CrewShipHarnesses", undefined, 0, 225_000)]);
  assert.ok(!half.isMastered(PLEXUS));
});

test("the next step, worded per family", () => {
  const f = familyOf(BAD_BABY)!;
  assert.equal(modularNext({ family: f, loose: 1, built: 0, gilded: 0, known: true, sections: [] }, false)!.how, "Assemble it at Roky in Fortuna, with a reactor, a nose and a jet; then rank it to 30 for the mastery.");
  assert.equal(modularNext({ family: f, loose: 0, built: 0, gilded: 0, known: true, sections: [] }, false), null, "nothing in hand: how to get it is the researched entry");
  assert.equal(modularNext({ family: f, loose: 0, built: 1, gilded: 0, known: true, sections: [] }, true), null, "mastered");
});

test("Wishlist: a vendor's blueprint says where to buy it", () => {
  const w = wishItem(buildModel(bundle()), BAD_BABY)!;
  assert.deepEqual(w.missing.map((p) => p.label), ["Blueprint"]);
  assert.equal(w.missing[0].how, "Buy the board blueprint at Roky (Ventkids, Neutral, 5,000), in Fortuna (needs the Vox Solaris quest), and build it");
});
