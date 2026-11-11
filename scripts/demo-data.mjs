#!/usr/bin/env node
// Builds the invented demo account in demo/: the files the browser dev mode reads as
// /dev-*.json, for README screenshots and UI work (`npm run dev:demo`). Nothing in them comes from
// a real account: the player ("ExamplePlayer"), the other players, the inventory, the listings
// and the trades are made up. Game data (item names, paths, ducats, relic rewards) is public and
// comes from the @wfcd/items package, read from a copy outside the repository:
//
//   mkdir -p /tmp/wfcd && cd /tmp/wfcd && npm pack @wfcd/items@1.1276.48 && tar xzf wfcd-items-*.tgz
//   node scripts/demo-data.mjs /tmp/wfcd/package
//
// The output is the same on every run for the same package: choices come from a seeded random
// generator and times from a fixed "now" (DEMO_NOW, written to demo/meta.json). The dev server
// moves every time in the files forward to the real now when it serves them (vite.config.ts).
//
// No dependencies, no network.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const DEMO_NOW = Date.UTC(2026, 10, 4, 18, 0, 0);
const NOW_S = Math.floor(DEMO_NOW / 1000);
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const wfcd = process.argv[2];
const outDir = resolve(process.argv[3] ?? "demo");
if (!wfcd) {
  console.error("usage: node scripts/demo-data.mjs <@wfcd/items package folder> [out folder, default demo]");
  process.exit(2);
}
const read = (name) => JSON.parse(readFileSync(join(wfcd, "data", "json", `${name}.json`), "utf8"));

// ------------------------------------------------------------------ seeded choices

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A random generator per purpose, so adding to one list doesn't reshuffle the others. */
const seeded = (tag) => rng(parseInt(createHash("sha256").update(`orbiter-demo:${tag}`).digest("hex").slice(0, 8), 16));
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const hex = (tag, n = 24) => createHash("sha256").update(`orbiter-demo-id:${tag}`).digest("hex").slice(0, n);
/** warframe.market's slug for a name (as backend.ts marketUrl makes it). */
const slugOf = (name) => name.toLowerCase().replace(/&/g, "and").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, ".000Z");

// ------------------------------------------------------------------ the catalog (as crates/myorbiter-data slims it)

const components = new Map(read("Components").map((c) => [c.uniqueName, c]));
// A part that's a resource (Orokin Cell) or a whole item (Akbronco Prime takes Bronco Primes) is
// filed with those, not with the components.
const anything = new Map();
for (const f of ["Resources", "Misc", "Warframes", "Primary", "Secondary", "Melee", "Gear", "Pets", "Sentinels", "Archwing", "Arch-Gun", "Arch-Melee"]) for (const x of read(f)) if (!anything.has(x.uniqueName)) anything.set(x.uniqueName, x);
const resolveComponents = (item) =>
  (item.components ?? [])
    .map((ref) => {
      if (ref.name) return ref;
      const c = components.get(ref.uniqueName) ?? components.get(ref.uniqueName.replace("/Lotus/StoreItems/", "/Lotus/")) ?? anything.get(ref.uniqueName) ?? anything.get(ref.uniqueName.replace("/StoreItems/", "/"));
      return c ? { ...c, components: undefined, itemCount: ref.itemCount ?? 1 } : ref;
    })
    .filter((c) => typeof c.name === "string");

const ITEM_FIELDS = ["uniqueName", "name", "category", "type", "tradable", "masterable", "isPrime", "vaulted", "masteryReq", "rarity", "imageName", "productCategory", "excludeFromCodex", "marketCost", "bpCost", "isAugment"];
// Left out: wikiaUrl (the app makes the wiki link from the name), to keep the files small.
const DETAIL_FIELDS = ["description", "buildPrice", "buildTime", "buildQuantity", "health", "shield", "armor", "power", "sprintSpeed", "polarities", "aura", "exilusPolarity", "passiveDescription", "criticalChance", "criticalMultiplier", "procChance", "fireRate", "totalDamage", "magazineSize", "reloadTime", "multishot", "accuracy", "trigger", "disposition", "omegaAttenuation", "slot", "releaseDate", "range", "followThrough", "noise"];
const pickFields = (src, fields) => Object.fromEntries(fields.filter((f) => src[f] !== undefined).map((f) => [f, src[f]]));

/** Drop sources, one per place, best chance first; fewer than the app keeps, to keep the files small. */
function slimDrops(drops, max) {
  const seen = new Map();
  for (const d of drops ?? []) {
    if (!d.location) continue;
    const prev = seen.get(d.location);
    if (!prev || prev.chance < (d.chance ?? 0)) seen.set(d.location, { location: d.location, chance: d.chance ?? 0, rarity: d.rarity ?? "" });
  }
  return [...seen.values()].sort((a, b) => b.chance - a.chance).slice(0, max);
}

const GEAR_FILES = ["Warframes", "Primary", "Secondary", "Melee", "Arch-Gun", "Arch-Melee", "Archwing", "Sentinels", "Pets", "Misc"];
const gearRaw = GEAR_FILES.flatMap((f) => read(f)).filter((x) => x.category !== "Misc" || x.masterable);

function slimGear(x) {
  const out = pickFields(x, ITEM_FIELDS);
  if (x.masterable) {
    Object.assign(out, pickFields(x, DETAIL_FIELDS));
    if (Array.isArray(x.abilities)) out.abilities = x.abilities.map((a) => pickFields(a, ["name", "description", "imageName"]));
    if (x.damage && typeof x.damage === "object") {
      const dealt = Object.fromEntries(Object.entries(x.damage).filter(([k, v]) => k !== "total" && typeof v === "number" && v > 0));
      if (Object.keys(dealt).length) out.damage = dealt;
    }
  }
  const comps = resolveComponents(x);
  if (comps.length) {
    // Drops only for parts (a resource drops everywhere), and only the best few.
    // `tradable` only where it's false: the app only asks whether a part is untradable.
    out.components = comps.map((c) => ({ ...pickFields(c, ["uniqueName", "name", "itemCount", "ducats", "imageName"]), ...(c.tradable === false ? { tradable: false } : {}), drops: /\/Recipes\//.test(c.uniqueName) ? slimDrops(c.drops, c.ducats != null ? 2 : 1) : [] }));
  }
  return out;
}
const gear = gearRaw.map(slimGear);
const gearByName = new Map(gear.map((g) => [g.name, g]));
const gearByUnique = new Map(gear.map((g) => [g.uniqueName, g]));

// Mods: one per name (the full one, not a Beginner or Conclave copy), the kinds a player trades.
const MOD_TYPES_OUT = /Focus Way|Plexus|Railjack|Riven|Peculiar|Tektolyst|Transmutation|Posture/;
function bestByName(list) {
  const out = new Map();
  for (const m of list) {
    const prev = out.get(m.name);
    const score = (x) => (x.tradable ? 100 : 0) + (x.fusionLimit ?? 0) - (/Beginner|Intermediate|Expert|PvP/.test(x.uniqueName) ? 50 : 0);
    if (!prev || score(m) > score(prev)) out.set(m.name, m);
  }
  return [...out.values()];
}
const modsRaw = bestByName(read("Mods").filter((m) => !MOD_TYPES_OUT.test(m.type ?? "") && !/\/(PvPMods|Randomized|Beginner|Intermediate)\//.test(m.uniqueName) && !/^Flawed /.test(m.name)));
const arcanesRaw = bestByName(read("Arcanes").filter((a) => a.name && a.tradable));
function slimUpgrade(x) {
  const out = pickFields(x, ITEM_FIELDS);
  if (typeof x.fusionLimit === "number") out.maxRank = x.fusionLimit;
  else if (Array.isArray(x.levelStats)) out.maxRank = Math.max(0, x.levelStats.length - 1);
  out.drops = slimDrops(x.drops, x.category === "Mods" && x.rarity === "Common" ? 0 : 1);
  const last = Array.isArray(x.levelStats) ? x.levelStats.at(-1)?.stats : null;
  if (Array.isArray(last)) out.maxStats = last.filter((s) => typeof s === "string").map((s) => s.replace(/\\n/g, "\n"));
  Object.assign(out, pickFields(x, ["polarity", "baseDrain", "compatName"]));
  return out;
}
const mods = modsRaw.map(slimUpgrade);
const arcanes = arcanesRaw.map(slimUpgrade);
const modByName = new Map(mods.map((m) => [m.name, m]));
const arcaneByName = new Map(arcanes.map((m) => [m.name, m]));

// ------------------------------------------------------------------ relics, with rewards from the parts' own drops

const RELIC_LOC = /^(Lith|Meso|Neo|Axi|Requiem) (\S+) Relic(?: \((Exceptional|Flawless|Radiant)\))?$/;
const rewardsByRelic = new Map(); // "Axi A1|Radiant" → [{ name, rarity, chance }]
function noteRewards(owner) {
  for (const d of owner.drops ?? []) {
    const m = RELIC_LOC.exec(d.location ?? "");
    if (!m || !d.type) continue;
    const key = `${m[1]} ${m[2]}|${m[3] ?? "Intact"}`;
    const list = rewardsByRelic.get(key) ?? [];
    if (!list.some((r) => r.name === d.type)) list.push({ name: d.type, rarity: d.rarity ?? null, chance: d.chance ?? null });
    rewardsByRelic.set(key, list);
  }
}
for (const c of components.values()) noteRewards(c);
for (const f of ["Misc", "Mods", "Resources"]) for (const x of read(f)) noteRewards(x);
// Forma Blueprint isn't in the files as a relic reward: a relic has three commons, so any common
// slot left over is a Forma Blueprint, as in the game.
const COMMON = { Intact: 25.33, Exceptional: 23.33, Flawless: 20, Radiant: 16.67 };
for (const [key, list] of rewardsByRelic) {
  const ref = key.split("|")[1];
  const commons = list.filter((r) => Math.abs((r.chance ?? 0) - COMMON[ref]) < 0.05).length;
  if (list.length < 6 && commons < 3) list.push({ name: "Forma Blueprint", rarity: "Common", chance: COMMON[ref] });
}

const relicsRaw = read("Relics").filter((r) => /^(Lith|Meso|Neo|Axi|Requiem) \S+ (Intact|Exceptional|Flawless|Radiant)$/.test(r.name));
const relicDropsByBase = new Map();
for (const r of relicsRaw) {
  const base = r.name.replace(/ \S+$/, "");
  if (r.drops?.length && !relicDropsByBase.has(base)) relicDropsByBase.set(base, slimDrops(r.drops, 3));
}
const relicsAll = relicsRaw
  .map((r) => {
    const [base, ref] = [r.name.replace(/ \S+$/, ""), r.name.split(" ").at(-1)];
    const rewards = rewardsByRelic.get(`${base}|${ref}`) ?? [];
    const drops = relicDropsByBase.get(base) ?? [];
    return { uniqueName: r.uniqueName, name: r.name, vaulted: drops.length === 0 && !base.startsWith("Requiem"), tradable: r.tradable ?? true, imageName: r.imageName, drops, rewards, base, ref };
  })
  .filter((r) => r.rewards.length >= 6);
const relicByName = new Map(relicsAll.map((r) => [r.name, r]));
const basesAll = [...new Set(relicsAll.map((r) => r.base))];
const unvaultedBases = basesAll.filter((b) => relicByName.get(`${b} Intact`) && !relicByName.get(`${b} Intact`).vaulted);
const relicsByReward = new Map();
for (const r of relicsAll) if (r.ref === "Intact") for (const rw of r.rewards) relicsByReward.set(rw.name, [...(relicsByReward.get(rw.name) ?? []), r.base]);

// ------------------------------------------------------------------ prime parts

const BLUEPRINT_SUFFIXED = new Set(["Neuroptics", "Chassis", "Systems", "Harness", "Wings"]);
function partFullName(parent, comp) {
  if (comp.name === "Blueprint") return `${parent.name} Blueprint`;
  if (comp.name.startsWith(`${parent.name} `)) return comp.name;
  if ((parent.category === "Warframes" || parent.category === "Archwing") && BLUEPRINT_SUFFIXED.has(comp.name)) return `${parent.name} ${comp.name} Blueprint`;
  return `${parent.name} ${comp.name}`;
}
const primes = gear.filter((g) => g.masterable && (g.components ?? []).some((c) => c.ducats != null && c.tradable !== false));
const partsOf = (g) => (g.components ?? []).filter((c) => c.ducats != null && c.tradable !== false).map((c) => ({ comp: c, name: partFullName(g, c), parent: g }));
/** The path TennoScope holds a part under: a warframe part as its blueprint, anything else as the component. */
const heldPathOf = (p) => (p.parent.category === "Warframes" || p.parent.category === "Archwing") && BLUEPRINT_SUFFIXED.has(p.comp.name) ? p.comp.uniqueName.replace(/Component$/, "Blueprint") : p.comp.uniqueName;

// ------------------------------------------------------------------ the account

const inventory = [];
const row = (item_id, name, category, quantity, extra = {}) => {
  inventory.push({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null, ...extra });
};
const CATEGORY = { Warframes: "frame", Primary: "weapon", Secondary: "weapon", Melee: "weapon", "Arch-Gun": "weapon", "Arch-Melee": "weapon", Archwing: "frame", Sentinels: "companion", Pets: "companion", Misc: "weapon" };
const UNOBTAINABLE = new Set(["Excalibur Prime", "Skana Prime", "Lato Prime"]);

// Wanted primes: not built or mastered yet, so their parts show as needed (Foundry, the reward screen).
const WANTED = ["Saryn Prime", "Gauss Prime", "Nekros Prime", "Lex Prime", "Galatine Prime", "Corinth Prime", "Wisp Prime", "Akstiletto Prime"];
// Ready to build: every part in hand.
const READY = ["Hildryn Prime", "Fulmin Prime"];
// Built and mastered, with a whole spare set to sell.
const SPARE_SETS = ["Rhino Prime", "Boltor Prime", "Paris Prime", "Nova Prime", "Kronen Prime"];
const KEEP_UNMASTERED = new Set([...WANTED, ...READY, ...UNOBTAINABLE]);

const rMastery = seeded("mastery");
const masterables = gear.filter((g) => g.masterable && !g.excludeFromCodex).sort((a, b) => a.uniqueName.localeCompare(b.uniqueName));
let masteredCount = 0;
for (const g of masterables) {
  const year = Number((g.releaseDate ?? "2018").slice(0, 4));
  const lich = /^(Kuva|Tenet|Coda) /.test(g.name);
  const chance = KEEP_UNMASTERED.has(g.name) ? 0 : SPARE_SETS.includes(g.name) ? 1 : g.isPrime ? 0.3 : lich ? 0.15 : g.category === "Warframes" ? (year <= 2022 ? 0.92 : 0.45) : year <= 2019 ? 0.6 : year <= 2023 ? 0.33 : 0.12;
  const mastered = rMastery() < chance;
  const held = mastered ? rMastery() < 0.3 : rMastery() < 0.04 && !KEEP_UNMASTERED.has(g.name);
  if (!mastered && !held) continue;
  if (mastered) masteredCount++;
  row(g.uniqueName, g.name, CATEGORY[g.category] ?? "weapon", held ? 1 : 0, { mastered, image_name: g.imageName ?? null });
}

// Prime parts.
const parts = new Map(); // held path → { name, qty }
const addPart = (p, n) => {
  const path = heldPathOf(p);
  const prev = parts.get(path);
  parts.set(path, { name: p.name, qty: (prev?.qty ?? 0) + n, image: p.comp.imageName ?? null, parent: p.parent.uniqueName });
};
const rParts = seeded("parts");
/** Parts the wanted primes still lack: the reward screen offers one. */
const missingParts = new Set();
for (const name of SPARE_SETS) {
  const g = gearByName.get(name);
  for (const p of partsOf(g)) addPart(p, p.comp.itemCount ?? 1);
}
for (const name of READY) for (const p of partsOf(gearByName.get(name))) addPart(p, p.comp.itemCount ?? 1);
for (const [i, name] of WANTED.entries()) {
  const ps = partsOf(gearByName.get(name));
  // Each one short by a part or two, the main blueprint always in hand.
  const missing = new Set(ps.filter((p) => p.comp.name !== "Blueprint").map((p) => p.name).slice(i % 2, (i % 2) + 1 + (i % 3 === 0 ? 1 : 0)));
  for (const p of ps) if (!missing.has(p.name)) addPart(p, p.comp.itemCount ?? 1);
  for (const n of missing) missingParts.add(n);
}
// Loose parts from cracking: mostly cheap commons, a few doubles.
const loose = primes.filter((g) => !UNOBTAINABLE.has(g.name) && !WANTED.includes(g.name) && !READY.includes(g.name)).flatMap(partsOf);
for (let i = 0; i < 60; i++) {
  const p = pick(rParts, loose);
  addPart(p, p.comp.ducats <= 25 ? int(rParts, 1, 4) : 1);
}
for (const [path, p] of parts) row(path, p.name, "prime_part", p.qty, { image_name: p.image });

// Relics: what a player keeps between fissure runs, mostly intact, a few radiant.
const rRelics = seeded("relics");
const relicBases = new Set();
for (const name of WANTED) for (const p of partsOf(gearByName.get(name))) for (const b of (relicsByReward.get(p.name) ?? []).slice(0, 1)) relicBases.add(b);
while (relicBases.size < 46) relicBases.add(pick(rRelics, rRelics() < 0.6 ? unvaultedBases : basesAll));
for (const base of [...relicBases].sort()) {
  const intact = relicByName.get(`${base} Intact`);
  if (!intact) continue;
  row(intact.uniqueName, intact.name, "relic", intact.vaulted ? int(rRelics, 1, 3) : int(rRelics, 1, 14), { image_name: intact.imageName ?? null });
  if (rRelics() < 0.22) {
    const rad = relicByName.get(`${base} Radiant`);
    if (rad) row(rad.uniqueName, rad.name, "relic", int(rRelics, 1, 4), { image_name: rad.imageName ?? null });
  }
}

// The four relics of the fissure on screen: a radiant share of unvaulted Axi and Neo relics.
const rSquad = seeded("squad");
const squadBases = unvaultedBases.filter((b) => /^(Axi|Neo) /.test(b));
// The first relic drops a part a wanted prime lacks, so the screen has a card worth taking.
const squad = [[...missingParts].flatMap((n) => relicsByReward.get(n) ?? []).sort().find((b) => squadBases.includes(b)) ?? [...missingParts].flatMap((n) => relicsByReward.get(n) ?? []).sort()[0]].filter(Boolean);
while (squad.length < 4) {
  const b = pick(rSquad, squadBases);
  if (!squad.includes(b)) squad.push(b);
}
const squadRelics = squad.map((b, i) => relicByName.get(`${b} ${i === 0 ? "Radiant" : pick(rSquad, ["Radiant", "Flawless", "Intact"])}`) ?? relicByName.get(`${b} Intact`));

// Mods: commons in stacks, rarer ones fewer, a ranked copy of what's in builds.
const rMods = seeded("mods");
const MUST_MODS = ["Serration", "Split Chamber", "Hornet Strike", "Pressure Point", "Intensify", "Streamline", "Flow", "Vitality", "Redirection", "Continuity", "Stretch", "Point Strike", "Vital Sense", "Hellfire", "Infected Clip", "Primed Continuity", "Primed Flow", "Primed Point Blank", "Galvanized Chamber", "Condition Overload", "Blood Rush", "Organ Shatter", "Transient Fortitude", "Blind Rage", "Overextended", "Narrow Minded", "Adaptation", "Rolling Guard", "Primed Sure Footed", "Lohk", "Jahu", "Khra", "Netra"];
const RARE_W = { Common: 0.55, Uncommon: 0.42, Rare: 0.28, Legendary: 0.12 };
const modPicks = new Set(MUST_MODS.filter((n) => modByName.has(n)));
for (const m of mods.slice().sort((a, b) => a.uniqueName.localeCompare(b.uniqueName))) {
  if (!m.tradable || m.isAugment && rMods() < 0.5) continue;
  if (rMods() < (RARE_W[m.rarity] ?? 0.2) * 0.45) modPicks.add(m.name);
}
for (const name of [...modPicks].sort()) {
  const m = modByName.get(name);
  const max = m.maxRank ?? 0;
  const loose = m.rarity === "Common" ? int(rMods, 1, 14) : m.rarity === "Uncommon" ? int(rMods, 1, 7) : m.rarity === "Rare" ? int(rMods, 1, 3) : int(rMods, 1, 2);
  row(m.uniqueName, m.name, "mod", loose, { image_name: m.imageName ?? null, rank: null, max_rank: max });
  if (max > 0 && (MUST_MODS.includes(name) || rMods() < 0.3)) row(`${m.uniqueName}#${max}`, m.name, "mod", 1, { image_name: m.imageName ?? null, rank: max, max_rank: max });
}

// Arcanes: a maxed copy of the ones in builds, loose copies of the rest.
const rArc = seeded("arcanes");
const MUST_ARCANES = ["Arcane Energize", "Arcane Grace", "Arcane Avenger", "Arcane Fury", "Molt Augmented", "Primary Merciless", "Secondary Deadhead", "Arcane Guardian", "Virtuos Strike", "Magus Elevate", "Arcane Velocity", "Cascadia Flare", "Emergence Dissipate", "Arcane Blessing"];
for (const name of MUST_ARCANES) {
  const a = arcaneByName.get(name);
  if (!a) continue;
  const max = a.maxRank ?? 5;
  if (rArc() < 0.55) row(`${a.uniqueName}#${max}`, a.name, "arcane", 1, { image_name: a.imageName ?? null, rank: max, max_rank: max });
  row(a.uniqueName, a.name, "arcane", int(rArc, 1, a.rarity === "Legendary" ? 6 : 14), { image_name: a.imageName ?? null, rank: null, max_rank: max });
}

// Resources.
const RESOURCES = [
  ["/Lotus/Types/Items/MiscItems/Forma", "Forma", 23], ["/Lotus/Types/Items/MiscItems/OrokinCell", "Orokin Cell", 64], ["/Lotus/Types/Items/MiscItems/VoidTearDrop", "Void Traces", 1830],
  ["/Lotus/Types/Items/MiscItems/PrimeBucks", "Orokin Ducats", 3415], ["/Lotus/Types/Items/MiscItems/NeuralSensor", "Neural Sensors", 41], ["/Lotus/Types/Items/MiscItems/Neurode", "Neurodes", 57],
  ["/Lotus/Types/Items/MiscItems/ArgonCrystal", "Argon Crystal", 6], ["/Lotus/Types/Items/MiscItems/Alertium", "Nitain Extract", 18], ["/Lotus/Types/Items/MiscItems/Tellurium", "Tellurium", 9],
  ["/Lotus/Types/Items/MiscItems/ControlModule", "Control Module", 132], ["/Lotus/Types/Items/MiscItems/Plastids", "Plastids", 4210], ["/Lotus/Types/Items/MiscItems/Rubedo", "Rubedo", 18520],
  ["/Lotus/Types/Items/MiscItems/Ferrite", "Ferrite", 96400], ["/Lotus/Types/Items/MiscItems/AlloyPlate", "Alloy Plate", 81250], ["/Lotus/Types/Items/MiscItems/PolymerBundle", "Polymer Bundle", 52300],
  ["/Lotus/Types/Items/MiscItems/Salvage", "Salvage", 128900], ["/Lotus/Types/Items/MiscItems/Circuits", "Circuits", 21400], ["/Lotus/Types/Items/MiscItems/Morphic", "Morphics", 212],
  ["/Lotus/Types/Items/MiscItems/Gallium", "Gallium", 88], ["/Lotus/Types/Items/MiscItems/OxiumAlloy", "Oxium", 3150], ["/Lotus/Types/Items/MiscItems/Cryotic", "Cryotic", 9840], ["/Lotus/Types/Items/MiscItems/Nanospores", "Nano Spores", 240500],
];
// With the picture WFCD files each under, as the app's inventory read gives it (Forma's is the
// generic component picture).
for (const [path, name, n] of RESOURCES) row(path, name, "resource", n, { image_name: anything.get(path)?.imageName ?? null });

// ------------------------------------------------------------------ the catalog the bundle carries

const heldUpgrades = new Set(inventory.filter((r) => r.category === "mod" || r.category === "arcane").map((r) => r.item_id.split("#")[0]));
const catalog = [
  ...gear,
  // Every mod a player trades, and the arcanes: the Builds page and the mod lists look them up by name.
  // (Archwing, arch-gun, K-Drive and Necramech mods only where held, to keep the file small.)
  ...mods.filter((m) => heldUpgrades.has(m.uniqueName) || (m.tradable && !/Archwing|Arch-Gun|Arch-Melee|K-Drive|Necramech/.test(m.type ?? ""))),
  ...arcanes,
];
// Relics: those held or in the squad, those that drop a part the account needs, and the ones on
// the star chart now; with all four refinements.
const keepBases = new Set([...inventory.filter((r) => r.category === "relic").map((r) => r.name.replace(/ \S+$/, "")), ...squad, ...unvaultedBases]);
for (const name of [...WANTED, ...READY]) for (const p of partsOf(gearByName.get(name))) for (const b of (relicsByReward.get(p.name) ?? []).slice(0, 4)) keepBases.add(b);
// Intact and Radiant of each (what a crack is worth, and the chances at either end); the other
// refinements only where held.
const heldRelics = new Set(inventory.filter((r) => r.category === "relic").map((r) => r.item_id));
const squadPaths = new Set(squadRelics.map((r) => r.uniqueName));
const relics = relicsAll.filter((r) => keepBases.has(r.base) && (r.ref === "Intact" || r.ref === "Radiant" || heldRelics.has(r.uniqueName) || squadPaths.has(r.uniqueName))).map(({ base, ref, ...r }) => r);

// ------------------------------------------------------------------ prices (made up, in the range such things sell for)

const rPrice = seeded("prices");
const prices = {};
const maxRankPrices = {};
const tradeRate = {};
const rate = (name, lo, hi) => {
  tradeRate[name] = [Math.round((lo + rPrice() * (hi - lo)) * 10) / 10, int(rPrice, 6, 22), ""];
};
const PART_BAND = { 15: [2, 5], 25: [3, 7], 45: [5, 11], 65: [7, 18], 100: [10, 35] };
const tradableGear = primes.filter((g) => !UNOBTAINABLE.has(g.name));
for (const g of tradableGear) {
  let sum = 0;
  for (const p of partsOf(g)) {
    const [lo, hi] = PART_BAND[p.comp.ducats] ?? [3, 9];
    const v = Math.round((lo + rPrice() * (hi - lo)) * (g.vaulted ? 1.7 : 1));
    prices[p.name] = v;
    sum += v * (p.comp.itemCount ?? 1);
    rate(p.name, g.vaulted ? 1 : 3, g.vaulted ? 8 : 30);
  }
  prices[`${g.name} Set`] = Math.round(sum * (1.05 + rPrice() * 0.25));
  rate(`${g.name} Set`, g.vaulted ? 1 : 2, g.vaulted ? 9 : 25);
}
const MOD_BAND = { Common: [1, 4, 2, 4], Uncommon: [2, 8, 2, 4], Rare: [4, 22, 2.5, 5], Legendary: [25, 90, 2.5, 4] };
for (const m of mods) {
  if (!m.tradable) continue;
  const [lo, hi, mlo, mhi] = MOD_BAND[m.rarity] ?? [2, 8, 2, 3];
  const v = int(rPrice, lo, hi);
  prices[m.name] = v;
  if (m.maxRank) maxRankPrices[m.name] = Math.round(v * (mlo + rPrice() * (mhi - mlo)) + m.maxRank);
  rate(m.name, 0.5, m.rarity === "Common" ? 4 : 18);
}
const ARCANE_BAND = { Common: [2, 6, 18, 40], Uncommon: [3, 12, 30, 80], Rare: [6, 28, 60, 180], Legendary: [12, 55, 140, 420] };
for (const a of arcanes) {
  const [lo, hi, mlo, mhi] = ARCANE_BAND[a.rarity] ?? [3, 10, 30, 80];
  prices[a.name] = int(rPrice, lo, hi);
  maxRankPrices[a.name] = int(rPrice, mlo, mhi);
  rate(a.name, 1, 40);
}
for (const base of new Set(relics.map((r) => r.name.replace(/ \S+$/, "")))) {
  const vaulted = relicByName.get(`${base} Intact`)?.vaulted;
  const v = vaulted ? int(rPrice, 6, 24) : int(rPrice, 2, 7);
  prices[`${base} Relic`] = v;
  prices[`${base} Relic (Radiant)`] = Math.round(v * (1.6 + rPrice() * 0.8));
  rate(`${base} Relic`, 0.5, vaulted ? 6 : 20);
}

const bundle = {
  observed_at: NOW_S - 4 * 60,
  inventory,
  catalog,
  relics,
  prices: { prices, max_rank_prices: maxRankPrices, trade_rate: tradeRate, dump_date: new Date(DEMO_NOW).toISOString().slice(0, 10) },
};

// ------------------------------------------------------------------ warframe.market's item list

const marketItems = [];
const addItem = (name, gameRef, tags, extra = {}) => marketItems.push({ id: hex(`item:${name}`), slug: slugOf(name), gameRef, name, maxRank: null, subtypes: null, tags, ...extra });
// Primes: the ones the account holds a part of, or wants.
const heldPrimes = new Set([...parts.values()].map((p) => p.parent));
for (const g of tradableGear) {
  if (!heldPrimes.has(g.uniqueName) && !WANTED.includes(g.name) && !READY.includes(g.name)) continue;
  const kind = g.category === "Warframes" ? "warframe" : g.category === "Archwing" ? "archwing" : g.category === "Sentinels" ? "sentinel" : "weapon";
  addItem(`${g.name} Set`, g.uniqueName, ["prime", "set", kind]);
  for (const p of partsOf(g)) addItem(p.name, p.comp.uniqueName, ["prime", /Blueprint$/.test(p.name) ? "blueprint" : "component", kind]);
}
// Mods: the ones held (the full list is over a thousand, and nothing here browses it).
for (const m of mods) if (m.tradable && heldUpgrades.has(m.uniqueName)) addItem(m.name, m.uniqueName, ["mod", (m.rarity ?? "common").toLowerCase()], { maxRank: m.maxRank ?? null });
for (const a of arcanes) addItem(a.name, a.uniqueName, ["arcane_enhancement", (a.rarity ?? "common").toLowerCase()], { maxRank: a.maxRank ?? null });
for (const base of new Set(relics.map((r) => r.name.replace(/ \S+$/, "")))) addItem(`${base} Relic`, relicByName.get(`${base} Intact`)?.uniqueName ?? null, ["relic", base.split(" ")[0].toLowerCase()], { subtypes: ["intact", "exceptional", "flawless", "radiant"] });
const itemByName = new Map(marketItems.map((i) => [i.name, i]));

// ------------------------------------------------------------------ other players (made up) and their order books

const PLAYERS = ["Tenno_Alpha", "VoidTrader42", "RelicRunner07", "Orokin_Echo", "LotusLeaf_3", "KuvaKnight88", "ExampleSeller", "SampleBuyer_9", "Ducat_Hoarder", "PrimeTime_Demo", "CephalonTest", "Fissure_Fan", "Tenno_Bravo", "Tenno_Charlie", "MarketMoa_12", "ZarimanZed", "Grineer_Gary", "CorpusClerk_5", "Sentient_Sam", "Plat_Pilot", "Nightwave_Nia", "Arbiter_Ann", "Steel_Pathfinder", "Baro_Fanclub"];
const users = PLAYERS.map((n, i) => ({ id: hex(`user:${n}`), ingameName: n, status: ["ingame", "ingame", "online", "offline"][i % 4], platform: "pc", crossplay: true }));
const me = { id: hex("user:ExamplePlayer"), ingameName: "ExamplePlayer", platform: "pc", crossplay: true, status: "ingame" };

const rBookMain = seeded("books");
function bookFor(item, ref, maxRank, rBook = rBookMain) {
  const out = [];
  const sellers = int(rBook, 3, 5);
  for (let i = 0; i < sellers; i++) {
    const u = users[int(rBook, 0, users.length - 1)];
    const p = Math.max(1, Math.round(ref * (0.85 + rBook() * 0.6)));
    out.push({ id: hex(`order:${item.slug}:s${i}`, 16), type: "sell", platinum: p, quantity: int(rBook, 1, 6), rank: maxRank != null ? 0 : null, subtype: item.subtypes?.[0] ?? null, visible: true, user: u });
  }
  if (maxRank) for (let i = 0; i < 2; i++) out.push({ id: hex(`order:${item.slug}:m${i}`, 16), type: "sell", platinum: Math.max(2, Math.round((maxRankPrices[item.name] ?? ref * 3) * (0.9 + rBook() * 0.4))), quantity: 1, rank: maxRank, subtype: null, visible: true, user: users[int(rBook, 0, users.length - 1)] });
  for (let i = 0; i < 1; i++) out.push({ id: hex(`order:${item.slug}:b${i}`, 16), type: "buy", platinum: Math.max(1, Math.round(ref * (0.5 + rBook() * 0.3))), quantity: int(rBook, 1, 3), rank: maxRank != null ? 0 : null, subtype: item.subtypes?.[0] ?? null, visible: true, user: users[int(rBook, 0, users.length - 1)] });
  return out;
}
const books = {};
const bookItems = new Set();
for (const r of inventory) {
  if (r.quantity <= 0 || !["prime_part", "mod", "arcane", "relic"].includes(r.category)) continue;
  // Mods: only what could be spare (more than the two Sell spares keeps), and anything rare.
  if (r.category === "mod" && r.quantity < 3 && !/Rare|Legendary/.test(modByName.get(r.name)?.rarity ?? "")) continue;
  const name = r.category === "relic" ? `${r.name.replace(/ \S+$/, "")} Relic` : r.name;
  if (itemByName.has(name)) bookItems.add(name);
}
for (const g of tradableGear) if (partsOf(g).every((p) => parts.has(heldPathOf(p)))) bookItems.add(`${g.name} Set`);
for (const name of [...bookItems].sort()) {
  const it = itemByName.get(name);
  const ref = it.tags.includes("relic") ? prices[name] ?? 4 : prices[name] ?? 5;
  books[it.slug] = bookFor(it, ref, it.maxRank);
}

// ------------------------------------------------------------------ the listings on warframe.market

const LISTED = [
  // name, quantity, price against the cheapest seller (+n: above it, so a check would bring it down)
  ["Rhino Prime Set", 1, 0], ["Boltor Prime Set", 1, +4], ["Paris Prime Set", 1, 0], ["Primed Continuity", 1, 0, "max"],
  ["Arcane Energize", 1, 0, "max"], ["Condition Overload", 2, +3], ["Blood Rush", 1, 0], ["Arcane Grace", 3, +2],
  ["Molt Augmented", 2, 0], ["Organ Shatter", 2, -1], ["Galvanized Chamber", 1, +6], ["Primary Merciless", 1, 0, "max"],
];
const rList = seeded("listings");
const orders = [];
for (const [name, qty, delta, rank] of LISTED) {
  const it = itemByName.get(name);
  if (!it) continue;
  const maxed = rank === "max" && it.maxRank != null;
  const r = maxed ? it.maxRank : it.maxRank != null ? 0 : null;
  const book = books[it.slug] ?? (books[it.slug] = bookFor(it, prices[name] ?? 10, it.maxRank));
  const cheapest = Math.min(...book.filter((o) => o.type === "sell" && o.user.status === "ingame" && (o.rank ?? null) === r).map((o) => o.platinum), Infinity);
  const base = Number.isFinite(cheapest) ? cheapest : maxed ? maxRankPrices[name] ?? 20 : prices[name] ?? 10;
  orders.push({ id: hex(`my:${name}`), itemId: it.id, type: "sell", platinum: Math.max(1, base + delta), quantity: qty, rank: r, subtype: null, visible: true, updatedAt: iso(DEMO_NOW - int(rList, 2, 70) * HOUR) });
}
// What's listed is held, with a copy or more to spare (a listing for more than you hold reads as sold).
for (const [name, qty, , rank] of LISTED) {
  const up = modByName.get(name) ?? arcaneByName.get(name);
  if (!up || rank === "max") continue;
  const r = inventory.find((x) => x.item_id === up.uniqueName);
  if (r) r.quantity = Math.max(r.quantity, qty + 1);
}
// The maxed copies on sale are held too.
for (const [name, , , rank] of LISTED) {
  if (rank !== "max") continue;
  const it = itemByName.get(name);
  const up = modByName.get(name) ?? arcaneByName.get(name);
  if (!it || !up || inventory.some((r) => r.item_id === `${up.uniqueName}#${up.maxRank}`)) continue;
  row(`${up.uniqueName}#${up.maxRank}`, up.name, arcaneByName.has(name) ? "arcane" : "mod", 1, { image_name: up.imageName ?? null, rank: up.maxRank, max_rank: up.maxRank });
}

const market = {
  account: { linked: true, backing: "keyring", profile: me, error: null },
  orders,
};

// ------------------------------------------------------------------ TennoScope, the fissure and its reward screen

const health = (msg) => ({ state: "ready", message: msg, last_success: iso(DEMO_NOW - 2 * MIN) });
// Two builds in the foundry: one ready to claim, one an hour off.
const foundryItem = gearByName.get("Hildryn Prime");
const foundryPart = partsOf(gearByName.get("Gauss Prime")).find((p) => /Chassis|Neuroptics|Systems/.test(p.comp.name));
const foundry = {};
const foundryReady = [];
if (foundryPart) {
  const recipe = foundryPart.comp.uniqueName.replace(/Component$/, "Blueprint");
  foundry[recipe] = 1;
  foundryReady.push([recipe, DEMO_NOW + 55 * MIN]);
}
const tennoscope = {
  binary: "/home/user/.local/bin/tennoscope",
  custom: null,
  bundled: true,
  supported: true,
  running: true,
  started_by_myorbiter: true,
  report: {
    at: DEMO_NOW,
    pid: 4242,
    game_running: true,
    health: {
      game_reader: health("Reading the game"),
      log_monitor: health("Following EE.log"),
      capture: health("Ready"),
      catalog: health("Item data up to date"),
      market: health("Prices up to date"),
      collection_prices: health("Prices up to date"),
      database: health("OK"),
      market_account: health("Signed in"),
    },
    market: { link: "linked", backing: "keyring", presence: { status: "ingame", wanted: "ingame", auto: true } },
    setup: { setup_complete: true, access_mode: "full", desktop_capture_action_available: true },
    last_error: null,
    foundry,
    foundry_ready: foundryReady,
    mastery_rank: 22,
    platinum: 1240,
    credits: 8_412_350,
    endo: 182_400,
    rivens: null,
    imprints: null,
    gear: null,
    consumed_suits: null,
  },
};
void foundryItem;

// The reward screen: one card from each relic, the best of them a part a wanted prime needs.
const rCards = seeded("cards");
const wantedParts = new Set(WANTED.flatMap((n) => partsOf(gearByName.get(n)).map((p) => p.name)));
const cards = squadRelics.map((r, i) => {
  const pool = r.rewards.map((x) => x.name);
  const needed = pool.filter((n) => wantedParts.has(n));
  const lacking = pool.filter((n) => missingParts.has(n));
  if (i === 0 && lacking.length) return lacking[0];
  if (i === 1 && needed.length) return needed[0];
  if (i === 2) return pool.find((n) => n === "Forma Blueprint") ?? pick(rCards, pool);
  return pick(rCards, pool.filter((n) => n !== "Forma Blueprint"));
});
const SESSION_START = NOW_S - 52 * 60;
const uptimeNow = NOW_S - SESSION_START - 10;
const rewardPath = (name) => {
  if (name === "Forma Blueprint") return "/Lotus/StoreItems/Types/Recipes/Components/FormaBlueprint";
  const p = [...parts.values()].find((x) => x.name === name);
  for (const g of primes) for (const q of partsOf(g)) if (q.name === name) return heldPathOf(q).replace("/Lotus/", "/Lotus/StoreItems/");
  return p ? null : null;
};
const ROUNDS = [
  { mission: "Ukko (Void)", min: 48, relics: squad.map((b) => relicByName.get(`${b} Intact`)) },
  { mission: "Ukko (Void)", min: 36, relics: squad.map((b) => relicByName.get(`${b} Radiant`) ?? relicByName.get(`${b} Intact`)) },
  { mission: "Mot (Void)", min: 22, relics: squadRelics },
];
const history = ROUNDS.map((h, i) => ({
  name: h.mission,
  started_at: NOW_S - h.min * 60,
  uptime: (NOW_S - h.min * 60) - SESSION_START,
  relics: h.relics.filter(Boolean).map((r) => r.uniqueName),
  rounds: i === 2 ? 3 : 1,
  rewards: (i === 2 ? [cards[1]] : [pick(rCards, h.relics[0].rewards).name]).map(rewardPath).filter(Boolean),
}));
const mission = {
  path: "/home/user/.local/share/Steam/steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log",
  session: "demo-session",
  mission: "Mot (Void)",
  relics: squadRelics.map((r) => r.uniqueName),
  last_relics: [],
  reward_screen_open: true,
  rewards_given: [rewardPath(cards[1])].filter(Boolean),
  last_event: uptimeNow,
  session_start: SESSION_START,
  history,
  trades: [
    { uptime: 900.5, at: SESSION_START + 900, partner: "VoidTrader42", offered: [{ name: "Vitality", rank: 0, count: 1 }], received: [], platinum_offered: 0, platinum_received: 4 },
  ],
  whispers: [{ name: "VoidTrader42", uptime: 850.2, at: SESSION_START + 850 }],
};
const rewardScreen = { at: DEMO_NOW - 8_000, cards };
// TennoScope's logged reward screens over the last week, for the relic runs.
const rRuns = seeded("runs");
const screens = [];
for (let d = 7; d >= 1; d--) {
  const n = int(rRuns, 4, 12);
  for (let i = 0; i < n; i++) {
    const rs = Array.from({ length: 4 }, () => relicByName.get(`${pick(rRuns, unvaultedBases)} ${pick(rRuns, ["Intact", "Radiant"])}`)).filter(Boolean);
    if (rs.length < 4) continue;
    screens.push({ at: DEMO_NOW - d * DAY + i * 7 * MIN, cards: rs.map((r) => pick(rRuns, r.rewards).name), relics: rs.map((r) => r.uniqueName) });
  }
}
screens.push({ at: rewardScreen.at, cards, relics: squadRelics.map((r) => r.uniqueName) });

// ------------------------------------------------------------------ Foundry recipes: each item's own blueprint

const resourceFiles = [...read("Resources"), ...read("Misc")];
const resourceByPath = new Map(resourceFiles.map((x) => [x.uniqueName, x]));
const recipes = {};
const names = {};
for (const g of gear) {
  // The Foundry plans what's still to build: anything not held.
  if (!g.masterable || !g.components?.length || inventory.some((r) => r.item_id === g.uniqueName && r.quantity > 0)) continue;
  recipes[g.uniqueName] = { c: g.buildPrice ?? 0, i: g.components.map((c) => [c.uniqueName, c.itemCount ?? 1]) };
  for (const c of g.components) {
    const res = resourceByPath.get(c.uniqueName);
    if (!res || names[c.uniqueName]) continue;
    names[c.uniqueName] = { n: res.name, img: res.imageName ?? "", r: (res.rarity ?? "").toUpperCase(), k: /^\/Lotus\/Types\/Items\/(MiscItems|Research)\//.test(c.uniqueName) ? "chart" : "world" };
  }
}
const recipeData = { checkedAt: NOW_S - 2 * 86_400, recipes, names };

// ------------------------------------------------------------------ the drop tables' relics, riven names, price history

// Where each kept relic drops (the rewards are the bundle's own, so none are repeated here).
const relicData = {
  hash: hex("relic-data", 32),
  modified: DEMO_NOW - 9 * DAY,
  checkedAt: NOW_S - 3 * 3600,
  relics: [],
  drops: Object.fromEntries([...keepBases].filter((b) => relicDropsByBase.has(b)).sort().map((b) => [b, relicDropsByBase.get(b)])),
  paths: {},
};

// warframe.market's riven list: the weapons that take a riven (the base ones, not their variants)
// and the stats, named from the riven price model's own list.
const VARIANT = /^(Kuva|Tenet|Coda|Prisma|Mutalist|Rakta|Sancti|Secura|Synoid|Telos|Vaykor|Dex|Mk1-|Carmine|Ceti|Vandal) | (Prime|Vandal|Wraith)$/;
const rivenWeapons = gear
  .filter((g) => g.disposition != null && ["Primary", "Secondary", "Melee", "Arch-Gun"].includes(g.category) && !VARIANT.test(g.name))
  .map((g) => ({
    slug: slugOf(g.name),
    gameRef: g.uniqueName,
    name: g.name,
    group: g.category === "Arch-Gun" ? "archgun" : g.category.toLowerCase(),
    rivenType: g.category === "Secondary" ? "pistol" : g.category === "Melee" ? "melee" : g.type === "Shotgun" ? "shotgun" : "rifle",
  }));
const rivenModel = JSON.parse(readFileSync(resolve("src/lib/data/riven-model.json"), "utf8"));
const statNames = [...new Set([...rivenModel.stats, ...rivenModel.negs])].sort();
const rivenMeta = {
  weapons: rivenWeapons,
  attributes: statNames.map((slug) => ({
    slug,
    gameRef: "",
    name: slug.replace(/_\/_/g, " / ").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    unit: null,
    positiveOnly: !rivenModel.negs.includes(slug),
    negativeOnly: !rivenModel.stats.includes(slug),
    exclusiveTo: null,
  })),
};

// Ten days of sales for each relic held (by refinement) and each thing listed: the relic prices
// come from these, and the listings' price charts.
const rHistMain = seeded("history");
const priceHistory = {};
const pointsFor = (name, subtypes, ranks, rHist = rHistMain) => {
  const out = [];
  for (let d = 10; d >= 1; d--) {
    const at = iso(Math.floor((DEMO_NOW - d * DAY) / DAY) * DAY);
    for (const sub of subtypes) for (const rank of ranks) {
      const base = sub === "radiant" ? prices[`${name.replace(/ Relic$/, "")} Relic (Radiant)`] : rank ? maxRankPrices[name] : prices[name];
      if (base == null) continue;
      const median = Math.max(1, Math.round(base * (0.85 + rHist() * 0.3)));
      out.push({ at, median, volume: int(rHist, 2, 30), min: Math.max(1, median - int(rHist, 0, 3)), max: median + int(rHist, 1, 8), rank, subtype: sub });
    }
  }
  return out;
};
for (const r of inventory) {
  if (r.category !== "relic") continue;
  const name = `${r.name.replace(/ \S+$/, "")} Relic`;
  const it = itemByName.get(name);
  if (it && !priceHistory[it.slug]) priceHistory[it.slug] = pointsFor(name, ["intact", "radiant"], [null]);
}
for (const o of orders) {
  const it = marketItems.find((x) => x.id === o.itemId);
  if (it && !priceHistory[it.slug]) priceHistory[it.slug] = pointsFor(it.name, [null], it.maxRank != null ? [0, it.maxRank] : [null]);
}

// ------------------------------------------------------------------ Sell spares' situations
//
// What tests/sparesPlan.test.ts checks Sell spares' choices against, set here rather than left to
// the seeded picks above. Applied last, with a generator of its own, so everything else (prices,
// order books, listings, history) comes out as it would without them.

const rSpares = seeded("spares");
/** Holds exactly `quantity` of a row: the one already there, or a new one. */
const hold = (item_id, name, category, quantity, extra = {}) => {
  const r = inventory.find((x) => x.item_id === item_id);
  if (r) r.quantity = quantity;
  else row(item_id, name, category, quantity, extra);
};
/** Things held only from here: priced, on warframe.market's list, each with an order book. */
const traded = new Set();
const trade = (name, gameRef, tags, extra, [lo, hi], [mlo, mhi] = [0, 0]) => {
  if (prices[name] == null) prices[name] = int(rSpares, lo, hi);
  if (extra.maxRank && maxRankPrices[name] == null) maxRankPrices[name] = int(rSpares, mlo, mhi);
  // Sells every day: Sell spares lists only what does, by default.
  if ((tradeRate[name]?.[0] ?? 0) < 1) tradeRate[name] = [Math.round((1.5 + rSpares() * 8) * 10) / 10, int(rSpares, 6, 22), ""];
  if (!itemByName.has(name)) {
    addItem(name, gameRef, tags, extra);
    itemByName.set(name, marketItems.at(-1));
  }
  traded.add(name);
};

// Requiem mods (Kuva Liches and Sisters of Parvos take them) and an Antivirus mod (the Technocyte
// Coda), with Kuva, Tenet and Coda weapons still to master: two to four copies of each Requiem mod
// (Khra four, one of them maxed), Computer Cop fifteen. @wfcd/items marks these mods untradable, as
// the catalog the app reads does; warframe.market pricing them is what makes them tradable there.
const LICH_MODS = [["Lohk", 2, true], ["Xata", 2, false], ["Jahu", 1, true], ["Vome", 3, false], ["Ris", 2, false], ["Fass", 4, false], ["Netra", 2, true], ["Khra", 3, true], ["Computer Cop", 15, false]];
for (const [name, unranked, maxed] of LICH_MODS) {
  const m = modByName.get(name);
  if (!catalog.includes(m)) catalog.push(m);
  hold(m.uniqueName, name, "mod", unranked, { image_name: m.imageName ?? null, rank: null, max_rank: m.maxRank });
  if (maxed) hold(`${m.uniqueName}#${m.maxRank}`, name, "mod", 1, { image_name: m.imageName ?? null, rank: m.maxRank, max_rank: m.maxRank });
  trade(name, m.uniqueName, ["mod", "rare"], { maxRank: m.maxRank ?? null }, [6, 18], [25, 60]);
}
// A stance held unranked only, six copies of it.
{
  const m = modByName.get("Cleaving Whirlwind");
  hold(m.uniqueName, m.name, "mod", 6, { image_name: m.imageName ?? null, rank: null, max_rank: m.maxRank });
  trade(m.name, m.uniqueName, ["mod", (m.rarity ?? "common").toLowerCase()], { maxRank: m.maxRank ?? null }, [3, 9], [10, 20]);
}

// Arcanes: Arcane Energize one maxed and nine unranked (30 copies, 21 to max one); Virtuos Forge
// two maxed.
{
  const energize = arcaneByName.get("Arcane Energize");
  hold(`${energize.uniqueName}#${energize.maxRank}`, energize.name, "arcane", 1, { image_name: energize.imageName ?? null, rank: energize.maxRank, max_rank: energize.maxRank });
  hold(energize.uniqueName, energize.name, "arcane", 9, { image_name: energize.imageName ?? null, rank: null, max_rank: energize.maxRank });
  const forge = arcaneByName.get("Virtuos Forge");
  hold(`${forge.uniqueName}#${forge.maxRank}`, forge.name, "arcane", 2, { image_name: forge.imageName ?? null, rank: forge.maxRank, max_rank: forge.maxRank });
  for (const a of [energize, forge]) trade(a.name, a.uniqueName, ["arcane_enhancement", (a.rarity ?? "common").toLowerCase()], { maxRank: a.maxRank ?? null }, [3, 12], [30, 80]);
}

// A relic held twice that sells for more than a crack, beside the Requiem relics held more often.
{
  const r = relicByName.get("Requiem I Intact");
  hold(r.uniqueName, r.name, "relic", 2, { image_name: r.imageName ?? null });
  const name = "Requiem I Relic";
  trade(name, r.uniqueName, ["relic", "requiem"], { subtypes: ["intact", "exceptional", "flawless", "radiant"] }, [3, 7]);
  const it = itemByName.get(name);
  if (!priceHistory[it.slug]) priceHistory[it.slug] = pointsFor(name, ["intact", "radiant"], [null], rSpares);
}

// Gems and Ayatan sculptures. Purged Dagonic and Stellated Necrathene go into the Keratinos' blades
// and gauntlets, which aren't built; Smooth Phasmin into nothing still to build. The parts' own
// recipes aren't in @wfcd/items: these two are made up, like the rest of the account.
const resourceByName = new Map(resourceFiles.filter((x) => x.tradable).map((x) => [x.name, x]));
const RESOURCES_HELD = [["Purged Dagonic", 200, [1, 3]], ["Stellated Necrathene", 50, [2, 5]], ["Smooth Phasmin", 25, [1, 3]], ["Ayatan Anasa Sculpture", 3, [8, 14]], ["Ayatan Zambuka Sculpture", 1, [6, 12]]];
for (const [name, n, band] of RESOURCES_HELD) {
  const x = resourceByName.get(name);
  hold(x.uniqueName, name, "resource", n, { image_name: x.imageName ?? null });
  trade(name, x.uniqueName, /FusionTreasures/.test(x.uniqueName) ? ["ayatan_sculpture"] : ["gem"], {}, band);
}
const KERATINOS_PARTS = [
  ["/Lotus/Types/Recipes/Weapons/WeaponParts/InfTransformClawsWeaponBlade", "Purged Dagonic", 6],
  ["/Lotus/Types/Recipes/Weapons/WeaponParts/InfTransformClawsWeaponGlove", "Stellated Necrathene", 10],
];
for (const [part, gem, n] of KERATINOS_PARTS) {
  const x = resourceByName.get(gem);
  recipes[part] = { c: 15_000, i: [[x.uniqueName, n]] };
  names[x.uniqueName] ??= { n: x.name, img: x.imageName ?? "", r: (x.rarity ?? "").toUpperCase(), k: "world" };
}

// A whole spare set of a weapon warframe.market trades as one (Braton Vandal, built and mastered):
// its blueprint and three parts, one of each.
{
  const g = gearByName.get("Braton Vandal");
  trade(`${g.name} Set`, g.uniqueName, ["set", "weapon"], {}, [20, 40]);
  for (const c of g.components) {
    const name = c.name === "Blueprint" ? `${g.name} Blueprint` : `${g.name} ${c.name}`;
    hold(c.uniqueName, name, "blueprint", 1, { image_name: c.imageName ?? null });
    trade(name, c.uniqueName, ["weapon", c.name === "Blueprint" ? "blueprint" : "component"], {}, [4, 10]);
  }
}

// Kubrow imprints of one breed: warframe.market lists them under the companion's path. (TennoScope
// passes the imprints themselves apart from the inventory; the tests hand the plan two Sunika ones.)
{
  const sunika = gearByName.get("Sunika Kubrow");
  trade(`${sunika.name} Imprint`, sunika.uniqueName, ["imprint", "kubrow"], {}, [15, 30]);
}

for (const name of [...traded].sort()) {
  const it = itemByName.get(name);
  if (!books[it.slug]) books[it.slug] = bookFor(it, prices[name] ?? 5, it.maxRank, rSpares);
}

// ------------------------------------------------------------------ write

mkdirSync(outDir, { recursive: true });
const files = {
  "dev-bundle.json": bundle,
  "dev-recipe-data.json": recipeData,
  "dev-tennoscope.json": tennoscope,
  "dev-reward-screen.json": rewardScreen,
  "dev-reward-screens.json": screens,
  "dev-mission.json": mission,
  "dev-market.json": market,
  "dev-market-items.json": marketItems,
  "dev-books.json": books,
  "dev-relic-data.json": relicData,
  "dev-rivens.json": rivenMeta,
  "dev-auctions.json": [],
  // Served as /dev-history-<slug>.json, one item each (vite.config.ts).
  "dev-history.json": priceHistory,
  "meta.json": { now: DEMO_NOW, note: "Times in the dev-*.json files are written as if it were this moment (Unix ms); the dev server moves them to the real time when it serves them." },
};
for (const [name, data] of Object.entries(files)) {
  const text = `${JSON.stringify(data)}\n`;
  writeFileSync(join(outDir, name), text);
  console.log(`${name.padEnd(26)} ${(text.length / 1024).toFixed(0).padStart(6)} KB`);
}
console.log(`${inventory.length} inventory rows, ${masteredCount} mastered, ${catalog.length} catalog entries, ${relics.length} relics, ${orders.length} listings`);
