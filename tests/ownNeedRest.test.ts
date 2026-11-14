import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./wikiFiles";
import { buildModel } from "../src/lib/core/model";
import { almostComplete, arcaneRows, inventoryRows, masteryRows, modRows, modSpares, partRows, setRows } from "../src/lib/core/views";
import { matches } from "../src/lib/ui/table";
import { radiantRows, setGaps } from "../src/lib/core/advice";
import { dropBuilding, dropCounts, emptyDropLog, recordRead, type DropLog } from "../src/lib/core/drops";
import { recipesFor } from "../src/lib/core/recipes";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const bundle = (inventory: InventoryRow[], catalog: CatalogItem[], prices: Bundle["prices"] = { prices: {}, max_rank_prices: {} }, relics: Bundle["relics"] = []): Bundle =>
  ({ observed_at: 1_700_000_000, inventory, catalog, relics, prices }) as Bundle;

// 1
test("mods: spare copies at max rank are valued at the max-rank price", () => {
  const serration = { uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10, tradable: true } as CatalogItem;
  const m = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 3, { rank: 10, max_rank: 10 })], [serration], { prices: { Serration: 3 }, max_rank_prices: { Serration: 50 } }));
  const r = modRows(m).find((x) => x.name === "Serration")!;
  const spare = modSpares(r);
  assert.deepEqual(spare, [{ rank: 10, count: 1 }], "the one spare copy is a rank-10 copy");
  assert.equal(r.extrasValue, 50, "Worth selling prices that rank-10 copy");
});

// 2
const BRONCO = { uniqueName: "/W/BroncoPrime", name: "Bronco Prime", category: "Secondary", masterable: true, isPrime: true, components: [
  { uniqueName: "/W/BroncoPrimeBlueprint", name: "Blueprint", ducats: 15, itemCount: 1 },
  { uniqueName: "/W/BroncoPrimeBarrel", name: "Barrel", ducats: 25, itemCount: 1 },
  { uniqueName: "/W/BroncoPrimeReceiver", name: "Receiver", ducats: 25, itemCount: 1 },
] } as CatalogItem;
const AKBRONCO = { uniqueName: "/W/AkbroncoPrime", name: "Akbronco Prime", category: "Secondary", masterable: true, isPrime: true, components: [
  { uniqueName: "/W/AkbroncoPrimeBlueprint", name: "Blueprint", ducats: 15, itemCount: 1 },
  { uniqueName: "/W/AkbroncoPrimeLink", name: "Link", ducats: 15, itemCount: 1 },
  { uniqueName: "/W/BroncoPrime", name: "Bronco Prime", itemCount: 2 },
] } as CatalogItem;

test("planner: 'Parts I need' counts a Bronco Prime Receiver that Akbronco Prime still needs, as Prime parts keeps the Barrel", () => {
  const relics = [
    { uniqueName: "/Relic/B1Bronze", name: "Lith B1 Intact", vaulted: false, rewards: [{ name: "Bronco Prime Receiver", rarity: "Uncommon", chance: 11 }, { name: "Forma Blueprint", rarity: "Common", chance: 89 }] },
    { uniqueName: "/Relic/B1Platinum", name: "Lith B1 Radiant", vaulted: false, rewards: [{ name: "Bronco Prime Receiver", rarity: "Uncommon", chance: 20 }, { name: "Forma Blueprint", rarity: "Common", chance: 80 }] },
  ] as Bundle["relics"];
  const held = [
    inv("/W/BroncoPrime", "Bronco Prime", "weapon", 1, { mastered: true }),
    inv("/W/BroncoPrimeBarrel", "Bronco Prime Barrel", "prime_part", 1),
    inv("/Relic/B1Bronze", "Lith B1 Intact", "relic", 3),
  ];
  const m = buildModel(bundle(held, [BRONCO, AKBRONCO], undefined, relics));
  const kept = partRows(m).find((r) => r.name === "Bronco Prime Barrel")!;
  assert.deepEqual({ keep: kept.keep, keptFor: kept.keptFor }, { keep: 1, keptFor: "Akbronco Prime" }, "Prime parts keeps the barrel for a second Bronco Prime");
  const row = radiantRows(m, { squad: 1, metric: "need" }).find((r) => r.base === "Lith B1")!;
  assert.deepEqual(row.neededNames, ["Bronco Prime Receiver"], "Planner, Parts I need: the receiver that second Bronco Prime still needs");
});

// 3
test("planner-foundry: a part being crafted for an unbuilt prime isn't a part to crack for", () => {
  const RP = { uniqueName: "/R/RhinoPrime", name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [
    { uniqueName: "/R/RhinoPrimeBlueprint", name: "Blueprint", ducats: 100, itemCount: 1 },
    { uniqueName: "/R/RhinoPrimeChassisComponent", name: "Chassis", ducats: 15, itemCount: 1 },
    { uniqueName: "/R/RhinoPrimeHelmetComponent", name: "Neuroptics", ducats: 45, itemCount: 1 },
    { uniqueName: "/R/RhinoPrimeSystemsComponent", name: "Systems", ducats: 45, itemCount: 1 },
  ] } as CatalogItem;
  const held = [
    inv("/R/RhinoPrimeBlueprint", "Rhino Prime Blueprint", "prime_part", 1),
    inv("/R/RhinoPrimeHelmetBlueprint", "Rhino Prime Neuroptics Blueprint", "prime_part", 1),
    inv("/R/RhinoPrimeSystemsBlueprint", "Rhino Prime Systems Blueprint", "prime_part", 1),
  ];
  const m = buildModel(bundle(held, [RP]), undefined, { "/R/RhinoPrimeChassisBlueprint": 1 });
  const mastery = masteryRows(m).find((r) => r.name === "Rhino Prime")!.status;
  const planner = setGaps(m, 1).map((g) => `${g.set}: ${g.missing.map((x) => x.name).join(", ")}`);
  assert.deepEqual({ mastery, planner }, { mastery: "build", planner: [] });
});

// 4
const RHINO: CatalogItem = {
  uniqueName: "/Lotus/Powersuits/Rhino/Rhino", name: "Rhino", category: "Warframes", type: "Warframe", masterable: true,
  components: [
    { uniqueName: "/Lotus/Types/Recipes/WarframeRecipes/RhinoBlueprint", name: "Blueprint", itemCount: 1 },
    { uniqueName: "/Lotus/Types/Recipes/WarframeRecipes/RhinoChassisComponent", name: "Chassis", itemCount: 1 },
    { uniqueName: "/Lotus/Types/Recipes/WarframeRecipes/RhinoHelmetComponent", name: "Neuroptics", itemCount: 1 },
    { uniqueName: "/Lotus/Types/Recipes/WarframeRecipes/RhinoSystemsComponent", name: "Systems", itemCount: 1 },
  ],
} as CatalogItem;
const LATO: CatalogItem = {
  uniqueName: "/Lotus/Weapons/Tenno/Pistol/LatoVandal", name: "Lato Vandal", category: "Secondary", type: "Pistol", masterable: true,
  components: [
    { uniqueName: "/Lotus/Types/Recipes/Weapons/WeaponParts/LatoVandalBarrel", name: "Barrel", itemCount: 1 },
    { uniqueName: "/Lotus/Types/Recipes/Weapons/LatoVandalBlueprint", name: "Blueprint", itemCount: 1 },
    { uniqueName: "/Lotus/Types/Recipes/Weapons/WeaponParts/LatoVandalReceiver", name: "Receiver", itemCount: 1 },
  ],
} as CatalogItem;

test("drops: crafting a Rhino Chassis from its blueprint is not a drop", () => {
  const lato = inv("/Lotus/Types/Recipes/Weapons/WeaponParts/LatoVandalBarrel", "Lato Vandal Barrel", "blueprint", 2);
  const read = (rows: InventoryRow[], foundry: Record<string, number>) => {
    const m = buildModel(bundle([lato, ...rows], [RHINO, LATO]), undefined, foundry);
    return { counts: dropCounts(m), building: dropBuilding(m) };
  };
  const r1 = read([inv("/Lotus/Types/Recipes/WarframeRecipes/RhinoChassisBlueprint", "Rhino Chassis Blueprint", "blueprint", 1)], {});
  const r2 = read([], { "/Lotus/Types/Recipes/WarframeRecipes/RhinoChassisBlueprint": 1 });
  const r3 = read([inv("/Lotus/Types/Recipes/WarframeRecipes/RhinoChassisComponent", "Rhino Chassis", "blueprint", 1)], {});
  let log = recordRead(emptyDropLog(), r1.counts, 1_000, 1_000, r1.building)!;
  log = recordRead(log, r2.counts, 2_000, 2_000, r2.building) ?? log;
  log = recordRead(log, r3.counts, 3_000, 3_000, r3.building) ?? log;
  assert.deepEqual({ building: r2.building, gains: log.windows.map((w) => w.gains) }, { building: { "Rhino Chassis": 1 }, gains: [] });
});

// 6
test("recipes: a captured Predasite reads the same on Mastery and on its Recipes card", () => {
  const VIZIER = "/Lotus/Types/Friendly/Pets/CreaturePets/VizierPredatorKubrowPetPowerSuit";
  const catalog = [{ uniqueName: VIZIER, name: "Vizier Predasite", category: "Pets", type: "Pets", productCategory: "KubrowPets", masterable: true }] as CatalogItem[];
  const held = [inv("/Lotus/Types/Friendly/Pets/CreaturePets/Deimos/WoundedInfestedPredatorKubrowPetPowerSuit", "Vizier Predasite", "companion", 1)];
  const m = buildModel(bundle(held, catalog));
  const row = masteryRows(m).find((r) => r.unique === VIZIER)!;
  const sub = recipesFor("Vizier Predasite", null, m)!.combos[0].parts.find((p) => p.role === "subspecies")!;
  assert.deepEqual({ revive: row.revive, how: row.acq.how }, { revive: true, how: "You've captured one: revive it with Son in the Necralisk (Revivification, with a Mutagen and an Antigen)." }, "Mastery sees the capture");
  assert.notEqual(sub.status, "missing", `Recipes: ${sub.status} · ${sub.where}`);
  assert.deepEqual({ status: sub.status, held: sub.held, where: sub.where }, { status: "held", held: 1, where: "You've captured one: revive it with Son in the Necralisk (Revivification, with a Mutagen and an Antigen)" });
  const r = recipesFor("Vizier Predasite", null, m)!;
  assert.ok(r.gaps.every((g) => !/can't see/.test(g)), "no gap sentence says a caught one can't be seen");
  // Nothing caught: the card still says to catch one.
  const none = recipesFor("Vizier Predasite", null, buildModel(bundle([], catalog)))!.combos[0].parts.find((p) => p.role === "subspecies")!;
  assert.equal(none.status, "missing");
  assert.match(none.where, /^Catch a Weakened Vizier Predasite/);
});

test("mods: a cheap mod's maxed spare is valued at the maxed price, an in-between one at the unranked price", () => {
  const item = { uniqueName: "/M/Cheap", name: "Cheap Mod", category: "Mods", maxRank: 5, tradable: true } as CatalogItem;
  const prices = { prices: { "Cheap Mod": 1 }, max_rank_prices: { "Cheap Mod": 30 } };
  const m = buildModel(bundle([inv("/M/Cheap", "Cheap Mod", "mod", 3, { rank: 5, max_rank: 5 })], [item], prices));
  const r = modRows(m).find((x) => x.name === "Cheap Mod")!;
  assert.equal(r.extrasValue, 30);
  // A spare between unranked and maxed has no daily price of its own: the unranked one.
  const mid = buildModel(bundle([inv("/M/Cheap", "Cheap Mod", "mod", 3, { rank: 3, max_rank: 5 })], [item], prices));
  assert.equal(modRows(mid).find((x) => x.name === "Cheap Mod")!.extrasValue, 1);
});

test("planner: a set to sell counts only tradable copies; a built part counts toward the one to build", () => {
  const RP = { uniqueName: "/R/RhinoPrime", name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [
    { uniqueName: "/R/RhinoPrimeBlueprint", name: "Blueprint", ducats: 100, itemCount: 1 },
    { uniqueName: "/R/RhinoPrimeChassisComponent", name: "Chassis", ducats: 15, itemCount: 1 },
    { uniqueName: "/R/RhinoPrimeHelmetComponent", name: "Neuroptics", ducats: 45, itemCount: 1 },
    { uniqueName: "/R/RhinoPrimeSystemsComponent", name: "Systems", ducats: 45, itemCount: 1 },
  ] } as CatalogItem;
  const gap = (held: InventoryRow[], foundry: Record<string, number> = {}) => setGaps(buildModel(bundle(held, [RP]), undefined, foundry), 2).map((g) => `${g.set}: ${g.missing.map((x) => `${x.count}× ${x.name}`).join(", ")}`);
  const bp = (n: number) => inv("/R/RhinoPrimeBlueprint", "Rhino Prime Blueprint", "prime_part", n);
  const neuro = (n: number) => inv("/R/RhinoPrimeHelmetBlueprint", "Rhino Prime Neuroptics Blueprint", "prime_part", n);
  const sys = (n: number) => inv("/R/RhinoPrimeSystemsBlueprint", "Rhino Prime Systems Blueprint", "prime_part", n);
  // To build: a built Chassis counts, so only the Systems is missing.
  const builtChassis = [bp(1), neuro(1), inv("/R/RhinoPrimeChassisComponent", "Rhino Prime Chassis", "prime_part", 1)];
  assert.deepEqual(gap(builtChassis), ["Rhino Prime: 1× Rhino Prime Systems Blueprint"]);
  // Sets' Almost complete shows no Finish & sell for it: finished, it's built, not sold whole.
  assert.equal(setRows(buildModel(bundle(builtChassis, [RP]))).find((r) => r.name === "Rhino Prime")!.countsBuilt, true);
  assert.equal(setRows(buildModel(bundle([bp(1), neuro(1)], [RP]))).find((r) => r.name === "Rhino Prime")!.countsBuilt, undefined);
  // Mastered: every set is one to sell, and a Chassis in the foundry can't be sold.
  const mastered = [bp(1), neuro(1), sys(1), inv("/R/RhinoPrime", "Rhino Prime", "warframe", 1, { mastered: true })];
  assert.deepEqual(gap(mastered, { "/R/RhinoPrimeChassisBlueprint": 1 }), ["Rhino Prime: 1× Rhino Prime Chassis Blueprint"]);
  // Built in any form for the build, the next set is one to sell, after the copies kept to build.
  assert.deepEqual(gap([bp(2), neuro(2), sys(1)], { "/R/RhinoPrimeChassisBlueprint": 1 }), ["Rhino Prime: 1× Rhino Prime Chassis Blueprint, 1× Rhino Prime Systems Blueprint"]);
});

// 7
test("sets: Planner's near sets and Sets' Almost complete count the same set", () => {
  const RP = { uniqueName: "/R/RhinoPrime", name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true, components: [
    { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 },
    { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
    { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 45, itemCount: 1 },
    { uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 },
  ] } as CatalogItem;
  const held = [
    inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", 2),
    inv("/R/Chassis", "Rhino Prime Chassis Blueprint", "prime_part", 2),
    inv("/R/Helmet", "Rhino Prime Neuroptics Blueprint", "prime_part", 2),
    inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 1),
  ];
  const m = buildModel(bundle(held, [RP]));
  const planner = setGaps(m, 2).map((g) => g.set);
  assert.deepEqual(planner, ["Rhino Prime"], "a second set one part short");
  const sets = setRows(m).filter(almostComplete).map((r) => r.name);
  assert.deepEqual(sets, planner);
  // Sets.svelte's "Almost complete" view filters by that same test.
  const page = readFileSync(new URL("../src/lib/tabs/Sets.svelte", import.meta.url), "utf8");
  assert.match(page, /: almostComplete\(r\) && matches\(q, r\.name\)/);
  assert.doesNotMatch(page, /completeSets === 0/);
});

// 8
test("arcanes: an arcane the catalog lists under two paths shows its copies in its detail", () => {
  const catalog = [
    { uniqueName: "/A/EnergizeA", name: "Arcane Energize", category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true },
    { uniqueName: "/A/EnergizeB", name: "Arcane Energize", category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true },
  ] as CatalogItem[];
  const m = buildModel(bundle([inv("/A/EnergizeB", "Arcane Energize", "arcane", 5, { rank: 0, max_rank: 5 })], catalog));
  const r = arcaneRows(m).find((x) => x.name === "Arcane Energize")!;
  assert.equal(r.copies, 5);
  assert.deepEqual(r.ranks, [{ rank: 0, count: 5 }], "the row's copies by rank, from both paths");
  // Arcanes.svelte's detail shows the row's own ranks, not one path's.
  const page = readFileSync(new URL("../src/lib/tabs/Arcanes.svelte", import.meta.url), "utf8");
  assert.match(page, /const ranksOf = \(r: ArcaneRow\) => r\.ranks;/);
  assert.doesNotMatch(page, /inventoryByBase\.get\(r\.unique\)/);
});

// 4: a log saved before blueprints of `…Component` parts were counted
test("drops: a log saved before blueprints were counted takes its next read as a baseline, not as drops", () => {
  const counts = { "Rhino Chassis": 2, "Lato Vandal Barrel": 1 };
  const old: DropLog = { at: 1_000, counts: { "Lato Vandal Barrel": 1 }, windows: [{ from: 500, at: 1_000, gains: { "Lato Vandal Barrel": 1 } }] };
  const next = recordRead(old, counts, 2_000)!;
  assert.deepEqual({ counts: next.counts, gains: next.windows.map((w) => w.gains) }, { counts, gains: [{ "Lato Vandal Barrel": 1 }] });
  const later = recordRead(next, { ...counts, "Rhino Chassis": 3 }, 3_000)!;
  assert.deepEqual(later.windows.at(-1)!.gains, { "Rhino Chassis": 1 }, "and counts drops from it");
});

// 9b
test("drops: a read older than the last one (the clock set back) is a new baseline, and reads after it count", () => {
  let log = recordRead(emptyDropLog(), { a: 1 }, 10_000)!;
  // The clock was ahead and is set right: the next reads are older than the last recorded one.
  const back = recordRead(log, { a: 3 }, 5_000);
  assert.ok(back, "the older read is taken in");
  assert.deepEqual({ at: back.at, counts: back.counts, windows: back.windows }, { at: 5_000, counts: { a: 3 }, windows: [] }, "as a baseline: no gains");
  log = recordRead(back, { a: 4 }, 6_000)!;
  assert.deepEqual(log.windows.map((w) => w.gains), [{ a: 1 }], "the read after it counts, though still before the old last read");
});

// 9a
test("drops: the 30-day totals are worked out again as time passes, not only when the log or the trades change", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  const effect = app.match(/\$effect\(\(\) => \{\n[^]*?recentDrops\([^]*?\n  \}\);/)?.[0] ?? "";
  assert.match(effect, /recentDrops/);
  assert.match(effect, /dropsHour/, "the effect reads an hourly clock, so a window older than 30 days goes within the hour");
  assert.match(app, /const dropsHour = \$derived\(Math\.floor\(tick \/ 3_600_000\)\)/);
});

// Brief point 9 (the PM's): a built modular item is named by its family. Paths from the fixtures in
// notGear.test.ts and modular.test.ts, and TennoScope's inventory decoder test.
const BUILT_FAMILIES = [
  ["/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimary", "Lotus Modular Primary", "weapon", "Kitgun (primary)"],
  ["/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimaryBeam", "Lotus Modular Primary Beam", "weapon", "Kitgun (primary)"],
  ["/Lotus/Weapons/SolarisUnited/Primary/LotusModularPrimaryShotgun", "Lotus Modular Primary Shotgun", "weapon", "Kitgun (primary)"],
  ["/Lotus/Weapons/SolarisUnited/Secondary/LotusModularSecondary", "Lotus Modular Secondary", "weapon", "Kitgun (secondary)"],
  ["/Lotus/Weapons/Ostron/Melee/LotusModularMelee", "Lotus Modular Melee", "weapon", "Zaw"],
  ["/Lotus/Weapons/Sentients/OperatorAmplifiers/OperatorAmpWeapon", "Operator Amp Weapon", "weapon", "Amp"],
  ["/Lotus/Types/Friendly/Pets/MoaPets/MoaPetPowerSuit", "Moa Pet Power Suit", "companion", "MOA"],
  ["/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetAPowerSuit", "Zanuka Pet A Power Suit", "companion", "Hound"],
  ["/Lotus/Types/Vehicles/Hoverboard/HoverboardSuit", "Hoverboard Suit", "frame", "K-Drive"],
] as const;

for (const [unique, name, category, family] of BUILT_FAMILIES) {
  test(`inventory: a built ${family} (${name}) is shown by its family, its row otherwise unchanged`, () => {
    const m = buildModel(bundle([inv(unique, name, category, 1)], []));
    const r = inventoryRows(m).find((x) => x.unique === unique)!;
    assert.equal(r.builtAs, family);
    // What Sell spares and Mastery read stays the inventory's.
    assert.deepEqual({ name: r.name, kind: r.kind, levels: r.levels }, { name, kind: "gear", levels: false });
    assert.ok(matches(family.split(" ")[0].toLowerCase(), r.name, r.type, r.builtAs), "a search for the family's name finds it");
  });
}

test("inventory: a modular path that doesn't say its family keeps the inventory's name", () => {
  const m = buildModel(bundle([inv("/Lotus/Weapons/Other/LotusModularThing", "Lotus Modular Thing", "weapon", 1)], []));
  assert.equal(inventoryRows(m).find((x) => x.name === "Lotus Modular Thing")!.builtAs, undefined);
  const plain = buildModel(bundle([inv("/Lotus/Weapons/Tenno/Rifle/Braton", "Braton", "weapon", 1)], []));
  assert.equal(inventoryRows(plain)[0].builtAs, undefined);
});

test("inventory page: the card, table and detail draw the family's name and 'Built', and the search reads it", () => {
  const page = readFileSync(new URL("../src/lib/tabs/Inventory.svelte", import.meta.url), "utf8");
  assert.match(page, /const shown = \(r: InventoryItem\) => r\.builtAs \?\?/);
  assert.match(page, /const kindLine = \(r: InventoryItem\) => \(r\.builtAs \? "Built"/);
  assert.match(page, /matches\(q, r\.name, r\.type, shown\(r\)/);
  assert.match(page, /title=\{shown\(r\)\} sub=\{kindLine\(r\)\}/);
  assert.match(page, /title=\{\(r\) => shown\(r\)\} kicker=\{kindLine\}/);
});
