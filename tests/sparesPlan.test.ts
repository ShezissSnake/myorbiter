// Sell spares, each choice's effect on the plan, on the dev data (public/dev-bundle.json, the
// recipes and warframe.market's item list beside it: a long-played account's read). Skipped when
// the dev data isn't there. Each test changes one choice from the usual ones and looks at what
// the plan starts from (sellTargets), what it then does (bulkPlan), and the last check before a
// listing (listGuard), so a choice can't hold something back in one and let it through another.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildModel, type Model } from "../src/lib/core/model";
import {
  actionKey,
  bulkPlan,
  catOfTarget,
  modFamilyOf,
  planSignature,
  planTally,
  provenSpare,
  sellTargets,
  sparesPreview,
  toApply,
  type BulkContext,
  type BulkRules,
  type SellTarget,
} from "../src/lib/core/bulk";
import { guardListing } from "../src/lib/core/listGuard";
import { indexItems, type MarketIndex, type MarketItem } from "../src/lib/core/market";
import { defaultSellChoices } from "../src/lib/core/spares";
import { defaultAdvice, defaultSettings, lightSettings } from "../src/lib/backend";
import { arcaneRows } from "../src/lib/core/views";
import { defaultSparesRules, legacyRules, SPARE_CATEGORIES, sparesSettingsOf, withNeverSell, withoutNeverSell, type SpareCategory, type SparesRules } from "../src/lib/core/sparesRules";
import type { Bundle } from "../src/lib/core/types";

const at = (f: string) => new URL(`../public/${f}`, import.meta.url);
const have = ["dev-bundle.json", "dev-recipe-data.json", "dev-market-items.json"].every((f) => existsSync(at(f)));
const skip = !have && "the dev data (public/dev-*.json) isn't here: run `npm run dev-bundle` and `npm run dev-data`";
const read = (f: string) => JSON.parse(readFileSync(at(f), "utf8"));

const SUNIKA = "/Lotus/Types/Game/KubrowPet/HunterKubrowPetPowerSuit";
let cached: { bundle: Bundle; m: Model; index: MarketIndex; recipes: unknown } | null = null;
function dev() {
  if (cached) return cached;
  const bundle = read("dev-bundle.json") as Bundle;
  const recipes = read("dev-recipe-data.json");
  // Two Sunika imprints (TennoScope passes imprints apart from the bundle).
  const m = buildModel(bundle, undefined, null, null, [{ DominantTraits: { Personality: SUNIKA } }, { DominantTraits: { Personality: SUNIKA } }], recipes);
  return (cached = { bundle, m, index: indexItems(read("dev-market-items.json")), recipes });
}

const advice = defaultAdvice();
const sell = { ...defaultSellChoices(), veiledRivens: true };
const rules = (f: (r: SparesRules) => void = () => {}) => {
  const r = defaultSparesRules();
  // Every row ticked, so each test looks at its own row whatever the usual ones are.
  for (const c of SPARE_CATEGORIES) r[c].on = true;
  f(r);
  return r;
};
const targets = (r: SparesRules, m = dev().m, a = advice) => sellTargets(m, r, a, dev().index, sell);
const of = (ts: SellTarget[], cat: SpareCategory) => ts.filter((t) => catOfTarget(t) === cat);
const going = (ts: SellTarget[]) => ts.filter((t) => !t.hold);
const named = (ts: SellTarget[], name: string) => ts.filter((t) => t.name === name);
const count = (ts: SellTarget[]) => ts.reduce((n, t) => n + t.quantity, 0);
const item = (name: string): MarketItem => dev().index.byName.get(name.toLowerCase())!;
const nowOf = (m: Model) => +m.observedAt! + 10 * 60_000;
const guard = (r: SparesRules, name: string, rank: number | null, quantity: number, manual = false) =>
  guardListing({ model: dev().m, index: dev().index, sell, advice, rules: r, now: nowOf(dev().m) }, { item: item(name), rank, subtype: null, quantity, platinum: 50, manual });
const ctx = (m: Model, extra: Partial<BulkContext> = {}): BulkContext => ({
  model: m, index: dev().index, orders: [], me: { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true }, books: {},
  minPrice: 10, minRelicPrice: 3, minShare: 0.5, floors: {}, paused: {}, sell, advice, ...extra,
});

test("mods: Requiem and Antivirus keep their own number while lich weapons are left", { skip }, () => {
  const usual = of(targets(rules()), "mods");
  // Five of each kept: the account holds at most four of any Requiem mod.
  assert.equal(usual.filter((t) => t.family === "requiem").length, 0);
  const one = of(targets(rules((r) => (r.mods.families.requiem.keep = 1))), "mods").filter((t) => t.family === "requiem");
  assert.deepEqual(named(one, "Khra").map((t) => [t.quantity, t.ruleText]), [[3, "Requiem 1"]], "4 Khra, one kept");
  assert.ok(one.length >= 8, "every Requiem mod held twice or more gives one up");
  assert.ok(one.every((t) => /^\d+ copies: 1 kept for the \d+ Kuva and Tenet weapons/.test(t.why)), one[0]?.why);
  // Antivirus: Computer Cop held 15, five kept.
  assert.deepEqual(named(usual, "Computer Cop").map((t) => [t.quantity, t.ruleText]), [[10, "Antivirus 5"]]);
  assert.equal(count(named(of(targets(rules((r) => (r.mods.families.antivirus.keep = 8))), "mods"), "Computer Cop")), 7);
  assert.equal(of(targets(rules((r) => (r.mods.families.antivirus.on = false))), "mods").filter((t) => t.family === "antivirus").length, 0);
  // The last check counts the same: three Khra can go at a keep of 1, none at the usual 5.
  assert.equal(guard(rules((r) => (r.mods.families.requiem.keep = 1)), "Khra", 0, 3).ok, true);
  assert.equal(guard(rules(), "Khra", 0, 1).ok, false);
  assert.equal(provenSpare({ model: dev().m, index: dev().index, rules: rules((r) => (r.mods.families.requiem.keep = 1)) }, "mod", item("Khra"), 0, null)?.spare, 3);
});

test("mods: Primed off, stances by their own keep, every other mod by its own", { skip }, () => {
  const daily = rules((r) => (r.mods.dailyOnly = false));
  const all = of(targets(daily), "mods");
  assert.ok(all.some((t) => t.family === "primed") || all.every((t) => !/^Primed /.test(t.name)), "Primed mods are their own family");
  const noPrimed = of(targets(rules((r) => ((r.mods.dailyOnly = false), (r.mods.families.primed.on = false)))), "mods");
  assert.equal(noPrimed.filter((t) => /^Primed /.test(t.name)).length, 0);
  assert.equal(noPrimed.length, all.filter((t) => t.family !== "primed").length, "only Primed mods leave");

  const stances = (k: number) => of(targets(rules((r) => (r.mods.families.stance.keep = k))), "mods").filter((t) => t.family === "stance");
  assert.ok(stances(2).length > 0);
  // Two more kept of each stance: of one held unranked only, two fewer go.
  const cleaving = (k: number) => count(named(stances(k), "Cleaving Whirlwind"));
  assert.equal(cleaving(2) - cleaving(4), 2);
  assert.ok(count(stances(4)) < count(stances(2)));
  assert.ok(stances(2).every((t) => t.ruleText === "Stances 2" && modFamilyOf({ unique: t.unique!, name: t.name, type: "Stance Mod" }) === "stance"));
  // The ordinary keep leaves the stances alone.
  const ordinary3 = of(targets(rules((r) => (r.mods.keep = 3))), "mods");
  assert.equal(count(ordinary3.filter((t) => t.family === "stance")), count(stances(2)));
  assert.ok(count(ordinary3.filter((t) => t.family === "ordinary")) < count(of(targets(rules()), "mods").filter((t) => t.family === "ordinary")));
  // Slow sellers: only with "Only mods that sell every day" off.
  assert.ok(all.length > of(targets(rules()), "mods").length);
  assert.ok(of(targets(rules()), "mods").every((t) => (dev().m.tradesPerDay(t.name) ?? 0) >= 1));
});

test("prime: whole sets, sets then parts, parts only", { skip }, () => {
  const m = dev().m;
  const noDucats = { ...advice, platPerDucat: 0 };
  const by = (sellAs: SparesRules["prime"]["sellAs"]) => of(targets(rules((r) => (r.prime.sellAs = sellAs)), m, noDucats), "prime");
  const sets = by("sets");
  const first = by("setsFirst");
  const parts = by("parts");
  assert.ok(sets.length > 0 && sets.every((t) => t.kind === "set"), "whole sets only: no loose parts");
  assert.ok(parts.length > 0 && parts.every((t) => t.kind === "part"), "parts only: no sets");
  assert.deepEqual(first.filter((t) => t.kind === "set").map((t) => [t.name, t.quantity]), sets.map((t) => [t.name, t.quantity]));
  // A part inside a set that goes whole isn't listed loose as well; with parts only, it is.
  const yareli = (ts: SellTarget[]) => count(ts.filter((t) => t.kind === "part" && /^Yareli Prime /.test(t.name)));
  assert.ok(yareli(parts) > yareli(first), `${yareli(parts)} > ${yareli(first)}`);
  // Keep n of each loose part.
  const kept = of(targets(rules((r) => ((r.prime.sellAs = "parts"), (r.prime.keep = 2))), m, noDucats), "prime");
  assert.ok(count(kept) < count(parts));
  assert.ok(going(kept).every((t) => t.ruleText === "Keep 2"));
});

test("prime: only sets your relics drop", { skip }, () => {
  const { bundle, recipes } = dev();
  const noDucats = { ...advice, platPerDucat: 0 };
  const only = rules((r) => ((r.prime.sellAs = "sets"), (r.prime.onlyRelicsHeld = true)));
  // The account holds relics for every part of its one spare set (Yareli Prime): it goes.
  assert.deepEqual(going(of(targets(only, dev().m, noDucats), "prime")).map((t) => t.name), ["Yareli Prime Set"]);
  // The same account with no relics held: it's kept whole, and the plan says why.
  const noRelics = buildModel({ ...bundle, inventory: bundle.inventory.filter((r) => r.category !== "relic") }, undefined, null, null, null, recipes as never);
  const held = of(targets(only, noRelics, noDucats), "prime");
  assert.deepEqual(held.map((t) => [t.name, t.rule, !!t.hold]), [["Yareli Prime Set", "prime.relics", true]]);
  assert.deepEqual(going(of(targets(rules((r) => (r.prime.sellAs = "sets")), noRelics, noDucats), "prime")).map((t) => t.name), ["Yareli Prime Set"], "off: it goes");
});

test("arcanes: maxed copies or every spare copy, Legendary ones, how many maxed kept", { skip }, () => {
  const maxed = of(targets(rules()), "arcanes");
  assert.ok(maxed.length > 0 && maxed.every((t) => t.rank != null && t.rank > 0), "maxed copies only");
  const any = of(targets(rules((r) => (r.arcanes.which = "any"))), "arcanes");
  const unranked = any.filter((t) => t.rank === 0);
  assert.ok(unranked.length > 0);
  // Arcane Energize: one maxed and nine unranked, 30 copies: the nine beyond the maxed one's 21 go.
  assert.deepEqual(named(unranked, "Arcane Energize").map((t) => t.quantity), [9]);
  // None of a Legendary arcane with Legendary ones left out.
  const noLegend = of(targets(rules((r) => ((r.arcanes.which = "any"), (r.arcanes.legendary = false)))), "arcanes");
  const legendary = new Set(arcaneRows(dev().m).filter((a) => a.rarity === "Legendary").map((a) => a.name));
  assert.ok(any.some((t) => legendary.has(t.name)));
  assert.equal(noLegend.filter((t) => legendary.has(t.name)).length, 0);
  // Two maxed kept: Virtuos Forge (two maxed) keeps both.
  assert.deepEqual(named(maxed, "Virtuos Forge").map((t) => t.quantity), [1]);
  assert.deepEqual(named(of(targets(rules((r) => (r.arcanes.keepMaxed = 2))), "arcanes"), "Virtuos Forge"), []);
  assert.equal(guard(rules((r) => (r.arcanes.keepMaxed = 2)), "Virtuos Forge", 5, 1).ok, false, "the last check keeps two too");
});

test("relics: a keep number on top of the crack rule", { skip }, () => {
  const usual = of(targets(rules()), "relics");
  assert.ok(usual.length > 0 && usual.every((t) => t.ruleText === "Beats a crack" && t.crack != null));
  const two = of(targets(rules((r) => (r.relics.keep = 2))), "relics");
  for (const t of two) assert.equal(t.quantity, named(usual, t.name).find((u) => u.subtype === t.subtype)!.quantity - 2, t.name);
  assert.ok(two.length < usual.length, "relics held twice or less are kept whole");
  assert.equal(of(targets(rules((r) => (r.relics.on = false))), "relics").length, 0);
});

test("resources: by kind, empty Ayatan sculptures, the gems parts' recipes still take", { skip }, () => {
  const res = of(targets(rules()), "resources");
  // Purged Dagonic: 200 held, 40 for the Styanax Neuroptics and 12 for the Keratinos blades kept.
  const dagonic = named(res, "Purged Dagonic")[0];
  assert.equal(dagonic.quantity, 148);
  assert.match(dagonic.why, /Styanax Neuroptics \(40\)/);
  assert.equal(named(res, "Star Crimzian")[0]?.quantity ?? 0, 66, "104 held, the Styanax Chassis' 20 and more kept");
  assert.equal(named(res, "Radian Sentirum")[0]?.quantity ?? 0, 25);
  // Ayatan sculptures go as they are: empty, no stars in (the listing's default).
  const ayatan = res.filter((t) => t.family === "ayatan");
  assert.ok(ayatan.length > 0 && ayatan.every((t) => /Sculpture$/.test(t.name) && !t.subtype));
  const plan = bulkPlan(ctx(dev().m, { books: Object.fromEntries(ayatan.map((t) => [item(t.name).slug, []])) }), rules(), ayatan);
  assert.ok(plan.filter((a) => a.type === "create").every((a) => a.type === "create" && a.subtype == null), "listed without stars");
  // Each kind off leaves just that kind.
  const noGems = of(targets(rules((r) => (r.resources.families.gems = false))), "resources");
  assert.equal(noGems.filter((t) => t.family === "gems").length, 0);
  assert.equal(noGems.length, res.filter((t) => t.family !== "gems").length);
  // What builds need, plus 10.
  const margin = of(targets(rules((r) => (r.resources.margin = 10))), "resources");
  assert.equal(named(margin, "Purged Dagonic")[0].quantity, 138);
  assert.equal(named(margin, "Purged Dagonic")[0].ruleText, "Builds + 10");
});

test("imprints: a keep number per breed", { skip }, () => {
  assert.deepEqual(of(targets(rules()), "imprints").map((t) => [t.name, t.quantity]), [["Sunika Kubrow Imprint", 2]]);
  assert.deepEqual(of(targets(rules((r) => (r.imprints.keep = 1))), "imprints").map((t) => [t.name, t.quantity, t.ruleText]), [["Sunika Kubrow Imprint", 1, "Keep 1"]]);
  assert.deepEqual(of(targets(rules((r) => (r.imprints.keep = 2))), "imprints"), []);
});

test("never sell: held back in every category, and refused by the last check, until Sell again", { skip }, () => {
  const all = targets(rules((r) => (r.arcanes.which = "any")));
  for (const cat of SPARE_CATEGORIES) {
    const t = going(of(all, cat))[0];
    if (!t) continue;
    const it = item(t.name);
    const r = withNeverSell(rules((x) => (x.arcanes.which = "any")), { id: it.id, name: it.name, cat });
    const after = sellTargets(dev().m, r, advice, dev().index, sell).filter((x) => x.name === t.name && x.rank === t.rank && x.subtype === t.subtype);
    assert.ok(after.length && after.every((x) => x.hold && x.rule === "never" && !x.hold.takeDown), `${cat}: ${t.name}`);
    // The plan: left out as never sold, a listing of yours for it left as you listed it.
    const order = { id: "o1", itemId: it.id, type: "sell" as const, platinum: 99, quantity: 1, rank: t.rank, subtype: t.subtype ?? null, visible: true, updatedAt: null };
    const plan = bulkPlan(ctx(dev().m, { orders: [order] }), r, after);
    assert.ok(plan.every((a) => a.type === "skip" || a.type === "update"), `${cat}: nothing listed or taken down`);
    assert.ok(plan.some((a) => a.rule === "never"), cat);
    // The last check refuses it, typed into the listing form too; Sell again lets it through.
    const g = guardListing({ model: dev().m, index: dev().index, sell, advice, rules: r, now: nowOf(dev().m) }, { item: it, rank: t.rank, subtype: t.subtype ?? null, quantity: 1, platinum: 99, manual: true });
    assert.equal(g.ok, false);
    assert.match(!g.ok ? g.why : "", /never-sell list \(Sell spares\)\. Sell again/);
    const back = guardListing({ model: dev().m, index: dev().index, sell, advice, rules: withoutNeverSell(r, [it.id]), now: nowOf(dev().m) }, { item: it, rank: t.rank, subtype: t.subtype ?? null, quantity: 1, platinum: 99, manual: true });
    assert.notEqual(!back.ok && back.why.includes("never-sell"), true, `${cat}: Sell again`);
  }
});

test("skip this time and never sell, while looking the plan over: Apply leaves them out", { skip }, () => {
  const r = rules();
  const ts = of(targets(r), "mods").slice(0, 3);
  const books = Object.fromEntries(ts.map((t) => [item(t.name).slug, []]));
  const plan = bulkPlan(ctx(dev().m, { books, minPrice: 1 }), r, ts);
  const creates = plan.filter((a) => a.type === "create");
  assert.ok(creates.length >= 2);
  const [a, b] = creates;
  const sent = toApply(plan, new Set([actionKey(a)]), new Set([b.type === "create" ? b.item.id : ""]));
  assert.ok(!sent.includes(a) && !sent.includes(b));
  assert.equal(sent.filter((x) => x.type === "create").length, creates.length - 2);
  // Planned again (the 10-minute reprice): the same lines have the same keys, so they stay out.
  const again = bulkPlan(ctx(dev().m, { books, minPrice: 1 }), r, ts);
  assert.equal(planSignature(toApply(again, new Set([actionKey(a)]), new Set())), planSignature(toApply(plan, new Set([actionKey(a)]), new Set())));
});

test("every line has its row and its rule; nothing is planned twice", { skip }, () => {
  const r = rules((x) => ((x.arcanes.which = "any"), (x.mods.dailyOnly = false)));
  const ts = targets(r);
  const plan = bulkPlan(ctx(dev().m), r, ts);
  assert.ok(plan.length > 100);
  for (const a of plan) assert.ok(a.cat && a.rule && a.ruleText, JSON.stringify({ type: a.type, rule: a.rule, why: a.why }));
  const keys = plan.filter((a) => a.type !== "skip").map(actionKey);
  assert.equal(new Set(keys).size, keys.length);
  // Without order books every target is left out, each once, with the reason.
  const listed = new Map<string, number>();
  for (const t of going(ts)) {
    const it = item(t.name);
    if (!it) continue;
    const k = `${it.id}|${it.maxRank != null ? (t.rank ?? 0) : ""}|${t.subtype ?? it.subtypes?.[0] ?? ""}`;
    listed.set(k, (listed.get(k) ?? 0) + 1);
  }
  assert.ok([...listed.values()].every((n) => n === 1), "one target per listing");
});

test("the numbers on each row: from the daily prices before a plan, from the plan after", { skip }, () => {
  const r = defaultSparesRules();
  const c = { model: dev().m, index: dev().index, sell, advice, minPrice: 10, minRelicPrice: 3 };
  const p = sparesPreview(c, r);
  // Relics are off by default: their row still says what ticking it would add.
  assert.ok(p.relics.listings > 0);
  assert.ok(p.mods.listings > 0 && p.mods.under > 0, "some spare mods are under the 10p minimum");
  assert.equal(Object.values(p.mods.families).reduce((n, f) => n + (f?.listings ?? 0), 0), p.mods.listings, "families add up to the row");
  const more = sparesPreview({ ...c, minPrice: 1 }, r);
  assert.ok(more.mods.listings > p.mods.listings);
  // After a plan: its new and changed listings, by row.
  const ts = of(targets(rules()), "mods").slice(0, 4);
  const plan = bulkPlan(ctx(dev().m, { books: Object.fromEntries(ts.map((t) => [item(t.name).slug, []])), minPrice: 1 }), rules(), ts);
  const tally = planTally(plan);
  assert.equal(tally.mods.listings, plan.filter((a) => a.type === "create").length);
});

test("the developer's old settings: every box ticked, keep 10 parts, sells most often", () => {
  const old: BulkRules = { sets: true, parts: true, partsKeep: 10, arcanes: true, mods: true, imprints: true, other: true, priority: "trades" };
  const r = sparesSettingsOf({ bulk: old, sellable: { veiledRivens: false, relicsWorthSelling: true, saveForSets: true } });
  assert.deepEqual(r, {
    ...defaultSparesRules(),
    prime: { on: true, sellAs: "setsFirst", onlyRelicsHeld: false, keep: 10 },
    relics: { on: true, keep: 0 },
    gear: { on: true, sellAs: "setsFirst" },
    resources: { ...defaultSparesRules().resources, on: true },
    priority: "trades",
  });
  assert.deepEqual(legacyRules(r), old, "an older build reads the same switches back");
  // "Sell relics worth more sold than cracked" off kept every relic: the Relics row starts off.
  assert.equal(sparesSettingsOf({ bulk: old, sellable: { relicsWorthSelling: false } }).relics.on, false);
  // Saved once as version 2, that's what's read, whatever the old switches say.
  assert.deepEqual(sparesSettingsOf({ spares: JSON.parse(JSON.stringify(r)), bulk: { ...old, mods: false } }), r);
  if (!have) return;
  // On the dev data: the old switches and their migration plan the same.
  const m = dev().m;
  const key = (t: SellTarget) => `${t.kind}|${t.name}|${t.rank}|${t.subtype ?? ""}|${t.quantity}|${t.hold?.why ?? ""}`;
  assert.deepEqual(sellTargets(m, old, advice, dev().index, sell).map(key), sellTargets(m, r, advice, dev().index, sell).map(key));
});

test("saved: Sell spares' choices, and the old switches beside them for an older build", () => {
  const s = defaultSettings();
  s.market.spares.mods.on = false;
  s.market.spares.prime.sellAs = "parts";
  s.market.spares.prime.keep = 3;
  const saved = JSON.parse(JSON.stringify(lightSettings(s))).market;
  assert.deepEqual(saved.spares, JSON.parse(JSON.stringify(s.market.spares)));
  assert.deepEqual(saved.bulk, { sets: true, parts: true, partsKeep: 3, arcanes: true, mods: false, imprints: true, other: false, priority: "plat" }, "weapon sets still sold whole: an older build ticks Sets");
  assert.deepEqual(sparesSettingsOf(saved), s.market.spares, "read back as saved");
});
