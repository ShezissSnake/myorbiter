// Builds: what the editor takes in each slot, what a mod fits, MyOrbiter's suggestion against its
// own card, gear that takes no build, kitgun chambers as primary or secondary, saved builds for an
// item or a mod MyOrbiter no longer knows, mods past the slot count, and tiers kept per catalog.
//
// Functions the page uses are reached through the module object, each with the behaviour the page
// had before them as the fallback, so a test says what the page did, not only that a name exists.
import "./wikiFiles";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel } from "../src/lib/core/model";
import type { Bundle, CatalogItem } from "../src/lib/core/types";
import { missing, sanitizeBuilds, tierOf, type Build, type GearKind, type TierResult } from "../src/lib/core/builds";
import { modFits } from "../src/lib/core/builds/gear";
import { parsePaste } from "../src/lib/core/builds/parse";
import { matchName, nameIndex } from "../src/lib/core/builds/match";
import { canSuggest, modIndex, suggest, toBuild, TIERS, type Owned } from "../src/lib/core/builds/suggest";
import * as page from "../src/lib/core/buildsPage";
import { recipeItems } from "../src/lib/core/recipes";
import { CAT, CATALOG, P, build, item } from "./support/buildsCatalog";

// Game data from @wfcd/items, as the demo ships it (demo/README.md).
const demo = JSON.parse(readFileSync(new URL("../demo/dev-bundle.json", import.meta.url), "utf8")) as { catalog: CatalogItem[]; inventory: Bundle["inventory"] };
const byU = new Map(demo.catalog.map((c) => [c.uniqueName, c]));
const gear = (name: string) => demo.catalog.find((c) => c.name === name && c.category !== "Mods" && c.category !== "Arcanes")!;
const mod = (name: string) => demo.catalog.find((c) => c.name === name && c.category === "Mods")!;

// The test fixture the suggestion tests use (WFCD rows).
const fx = JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] };
const fxByU = new Map(fx.catalog.map((c) => [c.uniqueName, c]));
const fxIdx = modIndex(fx.catalog);
const fxItem = (name: string) => fx.catalog.find((c) => c.name === name && c.category !== "Mods")!;
const allOwned: Owned = new Map([...fxIdx.byName.values()].map((m) => [m.uniqueName, m.maxRank ?? 0]));

type Api = Record<string, unknown>;
const api = page as unknown as Api;

// ---------------------------------------------------------------- 1. each slot takes its own kind of mod

test("the aura slot: a regular mod there adds no capacity, and the build says why", () => {
  const it = fxItem("Excalibur");
  const intensify = fx.catalog.find((c) => c.name === "Intensify" && c.category === "Mods" && !/Beginner|Expert|PvP/.test(c.uniqueName))!;
  const b: Build = { id: "x", item: it.uniqueName, kind: "warframe", aura: { path: intensify.uniqueName }, mods: Array(8).fill(null), arcanes: [], shards: [], source: "mine", importedAt: 0 };
  const t = tierOf(b, it, fxByU);
  assert.equal(t.capacity, 30, `Intensify in the aura slot counted as capacity: ${t.capacity} (${t.reasons.join(" / ")})`);
  assert.ok(t.reasons.some((r) => /Intensify in the aura slot isn't an aura/.test(r)), t.reasons.join(" / "));
});

test("the stance slot: only a stance adds capacity there", () => {
  const b = build(P.nikana, [], { stance: { path: P.pressurePoint } });
  const t = tierOf(b, item(P.nikana), CAT);
  assert.equal(t.capacity, 30, t.reasons.join(" / "));
  const ok = tierOf(build(P.nikana, [], { stance: { path: P.crimsonDervish } }), item(P.nikana), CAT);
  assert.ok(ok.capacity > 30, "a stance still adds capacity");
});

test("the editor: an aura only in the aura slot, a stance only in the stance slot, neither in a mod slot", () => {
  const idx = nameIndex(CAT);
  const wrong = (text: string, path: string, slot: string) => {
    const r = matchName(text, idx, item(path), CAT.get(path)!.category === "Melee" ? "melee" : "warframe", slot as "mod");
    return r.ok ? `${text} in ${slot}: taken` : r.reason === "wrong-slot" ? null : `${text} in ${slot}: ${r.reason}`;
  };
  const rows = [
    wrong("Intensify", P.rhino, "aura"),
    wrong("Steel Charge", P.rhino, "mod"),
    wrong("Crimson Dervish", P.nikana, "mod"),
    wrong("Pressure Point", P.nikana, "stance"),
    wrong("Steel Charge", P.rhino, "exilus"),
  ].filter(Boolean);
  assert.deepEqual(rows, []);
  // What each slot is for still matches.
  const fine = (text: string, path: string, slot: string, kind: GearKind) => matchName(text, idx, item(path), kind, slot as "mod").ok;
  assert.ok(fine("Steel Charge", P.rhino, "aura", "warframe"));
  assert.ok(fine("Crimson Dervish", P.nikana, "stance", "melee"));
  assert.ok(fine("Intensify", P.rhino, "mod", "warframe"));
  // Pasted text still reads an aura as an aura, whatever slot it was written in.
  assert.ok(matchName("Steel Charge", idx, item(P.rhino), "warframe", "any").ok);
});

test("the editor's exilus slot: only a mod the catalog marks for it, where the catalog marks them", () => {
  const idx = nameIndex(demo.catalog);
  const excal = gear("Excalibur");
  const r = matchName("Intensify", idx, excal, "warframe", "exilus" as "mod");
  assert.ok(!r.ok && r.reason === "wrong-slot", `Intensify in the exilus slot: ${r.ok ? "taken" : r.reason}`);
  assert.ok(matchName("Sure Footed", idx, excal, "warframe", "exilus" as "mod").ok, "Sure Footed is an exilus mod");
});

// ---------------------------------------------------------------- 2. mods for a class of weapon or companion

test("mods whose compatName is a class or a qualified class fit the gear they are for", () => {
  const cases: [string, string, GearKind][] = [
    ["Energizing Shot", "Lex Prime", "secondary"],
    ["Mending Shot", "Soma Prime", "primary"],
    ["Covert Lethality", "Ceramic Dagger", "melee"],
    ["Amar's Contempt", "Fang Prime", "melee"],
    ["Boreal's Contempt", "Guandao", "melee"],
    ["Nira's Contempt", "Lecta", "melee"],
    ["Swipe", "Smeeta Kavat", "companion"],
    ["Strain Fever", "Helminth Charger", "companion"],
    ["Mecha Overdrive", "Sunika Kubrow", "companion"],
  ];
  const wrong = cases.filter(([m, it, k]) => modFits(mod(m), gear(it), k).fits === false).map(([m, it, k]) => `${m} on ${it}: ${modFits(mod(m), gear(it), k).why}`);
  assert.deepEqual(wrong, []);
});

test("and not other gear of the same kind", () => {
  const cases: [string, string, GearKind][] = [
    ["Amar's Contempt", "Guandao", "melee"],
    ["Boreal's Contempt", "Lecta", "melee"],
    ["Covert Lethality", "Fang Prime", "melee"],
    ["Swipe", "Sunika Kubrow", "companion"],
    ["Strain Fever", "Sunika Kubrow", "companion"],
    ["Mecha Overdrive", "Smeeta Kavat", "companion"],
    ["Mending Shot", "Hek", "primary"],
  ];
  const fits = cases.filter(([m, it, k]) => modFits(mod(m), gear(it), k).fits !== false).map(([m, it]) => `${m} on ${it}`);
  assert.deepEqual(fits, []);
});

test("a pasted Energizing Shot is read for a pistol", () => {
  const r = parsePaste("Energizing Shot, Hornet Strike", gear("Lex Prime"), byU);
  assert.deepEqual(r.unmatched.map((u) => `${u.text}: ${u.reason} ${u.why ?? ""}`), []);
});

// ---------------------------------------------------------------- 3. one card, one set of numbers

/** What the card shows as the note: the page's function, or the note as saved (the page before it). */
const noteShown = (b: Build, t: TierResult): string => (typeof api.noteShown === "function" ? (api.noteShown as (b: Build, t: TierResult) => string)(b, t) : (b.note ?? ""));

/** Each figure the shown note states, against the card's. */
function disagreements(name: string, tier: string, b: Build, t: TierResult, s: { forma?: number | null; capacity: { max: number } }): string[] {
  const note = noteShown(b, t);
  const out: string[] = [];
  const forma = /(\d+) Forma/.exec(note)?.[1];
  const cap = /(\d+) capacity\./.exec(note)?.[1];
  if (t.tier !== tier) out.push(`${name} ${tier}: the card's tier line reads ${t.tier}`);
  if ((forma ? Number(forma) : 0) !== t.forma) out.push(`${name} ${tier}: the note says ${forma ?? 0} Forma, the card ${t.forma}`);
  if (cap == null || Number(cap) !== t.capacity) out.push(`${name} ${tier}: the note says ${cap} capacity, the meter ${t.capacity}`);
  if ((s.forma ?? 0) !== t.forma) out.push(`${name} ${tier}: the suggestion holds ${s.forma} Forma, the card ${t.forma}`);
  if (s.capacity.max !== t.capacity) out.push(`${name} ${tier}: the suggestion holds ${s.capacity.max} capacity, the card ${t.capacity}`);
  return out;
}

test("MyOrbiter's suggestion: its note, meter, Forma line and tier line agree (the audit's two cases)", () => {
  const rows: string[] = [];
  for (const [name, tier, owned] of [["Kuva Grattler", "medium", new Map()], ["Excalibur", "medium", allOwned]] as const) {
    const it = fxItem(name);
    const s = suggest(it, tier, owned as Owned, fxIdx, 0);
    const b = toBuild(s, 0) as unknown as Build;
    rows.push(...disagreements(name, tier, b, tierOf(b, it, fxByU, undefined, { uncounted: s.uncounted }), s));
  }
  assert.deepEqual(rows, []);
});

test("MyOrbiter's suggestion: one set of numbers for every item and tier of the fixture, all held or none", () => {
  const rows: string[] = [];
  const items = fx.catalog.filter((c) => c.category !== "Mods" && c.category !== "Arcanes" && canSuggest(c));
  for (const it of items) {
    for (const tier of TIERS) {
      for (const owned of [allOwned, new Map() as Owned]) {
        const s = suggest(it, tier, owned, fxIdx, 0);
        const b = toBuild(s, 0) as unknown as Build;
        const t = tierOf(b, it, fxByU, undefined, { uncounted: s.uncounted });
        if (!t.fits) rows.push(`${it.name} ${tier}: doesn't fit on its card`);
        rows.push(...disagreements(it.name, tier, b, t, s));
      }
    }
  }
  assert.deepEqual(rows.slice(0, 12), [], `${rows.length} disagreements`);
});

test("MyOrbiter's suggestion on the demo account: one set of numbers for every item and tier", () => {
  const owned = new Map<string, number>();
  for (const r of demo.inventory) if ((r.category === "mod" || r.category === "arcane") && r.quantity > 0) owned.set(r.item_id.split("#")[0], Math.max(owned.get(r.item_id.split("#")[0]) ?? -1, r.rank ?? 0));
  const idx = modIndex(demo.catalog);
  const rows: string[] = [];
  for (const it of demo.catalog) {
    if (it.category === "Mods" || it.category === "Arcanes" || !canSuggest(it)) continue;
    for (const tier of TIERS) {
      const s = suggest(it, tier, owned, idx, 0);
      const b = toBuild(s, 0) as unknown as Build;
      const t = tierOf(b, it, byU, undefined, { uncounted: s.uncounted });
      if (!t.fits) rows.push(`${it.name} ${tier}: doesn't fit on its card`);
      rows.push(...disagreements(it.name, tier, b, t, s));
    }
  }
  assert.deepEqual(rows.slice(0, 12), [], `${rows.length} disagreements`);
});

test("a saved copy of a suggestion keeps the tier it was made for, and its note the card's numbers", () => {
  const it = fxItem("Excalibur");
  const s = suggest(it, "medium", allOwned, fxIdx, 0);
  // Saving keeps the build as shown, its aura counted from then on (it is the player's own copy).
  const saved = sanitizeBuilds([{ ...toBuild(s, 0), id: "saved" }])[0];
  const t = tierOf(saved, it, fxByU);
  assert.deepEqual(disagreements("Excalibur, saved", "medium", saved, t, { forma: t.forma, capacity: { max: t.capacity } }), []);
});

test("Kuva, Tenet and Coda weapons don't state five Forma they don't need", () => {
  const it = fxItem("Kuva Grattler");
  const s = suggest(it, "medium", new Map(), fxIdx, 0);
  assert.equal(s.forma, 0, s.note);
  assert.doesNotMatch(noteShown(toBuild(s, 0) as unknown as Build, tierOf(toBuild(s, 0) as unknown as Build, it, fxByU)), /5 Forma/);
});

// ---------------------------------------------------------------- 4. an augment fits its own weapon only

test("an augment for one weapon doesn't fit another whose name only contains it", () => {
  const cases: [string, string, GearKind][] = [
    ["Deadly Maneuvers", "Akmagnus", "secondary"],
    ["Entropy Spike", "Akbolto", "secondary"],
    ["Dizzying Rounds", "Akbronco", "secondary"],
    ["Stinging Truth", "Twin Vipers", "secondary"],
    ["Winds Of Purity", "Dex Furis", "secondary"],
    ["Bright Purity", "Dual Skana", "melee"],
  ];
  const fits = cases.filter(([m, it, k]) => gear(it) && modFits(mod(m), gear(it), k).fits !== false).map(([m, it]) => `${m} on ${it}`);
  assert.deepEqual(fits, []);
});

test("an augment still fits its weapon and that weapon's other versions", () => {
  const cases: [string, string, GearKind][] = [
    ["Deadly Maneuvers", "Magnus", "secondary"],
    ["Deadly Maneuvers", "Magnus Prime", "secondary"],
    ["Bright Purity", "Skana", "melee"],
    ["Bright Purity", "Prisma Skana", "melee"],
    ["Winds Of Purity", "Furis", "secondary"],
  ];
  const wrong = cases.filter(([, it]) => gear(it)).filter(([m, it, k]) => modFits(mod(m), gear(it), k).fits === false).map(([m, it, k]) => `${m} on ${it}: ${modFits(mod(m), gear(it), k).why}`);
  assert.deepEqual(wrong, []);
});

// ---------------------------------------------------------------- 5. the Helminth and Venari

test("the Helminth and Khora's Venari are not offered as gear to build", () => {
  const listed = page.buildableItems(demo.catalog, () => 0).filter((x) => ["Helminth", "Venari", "Venari Prime"].includes(x.name)).map((x) => `${x.name}: ${x.label}${canSuggest(byU.get(x.unique)!) ? " (with MyOrbiter's suggestion)" : ""}`);
  assert.deepEqual(listed, []);
  assert.equal(canSuggest(gear("Helminth")), false);
});

// ---------------------------------------------------------------- 6. a kitgun chamber, primary or secondary

const chamber = () => {
  const r = recipeItems().find((x) => x.family === "kitgun")!;
  return { uniqueName: r.unique, name: r.name, category: "Misc", type: "Kitgun Component", productCategory: "Pistols" } as CatalogItem;
};
/** The kinds the page offers for an item: the page's function, else the one kind it had. */
const kindsOf = (it: CatalogItem): GearKind[] => (typeof api.kindChoices === "function" ? (api.kindChoices as (i: CatalogItem) => GearKind[])(it) : [page.buildKindOf(it)!]);
/** The kind a build is counted as: the page's function, else the item's one kind. */
const kindFor = (b: Build, it: CatalogItem): GearKind | null => (typeof api.buildKindFor === "function" ? (api.buildKindFor as (b: Build, i: CatalogItem) => GearKind | null)(b, it) : page.buildKindOf(it));

test("a kitgun chamber's page offers Secondary, then Primary; other gear its one kind", () => {
  assert.deepEqual(kindsOf(chamber()), ["secondary", "primary"]);
  assert.deepEqual(kindsOf(item(P.braton)), ["primary"]);
  // Elsewhere (Mastery, the rings) the chamber is as it was: one kind, secondary.
  assert.equal(page.buildKindOf(chamber()), "secondary");
});

test("a chamber's build keeps its own kind; one that names its grip follows the grip; one saved before reads as secondary", () => {
  const c = chamber();
  const base: Build = { id: "k", item: c.uniqueName, kind: "secondary", mods: [], arcanes: [], shards: [], source: "mine", importedAt: 0 };
  assert.equal(kindFor({ ...base, kind: "primary" }, c), "primary");
  assert.equal(kindFor(base, c), "secondary");
  const primaryGrip = "/Lotus/Weapons/SolarisUnited/Primary/SUModularPrimarySet1/Handles/SUModularPrimaryHandleAPart";
  const secondaryGrip = "/Lotus/Weapons/Infested/Pistols/InfKitGun/Handles/InfSecondaryHandle/InfModularSecondaryHandlePart";
  assert.equal(kindFor({ ...base, parts: [primaryGrip] }, c), "primary");
  assert.equal(kindFor({ ...base, kind: "primary", parts: [secondaryGrip] }, c), "secondary");
  assert.equal(kindFor(build(P.braton, []), item(P.braton)), "primary");
});

// ---------------------------------------------------------------- 7. a saved build for an item MyOrbiter doesn't know

test("a saved build for an item MyOrbiter no longer knows is kept on loading and listed", () => {
  const gone: Build = { id: "gone", item: "/Lotus/Powersuits/NoSuchFrame/NoSuchFrame", kind: "warframe", mods: [{ path: P.vitality }], arcanes: [], shards: [], source: "mine", importedAt: 0 };
  const helminth: Build = { ...gone, id: "helminth", item: gear("Helminth").uniqueName };
  const known = build(P.rhino, [P.vitality], { id: "known" });
  const loaded = sanitizeBuilds([gone, helminth, known]);
  assert.deepEqual(loaded.map((b) => b.id), ["gone", "helminth", "known"], "nothing saved is dropped by loading");
  const list = typeof api.unknownItemBuilds === "function" ? (api.unknownItemBuilds as (b: Build[], c: ReadonlyMap<string, CatalogItem>) => Build[])(loaded, new Map([...byU, ...CAT])) : [];
  assert.deepEqual(list.map((b) => b.id), ["gone", "helminth"]);
});

// ---------------------------------------------------------------- 8. a mod MyOrbiter no longer knows

test("a saved build whose mod is no longer in the catalog isn't rated New player, and says so first", () => {
  const it = fxItem("Excalibur");
  const b: Build = { id: "x", item: it.uniqueName, kind: "warframe", mods: [{ path: "/Lotus/Upgrades/Mods/Warframe/Expert/RenamedPrimedMod" }, null, null, null, null, null, null, null], arcanes: [], shards: [], source: "pasted", importedAt: 0 };
  const t = tierOf(b, it, fxByU);
  assert.notEqual(t.tier, "low", `tier ${t.tier}, reasons: ${t.reasons.join(" / ")}`);
  assert.match(t.reasons[0], /doesn't know/, t.reasons[0]);
  assert.equal((t as TierResult & { unsure?: boolean }).unsure, true, "it can't tell");
  // A build that is Veteran on what MyOrbiter knows stays Veteran, and still says a mod is unknown.
  const vet = tierOf(build(P.rhino, [P.primedContinuity, "/Lotus/Upgrades/Mods/Warframe/Expert/RenamedPrimedMod"]), item(P.rhino), CAT);
  assert.equal(vet.tier, "high");
  assert.match(vet.reasons[0], /doesn't know/);
});

// ---------------------------------------------------------------- 10. mods past the slot count

test("mods past the slot count are said as extra, not listed as missing", () => {
  const ten = [P.vitality, P.intensify, P.continuity, P.streamline, P.adaptation, P.ironShrapnel, P.umbralVitality, P.umbralFiber, P.umbralIntensify, P.primedContinuity];
  const b = { ...build(P.rhino, []), mods: ten.map((path) => ({ path })) };
  const bundle: Bundle = { observed_at: null, inventory: [], catalog: CATALOG, relics: [], prices: { prices: {} } };
  const r = missing(b, buildModel(bundle));
  const names = r.lines.filter((l) => l.kind === "mod").map((l) => l.name);
  assert.ok(!names.includes("Umbral Intensify") && !names.includes("Primed Continuity"), names.join(", "));
  assert.equal(names.length, 8);
  assert.ok(r.tier.reasons.some((x) => /2 mods past the 8 mod slots/.test(x)), r.tier.reasons.join(" / "));
});

// ---------------------------------------------------------------- 11. tiers worked out again for a new catalog

test("a build's tier is worked out again when the catalog changes", () => {
  /** The page's keeper of tiers: the page's class, else what the page had (one WeakMap per build, kept for the page's life). */
  type Keeper = { get: (b: Build, key: object, make: () => TierResult) => TierResult };
  const Memo = api.PerBuild as (new () => Keeper) | undefined;
  const memo: Keeper = Memo ? new Memo() : (() => { const m = new WeakMap<Build, TierResult>(); return { get: (b: Build, _k: object, make: () => TierResult) => m.get(b) ?? (m.set(b, make()), m.get(b)!) }; })();
  const b = build(P.rhino, [P.primedContinuity]);
  const before = memo.get(b, CAT, () => tierOf(b, item(P.rhino), CAT));
  assert.equal(before.tier, "high");
  // A data update renames Primed Continuity's path: the same saved build now names a mod it doesn't know.
  const newer = new Map(CAT);
  newer.delete(P.primedContinuity);
  const after = memo.get(b, newer, () => tierOf(b, item(P.rhino), newer));
  assert.equal(after.unknown.length, 1, "worked out against the new catalog");
  assert.equal(memo.get(b, newer, () => { throw new Error("worked out twice"); }), after, "and kept while the catalog stays");
});
