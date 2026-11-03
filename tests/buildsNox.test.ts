// Nox's Frame (src/lib/core/builds/noxsframe.ts): mapping its builds to orbiter's, reading only on
// demand, the permission gate, pasted build codes, and the setting.
//
// tests/fixtures/noxsframe/read.json is what the Rust side reads from the saved pages beside it
// (trimmed real pages, authors replaced); src-tauri/src/noxsframe.rs checks it matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
  BLOCKED_HOSTS,
  NOX_MODES,
  NOX_PERMISSION,
  looksLikeNoxCode,
  makeNox,
  noxItems,
  noxToBuild,
  parseNoxCode,
  registerSource,
  sanitizeBuilds,
  sourceBuilds,
  unregisterSource,
  type NoxAnswer,
  type NoxFetcher,
  type NoxListing,
  type NoxPage,
} from "../src/lib/core/builds";
import type { CatalogItem } from "../src/lib/core/types";

const READ = JSON.parse(readFileSync(new URL("./fixtures/noxsframe/read.json", import.meta.url), "utf8")) as { list: NoxListing[]; mirage: NoxPage; nukor: NoxPage };
const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = 86_400_000;

const MIRAGE = "/Lotus/Powersuits/Harlequin/MiragePrime";
const GLAIVE = "/Lotus/Weapons/Tenno/Melee/Glaives/PrimeGlaive/PrimeGlaiveWeapon";
const NUKOR = "/Lotus/Weapons/Grineer/KuvaLich/Secondaries/Nukor/KuvaNukor";
/** Left out of the catalog on purpose: it must come back as a note, not a guess. */
const UMBRAL_INTENSIFY = "/Lotus/Upgrades/Mods/Sets/Umbra/WarframeUmbraModC";

type Sec = { slots?: { modId: string | null }[]; aura?: { modId: string | null }; exilus?: { modId: string | null }; stance?: { modId: string | null }; arcanes?: { arcaneId: string | null }[]; arcane?: { arcaneId: string | null } };
/** A catalog with every mod and arcane the two saved builds use (but Umbral Intensify), and their items. */
function catalog(): Map<string, CatalogItem> {
  const items: CatalogItem[] = [
    { uniqueName: MIRAGE, name: "Mirage Prime", category: "Warframes", type: "Warframe", productCategory: "Suits", abilities: [{ name: "Hall Of Mirrors" }, { name: "Sleight Of Hand" }, { name: "Eclipse" }, { name: "Prism" }] },
    { uniqueName: GLAIVE, name: "Glaive Prime", category: "Melee", type: "Melee", productCategory: "Melee" },
    { uniqueName: NUKOR, name: "Kuva Nukor", category: "Secondary", type: "Pistol", productCategory: "Pistols" },
    { uniqueName: "/Lotus/Powersuits/BrokenFrame/BrokenFrame", name: "Xaku", category: "Warframes", productCategory: "Suits", abilities: [{ name: "Xata's Whisper" }, { name: "Grasp Of Lohk" }] },
  ];
  for (const page of [READ.mirage, READ.nukor]) {
    for (const sec of Object.values(page.build as Record<string, Sec | null>)) {
      if (!sec || typeof sec !== "object") continue;
      for (const m of [sec.aura, sec.exilus, sec.stance, ...(sec.slots ?? [])]) {
        if (m?.modId && m.modId !== UMBRAL_INTENSIFY) items.push({ uniqueName: m.modId, name: m.modId.split("/").pop()!, category: "Mods" });
      }
      for (const a of [...(sec.arcanes ?? []), sec.arcane]) if (a?.arcaneId) items.push({ uniqueName: a.arcaneId, name: a.arcaneId.split("/").pop()!, category: "Arcanes" });
    }
  }
  return new Map(items.map((c) => [c.uniqueName, c]));
}
const CAT = catalog();
const ctx = (maxAgeDays = 365) => ({ catalog: CAT, maxAgeDays, now: NOW });

/** A build code unpacked as the Rust side does (zlib, base64url). */
const decode = async (code: string) => JSON.parse(inflateSync(Buffer.from(code.replace(/^NFB1:/, ""), "base64url")).toString("utf8"));

// ---------------------------------------------------------------- mapping

test("a Nox's Frame warframe build becomes orbiter's, with what it can't carry over in the note", () => {
  const got = noxToBuild(READ.mirage.build, CAT.get(MIRAGE)!, CAT, { page: READ.mirage, now: NOW })!;
  const b = got.build;
  assert.equal(b.kind, "warframe");
  assert.equal(b.id, "nox-02OZ99LT_8kP-warframe");
  assert.equal(b.title, "Mirage Prime - Glaive Prime Build");
  assert.deepEqual(b.source, { url: "https://noxsframe.com/builds/02OZ99LT_8kP-mirage-prime-glaive-prime-build", site: "Nox's Frame" });
  assert.equal(b.author, "Author One");
  assert.equal(b.votes, 0);
  assert.equal(b.updatedAt, Date.parse("2026-11-01T10:17:41.148Z"));
  assert.equal(b.importedAt, NOW);
  assert.deepEqual(b.tags, ["All-round", "Steel Path", "Archon Hunt", "Farming"]);
  assert.deepEqual(b.aura, { path: "/Lotus/Upgrades/Mods/Aura/FairyQuest/FairyQuestCritToAbilityAuraMod", rank: 5 });
  assert.deepEqual(b.exilus, { path: "/Lotus/Upgrades/Mods/OrokinChallenge/OrokinChallengeModPower", rank: 5 });
  assert.equal(b.stance, undefined, "frames have no stance");
  assert.equal(b.mods.length, 8);
  assert.deepEqual(b.mods[0], { path: "/Lotus/Upgrades/Mods/Warframe/AvatarInvulnOnRollMod", rank: 10 });
  assert.equal(b.mods[6], null, "a mod orbiter's catalog lacks is left empty…");
  assert.ok(got.notes.some((n) => n.includes("WarframeUmbraModC") && n.startsWith("Slot 7")), "…and said in the note");
  assert.equal(b.polarities?.aura, "madurai");
  assert.deepEqual(b.polarities?.mods, ["vazarin", "naramon", "naramon", "madurai", "madurai", "naramon", null, "vazarin"]);
  assert.deepEqual(b.arcanes.map((a) => a.path.split("/").pop()), ["PowerStrengthOnKill", "GolemArcaneMeleeDamageOnCrit"]);
  assert.equal(b.shards.length, 5);
  assert.deepEqual(b.shards[0], { colour: "violet", tauforged: false });
  assert.ok(got.notes.some((n) => n.includes("violet #2")), "shard stats are kept as Nox's numbers, not named");
  assert.equal(b.helminth, undefined, "a Helminth ability orbiter can't name isn't guessed");
  assert.ok(got.notes.some((n) => n.includes('"BrokenRotAbility" replaces Sleight Of Hand')), "the slot it replaces is named from the catalog");
  assert.equal(b.catalyst, true);
  assert.ok(got.notes.some((n) => n.includes("Forma budget set on Nox's Frame: 5")));
  assert.match(b.note ?? "", /Author's notes: Mirage Prime as a buff platform/);
  assert.ok((b.note ?? "").length <= 4000);
  // It saves and comes back the same.
  assert.deepEqual(sanitizeBuilds([b])[0], b);
});

test("the same page gives the weapon its own build, and a page without the item gives none", () => {
  const glaive = noxToBuild(READ.mirage.build, CAT.get(GLAIVE)!, CAT, { page: READ.mirage, now: NOW })!.build;
  assert.equal(glaive.kind, "melee");
  assert.equal(glaive.id, "nox-02OZ99LT_8kP-melee");
  assert.deepEqual(glaive.stance, { path: "/Lotus/Weapons/Tenno/Melee/MeleeTrees/GlaiveCmbTwoMeleeTree", rank: 3 });
  assert.equal(glaive.polarities?.stance, "naramon");
  assert.deepEqual(glaive.arcanes, [{ path: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/ReplayLightCritHits", rank: 5 }]);
  assert.equal(glaive.shards.length, 0);
  assert.equal(noxToBuild(READ.mirage.build, CAT.get(NUKOR)!, CAT, { page: READ.mirage }), null);
  assert.deepEqual(noxItems(READ.mirage.build), [["warframe", MIRAGE], ["melee", GLAIVE]]);

  const nukor = noxToBuild(READ.nukor.build, CAT.get(NUKOR)!, CAT, { page: READ.nukor, now: NOW })!;
  assert.equal(nukor.build.kind, "secondary");
  assert.equal(nukor.build.mods.filter(Boolean).length, 8);
  assert.equal(nukor.build.catalyst, true);
  assert.deepEqual(nukor.build.tags, ["All-round", "Endurance", "Farming"]);
  assert.equal(nukor.notes.length, 0, "nothing left out");
  assert.equal(nukor.build.note, undefined, "no notes and no description: no note");
});

test("the site's game modes are its tags, verbatim", () => {
  assert.equal(Object.keys(NOX_MODES).length, 11);
  for (const page of [READ.mirage, READ.nukor]) page.modes.forEach((k, i) => assert.equal(NOX_MODES[k], page.tags[i]));
  for (const l of READ.list) for (const t of l.tags) assert.ok(Object.values(NOX_MODES).includes(t), t);
});

test("build tags are sanitised: trimmed, short, no repeats", () => {
  const [b] = sanitizeBuilds([{ id: "t", item: NUKOR, kind: "secondary", mods: [], source: "pasted", importedAt: NOW, tags: [" Steel Path ", "Steel Path", 3, "", "x".repeat(60)] }]);
  assert.deepEqual(b.tags, ["Steel Path", "x".repeat(40)]);
  assert.equal(sanitizeBuilds([{ id: "u", item: NUKOR, kind: "secondary", mods: [], source: "pasted", importedAt: NOW, tags: "Steel Path" }])[0].tags, undefined);
});

// ---------------------------------------------------------------- on demand only

/** A fake Rust side: the list for Mirage Prime (the saved one, plus older and extra cards), the Mirage page kept. */
function fakeFetcher(kept = new Set(["02OZ99LT_8kP-mirage-prime-glaive-prime-build"])) {
  const calls: string[] = [];
  const answer = <T>(data: T, fromCache = false): NoxAnswer<T> => ({ fetchedAt: NOW, fromCache, stale: false, data });
  const pages: Record<string, NoxPage> = { [READ.mirage.path]: READ.mirage, [READ.nukor.path]: READ.nukor };
  const old: NoxListing = { ...READ.list[3], path: "aaaaaaaaaaaa-old", url: "https://noxsframe.com/builds/aaaaaaaaaaaa-old", date: "2024-01-01" };
  const many: NoxListing[] = Array.from({ length: 12 }, (_, i) => ({ ...READ.list[3], path: `zzzzzzzzzzz${i}-x`, url: `https://noxsframe.com/builds/zzzzzzzzzzz${i}-x` }));
  const fetcher: NoxFetcher = {
    async list(item, refresh) {
      calls.push(`list ${item}${refresh ? " refresh" : ""}`);
      return answer([READ.list[3], old, ...many]);
    },
    async build(path, opts = {}) {
      calls.push(`build ${path}${opts.cachedOnly ? " cached" : ""}${opts.refresh ? " refresh" : ""}`);
      if (opts.cachedOnly) return kept.has(path) ? answer(pages[path], true) : null;
      kept.add(path);
      return answer(pages[path] ?? READ.mirage);
    },
    async decode(code) {
      return decode(code);
    },
  };
  return { fetcher, calls };
}

test("turned off, nothing is read", async () => {
  const { fetcher, calls } = fakeFetcher();
  const nox = makeNox(fetcher, () => false);
  assert.deepEqual(await nox.source.builds(CAT.get(MIRAGE)!, ctx()), []);
  await assert.rejects(nox.listing(CAT.get(MIRAGE)!, ctx()), /off/);
  await assert.rejects(nox.open(CAT.get(MIRAGE)!, READ.mirage.path, ctx()), /off/);
  assert.deepEqual(calls, []);
});

test("opening an item's builds reads its list once; a build's page only when it's opened", async () => {
  const { fetcher, calls } = fakeFetcher(new Set());
  const nox = makeNox(fetcher, () => true);
  const mirage = CAT.get(MIRAGE)!;
  // The source: the list, and no page that isn't kept already.
  assert.deepEqual(await nox.source.builds(mirage, ctx()), []);
  assert.equal(calls.filter((c) => c.startsWith("list")).length, 1);
  assert.ok(calls.filter((c) => c.startsWith("build")).every((c) => c.endsWith(" cached")), "never a page from the network");

  const list = await nox.listing(mirage, ctx());
  assert.equal(list.entries.length, 9, "ten at most, less the one past the age limit");
  assert.equal(list.hiddenByAge, 1);
  assert.equal(list.entries[0].path, READ.mirage.path, "the site's order: top-voted first");
  assert.equal(list.entries[0].opened, false);

  calls.length = 0;
  const got = await nox.open(mirage, READ.mirage.path, ctx());
  assert.deepEqual(calls, [`build ${READ.mirage.path}`], "one page, for the build opened");
  assert.equal(got.build.item, MIRAGE);

  // Now kept: the source gives it with no page read from the network.
  calls.length = 0;
  const builds = await nox.source.builds(mirage, ctx());
  assert.deepEqual(builds.map((b) => b.id), ["nox-02OZ99LT_8kP-warframe"]);
  assert.ok(calls.filter((c) => c.startsWith("build")).every((c) => c.endsWith(" cached")));
  assert.equal((await nox.listing(mirage, ctx())).entries[0].opened, true);

  // Refresh asks again (the Rust side spaces it).
  calls.length = 0;
  await nox.listing(mirage, ctx(), { refresh: true });
  await nox.open(mirage, READ.mirage.path, ctx(), { refresh: true });
  assert.ok(calls.includes(`list ${MIRAGE} refresh`) && calls.includes(`build ${READ.mirage.path} refresh`));

  // A build without the item is said so.
  await assert.rejects(nox.open(CAT.get(NUKOR)!, READ.mirage.path, ctx()), /doesn't include Kuva Nukor/);
});

test("the age filter applies to the list and to opened builds", async () => {
  const { fetcher } = fakeFetcher();
  const nox = makeNox(fetcher, () => true);
  const later = { catalog: CAT, maxAgeDays: 30, now: NOW + 60 * DAY };
  assert.deepEqual(await nox.source.builds(CAT.get(MIRAGE)!, later), [], "updated 2 months before: hidden");
  assert.equal((await nox.listing(CAT.get(MIRAGE)!, { ...later, maxAgeDays: 0 })).hiddenByAge, 0, "0: no limit");
});

// ---------------------------------------------------------------- permission

test("Nox's Frame registers on its terms; a terms record works for no other site", async () => {
  const none = async () => [];
  const nox = makeNox(fakeFetcher().fetcher, () => true);
  registerSource(nox.source);
  const got = await sourceBuilds(CAT.get(MIRAGE)!, ctx());
  assert.deepEqual(got.builds.map((b) => b.id), ["nox-02OZ99LT_8kP-warframe"]);
  assert.deepEqual(got.errors, []);
  unregisterSource(nox.source.id);

  for (const host of BLOCKED_HOSTS) {
    assert.throws(() => registerSource({ id: host, label: host, network: true, permission: { ...NOX_PERMISSION, host }, builds: none }), /terms aren't on record|forbids/);
  }
  assert.throws(() => registerSource({ id: "example.com", label: "Example", network: true, permission: { ...NOX_PERMISSION, host: "example.com" }, builds: none }), /terms aren't on record/);
  assert.throws(() => registerSource({ id: "overframe.gg", label: "Overframe", network: true, permission: NOX_PERMISSION, builds: none }), /not this source's/);
  assert.throws(() => registerSource({ id: "noxsframe.com", label: "Nox", network: true, permission: { ...NOX_PERMISSION, checked: "" }, builds: none }), /terms aren't on record/);
  assert.throws(() => registerSource({ id: "noxsframe.com", label: "Nox", network: true, permission: { ...NOX_PERMISSION, note: "" }, builds: none }), /terms aren't on record/);
});

// ---------------------------------------------------------------- pasted codes

test("a pasted build code reads like a fetched one, for the item asked about", async () => {
  assert.ok(looksLikeNoxCode(`  ${READ.nukor.code}\n`));
  assert.ok(!looksLikeNoxCode("Serration, Split Chamber"));
  const got = await parseNoxCode(READ.nukor.code, CAT.get(NUKOR)!, CAT, decode, NOW);
  assert.equal(got.build.source, "pasted");
  assert.equal(got.build.kind, "secondary");
  assert.equal(got.build.mods.filter(Boolean).length, 8);
  assert.deepEqual(got.others, []);
  const glaive = await parseNoxCode(READ.mirage.code, CAT.get(GLAIVE)!, CAT, decode, NOW);
  assert.deepEqual(glaive.others, ["Mirage Prime"]);
  assert.match(glaive.build.note ?? "", /Author's notes: Rotation/, "the code's own notes, without a page");
  await assert.rejects(parseNoxCode(READ.mirage.code, CAT.get(NUKOR)!, CAT, decode), /has no Kuva Nukor; it has Mirage Prime, Glaive Prime/);
  await assert.rejects(parseNoxCode("hello", CAT.get(NUKOR)!, CAT, decode), /isn't a Nox's Frame build code/);
});

// ---------------------------------------------------------------- the setting

test("reading Nox's Frame is on unless turned off", async () => {
  const { loadSettings, defaultSettings } = await import("../src/lib/backend");
  assert.equal(defaultSettings().buildsFromNox, true);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ buildsFromNox: false }) };
  assert.equal((await loadSettings()).buildsFromNox, false);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ buildsFromNox: "yes" }) };
  assert.equal((await loadSettings()).buildsFromNox, true);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({}) };
  assert.equal((await loadSettings()).buildsFromNox, true, "settings from before it: on");
});

test("the list's age filter goes by the card's date; no date or no limit keeps it", async () => {
  const { noxListedWithinAge } = await import("../src/lib/core/builds");
  assert.equal(noxListedWithinAge({ date: "2026-11-01" }, 30, NOW), true);
  assert.equal(noxListedWithinAge({ date: "2025-01-01" }, 30, NOW), false);
  assert.equal(noxListedWithinAge({ date: "2025-01-01" }, 0, NOW), true);
  assert.equal(noxListedWithinAge({ date: null }, 30, NOW), true);
});
