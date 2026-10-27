import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, expectedBest } from "../src/lib/core/advice";

test("best of one is the plain average", () => {
  const o = [{ chance: 0.5, value: 10 }, { chance: 0.5, value: 0 }];
  assert.equal(expectedBest(o, 1), 5);
});

test("best of four favours the rare reward", () => {
  // Intact: 2% rare worth 100p, the rest worth 1p. Radiant: 10% rare.
  const intact = [{ chance: 0.02, value: 100 }, { chance: 0.98, value: 1 }];
  const radiant = [{ chance: 0.1, value: 100 }, { chance: 0.9, value: 1 }];
  assert.ok(Math.abs(expectedBest(intact, 1) - 2.98) < 1e-9);
  // P(at least one rare in 4) = 1 - 0.9^4 = 0.3439 → 34.39 + 0.6561
  assert.ok(Math.abs(expectedBest(radiant, 4) - (0.3439 * 100 + 0.6561 * 1)) < 1e-9);
  assert.ok(expectedBest(radiant, 4) > expectedBest(radiant, 1));
});

test("chances that don't add up to 100% are normalised", () => {
  assert.equal(expectedBest([{ chance: 0.25, value: 8 }, { chance: 0.25, value: 0 }], 1), 4);
});

const opts = { platPerDucat: 0.1, minPlat: 5, slowBelow: 1 };

test("ducats win when the plat is less than their worth", () => {
  assert.equal(decide(8, 100, 20, opts).verdict, "ducats"); // 100d ≈ 10p > 8p
  assert.equal(decide(15, 100, 20, opts).verdict, "plat");
});

test("tiny sales aren't worth a trade", () => {
  const d = decide(4, 15, 50, opts);
  assert.equal(d.verdict, "ducats");
  assert.match(d.reason, /not worth a trade/);
});

test("slow sellers lean to ducats when it's close", () => {
  assert.equal(decide(12, 100, 0.3, opts).verdict, "ducats"); // 10p of ducats ≥ 60% of 12p, and slow
  assert.equal(decide(40, 100, 0.3, opts).verdict, "plat");
  assert.equal(decide(40, 100, 0.3, opts).slow, true);
});

test("no price means ducats", () => {
  assert.equal(decide(null, 45, null, opts).verdict, "ducats");
});

test("crack planner finds relics that finish a set", async () => {
  const { buildModel } = await import("../src/lib/core/model");
  const { crackRows } = await import("../src/lib/core/advice");
  const inv = (item_id: string, name: string, category: string, quantity: number) => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
  const m = buildModel({
    observed_at: null,
    inventory: [
      inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", 1),
      inv("/R/Chassis", "Rhino Prime Chassis Blueprint", "prime_part", 1),
      inv("/R/Helmet", "Rhino Prime Neuroptics Blueprint", "prime_part", 1),
      inv("/Relic/R1Platinum", "Axi R1 Radiant", "relic", 2),
    ],
    catalog: [{ uniqueName: "/Rhino", name: "Rhino Prime", category: "Warframes", components: [
      { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100 }, { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15 },
      { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 45 }, { uniqueName: "/R/Systems", name: "Systems", ducats: 45 }] }],
    relics: [
      { uniqueName: "/Relic/R1Bronze", name: "Axi R1 Intact", rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 2 }, { name: "Forma Blueprint", rarity: "Common", chance: 98 }] },
      { uniqueName: "/Relic/R1Platinum", name: "Axi R1 Radiant", rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 10 }, { name: "Forma Blueprint", rarity: "Common", chance: 90 }] },
    ],
    prices: { prices: { "Rhino Prime Set": 60 } },
  });
  const { relics, gaps } = crackRows(m, 2);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].relicsOwned, 1);
  assert.equal(relics[0].base, "Axi R1");
  assert.equal(relics[0].refinement, "Radiant"); // odds from your best copy
  assert.ok(Math.abs(relics[0].chance - 0.1) < 1e-9);
  assert.ok(Math.abs(relics[0].value - 6) < 1e-9); // 10% × 60p for the last part
  assert.equal(relics[0].hits[0].last, true);
});

// ---------------------------------------------------------------- regressions

import { buildModel as build } from "../src/lib/core/model";
import { crackRows as crack, ducatRows as ducatsOf } from "../src/lib/core/advice";
import { relicRows as relicsOf } from "../src/lib/core/views";
import { holdings } from "../src/lib/core/market";

const row = (item_id: string, name: string, category: string, quantity: number) => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
const rhinoCatalog = [{ uniqueName: "/Rhino", name: "Rhino Prime", category: "Warframes", components: [
  { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100 }, { uniqueName: "/R/Systems", name: "Systems", ducats: 45 }] }];

test("a reward listed twice in a relic is merged, chances added", () => {
  const m = build({ observed_at: null, catalog: [], prices: null,
    inventory: [row("/Relic/D1Bronze", "Meso D1 Intact", "relic", 1)],
    relics: [{ uniqueName: "/Relic/D1Bronze", name: "Meso D1 Intact", rewards: [
      { name: "2X Forma Blueprint", rarity: "Common", chance: 25.33 }, { name: "2X Forma Blueprint", rarity: "Common", chance: 25.33 }, { name: "X", rarity: "Rare", chance: 2 }] }] });
  const [r] = relicsOf(m);
  assert.equal(r.rewards.length, 2);
  assert.ok(Math.abs(r.rewards[0].chance - 50.66) < 1e-9);
});

test("crack odds add up the wanted rewards (one crack, one reward)", () => {
  const m = build({ observed_at: null, catalog: [{ uniqueName: "/Rhino", name: "Rhino Prime", category: "Warframes", components: [
      { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100 }, { uniqueName: "/R/Ch", name: "Chassis", ducats: 15 }, { uniqueName: "/R/Systems", name: "Systems", ducats: 45 }] }],
    prices: { prices: { "Rhino Prime Set": 60 } },
    inventory: [row("/R/Bp", "Rhino Prime Blueprint", "prime_part", 1), row("/Relic/R1Bronze", "Axi R1 Intact", "relic", 1)],
    relics: [{ uniqueName: "/Relic/R1Bronze", name: "Axi R1 Intact", rewards: [
      { name: "Rhino Prime Chassis Blueprint", rarity: "Uncommon", chance: 25 }, { name: "Rhino Prime Systems Blueprint", rarity: "Uncommon", chance: 25 }, { name: "Forma Blueprint", rarity: "Common", chance: 50 }] }] });
  assert.equal(crack(m, 2).relics[0].chance, 0.5);
});

test("plat-or-ducats doesn't count a set's parts twice", () => {
  const m = build({ observed_at: null, catalog: rhinoCatalog, relics: [],
    prices: { prices: { "Rhino Prime Set": 60, "Rhino Prime Blueprint": 20, "Rhino Prime Systems Blueprint": 30 } },
    inventory: [row("/R/Bp", "Rhino Prime Blueprint", "prime_part", 1), row("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 2), row("/Rhino", "Rhino Prime", "frame", 0)].map((r) => (r.item_id === "/Rhino" ? { ...r, mastered: true } : r)) });
  const rows = ducatsOf(m, { platPerDucat: 0.1, minPlat: 5, slowBelow: 1 }, true);
  assert.deepEqual(rows.map((r) => [r.kind, r.name, r.quantity]).sort(), [["part", "Rhino Prime Systems Blueprint", 1], ["set", "Rhino Prime Set", 1]]);
});

test("relic listings find your copies by refinement", () => {
  const m = build({ observed_at: null, catalog: [], prices: null, relics: [],
    inventory: [row("/P/T1VoidProjectionCalibanPrimeABronze", "Lith C13 Intact", "relic", 3), row("/P/T1VoidProjectionCalibanPrimeAPlatinum", "Lith C13 Radiant", "relic", 1)] });
  const held = holdings(m, { id: "x", slug: "lith_c13_relic", gameRef: "/P/T1VoidProjectionCalibanPrimeA", name: "Lith C13 Relic", maxRank: null, subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic", "lith"] });
  assert.deepEqual(held, [{ rank: null, subtype: "intact", count: 3 }, { rank: null, subtype: "radiant", count: 1 }]);
});

test("the planner's set lists follow its filters: search and vaulted only", async () => {
  const { filterGaps } = await import("../src/lib/core/advice");
  const comps = (u: string) => [{ uniqueName: `${u}/Bp`, name: "Blueprint", ducats: 100 }, { uniqueName: `${u}/Systems`, name: "Systems", ducats: 45 }];
  const m = build({
    observed_at: null,
    inventory: [row("/Rhino/Bp", "Rhino Prime Blueprint", "prime_part", 1), row("/Nova/Bp", "Nova Prime Blueprint", "prime_part", 1), row("/Relic/R1Bronze", "Axi R1 Intact", "relic", 1)],
    catalog: [
      { uniqueName: "/Rhino", name: "Rhino Prime", category: "Warframes", components: comps("/Rhino") },
      { uniqueName: "/Nova", name: "Nova Prime", category: "Warframes", components: comps("/Nova") },
    ],
    relics: [
      { uniqueName: "/Relic/R1Bronze", name: "Axi R1 Intact", vaulted: false, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 2 }] },
      { uniqueName: "/Relic/N1Bronze", name: "Lith N1 Intact", vaulted: true, rewards: [{ name: "Nova Prime Systems Blueprint", rarity: "Rare", chance: 2 }] },
    ],
    prices: null,
  });
  const plan = crack(m, 1);
  const q = (query: string) => (...fields: string[]) => fields.join(" ").toLowerCase().includes(query.toLowerCase());
  assert.deepEqual(filterGaps(m, plan, false, q("")).map((g) => g.set).sort(), ["Nova Prime", "Rhino Prime"]);
  assert.deepEqual(filterGaps(m, plan, false, q("rhino")).map((g) => g.set), ["Rhino Prime"]);
  assert.deepEqual(filterGaps(m, plan, false, q("axi r1")).map((g) => g.set), ["Rhino Prime"], "found by a relic of yours that drops the part");
  assert.deepEqual(filterGaps(m, plan, true, q("")).map((g) => g.set), ["Nova Prime"], "no relic of yours for it, and its part only from vaulted relics");
});
