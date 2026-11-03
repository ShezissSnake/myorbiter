// Builds core (src/lib/core/builds): the saved shape and its sanitiser, the settings, the age
// filter and favourites, and the source interface.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgeDays,
  buildsFor,
  filterByAge,
  polarityOf,
  registerSource,
  removeBuild,
  sanitizeBuilds,
  sanitizeMaxAgeDays,
  saveBuild,
  sourceBuilds,
  toggleFavourite,
  unregisterSource,
  withinAge,
  type Build,
} from "../src/lib/core/builds";
import { CAT, item, P, build, NOW, DAY } from "./support/buildsCatalog";

// ---------------------------------------------------------------- storage

test("saved builds are sanitised: broken ones dropped, odd fields cleaned, ids made unique", () => {
  const raw = [
    { id: "a", item: P.braton, kind: "primary", mods: [{ path: P.serration, rank: 7 }, null, { path: 3 }], arcanes: [{ path: P.merciless, rank: 4.6 }], shards: [{ colour: "azure", tauforged: true, stat: "Health" }, { colour: "pink" }], source: { url: "https://example.com/b/1", site: "Example" }, importedAt: NOW, polarities: { aura: "aura", mods: ["madurai", "nonsense"] }, favourite: true },
    { id: "a", item: P.rhino, kind: "warframe", mods: [], source: "orbiter", importedAt: NOW, helminth: { ability: "Nourish", replaces: "Roar" }, forma: -1 },
    { item: P.rhino, kind: "dreadnought" },
    { kind: "warframe" },
    "nonsense",
  ];
  const out = sanitizeBuilds(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].mods, [{ path: P.serration, rank: 7 }, null, null]);
  assert.deepEqual(out[0].arcanes, [{ path: P.merciless, rank: 5 }]);
  assert.deepEqual(out[0].shards, [{ colour: "azure", tauforged: true, stat: "Health" }]);
  assert.deepEqual(out[0].source, { url: "https://example.com/b/1", site: "Example" });
  assert.equal(out[0].polarities?.aura, "universal", "the catalog's \"aura\" polarity is Omni");
  assert.deepEqual(out[0].polarities?.mods, ["madurai", null]);
  assert.equal(out[0].favourite, true);
  assert.notEqual(out[1].id, "a", "a second build with the same id gets its own");
  assert.equal(out[1].source, "orbiter");
  assert.deepEqual(out[1].helminth, { ability: "Nourish", replaces: "Roar" });
  assert.equal(out[1].forma, undefined, "a negative forma count isn't kept");
  assert.deepEqual(sanitizeBuilds({ not: "a list" }), []);
  assert.equal(polarityOf("Madurai"), "madurai");
  assert.equal(polarityOf("omni"), "universal");
  assert.equal(polarityOf("vaporwave"), null);
});

test("the age limit defaults to two years; 0 is no limit; odd values fall back", () => {
  assert.equal(sanitizeMaxAgeDays(undefined), 730);
  assert.equal(sanitizeMaxAgeDays(0), 0);
  assert.equal(sanitizeMaxAgeDays(90.4), 90);
  assert.equal(sanitizeMaxAgeDays(-3), 730);
  assert.equal(sanitizeMaxAgeDays("30"), 730);
});

test("settings carry builds and their age limit; older settings get none and two years", async () => {
  const { loadSettings, defaultSettings } = await import("../src/lib/backend");
  assert.deepEqual(defaultSettings().builds, []);
  assert.equal(defaultSettings().buildsMaxAgeDays, 730);
  const saved = { builds: [{ id: "x", item: P.braton, kind: "primary", mods: [], source: "pasted", importedAt: NOW }, { broken: true }], buildsMaxAgeDays: 30 };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(saved) };
  const s = await loadSettings();
  assert.equal(s.builds.length, 1);
  assert.equal(s.builds[0].id, "x");
  assert.equal(s.buildsMaxAgeDays, 30);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ favourites: [] }) };
  const old = await loadSettings();
  assert.deepEqual(old.builds, []);
  assert.equal(old.buildsMaxAgeDays, 730);
});

// ---------------------------------------------------------------- age, favourites, storage helpers

test("the age filter: a year by default, 0 for none; your own builds are never too old", () => {
  const b = (id: string, days: number, extra: Partial<Build> = {}): Build => ({ ...build(P.braton, []), id, source: "pasted", importedAt: NOW - days * DAY, ...extra });
  const old = b("old", 400);
  const fresh = b("fresh", 10);
  const updated = b("updated", 400, { updatedAt: NOW - 20 * DAY });
  const mine = b("mine", 900, { source: "mine" });
  assert.deepEqual(filterByAge([old, fresh, updated, mine], 365, NOW).map((x) => x.id), ["fresh", "updated", "mine"]);
  assert.equal(withinAge(old, 0, NOW), true);
  assert.equal(buildAgeDays(updated, NOW), 20, "the source's own date counts first");
});

test("favourites first, then newest; saving replaces by id; removing and starring return new arrays", () => {
  const a: Build = { ...build(P.braton, []), id: "a", importedAt: NOW - 2 * DAY };
  const b2: Build = { ...build(P.braton, []), id: "b", importedAt: NOW - DAY };
  const c: Build = { ...build(P.rhino, []), id: "c", importedAt: NOW };
  let list = [a, b2, c];
  assert.deepEqual(buildsFor(list, P.braton).map((x) => x.id), ["b", "a"]);
  list = toggleFavourite(list, "a");
  assert.equal(list[0].favourite, true);
  assert.equal(a.favourite, undefined, "the original isn't changed");
  assert.deepEqual(buildsFor(list, P.braton).map((x) => x.id), ["a", "b"]);
  list = saveBuild(list, { ...b2, title: "new" });
  assert.equal(list.length, 3);
  assert.equal(list[1].title, "new");
  list = saveBuild(list, { ...c, id: "d" });
  assert.equal(list[0].id, "d");
  assert.deepEqual(removeBuild(list, "a").map((x) => x.id), ["d", "b", "c"]);
});

// ---------------------------------------------------------------- sources

test("a network source needs the site's permission on record; Overframe and the wiki need theirs", async () => {
  const none = async () => [];
  assert.throws(() => registerSource({ id: "somesite", label: "Some site", network: true, builds: none }), /permission/);
  assert.throws(() => registerSource({ id: "overframe.gg", label: "Overframe", network: true, permission: { host: "example.com", grantedBy: "x", on: "2026-11-03" }, builds: none }), /overframe\.gg forbids/);
  registerSource({ id: "overframe.gg", label: "Overframe", network: true, permission: { host: "overframe.gg", grantedBy: "MOBA", on: "2027-01-01" }, builds: none });
  unregisterSource("overframe.gg");
  registerSource({ id: "orbiter", label: "orbiter's suggestions", network: false, builds: async () => [build(P.braton, [P.serration])] });
  registerSource({ id: "broken", label: "Broken", network: false, builds: async () => { throw new Error("nope"); } });
  const got = await sourceBuilds(item(P.braton), { catalog: CAT, maxAgeDays: 365, now: NOW });
  assert.equal(got.builds.length, 1);
  assert.deepEqual(got.errors.map((e) => e.source), ["broken"]);
  unregisterSource("orbiter");
  unregisterSource("broken");
});
