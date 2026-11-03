import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  FRAME_NAMES,
  heldFrom,
  loadoutFor,
  loadoutItems,
  loadoutModNames,
  modIndex,
  ownedFrom,
  SHARD_PATHS,
  suggest,
  TIERS,
  type Held,
  type Loadout,
  type LoadoutPick,
  type Owned,
  type Tier,
} from "../src/lib/core/builds/suggest";
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

const all = (l: Loadout): LoadoutPick[] => [...l.shards, ...(l.helminth ? [l.helminth] : []), ...l.weapons, ...l.arcanes, ...l.companion, ...(l.focus ? [l.focus] : [])];
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
  const l = loadoutFor(rhino, "medium", everyMod, index, everyItem)!;
  assert.deepEqual(stats(l), ["azure:Armor", "azure:Armor", "azure:Health", "crimson:Ability Strength", "amber:Casting Speed"]);
  assert.ok(l.shards.every((s) => !s.tauforged), "medium: plain shards");
  assert.deepEqual([l.helminth?.ability, l.helminth?.replaces], ["Parasitic Armor", "Rhino Stomp"]);
  assert.equal(l.helminth?.owned, null, "a Helminth ability: orbiter can't see the Helminth");
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
  assert.ok(stats(loadoutFor(item("Volt"), "medium", everyMod, index, everyItem)!).includes("violet:Ability Damage on Electricity-affected enemies"));
  const hil = loadoutFor(item("Hildryn"), "medium", everyMod, index, everyItem)!;
  assert.equal(stats(hil).filter((s) => s === "azure:Shield Capacity").length, 3, "she lives on shields");
  assert.equal(hil.helminth, null, "no curated Helminth line: none");
  assert.ok(!hil.weapons.some((w) => w.name === "Xata Invocation" || w.name === "Netra Invocation"), "no energy for a frame that doesn't use it");
});

test("shards the player holds are marked, one pick per shard held", () => {
  const saryn = item("Saryn Prime");
  const held = heldOnly([[SHARD_PATHS.crimson, 1], [MYTHIC("amber"), 2]]);
  const med = loadoutFor(saryn, "medium", everyMod, index, held)!.shards;
  assert.deepEqual(med.filter((s) => s.colour === "crimson").map((s) => s.owned), [true, false]);
  assert.ok(med.filter((s) => s.colour === "amber").every((s) => s.owned === false), "plain amber not held: the Tauforged ones don't count");
  const high = loadoutFor(saryn, "high", everyMod, index, held)!.shards;
  assert.deepEqual(high.filter((s) => s.colour === "amber").map((s) => s.owned), [true, true]);
  assert.ok(high.filter((s) => s.colour === "crimson").every((s) => s.owned === false), "the plain crimson doesn't count as Tauforged");
  for (const s of high) assert.equal(s.path, SHARD_PATHS[s.colour!] + "Mythic");
  // Without the inventory orbiter can't tell.
  assert.ok(loadoutFor(saryn, "medium", everyMod, index)!.shards.every((s) => s.owned === null));
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
  if (tier === "medium") {
    assert.ok(l.shards.every((s) => !s.tauforged), `${what}: Tauforged only at high`);
    for (const p of [...l.weapons, ...l.companion, ...l.arcanes]) assert.equal(p.owned, true, `${what}: medium gets nothing to buy or farm (${p.name})`);
  }
  if (tier === "high") assert.ok(l.shards.every((s) => s.tauforged), `${what}: high is Tauforged`);
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
