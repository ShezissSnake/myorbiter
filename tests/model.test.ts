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

test("relics without their own picture get their era's", async () => {
  const { relicImage } = await import("../src/lib/core/model");
  assert.equal(relicImage("Lith A13"), "RelicLithD.png");
  assert.equal(relicImage("Neo V8 Radiant"), "RelicNeoC.png");
  assert.equal(relicImage("Axi C12 Relic"), "RelicAxiD.png");
  assert.equal(relicImage("Requiem Eterna Flawless"), "RelicImmortalB.png");
  assert.equal(relicImage("Lith A13 Radiant Relic"), "RelicLithC.png");
  assert.equal(relicImage("Lithos Prime"), null);
});

test("relic names, old and new Requiem ones included, are told from item names", async () => {
  const { relicBase } = await import("../src/lib/core/describe");
  assert.equal(relicBase("Axi A22 Relic (Radiant)"), "Axi A22");
  assert.equal(relicBase("Requiem IV"), "Requiem IV");
  assert.equal(relicBase("Requiem Eterna"), "Requiem Eterna");
  assert.equal(relicBase("Requiem Eterna Relic (Radiant)"), "Requiem Eterna");
  assert.equal(relicBase("Axi Prime"), null);
  assert.equal(relicBase("Lith"), null);
});

test("a damaged read: rows without a name or path are left out, the rest still builds", () => {
  const row = inv("/Lotus/Types/Recipes/WarframeRecipes/ValkyrPrimeSystemsComponent", "Valkyr Prime Systems", 1);
  const broken = [{ ...row, category: "relic", name: null }, { ...row, item_id: null }] as unknown as InventoryRow[];
  const m = buildModel({ observed_at: 1, inventory: [row, ...broken], catalog: [], relics: [], prices: { prices: {}, max_rank_prices: {} } });
  assert.deepEqual([...m.inventoryByBase.values()].flat().map((r) => r.name), ["Valkyr Prime Systems"]);
});

test("a sync with the same catalogs keeps what's worked out from them, and reads the new inventory", () => {
  const SYS = "/Lotus/Types/Recipes/WarframeRecipes/ValkyrPrimeSystemsComponent";
  const catalog = [{ uniqueName: "/Lotus/Powersuits/Berserker/ValkyrPrime", name: "Valkyr Prime", category: "Warframes", masterable: true, isPrime: true, imageName: "valkyr-prime.png", components: [{ uniqueName: SYS, name: "Systems", ducats: 45, itemCount: 1 }] }] as Bundle["catalog"];
  const relics = [{ uniqueName: "/R/A1Bronze", name: "Axi A1 Intact", vaulted: true, imageName: "axi.png", rewards: [{ name: "Valkyr Prime Systems", rarity: "Uncommon", chance: 25.33 }] }] as Bundle["relics"];
  const read = (n: number, extra: InventoryRow[] = []) => buildModel({ observed_at: n, inventory: [inv(SYS, "Valkyr Prime Systems", n), ...extra], catalog, relics, prices: { prices: {}, max_rank_prices: {} } } as Bundle);
  const a = read(1);
  const b = read(3, [{ ...inv("/Lotus/Misc/Thing", "Odd Thing", 1), image_name: "odd.png" }]);
  assert.equal(b.catalogByUnique, a.catalogByUnique, "the catalog's lookups are the same objects");
  assert.equal(b.sourcesByReward, a.sourcesByReward, "so are the relics' (Varzia's stock unchanged)");
  assert.equal(a.partHave("Valkyr Prime Systems Blueprint"), 1);
  assert.equal(b.partHave("Valkyr Prime Systems Blueprint"), 3, "the new read's counts");
  assert.equal(b.nameOf("/Lotus/Misc/Thing"), "Odd Thing", "a name only the inventory knows");
  assert.equal(a.nameOf("/Lotus/Misc/Thing"), "Thing", "not in the older read");
  assert.equal(b.imageOf("Odd Thing"), "odd.png");
  assert.equal(b.imageOf("Valkyr Prime"), "valkyr-prime.png");
  assert.equal(b.imageOf("Axi A1"), "axi.png");
  // Varzia brings the relic back: worked out again for her stock.
  const c = buildModel({ observed_at: 4, inventory: [], catalog, relics, prices: null } as Bundle, { fissures: null, resurgence: [{ uniqueName: "/R/A1Bronze" }], resurgenceExpiry: null } as never);
  assert.equal(c.sourcesByReward.get("Valkyr Prime Systems")?.[0].resurgence, true);
  assert.equal(b.sourcesByReward.get("Valkyr Prime Systems")?.[0].resurgence, false);
  // A catalog grown in place is read again.
  catalog.push({ uniqueName: "/Lotus/Weapons/Other", name: "Other", category: "Primary", masterable: true } as Bundle["catalog"][number]);
  assert.ok(read(1).catalogByUnique.has("/Lotus/Weapons/Other"));
});
