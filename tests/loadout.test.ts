import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  frameInfo,
  heldFrom,
  kitElements,
  loadoutFor,
  loadoutItems,
  modIndex,
  ownedFrom,
  SHARD_PATHS,
  shardElement,
  suggest,
  TIERS,
  type Held,
  type Loadout,
  type LoadoutPick,
  type Owned,
  type SetPick,
  type Tier,
} from "../src/lib/core/builds/suggest";
import { FRAME_NAMES, loadoutModNames } from "./support/builds";
import { SHARD_PATH } from "../src/lib/core/builds/missing";
import { SHARD_COLOURS } from "../src/lib/core/builds/types";
import synergies from "../src/lib/data/loadout-synergies.json";
import type { CatalogItem, InventoryRow } from "../src/lib/core/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] };
const catalog = fixture.catalog;
const index = modIndex(catalog);
const item = (name: string) => {
  const x = catalog.find((c) => c.name === name && c.category === "Warframes");
  assert.ok(x, `${name} in the fixture`);
  return x;
};
const path = (name: string) => {
  const m = index.byName.get(name) ?? catalog.find((c) => c.name === name);
  assert.ok(m, `${name} in the catalog`);
  return m.uniqueName;
};
const ownedOnly = (...names: string[]): Owned => new Map(names.map((n) => [path(n), 0]));
const heldOnly = (entries: [string, number][]): Held => new Map(entries);
const MYTHIC = (c: keyof typeof SHARD_PATHS) => SHARD_PATHS[c] + "Mythic";

const all = (l: Loadout): LoadoutPick[] => [...l.shards, ...(l.helminth ? [l.helminth] : []), ...l.weapons, ...l.arcanes, ...l.companion, ...(l.focus ? [l.focus] : []), ...(l.primer ?? [])];
const names = (ps: LoadoutPick[]) => ps.map((p) => p.name);
const stats = (l: Loadout) => l.shards.map((s) => `${s.colour}:${s.stat}`);

// Everything owned: the mods and arcanes, the Grimoire, every companion, a Grendel to feed, shards.
const everyMod: Owned = new Map([...index.byName.values()].map((m) => [m.uniqueName, m.maxRank ?? 0]));
const everyItem: Held = new Map([...loadoutItems().map((x): [string, number] => [x.path, 1]), ...SHARD_COLOURS.flatMap((c): [string, number][] => [[SHARD_PATHS[c], 5], [MYTHIC(c), 5]])]);

test("shard paths are the same ones missing.ts checks", () => {
  for (const c of SHARD_COLOURS) assert.equal(SHARD_PATHS[c], SHARD_PATH[c]);
});

test("a caster (Saryn Prime): strength shards and the kit's element, Nourish over Molt, Grimoire with Vome, Nautilus, Zenurik", () => {
  const saryn = item("Saryn Prime");
  const l = loadoutFor(saryn, "high", everyMod, index, everyItem)!;
  assert.equal(l.shards.length, 5);
  assert.ok(l.shards.every((s) => s.tauforged && s.name.startsWith("Tauforged")), "high tier: Tauforged");
  const st = stats(l);
  assert.equal(st.filter((s) => s === "crimson:Ability Strength").length, 2, st.join(", "));
  for (const s of ["amber:Casting Speed", "amber:Energy Orb Effectiveness", "emerald:Ability Damage on Corrosion-affected enemies"]) assert.ok(st.includes(s), `${s} in ${st.join(", ")}`);
  assert.match(l.shards.find((s) => s.colour === "emerald")!.reason, /Spores deals Corrosive/);
  assert.deepEqual([l.helminth?.ability, l.helminth?.replaces], ["Nourish", "Molt"]);
  assert.equal(l.helminth?.owned, true, "a base Grendel is held, so it can be fed");
  assert.equal(l.helminth?.tier, "high", "Grendel's parts need Arbitrations: Nourish is Veteran");
  assert.match(l.helminth!.reason, /Veteran: Grendel's parts come from missions unlocked by locators/);
  assert.equal(loadoutFor(saryn, "medium", everyMod, index, everyItem)!.helminth, null, "no Nourish below Veteran");
  assert.deepEqual(names(l.weapons), ["Grimoire", "Vome Invocation", "Pax Bolt"]);
  assert.equal(l.weapons[1].on, "Grimoire");
  assert.match(l.weapons[1].reason, /Xata Invocation instead/, "she spams: the energy Invocation as the swap");
  assert.deepEqual(names(l.arcanes), ["Molt Augmented", "Arcane Energize", "Molt Efficiency"]);
  assert.deepEqual(names(l.companion), ["Nautilus Prime", "Cordon"]);
  assert.equal(l.focus?.name, "Zenurik");
  for (const p of all(l)) {
    assert.ok(p.reason.length > 10, `${p.name} has a reason`);
    assert.match(p.source, /^https:\/\//, `${p.name} names its source`);
  }
});

test("a tank (Rhino Prime): armour and health shards, Parasitic Armor over Rhino Stomp, Panzer Vulpaphyla, Vazarin", () => {
  const rhino = item("Rhino Prime");
  const l = loadoutFor(rhino, "high", everyMod, index, everyItem)!;
  assert.deepEqual(stats(l), ["azure:Armor", "azure:Armor", "azure:Health", "crimson:Ability Strength", "amber:Casting Speed"]);
  assert.ok(l.shards.every((s) => s.tauforged && s.path!.endsWith("Mythic") && s.tier === "high"), "Veteran: Tauforged");
  const mid = loadoutFor(rhino, "medium", everyMod, index, everyItem)!;
  assert.deepEqual(mid.shards, [], "Archon shards are Veteran");
  assert.equal(mid.helminth?.ability, "Parasitic Armor", "the Helminth is Intermediate");
  assert.ok(!names(mid.arcanes).includes("Arcane Grace"), "an Eidolon arcane: Veteran");
  assert.deepEqual([l.helminth?.ability, l.helminth?.replaces], ["Parasitic Armor", "Rhino Stomp"]);
  assert.equal(l.helminth?.owned, null, "a Helminth ability: MyOrbiter can't see the Helminth");
  assert.equal(l.focus?.name, "Vazarin");
  assert.deepEqual(names(l.companion), ["Panzer Vulpaphyla", "Panzer Devolution"]);
  assert.equal(names(l.weapons)[1], "Vome Invocation", "Iron Skin scales with strength");
  assert.ok(names(l.arcanes).includes("Arcane Grace"));
  // Without a Vulpaphyla the medium tier takes the best companion held; the Vulpaphyla waits for high.
  const noFox = new Map([...everyItem].filter(([p]) => p !== path("Panzer Vulpaphyla")));
  assert.equal(loadoutFor(rhino, "medium", everyMod, index, noFox)!.companion[0].name, "Smeeta Kavat");
  const hi = loadoutFor(rhino, "high", everyMod, index, noFox)!.companion;
  assert.deepEqual([hi[0].name, hi[0].owned, hi[0].tier], ["Panzer Vulpaphyla", false, "high"]);
});

test("Wisp and Mesa: the curated Helminth slot, and the right Invocation", () => {
  const wisp = loadoutFor(item("Wisp"), "high", everyMod, index, everyItem)!;
  assert.deepEqual([wisp.helminth?.ability, wisp.helminth?.replaces], ["Nourish", "Sol Gate"]);
  assert.equal(names(wisp.weapons)[1], "Ris Invocation", "duration support");
  assert.equal(wisp.companion[0].name, "Nautilus Prime");
  const mesa = loadoutFor(item("Mesa Prime"), "high", everyMod, index, everyItem)!;
  assert.deepEqual([mesa.helminth?.ability, mesa.helminth?.replaces], ["Nourish", "Ballistic Battery"]);
  assert.equal(mesa.companion[0].name, "Panzer Vulpaphyla", "she fights up close");
  assert.equal(mesa.focus?.name, "Zenurik");
});

test("the kit's element picks the shard (Electricity for Volt); a shield tank gets shields", () => {
  assert.ok(stats(loadoutFor(item("Volt"), "high", everyMod, index, everyItem)!).includes("violet:Ability Damage on Electricity-affected enemies"));
  const hil = loadoutFor(item("Hildryn"), "high", everyMod, index, everyItem)!;
  assert.equal(stats(hil).filter((s) => s === "azure:Shield Capacity").length, 3, "she lives on shields");
  assert.equal(hil.helminth, null, "no curated Helminth line: none");
  assert.ok(!hil.weapons.some((w) => w.name === "Xata Invocation" || w.name === "Netra Invocation"), "no energy for a frame that doesn't use it");
});

test("shards the player holds are marked, Tauforged only; plain ones held get the fusion note", () => {
  const saryn = item("Saryn Prime");
  const held = heldOnly([[SHARD_PATHS.crimson, 1], [MYTHIC("amber"), 2]]);
  assert.deepEqual(loadoutFor(saryn, "medium", everyMod, index, held)!.shards, [], "no shards below Veteran");
  for (const tier of ["high"] as const) {
    const sh = loadoutFor(saryn, tier, everyMod, index, held)!.shards;
    assert.ok(sh.every((s) => s.tauforged && s.name.startsWith("Tauforged ") && s.path === SHARD_PATHS[s.colour!] + "Mythic"), `${tier}: Tauforged only`);
    assert.deepEqual(sh.filter((s) => s.colour === "amber").map((s) => s.owned), [true, true], `${tier}: both Tauforged amber held`);
    const crimson = sh.filter((s) => s.colour === "crimson");
    assert.ok(crimson.every((s) => s.owned === false), "the plain crimson doesn't count as Tauforged");
    assert.match(crimson[0].fuse!, /You hold 1 plain Crimson shard: Ascent Fusion .*3 for 1, 100 Stela.*Update 35\.5.*You need 2 more for one\./);
    assert.ok(crimson.slice(1).every((s) => !s.fuse), "the note once per colour");
    assert.ok(sh.filter((s) => s.colour === "amber").every((s) => !s.fuse), "held: no note");
  }
  const four = loadoutFor(saryn, "high", everyMod, index, heldOnly([[SHARD_PATHS.crimson, 4]]))!.shards.find((s) => s.colour === "crimson")!;
  assert.match(four.fuse!, /You hold 4 plain Crimson shards: .*Yours make 1\./);
  // Without the inventory MyOrbiter can't tell.
  assert.ok(loadoutFor(saryn, "high", everyMod, index)!.shards.every((s) => s.owned === null && !s.fuse));
});

test("heldFrom sums every row by path, any category", () => {
  const row = (item_id: string, category: string, quantity: number): InventoryRow => ({ item_id, name: "", category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
  const h = heldFrom([row(SHARD_PATHS.azure, "resource", 3), row(MYTHIC("azure"), "resource", 1), row("/Lotus/Upgrades/Grimoire/VomeStrikeMod#3", "mod", 1), row("/Lotus/Upgrades/Grimoire/VomeStrikeMod", "mod", 2), row("/x", "weapon", 0)]);
  assert.equal(h.get(SHARD_PATHS.azure), 3);
  assert.equal(h.get(MYTHIC("azure")), 1);
  assert.equal(h.get("/Lotus/Upgrades/Grimoire/VomeStrikeMod"), 3);
  assert.ok(!h.has("/x"));
});

/** What each tier may ask for. */
function checkBudget(l: Loadout, tier: Tier, what: string) {
  if (tier === "low") {
    assert.equal(l.shards.length, 0, `${what}: no shards at low`);
    assert.equal(l.helminth, null, `${what}: no Helminth at low`);
    assert.equal(l.arcanes.length, 0, `${what}: no arcanes at low`);
    for (const p of [...l.weapons, ...l.companion]) assert.equal(p.owned, true, `${what}: low only asks for what you hold (${p.name})`);
  }
  if (tier === "low") {
    assert.equal(l.sets?.length ?? 0, 0, `${what}: no sets at low`);
    for (const p of l.primer ?? []) assert.equal(p.owned, true, `${what}: low only asks for what you hold (${p.name})`);
  }
  if (tier !== "high") assert.equal(l.shards.length, 0, `${what}: Archon shards are Veteran`);
  if (tier !== "high" && l.helminth) assert.equal(l.helminth.tier, "medium", `${what}: a Veteran Helminth ability below Veteran`);
  if (tier === "medium") {
    for (const p of [...l.weapons, ...l.companion, ...l.arcanes, ...(l.primer ?? [])]) assert.equal(p.owned, true, `${what}: medium gets nothing to buy or farm (${p.name})`);
    for (const st of l.sets ?? []) assert.ok(st.pieces.every((x) => x.owned) && (!st.companion || st.companion.owned === true), `${what}: medium sets are all held (${st.name})`);
  }
  // Never a plain shard, at any tier.
  assert.ok(l.shards.every((s) => s.tauforged === true && s.name.startsWith("Tauforged ") && s.path?.endsWith("Mythic")), `${what}: Tauforged only`);
  for (const st of l.sets ?? []) assert.ok(TIERS.indexOf(st.tier) <= TIERS.indexOf(tier), `${what}: set ${st.name} (${st.tier}) within ${tier}`);
  assert.ok((l.sets?.length ?? 0) <= 2, `${what}: two sets at most`);
  for (const p of all(l)) assert.ok(TIERS.indexOf(p.tier) <= TIERS.indexOf(tier), `${what}: ${p.name} (${p.tier}) within ${tier}`);
  assert.ok(l.shards.length <= 5);
  assert.ok(l.weapons.filter((w) => / Invocation$/.test(w.name)).length <= 1, "one Invocation at a time");
}

test("no tier asks for things beyond its budget, for every curated frame, with everything or nothing owned", () => {
  const frames = catalog.filter((c) => c.category === "Warframes" && c.type === "Warframe");
  const fakes = FRAME_NAMES.map((n) => ({ ...item("Saryn Prime"), name: n, uniqueName: `/fake/${n}`, abilities: [] }) as CatalogItem);
  for (const f of [...frames, ...fakes]) {
    for (const tier of TIERS) {
      checkBudget(loadoutFor(f, tier, everyMod, index, everyItem)!, tier, `${f.name} ${tier} (all)`);
      checkBudget(loadoutFor(f, tier, new Map(), index, new Map())!, tier, `${f.name} ${tier} (none)`);
      checkBudget(loadoutFor(f, tier, ownedOnly("Vome Invocation"), index, heldOnly([[path("Grimoire"), 1]]))!, tier, `${f.name} ${tier} (some)`);
    }
  }
  // With nothing owned, low is just the Focus school.
  const bare = loadoutFor(item("Saryn Prime"), "low", new Map(), index, new Map())!;
  assert.deepEqual(names(all(bare)), ["Zenurik"]);
});

test("suggest() carries the loadout for warframes only, and keeps the build as it was", () => {
  const s = suggest(item("Saryn Prime"), "high", everyMod, index, 0, everyItem);
  assert.ok(s.loadout);
  assert.deepEqual(s.shards, [], "the build's own shards stay empty; the loadout holds them");
  assert.equal(suggest(catalog.find((c) => c.name === "Soma Prime")!, "high", everyMod, index).loadout, undefined);
  assert.equal(loadoutFor(catalog.find((c) => c.name === "Soma Prime")!, "high", everyMod, index), null);
});

test("every loadout name is in the fixture catalog, exactly, and every item path names the right item", () => {
  assert.deepEqual(loadoutModNames().filter((n) => !index.byName.has(n)), []);
  for (const x of loadoutItems()) assert.equal(catalog.find((c) => c.uniqueName === x.path)?.name, x.name, x.path);
  const data = synergies as unknown as { shards: { stats: { colour: string }[] }; helminth: { frames: Record<string, { source: string }> } };
  for (const s of data.shards.stats) assert.ok((SHARD_COLOURS as string[]).includes(s.colour));
  for (const n of Object.keys(data.helminth.frames)) assert.ok(FRAME_NAMES.includes(n), `${n} is a curated frame`);
});

// ---------------------------------------------------------------- elements, primers, sets

type Syn = {
  shards: { stats: { colour: string; stat: string }[]; elements: Record<string, { colour: string | null; stat: string | null }> };
  shieldGating: { frames: string[] };
  sets: Record<string, { pieces: { name: string; slot: string; aura?: boolean; replaces?: string }[]; fit: string | null; source: string }>;
  primers: Record<string, { items: { name: string; path: string }[]; mod: string; source: string }>;
};
const SYN = synergies as unknown as Syn;
const setNames = (l: Loadout) => (l.sets ?? []).map((x) => x.name);

test("the element-to-shard mapping: Violet Electricity, Emerald Corrosion and Toxin, Topaz Radiation; Heat, Cold, Blast and Viral feed none", () => {
  const e = SYN.shards.elements;
  assert.deepEqual(
    Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.colour])),
    { electricity: "violet", corrosive: "emerald", toxin: "emerald", radiation: "topaz", heat: null, blast: null, cold: null, viral: null },
  );
  // Each mapped stat is one of that colour's stats.
  for (const [el, v] of Object.entries(e)) if (v.stat) assert.ok(SYN.shards.stats.some((x) => x.colour === v.colour && x.stat === v.stat), `${el}: ${v.stat} is a ${v.colour} stat`);
});

test("kit elements come from the ability tags, and the curated list fills the gaps (Ember, Gyre)", () => {
  assert.deepEqual(kitElements(item("Saryn Prime")).map((x) => [x.element, x.ability]), [["corrosive", "Spores"], ["toxin", "Toxic Lash"], ["viral", "Miasma"]]);
  assert.deepEqual([shardElement(item("Saryn Prime"))?.colour, shardElement(item("Volt"))?.colour, shardElement(item("Hildryn"))?.colour], ["emerald", "violet", "topaz"]);
  const ember = kitElements(item("Ember"));
  assert.deepEqual(ember.map((x) => [x.element, x.colour]), [["heat", null]], "Ember: Heat, which no shard feeds");
  assert.match(ember[0].source, /^https:\/\/wiki\.warframe\.com\//);
  assert.equal(shardElement(item("Ember")), null);
  assert.ok(!stats(loadoutFor(item("Ember"), "high", everyMod, index, everyItem)!).some((x) => /affected|Toxin/.test(x)), "no element shard for Ember");
  assert.equal(shardElement(item("Gyre"))?.colour, "violet");
  assert.ok(stats(loadoutFor(item("Gyre"), "high", everyMod, index, everyItem)!).includes("violet:Ability Damage on Electricity-affected enemies"), "Gyre's Electricity, from the curated list");
  assert.equal(loadoutFor(item("Gyre"), "high", everyMod, index, everyItem)!.element?.element, "electricity");
  // A tagged frame never reads the curated list: tags win.
  assert.equal(kitElements(item("Volt"))[0].source, "the catalog's ability text");
});

test("primers: the companion that applies the kit's own element, else Viral; none for tanks and support", () => {
  const pick = (name: string, tier: Tier = "high", held: Held = everyItem) => loadoutFor(item(name), tier, everyMod, index, held)!.primer ?? [];
  const volt = pick("Volt");
  assert.deepEqual(names(volt), ["Diriga", "Arc Coil", "Manifold Bond", "Verglas Prime", "Contagious Bond"]);
  assert.match(volt[0].reason, /Discharge|Electricity|electricity/);
  assert.match(volt[0].reason, /Violet shard/);
  assert.ok(volt.slice(1).every((p) => p.on === "Diriga"));
  assert.deepEqual(names(pick("Saryn Prime")).slice(0, 2), ["Helminth Charger", "Strain Eruption"]);
  assert.match(pick("Saryn Prime")[0].reason, /Corrosion and Toxin .*Emerald shard/);
  assert.deepEqual(names(pick("Ember")).slice(0, 2), ["Panzer Vulpaphyla", "Viral Quills"], "Heat: no Heat primer, so Viral");
  assert.equal(pick("Gyre")[0].name, "Diriga");
  assert.deepEqual(pick("Rhino Prime"), [], "a tank keeps its companion");
  assert.deepEqual(pick("Wisp"), [], "support keeps its companion");
  // Low tier: the primer the player holds, with a pointer to the better one.
  const onlyDiriga = heldOnly([[path("Diriga"), 1]]);
  const low = loadoutFor(item("Saryn Prime"), "low", ownedOnly("Arc Coil"), index, onlyDiriga)!.primer!;
  assert.deepEqual(names(low), ["Diriga", "Arc Coil"]);
  assert.match(low[0].reason, /Helminth Charger suits it better/);
  for (const p of [...volt, ...low]) assert.match(p.source, /^https:\/\//);
});

test("sets: only when the frame's role fits, with the slots they cost and the pieces held", () => {
  const sets = (name: string, owned: Owned = everyMod, held: Held = everyItem) => loadoutFor(item(name), "high", owned, index, held)!.sets ?? [];
  // Shield-gaters get Augur; Hildryn shield-gates but spends no energy, so not her.
  for (const f of ["Mag", "Harrow"]) assert.ok(setNames({ sets: sets(f) } as Loadout).includes("Augur"), `${f}: Augur`);
  const hil = loadoutFor(item("Hildryn"), "high", everyMod, index, everyItem)!;
  assert.ok(!setNames(hil).includes("Augur"));
  assert.match(hil.note, /Hildryn shield-gates, but spends no energy/);
  const augur = sets("Harrow").find((x) => x.name === "Augur")!;
  assert.match(augur.bonus, /40% of the energy you spend .* 240% with all six/);
  assert.equal(augur.cost, "4 Warframe slots, 2 secondary slots; on the frame, Augur Secrets for Intensify, Augur Reach for Stretch, Augur Message for Continuity, Augur Accord for Redirection, Augur Pact for Hornet Strike, a weaker copy of each.");
  // A kit that applies status gets Mecha, which needs a Kubrow: the player's, if they have one.
  const mecha = sets("Volt").find((x) => x.name === "Mecha")!;
  assert.deepEqual(mecha.pieces.map((p) => [p.name, p.slotKind, !!p.aura]), [["Mecha Empowered", "warframe", true], ["Mecha Pulse", "warframe", false], ["Mecha Overdrive", "companionWeapon", false], ["Mecha Recharge", "companion", false]]);
  assert.equal(mecha.cost, "the aura slot, 1 Warframe slot, 1 companion weapon slot, 1 companion slot.");
  assert.deepEqual([mecha.companion?.name, mecha.companion?.owned], ["Sunika Kubrow", true]);
  assert.equal(sets("Volt", everyMod, new Map()).find((x) => x.name === "Mecha")?.companion?.owned, false);
  // Health tanks: Strain (with the Helminth Charger) and Carnis; a tank that spams: Hunter.
  assert.deepEqual(setNames({ sets: sets("Rhino Prime") } as Loadout), ["Strain", "Carnis"]);
  assert.deepEqual(setNames({ sets: sets("Valkyr") } as Loadout), ["Strain", "Hunter"]);
  assert.deepEqual(sets("Wisp"), [], "support: none");
  // Pieces held are marked; medium only with every piece and the companion.
  const some = ownedOnly("Augur Secrets", "Augur Reach");
  const marked = sets("Mag", some).find((x) => x.name === "Augur")!;
  assert.deepEqual(marked.pieces.filter((p) => p.owned).map((p) => p.name), ["Augur Secrets", "Augur Reach"]);
  assert.equal(marked.tier, "high");
  assert.deepEqual(loadoutFor(item("Mag"), "medium", some, index, everyItem)!.sets, [], "medium: not all held");
  assert.equal(loadoutFor(item("Mag"), "medium", everyMod, index, everyItem)!.sets!.find((x) => x.name === "Augur")?.tier, "medium");
});

test("sets only for frames whose role fits, for every curated frame; never a set with no rule", () => {
  const fakes = FRAME_NAMES.map((n) => ({ ...item("Saryn Prime"), name: n, uniqueName: `/fake/${n}` }) as CatalogItem);
  for (const f of fakes) {
    const info = frameInfo(f.name)!;
    const roles = new Set(info.roles);
    for (const st of loadoutFor(f, "high", everyMod, index, everyItem)!.sets ?? []) {
      const fit = SYN.sets[st.name].fit;
      assert.ok(fit, `${f.name}: ${st.name} has a rule`);
      if (fit === "shieldGate") assert.ok(SYN.shieldGating.frames.includes(f.name) && !info.noEnergy, `${f.name}: Augur`);
      if (fit === "statusKit") assert.ok(info.roles[0] !== "tank" && (roles.has("strength") || roles.has("range")) && kitElements(f).length > 0, `${f.name}: Mecha`);
      if (fit === "healthTank") assert.ok(info.roles[0] === "tank" && !info.shields, `${f.name}: ${st.name}`);
      if (fit === "spamTank") assert.ok(roles.has("tank") && !info.shields && info.spam && !info.noEnergy, `${f.name}: Hunter`);
      assert.ok(st.reason.length > 20 && st.bonus.length > 20, `${f.name}: ${st.name} says why`);
      assert.match(st.source, /^https:\/\//);
    }
  }
});

/** Where a catalog mod goes, from its own type and compatName. */
function slotOf(m: CatalogItem): { slot: string; aura: boolean } {
  const t = m.type ?? "";
  const compat = (m as { compatName?: string }).compatName ?? "";
  if (t === "Warframe Mod") return { slot: "warframe", aura: compat === "AURA" };
  if (t === "Primary Mod") return { slot: "primary", aura: false };
  if (t === "Secondary Mod") return { slot: "secondary", aura: false };
  if (t === "Melee Mod") return { slot: "melee", aura: false };
  if (t === "Companion Mod") return { slot: /Claws/.test(compat) ? "companionWeapon" : "companion", aura: false };
  return { slot: `?${t}`, aura: false };
}

test("every set piece goes where the catalog says it goes, and every piece and primer is in the catalog by its exact name", () => {
  for (const [name, d] of Object.entries(SYN.sets)) {
    if (name.startsWith("_")) continue;
    assert.ok(d.pieces.length >= 3, `${name}: pieces`);
    for (const p of d.pieces) {
      const m = index.byName.get(p.name);
      assert.ok(m, `${p.name} in the catalog`);
      assert.match(m.uniqueName, /\/Sets\//, `${p.name} is a set mod`);
      assert.deepEqual(slotOf(m), { slot: p.slot, aura: !!p.aura }, `${p.name}'s slot`);
      if (p.replaces) assert.equal(slotOf(index.byName.get(p.replaces)!).slot, p.slot, `${p.replaces} goes where ${p.name} goes`);
    }
    assert.match(d.source, /^https:\/\//);
  }
  for (const [name, p] of Object.entries(SYN.primers)) {
    if (name.startsWith("_")) continue;
    assert.equal(p.items[0].name, name);
    assert.ok(index.byName.has(p.mod), `${p.mod} in the catalog`);
  }
  for (const f of SYN.shieldGating.frames) assert.ok(FRAME_NAMES.includes(f), `${f} is a curated frame`);
});

// ---------------------------------------------------------------- against the real catalog and inventory (when present)

const bundlePath = new URL("../public/dev-bundle.json", import.meta.url);
const hasBundle = existsSync(bundlePath);
const bundle = hasBundle ? (JSON.parse(readFileSync(bundlePath, "utf8")) as { catalog: CatalogItem[]; inventory: InventoryRow[] }) : null;

test("real catalog: every loadout name and path exists exactly", { skip: !hasBundle && "public/dev-bundle.json not present" }, () => {
  const idx = modIndex(bundle!.catalog);
  assert.deepEqual(loadoutModNames().filter((n) => !idx.byName.has(n)), []);
  for (const x of loadoutItems()) assert.equal(bundle!.catalog.find((c) => c.uniqueName === x.path)?.name, x.name, x.path);
});

test("real inventory: shards held are marked, and every warframe's loadout keeps to its tier", { skip: !hasBundle && "public/dev-bundle.json not present" }, () => {
  const idx = modIndex(bundle!.catalog);
  const owned = ownedFrom(bundle!.inventory);
  const held = heldFrom(bundle!.inventory);
  const frames = bundle!.catalog.filter((c) => c.category === "Warframes" && c.type === "Warframe" && c.name !== "Helminth");
  for (const f of frames) for (const tier of TIERS) checkBudget(loadoutFor(f, tier, owned, idx, held)!, tier, `${f.name} ${tier}`);
  // Marked shards never outnumber the ones held, per path.
  for (const f of frames) {
    for (const tier of ["medium", "high"] as const) {
      const count = new Map<string, number>();
      for (const s of loadoutFor(f, tier, owned, idx, held)!.shards) if (s.owned) count.set(s.path!, (count.get(s.path!) ?? 0) + 1);
      for (const [p, n] of count) assert.ok(n <= (held.get(p) ?? 0), `${f.name} ${tier}: ${n} of ${p} marked`);
    }
  }
});
