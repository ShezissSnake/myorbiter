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
  ];
  const m = buildModel(
    bundle([inv("/W/Excal", "Excalibur", "warframe", 1, { mastered: true }), inv("/P/Braton", "Braton", "weapon", 1), inv("/P/Lato", "Lato", "weapon", 1), inv("/X/LatoG", "Lato Incarnon Genesis", "misc", 1)], catalog),
  );
  const live: Live = {
    fissures: [], resurgence: [], resurgenceExpiry: null,
    duviriCycle: { expiry: "", state: "joy", choices: [{ category: "normal", choices: ["Excalibur", "Mag"] }, { category: "hard", choices: ["Braton", "Lato", "Paris"] }] },
    steelPath: { currentReward: { name: "Umbra Forma Blueprint", cost: 150 }, expiry: "2026-10-26T00:00:00Z" },
    nightwave: { expiry: "", activeChallenges: [{ id: "a", title: "Eximus Stopper", desc: "", reputation: 4500, isDaily: false, isElite: false, expiry: "" }, { id: "b", title: "Elite", desc: "", reputation: 7000, isDaily: false, isElite: true, expiry: "" }] },
    archonHunt: { expiry: "", boss: "Archon Nira", missions: [{ type: "Survival", node: "Ophelia" }] },
  };
  const t = today(m, live, NOW);
  assert.deepEqual(t.circuit!.frames.map((f) => [f.name, f.wanted]), [["Excalibur", false], ["Mag", true]]);
  assert.deepEqual(t.circuit!.incarnons.map((f) => [f.name, f.wanted, f.note]), [
    ["Braton", true, "you have the weapon"],
    ["Lato", false, "adapter in hand"],
    ["Paris", false, "no weapon for it"],
  ]);
  assert.deepEqual(t.steelPath, { reward: "Umbra Forma Blueprint", cost: 150, ends: "2026-10-26T00:00:00Z" });
  assert.equal(t.nightwave!.standing, 11_500);
  assert.equal(t.nightwave!.challenges[0].kind, "elite", "biggest first");
  assert.equal(t.archon!.shard, "Amber");
  assert.equal(t.sortie, null);
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
