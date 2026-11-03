// The Builds page's own logic (src/lib/core/buildsPage.ts): which items take a build, the item
// search, the tiers' order, ages and sources in words, the links out, the whisper, the paste's fixes
// and orbiter's suggestion's loadout.
import { test } from "node:test";
import "./wikiFiles";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ago, ageLine, arrange, buildableItems, buildKindOf, cheapestSeller, kindLabelOf, loadoutLines, noxUrl, overframeUrl, placeIn, recentItems, searchItems, slugOf, sourceName, whisperLine, type BuildableItem } from "../src/lib/core/buildsPage";
import { tierOf, type Build, type Tier, type TierResult } from "../src/lib/core/builds";
import { recipeItems } from "../src/lib/core/recipes";
import type { BookOrder } from "../src/lib/core/market";
import type { CatalogItem } from "../src/lib/core/types";
import { CAT, P, NOW, DAY } from "./support/buildsCatalog";

/** A bare build to sort: a Braton's, pasted now, with whatever's given. */
const build = (x: Partial<Build> = {}): Build => ({ id: Math.random().toString(36).slice(2), item: P.braton, kind: "primary", mods: [], arcanes: [], shards: [], source: "pasted", importedAt: NOW, ...x });

const fixture = JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] };

test("what takes a build: gear of every kind, modular gear by its recipe's part, not mods, parts or K-Drives", () => {
  const k = (x: Partial<CatalogItem>) => buildKindOf({ uniqueName: "/x", category: "", ...x } as CatalogItem);
  assert.equal(k({ category: "Warframes", type: "Warframe", productCategory: "Suits" }), "warframe");
  assert.equal(k({ category: "Warframes", type: "Necramech", productCategory: "MechSuits" }), "necramech");
  assert.equal(k({ category: "Melee", type: "Exalted Weapon" }), "exalted");
  assert.equal(k({ category: "Primary", type: "Companion Weapon", productCategory: "SentinelWeapons" }), "companionWeapon");
  assert.equal(k({ category: "Arch-Gun", productCategory: "SpaceGuns" }), "archgun");
  assert.equal(k({ category: "Arch-Melee", productCategory: "SpaceMelee" }), "archmelee");
  assert.equal(k({ category: "Archwing", productCategory: "SpaceSuits" }), "archwing");
  assert.equal(k({ category: "Primary", productCategory: "OperatorAmps" }), "amp");
  assert.equal(k({ uniqueName: "/x/Blueprint", category: "Primary" }), null);
  // Modular: the recipe's part is the item; a grip or loader takes no build of its own.
  const [chamber] = recipeItems().filter((r) => r.family === "kitgun");
  assert.equal(k({ uniqueName: chamber.unique, category: "Misc", type: "Kitgun Component", productCategory: "Pistols" }), "secondary");
  assert.equal(k({ uniqueName: "/Lotus/Weapons/SolarisUnited/Secondary/SUModularSecondarySet1/Handle/SUModularSecondaryHandleAPart", category: "Misc", type: "Kitgun Component", productCategory: "Pistols" }), null);
  const zaw = recipeItems().find((r) => r.family === "zaw")!;
  assert.equal(k({ uniqueName: zaw.unique, category: "Melee", type: "Zaw Component", productCategory: "Pistols" }), "melee");
  const moa = recipeItems().find((r) => r.family === "moa")!;
  assert.equal(k({ uniqueName: moa.unique, category: "Pets", type: "Pets", productCategory: "Pistols" }), "companion");
  assert.equal(k({ uniqueName: "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetEngineSomething", category: "Pets", type: "Pets", productCategory: "Pistols" }), null);
  assert.equal(k({ uniqueName: "/Lotus/Types/Vehicles/Hoverboard/Board", category: "Misc", type: "K-Drive Component" }), null);
});

test("kinds read as the game says them, a modular part as what it is", () => {
  assert.equal(kindLabelOf({ uniqueName: "/x", type: "Rifle" }, "primary"), "Primary · Rifle");
  assert.equal(kindLabelOf({ uniqueName: "/x", type: "Melee" }, "melee"), "Melee");
  assert.equal(kindLabelOf({ uniqueName: "/x", type: "Necramech" }, "necramech"), "Necramech");
  const chamber = recipeItems().find((r) => r.family === "kitgun")!;
  assert.equal(kindLabelOf({ uniqueName: chamber.unique, type: "Kitgun Component" }, "secondary"), "Kitgun chamber");
});

test("the item list: every buildable item once, yours first, then by name", () => {
  const owned = new Set([P.rhino]);
  const list = buildableItems(fixture.catalog, (u) => (owned.has(u) ? 1 : 0));
  assert.ok(list.length >= 10);
  assert.ok(!list.some((x) => x.name === "Serration"), "no mods");
  const rhino = list.find((x) => x.name === "Rhino Prime");
  assert.equal(list.length, new Set(list.map((x) => x.name)).size, "one per name");
  assert.ok(list.find((x) => x.name === "Voidrig")?.kind === "necramech");
  if (rhino && rhino.unique === P.rhino) assert.equal(list[0].name, "Rhino Prime", "yours first");
});

test("the item search: names starting with it, then a word starting with it, then containing it; yours first at each step", () => {
  const x = (name: string, owned = false): BuildableItem => ({ unique: `/${name}`, name, kind: "primary", label: "Primary", owned, modular: false });
  const items = [x("Soma"), x("Soma Prime", true), x("Kuva Soma"), x("Akjagara"), x("Lesion"), x("Kuva Somatic")];
  assert.deepEqual(searchItems(items, "soma").map((i) => i.name), ["Soma Prime", "Soma", "Kuva Soma", "Kuva Somatic"]);
  assert.deepEqual(searchItems(items, "  SOMA p").map((i) => i.name), ["Soma Prime"]);
  assert.deepEqual(searchItems(items, "jag").map((i) => i.name), ["Akjagara"]);
  assert.equal(searchItems(items, "").length, items.length);
  assert.deepEqual(searchItems(items, "zzz"), []);
});

test("recent items: opened this session first, then those with builds, newest first, no repeats", () => {
  const b = (item: string, at: number) => build({ item, importedAt: at });
  assert.deepEqual(recentItems(["/a", "/b"], [b("/c", NOW - DAY), b("/b", NOW), b("/d", NOW - 2 * DAY)]), ["/a", "/b", "/c", "/d"]);
  assert.equal(recentItems([], Array.from({ length: 20 }, (_, i) => b(`/${i}`, NOW - i)), 5).length, 5);
});

test("each tier: favourites, then yours, then a site's by votes, then orbiter's suggestion", () => {
  const t = (tier: Tier) => ({ tier }) as TierResult;
  const tiers = new Map<string, Tier>();
  const at = (b: Build) => t(tiers.get(b.id) ?? "low");
  const mk = (id: string, tier: Tier, x: Partial<Build> = {}) => {
    tiers.set(id, tier);
    return build({ id, ...x });
  };
  const saved = [mk("pasted", "low", { source: "pasted" }), mk("fav", "low", { favourite: true, source: "pasted" }), mk("mine", "medium", { source: "mine" }), mk("savedOrbiter", "low", { source: "orbiter" })];
  const site = [mk("s1", "low", { source: { url: "https://x/1", site: "Nox's Frame" }, votes: 3 }), mk("s2", "low", { source: { url: "https://x/2", site: "Nox's Frame" }, votes: 40 }), mk("pasted", "low")];
  const sug = { low: mk("o-low", "medium", { source: "orbiter" }), high: build({ id: "savedOrbiter", source: "orbiter" }) };
  const r = arrange(saved, site, sug, at);
  assert.deepEqual(r.low.map((s) => s.build.id), ["fav", "pasted", "s2", "s1", "savedOrbiter", "o-low"]);
  // The suggestion stays in the tab it was made for; one already saved isn't shown twice.
  assert.deepEqual(r.medium.map((s) => s.build.id), ["mine"]);
  assert.deepEqual(r.high.map((s) => s.build.id), []);
  assert.deepEqual(r.low.map((s) => s.place), ["favourite", "saved", "site", "site", "orbiter", "orbiter"]);
  assert.deepEqual(r.low.map((s) => s.saved), [true, true, false, false, true, false]);
});

test("ages and sources in words", () => {
  assert.equal(ago(NOW, NOW), "today");
  assert.equal(ago(NOW - DAY, NOW), "yesterday");
  assert.equal(ago(NOW - 5 * DAY, NOW), "5 days ago");
  assert.equal(ago(NOW - 21 * DAY, NOW), "3 weeks ago");
  assert.equal(ago(NOW - 130 * DAY, NOW), "4 months ago");
  assert.equal(ago(NOW - 400 * DAY, NOW), "a year ago");
  assert.equal(ago(NOW - 800 * DAY, NOW), "2 years ago");
  assert.equal(ageLine(build({ importedAt: NOW - 2 * DAY }), NOW), "added 2 days ago");
  assert.equal(ageLine(build({ importedAt: NOW, updatedAt: NOW - 40 * DAY }), NOW), "updated 5 weeks ago");
  assert.equal(sourceName("pasted"), "Pasted");
  assert.equal(sourceName("mine"), "Yours");
  assert.equal(sourceName("orbiter"), "orbiter's suggestion");
  assert.equal(sourceName({ url: "https://noxsframe.com/builds/x", site: "Nox's Frame" }), "Nox's Frame");
});

test("links out: Nox's Frame's item pages as its sitemap has them, Overframe's own search, never fetched", () => {
  assert.equal(slugOf("Soma Prime"), "soma-prime");
  assert.equal(slugOf("Kuva Nukor"), "kuva-nukor");
  assert.equal(noxUrl("Soma Prime", "primary"), "https://noxsframe.com/primary-weapons/soma-prime");
  assert.equal(noxUrl("Saryn Prime", "warframe"), "https://noxsframe.com/warframes/saryn-prime");
  assert.equal(noxUrl("Voidrig", "necramech"), "https://noxsframe.com/necramechs/voidrig");
  assert.equal(noxUrl("Imperator Vandal", "archgun"), "https://noxsframe.com/arch-guns/imperator-vandal");
  assert.equal(noxUrl("Catchmoon", "secondary", true), "https://noxsframe.com/builds");
  assert.equal(noxUrl("Exalted Blade", "exalted"), "https://noxsframe.com/builds");
  // Overframe: a plain link to overframe.gg itself.
  assert.equal(overframeUrl("Soma Prime"), "https://overframe.gg/search/?q=Soma%20Prime");
  assert.equal(new URL(overframeUrl("Soma Prime")).hostname, "overframe.gg");
});

test("the whisper: the cheapest seller in game at the rank, in warframe.market's words", () => {
  const order = (name: string, platinum: number, x: Partial<BookOrder> = {}): BookOrder => ({ id: name, type: "sell", platinum, quantity: 1, rank: 0, subtype: null, visible: true, user: { id: name, ingameName: name, status: "ingame", platform: null, crossplay: null }, ...x });
  const book = [order("Away", 5, { user: { id: "Away", ingameName: "Away", status: "offline", platform: null, crossplay: null } }), order("Maxed", 6, { rank: 10 }), order("Second", 12), order("First", 9), order("Buyer", 30, { type: "buy" })];
  const s = cheapestSeller(book, "Serration", 0, null);
  assert.deepEqual(s, { name: "First", platinum: 9, sellers: 2, whisper: '/w First Hi! I want to buy: "Serration (rank 0)" for 9 platinum. (warframe.market)' });
  assert.equal(cheapestSeller([order("Away", 5, { user: { id: "Away", ingameName: "Away", status: "online", platform: null, crossplay: null } })], "Serration", 0, null), null);
  assert.equal(whisperLine("Seller", "Arcane Energize", 40, null), '/w Seller Hi! I want to buy: "Arcane Energize" for 40 platinum. (warframe.market)');
});

test("a name picked for an unmatched one goes in the first free slot of its kind, never twice, never past the slots", () => {
  const b = build({ item: P.rhino, kind: "warframe", mods: [{ path: P.vitality }, null], arcanes: [] });
  const one = placeIn(b, P.intensify, false);
  assert.deepEqual(one.mods, [{ path: P.vitality }, { path: P.intensify }]);
  assert.deepEqual(placeIn(one, P.streamline, false).mods.length, 3);
  assert.equal(placeIn(one, P.intensify, false), one, "already in");
  const arc = placeIn(placeIn(b, P.energize, true), P.grace, true);
  assert.deepEqual(arc.arcanes, [{ path: P.energize }, { path: P.grace }]);
  assert.equal(placeIn(arc, P.moltAugmented, true), arc, "two arcane slots on a warframe");
  const full = build({ item: P.rhino, kind: "warframe", mods: Array.from({ length: 8 }, (_, i) => ({ path: `/m${i}` })) });
  assert.equal(placeIn(full, P.intensify, false), full);
});

test("orbiter's suggestion's loadout, whatever shape it comes in, as labelled lines", () => {
  assert.deepEqual(loadoutLines(undefined), []);
  assert.deepEqual(loadoutLines(["x"]), []);
  const lines = loadoutLines({
    shards: [{ colour: "azure", tauforged: true, stat: "Energy max" }, { colour: "crimson", stat: "Ability Strength" }],
    helminth: { ability: "Nourish", replaces: "Roar", why: "energy for the squad" },
    support: ["Nautilus", { name: "Vinquibus" }],
    companion: "Smeeta Kavat",
    focusSchool: { school: "Zenurik" },
    empty: null,
  });
  assert.deepEqual(lines, [
    { label: "Archon shards", text: "Tauforged Azure: Energy max, Crimson: Ability Strength" },
    { label: "Helminth", text: "Nourish: replaces Roar, energy for the squad" },
    { label: "Support weapons", text: "Nautilus, Vinquibus" },
    { label: "Companion", text: "Smeeta Kavat" },
    { label: "Focus School", text: "Zenurik" },
  ]);
});

test("tierOf drives the tabs: a real build lands in the tier it needs", () => {
  const rhino = CAT.get(P.rhino)!;
  const light = build({ item: P.rhino, kind: "warframe", mods: [{ path: P.vitality, rank: 3 }] });
  const r = arrange([light], [], {}, (b) => tierOf(b, rhino, CAT));
  assert.equal(r.low.length, 1);
});

test("tags: the ones on an item's builds, the builds carrying every one picked, typed tags cleaned", async () => {
  const { tagsIn, withTags, parseTags } = await import("../src/lib/core/buildsPage");
  const { sanitizeBuild } = await import("../src/lib/core/builds");
  const { byFamily, familyOfTag } = await import("../src/lib/ui/builds/tags");
  const rows = [{ build: build({ tags: ["Steel Path", "DPS"] }) }, { build: build({ tags: ["DPS", "Nuke"] }) }, { build: build() }];
  assert.deepEqual(tagsIn(rows.map((r) => r.build)), ["Steel Path", "DPS", "Nuke"]);
  assert.equal(withTags(rows, []).length, 3);
  assert.equal(withTags(rows, ["dps"]).length, 2);
  assert.equal(withTags(rows, ["DPS", "Steel Path"]).length, 1);
  assert.deepEqual(parseTags(" Steel  Path, support;steel path\nNuke,, "), ["Steel Path", "support", "Nuke"]);
  // Saved tags are kept clean: strings only, trimmed, each once.
  assert.deepEqual(sanitizeBuild({ item: "/x", kind: "primary", tags: ["DPS", " DPS ", 3, "", "Solo"] })?.tags, ["DPS", "Solo"]);
  assert.equal(sanitizeBuild({ item: "/x", kind: "primary", tags: "DPS" })?.tags, undefined);
  // Families group the chips; an unknown tag is Other.
  assert.equal(familyOfTag("steel path"), "Content");
  assert.equal(familyOfTag("Speedrun"), "Other");
  assert.deepEqual(byFamily(["Nuke", "DPS", "Overguard", "Steel Path"]).map((g) => [g.family, g.tags]), [["Role", ["DPS"]], ["Content", ["Steel Path"]], ["Survivability", ["Overguard"]], ["Other", ["Nuke"]]]);
});

test("an Overframe build is a link only: never its contents", async () => {
  const { isOverframe, linkOnly, onOverframe } = await import("../src/lib/core/buildsPage");
  assert.ok(onOverframe("https://overframe.gg/build/482503/soma-prime/x/"));
  assert.ok(onOverframe("https://www.overframe.gg/build/1"));
  assert.ok(!onOverframe("https://notoverframe.gg/build/1"));
  assert.ok(!onOverframe("not a url"));
  const b = build({ title: "General use", author: "Someone", source: { url: "https://overframe.gg/build/1/soma-prime/x/", site: "Overframe" }, mods: [{ path: P.serration }], arcanes: [{ path: P.merciless }], shards: [{ colour: "azure", tauforged: true }], exilus: { path: P.vigilante }, forma: 4, note: "copied", tags: ["DPS"] });
  assert.ok(isOverframe(b));
  assert.ok(!isOverframe(build({ source: { url: "https://noxsframe.com/builds/x", site: "Nox's Frame" } })));
  assert.ok(!isOverframe(build({ source: "pasted" })));
  const l = linkOnly(b);
  assert.deepEqual([l.mods, l.arcanes, l.shards, l.exilus, l.forma, l.note], [[], [], [], undefined, undefined, undefined]);
  assert.deepEqual([l.title, l.author, l.tags, l.source], [b.title, b.author, b.tags, b.source]);
});

test("Nox's Frame's list in words: days, card dates, a stale copy, the saved build from a page", async () => {
  const { dayOf, listedAt, copyLine, savedFrom } = await import("../src/lib/core/buildsPage");
  assert.equal(dayOf(Date.parse("2026-11-03T23:30:00Z")), "3 Nov 2026");
  assert.equal(listedAt("2026-11-01"), Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(listedAt("Nov 1"), null);
  assert.equal(listedAt(null), null);
  assert.equal(copyLine({ stale: false, fetchedAt: NOW }), null);
  assert.equal(copyLine({ stale: true, fetchedAt: Date.parse("2026-10-27T10:00:00Z") }), "Showing a copy from 27 Oct 2026");
  assert.equal(copyLine({ stale: true, error: "Error: timed out", fetchedAt: Date.parse("2026-10-27T10:00:00Z") }), "Showing a copy from 27 Oct 2026: Nox's Frame didn't answer (timed out)");
  const url = "https://noxsframe.com/builds/abc-x";
  const kept = build({ source: { url, site: "Nox's Frame" } });
  assert.equal(savedFrom([build(), kept], url), kept);
  assert.equal(savedFrom([build()], url), undefined);
});
