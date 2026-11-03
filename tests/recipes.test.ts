// Modular recipes (recipes.ts): part combos with stats from the bundled wiki snapshot, ranked for a
// goal, with what you hold. Expected stats are read straight off Module:Modular/data's tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildModel } from "../src/lib/core/model";
import { goalsFor, kitgunStats, recipeItem, recipeItems, recipesFor, zawStats, RANKING_LABEL, type Holdings } from "../src/lib/core/recipes";
import { wikiFile } from "./wikiFiles";
import paths from "../src/lib/data/modular-parts-paths.json";
import type { GearCopy } from "../src/lib/core/notNeeded";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const parts = wikiFile("modular-parts.json") as { KitgunSecondary: { Loader: Record<string, unknown> }; Zaw: { Link: Record<string, unknown> } };

const CATCHMOON = "/Lotus/Weapons/SolarisUnited/Secondary/SUModularSecondarySet1/Barrel/SUModularSecondaryBarrelAPart";
const GIBBER = "/Lotus/Weapons/SolarisUnited/Secondary/SUModularSecondarySet1/Handle/SUModularSecondaryHandleDPart";
const KILLSTREAM = "/Lotus/Weapons/SolarisUnited/Secondary/SUModularSecondarySet1/Clip/SUModularCritIIReloadIClipPart";

const holding = (held: Record<string, number>, gear: GearCopy[] | null = null): Holdings => ({ held: (u) => held[u] ?? 0, gear });

test("a kitgun's stats are the chamber's for its grip, plus the loader's", () => {
  // Catchmoon (secondary) with Gibber: Heat 119 + Impact 41, 3.17/s; Killstream: +14% crit, +0.3x,
  // −8% status, a Low magazine (7), 1.3 s reload.
  const k = kitgunStats("secondary", "Catchmoon", "Gibber", "Killstream")!;
  assert.equal(k.damage, 160);
  assert.equal(k.fireRate, 3.17);
  assert.equal(k.critChance, 0.35);
  assert.equal(k.critMultiplier, 2.3);
  assert.equal(k.statusChance, 0.13);
  assert.equal(k.magazine, 7);
  assert.equal(k.reload, 1.3);
  // Average hit 160 × (1 + 0.35 × 1.3) = 232.8; × 3.17/s; over 7 shots and the reload.
  assert.equal(k.burstDps, 737.98);
  assert.equal(k.sustainedDps, 464.51);
});

test("pellets, beams' half-ammo ticks and charge time count", () => {
  // Vermisplicer fires 5 pellets.
  const v = kitgunStats("secondary", "Vermisplicer", "Gibber", "Zip")!;
  assert.equal(v.pellets, 5);
  // Gaze (beam, 0.5 ammo a tick) with Zip (Lowest: 23): 46 ticks at 12/s before a 0.9 s reload.
  const g = kitgunStats("secondary", "Gaze", "Gibber", "Zip")!;
  assert.equal(g.magazine, 23);
  const hit = 16 * (1 + 0.25 * 1);
  assert.equal(g.sustainedDps, Math.round(((hit * 46) / (46 / 12 + 0.9)) * 100) / 100);
  // Primary Tombfinger with Brash charges 0.5 s, longer than 1 ÷ 3.77.
  const t = kitgunStats("primary", "Tombfinger", "Brash", "Zip")!;
  assert.equal(t.chargeTime, 0.5);
  assert.equal(t.burstDps, Math.round(38 * 1.24 * 2 * 100) / 100);
  // A grip from the other slot doesn't fit.
  assert.equal(kitgunStats("primary", "Catchmoon", "Gibber", "Zip"), null);
});

test("a zaw's damage, speed and type come from strike, grip and link", () => {
  // Balla 224 + Korb 28 + Ruhang II 28; speed 0.783 + 0.083 − 0.133; one-handed Balla is a Dagger.
  const z = zawStats("Balla", "Korb", "Ruhang II")!;
  assert.equal(z.damage, 280);
  assert.equal(z.attackSpeed, 0.733);
  assert.equal(z.type, "Dagger");
  assert.deepEqual(z.damageTypes, { Impact: 14, Puncture: 168, Slash: 98 });
  // Two-handed Kronsh is a Polearm; Vargeet II links add 14% crit.
  const k = zawStats("Kronsh", "Shtung", "Vargeet II Jai")!;
  assert.equal(k.type, "Polearm");
  assert.equal(k.critChance, 0.32);
  assert.equal(k.statusChance, 0.1);
});

test("items resolve by path or name; whole amps and other gear have no recipes", () => {
  assert.equal(recipeItem(CATCHMOON)?.name, "Catchmoon");
  assert.equal(recipeItem("raplak prism")?.family, "amp");
  assert.equal(recipeItem("Raplak")?.name, "Raplak Prism");
  assert.equal(recipeItem("Para Moa")?.family, "moa");
  assert.equal(recipeItem("Dorma Hound")?.family, "hound");
  assert.equal(recipeItem("/Lotus/Types/Friendly/Pets/CreaturePets/VulpineInfestedCatbrowPetPowerSuit")?.name, "Sly Vulpaphyla");
  assert.equal(recipesFor("Mote Prism"), null);
  assert.equal(recipesFor("Braton"), null);
  // 6 chambers, 11 strikes, 7 prisms, 4 MOAs, 3 Hounds, 3 + 3 subspecies.
  assert.equal(recipeItems().length, 37);
  // Every part in the snapshot has a path.
  const p = paths as unknown as Record<string, Record<string, { u: string }>>;
  for (const loader of Object.keys(parts.KitgunSecondary.Loader)) assert.ok(p.KitgunLoader[loader]?.u, loader);
  for (const link of Object.keys(parts.Zaw.Link)) assert.ok(p.ZawLink[link]?.u, link);
});

test("combos are ranked by the goal, labelled as orbiter's own", () => {
  const r = recipesFor("Catchmoon", "sustained", null, { slot: "secondary" })!;
  assert.equal(r.label, RANKING_LABEL);
  assert.equal(r.combos.length, 5 * 20, "five grips, twenty loaders");
  const dps = r.combos.map((c) => c.stats.find((s) => s.id === "sustainedDps")!.value as number);
  assert.deepEqual(dps, [...dps].sort((a, b) => b - a));
  assert.deepEqual(r.combos.map((c) => c.rank).slice(0, 3), [1, 2, 3]);
  // Both slots unless one is asked for, and an unknown goal falls back to the first.
  assert.equal(recipesFor("Catchmoon", "nonsense")!.combos.length, 200);
  assert.equal(recipesFor("Catchmoon", "nonsense")!.goal.id, "sustained");
  assert.deepEqual(goalsFor("Catchmoon").map((g) => g.id), ["sustained", "burst", "crit", "status"]);
  assert.deepEqual(goalsFor("Balla").map((g) => g.id), ["crit", "status", "heavy", "fast"]);
  // Crit: the highest crit loader first (Killstream or Splat: +14%).
  const crit = recipesFor("Catchmoon", "crit", null, { slot: "secondary" })!.combos[0];
  assert.ok(["Killstream", "Splat"].includes(crit.parts[2].name));
  // Zaw Fast: the fastest grip and link (Peye or Seekalla 1.0, Jai II +0.167).
  const fast = recipesFor("Balla", "fast")!.combos[0];
  assert.match(fast.name, /(Peye|Seekalla) · (Ekwana |Vargeet )?Jai II$/);
  // Heavy attack: the biggest hits, so a +28 grip.
  assert.match(recipesFor("Balla", "heavy")!.combos[0].parts[1].name, /Korb|Shtung/);
});

test("companions rank by a stat, a precept or a polarity", () => {
  // MOA health: Lehan (+7.5%) and Atheca (+10%).
  const moa = recipesFor("Para Moa", "health")!;
  assert.deepEqual(moa.precepts, ["Whiplash Mine", "Anti-Grav Grenade"]);
  assert.equal(moa.combos[0].parts[1].name, "Lehan");
  assert.equal(moa.combos[0].parts[2].name, "Atheca");
  assert.equal(moa.combos[0].score, 0.175);
  assert.equal(recipesFor("Para Moa", "madurai")!.combos[0].parts[3].name, "Jonsin");
  // Hound: a precept goal puts the bracket or stabilizer with it first.
  const hound = recipesFor("Dorma Hound", "precept:Synergized Prospectus")!;
  assert.equal(hound.combos.length, 27);
  assert.equal(hound.combos[0].parts[3].name, "Hinta");
  assert.ok(hound.goals.some((g) => g.id === "precept:Reflex Denial"));
  // Predasite: cheapest is the Rank 1 pair; a polarity goal picks its antigen.
  const pred = recipesFor("Vizier Predasite", "cheapest")!;
  assert.match(pred.role!, /Support/);
  assert.equal(pred.combos[0].name, "Vizier · Leptosam · Iranon");
  assert.equal(pred.combos[0].score, -2500);
  assert.equal(recipesFor("Panzer Vulpaphyla", "penjaga")!.combos[0].parts[2].name, "Poxi");
  // Amps: the brace decides energy and crit; the scaffold, area or single target.
  assert.equal(recipesFor("Raplak", "pool")!.combos[0].parts[2].name, "Suo");
  assert.equal(recipesFor("Raplak", "recharge")!.combos[0].parts[2].name, "Plaga");
  assert.equal(recipesFor("Raplak", "crit")!.combos[0].parts[2].name, "Certus");
  assert.match(recipesFor("Raplak", "single")!.fit!, /Suits single targets/);
});

test("each part says whether you hold it built, as a blueprint, or not, and where to get it", () => {
  const killstreamBp = `${KILLSTREAM}Blueprint`;
  const r = recipesFor(CATCHMOON, "sustained", holding({ [CATCHMOON]: 1, [GIBBER]: 1, [killstreamBp]: 2 }), { slot: "secondary" })!;
  const combo = r.combos.find((c) => c.name === "Catchmoon · Gibber · Killstream")!;
  assert.deepEqual(combo.parts.map((p) => p.status), ["held", "held", "blueprint"]);
  assert.equal(combo.parts[2].blueprints, 2);
  assert.equal(combo.missing, 1);
  assert.ok(combo.parts[0].identifying);
  assert.match(combo.parts[1].where, /Rude Zuud/);
  // Infested parts come from Father; Plague zaw parts from Nakak; Hound parts from Sisters.
  const ulnaris = recipesFor("Sporelacer", null, null, { slot: "secondary" })!.combos.flatMap((c) => c.parts).find((p) => p.name === "Ulnaris")!;
  assert.match(ulnaris.where, /Father/);
  assert.match(recipesFor("Plague Kripath")!.combos[0].parts[0].where, /Plague Star/);
  assert.match(recipesFor("Hec Hound")!.combos[0].parts[1].where, /Sister of Parvos/);
  assert.match(recipesFor("Cantic Prism")!.combos[0].parts[0].where, /Little Duck.*3,000/);
  assert.match(r.how ?? "", /Rude Zuud/);
});

test("ties go to the combo you can build with fewer missing parts", () => {
  // Every MOA bracket gives the same stats: with Gauth in hand, its combo leads the tie.
  const gauth = (paths as unknown as Record<string, Record<string, { u: string }>>).MoaBracket.Gauth.u;
  const r = recipesFor("Para Moa", "health", holding({ [gauth]: 1 }))!;
  assert.equal(r.combos[0].name, "Para · Lehan · Atheca · Gauth");
});

test("a built copy of exactly the combo is marked, in its slot", () => {
  const gear: GearCopy[] = [{ type: CATCHMOON, f: 0, p: 0, s: "Pistols", m: [CATCHMOON, GIBBER, KILLSTREAM] }];
  const r = recipesFor(CATCHMOON, "sustained", holding({}, gear))!;
  const built = r.combos.filter((c) => c.built);
  assert.deepEqual(built.map((c) => c.key), ["secondary:Catchmoon/Gibber/Killstream"]);
});

test("holdings come straight from orbiter's model", () => {
  const row = (item_id: string, name: string, quantity: number): InventoryRow => ({ item_id, name, category: "resource", quantity, mastered: false, image_name: null, rank: null, max_rank: null });
  const bundle = { observed_at: 1, inventory: [row(GIBBER, "Gibber", 1)], catalog: [], relics: [], prices: { prices: {}, max_rank_prices: {} } } as unknown as Bundle;
  const r = recipesFor("Catchmoon", "sustained", buildModel(bundle), { slot: "secondary" })!;
  const gibber = r.combos.flatMap((c) => c.parts).find((p) => p.name === "Gibber")!;
  assert.equal(gibber.status, "held");
});

test("the wiki snapshot ships beside the app with its licence, isn't compiled in, and orbiter never fetches the wiki for it", () => {
  assert.ok(existsSync("public/data/wiki/LICENSE.md"));
  const licence = readFileSync("public/data/wiki/LICENSE.md", "utf8");
  assert.match(licence, /CC BY-NC-SA 3\.0/);
  assert.match(licence, /creativecommons\.org\/licenses\/by-nc-sa\/3\.0/);
  assert.match(licence, /Warframe Wiki contributors/);
  assert.equal((parts as unknown as { _source: { revision: number } })._source.revision, 2787806);
  assert.doesNotMatch(readFileSync("src/lib/core/recipes.ts", "utf8"), /fetch\(|https?:\/\/wiki\.warframe\.com/);
  for (const f of ["src/lib/core/recipes.ts", "src/lib/core/vosfor.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /import [^;]*(modular-parts\.json|modular-parts-extra|vosfor\.json)/, `${f} doesn't import the wiki's files`);
  for (const f of ["modular-parts.json", "modular-parts-extra.json", "vosfor.json"]) assert.ok(existsSync(`public/data/wiki/${f}`), f);
  assert.match(licence, /vosfor\.json/);
});

test("without the wiki's file (it failed to load), recipes are simply empty, never an error", async () => {
  const { setWikiData, wikiData } = await import("../src/lib/core/wikiData");
  const kept = wikiData();
  setWikiData(null);
  try {
    assert.deepEqual(recipeItems(), []);
    assert.equal(recipeItem("Catchmoon"), null);
    assert.equal(recipesFor("Catchmoon"), null);
  } finally {
    setWikiData(kept);
  }
});
