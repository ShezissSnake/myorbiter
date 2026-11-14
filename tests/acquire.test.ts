import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { masteryRows } from "../src/lib/core/views";
import { collection } from "../src/lib/core/collection";
import { masteryPoints } from "../src/lib/core/acquire";
import { baroStock, until } from "../src/lib/core/traders";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const part = (uniqueName: string, name: string, location?: string, chance = 100) => ({
  uniqueName, name, itemCount: 1, drops: location ? [{ location, chance, rarity: "Common" }] : [],
});
const res = (name: string, n: number) => ({ uniqueName: `/Lotus/Types/Items/MiscItems/${name.replace(/ /g, "")}`, name, itemCount: n, drops: [] });

const GALATINE = "/Lotus/Weapons/Tenno/Melee/Galatine";
const BARUUK = "/Lotus/Powersuits/Pacifist/Pacifist";
const HEMA = "/Lotus/Weapons/Tenno/Hema";
const LOKI = "/Lotus/Powersuits/Loki/Loki";
const KUVA = "/Lotus/Weapons/Grineer/KuvaBramma";
const OWNED = "/Lotus/Weapons/Tenno/Owned";
const SIMULOR = "/Lotus/Weapons/Tenno/Simulor";

const catalog: CatalogItem[] = [
  { uniqueName: GALATINE, name: "Galatine", category: "Melee", masterable: true, bpCost: 25000, components: [part("/Lotus/Types/Recipes/Weapons/GalatineBlueprint", "Blueprint"), res("Alloy Plate", 200)] } as CatalogItem,
  { uniqueName: BARUUK, name: "Baruuk", category: "Warframes", masterable: true, components: [
    part("/Lotus/Types/Recipes/WarframeRecipes/PacifistBlueprint", "Blueprint", "Vox Solaris, Agent"),
    part("/Lotus/Types/Recipes/WarframeRecipes/PacifistChassisComponent", "Chassis", "Vox Solaris, Hand"),
    res("Orokin Cell", 1),
  ] } as CatalogItem,
  { uniqueName: HEMA, name: "Hema", category: "Primary", masterable: true, bpCost: 15000, components: [part("/Lotus/Types/Recipes/Weapons/HemaBlueprint", "Blueprint")] } as CatalogItem,
  { uniqueName: LOKI, name: "Loki", category: "Warframes", masterable: true, bpCost: 35000, components: [
    part("/Lotus/Types/Recipes/WarframeRecipes/LokiBlueprint", "Blueprint"),
    part("/Lotus/Types/Recipes/WarframeRecipes/LokiChassisComponent", "Chassis", "Venus/Psamathe (Assassination)", 38),
  ] } as CatalogItem,
  { uniqueName: KUVA, name: "Kuva Bramma", category: "Primary", masterable: true } as CatalogItem,
  { uniqueName: OWNED, name: "Owned Gun", category: "Primary", masterable: true, bpCost: 1 } as CatalogItem,
  { uniqueName: SIMULOR, name: "Simulor", category: "Primary", masterable: true, components: [part("/Lotus/Types/Recipes/Weapons/SimulorBlueprint", "Blueprint", "Cephalon Simaris")] } as CatalogItem,
];
const bundle = (inventory: InventoryRow[] = []): Bundle => ({ observed_at: 1_700_000_000, inventory, catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } });
const rows = (inventory: InventoryRow[] = []) => new Map(masteryRows(buildModel(bundle(inventory))).map((r) => [r.name, r]));

test("a credits blueprint from the Market is the easiest thing to get", () => {
  const g = rows().get("Galatine")!;
  assert.equal(g.acq.method, "market-credits");
  assert.equal(g.acq.difficulty, 1);
  assert.match(g.acq.how, /Market \(25,000 credits\)/);
});

test("syndicate parts at a high rank make it a grind, with the syndicate's sigil (researched, icon from the drop data)", () => {
  const b = rows().get("Baruuk")!;
  assert.equal(b.acq.method, "syndicate");
  assert.equal(b.acq.difficulty, 4, "Hand is Vox Solaris rank 3");
  assert.equal(b.acq.icon, "vox-solaris");
  assert.match(b.acq.how, /Vox Solaris/);
  assert.equal(b.acq.researched, true);
  assert.ok(b.acq.players, "what players report comes with it");
});

test("a credits blueprint that's dojo research says so instead of the Market", () => {
  const h = rows().get("Hema")!;
  assert.equal(h.acq.method, "dojo");
  assert.match(h.acq.how, /Bio Lab/);
});

test("market blueprint with parts from an easy boss is still easy", () => {
  const l = rows().get("Loki")!;
  assert.equal(l.acq.difficulty, 2);
  assert.match(l.acq.how, /Psamathe/);
});

test("researched items come from the wiki research, Liches at the top of the scale", () => {
  const k = rows().get("Kuva Bramma")!;
  assert.equal(k.acq.researched, true);
  assert.equal(k.acq.method, "lich-sister");
  assert.equal(k.acq.difficulty, 5);
  assert.equal(k.points, 4000, "Kuva weapons go to rank 40");
});

test("something you own only needs levelling: difficulty 0", () => {
  const o = rows([inv(OWNED, "Owned Gun", "weapon", 1)]).get("Owned Gun")!;
  assert.equal(o.status, "level");
  assert.equal(o.acq.difficulty, 0);
});

test("Simaris's own stock is bought with standing", () => {
  const s = rows().get("Simulor")!;
  assert.equal(s.acq.method, "vendor");
  assert.equal(s.acq.icon, "simaris");
});

test("mastery points: 200 a rank for frames and companions, 100 for weapons", () => {
  assert.equal(masteryPoints({ name: "Loki", category: "Warframes" }), 6000);
  assert.equal(masteryPoints({ name: "Galatine", category: "Melee" }), 3000);
  assert.equal(masteryPoints({ name: "Voidrig", category: "Warframes", type: "Necramech" }), 8000);
});

test("Baro's stock: unmastered gear first, then mods you lack, then what you have", () => {
  const m = buildModel(bundle(), {
    fissures: null, resurgence: null, resurgenceExpiry: null,
    baro: { activation: "2026-01-01T00:00:00Z", expiry: "2026-01-03T00:00:00Z", location: "Strata Relay (Earth)", inventory: [
      { uniqueName: "/Lotus/StoreItems/Weapons/Tenno/Owned", item: "Owned Gun", ducats: 100, credits: 1 },
      { uniqueName: "/Lotus/StoreItems/Upgrades/Skins/Thing", item: "Some Skin", ducats: 500, credits: 1 },
      { uniqueName: "/Lotus/StoreItems/Weapons/Tenno/Melee/Galatine", item: "Galatine", ducats: 300, credits: 1 },
    ] },
  });
  const s = baroStock(m);
  assert.equal(s[0].name, "Galatine");
  assert.equal(s[0].mark, "mastery");
  assert.equal(s[0].points, 3000);
  assert.equal(s.at(-1)!.mark, null);
});

test("countdowns read as days and hours, then hours and minutes", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(until("2026-01-02T05:00:00Z", now), "1 d 5 h");
  assert.equal(until("2026-01-01T02:30:00Z", now), "2 h 30 min");
  assert.equal(until("2025-12-31T00:00:00Z", now), "now");
});

test("not a relic prime: parts you hold count, and every part held means build it", () => {
  const b = (inventory: InventoryRow[]) => ({ observed_at: 1, inventory, catalog, relics: [], prices: {} }) as unknown as Bundle;
  const W = "/Lotus/Types/Recipes/WarframeRecipes/";
  const some = masteryRows(buildModel(b([inv(`${W}LokiBlueprint`, "Loki Blueprint", "blueprint", 1)]))).find((r) => r.name === "Loki")!;
  assert.deepEqual([some.status, some.partsOwned, some.partsTotal], ["parts", 1, 2]);
  assert.match(some.acq.how, /^You have the Blueprint; still to get: Chassis\. /);
  // The Chassis held as its blueprint (what drops) counts as much as the built part.
  const all = masteryRows(buildModel(b([inv(`${W}LokiBlueprint`, "Loki Blueprint", "blueprint", 1), inv(`${W}LokiChassisBlueprint`, "Loki Chassis Blueprint", "blueprint", 1)]))).find((r) => r.name === "Loki")!;
  assert.deepEqual([all.status, all.acq.method], ["build", "build"]);
});

test("a captured Infested companion is one revive away; a listed Plexus is yours to level", () => {
  const SLY = "/Lotus/Types/Friendly/Pets/CreaturePets/VulpineInfestedCatbrowPetPowerSuit";
  const PLEXUS = "/Lotus/Types/Game/CrewShip/RailJack/DefaultHarness";
  const cat = [...catalog, { uniqueName: SLY, name: "Sly Vulpaphyla", category: "Pets", masterable: true } as CatalogItem];
  const held = [inv("/Lotus/Types/Items/Deimos/WoundedInfestedCritterCommonRewardItem", "Sly Vulpaphyla", "resource", 2), inv(PLEXUS, "Default Harness", "resource", 0)];
  const r = new Map(masteryRows(buildModel({ observed_at: 1, inventory: held, catalog: cat, relics: [], prices: {} } as unknown as Bundle)).map((x) => [x.name, x]));
  assert.equal(r.get("Sly Vulpaphyla")!.status, "build");
  assert.match(r.get("Sly Vulpaphyla")!.acq.how, /revive it with Son/);
  assert.equal(r.get("Plexus")!.status, "level");
  // Owned the same way everywhere: Foundry's collection counts it as Mastery and Home do.
  const listed = buildModel({ observed_at: 1, inventory: held, catalog: cat, relics: [], prices: {} } as unknown as Bundle);
  assert.equal(listed.owned(PLEXUS), 1);
  assert.equal(collection(listed).find((x) => x.name === "Plexus")?.owned, true);
  // Not listed at all: still to get.
  const none = masteryRows(buildModel({ observed_at: 1, inventory: [], catalog: cat, relics: [], prices: {} } as unknown as Bundle)).find((x) => x.name === "Plexus")!;
  assert.equal(none.status, "missing");
});

// A dual-pistol prime is built from its Blueprint, its Link and two of the single pistol. Holding
// the first two but not the pistols once read "0 missing parts from relics" at "Easy".
const dual = (): { catalog: CatalogItem[]; blueprint: InventoryRow; link: InventoryRow } => ({
  catalog: [
    { uniqueName: "/W/BroncoPrime", name: "Bronco Prime", category: "Secondary", masterable: true, isPrime: true, components: [{ uniqueName: "/W/BroncoPrimeBarrel", name: "Barrel", ducats: 25, itemCount: 1 }] },
    { uniqueName: "/W/AkbroncoPrime", name: "Akbronco Prime", category: "Secondary", masterable: true, isPrime: true, components: [
      { uniqueName: "/W/AkbroncoPrimeBlueprint", name: "Blueprint", ducats: 15, itemCount: 1 },
      { uniqueName: "/W/AkbroncoPrimeLink", name: "Link", ducats: 15, itemCount: 1 },
      { uniqueName: "/W/BroncoPrime", name: "Bronco Prime", itemCount: 1 },
      { uniqueName: "/W/BroncoPrime", name: "Bronco Prime", itemCount: 1 },
    ] },
  ] as CatalogItem[],
  blueprint: inv("/W/AkbroncoPrimeBlueprint", "Akbronco Prime Blueprint", "prime_part", 1),
  link: inv("/W/AkbroncoPrimeLink", "Akbronco Prime Link", "prime_part", 1),
});
const akbronco = (inventory: InventoryRow[], catalog: CatalogItem[]) =>
  masteryRows(buildModel({ observed_at: 1, inventory, catalog, relics: [], prices: {} } as unknown as Bundle)).find((r) => r.name === "Akbronco Prime")!;

test("a dual-pistol prime with every part in hand but not the two pistols names the pistols, never '0 missing parts'", () => {
  const d = dual();
  const none = akbronco([d.blueprint, d.link], d.catalog);
  assert.equal(none.status, "parts");
  assert.doesNotMatch(none.acq.how, /^0 missing/);
  assert.match(none.acq.how, /2× Bronco Prime \(you have none\)/);
  assert.ok(none.acq.difficulty > 2, `not "Easy": ${none.acq.difficulty}`);
  // One pistol held: it says how many.
  const one = akbronco([d.blueprint, d.link, inv("/W/BroncoPrime", "Bronco Prime", "weapon", 1)], d.catalog);
  assert.match(one.acq.how, /2× Bronco Prime \(you have 1\)/);
  // Both held: every part and both pistols, so build it.
  const both = akbronco([d.blueprint, d.link, inv("/W/BroncoPrime", "Bronco Prime", "weapon", 2)], d.catalog);
  assert.equal(both.status, "build");
  assert.match(both.acq.how, /build it in the Foundry/);
});

test("holding more parts of a dual-pistol prime never makes it look harder", () => {
  const d = dual();
  const relic = { uniqueName: "/R/X", name: "Axi A1 Intact", vaulted: false, rewards: [{ name: "Akbronco Prime Blueprint", rarity: "Common", chance: 25 }] };
  const row = (inventory: InventoryRow[], relics: unknown[]) =>
    masteryRows(buildModel({ observed_at: 1, inventory, catalog: d.catalog, relics, prices: {} } as unknown as Bundle)).find((r) => r.name === "Akbronco Prime")!.acq.difficulty;
  const every = row([d.blueprint, d.link], []);
  // A relic part missing, with and without a relic of yours that drops it: never below having every part.
  assert.ok(row([d.link], []) >= every, "missing part, no relic held");
  assert.ok(row([d.link, inv("/R/X", "Axi A1 Intact", "relic", 1)], [relic]) >= every, "missing part, relic held for it");
  assert.ok(row([], []) >= every, "no part held");
});

test("a dual-pistol prime short a relic part and the pistols says both", () => {
  const d = dual();
  const r = akbronco([d.blueprint], d.catalog);
  assert.match(r.acq.how, /^1 missing part from relics/);
  assert.match(r.acq.how, /also built from 2× Bronco Prime \(you have none\)/);
});

test("every prime in the demo catalog built from other weapons says what is missing, with every relic part held", async () => {
  const { readFileSync } = await import("node:fs");
  const demo = JSON.parse(readFileSync(new URL("../demo/dev-bundle.json", import.meta.url), "utf8")) as Bundle;
  const byUnique = new Map(demo.catalog.map((i) => [i.uniqueName, i]));
  const duals = demo.catalog.filter((i) => i.isPrime && (i.components ?? []).some((c) => byUnique.get(c.uniqueName)?.masterable));
  assert.deepEqual(duals.map((i) => i.name).sort(), ["Akbronco Prime", "Aklex Prime", "Akmagnus Prime", "Akvasto Prime"]);
  for (const item of duals) {
    const parts = (item.components ?? []).filter((c) => !byUnique.get(c.uniqueName)?.masterable).map((c) => inv(c.uniqueName, `${item.name} ${c.name}`, "prime_part", c.itemCount ?? 1));
    const weapon = (item.components ?? []).find((c) => byUnique.get(c.uniqueName)?.masterable)!;
    const r = masteryRows(buildModel({ ...demo, inventory: parts })).find((x) => x.name === item.name)!;
    assert.doesNotMatch(r.acq.how, /^0 missing/, `${item.name}: ${r.acq.how}`);
    assert.ok(r.acq.how.includes(weapon.name), `${item.name} names ${weapon.name}: ${r.acq.how}`);
    assert.equal(r.acq.difficulty, 3, item.name);
  }
});

test("a Necramech is a Necramech on Mastery as on Foundry, with its points and rank 40 as before", () => {
  const voidrig = { uniqueName: "/Lotus/Powersuits/EntratiMech/NechroTech", name: "Voidrig", category: "Warframes", type: "Necramech", productCategory: "MechSuits", masterable: true } as CatalogItem;
  const warframe = { uniqueName: "/Lotus/Powersuits/Excalibur/Excalibur", name: "Excalibur", category: "Warframes", type: "Warframe", productCategory: "Suits", masterable: true } as CatalogItem;
  const m = buildModel({ observed_at: 1, inventory: [], catalog: [voidrig, warframe], relics: [], prices: {} } as unknown as Bundle);
  const row = masteryRows(m).find((r) => r.name === "Voidrig")!;
  assert.equal(row.category, "Necramech");
  assert.equal(row.category, collection(m).find((c) => c.name === "Voidrig")!.type);
  assert.equal(masteryRows(m).find((r) => r.name === "Excalibur")!.category, "Warframe");
  // Points and rank 40 (the Mastery card's 8,000) are the same as when it read "Warframe".
  assert.equal(row.points, 8000);
  assert.equal(masteryPoints(voidrig), 8000);
});

test("Kahl's Garrison titles map to their ranks: 1 Shelter … 5 Home (the wiki's Kahl's Garrison page)", async () => {
  const { syndicateOf } = await import("../src/lib/core/acquire");
  assert.deepEqual(["Shelter", "Encampment", "Fort", "Settlement", "Home"].map((t) => syndicateOf(`Kahl's Garrison, ${t}`)?.rank), [1, 2, 3, 4, 5]);
  assert.equal(syndicateOf("Vox Solaris, Hand")?.rank, 3);
});
