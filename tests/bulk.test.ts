// "Put my spares on sale": what qualifies for each ticked category, and the changes to your listings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { bulkPlan, sellTargets, defaultBulkRules, LIMIT_WHY, type BulkContext, type BulkRules } from "../src/lib/core/bulk";
import { indexItems, type BookOrder, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { defaultAdvice } from "../src/lib/backend";
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
        { uniqueName: "/R/Bp", name: "Blueprint", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Chassis", name: "Chassis", ducats: 15, itemCount: 1 },
        { uniqueName: "/R/Helmet", name: "Neuroptics", ducats: 100, itemCount: 1 },
        { uniqueName: "/R/Systems", name: "Systems", ducats: 15, itemCount: 1 },
      ],
    },
    { uniqueName: "/A/Energize", name: "Arcane Energize", category: "Arcanes", type: "Warframe Arcane", maxRank: 5, tradable: true },
    { uniqueName: "/M/Serration", name: "Serration", category: "Mods", maxRank: 10, tradable: true },
    { uniqueName: "/M/Thumper", name: "Thumper", category: "Mods", maxRank: 5, tradable: true },
  ],
  relics: [],
  prices: {
    prices: {
      "Rhino Prime Set": 60, "Rhino Prime Blueprint": 20, "Rhino Prime Chassis Blueprint": 12,
      "Rhino Prime Neuroptics Blueprint": 4, "Rhino Prime Systems Blueprint": 30,
      "Arcane Energize": 8, Serration: 12, Thumper: 3,
    },
    max_rank_prices: { "Arcane Energize": 160, Serration: 40 },
    trade_rate: { Serration: [5, 0, ""], Thumper: [0.2, 0, ""], "Arcane Energize": [8, 0, ""] },
  },
});
const rhino = (n: number) => [
  inv("/R/Bp", "Rhino Prime Blueprint", "prime_part", n),
  inv("/R/Chassis", "Rhino Prime Chassis Blueprint", "prime_part", n),
  inv("/R/Helmet", "Rhino Prime Neuroptics Blueprint", "prime_part", n),
  inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", n),
];
const only = (k: Partial<BulkRules>): BulkRules => ({ sets: false, arcanes: false, mods: false, parts: false, partsKeep: 10, other: false, ...k });

test("sets: every complete set once mastered, all but one otherwise", () => {
  const unmastered = sellTargets(buildModel(bundle(rhino(3))), only({ sets: true }), defaultAdvice());
  assert.deepEqual(unmastered.map((t) => [t.name, t.quantity]), [["Rhino Prime Set", 2]]);
  const mastered = sellTargets(buildModel(bundle([...rhino(3), inv(RHINO, "Rhino Prime", "warframe", 1, { mastered: true })])), only({ sets: true }), defaultAdvice());
  assert.deepEqual(mastered.map((t) => [t.name, t.quantity]), [["Rhino Prime Set", 3]]);
});

test("arcanes: only maxed copies beyond the one you keep, at max rank", () => {
  const t = sellTargets(buildModel(bundle([
    inv("/A/Energize", "Arcane Energize", "arcane", 3, { rank: 5 }),
    inv("/A/Energize", "Arcane Energize", "arcane", 7),
  ])), only({ arcanes: true }), defaultAdvice());
  assert.deepEqual(t.map((x) => [x.name, x.rank, x.quantity]), [["Arcane Energize", 5, 2]]);
});

test("mods: your best copy is kept, the rest listed by rank, and only mods that sell daily", () => {
  const t = sellTargets(buildModel(bundle([
    inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }),
    inv("/M/Serration", "Serration", "mod", 3),
    inv("/M/Thumper", "Thumper", "mod", 240),
  ])), only({ mods: true }), defaultAdvice());
  assert.deepEqual(t.map((x) => [x.name, x.rank, x.quantity]), [["Serration", 0, 2]], "Thumper hardly trades; the R10 Serration and one unranked to give away are kept");
});

test("parts: only the copies over the limit, never ones going out in a set, never a ducat deal", () => {
  const m = buildModel(bundle([...rhino(1), inv("/R/Systems", "Rhino Prime Systems Blueprint", "prime_part", 13), inv("/R/Helmet", "Rhino Prime Neuroptics Blueprint", "prime_part", 13), inv(RHINO, "Rhino Prime", "warframe", 1, { mastered: true })]));
  // 14 Systems, 14 Neuroptics, 1 of the rest. With sets on, one of each goes in the set.
  const both = sellTargets(m, only({ sets: true, parts: true }), defaultAdvice());
  const listed = (ts: typeof both) => ts.filter((x) => !x.hold).map((x) => [x.name, x.quantity]);
  assert.deepEqual(listed(both), [["Rhino Prime Set", 1], ["Rhino Prime Systems Blueprint", 3]]);
  const neuro = both.find((x) => x.name === "Rhino Prime Neuroptics Blueprint");
  assert.ok(neuro?.hold?.takeDown, "Neuroptics: 100 ducats beat 4p, so it's held back for ducats");
  assert.match(neuro!.hold!.why, /Worth more as ducats/);
  const partsOnly = sellTargets(m, only({ parts: true }), defaultAdvice());
  assert.deepEqual(listed(partsOnly), [["Rhino Prime Systems Blueprint", 4]]);
});

// ------------------------------------------------------------------ the changes

const items: MarketItem[] = [
  { id: "set", slug: "rhino_prime_set", gameRef: RHINO, name: "Rhino Prime Set", maxRank: null, subtypes: null, tags: ["prime", "warframe", "set"] },
  { id: "ser", slug: "serration", gameRef: "/M/Serration", name: "Serration", maxRank: 10, subtypes: null, tags: ["mod"] },
  { id: "thu", slug: "thumper", gameRef: "/M/Thumper", name: "Thumper", maxRank: 5, subtypes: null, tags: ["mod"] },
  { id: "ene", slug: "arcane_energize", gameRef: "/A/Energize", name: "Arcane Energize", maxRank: 5, subtypes: null, tags: ["arcane_enhancement"] },
];
const me = { id: "me", platform: "pc", crossplay: true };
const seller = (platinum: number, rank: number | null = null, status = "ingame"): BookOrder => ({
  id: `b${platinum}`, type: "sell", platinum, quantity: 1, rank, subtype: null, visible: true,
  user: { id: `u${platinum}`, ingameName: `Seller${platinum}`, status, platform: "pc", crossplay: true },
});
const order = (id: string, itemId: string, quantity: number, platinum: number, rank: number | null = null, extra: Partial<MyOrder> = {}): MyOrder => ({
  id, itemId, type: "sell", platinum, quantity, rank, subtype: null, visible: true, updatedAt: null, ...extra,
});
const ctx = (m: ReturnType<typeof buildModel>, orders: MyOrder[], books: BulkContext["books"], extra: Partial<BulkContext> = {}): BulkContext => ({
  model: m, index: indexItems(items), orders, me, books, minPrice: 10, minShare: 0.5, floors: {}, paused: {}, ...extra,
});

test("plan: new listings at the cheapest in-game price, existing ones resized and repriced", () => {
  const m = buildModel(bundle([...rhino(3), inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 3)]));
  const rules = only({ sets: true, mods: true });
  const plan = bulkPlan(ctx(m, [order("o1", "ser", 5, 20, 0)], { rhino_prime_set: [seller(55), seller(50, null, "online")], serration: [seller(14, 0)] }), rules, sellTargets(m, rules, defaultAdvice()));
  const create = plan.find((a) => a.type === "create")!;
  assert.equal(create.type === "create" && [create.item.name, create.quantity, create.platinum].join(), "Rhino Prime Set,2,55", "online-only sellers don't count");
  const update = plan.find((a) => a.type === "update")!;
  assert.equal(update.type === "update" && [update.quantity, update.platinum].join(), "2,14", "lowered to what's spare (one unranked kept to give away), matched to 14p");
});

test("plan: under the minimum price or nothing left, a listing goes; left-alone and hidden ones stay", () => {
  const m = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 10 })]));
  const rules = only({ mods: true, arcanes: true });
  const orders = [order("gone", "ser", 2, 15, 0), order("mine", "thu", 1, 30, 0), order("paused", "ene", 1, 150, 5), order("hidden", "ser", 1, 50, 10, { visible: false })];
  const plan = bulkPlan(ctx(m, orders, {}, { paused: { "ene|5|": true } }), rules, sellTargets(m, rules, defaultAdvice()));
  assert.deepEqual(plan.filter((a) => a.type === "remove").map((a) => a.type === "remove" && a.order.id).sort(), ["gone", "mine"]);
  assert.equal(plan.length, 2, "the left-alone arcane and the hidden mod aren't touched");

  const cheap = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 2)]));
  const p2 = bulkPlan(ctx(cheap, [], { serration: [seller(6, 0)] }), only({ mods: true }), sellTargets(cheap, only({ mods: true }), defaultAdvice()));
  assert.equal(p2[0].type, "skip");
  assert.match(p2[0].type === "skip" ? p2[0].why : "", /under your 10p minimum/);
});

test("plan: a listing of yours under your minimum stays up while you hold it, lowered to what you hold", () => {
  const m = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 4)]));
  const rules = only({ mods: true });
  const targets = sellTargets(m, rules, defaultAdvice());
  // Priced under the minimum by its order book.
  const cheap = bulkPlan(ctx(m, [order("r0", "ser", 3, 6, 0)], { serration: [seller(6, 0)] }), rules, targets);
  assert.deepEqual(cheap.map((a) => a.type), ["skip"]);
  assert.equal(cheap[0].type === "skip" && cheap[0].why, "Sells for 6p, under your 10p minimum: left as you listed it");
  // More listed than you hold: lowered to what you hold, never removed.
  const over = bulkPlan(ctx(m, [order("r0", "ser", 9, 6, 0)], { serration: [seller(6, 0)] }), rules, targets);
  assert.deepEqual(over.map((a) => a.type), ["update"]);
  assert.equal(over[0].type === "update" && [over[0].quantity, over[0].platinum].join(), "4,6");
});

test("plan: categories you didn't tick are never touched", () => {
  const m = buildModel(bundle([]));
  const plan = bulkPlan(ctx(m, [order("s", "set", 1, 60), order("x", "ser", 1, 20, 0)], {}), only({ arcanes: true }), []);
  assert.deepEqual(plan, []);
  assert.deepEqual(defaultBulkRules().partsKeep, 0, "prime parts follow the Prime parts page's spare count");
});

test("plan: your own listings in a ticked category are kept while you hold them, lowered when you hold fewer", () => {
  const m = buildModel(bundle([inv("/A/Energize", "Arcane Energize", "arcane", 5), inv("/A/Energize", "Arcane Energize", "arcane", 1, { rank: 5 })]));
  const rules = only({ arcanes: true });
  const keep = bulkPlan(ctx(m, [order("r0", "ene", 3, 9, 0)], {}), rules, sellTargets(m, rules, defaultAdvice()));
  assert.deepEqual(keep, [], "you hold 5 unranked: a listing of 3 is yours to keep");
  const lower = bulkPlan(ctx(m, [order("r0", "ene", 8, 9, 0)], {}), rules, sellTargets(m, rules, defaultAdvice()));
  assert.equal(lower.length, 1);
  assert.equal(lower[0].type === "update" && lower[0].quantity, 5);
});

test("plan: clearly cheap by the daily median is settled without fetching its prices", () => {
  const m = buildModel(bundle([inv("/M/Thumper", "Thumper", "mod", 3)]));
  const plan = bulkPlan(ctx(m, [], {}), only({ mods: true }), [{ kind: "mod", name: "Thumper", unique: "/M/Thumper", rank: 0, quantity: 2, why: "" }]);
  assert.equal(plan[0].type, "skip");
  assert.match(plan[0].type === "skip" ? plan[0].why : "", /about 3p, under your 10p minimum/);
});

test("plan: listings orbiter can't count are left alone, never removed as 'you hold none'", () => {
  const extra: MarketItem[] = [
    // A set whose parts orbiter doesn't know (newest Prime Access, a collar set).
    { id: "kav", slug: "kavasa_prime_kubrow_collar_set", gameRef: "/Skins/Collar", name: "Kavasa Prime Kubrow Collar Set", maxRank: null, subtypes: null, tags: ["prime", "set"] },
    // A mod under another path on the market than in the game (…SPMod vs …SPSubMod).
    { id: "gal", slug: "galvanized_reflex", gameRef: "/M/ReflexSPSubMod", name: "Galvanized Reflex", maxRank: 10, subtypes: null, tags: ["mod"] },
  ];
  const withGal = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/ReflexSPMod", "Galvanized Reflex", "mod", 3, { rank: 10 })]));
  const c = { ...ctx(withGal, [order("k", "kav", 1, 80), order("g", "gal", 1, 40, 10)], {}), index: indexItems([...items, ...extra]) };
  const plan = bulkPlan(c, only({ sets: true, mods: true }), []);
  assert.deepEqual(plan, [], "the collar set is unknown and the Galvanized Reflex is found by name (3 held: one to sell)");
});

test("limit: over warframe.market's cap, the listings worth the most platinum win", () => {
  const m = buildModel(bundle([...rhino(3), inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 3)]));
  const rules = only({ sets: true, mods: true });
  const books = { rhino_prime_set: [seller(55)], serration: [seller(14, 0)] };
  // Room for one: the sets (2 × 55p) beat the mods (3 × 14p).
  const plan = bulkPlan(ctx(m, [], books, { limit: 1 }), rules, sellTargets(m, rules, defaultAdvice()));
  assert.deepEqual(plan.filter((a) => a.type === "create").map((a) => a.type === "create" && a.item.name), ["Rhino Prime Set"]);
  const left = plan.find((a) => a.type === "skip")!;
  assert.equal(left.type === "skip" && [left.name, left.why].join("|"), `Serration|${LIMIT_WHY}`);
});

test("limit: a cheaper listing of yours makes way; left-alone and hidden ones only take a slot", () => {
  const m = buildModel(bundle([...rhino(3), inv("/M/Thumper", "Thumper", "mod", 5)]));
  const rules = only({ sets: true, mods: true });
  const books = { rhino_prime_set: [seller(55)] };
  // A Thumper listing you made (ticked category, 1 × 12p) gives way to the sets.
  const swap = bulkPlan(ctx(m, [order("thu1", "thu", 1, 12, 0)], books, { limit: 1 }), rules, sellTargets(m, rules, defaultAdvice()));
  assert.deepEqual(swap.map((a) => a.type).sort(), ["create", "remove"]);
  assert.match(swap.find((a) => a.type === "remove")!.type === "remove" ? (swap.find((a) => a.type === "remove") as { why: string }).why : "", /Makes room/);
  // Left alone: it keeps its slot, so there's no room for the sets.
  const held = bulkPlan(ctx(m, [order("thu1", "thu", 1, 12, 0)], books, { limit: 1, paused: { "thu|0|": true } }), rules, sellTargets(m, rules, defaultAdvice()));
  assert.deepEqual(held.map((a) => a.type), ["skip"]);
  // Buy orders count too.
  const buys = bulkPlan(ctx(m, [], books, { limit: 1, otherOrders: 1 }), rules, sellTargets(m, rules, defaultAdvice()));
  assert.deepEqual(buys.map((a) => a.type), ["skip"]);
});

test("mods: your own copy and one to give away are always kept", () => {
  const rules = only({ mods: true });
  const two = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 2)]));
  assert.deepEqual(sellTargets(two, rules, defaultAdvice()), [], "two unranked copies: one to use, one to give");
  // A listing you made for a copy orbiter would keep is yours to make: it stays, and the plan says so.
  const own = bulkPlan(ctx(two, [order("kept", "ser", 1, 20, 0)], {}), rules, []);
  assert.equal(own.length, 1);
  assert.equal(own[0].type === "skip" && own[0].why, "Your own copy and one to give away would be kept: left as you listed it");
  const three = buildModel(bundle([inv("/M/Serration", "Serration", "mod", 1, { rank: 10 }), inv("/M/Serration", "Serration", "mod", 3)]));
  const left = bulkPlan(ctx(three, [order("r0", "ser", 3, 20, 0), order("r10", "ser", 1, 60, 10)], {}), rules, []);
  assert.deepEqual(left.map((a) => a.type), ["skip", "skip"], "both held: neither comes down nor shrinks");
  // More listed than you hold: lowered to what you can deliver, whatever the keep rules say.
  const over = bulkPlan(ctx(three, [order("r0", "ser", 5, 20, 0)], {}), rules, []);
  assert.equal(over.length, 1);
  assert.equal(over[0].type === "update" && [over[0].quantity, over[0].why].join("|"), "3|You hold 3 now");
});

test("plan: your own set, part and arcane listings for copies orbiter would keep stay up, said in the plan", () => {
  const rules = only({ sets: true, parts: true, arcanes: true });
  // One Rhino set, not built or mastered: it's the one orbiter keeps to build. Your listing stays.
  const one = buildModel(bundle(rhino(1)));
  const setPlan = bulkPlan(ctx(one, [order("s", "set", 1, 60)], {}), only({ sets: true }), sellTargets(one, only({ sets: true }), defaultAdvice()));
  assert.deepEqual(setPlan.map((a) => a.type === "skip" && a.why), ["One set to build and master would be kept: left as you listed it"]);
  // Your only maxed Energize is the one orbiter keeps; your listing for it stays.
  const maxed = buildModel(bundle([inv("/A/Energize", "Arcane Energize", "arcane", 1, { rank: 5 })]));
  const arc = bulkPlan(ctx(maxed, [order("a", "ene", 1, 150, 5)], {}), rules, []);
  assert.deepEqual(arc.map((a) => a.type === "skip" && [a.name, a.rank, a.why].join("|")), ["Arcane Energize|5|Your maxed copy would be kept: left as you listed it"]);
  // Unranked copies toward a maxed one: same.
  const toward = buildModel(bundle([inv("/A/Energize", "Arcane Energize", "arcane", 9)]));
  const tw = bulkPlan(ctx(toward, [order("a0", "ene", 3, 9, 0)], {}), rules, []);
  assert.deepEqual(tw.map((a) => a.type), ["skip"]);
  assert.match(tw[0].type === "skip" ? tw[0].why : "", /toward a maxed one .*left as you listed it/);
  // Listed two, hold one: lowered to the one you can deliver.
  const lower = bulkPlan(ctx(maxed, [order("a", "ene", 2, 150, 5)], {}), rules, []);
  assert.equal(lower.length, 1);
  assert.equal(lower[0].type === "update" && lower[0].quantity, 1);
  // Once the frame is mastered nothing is kept: the listing stays.
  const done = buildModel(bundle([...rhino(1), inv(RHINO, "Rhino Prime", "warframe", 0, { mastered: true })]));
  assert.deepEqual(bulkPlan(ctx(done, [order("s", "set", 1, 60)], {}), only({ sets: true }), []), []);
});

test("ducats: a set or part worth more to you as ducats isn't sold, and your listing of it comes down", () => {
  const m = buildModel(bundle([...rhino(2), inv(RHINO, "Rhino Prime", "warframe", 1, { mastered: true })]));
  // At 0.5p a ducat the set's 145 ducats are ~72p to you, more than its 60p.
  const advice = { ...defaultAdvice(), platPerDucat: 0.5 };
  const rules = only({ sets: true, parts: true, partsKeep: 0 });
  const targets = sellTargets(m, rules, advice);
  const set = targets.find((t) => t.name === "Rhino Prime Set");
  assert.ok(set?.hold?.takeDown);
  assert.match(set!.hold!.why, /145 ducats are ~72.5p to you, it sells for 60p/);
  const plan = bulkPlan(ctx(m, [order("s1", "set", 2, 60)], {}, { advice }), rules, targets);
  const gone = plan.find((a) => a.type === "remove");
  assert.ok(gone && gone.type === "remove" && gone.order.id === "s1" && /Worth more as ducats/.test(gone.why));
  assert.ok(!plan.some((a) => a.type === "create"), "nothing goes up for platinum that ducats beat");
  // At the usual 0.1p a ducat, platinum wins and the set is sold.
  assert.ok(!sellTargets(m, rules, defaultAdvice()).find((t) => t.name === "Rhino Prime Set")?.hold);
});

test("relics have their own minimum: a 5p relic goes up under a 10p minimum for everything else", () => {
  const m = buildModel(bundle([]));
  const relicItem: MarketItem = { id: "rel", slug: "lith_k1_relic", gameRef: "/Relic/K1", name: "Lith K1 Relic", maxRank: null, subtypes: ["intact", "exceptional", "flawless", "radiant"], tags: ["relic"] };
  const target = { kind: "other" as const, name: "Lith K1 Relic", unique: null, rank: null, subtype: "intact", quantity: 20, why: "20 held" };
  const c = (extra: Partial<BulkContext>) => ({ ...ctx(m, [], { lith_k1_relic: [{ ...seller(5), subtype: "intact" }] }), index: indexItems([...items, relicItem]), ...extra });
  const rules = only({ other: true });
  const without = bulkPlan(c({}), rules, [target]);
  assert.match(without[0].type === "skip" ? without[0].why : "", /under your 10p minimum/);
  const withRelicMin = bulkPlan(c({ minRelicPrice: 3 }), rules, [target]);
  assert.equal(withRelicMin[0].type === "create" && `${withRelicMin[0].quantity}@${withRelicMin[0].platinum}`, "20@5");
});
