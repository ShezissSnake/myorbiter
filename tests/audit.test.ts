// Logic bugs, now fixed: each test pins a case that used to give a wrong number or label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { masteryRows, partRows, relicRows, relicRewardRarity, squadRelics } from "../src/lib/core/views";
import { baroStock } from "../src/lib/core/traders";
import { plan, type BookOrder, type MyOrder } from "../src/lib/core/market";
import { today } from "../src/lib/core/today";
import type { Bundle, CatalogItem, InventoryRow, Live } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const bundle = (inventory: InventoryRow[], catalog: CatalogItem[], extra: Partial<Bundle> = {}): Bundle => ({
  observed_at: 1_700_000_000, inventory, catalog, relics: [], prices: { prices: {}, max_rank_prices: {} }, ...extra,
});
const noLive: Live = { fissures: null, resurgence: null, resurgenceExpiry: null };

test("buying a prime's missing parts counts every copy still needed (two Blades cost two Blades)", () => {
  const GLAIVE = "/Lotus/Weapons/Tenno/Glaive/PrimeGlaive";
  const catalog = [{
    uniqueName: GLAIVE, name: "Glaive Prime", category: "Melee", masterable: true, isPrime: true,
    components: [
      { uniqueName: "/G/Bp", name: "Blueprint", ducats: 45, itemCount: 1 },
      { uniqueName: "/G/Blade", name: "Blade", ducats: 15, itemCount: 2 },
    ],
  } as CatalogItem];
  const prices = { prices: { "Glaive Prime Blueprint": 18, "Glaive Prime Blade": 16 }, max_rank_prices: {} };
  const none = masteryRows(buildModel(bundle([], catalog, { prices })))[0];
  assert.equal(none.buyFor, 18 + 2 * 16);
  assert.match(none.acq.how, /buy the 3 parts for about 50p/);
  const oneBlade = masteryRows(buildModel(bundle([inv("/G/Blade", "Glaive Prime Blade", "prime_part", 1)], catalog, { prices })))[0];
  assert.equal(oneBlade.buyFor, 18 + 16);
  assert.match(oneBlade.acq.how, /buy the 2 parts for about 34p/);
});

test("relic rewards: rarity comes from the chance, since the data calls commons 'Uncommon'", () => {
  assert.equal(relicRewardRarity("Intact", 25.33, "Uncommon"), "Common");
  assert.equal(relicRewardRarity("Intact", 11, "Uncommon"), "Uncommon");
  assert.equal(relicRewardRarity("Intact", 2, "Rare"), "Rare");
  // At Radiant an uncommon (20%) is likelier than a common (16.67%).
  assert.equal(relicRewardRarity("Radiant", 20, "Uncommon"), "Uncommon");
  assert.equal(relicRewardRarity("Radiant", 16.67, "Uncommon"), "Common");
  assert.equal(relicRewardRarity("Exceptional", 23.33, "Uncommon"), "Common");
  assert.equal(relicRewardRarity("Flawless", 6, "Rare"), "Rare");
  // Two rewards merged into one (2× Forma): keep the label given.
  assert.equal(relicRewardRarity("Intact", 50.66, "Uncommon"), "Uncommon");

  const reward = (name: string, rarity: string, chance: number) => ({ name, rarity, chance });
  const intact = [reward("A", "Uncommon", 25.33), reward("B", "Uncommon", 25.33), reward("C", "Uncommon", 25.33), reward("D", "Uncommon", 11), reward("E", "Uncommon", 11), reward("F", "Rare", 2)];
  const radiant = [reward("A", "Uncommon", 16.67), reward("B", "Uncommon", 16.67), reward("C", "Uncommon", 16.67), reward("D", "Uncommon", 20), reward("E", "Uncommon", 20), reward("F", "Rare", 10)];
  const m = buildModel(bundle([inv("/R/X1Platinum", "Lith X1 Radiant", "relic", 1)], [], {
    relics: [
      { uniqueName: "/R/X1Bronze", name: "Lith X1 Intact", rewards: intact },
      { uniqueName: "/R/X1Platinum", name: "Lith X1 Radiant", rewards: radiant },
    ],
  }));
  assert.deepEqual(relicRows(m)[0].rewards.map((r) => r.rarity), ["Common", "Common", "Common", "Uncommon", "Uncommon", "Rare"]);
  assert.deepEqual(squadRelics(m, ["/R/X1Platinum"])[0].rewards.map((r) => r.rarity), ["Common", "Common", "Common", "Uncommon", "Uncommon", "Rare"]);
});

test("Baro's stock: what you own is counted once, not twice", () => {
  const GUN = "/Lotus/Weapons/Tenno/Owned";
  const m = buildModel(bundle([inv(GUN, "Owned Gun", "weapon", 1)], [{ uniqueName: GUN, name: "Owned Gun", category: "Primary", masterable: true } as CatalogItem]), {
    ...noLive,
    baro: { activation: "", expiry: "", location: "", inventory: [{ uniqueName: "/Lotus/StoreItems/Weapons/Tenno/Owned", item: "Owned Gun", ducats: 100, credits: 1 }] },
  });
  assert.equal(baroStock(m)[0].owned, 1);
});

test("repricing: with nobody in game, a listing under your floor is raised to it", () => {
  const me = { id: "me", platform: "pc", crossplay: true };
  const mine: MyOrder = { id: "o", itemId: "x", type: "sell", platinum: 10, quantity: 1, rank: null, subtype: null, visible: true, updatedAt: null };
  const offline: BookOrder = { id: "b", type: "sell", platinum: 5, quantity: 1, rank: null, subtype: null, visible: true, user: { id: "u", ingameName: "U", status: "offline", platform: "pc", crossplay: true } };
  const raised = plan(mine, [offline], me, { floor: 18, minShare: 0, reference: null });
  assert.deepEqual([raised.target, raised.change, raised.reason], [18, true, "floor"]);
  const minRaised = plan(mine, [], me, { floor: null, minShare: 0, reference: null, min: 15 });
  assert.equal(minRaised.target, 15);
  const fine = plan({ ...mine, platinum: 30 }, [], me, { floor: 18, minShare: 0, reference: null });
  assert.deepEqual([fine.target, fine.change, fine.reason], [30, false, "no-sellers"]);
});

test("Circuit Incarnons: owning any variant of the weapon counts (Dera Vandal, Dex Sybaris, MK1-Braton)", () => {
  const item = (uniqueName: string, name: string) => ({ uniqueName, name, category: "Primary", masterable: true }) as CatalogItem;
  const catalog = [item("/P/Dera", "Dera"), item("/P/DeraVandal", "Dera Vandal"), item("/P/Sybaris", "Sybaris"), item("/P/DexSybaris", "Dex Sybaris"), item("/P/Braton", "Braton"), item("/P/MK1Braton", "MK1-Braton"), item("/P/Okina", "Okina")];
  const m = buildModel(bundle([inv("/P/DeraVandal", "Dera Vandal", "weapon", 1), inv("/P/DexSybaris", "Dex Sybaris", "weapon", 1), inv("/P/MK1Braton", "MK1-Braton", "weapon", 1)], catalog));
  const live: Live = { ...noLive, duviriCycle: { expiry: "", state: "joy", choices: [{ category: "hard", choices: ["Dera", "Sybaris", "Braton", "Okina"] }] } };
  const t = today(m, live, Date.parse("2026-10-21T12:00:00Z"));
  assert.deepEqual(t.circuit!.incarnons.map((c) => [c.name, c.wanted]), [["Dera", true], ["Sybaris", true], ["Braton", true], ["Okina", false]]);
});

test("prime parts: a copy being crafted in the foundry means the one you hold is spare", () => {
  const VAUBAN = "/Lotus/Powersuits/Engineer/VaubanPrime";
  const R = "/Lotus/Types/Recipes/WarframeRecipes/VaubanPrime";
  const catalog = [{ uniqueName: VAUBAN, name: "Vauban Prime", category: "Warframes", masterable: true, isPrime: true, components: [
    { uniqueName: `${R}Blueprint`, name: "Blueprint", ducats: 45, itemCount: 1 },
    { uniqueName: `${R}ChassisComponent`, name: "Chassis", ducats: 15, itemCount: 1 },
  ] } as CatalogItem];
  const held = [inv(`${R}ChassisBlueprint`, "Vauban Prime Chassis Blueprint", "prime_part", 1)];
  const idle = partRows(buildModel(bundle(held, catalog))).find((p) => p.name === "Vauban Prime Chassis Blueprint")!;
  assert.deepEqual([idle.keep, idle.spare], [1, 0]);
  const crafting = partRows(buildModel(bundle(held, catalog), undefined, { [`${R}ChassisBlueprint`]: 1 })).find((p) => p.name === "Vauban Prime Chassis Blueprint")!;
  assert.deepEqual([crafting.keep, crafting.spare], [0, 1]);
});
