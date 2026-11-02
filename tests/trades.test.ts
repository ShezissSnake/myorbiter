import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSetSales, salesFromTrade, tradeKey } from "../src/lib/core/trades";
import { indexItems, type MarketItem, type MyOrder } from "../src/lib/core/market";
import type { Trade } from "../src/lib/core/types";

const items: MarketItem[] = [
  { id: "co", slug: "condition_overload", gameRef: "/M/ConditionOverload", name: "Condition Overload", maxRank: 5, subtypes: null, tags: ["mod"] },
  { id: "gp", slug: "gauss_prime_neuroptics_blueprint", gameRef: "/G/Neuro", name: "Gauss Prime Neuroptics Blueprint", maxRank: null, subtypes: null, tags: ["prime"] },
];
const order = (id: string, itemId: string, quantity: number, platinum: number, rank: number | null = null): MyOrder => ({ id, itemId, type: "sell", platinum, quantity, rank, subtype: null, visible: true, updatedAt: null });
const trade = (t: Partial<Trade>): Trade => ({ uptime: 3127.384, at: 1_791_918_527 + 3127, partner: "Buyer1", offered: [], received: [], platinum_offered: 0, platinum_received: 0, ...t });

test("a sale is matched to its listing, at the platinum actually received", () => {
  const orders = [order("o1", "co", 2, 20, 0), order("o2", "co", 1, 55, 3)];
  const [s, ...rest] = salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }], platinum_received: 17 }), orders, indexItems(items))!;
  assert.equal(rest.length, 0);
  assert.equal(s.order?.id, "o1", "the unranked listing, not the R3 one");
  assert.equal(s.platinumEach, 17);
});

test("several items share the platinum by their listing prices; unlisted ones still count", () => {
  const orders = [order("o1", "co", 2, 20, 0), order("g", "gp", 5, 45)];
  const sales = salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }, { name: "Gauss Prime Neuroptics Blueprint", rank: null, count: 1 }], platinum_received: 65 }), orders, indexItems(items))!;
  assert.deepEqual(sales.map((s) => s.platinumEach), [20, 45]);
  const unlisted = salesFromTrade(trade({ offered: [{ name: "Forma Blueprint", rank: null, count: 2 }], platinum_received: 10 }), [], indexItems(items))!;
  assert.equal(unlisted[0].order, null);
  assert.equal(unlisted[0].platinumEach, 5);
});

test("buying, swapping or giving things away isn't a sale", () => {
  const idx = indexItems(items);
  assert.equal(salesFromTrade(trade({ received: [{ name: "Condition Overload", rank: 0, count: 1 }], platinum_offered: 17 }), [], idx), null);
  assert.equal(salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }], received: [{ name: "Forma Blueprint", rank: null, count: 1 }] }), [], idx), null);
  assert.equal(salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }] }), [], idx), null);
  assert.equal(tradeKey(100, trade({})), "100|3127.384");
});

test("a whole prime set handed over part by part is one set sale, matched to the set listing", async () => {
  const { buildModel } = await import("../src/lib/core/model");
  const comp = (n: string) => ({ uniqueName: `/Lotus/Types/Recipes/WarframeRecipes/NekrosPrime${n}Blueprint`, name: n, ducats: 45, itemCount: 1 });
  const m = buildModel({
    observed_at: 1,
    inventory: [],
    catalog: [{ uniqueName: "/Lotus/Powersuits/Nekros/NekrosPrime", name: "Nekros Prime", category: "Warframes", masterable: true, isPrime: true, components: [{ ...comp(""), uniqueName: "/Lotus/Types/Recipes/WarframeRecipes/NekrosPrimeBlueprint", name: "Blueprint" }, comp("Chassis"), comp("Systems")] }],
    relics: [],
    prices: { prices: {}, max_rank_prices: {} },
  } as unknown as Parameters<typeof buildModel>[0]);
  const setItems: MarketItem[] = [{ id: "nek", slug: "nekros_prime_set", gameRef: "/S/Set", name: "Nekros Prime Set", maxRank: null, subtypes: null, tags: ["set"] }];
  const offered = [{ name: "Nekros Prime Blueprint", rank: null, count: 1 }, { name: "Nekros Prime Chassis Blueprint", rank: null, count: 1 }, { name: "Nekros Prime Systems Blueprint", rank: null, count: 1 }];
  const [s, ...rest] = salesFromTrade(trade({ offered, platinum_received: 47 }), [order("o1", "nek", 1, 50)], indexItems(setItems), m)!;
  assert.equal(rest.length, 0);
  assert.equal(s.name, "Nekros Prime Set");
  assert.equal(s.platinumEach, 47);
  assert.equal(s.order?.id, "o1");
  // Part of the set only: the parts stay parts.
  assert.equal(salesFromTrade(trade({ offered: offered.slice(1), platinum_received: 31 }), [], indexItems(setItems), m)!.length, 2);
});

test("a set already logged as one sale per part is folded into one set sale", async () => {
  const { buildModel } = await import("../src/lib/core/model");
  const comp = (n: string, unique = `/Lotus/Types/Recipes/WarframeRecipes/NekrosPrime${n}Blueprint`) => ({ uniqueName: unique, name: n, ducats: 45, itemCount: 1 });
  const m = buildModel({
    observed_at: 1,
    inventory: [],
    catalog: [{ uniqueName: "/Lotus/Powersuits/Nekros/NekrosPrime", name: "Nekros Prime", category: "Warframes", masterable: true, isPrime: true, components: [comp("Blueprint", "/Lotus/Types/Recipes/WarframeRecipes/NekrosPrimeBlueprint"), comp("Chassis"), comp("Systems")] }],
    relics: [],
    prices: { prices: {}, max_rank_prices: {} },
  } as unknown as Parameters<typeof buildModel>[0]);
  const at = 1_792_512_340_000;
  const names = ["Nekros Prime Blueprint", "Nekros Prime Chassis Blueprint", "Nekros Prime Systems Blueprint"];
  const trades = [{ key: "s|1", at, partner: "Buyer2", offered: names.map((name) => ({ name, rank: null, count: 1 })), received: [], platOut: 0, platIn: 47 }];
  const sales = [
    { at: at + 5 * 60_000, item: "Serration", rank: 10, quantity: 1, platinum: 9 },
    ...names.map((item, i) => ({ at, item, rank: null, quantity: 1, platinum: [16, 16, 15][i] })),
  ];
  const out = foldSetSales(sales, trades, m)!;
  assert.deepEqual(out.map((s) => [s.item, s.quantity, s.platinum]), [["Serration", 1, 9], ["Nekros Prime Set", 1, 47]]);
  assert.equal(foldSetSales(out, trades, m), null, "already folded: nothing to do");
});

test("only a sure listing is marked sold: unranked arcanes, refinements, unknown ranks", () => {
  const more: MarketItem[] = [
    ...items,
    { id: "ab", slug: "arcane_barrier", gameRef: "/A/Barrier", name: "Arcane Barrier", maxRank: 5, subtypes: null, tags: ["arcane_enhancement"] },
    { id: "a1", slug: "axi_a1_relic", gameRef: "/R/AxiA1", name: "Axi A1 Relic", maxRank: null, subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic"] },
  ];
  const idx = indexItems(more);
  const sell = (name: string, rank: number | null, orders: MyOrder[], platinum = 5) => salesFromTrade(trade({ offered: [{ name, rank, count: 1 }], platinum_received: platinum }), orders, idx)![0].order?.id ?? null;
  // An unranked arcane has no pips in the log: it's rank 0, never the maxed listing.
  assert.equal(sell("Arcane Barrier", null, [order("max", "ab", 1, 80, 5), order("r0", "ab", 3, 5, 0)]), "r0");
  assert.equal(sell("Arcane Barrier", null, [order("max", "ab", 1, 80, 5)]), null);
  // Relics: by the refinement when the log names it; with none named, only if one refinement is listed.
  const relics = [{ ...order("rad", "a1", 2, 20), subtype: "radiant" }, { ...order("int", "a1", 5, 3), subtype: "intact" }];
  assert.equal(sell("Axi A1 Relic [Radiant]", null, relics, 18), "rad");
  assert.equal(sell("Axi A1 Relic", null, relics), null);
  assert.equal(sell("Axi A1 Relic", null, [relics[1]]), "int");
  // A ranked mod with no rank logged: only when it has a single listing.
  assert.equal(sell("Condition Overload", null, [order("o1", "co", 2, 20, 0), order("o2", "co", 1, 55, 3)]), null);
  assert.equal(sell("Condition Overload", null, [order("o2", "co", 1, 55, 3)], 52), "o2");
  // …and only at about its price: 5p for your 55p listing was another copy (an unranked one).
  assert.equal(sell("Condition Overload", null, [order("o2", "co", 1, 55, 3)], 5), null);
  // Variants the log can't tell apart: only the first one (regular, not atragraph).
  const ser: MarketItem = { id: "se", slug: "serration", gameRef: "/M/Serration", name: "Serration", maxRank: 10, subtypes: ["regular", "atragraph"], tags: ["mod"] };
  const sidx = indexItems([...more, ser]);
  const sold = (orders: MyOrder[]) => salesFromTrade(trade({ offered: [{ name: "Serration", rank: 10, count: 1 }], platinum_received: 40 }), orders, sidx)![0].order?.id ?? null;
  assert.equal(sold([{ ...order("atra", "se", 1, 45, 10), subtype: "atragraph" }]), null);
  assert.equal(sold([{ ...order("atra", "se", 1, 45, 10), subtype: "atragraph" }, order("reg", "se", 1, 40, 10)]), "reg");
});
