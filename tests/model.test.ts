import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, quantity: number): InventoryRow => ({ item_id, name, category: "prime_part", quantity, mastered: false, image_name: null, rank: null, max_rank: null });

test("a warframe part already built from its blueprint counts toward building, not selling", () => {
  const SYS = "/Lotus/Types/Recipes/WarframeRecipes/ValkyrPrimeSystemsComponent";
  const m = buildModel({
    observed_at: 1,
    inventory: [inv(SYS, "Valkyr Prime Systems", 1), inv("/Lotus/Types/Recipes/WarframeRecipes/ValkyrPrimeSystemsBlueprint", "Valkyr Prime Systems Blueprint", 2)],
    catalog: [{ uniqueName: "/Lotus/Powersuits/Berserker/ValkyrPrime", name: "Valkyr Prime", category: "Warframes", masterable: true, isPrime: true, components: [{ uniqueName: SYS, name: "Systems", ducats: 45, itemCount: 1 }] }],
    relics: [{ uniqueName: "/R/A1Bronze", name: "Axi A1 Intact", vaulted: true, rewards: [{ name: "Valkyr Prime Systems Blueprint", rarity: "Uncommon", chance: 25.33 }] }],
    prices: { prices: {}, max_rank_prices: {} },
  } as Bundle);
  assert.equal(m.ownedPartQty.get("Valkyr Prime Systems Blueprint"), 2, "only the blueprints can be sold");
  assert.equal(m.partHave("Valkyr Prime Systems Blueprint"), 3, "the built one still counts toward the build");
  assert.equal(m.sourcesByReward.get("Valkyr Prime Systems Blueprint")?.[0].rarity, "Common", "25.33% at Intact is a common reward");
});

test("refining to radiant: a Flawless copy costs 50 traces and gains only what's left", async () => {
  const { radiantRows } = await import("../src/lib/core/advice");
  const rw = (c: number, u: number, r: number) => [
    { name: "Common Part", rarity: "Uncommon", chance: c },
    { name: "Mid Part", rarity: "Uncommon", chance: u },
    { name: "Rare Part", rarity: "Rare", chance: r },
  ];
  const m = buildModel({
    observed_at: 1,
    inventory: [{ item_id: "/R/A1Gold", name: "Axi A1 Flawless", category: "relic", quantity: 2, mastered: false, image_name: null, rank: null, max_rank: null }],
    catalog: [],
    relics: [
      { uniqueName: "/R/A1Bronze", name: "Axi A1 Intact", vaulted: false, rewards: rw(25.33, 11, 2) },
      { uniqueName: "/R/A1Gold", name: "Axi A1 Flawless", vaulted: false, rewards: rw(20, 17, 6) },
      { uniqueName: "/R/A1Platinum", name: "Axi A1 Radiant", vaulted: false, rewards: rw(16.67, 20, 10) },
    ],
    prices: { prices: { "Common Part": 1, "Mid Part": 1, "Rare Part": 100 }, max_rank_prices: {} },
  } as Bundle);
  const [row] = radiantRows(m, { squad: 1, metric: "plat" });
  const [u] = row.upgrades;
  assert.equal(u.refinement, "Flawless");
  assert.equal(u.traces, 50);
  assert.equal(u.count, 2);
  // From Flawless the rare part's odds only go 6% → 10%, so it gains less than refining from Intact.
  assert.ok(u.gain > 0 && u.gain < row.gain, `gain ${u.gain} vs ${row.gain}`);
});
