import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  bonusIn,
  canSuggest,
  drainIn,
  focusOf,
  frameInfo,
  MAX_FORMA,
  meleeClassOf,
  modIndex,
  ownedFrom,
  suggest,
  suggestAll,
  suggestionNames,
  TIERS,
  toBuild,
  type ModIndex,
  type Owned,
  type Polarity,
  type Suggestion,
} from "../src/lib/core/builds/suggest";
import type { CatalogItem, InventoryRow } from "../src/lib/core/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] };
const catalog = fixture.catalog;
const index = modIndex(catalog);
const item = (name: string) => {
  const x = catalog.find((c) => c.name === name && c.category !== "Mods");
  assert.ok(x, `${name} in the fixture`);
  return x;
};
const mod = (name: string) => {
  const m = index.byName.get(name);
  assert.ok(m, `${name} in the catalog`);
  return m;
};
/** Owns every mod and arcane in the catalog, at max rank. */
const all: Owned = new Map([...index.byName.values()].map((m) => [m.uniqueName, m.maxRank ?? 0]));
const only = (...names: string[]): Owned => new Map(names.map((n) => [mod(n).uniqueName, mod(n).maxRank ?? 0]));
const without = (...names: string[]): Owned => {
  const o = new Map(all);
  for (const n of names) o.delete(mod(n).uniqueName);
  return o;
};
const modNames = (s: Suggestion) => s.names.mods.filter((n): n is string => !!n);

/** Capacity used, recomputed from the build alone. */
function usedOf(s: Suggestion, idx: ModIndex): number {
  let used = 0;
  s.mods.forEach((m, i) => {
    if (!m) return;
    const c = idx.byPath.get(m.path)!;
    used += drainIn(c, m.rank ?? c.maxRank ?? 0, s.polarities?.mods?.[i] ?? null);
  });
  const fixed = (m: { path: string; rank?: number | null } | null | undefined, pol: Polarity | null | undefined) => {
    if (!m) return 0;
    const c = idx.byPath.get(m.path)!;
    return bonusIn(c, m.rank ?? c.maxRank ?? 0, pol ?? null);
  };
  used -= fixed(s.aura, s.polarities?.aura);
  used -= fixed(s.stance, s.polarities?.stance);
  if (s.exilus) {
    const c = idx.byPath.get(s.exilus.path)!;
    used += drainIn(c, s.exilus.rank ?? c.maxRank ?? 0, s.polarities?.exilus ?? null);
  }
  return used;
}

function checkWhole(s: Suggestion, owned: Owned, idx: ModIndex) {
  assert.equal(s.source, "orbiter");
  assert.ok(s.note.startsWith("orbiter's suggestion"), "the note says whose it is");
  assert.equal(usedOf(s, idx), s.capacity.used, `${s.item} ${s.tier}: capacity adds up`);
  assert.ok(s.capacity.used <= s.capacity.max, `${s.item} ${s.tier}: ${s.capacity.used} fits in ${s.capacity.max}`);
  const paths = [...s.mods.filter((m) => m).map((m) => m!.path), s.aura?.path, s.exilus?.path, s.stance?.path, ...s.arcanes.map((a) => a.path)].filter((p): p is string => !!p);
  for (const p of paths) assert.ok(owned.has(p), `${idx.byPath.get(p)?.name} is owned`);
  assert.equal(new Set(paths).size, paths.length, "no mod twice");
  s.mods.forEach((m, i) => assert.equal(!!m, !!s.reasons.mods[i], "a reason for every filled slot"));
  if (s.tier !== "high") assert.equal(s.forma, 0);
  assert.ok(s.formaSlots <= MAX_FORMA);
}

// ---------------------------------------------------------------- capacity rules

test("drain: base + rank; a matching slot halves it rounded up, a mismatched one adds a quarter rounded up", () => {
  const serration = mod("Serration"); // madurai, 4 + 10
  assert.equal(drainIn(serration, 10, null), 14);
  assert.equal(drainIn(serration, 10, "madurai"), 7);
  assert.equal(drainIn(serration, 10, "vazarin"), 18);
  assert.equal(drainIn(serration, 10, "universal"), 7, "Omni matches");
  assert.equal(drainIn(mod("Umbral Intensify"), 10, "universal"), 20, "but not Umbra");
  assert.equal(drainIn(mod("Umbral Intensify"), 10, "umbra"), 8);
});

test("aura and stance: base + rank added, doubled when matched, a fifth less when not", () => {
  const cp = mod("Corrosive Projection"); // naramon, -2 at rank 5
  assert.equal(bonusIn(cp, 5, null), 7);
  assert.equal(bonusIn(cp, 5, "naramon"), 14);
  assert.equal(bonusIn(cp, 5, "madurai"), 5);
});

test("capacity at each tier: 30, 60 with a catalyst, 60 with Forma; Kuva weapons reach 80 only with five Forma", () => {
  const soma = suggestAll(item("Soma Prime"), all, index);
  assert.deepEqual(TIERS.map((t) => soma[t].capacity.max), [30, 60, 60]);
  assert.deepEqual(TIERS.map((t) => soma[t].catalyst), [false, true, true]);
  const hek = suggestAll(item("Kuva Hek"), all, index);
  assert.deepEqual(TIERS.map((t) => hek[t].capacity.max), [30, 60, 80]);
  assert.ok(hek.high.forma! >= 5, "rank 40 takes five Forma");
  const mech = suggestAll(item("Voidrig"), all, index);
  assert.deepEqual(TIERS.map((t) => mech[t].capacity.max), [40, 80, 80]);
  for (const s of [...Object.values(soma), ...Object.values(hek), ...Object.values(mech)]) checkWhole(s, all, index);
});

test("capacity fitting: below the high tier no Forma, no exilus and no weapon arcane; the least valuable mods give way first", () => {
  const soma = suggestAll(item("Soma Prime"), all, index);
  assert.equal(soma.low.forma, 0);
  assert.equal(soma.low.exilus, undefined);
  assert.equal(soma.medium.exilus, undefined);
  assert.deepEqual(soma.medium.arcanes, [], "weapon arcanes need an adapter: high tier only");
  assert.equal(soma.high.adapters?.arcane, true);
  assert.equal(soma.high.adapters?.exilus, true);
  // At 30 the core stays at full rank and what's lowered or left out is further down the list.
  const low = modNames(soma.low);
  assert.ok(low.includes("Serration") && low.includes("Split Chamber"), low.join(", "));
  const serration = soma.low.mods.find((m) => m?.path === mod("Serration").uniqueName);
  assert.equal(serration?.rank, undefined, "Serration at max rank");
  assert.ok(modNames(soma.medium).length > low.length, "more fits with a catalyst");
  assert.ok(modNames(soma.high).length === 8, "and all eight with Forma");
  assert.ok(soma.high.formaSlots > 0);
});

test("de-ranked mods say so in their reason", () => {
  const s = suggest(item("Soma Prime"), "low", all, index);
  s.mods.forEach((m, i) => {
    if (m?.rank != null) assert.match(s.reasons.mods[i]!, /Rank \d+ of \d+, to fit 30 capacity/);
  });
});

// ---------------------------------------------------------------- weapons

test("a crit rifle (Soma Prime): the crit core, Viral then Heat in slot order", () => {
  const soma = item("Soma Prime");
  assert.equal(focusOf(soma, "rifle"), "crit");
  const s = suggest(soma, "high", all, index);
  assert.equal(s.focus, "crit");
  const names = modNames(s);
  for (const n of ["Serration", "Split Chamber", "Vital Sense", "Point Strike"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  assert.ok(!names.includes("Galvanized Aptitude"), "no status mod on a crit rifle");
  const at = (n: string) => s.names.mods.indexOf(n);
  const heat = s.names.mods.findIndex((n) => n === "Hellfire" || n === "Thermite Rounds");
  const toxin = s.names.mods.findIndex((n) => n === "Infected Clip" || n === "Malignant Force");
  const cold = s.names.mods.findIndex((n) => n === "Primed Cryo Rounds" || n === "Cryo Rounds" || n === "Rime Rounds");
  assert.ok(toxin >= 0 && cold >= 0 && heat >= 0, "Viral and Heat");
  assert.ok(heat > toxin && heat > cold, "Heat after the Toxin and Cold, so they combine into Viral");
  assert.ok(at("Serration") >= 0);
  checkWhole(s, all, index);
});

test("a status shotgun (Exergis): 60/60 elementals and status, no crit mods", () => {
  const ex = item("Exergis");
  assert.equal(focusOf(ex, "shotgun"), "status");
  const s = suggest(ex, "high", all, index);
  const names = modNames(s);
  for (const n of ["Primed Point Blank", "Hell's Chamber", "Toxic Barrage", "Frigid Blast", "Galvanized Savvy"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  for (const n of ["Primed Ravage", "Blunderbuss", "Critical Deceleration"]) assert.ok(!names.includes(n), `no ${n}`);
  assert.equal(s.names.exilus, "Primed Shotgun Ammo Mutation");
  checkWhole(s, all, index);
});

test("a hybrid shotgun (Kuva Hek) runs crit and the 60/60s, with Galvanized Hell", () => {
  const s = suggest(item("Kuva Hek"), "high", all, index);
  assert.equal(s.focus, "hybrid");
  const names = modNames(s);
  for (const n of ["Primed Point Blank", "Primed Ravage", "Toxic Barrage", "Frigid Blast", "Galvanized Hell"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
});

test("a melee (Gram Prime): Condition Overload, Blood Rush and Weeping Wounds by its stats, a Heavy Blade stance, Primed Reach", () => {
  const gram = item("Gram Prime");
  assert.equal(meleeClassOf(gram), "Heavy Blade");
  const s = suggest(gram, "high", all, index);
  assert.equal(s.focus, "hybrid");
  const names = modNames(s);
  for (const n of ["Condition Overload", "Blood Rush", "Weeping Wounds", "Primed Reach"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  assert.ok(s.stance, "a stance");
  assert.equal(index.byPath.get(s.stance!.path)?.compatName, "Heavy Blade");
  assert.equal(s.names.arcanes[0], "Melee Duplicate");
  // Without a stance the slot is empty and the note says why.
  const noStance = suggest(gram, "medium", new Map([...all].filter(([p]) => index.byPath.get(p)?.type !== "Stance Mod")), index);
  assert.equal(noStance.stance, undefined);
  assert.ok(noStance.upgrades.some((u) => index.byPath.get(u.path)?.type === "Stance Mod"), "a stance as an upgrade");
  checkWhole(s, all, index);
});

test("a melee whose class orbiter can't tell gets no stance, and the note says so", () => {
  const odd = { ...item("Gram Prime"), name: "Mystery Blade", uniqueName: "/Lotus/Weapons/Tenno/Melee/Swords/Mystery/Mystery" };
  assert.equal(meleeClassOf(odd), null);
  const s = suggest(odd, "medium", all, index);
  assert.equal(s.stance, undefined);
  assert.match(s.note, /can't tell this weapon's class/);
});

test("Primed versions when owned, the plain ones otherwise, with the Primed one as an upgrade", () => {
  const withPrimed = suggest(item("Kuva Hek"), "medium", all, index);
  assert.ok(modNames(withPrimed).includes("Primed Point Blank"));
  const plain = suggest(item("Kuva Hek"), "medium", without("Primed Point Blank"), index);
  assert.ok(modNames(plain).includes("Point Blank"));
  assert.deepEqual(plain.upgrades.find((u) => u.name === "Primed Point Blank")?.replaces, "Point Blank");
});

test("only owned mods go in the main build; the rest are listed as upgrades", () => {
  const owned = only("Serration", "Split Chamber", "Hellfire");
  for (const tier of TIERS) {
    const s = suggest(item("Soma Prime"), tier, owned, index);
    assert.deepEqual(modNames(s).sort(), ["Hellfire", "Serration", "Split Chamber"]);
    const up = s.upgrades.map((u) => u.name);
    for (const n of ["Vital Sense", "Point Strike"]) assert.ok(up.includes(n), `${n} as an upgrade: ${up.join(", ")}`);
    checkWhole(s, owned, index);
  }
  const none = suggest(item("Soma Prime"), "high", new Map(), index);
  assert.equal(modNames(none).length, 0);
  assert.equal(none.arcanes.length, 0);
  assert.ok(none.upgrades.length >= 8);
  assert.match(none.note, /you don't hold a mod orbiter would put there/);
});

test("ownedFrom reads TennoScope's rows: path or path#rank, the highest rank kept, mods and arcanes only", () => {
  const row = (item_id: string, category: string, rank: number | null, quantity = 1): InventoryRow => ({ item_id, name: "", category, quantity, mastered: false, image_name: null, rank, max_rank: null });
  const o = ownedFrom([
    row("/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod", "mod", null, 15),
    row("/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod#10", "mod", 10),
    row("/Lotus/Upgrades/CosmeticEnhancers/Offensive/Foo#3", "arcane", 3),
    row("/Lotus/Powersuits/Saryn/Saryn", "frame", null),
    row("/Lotus/Upgrades/Mods/Rifle/Gone", "mod", null, 0),
  ]);
  assert.equal(o.get("/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod"), 10);
  assert.equal(o.get("/Lotus/Upgrades/CosmeticEnhancers/Offensive/Foo"), 3);
  assert.equal(o.size, 2);
});

test("the canonical copy of a repeated name: not the starter copy, and the right Pressure Point and Adaptation", () => {
  assert.equal(mod("Serration").maxRank, 10);
  assert.equal(mod("Serration").uniqueName, "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod");
  assert.equal(mod("Pressure Point").uniqueName, "/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod");
  assert.equal(mod("Adaptation").uniqueName, "/Lotus/Upgrades/Mods/Warframe/AvatarResistanceOnDamageMod");
  assert.equal(mod("Primed Point Blank").maxRank, 10, "Primed mods live under /Expert/ under their own names");
});

// ---------------------------------------------------------------- warframes

test("a caster frame (Saryn Prime): strength and range, energy mods because she spams, Energy Siphon", () => {
  const saryn = item("Saryn Prime");
  assert.deepEqual(frameInfo(saryn.name)?.roles, ["strength", "range"]);
  const s = suggest(saryn, "high", all, index);
  const names = modNames(s);
  for (const n of ["Umbral Intensify", "Transient Fortitude", "Stretch", "Primed Flow", "Streamline", "Primed Continuity"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  assert.ok(!names.includes("Overextended"), "Overextended would cut her strength");
  assert.equal(s.names.aura, "Energy Siphon");
  assert.equal(s.umbraForma, 1, "an Umbra Forma for Umbral Intensify");
  assert.deepEqual(s.names.arcanes, ["Molt Augmented", "Arcane Energize"]);
  // Below the high tier the plain Intensify, not the Umbral or Archon one.
  assert.ok(modNames(suggest(saryn, "medium", all, index)).includes("Intensify"));
  checkWhole(s, all, index);
});

test("a tank frame (Rhino Prime): health, armour, Adaptation and Rolling Guard; Corrosive Projection; Ironclad Charge", () => {
  const s = suggest(item("Rhino Prime"), "high", all, index);
  const names = modNames(s);
  for (const n of ["Umbral Vitality", "Umbral Fiber", "Adaptation", "Rolling Guard", "Umbral Intensify"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  assert.equal(s.names.aura, "Corrosive Projection");
  assert.equal(s.names.exilus, "Power Drift", "Iron Skin covers knockdowns");
  const ironclad = suggest(item("Rhino Prime"), "medium", all, index);
  assert.ok(modNames(ironclad).includes("Ironclad Charge"), "the iconic augment");
  checkWhole(s, all, index);
});

test("knockdowns: Primed Sure Footed in the exilus at the high tier for frames that fight up close", () => {
  const ex = item("Excalibur");
  assert.equal(frameInfo(ex.name)?.knockdown, true);
  assert.equal(suggest(ex, "high", all, index).names.exilus, "Primed Sure Footed");
  assert.equal(suggest(ex, "medium", all, index).exilus, undefined, "no exilus without an adapter");
  const fallback = suggest(ex, "high", without("Primed Sure Footed"), index);
  assert.equal(fallback.names.exilus, "Sure Footed");
  assert.equal(fallback.upgrades.find((u) => u.name === "Primed Sure Footed")?.replaces, "Sure Footed");
});

test("frame arcanes from the medium tier, none at low", () => {
  assert.equal(suggest(item("Saryn Prime"), "low", all, index).arcanes.length, 0);
  assert.equal(suggest(item("Saryn Prime"), "medium", all, index).arcanes.length, 2);
});

// ---------------------------------------------------------------- the rest

test("a Necramech: twelve slots, survival first, Ironbride mods on Bonewidow", () => {
  const v = suggest(item("Voidrig"), "medium", all, index);
  assert.equal(v.mods.length, 12);
  const names = modNames(v);
  for (const n of ["Necramech Vitality", "Necramech Steel Fiber", "Necramech Rage", "Necramech Intensify", "Necramech Flow"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
  assert.ok(modNames(suggest(item("Bonewidow"), "high", all, index)).includes("Necramech Pressure Point"));
  checkWhole(v, all, index);
});

test("companions and archwings: ten and eight slots, loot and survival", () => {
  const carrier = suggest(item("Carrier Prime"), "medium", all, index);
  assert.equal(carrier.mods.length, 10);
  assert.ok(modNames(carrier).includes("Vacuum") && modNames(carrier).includes("Primed Regen"));
  const smeeta = suggest(item("Smeeta Kavat"), "medium", all, index);
  assert.ok(modNames(smeeta).includes("Fetch") && !modNames(smeeta).includes("Vacuum"), "beasts fetch");
  const odo = suggest(item("Odonata Prime"), "medium", all, index);
  assert.equal(odo.mods.length, 8);
  assert.ok(modNames(odo).includes("Hyperion Thrusters"));
  for (const s of [carrier, smeeta, odo]) checkWhole(s, all, index);
  for (const tier of TIERS) checkWhole(suggest(item("Smeeta Kavat"), tier, all, index), all, index);
});

test("arch-guns, pistols and companion weapons take their own families", () => {
  const g = suggest(item("Kuva Grattler"), "high", all, index);
  assert.ok(modNames(g).includes("Primed Rubedo-Lined Barrel"));
  assert.equal(g.arcanes.length, 0);
  const lex = suggest(item("Lex Prime"), "high", all, index);
  assert.ok(modNames(lex).includes("Hornet Strike"));
  const sweeper = item("Sweeper Prime");
  assert.ok(canSuggest(sweeper));
  assert.ok(modNames(suggest(sweeper, "medium", all, index)).includes("Primed Point Blank"), "Sweeper takes shotgun mods");
  for (const s of [g, lex]) checkWhole(s, all, index);
});

test("Forma stays within MAX_FORMA even when everything is owned", () => {
  for (const n of ["Carrier Prime", "Smeeta Kavat", "Rhino Prime", "Soma Prime"]) assert.ok(suggest(item(n), "high", all, index).formaSlots <= MAX_FORMA, n);
});

test("toBuild: the saved Build shape, source orbiter, no orbiter-only fields", () => {
  const s = suggest(item("Saryn Prime"), "high", all, index);
  const b = toBuild(s, 123);
  assert.equal(b.source, "orbiter");
  assert.equal(b.kind, "warframe");
  assert.equal(b.importedAt, 123);
  assert.equal(b.mods.length, 8);
  assert.deepEqual(b.shards, []);
  assert.ok(!("reasons" in b) && !("upgrades" in b));
  assert.equal(b.aura?.path, s.aura?.path);
});

test("canSuggest: gear yes, resources and amps no", () => {
  assert.ok(canSuggest(item("Soma Prime")));
  assert.ok(!canSuggest(mod("Serration")));
  assert.ok(!canSuggest({ uniqueName: "/x", name: "Sirocco", category: "Primary", type: "Pistol", productCategory: "OperatorAmps" } as CatalogItem));
});

test("every name the engine can pick is in the fixture catalog", () => {
  const missing = suggestionNames().filter((n) => !index.byName.has(n));
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------- against the real catalog and inventory (when present)

const bundlePath = new URL("../public/dev-bundle.json", import.meta.url);
const hasBundle = existsSync(bundlePath);
const bundle = hasBundle ? (JSON.parse(readFileSync(bundlePath, "utf8")) as { catalog: CatalogItem[]; inventory: InventoryRow[] }) : null;

test("real catalog: every name the engine can pick exists, as a full copy", { skip: !hasBundle && "public/dev-bundle.json not present" }, () => {
  const idx = modIndex(bundle!.catalog);
  const missing = suggestionNames().filter((n) => !idx.byName.has(n));
  assert.deepEqual(missing, []);
  for (const n of suggestionNames()) assert.ok(!/\/(Beginner|Intermediate)\//.test(idx.byName.get(n)!.uniqueName), `${n} is not a starter copy`);
});

test("real catalog: the curated table covers every warframe", { skip: !hasBundle && "public/dev-bundle.json not present" }, () => {
  const frames = bundle!.catalog.filter((x) => x.category === "Warframes" && x.type === "Warframe" && x.name !== "Helminth");
  assert.deepEqual(frames.filter((f) => !frameInfo(f.name)).map((f) => f.name), []);
});

test("real inventory: every suggestable item at every tier fits, from owned mods only", { skip: !hasBundle && "public/dev-bundle.json not present" }, () => {
  const idx = modIndex(bundle!.catalog);
  const owned = ownedFrom(bundle!.inventory);
  let n = 0;
  for (const x of bundle!.catalog) {
    if (x.category === "Mods" || x.category === "Arcanes" || !canSuggest(x)) continue;
    for (const tier of TIERS) checkWhole(suggest(x, tier, owned, idx), owned, idx);
    n++;
  }
  assert.ok(n > 500, `${n} items`);
});
