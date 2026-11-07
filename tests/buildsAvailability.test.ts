// Builds: mod and arcane availability (availability.ts) and the progression tier (tierOf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  availability,
  availabilityOf,
  dropsLevel,
  hardDonorOf,
  sourceLevel,
  tierOf,
  type Build,
} from "../src/lib/core/builds";
import data from "../src/lib/data/mod-availability.json";
import type { CatalogItem } from "../src/lib/core/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] };
const catalog = fixture.catalog;
const CAT = new Map(catalog.map((c) => [c.uniqueName, c]));
/** The plain copy of a mod or arcane by name (not the starter, Conclave or /Expert/ twins). */
const named = (name: string) => {
  const all = catalog.filter((c) => c.name === name && (c.category === "Mods" || c.category === "Arcanes"));
  const x = all.find((c) => !/\/(Beginner|Intermediate|Expert|PvPMods)\//.test(c.uniqueName)) ?? all[0];
  assert.ok(x, `${name} in the fixture`);
  return x;
};
const gear = (name: string) => {
  const x = catalog.find((c) => c.name === name && c.category !== "Mods" && c.category !== "Arcanes");
  assert.ok(x, `${name} in the fixture`);
  return x;
};
const level = (name: string) => availabilityOf(named(name));

// ---------------------------------------------------------------- the classifier

test("availability: well-known mods", () => {
  assert.equal(level("Primed Flow"), "veteran");
  assert.equal(level("Overextended"), "intermediate");
  assert.equal(level("Blind Rage"), "intermediate");
  assert.equal(level("Narrow Minded"), "intermediate");
  assert.equal(level("Serration"), "new");
  assert.equal(level("Umbral Intensify"), "veteran");
  assert.equal(level("Molt Augmented"), "intermediate");
});

test("availability: families by path and name, each with its reason", () => {
  assert.deepEqual([availability(named("Primed Flow")).rule, availability(named("Primed Flow")).why], ["primed", "Primed, from Baro Ki'Teer"]);
  assert.equal(availability(named("Umbral Vitality")).rule, "umbral");
  assert.equal(availability(named("Archon Intensify")).rule, "archon");
  assert.equal(level("Archon Intensify"), "veteran");
  assert.equal(availability(named("Galvanized Chamber")).rule, "galvanized");
  assert.equal(level("Galvanized Chamber"), "veteran");
  assert.equal(level("Amalgam Serration"), "veteran");
  assert.equal(availability(named("Overextended")).rule, "corrupted");
  assert.equal(availability(named("Ironclad Charge")).rule, "augment");
  assert.equal(level("Ironclad Charge"), "intermediate");
  assert.equal(availability(named("Power Drift")).rule, "drift");
  assert.equal(level("Power Drift"), "intermediate");
});

test("availability: spy-vault rewards are intermediate, common drops new, endgame drops veteran", () => {
  const rime = availability(named("Rime Rounds"));
  assert.equal(rime.level, "intermediate");
  assert.equal(rime.why, "a spy-vault reward");
  for (const n of ["Vitality", "Intensify", "Streamline", "Flow", "Redirection", "Point Blank", "Hornet Strike", "Split Chamber"]) assert.equal(level(n), "new", n);
  // Adaptation drops only in Arbitrations.
  assert.equal(level("Adaptation"), "veteran");
});

test("availability: arcanes are never new; Eidolon and Steel Path ones are veteran", () => {
  assert.equal(level("Arcane Energize"), "veteran");
  assert.equal(level("Arcane Grace"), "veteran");
  assert.equal(level("Primary Merciless"), "veteran", "Acolytes spawn in Steel Path missions");
  assert.equal(level("Molt Efficiency"), "intermediate");
  assert.equal(level("Molt Vigor"), "intermediate");
  for (const a of catalog.filter((c) => c.category === "Arcanes")) assert.notEqual(availabilityOf(a), "new", a.name);
});

test("availability: gear that isn't a mod or an arcane is new", () => {
  assert.equal(availabilityOf(gear("Rhino Prime")), "new");
});

test("drop sources: early planets and common enemies new, spy and open worlds intermediate, endgame veteran", () => {
  assert.equal(sourceLevel("Mercury/Apollodorus (Survival), Rotation B"), "new");
  assert.equal(sourceLevel("Saturn/Titan (Survival), Rotation B"), "new");
  assert.equal(sourceLevel("Electric Crawler"), "new");
  assert.equal(sourceLevel("Earth/Cambria (Spy), Rotation C"), "intermediate");
  assert.equal(sourceLevel("Derelict Vault"), "intermediate");
  assert.equal(sourceLevel("Earth/Cetus (Level 15 - 25 Ghoul Bounty), Rotation A"), "intermediate");
  assert.equal(sourceLevel("Sedna/Selkie (Survival), Rotation B"), "intermediate");
  assert.equal(sourceLevel("Uranus - Rosalind"), "intermediate");
  assert.equal(sourceLevel("Void Angel"), "intermediate");
  assert.equal(sourceLevel("Thermic Raknoid"), "intermediate");
  assert.equal(sourceLevel("Arbitrations, Rotation B"), "veteran");
  assert.equal(sourceLevel("Eidolon Hydrolyst (Capture)"), "veteran");
  assert.equal(sourceLevel("Deep Archimedea Gold Rewards"), "veteran");
  assert.equal(sourceLevel("The Descendia: Uncommon Rewards (Steel Path)"), "veteran");
  assert.equal(sourceLevel("Angst (Level 0 - 100)"), "veteran");
  // The easiest source decides.
  assert.equal(dropsLevel([{ location: "Arbitrations, Rotation A", chance: 1, rarity: "Rare" }, { location: "Lancer", chance: 1, rarity: "Common" }]), "new");
  assert.equal(dropsLevel([]), null);
});

test("availability: the eight-drop catalog doesn't hide a common drop (fullDrops)", () => {
  // Serration's eight best drops are all spy vaults; its full table has enemies everywhere.
  const s = named("Serration");
  assert.ok((s.drops ?? []).every((d) => /\(Spy\)/.test(d.location)), "the fixture's eight are spy vaults");
  assert.equal(availability(s).level, "new");
  const full = (data as { fullDrops: { levels: Record<string, string> } }).fullDrops.levels;
  assert.equal(full[s.uniqueName], "new");
  for (const [path, l] of Object.entries(full)) {
    assert.ok(path.startsWith("/Lotus/"), path);
    assert.ok(["new", "intermediate", "veteran"].includes(l), `${path}: ${l}`);
  }
});

test("the data file: corrupted mods and overrides name real mods, every override has a source", () => {
  const d = data as unknown as { corrupted: string[]; overrides: Record<string, { level: string; why: string; source: string }>; sources: Record<string, string> };
  assert.equal(d.corrupted.length, 24, "the wiki lists 24 Corrupted mods");
  for (const [k, o] of Object.entries(d.overrides)) {
    assert.ok(["new", "intermediate", "veteran"].includes(o.level), k);
    assert.ok(o.why && o.source, `${k}: why and source`);
  }
  for (const [k, s] of Object.entries(d.sources)) assert.ok(/^https:\/\//.test(s) || /^MyOrbiter's rule/.test(s), `${k}: ${s}`);
});

const hasBundle = existsSync(new URL("../public/dev-bundle.json", import.meta.url));
test("real catalog: the corrupted list and overrides are catalog names", { skip: !hasBundle && "public/dev-bundle.json not present" }, () => {
  const b = JSON.parse(readFileSync(new URL("../public/dev-bundle.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] };
  const names = new Set(b.catalog.map((c) => c.name));
  const d = data as unknown as { corrupted: string[]; overrides: Record<string, unknown> };
  for (const n of [...d.corrupted, ...Object.keys(d.overrides)]) assert.ok(names.has(n), n);
});

test("Helminth: Nourish comes from Grendel, a hard donor; Roar doesn't", () => {
  assert.equal(hardDonorOf("Nourish")?.frame, "Grendel");
  assert.equal(hardDonorOf("roar"), null);
  assert.equal(hardDonorOf(null), null);
});

// ---------------------------------------------------------------- the progression tier

const blank = (item: CatalogItem, mods: string[], extra: Partial<Build> = {}): Build => ({
  id: "t",
  item: item.uniqueName,
  kind: item.category === "Warframes" ? "warframe" : "primary",
  mods: [...mods.map((n) => ({ path: named(n).uniqueName })), ...Array(Math.max(0, 8 - mods.length)).fill(null)],
  arcanes: [],
  shards: [],
  source: "mine",
  importedAt: 0,
  ...extra,
});

test("tierOf: basic mods that fit in 30 are New player, and say so", () => {
  const rhino = gear("Rhino Prime");
  const t = tierOf(blank(rhino, ["Vitality", "Intensify"]), rhino, CAT);
  assert.equal(t.tier, "low");
  assert.equal(t.capacityTier, "low");
  assert.deepEqual(t.limits, []);
  assert.match(t.reasons[0], /^New player: basic mods only, and it fits without a Reactor\.$/);
  assert.match(t.reasons[1], /^Fits in 30/, "the capacity reason follows");
});

test("tierOf: a Corrupted mod makes it Intermediate even when it fits in 30", () => {
  const rhino = gear("Rhino Prime");
  const t = tierOf(blank(rhino, ["Vitality", "Overextended"]), rhino, CAT);
  assert.equal(t.capacityTier, "low");
  assert.equal(t.tier, "medium");
  assert.equal(t.reasons[0], "Uses Overextended (a Corrupted mod, from Orokin Derelict vaults), which is Intermediate.");
});

test("tierOf: a Reactor or Forma is Intermediate; Primed and Umbral mods, Umbra Forma, shards are Veteran", () => {
  const rhino = gear("Rhino Prime");
  const big = tierOf(blank(rhino, ["Vitality", "Intensify", "Streamline", "Flow", "Redirection", "Stretch"]), rhino, CAT);
  assert.notEqual(big.capacityTier, "low");
  assert.equal(big.tier, "medium");
  assert.ok(big.limits.some((l) => l.kind === "doubler" && l.tier === "medium"));
  const primed = tierOf(blank(rhino, ["Vitality", "Primed Flow"]), rhino, CAT);
  assert.equal(primed.tier, "high");
  assert.equal(primed.reasons[0], "Uses Primed Flow (Primed, from Baro Ki'Teer), which is Veteran.");
  const umbral = tierOf(blank(rhino, ["Umbral Vitality", "Umbral Fiber", "Umbral Intensify", "Primed Continuity", "Intensify", "Streamline", "Vitality", "Flow"]), rhino, CAT);
  assert.equal(umbral.tier, "high");
  assert.ok(umbral.limits.some((l) => l.kind === "umbraForma" && l.tier === "high"), "Umbra Forma is Veteran");
  const shards = tierOf(blank(rhino, ["Vitality"], { shards: [{ colour: "crimson", tauforged: true }] }), rhino, CAT);
  assert.equal(shards.tier, "high");
  assert.match(shards.reasons[0], /Archon Shard .*Veteran/);
});

test("tierOf: an exilus mod, the Helminth and arcanes need Intermediate; Nourish (Grendel) Veteran", () => {
  const saryn = gear("Saryn Prime");
  const ex = tierOf(blank(saryn, ["Intensify"], { exilus: { path: named("Power Drift").uniqueName } }), saryn, CAT);
  assert.equal(ex.tier, "medium");
  assert.ok(ex.limits.some((l) => l.kind === "exilusAdapter"));
  const helm = tierOf(blank(saryn, ["Intensify"], { helminth: { ability: "Roar", replaces: "Molt" } }), saryn, CAT);
  assert.equal(helm.tier, "medium");
  const nourish = tierOf(blank(saryn, ["Intensify"], { helminth: { ability: "Nourish", replaces: "Molt" } }), saryn, CAT);
  assert.equal(nourish.tier, "high");
  assert.match(nourish.reasons[0], /Nourish on the Helminth .*Grendel.*Veteran/);
  const molt = tierOf(blank(saryn, ["Intensify"], { arcanes: [{ path: named("Molt Augmented").uniqueName }] }), saryn, CAT);
  assert.equal(molt.tier, "medium");
  const energize = tierOf(blank(saryn, ["Intensify"], { arcanes: [{ path: named("Arcane Energize").uniqueName }] }), saryn, CAT);
  assert.equal(energize.tier, "high");
});

test("tierOf: a weapon's Arcane Adapter is Veteran (Steel Path Honors)", () => {
  const soma = gear("Soma Prime");
  const t = tierOf(blank(soma, ["Serration"], { kind: "primary", arcanes: [{ path: named("Molt Augmented").uniqueName }] }), soma, CAT);
  assert.equal(t.arcaneAdapter, true);
  assert.equal(t.tier, "high");
  assert.ok(t.limits.some((l) => l.kind === "arcaneAdapter" && /Steel Path Honors/.test(l.why)));
});

test("tierOf: limits are listed highest first, capacity facts kept", () => {
  const rhino = gear("Rhino Prime");
  const t = tierOf(blank(rhino, ["Overextended", "Primed Flow", "Blind Rage"]), rhino, CAT);
  assert.deepEqual(t.limits.map((l) => l.tier), ["high", "medium", "medium"]);
  assert.equal(typeof t.drain, "number");
  assert.ok(t.slots.length >= 3);
});
