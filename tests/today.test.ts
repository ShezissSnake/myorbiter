import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { today, nextMondayUtc } from "../src/lib/core/today";
import { foundryBuilds } from "../src/lib/core/foundry";
import { rankLabel, rankThreshold } from "../src/lib/core/acquire";
import type { Bundle, CatalogItem, InventoryRow, Live } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const item = (uniqueName: string, name: string, category: string, extra: Partial<CatalogItem> = {}) => ({ uniqueName, name, category, masterable: true, ...extra }) as CatalogItem;
const bundle = (inventory: InventoryRow[], catalog: CatalogItem[]): Bundle => ({ observed_at: 1_700_000_000, inventory, catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } });

const NOW = Date.parse("2026-10-21T12:00:00Z"); // a Wednesday

test("the Circuit resets on the next Monday, 00:00 UTC", () => {
  assert.equal(nextMondayUtc(NOW), "2026-10-26T00:00:00.000Z");
  assert.equal(nextMondayUtc(Date.parse("2026-10-26T00:00:00Z")), "2026-11-02T00:00:00.000Z", "on Monday itself, the one after");
});

test("today marks Circuit frames you haven't mastered and Incarnons for weapons you own", () => {
  const catalog = [
    item("/W/Excal", "Excalibur", "Warframes"),
    item("/W/Mag", "Mag", "Warframes"),
    item("/P/Braton", "Braton", "Primary"),
    item("/P/Lato", "Lato", "Secondary"),
    item("/P/Paris", "Paris", "Primary"),
    item("/P/Strun", "Strun", "Shotgun"),
  ];
  const m = buildModel(
    bundle([inv("/W/Excal", "Excalibur", "warframe", 1, { mastered: true }), inv("/P/Braton", "Braton", "weapon", 1), inv("/P/Lato", "Lato", "weapon", 1), inv("/X/LatoG", "Lato Incarnon Genesis", "misc", 1), inv("/P/Strun", "Strun", "weapon", 0, { mastered: true })], catalog),
  );
  const live: Live = {
    fissures: [], resurgence: [], resurgenceExpiry: null,
    duviriCycle: { expiry: "", state: "joy", choices: [{ category: "normal", choices: ["Excalibur", "Mag"] }, { category: "hard", choices: ["Braton", "Lato", "Paris", "Strun"] }] },
    steelPath: { currentReward: { name: "Umbra Forma Blueprint", cost: 150 }, expiry: "2026-10-26T00:00:00Z" },
    nightwave: { expiry: "", activeChallenges: [{ id: "a", title: "Eximus Stopper", desc: "", reputation: 4500, isDaily: false, isElite: false, expiry: "" }, { id: "b", title: "Elite", desc: "", reputation: 7000, isDaily: false, isElite: true, expiry: "" }] },
    archonHunt: { expiry: "", boss: "Archon Nira", missions: [{ type: "Survival", node: "Ophelia" }] },
  };
  const t = today(m, live, NOW);
  assert.deepEqual(t.circuit!.frames.map((f) => [f.name, f.wanted]), [["Excalibur", false], ["Mag", true]]);
  assert.deepEqual(t.circuit!.incarnons.map((f) => [f.name, f.wanted, f.note]), [
    // No read of each copy (gear null): a weapon you hold may already have its Genesis installed.
    ["Braton", false, "you have the weapon; MyOrbiter can't see installed Incarnons yet"],
    ["Lato", false, "adapter in hand"],
    ["Paris", false, "no weapon for it"],
    // Mastered and sold: it would have to be built again.
    ["Strun", false, "mastered, but you don't have it now"],
  ]);
  assert.deepEqual(t.steelPath, { reward: "Umbra Forma Blueprint", cost: 150, ends: "2026-10-26T00:00:00Z", umbraIn: null });
  assert.deepEqual([t.archimedeas, t.calendar, t.descendia], [[], null, null], "the weekly content is missing, as from the game's own worldstate");
  assert.equal(t.nightwave!.standing, 11_500);
  assert.equal(t.nightwave!.challenges[0].kind, "elite", "biggest first");
  assert.equal(t.archon!.shard, "Amber");
  assert.equal(t.sortie, null);
  assert.equal(t.darvo, null);
  // Darvo selling Paris, which isn't mastered: found by its store path, and marked.
  const deal = today(m, { ...live, darvo: { item: "Paris", uniqueName: "/Lotus/StoreItems/P/Paris", originalPrice: 225, salePrice: 157, discount: 30, total: 185, sold: 4, expiry: "2026-10-29T21:00:00Z" } }, NOW).darvo!;
  assert.deepEqual([deal.price, deal.discount, deal.left, deal.wanted, deal.note], [157, 30, 181, true, "not mastered"]);
});

test("foundry builds name what comes out, soonest first, with mastery for what you haven't mastered", () => {
  const catalog = [
    item("/W/Nidus", "Nidus", "Warframes", { components: [{ uniqueName: "/Lotus/Types/Recipes/Nidus/Blueprint", name: "Blueprint", itemCount: 1 }, { uniqueName: "/Lotus/Types/Recipes/Nidus/Chassis", name: "Chassis Blueprint", itemCount: 1 }] } as Partial<CatalogItem>),
  ];
  const m = buildModel(bundle([], catalog));
  const b = foundryBuilds(m, [["/Lotus/Types/Recipes/Nidus/Blueprint", NOW + 3_600_000], ["/Lotus/Types/Recipes/Nidus/Chassis", NOW - 60_000]], NOW);
  assert.deepEqual(b.map((x) => [x.name, x.ready]), [["Nidus Chassis", true], ["Nidus", false]]);
  assert.equal(b[0].points, null, "a part gives no mastery itself");
  assert.equal(b[1].points, 6000);
});

test("mastery rank thresholds, Legendary past 30", () => {
  assert.equal(rankThreshold(1), 2500);
  assert.equal(rankThreshold(25), 1_562_500);
  assert.equal(rankThreshold(30), 2_250_000);
  assert.equal(rankThreshold(32), 2_545_000);
  assert.deepEqual([rankLabel(24), rankLabel(31)], ["MR 24", "Legendary 1"]);
});

test("on Mastery, something to level is in your arsenal, built and waiting in the Foundry, or still building", async () => {
  const { itemReadyTimes, levelStage } = await import("../src/lib/core/foundry");
  const catalog = [
    item("/W/Nidus", "Nidus", "Warframes", { components: [{ uniqueName: "/Lotus/Types/Recipes/Nidus/Blueprint", name: "Blueprint", itemCount: 1 }] } as Partial<CatalogItem>),
    item("/W/Mesa", "Mesa", "Warframes", { components: [{ uniqueName: "/Lotus/Types/Recipes/Mesa/Blueprint", name: "Blueprint", itemCount: 1 }] } as Partial<CatalogItem>),
    item("/W/Rhino", "Rhino", "Warframes"),
  ];
  const ready: [string, number][] = [["/Lotus/Types/Recipes/Nidus/Blueprint", NOW + 3 * 3_600_000], ["/Lotus/Types/Recipes/Mesa/Blueprint", NOW - 60_000]];
  const m = buildModel(bundle([inv("/W/Rhino", "Rhino", "frame", 1)], catalog), undefined, { "/Lotus/Types/Recipes/Nidus/Blueprint": 1, "/Lotus/Types/Recipes/Mesa/Blueprint": 1 });
  const at = itemReadyTimes(m, ready);
  assert.deepEqual(levelStage(m, "/W/Rhino", at, NOW), { stage: "level" });
  assert.deepEqual(levelStage(m, "/W/Mesa", at, NOW), { stage: "claim" }, "its build finished: claim it");
  assert.deepEqual(levelStage(m, "/W/Nidus", at, NOW), { stage: "building", readyAt: NOW + 3 * 3_600_000 });
  assert.deepEqual(levelStage(m, "/W/Nidus", new Map(), NOW), { stage: "building", readyAt: null }, "no time from TennoScope: still building");
});

test("an Incarnon Genesis already installed on a copy (feature bit 512) means no adapter is needed", () => {
  const catalog = [item("/P/Braton", "Braton", "Primary"), item("/P/BratonPrime", "Braton Prime", "Primary"), item("/P/Lato", "Lato", "Secondary")];
  const m = buildModel(bundle([inv("/P/BratonPrime", "Braton Prime", "weapon", 1), inv("/P/Lato", "Lato", "weapon", 1)], catalog));
  const live: Live = { fissures: [], resurgence: [], resurgenceExpiry: null, duviriCycle: { expiry: "", state: "joy", choices: [{ category: "hard", choices: ["Braton", "Lato"] }] } };
  const gear = [{ id: "a", type: "/P/BratonPrime", f: 512 | 1, p: 2 }, { id: "b", type: "/P/Lato", f: 1, p: 0 }];
  const t = today(m, live, NOW, gear);
  assert.deepEqual(t.circuit!.incarnons.map((f) => [f.name, f.wanted, f.note]), [["Braton", false, "installed on Braton Prime"], ["Lato", true, "you have the weapon"]]);
  // Without gear (an unpatched TennoScope): it can't tell an installed Genesis from none, so no pick
  // is marked, and it says so.
  const blind = today(m, live, NOW).circuit!.incarnons;
  assert.deepEqual(blind.map((f) => [f.name, f.wanted, f.unseen]), [["Braton", false, true], ["Lato", false, true]]);
  assert.match(blind[0].note, /can't see installed Incarnons yet/);
  // With the read (even an empty one) it is the weapons you hold with no adapter and no Genesis in.
  assert.deepEqual(today(m, live, NOW, []).circuit!.incarnons.map((f) => [f.name, f.wanted, f.unseen]), [["Braton", true, false], ["Lato", true, false]]);
});

test("Teshin's rotation says how many weeks until Umbra Forma", async () => {
  const { umbraFormaIn } = await import("../src/lib/core/today");
  const rotation = ["Umbra Forma Blueprint", "50,000 Kuva", "Kitgun Riven Mod", "3x Forma", "Zaw Riven Mod", "30,000 Endo", "Rifle Riven Mod", "Shotgun Riven Mod"].map((name) => ({ name, cost: 75 }));
  const sp = (name: string) => ({ currentReward: { name, cost: 75 }, expiry: "2026-11-08T23:59:59Z", rotation });
  assert.equal(umbraFormaIn(sp("Shotgun Riven Mod")), 1);
  assert.equal(umbraFormaIn(sp("50,000 Kuva")), 7);
  assert.equal(umbraFormaIn(sp("Umbra Forma Blueprint")), 0);
  assert.equal(umbraFormaIn({ currentReward: { name: "x", cost: 1 }, expiry: "" }), null, "no rotation (the game's own worldstate)");
  assert.equal(umbraFormaIn(sp("Something new")), null);
  const m = buildModel(bundle([], []));
  assert.equal(today(m, { fissures: [], resurgence: [], resurgenceExpiry: null, steelPath: sp("Zaw Riven Mod") }, NOW).steelPath!.umbraIn, 4);
});

test("the week's Archimedeas, 1999 Calendar prizes and Descendia, from warframestat's shapes", () => {
  const m = buildModel(bundle([], []));
  const ends = "2026-10-26T00:00:00.000Z";
  const live: Live = {
    fissures: [], resurgence: [], resurgenceExpiry: null,
    archimedeas: [
      { expiry: ends, type: "C T_ L A B", typeKey: "C T_ L A B", missions: [{ missionType: "Extermination", deviation: { name: "Sealed Armor", description: "Armor can't be stripped" }, risks: [{ name: "Fortified Foes", description: "More armor", isHard: true }, { name: "Energy Starved" }, { description: "no name" }] }, { missionType: "Survival" }, { missionType: "Alchemy" }] },
      { expiry: ends, typeKey: "C T_ H E X", missions: [{ missionType: "Defense" }] },
      { expiry: "2026-10-01T00:00:00Z", typeKey: "C T_ L A B", missions: [{ missionType: "Old" }] },
      { expiry: ends, typeKey: "C T_ S O M E T H I N G", missions: [{ missionType: "Odd" }] },
    ],
    calendar: { expiry: ends, season: "Summer", days: [
      { date: "1999-07-04T00:00:00.000Z", events: [{ type: "To Do", challenge: { title: "Starve the beast" } }] },
      { date: "1999-07-11T00:00:00.000Z", events: [{ type: "Big Prize!", reward: "Vosfor Cache" }, { type: "Big Prize!", reward: "Arcane Enhancements: Double Pack" }] },
      { date: "1999-09-23T00:00:00.000Z", events: [{ type: "Big Prize!", reward: "Arcane Enhancements" }, { type: "Big Prize!", reward: "Weapon Primary Arcane Unlocker" }] },
    ] },
    descendia: { expiry: ends, challenges: Array.from({ length: 21 }, (_, i) => ({ index: i + 1 })) },
  };
  const t = today(m, live, NOW);
  assert.deepEqual(t.archimedeas.map((a) => [a.kind, a.missions.map((x) => x.type)]), [["Deep", ["Extermination", "Survival", "Alchemy"]], ["Temporal", ["Defense"]]]);
  assert.equal(t.archimedeas[0].missions[0].deviation, "Sealed Armor");
  assert.equal(t.archimedeas[0].missions[0].deviationDesc, "Armor can't be stripped");
  assert.deepEqual(t.archimedeas[0].missions[0].risks, [{ name: "Fortified Foes", desc: "More armor", hard: true }, { name: "Energy Starved", desc: "", hard: false }], "risks with a name, the hard ones marked");
  assert.equal(t.calendar!.season, "Summer");
  assert.deepEqual(t.calendar!.prizes, [
    { day: "11 Jul", choices: ["Vosfor Cache", "Arcane Enhancements: Double Pack"], notable: false, pick: "Vosfor Cache" },
    { day: "23 Sep", choices: ["Arcane Enhancements", "Primary Arcane Adapter"], notable: true, pick: "Primary Arcane Adapter" },
  ]);
  assert.deepEqual(t.descendia, { floors: 21, ends });
  // Missing or broken parts don't throw.
  const broken = today(m, { fissures: [], resurgence: [], resurgenceExpiry: null, archimedeas: [{} as never], calendar: { expiry: ends }, descendia: { expiry: ends } }, NOW);
  assert.deepEqual([broken.archimedeas, broken.calendar, broken.descendia], [[], null, null]);
});
