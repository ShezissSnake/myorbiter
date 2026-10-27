// What orbiter offers to sell: keep rules, sets before loose parts, duplicate maxed arcanes,
// relic value per crack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { arcaneRows, partRows, relicRows } from "../src/lib/core/views";
import { holdings, type MarketItem } from "../src/lib/core/market";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const RHINO = "/Lotus/Powersuits/Rhino/RhinoPrime";
const bundle = (inventory: InventoryRow[]): Bundle => ({
  observed_at: 1_700_000_000,
  inventory,
  catalog: [
    {
      uniqueName: RHINO, name: "Rhino Prime", category: "Warframes", masterable: true, isPrime: true,
      components: [
        { uniqueName: "/R/Bp", name: "Blueprint", ducats: 100, itemCount: 1 },
        { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 45, itemCount: 1 },
        { uniqueName: "/R/Systems", name: "Systems", ducats: 45, itemCount: 1 },
      ],
    },
    { uniqueName: "/A/Energize", name: "Arcane Energize", category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true },
  ],
  relics: [
    { uniqueName: "/Relic/K1Bronze", name: "Lith K1 Intact", vaulted: false, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 2 }, { name: "1200X Kuva", rarity: "Common", chance: 98 }] },
    { uniqueName: "/Relic/K1Platinum", name: "Lith K1 Radiant", vaulted: false, rewards: [{ name: "Rhino Prime Systems Blueprint", rarity: "Rare", chance: 10 }, { name: "1200X Kuva", rarity: "Common", chance: 90 }] },
  ],
  prices: {
    prices: { "Rhino Prime Set": 60, "Rhino Prime Blueprint": 20, "Rhino Prime Chassis Blueprint": 5, "Rhino Prime Neuroptics Blueprint": 10, "Rhino Prime Systems Blueprint": 30, "Arcane Energize": 8 },
    max_rank_prices: { "Arcane Energize": 160 },
  },
});
const parts = (n: number) => [
  inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", n),
  inv("/R/Chassis", "Rhino Prime Chassis Blueprint", "prime_part", n),
  inv("/R/Helmet", "Rhino Prime Neuroptics Blueprint", "prime_part", n),
  inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", n),
];
const sys = (rows: InventoryRow[]) => partRows(buildModel(bundle(rows))).find((p) => p.name === "Rhino Prime Systems Blueprint")!;

test("unmastered and unbuilt: one full set is kept to build and master", () => {
  const p = sys(parts(1));
  assert.equal(p.keep, 1);
  assert.equal(p.spare, 0);
  assert.equal(p.inSets, 0);
  const two = sys(parts(2));
  assert.equal(two.keep, 1);
  assert.equal(two.spare, 1);
  assert.equal(two.inSets, 1, "the second set is complete: sell it as a set");
});

test("unmastered with a partial set: every copy is kept", () => {
  const p = sys([inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 1)]);
  assert.equal(p.keep, 1);
  assert.equal(p.spare, 0);
});

test("mastered: nothing is kept, complete sets are sold as sets, the rest loose", () => {
  const rows = [...parts(1), inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 1), inv(RHINO, "Rhino Prime", "frame", 0, { mastered: true })];
  const p = sys(rows);
  assert.equal(p.keep, 0);
  assert.equal(p.spare, 2);
  assert.equal(p.inSets, 1);
  const bp = partRows(buildModel(bundle(rows))).find((x) => x.name === "Rhino Prime Blueprint")!;
  assert.equal(bp.spare, 1);
  assert.equal(bp.inSets, 1);
});

test("built but not mastered: the built one is what you master, parts can go", () => {
  const p = sys([...parts(1), inv(RHINO, "Rhino Prime", "frame", 1)]);
  assert.equal(p.keep, 0);
  assert.equal(p.spare, 1);
});

test("duplicate maxed arcanes: keep one, the rest are for sale at max rank", () => {
  const [a] = arcaneRows(buildModel(bundle([
    inv("/A/Energize", "Arcane Energize", "arcane", 3, { rank: 5 }),
    inv("/A/Energize", "Arcane Energize", "arcane", 2),
  ])));
  assert.equal(a.maxedCopies, 3);
  assert.equal(a.extraMaxed, 2);
  assert.equal(a.unranked, 2);
  const [one] = arcaneRows(buildModel(bundle([inv("/A/Energize", "Arcane Energize", "arcane", 1, { rank: 5 })])));
  assert.equal(one.extraMaxed, 0);
});

test("relic averages count unsellable rewards (Kuva) as 0 instead of giving up", () => {
  const [r] = relicRows(buildModel(bundle([inv("/Relic/K1Bronze", "Lith K1 Intact", "relic", 1)])));
  assert.equal(r.evIntact, 0.6);
  assert.equal(r.evRadiant, 3);
  assert.equal(r.evGain, 2.4);
  assert.equal(r.rewards[0].chanceRadiant, 10);
  assert.equal(r.outRadiant.length, 2);
});

test("a set's holdings are complete sets of parts, not the built item", () => {
  const set: MarketItem = { id: "s", slug: "rhino_prime_set", name: "Rhino Prime Set", gameRef: RHINO, maxRank: null, subtypes: null, tags: ["set", "prime", "warframe"] };
  assert.deepEqual(holdings(buildModel(bundle([inv(RHINO, "Rhino Prime", "frame", 1)])), set), []);
  assert.deepEqual(holdings(buildModel(bundle(parts(2))), set), [{ rank: null, subtype: null, count: 2 }]);
});

test("relics: sold only when the sale beats a crack (ducats counted), never one with a part you still need", async () => {
  const { spareRows } = await import("../src/lib/core/spares");
  const relic = inv("/Relic/K1Bronze", "Lith K1 Intact", "relic", 5);
  const withPrice = (relicPrice: number, extra: InventoryRow[] = []) => {
    const b = bundle([relic, ...extra]);
    b.prices!.prices!["Lith K1 Relic"] = relicPrice;
    return buildModel(b);
  };
  const mastered = [inv(RHINO, "Rhino Prime", "warframe", 1, { mastered: true })];
  const row = (m: ReturnType<typeof buildModel>, sell = { veiledRivens: false, relicsWorthSelling: true }, rate = 0) => spareRows(m, null, sell, rate).find((r) => r.kind === "relic")!;
  // A crack: 2% of a 30p Systems = 0.6p (Kuva sells for nothing).
  const sells = row(withPrice(3, mastered));
  assert.deepEqual([sells.spare, sells.crack], [5, 0.6]);
  assert.equal(row(withPrice(3, mastered), { veiledRivens: false, relicsWorthSelling: false }).spare, 0, "off keeps every relic");
  // Counting the Systems' 45 ducats at 1p each (45p beats 30p): a crack is 0.9p, more than 0.8p sold.
  assert.equal(row(withPrice(0.8, mastered)).spare, 5);
  const ducats = row(withPrice(0.8, mastered), undefined, 1);
  assert.deepEqual([ducats.spare, ducats.crack], [0, 0.9]);
  assert.match(ducats.why, /Worth more cracked/);
  // Rhino not built: the relic drops a part you still need.
  const needed = row(withPrice(3));
  assert.equal(needed.spare, 0);
  assert.match(needed.why, /which you still need/);
});

test("relic prices by refinement: warframe.market's sales first, the intact price only standing in", async () => {
  const { inventoryRows } = await import("../src/lib/core/views");
  const b = bundle([inv("/Relic/K1Platinum", "Lith K1 Radiant", "relic", 2), inv("/Relic/K1Bronze", "Lith K1 Intact", "relic", 2)]);
  b.prices!.prices!["Lith K1 Relic"] = 3;
  const plain = buildModel(b);
  assert.equal(plain.relicPrice("Lith K1", "Radiant"), null, "TennoScope has no radiant price");
  assert.equal(plain.relicPrice("Lith K1", "Flawless"), null, "nor a flawless one: not the intact one in its place");
  const sold = buildModel(b, undefined, null, { "Lith K1": { at: 0, prices: { intact: 2.5, radiant: 9 } } });
  assert.deepEqual([sold.relicPrice("Lith K1"), sold.relicPrice("Lith K1", "Radiant")], [2.5, 9]);
  const price = (m: ReturnType<typeof buildModel>, ref: string) => inventoryRows(m).find((r) => r.name === `Lith K1 ${ref}`)?.price;
  assert.deepEqual([price(plain, "Radiant"), price(sold, "Radiant"), price(sold, "Intact")], [3, 9, 2.5]);
});

test("Baro's ducat rate: the best price per ducat among what he sells that trades daily", async () => {
  const { baroRate } = await import("../src/lib/core/traders");
  const b = bundle([]);
  b.prices!.prices!["Primed Fury"] = 60;
  b.prices!.prices!["Primed Flow"] = 90;
  b.prices!.prices!["Prisma Skana"] = 400;
  (b.prices as unknown as { trade_rate: Record<string, unknown> }).trade_rate = { "Primed Fury": [3, 0, ""], "Primed Flow": [2, 0, ""], "Prisma Skana": [0.2, 0, ""] };
  const live = { fissures: null, resurgence: null, resurgenceExpiry: null, baro: { activation: "2026-10-30T13:00:00Z", expiry: "2026-11-01T13:00:00Z", location: "Larunda Relay", inventory: [
    { uniqueName: "/S/Fury", item: "Primed Fury", ducats: 300, credits: 1 },
    { uniqueName: "/S/Flow", item: "Primed Flow", ducats: 350, credits: 1 },
    { uniqueName: "/S/Skana", item: "Prisma Skana", ducats: 500, credits: 1 },
  ] } };
  const r = baroRate(buildModel(b, live));
  assert.deepEqual(r && [r.item, r.rate], ["Primed Flow", 0.26], "Prisma Skana's 0.8p a ducat doesn't count: it hardly sells");
  assert.equal(baroRate(buildModel(b)), null, "away: nothing to go by");
});
