import { test } from "node:test";
import assert from "node:assert/strict";
import { foldSetSales, listingFor, loggedForTrade, repCandidates, salesFromTrade, takeLogged, tradeKey, tradesToMark } from "../src/lib/core/trades";
import type { Sale, TradeLogEntry } from "../src/lib/backend";
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
  // A listed item traded with unlisted ones: the platinum is shared out evenly, so no price check.
  const mixed = salesFromTrade(trade({ offered: [{ name: "Gauss Prime Neuroptics Blueprint", rank: null, count: 1 }, { name: "Forma Blueprint", rank: null, count: 3 }], platinum_received: 60 }), [order("g", "gp", 1, 45)], idx)!;
  assert.equal(mixed[0].order?.id, "g");
});

// Imprints: the trade log names one after the pet it was taken from; warframe.market lists it by breed.
const HURAS = "/Lotus/Types/Game/KubrowPet/MediumKubrowPetPowerSuit";
const SUNIKA_BREED = "/Lotus/Types/Game/KubrowPet/HunterKubrowPetPowerSuit";
const imprintItems: MarketItem[] = [
  ...items,
  { id: "hi", slug: "huras_kubrow_imprint", gameRef: HURAS, name: "Huras Kubrow Imprint", maxRank: null, subtypes: null, tags: ["imprint"] },
  { id: "si", slug: "sunika_kubrow_imprint", gameRef: SUNIKA_BREED, name: "Sunika Kubrow Imprint", maxRank: null, subtypes: null, tags: ["imprint"] },
];
const row = (name: string, breed: string) => ({ ItemType: "/Lotus/Types/Game/KubrowPet/ImprintedTraitPrint", Name: name, DominantTraits: { Personality: breed } });

test("an imprint sold under its pet's name is the market's imprint of that pet's breed", async () => {
  const { imprintSaleName } = await import("../src/lib/core/imprints");
  const { imprintNaming } = await import("../src/lib/core/trades");
  const idx = indexItems(imprintItems);
  const n = imprintNaming(idx, [row("Biscuit", HURAS), row("Pepper", SUNIKA_BREED)]);
  assert.equal(imprintSaleName("Imprint of Biscuit", n), "Huras Kubrow Imprint", "pet name, then its breed");
  assert.equal(imprintSaleName("IMPRINT OF pepper", n), "Sunika Kubrow Imprint", "in any case");
  assert.equal(imprintSaleName("Imprint of Huras Kubrow", imprintNaming(idx, [])), "Huras Kubrow Imprint", "no row: the breed in the text");
  assert.equal(imprintSaleName("Imprint of Rex", n), null, "neither: no guess");
  assert.equal(imprintSaleName("Imprint of Huras Kubrow and Sunika Kubrow", n), null, "two breeds named: no guess");
  assert.equal(imprintSaleName("Imprint of Biscuit", imprintNaming(idx, [row("Biscuit", HURAS), row("Biscuit", SUNIKA_BREED)])), null, "two pets of that name, of different breeds: no guess");
  assert.equal(imprintSaleName("Condition Overload", n), null, "only imprints");

  const orders = [order("h", "hi", 1, 40)];
  const [s] = salesFromTrade(trade({ offered: [{ name: "Imprint of Biscuit", rank: null, count: 1 }], platinum_received: 40 }), orders, idx, null, [row("Biscuit", HURAS)])!;
  assert.equal(s.name, "Huras Kubrow Imprint");
  assert.equal(s.order?.id, "h", "matched to the imprint listing");
  const [u] = salesFromTrade(trade({ offered: [{ name: "Imprint of Rex", rank: null, count: 1 }], platinum_received: 40 }), orders, idx, null, [row("Biscuit", HURAS)])!;
  assert.equal(u.name, "Imprint of Rex", "unresolved: kept as logged");
  assert.equal(u.order, null);
});

test("an imprint told only by a breed in its pet's name is named, not matched to a listing", () => {
  const idx = indexItems(imprintItems);
  const [s] = salesFromTrade(trade({ offered: [{ name: "Imprint of Huras Kubrow", rank: null, count: 1 }], platinum_received: 40 }), [order("h", "hi", 1, 40)], idx, null, [])!;
  assert.equal(s.name, "Huras Kubrow Imprint", "named and priced by the breed");
  assert.equal(s.order, null, "but no listing closed on a name the player chose");
});

// ---- Matching a trade to the right listing, once.

test("the same mod at another rank doesn't close the wrong listing", () => {
  const orders = [order("r0", "co", 1, 20, 0), order("r5", "co", 1, 60, 5)];
  const [r5] = salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: 5, count: 1 }], platinum_received: 60 }), orders, indexItems(items))!;
  assert.equal(r5.order?.id, "r5");
  const [r0] = salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }], platinum_received: 20 }), orders, indexItems(items))!;
  assert.equal(r0.order?.id, "r0");
  // A rank the log didn't give, with two ranks listed: neither.
  const [unknown] = salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: null, count: 1 }], platinum_received: 20 }), orders, indexItems(items))!;
  assert.equal(unknown.order, null);
  // A rank nothing is listed at: nothing closed.
  const [r3] = salesFromTrade(trade({ offered: [{ name: "Condition Overload", rank: 3, count: 1 }], platinum_received: 40 }), orders, indexItems(items))!;
  assert.equal(r3.order, null);
});

test("an item-for-item trade isn't a sale of anything, listed or not", () => {
  const orders = [order("o", "gp", 1, 45), order("c", "co", 1, 20, 0)];
  const swap = trade({ offered: [{ name: "Gauss Prime Neuroptics Blueprint", rank: null, count: 1 }], received: [{ name: "Condition Overload", rank: 0, count: 1 }] });
  assert.equal(salesFromTrade(swap, orders, indexItems(items)), null);
  // Items and platinum for items: still a swap, not a sale.
  assert.equal(salesFromTrade({ ...swap, platinum_received: 30 }, orders, indexItems(items)), null);
});

test("several listings of one item at different prices: the one at the price paid, or none", () => {
  const it = items[1];
  const orders = [order("a", "gp", 2, 40), order("b", "gp", 1, 45), order("c", "gp", 1, 50)];
  // warframe.market allows three visible listings of one item at different prices.
  assert.equal(listingFor(it, null, null, orders, 45)?.id, "b", "exactly one asks what a copy went for");
  assert.equal(listingFor(it, null, null, orders, 42), null, "paid a price none asks");
  assert.equal(listingFor(it, null, null, orders, null), null, "what a copy went for isn't known");
  assert.equal(listingFor(it, null, null, [order("a", "gp", 2, 40), order("a2", "gp", 1, 40)], null)?.id, "a", "one price: the same offer");
  // Through a trade: one item alone, 2 copies for 80p is 40p each.
  const [s] = salesFromTrade(trade({ offered: [{ name: "Gauss Prime Neuroptics Blueprint", rank: null, count: 2 }], platinum_received: 80 }), orders, indexItems(items))!;
  assert.equal(s.order?.id, "a");
  // With another item in the trade, what each copy went for can't be told: left listed.
  const two = salesFromTrade(trade({ offered: [{ name: "Gauss Prime Neuroptics Blueprint", rank: null, count: 1 }, { name: "Condition Overload", rank: 0, count: 1 }], platinum_received: 65 }), [...orders, order("co", "co", 1, 20, 0)], indexItems(items))!;
  assert.equal(two.find((x) => x.name === "Gauss Prime Neuroptics Blueprint")?.order, null);
});

test("a trade read again after a restart is acted on once", () => {
  const now = (1_791_918_527 + 3127) * 1000 + 60_000;
  const t = trade({ offered: [{ name: "Condition Overload", rank: 0, count: 1 }], platinum_received: 20 });
  const first = tradesToMark([t], 1_791_918_527, [], now, false);
  assert.deepEqual(first.fresh, [tradeKey(1_791_918_527, t)]);
  assert.equal(first.recent.length, 1);
  // The same game session's log, read again by the next run: the key was kept.
  const again = tradesToMark([t], 1_791_918_527, first.fresh, now + 5_000, true);
  assert.deepEqual(again, { fresh: [], recent: [] });
  // And the sales log, by the trade's identity, says it's logged.
  const sales: Sale[] = [{ at: now, item: "Condition Overload", rank: 0, quantity: 1, platinum: 20, trade: first.fresh[0] }];
  assert.ok(takeLogged(loggedForTrade(sales, first.fresh[0]), { name: "Condition Overload", rank: 0, count: 1 }));
});

test("two trades of the same item with the same partner are two sales, each logged once", () => {
  const session = 1_791_918_527;
  const a = trade({ uptime: 100.5, offered: [{ name: "Condition Overload", rank: 0, count: 1 }], platinum_received: 20 });
  const b = trade({ uptime: 160.25, offered: [{ name: "Condition Overload", rank: 0, count: 1 }], platinum_received: 20 });
  const { fresh } = tradesToMark([a, b], session, [], (session + 200) * 1000, false);
  assert.equal(new Set(fresh).size, 2, "two keys");
  const sales: Sale[] = [{ at: 0, item: "Condition Overload", rank: 0, quantity: 1, platinum: 20, trade: fresh[0] }];
  const line = { name: "Condition Overload", rank: 0, count: 1 };
  assert.ok(takeLogged(loggedForTrade(sales, fresh[0]), line));
  assert.ok(!takeLogged(loggedForTrade(sales, fresh[1]), line), "the second trade's sale isn't the first's");
  assert.ok(!takeLogged(loggedForTrade(sales, fresh[0]), { name: "Gauss Prime Neuroptics Blueprint", rank: null, count: 1 }), "another item of the same trade isn't either");
});

test("one trade of the same item twice (two ranks, two refinements) logs two sales, and again logs none", () => {
  const key = "s|1";
  const a = { name: "Condition Overload", rank: 0, count: 1 };
  const b = { name: "Condition Overload", rank: 5, count: 1 };
  const relic = { name: "Axi A1 Relic", rank: null, count: 1 };
  // First time: nothing logged before, so every line is logged, even as the log fills meanwhile.
  const before = loggedForTrade([], key);
  assert.ok(![a, b, relic, relic].some((l) => takeLogged(before, l)));
  // Handled again: each line finds its own sale, once.
  const sales: Sale[] = [a, b, relic, relic].map((l) => ({ at: 0, item: l.name, rank: l.rank, quantity: l.count, platinum: 10, trade: key }));
  const again = loggedForTrade(sales, key);
  assert.ok([a, b, relic, relic].every((l) => takeLogged(again, l)));
  assert.equal(again.length, 0);
  assert.ok(!takeLogged(again, relic), "a third relic line would be new");
});

test("+rep that failed and is tried again goes once: one per player, never again once given", () => {
  const now = 1_800_000_000_000;
  const entry = (key: string, partner: string, at: number): TradeLogEntry => ({ key, at, partner, offered: [], received: [], platOut: 0, platIn: 20 }) as TradeLogEntry;
  const trades = [entry("s|1", "Buyer1", now - 60_000), entry("s|2", "Buyer1", now - 30_000)];
  // Failed: nothing recorded, so the retry picks it again, and only one trade per player.
  assert.deepEqual(repCandidates(trades, {}, now).map((t) => t.key), ["s|1"]);
  assert.deepEqual(repCandidates(trades, {}, now + 120_000).map((t) => t.key), ["s|1"]);
  // Given on the retry: no second +rep, for that trade or the partner's other one, nor after a restart.
  assert.deepEqual(repCandidates(trades, { "s|1": "given" }, now + 180_000), []);
  assert.deepEqual(repCandidates([...trades, entry("s|3", "buyer1", now)], { "s|1": "given" }, now + 180_000), [], "names in any case");
});
