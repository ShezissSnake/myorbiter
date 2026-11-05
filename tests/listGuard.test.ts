// Regression tests for three listings the spares plan made that the keep rules should have stopped:
// a Bronco Prime Set at 5p (worth more as ducats), a Bleeding Willow stance held once (the other
// copies installed in builds), and Requiem mods held fewer than five with Kuva weapons left. The
// models are shaped like a real account's read (paths, ranks, prices and trade counts as
// TennoScope and warframe.market give them); the player is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { bulkPlan, sellTargets, type BulkContext, type BulkRules } from "../src/lib/core/bulk";
import { guardListing, inventoryTrust, MAX_INVENTORY_AGE_MS } from "../src/lib/core/listGuard";
import { indexItems, type BookOrder, type MarketItem, type MyOrder } from "../src/lib/core/market";
import { modRows, setRows } from "../src/lib/core/views";
import { defaultAdvice } from "../src/lib/backend";
import { defaultSellChoices } from "../src/lib/core/spares";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const NOW = Date.UTC(2026, 10, 4, 8, 0, 0);
const inv = (item_id: string, name: string, category: string, quantity: number, extra: Partial<InventoryRow> = {}): InventoryRow => ({
  item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra,
});
const cat = (uniqueName: string, name: string, category: string, extra: Partial<CatalogItem> = {}) => ({ uniqueName, name, category, ...extra }) as CatalogItem;

const KHRA = "/Lotus/Upgrades/Mods/Immortal/ImmortalEightMod";
const JAHU = "/Lotus/Upgrades/Mods/Immortal/ImmortalThreeMod";
const WILLOW = "/Lotus/Weapons/Tenno/Melee/MeleeTrees/PolearmCmbTwoMeleeTree";
const BRONCO = "/Lotus/Weapons/Tenno/Pistol/BroncoPrime";
const B_BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeBarrel";
const B_BP = "/Lotus/Types/Recipes/Weapons/BroncoPrimeBlueprint";
const B_RECEIVER = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeReceiver";
const LATO = "/Lotus/Weapons/Tenno/Pistol/LatoPrime";

// Kuva and Tenet weapons: the account has mastered a few of them (9 of 37 in the read this follows).
const KUVA = ["Kuva Bramma", "Kuva Brakk", "Kuva Nukor", "Kuva Ogris", "Kuva Zarr", "Tenet Livia", "Tenet Glaxion", "Tenet Arca Plasmor"];
const kuvaPath = (n: string) => `/Lotus/Weapons/Lich/${n.replace(/ /g, "")}`;
const MASTERED_KUVA = new Set(["Kuva Brakk", "Kuva Nukor", "Tenet Livia"]);

const catalog = (withLich = true): CatalogItem[] => [
  ...(withLich ? KUVA.map((n) => cat(kuvaPath(n), n, /Brakk|Nukor/.test(n) ? "Secondary" : n === "Tenet Livia" ? "Melee" : "Primary", { masterable: true })) : []),
  cat(KHRA, "Khra", "Mods", { maxRank: 3, tradable: false, rarity: "Rare" }),
  cat(JAHU, "Jahu", "Mods", { maxRank: 3, tradable: false, rarity: "Rare" }),
  cat(WILLOW, "Bleeding Willow", "Mods", { maxRank: 3, tradable: true, rarity: "Rare" }),
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
];

const prices: NonNullable<Bundle["prices"]> = {
  prices: { Khra: 9, Jahu: 9, "Bleeding Willow": 4, "Bronco Prime Set": 8, "Bronco Prime Barrel": 3, "Bronco Prime Blueprint": 3, "Bronco Prime Receiver": 3 },
  max_rank_prices: { Khra: 9, Jahu: 9, "Bleeding Willow": 10 },
  trade_rate: { Khra: [39.8, 22, ""], Jahu: [34.3, 22, ""], "Bleeding Willow": [7.4, 22, ""], "Bronco Prime Set": [40.1, 22, ""], "Bronco Prime Barrel": [30.3, 22, ""] },
};

/** An account's read: what it holds, plus the mastery rows (a mastered weapon held or not). */
const account = (held: InventoryRow[], opts: { observedAt?: number | null; lich?: boolean; mastery?: boolean } = {}): Bundle => ({
  observed_at: opts.observedAt === undefined ? Math.floor(NOW / 1000) - 600 : opts.observedAt,
  inventory: [
    ...held,
    ...(opts.mastery === false ? [] : [...MASTERED_KUVA].map((n) => inv(kuvaPath(n), n, "weapon", 0, { mastered: true }))),
    ...(opts.mastery === false ? [] : [inv(LATO, "Lato Prime", "weapon", 1, { mastered: true })]),
  ],
  catalog: catalog(opts.lich ?? true),
  relics: [],
  prices,
});

// The read: Khra 3 unranked and 1 at rank 2, Jahu 2 + 1, Bleeding Willow 6 unranked of which 5
// are installed on polearms, two Bronco Prime sets with the weapon built and mastered.
const khra = (unranked = 3, ranked = 1) => [inv(KHRA, "Khra", "mod", unranked), ...(ranked ? [inv(`${KHRA}#2`, "Khra", "mod", ranked, { rank: 2, max_rank: 3 })] : [])];
const jahu = [inv(JAHU, "Jahu", "mod", 2), inv(`${JAHU}#2`, "Jahu", "mod", 1, { rank: 2, max_rank: 3 })];
const willow = (n: number, equipped?: number) => [inv(WILLOW, "Bleeding Willow", "mod", n, equipped == null ? {} : { equipped })];
const bronco = (sets = 2) => [
  inv(B_BARREL, "Bronco Prime Barrel", "prime_part", sets),
  inv(B_BP, "Bronco Prime Blueprint", "prime_part", sets),
  inv(B_RECEIVER, "Bronco Prime Receiver", "prime_part", sets),
  inv(BRONCO, "Bronco Prime", "weapon", 1, { mastered: true }),
];

const items: MarketItem[] = [
  { id: "khra", slug: "khra", gameRef: KHRA, name: "Khra", maxRank: 3, subtypes: null, tags: ["mod", "rare", "parazon"] },
  { id: "jahu", slug: "jahu", gameRef: JAHU, name: "Jahu", maxRank: 3, subtypes: null, tags: ["mod", "rare", "parazon"] },
  { id: "willow", slug: "bleeding_willow", gameRef: WILLOW, name: "Bleeding Willow", maxRank: 3, subtypes: null, tags: ["mod", "rare", "stance", "polearms"] },
  { id: "bronco", slug: "bronco_prime_set", gameRef: BRONCO, name: "Bronco Prime Set", maxRank: null, subtypes: null, tags: ["weapon", "prime", "set", "secondary"] },
];
const byId = (id: string) => items.find((x) => x.id === id)!;
const index = indexItems(items);
const me = { id: "me", platform: "pc", crossplay: true };
const seller = (platinum: number, rank: number | null = null): BookOrder => ({
  id: `b${platinum}`, type: "sell", platinum, quantity: 1, rank, subtype: null, visible: true,
  user: { id: `u${platinum}`, ingameName: `Seller${platinum}`, status: "ingame", platform: "pc", crossplay: true },
});
const order = (id: string, itemId: string, quantity: number, platinum: number, rank: number | null = null): MyOrder => ({
  id, itemId, type: "sell", platinum, quantity, rank, subtype: null, visible: true, updatedAt: null,
});
const books = { khra: [seller(7, 0)], jahu: [seller(5, 0)], bleeding_willow: [seller(6, 0)], bronco_prime_set: [seller(5)] };

// The settings the bad listings were made with: every category, ten prime parts kept, "sells most
// often" under the 100-listing limit, 5p minimum (3p for relics), the default ducat rate.
const RULES: BulkRules = { sets: true, arcanes: true, mods: true, parts: true, partsKeep: 10, other: true, imprints: true, priority: "trades" };
const advice = defaultAdvice();
const ctx = (m: ReturnType<typeof buildModel>, orders: MyOrder[] = []): BulkContext => ({
  model: m, index, orders, me, books, minPrice: 5, minRelicPrice: 3, minShare: 0.5, floors: {}, paused: {}, sell: defaultSellChoices(), advice,
});
const plan = (m: ReturnType<typeof buildModel>, orders: MyOrder[] = []) => bulkPlan(ctx(m, orders), RULES, sellTargets(m, RULES, advice, index, defaultSellChoices()));
const created = (actions: ReturnType<typeof plan>) => actions.filter((a) => a.type === "create").map((a) => a.type === "create" && `${a.item.name}|${a.rank}|${a.quantity}@${a.platinum}`);
const guard = (m: ReturnType<typeof buildModel>, id: string, quantity: number, platinum: number, rank: number | null = null, extra: object = {}) =>
  guardListing({ model: m, index, sell: defaultSellChoices(), advice, now: NOW }, { item: byId(id), rank, subtype: null, quantity, platinum, ...extra });

// ------------------------------------------------------------------ Requiem mods

test("requiem: fewer than five with Kuva weapons left, none is listed, by the plan or the last check", () => {
  const m = buildModel(account([...khra(), ...jahu]));
  const khraRow = modRows(m).find((r) => r.name === "Khra")!;
  assert.equal(khraRow.extras, 0);
  assert.match(khraRow.keptFor ?? "", /5 kept for the 5 Kuva and Tenet weapons/);
  assert.deepEqual(created(plan(m)), [], "nothing goes up under the reported settings");
  const g = guard(m, "khra", 2, 7, 0);
  assert.equal(g.ok, false);
  assert.match(!g.ok ? g.why : "", /^Didn't list Khra R0: Requiem mods are kept while Kuva and Tenet weapons are left to master/);
});

test("requiem: an earlier orbiter's listing (two to a name, before the lich rule) comes down", () => {
  // Builds before the Requiem rule kept two of each mod, so Khra 4 → 2 listed, Jahu 3 → 1.
  const m = buildModel(account([...khra(), ...jahu]));
  const actions = plan(m, [order("old-khra", "khra", 2, 7, 0), order("old-jahu", "jahu", 1, 5, 0)]);
  const removed = actions.filter((a) => a.type === "remove").map((a) => a.type === "remove" && a.order.id).sort();
  assert.deepEqual(removed, ["old-jahu", "old-khra"]);
  assert.match(actions.find((a) => a.type === "remove")!.type === "remove" ? (actions.find((a) => a.type === "remove") as { why: string }).why : "", /Requiem mods are kept/);
});

test("requiem: over five, only the copies beyond five go; ranked copies count toward the five", () => {
  const m = buildModel(account(khra(6, 1)));
  assert.deepEqual(created(plan(m)), ["Khra|0|2@7"]);
  assert.equal(guard(m, "khra", 2, 7, 0).ok, true);
  assert.equal(guard(m, "khra", 3, 7, 0).ok, false, "never more than the proven two");
  assert.equal(guard(m, "khra", 1, 7, 0, { listedElsewhere: 2 }).ok, false, "two already up: nothing more");
});

test("requiem: without the lich weapons in the catalog every copy is kept, not none", () => {
  const m = buildModel(account(khra(6, 1), { lich: false }));
  assert.equal(modRows(m).find((r) => r.name === "Khra")!.extras, 0);
  assert.match(modRows(m).find((r) => r.name === "Khra")!.keptFor ?? "", /Every copy kept/);
  assert.deepEqual(created(plan(m)), []);
  assert.equal(guard(m, "khra", 1, 7, 0).ok, false);
});

test("requiem: with no mastery in the read, the last check proves nothing spare", () => {
  const m = buildModel(account(khra(9, 0), { mastery: false }));
  const g = guard(m, "khra", 1, 7, 0);
  assert.equal(g.ok, false);
  assert.match(!g.ok ? g.why : "", /no mastery in it/);
});

// ------------------------------------------------------------------ Bleeding Willow

test("stance: one copy held, nothing is listed", () => {
  const m = buildModel(account(willow(1)));
  assert.deepEqual(created(plan(m)), []);
  const g = guard(m, "willow", 1, 6, 0);
  assert.equal(g.ok, false);
  assert.match(!g.ok ? g.why : "", /Your best copy and one to give away are kept \(1 held, 0 spare\)/);
});

test("stance: six held with five installed in builds is one loose copy, kept to give away", () => {
  const m = buildModel(account(willow(6, 5)));
  const row = modRows(m).find((r) => r.name === "Bleeding Willow")!;
  assert.deepEqual([row.total, row.extras], [6, 0]);
  assert.deepEqual(created(plan(m)), [], "the snapshot's 6 listed 4 when installed copies counted as loose");
  assert.equal(guard(m, "willow", 4, 6, 0).ok, false);
  // A listing made from the old count comes down.
  const actions = plan(m, [order("w", "willow", 4, 6, 0)]);
  assert.deepEqual(actions.map((a) => a.type), ["remove"]);
  assert.match(actions[0].type === "remove" ? actions[0].why : "", /5 installed in a build/);
  // Without the installed count (an older TennoScope), six unranked copies keep two as before.
  assert.deepEqual(created(plan(buildModel(account(willow(6))))), ["Bleeding Willow|0|4@6"]);
});

// ------------------------------------------------------------------ Bronco Prime Set

test("bronco: the set's ducats are all three parts' (45 + 15 + 15)", () => {
  const m = buildModel(account(bronco()));
  const row = setRows(m).find((r) => r.name === "Bronco Prime")!;
  assert.equal(row.ducats, 75, "the Barrel is 45 ducats, not the 25 an override once said");
  assert.equal(row.sellable, 2);
});

test("bronco: at the default 0.1p a ducat the set (75 ducats, ~7.5p) is kept for ducats, at 5p or 8p", () => {
  const m = buildModel(account(bronco()));
  const t = sellTargets(m, RULES, advice, index, defaultSellChoices()).find((x) => x.name === "Bronco Prime Set")!;
  assert.ok(t.hold?.takeDown, "the 8p median is too close to 7.5p of ducats");
  assert.match(t.hold!.why, /75 ducats are ~7.5p to you, it sells for 8p/);
  assert.deepEqual(created(plan(m)), []);
  // Your 5p listing of it comes down.
  const down = plan(m, [order("b", "bronco", 1, 5)]);
  assert.deepEqual(down.filter((a) => a.type === "remove").map((a) => a.type === "remove" && a.order.id), ["b"]);
  // And the last check refuses it whatever asked.
  const g = guard(m, "bronco", 1, 5);
  assert.equal(g.ok, false);
  assert.match(!g.ok ? g.why : "", /^Didn't list Bronco Prime Set: At 5p it's worth less than its ducats \(~7.5p to you at 0.1p a ducat; it needs 10p or more\)/);
});

test("bronco: a listing judged by its own price, not the median; clearly over its ducats it goes up", () => {
  const m = buildModel(account(bronco()));
  // A set that sells for 12p: 12p clears 7.5p by more than 2p.
  const priced = buildModel({ ...account(bronco()), prices: { ...prices, prices: { ...prices.prices, "Bronco Prime Set": 12 } } });
  const c = { ...ctx(priced), books: { ...books, bronco_prime_set: [seller(12)] } };
  const actions = bulkPlan(c, RULES, sellTargets(priced, RULES, advice, index, defaultSellChoices()));
  assert.deepEqual(created(actions), ["Bronco Prime Set|null|2@12"]);
  // An existing 9p listing, under the 10p that beats its ducats: comes down even with a 12p median.
  const down = bulkPlan({ ...ctx(priced, [order("b9", "bronco", 1, 9)]), books: {} }, { ...RULES, sets: true }, []);
  assert.deepEqual(down.filter((a) => a.type === "remove").map((a) => a.type === "remove" && a.order.id), ["b9"]);
  assert.equal(guard(m, "bronco", 1, 10).ok, true);
});

// ------------------------------------------------------------------ the inventory behind it

test("trust: no read, an empty read, no catalog, no mastery, or an old read prove nothing", () => {
  const ok = buildModel(account(khra(6, 1)));
  assert.deepEqual(inventoryTrust(ok, NOW), { ok: true });
  const none = buildModel({ observed_at: null, inventory: [], catalog: catalog(), relics: [], prices: null });
  assert.match((inventoryTrust(none, NOW, false) as { why: string }).why, /hasn't been read \(Full mode is off/);
  const noCatalog = buildModel({ ...account(khra(6, 1)), catalog: [] });
  assert.match((inventoryTrust(noCatalog, NOW) as { why: string }).why, /catalog/);
  const old = buildModel(account(khra(6, 1), { observedAt: Math.floor((NOW - MAX_INVENTORY_AGE_MS) / 1000) - 3600 }));
  assert.match((inventoryTrust(old, NOW) as { why: string }).why, /last read 4 hours ago: sync first/);
  const g = guard(old, "khra", 1, 7, 0);
  assert.match(!g.ok ? g.why : "", /^Didn't list Khra R0: Orbiter can't prove it's spare: your inventory was last read 4 hours ago/);
});

test("manual: the listing form still keeps the keep rules, but an old read doesn't stop it, and a console lists what you typed", () => {
  const old = buildModel(account(khra(6, 1), { observedAt: Math.floor(NOW / 1000) - 86_400 }));
  assert.equal(guard(old, "khra", 2, 7, 0, { manual: true }).ok, true);
  assert.equal(guard(old, "khra", 3, 7, 0, { manual: true }).ok, false);
  const consoleModel = buildModel({ observed_at: null, inventory: [], catalog: catalog(), relics: [], prices: null });
  const g = guard(consoleModel, "khra", 3, 7, 0, { manual: true });
  assert.equal(g.ok, true);
  assert.match(g.ok ? g.audit : "", /as asked \(no inventory read to check against\)/);
  assert.equal(guard(consoleModel, "khra", 3, 7, 0).ok, false, "but nothing goes up by itself");
});

test("audit: what a listing was proven spare by, for the log", () => {
  const m = buildModel(account(khra(6, 1)));
  const g = guard(m, "khra", 2, 7, 0);
  assert.equal(g.ok && g.audit, "Khra R0: 2 at 7p; 6 held, 2 spare; kept: 5 kept for the 5 Kuva and Tenet weapons you haven't mastered (Kuva Bramma, Kuva Ogris, Kuva Zarr and 2 more) (mod rule)");
});

test("one thing, one category: a second target for the same listing isn't planned twice", () => {
  const m = buildModel(account(khra(6, 1)));
  const targets = sellTargets(m, RULES, advice, index, defaultSellChoices());
  const twice = [...targets, { ...targets.find((t) => t.name === "Khra")!, kind: "other" as const }];
  const actions = bulkPlan(ctx(m), RULES, twice);
  assert.deepEqual(created(actions), ["Khra|0|2@7"]);
  assert.ok(actions.some((a) => a.type === "skip" && /Already counted under Mod/.test(a.why)));
});

// ------------------------------------------------------------------ what reaches the guard

test("price and count: no price, a fraction or nothing positive never goes up by itself, so the ducat check can't be skipped", () => {
  const m = buildModel(account(bronco()));
  for (const p of [null, NaN, 0, -5, 10.5] as (number | null)[]) {
    const g = guard(m, "bronco", 1, p as number);
    assert.equal(g.ok, false, `${p}p`);
  }
  assert.match((guard(m, "bronco", 1, null as unknown as number) as { why: string }).why, /: It has no price$/);
  assert.match((guard(m, "bronco", 1, 10.5) as { why: string }).why, /10\.5p isn't a price warframe\.market takes/);
  for (const q of [0.5, 1.5, Infinity]) assert.equal(guard(m, "bronco", q, 12).ok, false, `${q} copies`);
  // The edge itself: 10p is the first whole price that beats 75 ducats at 0.1p (7.5p + 2p).
  assert.equal(guard(m, "bronco", 1, 10).ok, true);
  assert.equal(guard(m, "bronco", 1, 9).ok, false);
  // The listing form may leave the price to warframe.market's own check.
  const khraModel = buildModel(account(khra(6, 1)));
  assert.equal(guard(khraModel, "khra", 1, null as unknown as number, 0, { manual: true }).ok, true);
});

test("trust: a read time ahead of the clock (a wrong unit, a wrong clock) or unreadable proves nothing", () => {
  const ahead = buildModel(account(khra(6, 1), { observedAt: Math.floor(NOW / 1000) + 30 * 86_400 }));
  assert.match((inventoryTrust(ahead, NOW) as { why: string }).why, /ahead of this PC's clock/);
  // Milliseconds where seconds belong: a read 56 000 years from now.
  const ms = buildModel(account(khra(6, 1), { observedAt: NOW }));
  assert.equal(guard(ms, "khra", 1, 7, 0).ok, false);
  // A few minutes ahead is a clock drifting, not a fault.
  const drift = buildModel(account(khra(6, 1), { observedAt: Math.floor(NOW / 1000) + 120 }));
  assert.deepEqual(inventoryTrust(drift, NOW), { ok: true });
  const nan = buildModel(account(khra(6, 1), { observedAt: NaN }));
  assert.equal(inventoryTrust(nan, NOW).ok, false);
});

test("trust: the 3-hour rule, at the edge", () => {
  const at = (ago: number) => buildModel(account(khra(6, 1), { observedAt: (NOW - ago) / 1000 }));
  assert.equal(inventoryTrust(at(MAX_INVENTORY_AGE_MS), NOW).ok, true, "exactly three hours is still fresh");
  assert.equal(inventoryTrust(at(MAX_INVENTORY_AGE_MS + 1000), NOW).ok, false);
  assert.equal(guard(at(MAX_INVENTORY_AGE_MS + 1000), "khra", 1, 7, 0, { manual: true }).ok, true, "the listing form isn't stopped by age");
});

test("already listed: a count that isn't a number refuses rather than lifting the cap", () => {
  const m = buildModel(account(khra(6, 1)));
  const g = guard(m, "khra", 2, 7, 0, { listedElsewhere: NaN });
  assert.match(!g.ok ? g.why : "", /couldn't be counted/);
  assert.equal(guard(m, "khra", 2, 7, 0, { listedElsewhere: 1 }).ok, false);
  assert.equal(guard(m, "khra", 1, 7, 0, { listedElsewhere: 1 }).ok, true);
});

test("never sell: refused whoever asks, the listing form and a console included", async () => {
  const { defaultSparesRules, withNeverSell } = await import("../src/lib/core/sparesRules");
  const rules = withNeverSell(defaultSparesRules(), { id: "khra", name: "Khra", cat: "mods" });
  const m = buildModel(account(khra(6, 1)));
  const consoleModel = buildModel({ observed_at: null, inventory: [], catalog: catalog(), relics: [], prices: null });
  for (const [model, manual] of [[m, false], [m, true], [consoleModel, true]] as const) {
    const g = guardListing({ model, index, sell: defaultSellChoices(), advice, now: NOW, rules }, { item: byId("khra"), rank: 0, subtype: null, quantity: 1, platinum: 7, manual });
    assert.match(!g.ok ? g.why : "", /never-sell list/);
  }
});

test("ducats: the floor a listing is held at always passes the ducat check, whatever the float error", async () => {
  const { aboveDucats, ducatsBeat, platToBeat } = await import("../src/lib/core/bulk");
  // 25 ducats at 1.1p is 27.500000000000004p; with the edge, 33.00000000000001p: the floor is 33.
  for (const [ducats, rate] of [[25, 1.1], [50, 0.55], [100, 1.1], [45, 0.1], [75, 0.1], [15, 0.3]]) {
    const worth = ducats * rate;
    const floor = aboveDucats(worth)!;
    assert.equal(ducatsBeat(floor, worth), false, `${ducats} ducats at ${rate}p: ${floor}p must be allowed`);
    assert.equal(ducatsBeat(floor - 1, worth), true, `${ducats} ducats at ${rate}p: ${floor - 1}p is too close`);
    assert.ok(floor >= platToBeat(worth) - 1e-6);
  }
});
