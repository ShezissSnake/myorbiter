// Copies are counted once: an arcane's copies across its ranks, a set and the parts inside it, and
// the never-sell list across a set and its parts. The last check before a listing (listGuard.ts),
// the spares plan (bulk.ts) and the listing form (marketStore.svelte.ts) agree on each. Every
// market call is replaced; nothing reaches the network.
import "./support/runes";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildModel, type Model } from "../src/lib/core/model";
import { guardListing } from "../src/lib/core/listGuard";
import { bulkPlan, neverTest, sellTargets, toApply, type BulkAction } from "../src/lib/core/bulk";
import { indexItems, type BookOrder, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { defaultAdvice, defaultMarketSettings, market } from "../src/lib/backend";
import { defaultSellChoices } from "../src/lib/core/spares";
import { defaultSparesRules, withNeverSell, type SparesRules } from "../src/lib/core/sparesRules";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

globalThis.fetch = (() => {
  throw new Error("test: no network");
}) as never;
const { mkt } = await import("../src/lib/marketStore.svelte");

const NOW = Date.now();
const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const cat = (uniqueName: string, name: string, category: string, extra: Partial<CatalogItem> = {}) => ({ uniqueName, name, category, ...extra }) as CatalogItem;
const order = (id: string, itemId: string, quantity: number, platinum: number, rank: number | null = null, visible = true): MyOrder => ({
  id, itemId, type: "sell", platinum, quantity, rank, subtype: null, visible, updatedAt: null,
});
const real = { ...market };

beforeEach(() => {
  Object.assign(market, real);
  mkt.account = { linked: true, backing: "keyring", profile: { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true }, error: null } as never;
  mkt.orders = [];
  mkt.log = [];
  mkt.op = null;
  mkt.error = null;
  mkt.draft = null;
  mkt.draftError = null;
  mkt.advice = defaultAdvice();
  mkt.fullMode = null;
});

// ------------------------------------------------------------------ an arcane across its ranks

const ARC = "/Lotus/Upgrades/CosmeticEnhancers/Utility/HealthRegenOnDamage";
const LATO = "/Lotus/Weapons/Tenno/Pistol/LatoPrime";
// 1 maxed copy (21 copies' worth) and 21 unranked: 42 copies, two whole maxed arcanes, one kept.
const arcaneBundle: Bundle = {
  observed_at: Math.floor(NOW / 1000) - 600,
  inventory: [
    inv(ARC, "Arcane Energize", "arcane", 21),
    inv(`${ARC}#5`, "Arcane Energize", "arcane", 1, { rank: 5, max_rank: 5 }),
    inv(LATO, "Lato Prime", "weapon", 1, { mastered: true }),
  ],
  catalog: [cat(ARC, "Arcane Energize", "Arcanes", { maxRank: 5, tradable: true, rarity: "Legendary" }), cat(LATO, "Lato Prime", "Secondary", { masterable: true })],
  relics: [],
  prices: { prices: { "Arcane Energize": 10 }, max_rank_prices: { "Arcane Energize": 200 }, trade_rate: {} },
} as Bundle;
const energize: MarketItem = { id: "energize", slug: "arcane_energize", gameRef: ARC, name: "Arcane Energize", maxRank: 5, subtypes: null, tags: ["arcane_enhancement"] };
const arcaneCtx = () => ({ model: buildModel(arcaneBundle), index: indexItems([energize]), sell: defaultSellChoices(), advice: defaultAdvice(), now: NOW });

test("arcane: with all 21 unranked copies listed, the maxed one kept is refused at max rank", () => {
  const c = arcaneCtx();
  // The 21 unranked alone pass: they are the spare beyond the kept maxed copy.
  assert.equal(guardListing(c, { item: energize, rank: 0, subtype: null, quantity: 21, platinum: 10, listedElsewhere: 0 }).ok, true);
  const listed = [order("u", "energize", 21, 10, 0)];
  for (const manual of [false, true]) {
    const g = guardListing(c, { item: energize, rank: 5, subtype: null, quantity: 1, platinum: 200, listedElsewhere: 0, listed, manual });
    assert.equal(g.ok, false, `manual ${manual}: guard passed: ${g.ok ? g.audit : ""}`);
    assert.match(!g.ok ? g.why : "", /21 at R0 listed at another rank/);
  }
});

test("arcane: with the spare maxed one listed, the unranked copies are refused (the same copies)", () => {
  const c = arcaneCtx();
  assert.equal(guardListing(c, { item: energize, rank: 5, subtype: null, quantity: 1, platinum: 200 }).ok, true, "one whole maxed arcane beyond the kept one");
  const g = guardListing(c, { item: energize, rank: 0, subtype: null, quantity: 1, platinum: 10, listed: [order("m", "energize", 1, 200, 5)] });
  assert.equal(g.ok, false, `guard passed: ${g.ok ? g.audit : ""}`);
  // Across all ranks: listed plus offered never exceeds held less kept (42 - 21 = 21 copies).
  const half = guardListing(c, { item: energize, rank: 0, subtype: null, quantity: 11, platinum: 10, listed: [order("u", "energize", 10, 10, 0)] });
  assert.equal(half.ok, true, "10 + 11 unranked are the 21 spare");
  assert.equal(guardListing(c, { item: energize, rank: 0, subtype: null, quantity: 12, platinum: 10, listedElsewhere: 10, listed: [order("u", "energize", 10, 10, 0)] }).ok, false);
});

test("arcane: a rank in between draws on the same pool, and its listings count against the other ranks", () => {
  // 21 unranked, 2 at rank 3 (10 copies each) and 1 maxed (21): 62 copies, 41 beyond the kept maxed one.
  const bundle = { ...arcaneBundle, inventory: [...arcaneBundle.inventory, inv(`${ARC}#3`, "Arcane Energize", "arcane", 2, { rank: 3, max_rank: 5 })] } as Bundle;
  const c = { ...arcaneCtx(), model: buildModel(bundle) };
  const at = (rank: number, quantity: number, listed: MyOrder[] = []) => guardListing(c, { item: energize, rank, subtype: null, quantity, platinum: 50, listed });
  assert.equal(at(3, 2).ok, true, "both held at rank 3");
  assert.equal(at(3, 3).ok, false, "only 2 held at rank 3");
  assert.equal(at(3, 2, [order("u", "energize", 21, 10, 0)]).ok, true, "41 - 21 leaves 20: two at rank 3");
  const g = at(3, 1, [order("u", "energize", 21, 10, 0), order("m", "energize", 1, 200, 5)]);
  assert.equal(g.ok, false, "41 - 21 - 21 leaves none");
  assert.match(!g.ok ? g.why : "", /21 at R0 and 1 at R5 listed at another rank/);
  assert.equal(at(0, 21, [order("t", "energize", 2, 50, 3)]).ok, true, "41 - 20 leaves 21 unranked");
  assert.equal(at(0, 1, [order("t", "energize", 2, 50, 3), order("m", "energize", 1, 200, 5)]).ok, false, "41 - 20 - 21 leaves none");
  // Short of one maxed arcane, nothing at rank 3 is spare.
  const short = { ...arcaneCtx(), model: buildModel({ ...arcaneBundle, inventory: [inv(`${ARC}#3`, "Arcane Energize", "arcane", 2, { rank: 3, max_rank: 5 }), arcaneBundle.inventory[2]] } as Bundle) };
  const s = guardListing(short, { item: energize, rank: 3, subtype: null, quantity: 1, platinum: 50 });
  assert.match(!s.ok ? s.why : "", /The copies toward a maxed one \(20\/21\) are kept/);
});

test("arcane: the listing form doesn't list the kept maxed copy while 21 unranked are up", async () => {
  const created: unknown[] = [];
  market.create = (async (o: unknown) => {
    created.push(o);
    return {} as never;
  }) as never;
  market.myOrders = async () => [];
  mkt.items = [energize];
  mkt.rules = { ...defaultMarketSettings(), minPrice: 1 };
  mkt.model = buildModel(arcaneBundle);
  mkt.orders = [order("u", "energize", 21, 10, 0)];
  mkt.draft = {
    itemId: "energize", name: "Arcane Energize", slug: "arcane_energize", platinum: 200, quantity: 1, rank: 5, subtype: null, maxRank: 5, subtypes: null,
    available: 1, priced: true, inGame: 0, ladder: [], addToExisting: true, held: [], asked: { rank: 5, subtype: null, available: 1 },
  };
  await mkt.submitDraft();
  assert.deepEqual(created, [], "a listing for the maxed copy was sent");
});

// ------------------------------------------------------------------ a set and its parts

const BRONCO = "/Lotus/Weapons/Tenno/Pistol/BroncoPrime";
const B_BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeBarrel";
const B_BP = "/Lotus/Types/Recipes/Weapons/BroncoPrimeBlueprint";
const B_RECEIVER = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeReceiver";
const PARTS = [
  [B_BARREL, "Bronco Prime Barrel", "barrel"],
  [B_BP, "Bronco Prime Blueprint", "blueprint"],
  [B_RECEIVER, "Bronco Prime Receiver", "receiver"],
] as const;
/** The Bronco Prime built and mastered, and `n` of each part (`barrels` of the barrel). */
const broncoModel = (n = 2, barrels = n): Model =>
  buildModel({
    observed_at: Math.floor(NOW / 1000) - 600,
    inventory: [
      ...PARTS.map(([u, name]) => inv(u, name, "prime_part", u === B_BARREL ? barrels : n)),
      inv(BRONCO, "Bronco Prime", "weapon", 1, { mastered: true }),
      inv(LATO, "Lato Prime", "weapon", 1, { mastered: true }),
    ],
    catalog: [
      cat(BRONCO, "Bronco Prime", "Secondary", {
        masterable: true, isPrime: true,
        components: [
          { uniqueName: B_BARREL, name: "Barrel", ducats: 45, itemCount: 1 },
          { uniqueName: B_BP, name: "Blueprint", ducats: 15, itemCount: 1 },
          { uniqueName: "/Lotus/Types/Items/MiscItems/OrokinCell", name: "Orokin Cell", itemCount: 10 },
          { uniqueName: B_RECEIVER, name: "Receiver", ducats: 15, itemCount: 1 },
        ],
      } as Partial<CatalogItem>),
      cat(LATO, "Lato Prime", "Secondary", { masterable: true }),
    ],
    relics: [],
    prices: {
      prices: { "Bronco Prime Set": 30, ...Object.fromEntries(PARTS.map(([, name]) => [name, 20])) },
      max_rank_prices: {},
      trade_rate: { "Bronco Prime Set": [5, 0, ""], ...Object.fromEntries(PARTS.map(([, name]) => [name, [5, 0, ""]])) },
    },
  } as unknown as Bundle);
const set: MarketItem = { id: "bronco", slug: "bronco_prime_set", gameRef: BRONCO, name: "Bronco Prime Set", maxRank: null, subtypes: null, tags: ["weapon", "prime", "set", "secondary"] };
const parts: MarketItem[] = PARTS.map(([u, name, id]) => ({ id, slug: name.toLowerCase().replace(/ /g, "_"), gameRef: u, name, maxRank: null, subtypes: null, tags: ["weapon", "prime", "component", "secondary"] }));
const barrel = parts[0];
const broncoIndex = indexItems([set, ...parts]);
const broncoCtx = (m = broncoModel(), rules?: SparesRules) => ({ model: m, index: broncoIndex, sell: defaultSellChoices(), advice: defaultAdvice(), now: NOW, rules });

test("set: with both sets listed, the barrels inside them are refused as parts", () => {
  const c = broncoCtx();
  const listed = [order("s", "bronco", 2, 30)];
  for (const manual of [false, true]) {
    const g = guardListing(c, { item: barrel, rank: null, subtype: null, quantity: 1, platinum: 20, listedElsewhere: 0, listed, manual });
    assert.equal(g.ok, false, `manual ${manual}: guard passed: ${g.ok ? g.audit : ""}`);
    assert.match(!g.ok ? g.why : "", /2 inside your Bronco Prime Set listing/);
  }
  // A third barrel, loose beyond the two sets, can go.
  assert.equal(guardListing(broncoCtx(broncoModel(2, 3)), { item: barrel, rank: null, subtype: null, quantity: 1, platinum: 20, listed }).ok, true);
  assert.equal(guardListing(broncoCtx(broncoModel(2, 3)), { item: barrel, rank: null, subtype: null, quantity: 2, platinum: 20, listed }).ok, false);
});

test("set: with barrels listed on their own, fewer sets can be made and the rest are refused", () => {
  const c = broncoCtx();
  assert.equal(guardListing(c, { item: set, rank: null, subtype: null, quantity: 2, platinum: 30 }).ok, true);
  const one = [order("b", "barrel", 1, 20)];
  assert.equal(guardListing(c, { item: set, rank: null, subtype: null, quantity: 1, platinum: 30, listed: one }).ok, true);
  const g = guardListing(c, { item: set, rank: null, subtype: null, quantity: 2, platinum: 30, listed: one });
  assert.equal(g.ok, false, `guard passed: ${g.ok ? g.audit : ""}`);
  assert.match(!g.ok ? g.why : "", /Only 1 can go \(2 held, 2 spare, 1 Bronco Prime Barrel listed on its own\)/);
  // A barrel beyond the sets (three held) is the one listed: both sets can still go.
  assert.equal(guardListing(broncoCtx(broncoModel(2, 3)), { item: set, rank: null, subtype: null, quantity: 2, platinum: 30, listed: one }).ok, true);
});

test("set: the listing form doesn't list the barrels inside two listed sets", async () => {
  const created: unknown[] = [];
  market.create = (async (o: unknown) => {
    created.push(o);
    return {} as never;
  }) as never;
  market.myOrders = async () => [];
  mkt.items = [set, ...parts];
  mkt.rules = { ...defaultMarketSettings(), minPrice: 1 };
  mkt.model = broncoModel();
  mkt.orders = [order("s", "bronco", 2, 30)];
  mkt.draft = {
    itemId: "barrel", name: "Bronco Prime Barrel", slug: "bronco_prime_barrel", platinum: 20, quantity: 2, rank: null, subtype: null, maxRank: null, subtypes: null,
    available: 2, priced: true, inGame: 0, ladder: [], addToExisting: true, held: [], asked: { rank: null, subtype: null, available: 2 },
  };
  await mkt.submitDraft();
  assert.deepEqual(created, [], `sent; log: ${mkt.log.map((l) => l.text).join(" / ")}`);
});

const seller = (platinum: number): BookOrder => ({
  id: `b${platinum}`, type: "sell", platinum, quantity: 1, rank: null, subtype: null, visible: true,
  user: { id: `u${platinum}`, ingameName: `Seller${platinum}`, status: "ingame", platform: "pc", crossplay: true },
});
const books = Object.fromEntries([set, ...parts].map((it) => [it.slug, [seller(it === set ? 30 : 20)]]));
const advice = { ...defaultAdvice(), platPerDucat: 0.1 };
const sellAs = (as: "sets" | "parts" | "setsFirst", never: SparesRules["neverSell"] = []): SparesRules => {
  const r = defaultSparesRules();
  return { ...r, prime: { ...r.prime, on: true, sellAs: as }, neverSell: never };
};
const planFor = (m: Model, rules: SparesRules, orders: MyOrder[]) =>
  bulkPlan(
    { model: m, index: broncoIndex, orders, me: { id: "me", platform: "pc", crossplay: true }, books, minPrice: 1, minShare: 0, floors: {}, paused: {}, sell: defaultSellChoices(), advice },
    rules,
    sellTargets(m, rules, advice, broncoIndex, defaultSellChoices()),
  );
const creates = (a: BulkAction[]) => a.flatMap((x) => (x.type === "create" ? [`${x.item.id} ${x.quantity}`] : x.type === "update" && x.quantity > x.order.quantity ? [`${x.item.id} +${x.quantity - x.order.quantity}`] : []));
/** Every create and raise the plan makes, sent in its order, passes the last check against the listings as they then are. */
function guardAgrees(m: Model, rules: SparesRules, orders: MyOrder[], actions: BulkAction[]) {
  const live = orders.map((o) => ({ ...o }));
  for (const a of actions) {
    if (a.type === "remove") live.splice(live.findIndex((o) => o.id === a.order.id), 1);
    if (a.type !== "create" && a.type !== "update") continue;
    const except = a.type === "update" ? a.order.id : null;
    const others = live.filter((o) => o.id !== except);
    const same = others.filter((o) => o.itemId === a.item.id).reduce((n, o) => n + o.quantity, 0);
    if (a.type === "create" || a.quantity > a.order.quantity) {
      const g = guardListing(broncoCtx(m, rules), { item: a.item, rank: null, subtype: null, quantity: a.quantity, platinum: a.platinum, listedElsewhere: same, listed: others });
      assert.equal(g.ok, true, `${a.item.name}: ${g.ok ? "" : g.why}`);
    }
    if (a.type === "create") live.push(order(`new-${a.item.id}`, a.item.id, a.quantity, a.platinum));
    else live.splice(live.findIndex((o) => o.id === a.order.id), 1, { ...a.order, quantity: a.quantity });
  }
}

test("plan, parts only: copies inside a set listed by hand aren't listed again as parts", () => {
  const m = broncoModel(2, 3);
  const orders = [order("s", "bronco", 2, 30)];
  const actions = planFor(m, sellAs("parts"), orders);
  assert.deepEqual(creates(actions), ["barrel 1"], "only the barrel beyond the two listed sets");
  const twice = actions.filter((a) => a.type === "skip" && a.rule === "plan.twice").map((a) => a.why);
  assert.equal(twice.length, 2, "the blueprint and receiver say why they're out");
  assert.match(twice[0], /2 inside your Bronco Prime Set listing/);
  guardAgrees(m, sellAs("parts"), orders, actions);
});

test("plan, sets: barrels listed by hand on their own leave fewer sets to make", () => {
  const m = broncoModel(2);
  const orders = [order("b", "barrel", 1, 20)];
  const actions = planFor(m, sellAs("sets"), orders);
  assert.deepEqual(creates(actions), ["bronco 1"]);
  guardAgrees(m, sellAs("sets"), orders, actions);
});

test("plan, sets first: the sets and the loose parts it lists all pass the last check, in the order sent", () => {
  const m = broncoModel(2, 3);
  for (const orders of [[], [order("s", "bronco", 1, 30)], [order("b", "barrel", 1, 20)]]) {
    const actions = planFor(m, sellAs("setsFirst"), orders);
    assert.ok(creates(actions).length > 0);
    guardAgrees(m, sellAs("setsFirst"), orders, actions);
  }
});

// ------------------------------------------------------------------ never-sell across a set

const neverBarrel = [{ id: "barrel", name: "Bronco Prime Barrel", cat: "prime" as const }];
const neverSet = [{ id: "bronco", name: "Bronco Prime Set", cat: "prime" as const }];

test("never sell: a part on the list holds back the set it goes into, and the plan says why", () => {
  const m = broncoModel(2);
  const rules = sellAs("sets", neverBarrel);
  const t = sellTargets(m, rules, advice, broncoIndex, defaultSellChoices()).find((x) => x.name === "Bronco Prime Set");
  assert.ok(t?.hold, `set target not held: ${JSON.stringify(t)}`);
  assert.equal(t.hold.why, "Bronco Prime Barrel is on your never-sell list (Sell spares): a set with it inside isn't sold either");
  const actions = planFor(m, rules, []);
  assert.deepEqual(creates(actions), []);
  assert.ok(actions.some((a) => a.type === "skip" && a.rule === "never" && /Bronco Prime Barrel is on your never-sell list/.test(a.why)));
});

test("never sell: a set on the list holds back its parts", () => {
  const m = broncoModel(2);
  const rules = sellAs("parts", neverSet);
  const held = sellTargets(m, rules, advice, broncoIndex, defaultSellChoices()).filter((x) => x.kind === "part");
  assert.equal(held.length, 3);
  for (const t of held) assert.equal(t.hold?.why, "Bronco Prime Set is on your never-sell list (Sell spares): its parts aren't sold on their own either");
  assert.deepEqual(creates(planFor(m, rules, [])), []);
});

test("never sell across a set: a part put on the list while the plan is looked over drops its set's line from what Apply sends", () => {
  const m = broncoModel(2);
  const actions = planFor(m, sellAs("sets"), []);
  assert.deepEqual(creates(actions), ["bronco 2"]);
  assert.equal(toApply(actions, new Set(), new Set(["barrel"])).filter((a) => a.type === "create").length, 1, "by item id alone the set still goes");
  assert.deepEqual(toApply(actions, new Set(), neverTest({ neverSell: neverBarrel }, m, broncoIndex)).filter((a) => a.type === "create"), []);
});

test("never sell across a set: the last check refuses both ways, whoever asks", () => {
  const m = broncoModel(2);
  for (const manual of [false, true]) {
    const s = guardListing(broncoCtx(m, withNeverSell(defaultSparesRules(), neverBarrel[0])), { item: set, rank: null, subtype: null, quantity: 1, platinum: 30, manual });
    assert.match(!s.ok ? s.why : "", /^Didn't list Bronco Prime Set: Bronco Prime Barrel is on your never-sell list \(Sell spares\)/);
    const b = guardListing(broncoCtx(m, withNeverSell(defaultSparesRules(), neverSet[0])), { item: barrel, rank: null, subtype: null, quantity: 1, platinum: 20, manual });
    assert.match(!b.ok ? b.why : "", /^Didn't list Bronco Prime Barrel: Bronco Prime Set is on your never-sell list \(Sell spares\)/);
  }
  // Before any inventory read (a console), the names still tell a set's parts.
  const none = buildModel({ observed_at: null, inventory: [], catalog: [], relics: [], prices: null } as unknown as Bundle);
  const g = guardListing({ ...broncoCtx(none, withNeverSell(defaultSparesRules(), neverBarrel[0])) }, { item: set, rank: null, subtype: null, quantity: 1, platinum: 30, manual: true });
  assert.equal(g.ok, false);
});

test("never sell across a set: a hidden set listing isn't shown again while its barrel is on the list", async () => {
  const sent: unknown[] = [];
  market.update = (async (id: string, c: unknown) => {
    sent.push([id, c]);
    return {} as never;
  }) as never;
  market.myOrders = async () => [];
  mkt.items = [set, ...parts];
  const rules = { ...defaultMarketSettings(), minPrice: 1 };
  rules.spares = withNeverSell(rules.spares, neverBarrel[0]);
  mkt.rules = rules;
  mkt.model = broncoModel(2);
  const hidden = order("s", "bronco", 1, 30, null, false);
  mkt.orders = [hidden];
  assert.deepEqual(await mkt.setShown([hidden], true), []);
  assert.deepEqual(sent, []);
});
