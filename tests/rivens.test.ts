import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { cycleCost, displayValue, gradeOf, kuvaSpent, lastCycle, recordRivens, weaponSlug, parseRiven, priceCheck, rivenName, rivenTables, rollOf, searchFor, statValue, type RivenMeta, type RivenStatDef } from "../src/lib/core/rivens";
import type { Bundle, CatalogItem } from "../src/lib/core/types";

const def = (tag: string, value: number, prefix = "", suffix = "", locTag = "|val|% x"): RivenStatDef => ({ tag, value, prefix, suffix, locTag });
const MELEE = [def("WeaponMeleeDamageMod", 0.018300001, "visi", "ata", "|val|% Melee Damage"), def("WeaponElectricityDamageMod", 0.0099999998, "vexi", "tio"), def("WeaponFireRateMod", 0.0060999999, "croni", "dra"), def("WeaponArmorPiercingDamageMod", 0.0133, "insi", "cak")];
const PISTOL = [def("WeaponReloadSpeedMod", 0.0055550002, "feva", "tak"), def("WeaponProjectileSpeedMod", 0.0099999998, "conci", "nak"), def("WeaponFreezeDamageMod", 0.0099999998, "geli", "do")];
const RIFLE = [def("WeaponElectricityDamageMod", 0.0099999998, "vexi", "tio"), def("WeaponClipMaxMod", 0.0055550002, "arma", "tin"), def("WeaponStunChanceMod", 0.0099999998, "hexa", "dex"), def("WeaponAmmoMaxMod", 0.0055499999, "ampi", "bin", "|val|% Ammo Maximum"), def("WeaponCritChanceMod", 0.016666001, "crita", "cron", "|val|% Critical Chance (x2 for Heavy Attacks)"), def("WeaponCritDamageMod", 0.013333, "acri", "tis", "|val|% Critical Damage"), def("WeaponFactionDamageCorpus", 0.0049999999, "manti", "tron", "|val| Damage to Corpus")];

/** Values as the game showed them on three real rivens, at the dispositions they had then. */
function shown(defs: RivenStatDef[], buffs: [string, number][], curses: [string, number][], disposition: number) {
  const MAX = 0x3fffffff;
  const at = (tag: string) => defs.find((d) => d.tag === tag)!;
  return [
    ...buffs.map(([t, v]) => Math.round(statValue(at(t), v / MAX, true, buffs.length, curses.length, 8, disposition) * 1000) / 10),
    ...curses.map(([t, v]) => Math.round(statValue(at(t), v / MAX, false, buffs.length, curses.length, 8, disposition) * 1000) / 10),
  ];
}

test("riven values match what the game showed on real rivens", () => {
  assert.deepEqual(shown(MELEE, [["WeaponMeleeDamageMod", 40881867], ["WeaponElectricityDamageMod", 176959], ["WeaponFireRateMod", 257573658]], [["WeaponArmorPiercingDamageMod", 400514956]], 1.1), [154.2, 83.5, 53.7, -96.2]);
  assert.deepEqual(shown(PISTOL, [["WeaponReloadSpeedMod", 1031084030], ["WeaponProjectileSpeedMod", 979115818], ["WeaponFreezeDamageMod", 287446961]], [], 1.0), [40.9, 73.1, 64.4]);
  assert.deepEqual(shown(RIFLE, [["WeaponElectricityDamageMod", 258268665], ["WeaponClipMaxMod", 57385833], ["WeaponStunChanceMod", 590970762]], [["WeaponAmmoMaxMod", 462255655]], 1.3), [104, 55.5, 110.8, -48]);
});

test("a shown value works back to its roll, and rolls grade S to F", () => {
  const cc = RIFLE[4];
  const v = statValue(cc, 0.75, true, 2, 1, 8);
  assert.ok(Math.abs(rollOf(cc, v, true, 2, 1, 8) - 0.75) < 1e-9);
  assert.deepEqual([gradeOf(1), gradeOf(0.5), gradeOf(0), gradeOf(0.9)], ["S", "B", "F", "A+"]);
  assert.equal(displayValue("WeaponFactionDamageCorpus", 0.45), "×1.45");
  assert.equal(displayValue("WeaponCritChanceMod", 1.784), "+178.4%");
  assert.equal(displayValue("WeaponAmmoMaxMod", -0.48), "-48%");
});

test("a fingerprint becomes a named, graded riven for its weapon", () => {
  const catalog = [
    { uniqueName: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", name: "Rifle Riven Mod", category: "Mods", rivenStats: RIFLE } as unknown as CatalogItem,
    { uniqueName: "/Lotus/Weapons/Tenno/Rifle/BratonPrime", name: "Braton Prime", category: "Primary", masterable: true, imageName: "BratonPrime.png" } as CatalogItem,
  ];
  const m = buildModel({ observed_at: 1, inventory: [], catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } } as Bundle);
  const tables = rivenTables(m.catalogByUnique.values());
  const MAX = 0x3fffffff;
  const r = parseRiven(m, tables, {
    type: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
    id: "a",
    fp: { compat: "/Lotus/Weapons/Tenno/Rifle/BratonPrime", lvl: 8, lvlReq: 11, rerolls: 3, pol: "AP_ATTACK", buffs: [{ Tag: "WeaponCritChanceMod", Value: MAX }, { Tag: "WeaponCritDamageMod", Value: Math.round(MAX / 2) }], curses: [{ Tag: "WeaponAmmoMaxMod", Value: 0 }] },
  })!;
  assert.equal(r.weapon, "Braton Prime");
  assert.equal(r.kind, "Rifle");
  assert.equal(r.polarity, "madurai");
  assert.equal(r.name, "Critatis");
  assert.deepEqual(r.stats.map((s) => [s.label, s.grade]), [["Critical Chance", "S"], ["Critical Damage", "B"], ["Ammo Maximum", "S"]]);
  assert.equal(r.grade, "A−", "the buffs average 0.75");
  assert.equal(r.spliced, false);
  assert.equal(r.companion, false);
  const pet = parseRiven(m, tables, { type: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", id: "c", fp: { compat: "/Lotus/Types/Sentinels/SentinelWeapons/DethMachineRifle", lvl: 8, buffs: [{ Tag: "WeaponCritChanceMod", Value: MAX }] } })!;
  assert.ok(pet.companion, "a sentinel's weapon takes a rifle riven, and it's a companion one");
  const spliced = parseRiven(m, tables, { type: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", id: "b", fp: { compat: "/Lotus/Weapons/Tenno/Rifle/BratonPrime", lvl: 8, buffs: [{ Tag: "WeaponCritChanceMod", Value: MAX }, { Tag: "WeaponCorrosiveDamageMod", Value: MAX }] } })!;
  assert.ok(spliced.spliced, "Corrosive only comes from Riven Splicing");
  assert.deepEqual(spliced.stats.map((s) => s.spliced), [false, true]);
  assert.equal(rivenName(RIFLE, [{ Tag: "WeaponCritDamageMod", Value: 1 }, { Tag: "WeaponCritChanceMod", Value: 9 }, { Tag: "WeaponStunChanceMod", Value: 5 }]), "Crita-hexatis");

  const meta: RivenMeta = {
    weapons: [{ slug: "braton_prime", gameRef: "/Lotus/Weapons/Tenno/Rifle/BratonPrime", name: "Braton Prime", group: "primary", rivenType: "rifle" }],
    attributes: [{ slug: "critical_chance", gameRef: "WeaponCritChanceMod", name: "Critical Chance" }, { slug: "critical_damage", gameRef: "WeaponCritDamageMod", name: "Critical Damage" }, { slug: "ammo_maximum", gameRef: "WeaponAmmoMaxMod", name: "Ammo Maximum" }],
  };
  assert.deepEqual(searchFor(meta, r), { weapon: "braton_prime", positive: ["critical_chance", "critical_damage"], negative: "ammo_maximum" });
  const fam: RivenMeta = { weapons: [{ slug: "rubico", gameRef: "/x/Rubico", name: "Rubico", group: "primary", rivenType: "rifle" }, { slug: "kuva_bramma", gameRef: "/x/KB", name: "Kuva Bramma", group: "primary", rivenType: "rifle" }], attributes: [] };
  assert.equal(weaponSlug(fam, null, "Rubico Prime"), "rubico", "a Prime takes its family's riven");
  assert.equal(weaponSlug(fam, "/x/KB", "whatever"), "kuva_bramma");
  const a = (price: number | null) => ({ id: String(price), price, starting: price, name: "", rank: 8, rerolls: 0, mr: 8, polarity: "madurai", attributes: [], seller: "x", status: "ingame", updated: "" });
  assert.deepEqual(priceCheck([a(300), a(90), a(null), a(120), a(150), a(100)]), { lowest: 90, typical: 120, count: 5 });
});

test("cycling: Kuva costs, and the roll before the last cycle", () => {
  assert.equal(kuvaSpent(0), 0);
  assert.equal(kuvaSpent(3), 900 + 1000 + 1200);
  assert.equal(kuvaSpent(11), 900 + 1000 + 1200 + 1400 + 1700 + 2000 + 2350 + 2750 + 3150 + 3500 + 3500);
  assert.equal(cycleCost(25), 3500);

  const catalog = [
    { uniqueName: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", name: "Rifle Riven Mod", category: "Mods", rivenStats: RIFLE } as unknown as CatalogItem,
    { uniqueName: "/Lotus/Weapons/Tenno/Rifle/BratonPrime", name: "Braton Prime", category: "Primary", masterable: true } as CatalogItem,
  ];
  const m = buildModel({ observed_at: 1, inventory: [], catalog, relics: [], prices: { prices: {}, max_rank_prices: {} } } as Bundle);
  const tables = rivenTables(m.catalogByUnique.values());
  const raw = (rerolls: number, cc: number) => ({
    type: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
    id: "r1",
    fp: { compat: "/Lotus/Weapons/Tenno/Rifle/BratonPrime", lvl: 8, rerolls, buffs: [{ Tag: "WeaponCritChanceMod", Value: cc }], curses: [] },
  });
  let hist = recordRivens({}, [raw(2, 100)], 1)!;
  assert.equal(hist.r1.length, 1);
  assert.equal(recordRivens(hist, [raw(2, 100)], 2), null, "same roll, nothing to record");
  assert.equal(lastCycle(m, tables, raw(2, 100), hist), null, "one roll seen: nothing to compare");
  hist = recordRivens(hist, [raw(3, 0x3fffffff)], 3)!;
  const ch = lastCycle(m, tables, raw(3, 0x3fffffff), hist)!;
  assert.equal(ch.kept, false);
  assert.ok((ch.prev.quality ?? 1) < 0.01);
  hist = recordRivens(hist, [raw(4, 0x3fffffff)], 4)!;
  assert.equal(lastCycle(m, tables, raw(4, 0x3fffffff), hist)!.kept, true, "cycled but kept the old roll");
  assert.deepEqual(recordRivens(hist, [], 5), {}, "a riven you no longer have drops out");
});

test("DE's weekly riven trades: the file reads, and a riven finds its weapon's line", async () => {
  const { parseWeeklyRivens, tradesFor, tradeUrl } = await import("../src/lib/core/rivens");
  const text = `[
  { itemType: 'Rifle Riven Mod', compatibility: null, rerolled: false, avg: 68, stddev: 116, min: 10, max: 300, pop: 1, median: 10 },
  { itemType: 'Rifle Riven Mod', compatibility: 'Rubico', rerolled: false, avg: 133.36, stddev: 567.82, min: 5, max: 4300, pop: 4, median: 25 },
  { itemType: 'Rifle Riven Mod', compatibility: 'Rubico', rerolled: true, avg: 352.51, stddev: 816.94, min: 10, max: 4600, pop: 2, median: 100 },
  { itemType: 'Melee Riven Mod', compatibility: 'Vinquibus (Melee)', rerolled: true, avg: 50, stddev: 1, min: 20, max: 90, pop: 1 },
  { itemType: 'Melee Riven Mod', compatibility: 'Ack & Brunt', rerolled: false, avg: 40, stddev: 1, min: 20, max: 90, pop: 1, median: 30 },
]`;
  const t = parseWeeklyRivens(text);
  assert.equal(t.length, 5);
  assert.deepEqual([t[1].kind, t[1].weapon, t[1].median], ["Rifle", "Rubico", 25]);
  assert.equal(t[3].weapon, "Vinquibus", "the melee Vinquibus is listed as 'Vinquibus (Melee)'");
  assert.equal(t[3].median, null, "no median given");
  const r = tradesFor(t, "Rifle", "Rubico Prime", true);
  assert.equal(r.same?.median, 100, "a cycled Rubico Prime riven compares with cycled Rubico ones");
  assert.equal(r.other?.median, 25);
  assert.equal(tradesFor(t, "Melee", "Ack & Brunt", false).same?.median, 30);
  assert.equal(tradesFor(t, "Pistol", "Rubico", false).same, null, "another kind's line doesn't count");
  assert.equal(tradeUrl("xbox"), "https://www-static.warframe.com/repos/weeklyRivensXB1.json");
  // The real file's shape, if it ever becomes plain JSON.
  assert.equal(parseWeeklyRivens(JSON.stringify([{ itemType: "Zaw Riven Mod", compatibility: "Balla", rerolled: false, avg: 1, stddev: 0, min: 1, max: 1, pop: 1, median: 1 }]))[0].weapon, "Balla");
});

test("keep or take a cycled riven: crit and multishot beat reload and zoom, a zoom curse costs nothing", async () => {
  const { rollScore, statWant } = await import("../src/lib/core/rivens");
  assert.equal(statWant("WeaponCritChanceMod"), 3);
  assert.equal(statWant("WeaponWeakpointCriticalChance"), 1);
  assert.equal(statWant("WeaponElectricityDamageMod"), 2.5);
  assert.equal(statWant("WeaponZoomFovMod"), 0.4);
  const stat = (tag: string, buff: boolean, quality = 0.5) => ({ tag, label: tag, display: "", value: 0, buff, quality, grade: "B", spliced: false });
  const riven = (stats: ReturnType<typeof stat>[]) => ({ stats }) as unknown as import("../src/lib/core/rivens").Riven;
  const good = riven([stat("WeaponCritChanceMod", true), stat("WeaponFireIterationsMod", true), stat("WeaponZoomFovMod", false)]);
  const poor = riven([stat("WeaponReloadSpeedMod", true, 1), stat("WeaponClipMaxMod", true, 1), stat("WeaponProjectileSpeedMod", true, 1)]);
  const cursed = riven([stat("WeaponCritChanceMod", true), stat("WeaponFireIterationsMod", true), stat("WeaponDamageAmountMod", false)]);
  assert.ok(rollScore(good) > rollScore(poor));
  assert.ok(rollScore(good) > rollScore(cursed), "a damage curse hurts; a zoom one doesn't");
});
