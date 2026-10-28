// Item and relic data bugs found on 28 Oct 2026: each test pins a case that showed something
// wrong on a real account's data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { masteryRows, relicRows, unknownRelics, partAvailability } from "../src/lib/core/views";
import { mergeRelics, type RelicData } from "../src/lib/core/relicData";
import acquisition from "../src/lib/data/acquisition.json";
import type { Bundle, CatalogItem, InventoryRow, RelicEntry } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const bundle = (inventory: InventoryRow[], catalog: CatalogItem[], relics: RelicEntry[] = []): Bundle => ({
  observed_at: 1_700_000_000, inventory, catalog, relics, prices: { prices: {}, max_rank_prices: {} },
});
const rowOf = (b: Bundle, name: string) => masteryRows(buildModel(b)).find((r) => r.name === name);

test("a Market blueprint that also drops somewhere is the Market's (Boltor: credits, not Duviri)", () => {
  const boltor = {
    // Not a name acquisition.json knows, so it's worked out from the drop data.
    uniqueName: "/W/Testgun", name: "Testgun", category: "Primary", masterable: true, bpCost: 15000,
    components: [{ uniqueName: "/Lotus/Types/Recipes/Weapons/BoltorBlueprint", name: "Blueprint", itemCount: 1, drops: [{ location: "Duviri/Endless: Tier 6 (Normal)", chance: 1.2, rarity: "Rare" }] }],
  } as CatalogItem;
  const r = rowOf(bundle([], [boltor]), "Testgun");
  assert.equal(r?.acq.method, "market-credits");
  assert.equal(r?.acq.difficulty, 1);
  assert.match(r!.acq.how, /Market \(15,000 credits\)/);
});

test("the second son and the Doppelganger's Grimoire aren't mastery to do", () => {
  const catalog = [
    { uniqueName: "/Lotus/Powersuits/SiriusOrion/SiriusSuit", name: "Sirius & Orion", category: "Warframes", masterable: true },
    { uniqueName: "/Lotus/Powersuits/SiriusOrion/OrionSuit", name: "Orion & Sirius", category: "Warframes", masterable: true },
    { uniqueName: "/Lotus/Weapons/Tenno/Grimoire/TnGrimoire", name: "Grimoire", category: "Secondary", masterable: true },
    { uniqueName: "/Lotus/Weapons/Tenno/Grimoire/TnDoppelgangerGrimoire", name: "Grimoire", category: "Secondary", masterable: true },
  ] as CatalogItem[];
  const ours = <T extends { name: string }>(rows: T[]) => rows.filter((r) => /Grimoire|Sirius|Orion/.test(r.name));
  const none = ours(masteryRows(buildModel(bundle([], catalog))));
  assert.deepEqual(none.map((r) => r.name).sort(), ["Grimoire", "Sirius & Orion"]);
  assert.equal(none.find((r) => r.name === "Sirius & Orion")?.points, 6000);
  const done = masteryRows(buildModel(bundle([inv("/Lotus/Weapons/Tenno/Grimoire/TnGrimoire", "Grimoire", "Secondary", 0, { mastered: true }), inv("/Lotus/Powersuits/SiriusOrion/SiriusSuit", "Sirius & Orion", "Warframes", 0, { mastered: true })], catalog)));
  assert.deepEqual(ours(done).map((r) => r.name), []);
});

test("a prime built from other weapons isn't ready to build without them (Akbronco Prime)", () => {
  const catalog = [
    { uniqueName: "/W/BroncoPrime", name: "Bronco Prime", category: "Secondary", masterable: true, isPrime: true, components: [{ uniqueName: "/W/BroncoPrimeBarrel", name: "Barrel", ducats: 25, itemCount: 1 }] },
    {
      uniqueName: "/W/AkbroncoPrime", name: "Akbronco Prime", category: "Secondary", masterable: true, isPrime: true,
      components: [
        { uniqueName: "/W/AkbroncoPrimeBlueprint", name: "Blueprint", ducats: 15, itemCount: 1 },
        { uniqueName: "/W/AkbroncoPrimeLink", name: "Link", ducats: 15, itemCount: 1 },
        { uniqueName: "/W/BroncoPrime", name: "Bronco Prime", itemCount: 2 },
      ],
    },
  ] as CatalogItem[];
  const parts = [inv("/W/AkbroncoPrimeBlueprint", "Akbronco Prime Blueprint", "prime_part", 1), inv("/W/AkbroncoPrimeLink", "Akbronco Prime Link", "prime_part", 1)];
  assert.notEqual(rowOf(bundle(parts, catalog), "Akbronco Prime")?.status, "build");
  const withBroncos = [...parts, inv("/W/BroncoPrime", "Bronco Prime", "Secondary", 2)];
  assert.equal(rowOf(bundle(withBroncos, catalog), "Akbronco Prime")?.status, "build");
});

const relic = (name: string, rewards: string[], extra: Partial<RelicEntry> = {}): RelicEntry => ({
  uniqueName: `/R/${name.replace(/\s/g, "")}`, name, rewards: rewards.map((n) => ({ name: n, chance: 25.33, rarity: "Common" })), ...extra,
});
const tables = (relics: { name: string; rewards: string[] }[], drops: Record<string, number>, paths: Record<string, string> = {}): RelicData => ({
  hash: "h", modified: 0, checkedAt: 0,
  relics: relics.map((r) => ({ name: r.name, rewards: r.rewards.map((n) => ({ name: n, chance: 25.33, rarity: "Common" })) })),
  drops: Object.fromEntries(Object.entries(drops).map(([b, n]) => [b, Array.from({ length: n }, (_, i) => ({ location: `Place ${i}`, chance: 10, rarity: "Rare" }))])),
  paths,
});

test("the drop tables decide what a relic holds and whether it's vaulted", () => {
  const theirs = [relic("Axi S20 Intact", ["Old Part"], { vaulted: false, drops: [{ location: "X", chance: 1, rarity: "Rare" }] }), relic("Lith A1 Intact", ["A Part"], { vaulted: true })];
  const merged = mergeRelics(theirs, tables([{ name: "Axi S20 Intact", rewards: ["New Part"] }, { name: "Lith A1 Intact", rewards: ["A Part"] }, { name: "Meso V17 Intact", rewards: ["Corufell Prime Blueprint"] }], { "Lith A1": 2, "Meso V17": 3 }, { "/Lotus/Types/Game/Projections/T2VoidProjectionCitrinePrimeBBronze": "Meso V17 Intact" }));
  const by = new Map(merged.map((r) => [r.name, r]));
  assert.equal(by.get("Axi S20 Intact")?.vaulted, true, "left the drop tables: vaulted");
  assert.deepEqual(by.get("Axi S20 Intact")?.rewards.map((r) => r.name), ["New Part"]);
  assert.equal(by.get("Axi S20 Intact")?.uniqueName, "/R/AxiS20Intact", "TennoScope's path kept");
  assert.equal(by.get("Lith A1 Intact")?.vaulted, false, "drops again: farmable");
  assert.equal(by.get("Meso V17 Intact")?.uniqueName, "/Lotus/Types/Game/Projections/T2VoidProjectionCitrinePrimeBBronze", "a new relic gets its path from WFCD");
  // No tables (offline on a first start): TennoScope's list as it was.
  assert.equal(mergeRelics(theirs, null), theirs);
});

test("Requiem Eterna (no refinement in its name) is a relic you hold, and Requiem relics are never vaulted", () => {
  const theirs = [relic("Requiem Eterna Relic", ["Lohk"], { vaulted: true })];
  const merged = mergeRelics(theirs, tables([{ name: "Requiem Eterna Intact", rewards: ["Lohk", "Xata"] }], {}));
  const m = buildModel(bundle([inv("/R/RequiemEternaRelic", "Requiem Eterna Relic", "relic", 8)], [], merged));
  assert.equal(m.relicGroups.get("Requiem Eterna")?.vaulted, false);
  assert.equal(relicRows(m).find((r) => r.base === "Requiem Eterna")?.total, 8);
  assert.deepEqual(unknownRelics(m), []);
});

test("a new relic in Varzia's stock counts as hers, by the path the tables give it", () => {
  const merged = mergeRelics([], tables([{ name: "Lith B12 Intact", rewards: ["Ivara Prime Blueprint"] }], {}, { "/Lotus/Types/Game/Projections/T1VoidProjectionProteaIvaraVaultABronze": "Lith B12 Intact" }));
  const live = { fissures: null, resurgence: [{ uniqueName: "/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionProteaIvaraVaultABronze", item: "", ducats: 0, credits: null }], resurgenceExpiry: null } as unknown as Parameters<typeof buildModel>[1];
  const m = buildModel(bundle([], [], merged), live);
  assert.equal(m.relicGroups.get("Lith B12")?.resurgence, true);
  assert.equal(partAvailability(m, "Ivara Prime Blueprint"), "resurgence");
});

test("acquisition.json: every entry has a known method and a difficulty of 1 to 5, and none is for the second son", () => {
  const METHODS = new Set(["level", "build", "relics", "market-credits", "syndicate", "quest", "dojo", "baro", "vendor", "lich-sister", "coda", "incubator", "open-world", "boss", "railjack", "mission-drop", "event", "nightwave", "other"]);
  for (const [name, e] of Object.entries(acquisition as Record<string, { method: string; difficulty: number }>)) {
    assert.ok(METHODS.has(e.method), `${name}: ${e.method}`);
    assert.ok(e.difficulty >= 1 && e.difficulty <= 5, `${name}: ${e.difficulty}`);
  }
  assert.ok(!("Orion & Sirius" in acquisition), "filed under Sirius & Orion, the one that gives mastery");
  assert.ok("Sirius & Orion" in acquisition);
});

test("amp prisms, the Infested kitgun chambers and the Plexus are mastery too, though the catalog leaves them out", () => {
  const rows = masteryRows(buildModel(bundle([], [])));
  const by = new Map(rows.map((r) => [r.name, r]));
  for (const n of ["Raplak Prism", "Klamora Prism", "Mote Amp", "Sporelacer", "Vermisplicer"]) assert.equal(by.get(n)?.points, 3000, n);
  assert.equal(by.get("Plexus")?.points, 6000);
  // The Mote Amp is held as the training amp the game gives: level it, not get it.
  const held = masteryRows(buildModel(bundle([inv("/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/OperatorTrainingAmpWeapon", "Operator Training Amp Weapon", "weapon", 1)], [])));
  assert.equal(held.find((r) => r.name === "Mote Amp")?.status, "level");
  // Mastered (the game reports it by the prism's path): gone from the list.
  const done = masteryRows(buildModel(bundle([inv("/Lotus/Weapons/Sentients/OperatorAmplifiers/Set1/Barrel/SentAmpSet1BarrelPartA", "Raplak Prism", "weapon", 0, { mastered: true })], [])));
  assert.ok(!done.some((r) => r.name === "Raplak Prism"));
});

test("a prime's vaulted tag follows its parts, not the catalog's flag (Nyx Prime from Railjack cache relics)", async () => {
  const { primeVaulted } = await import("../src/lib/core/views");
  const nyx = { uniqueName: "/P/NyxPrime", name: "Nyx Prime", category: "Warframes", masterable: true, isPrime: true, vaulted: true, components: [{ uniqueName: "/P/NyxPrimeBp", name: "Blueprint", ducats: 45, itemCount: 1 }] } as CatalogItem;
  const farmable = buildModel(bundle([], [nyx], [relic("Axi S8 Intact", ["Nyx Prime Blueprint"], { vaulted: false })]));
  assert.equal(primeVaulted(farmable, nyx), false);
  const gone = buildModel(bundle([], [nyx], [relic("Axi S8 Intact", ["Nyx Prime Blueprint"], { vaulted: true })]));
  assert.equal(primeVaulted(gone, nyx), true);
  // No relic data for it at all: the catalog's flag.
  assert.equal(primeVaulted(buildModel(bundle([], [nyx])), nyx), true);
});
