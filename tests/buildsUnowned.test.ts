// Builds: an aura or stance MyOrbiter's suggestion shows though the player doesn't own it. It sits
// in its slot, marked as not owned, the capacity it would add isn't counted until it is owned, and
// the "what's missing" list counts it once. A New player build with no aura owned shows Dreamer's
// Bond. Pasted and saved builds keep counting what they hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel } from "../src/lib/core/model";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";
import { availability, capacityOf, missing, tierOf } from "../src/lib/core/builds";
import { modIndex, STARTER_AURA, suggest, toBuild, type Owned } from "../src/lib/core/builds/suggest";

const catalog = (JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] }).catalog;
const index = modIndex(catalog);
const CAT = new Map(catalog.map((c) => [c.uniqueName, c]));
const item = (name: string) => catalog.find((c) => c.name === name && c.category !== "Mods")!;
const mod = (name: string) => index.byName.get(name)!;
const DB = "/Lotus/Upgrades/Mods/Aura/PlayerEnergyHealthRegenAuraMod";
// A new player's mods: the basics, no aura and no stance.
const BASICS = ["Vitality", "Redirection", "Steel Fiber", "Streamline", "Continuity", "Intensify", "Stretch", "Flow", "Pressure Point", "Fury", "Reach", "Serration"];
const owns = (names: string[]): Owned => new Map(names.map((n) => [mod(n).uniqueName, mod(n).maxRank ?? 0]));
const row = (path: string, name: string): InventoryRow => ({ item_id: path, name, category: "mod", quantity: 1, mastered: false, image_name: null, rank: CAT.get(path)?.maxRank ?? 0, max_rank: null });
const modelOf = (names: string[]) => {
  const bundle: Bundle = { observed_at: null, inventory: names.map((n) => row(mod(n).uniqueName, n)), catalog, relics: [], prices: { prices: { [STARTER_AURA]: 4 } } };
  return buildModel(bundle, undefined, null, null, null, null, null);
};

test("Dreamer's Bond in the item data: an aura, Omni-read polarity, drain -2, rank 5; New player by MyOrbiter's override", () => {
  const db = CAT.get(DB)!;
  assert.equal(db.name, STARTER_AURA);
  assert.equal(db.compatName, "AURA");
  assert.equal(db.polarity, "aura");
  assert.equal(db.baseDrain, -2);
  assert.equal(db.maxRank, 5);
  assert.deepEqual(db.drops, []);
  const a = availability(db);
  assert.equal(a.level, "new");
  assert.equal(a.rule, "override");
});

test("a New player build for a frame with no aura owned shows Dreamer's Bond, marked and not counted", () => {
  for (const frame of ["Rhino Prime", "Saryn Prime", "Mesa Prime"]) {
    const it = item(frame);
    const s = suggest(it, "low", owns(BASICS), index);
    assert.equal(s.aura?.path, DB, frame);
    assert.equal(s.names.aura, STARTER_AURA);
    assert.deepEqual(s.uncounted, ["aura"], frame);
    // The sentence doesn't claim the player owns it, and says what the capacity becomes.
    assert.match(s.reasons.aura ?? "", /^Dreamer's Bond: an aura new players have access to, and any aura adds capacity\. It isn't in your inventory yet, so the capacity it adds isn't counted: 7 more once you have it\.$/, frame);
    assert.doesNotMatch(s.reasons.aura ?? "", /you hold|you own/);
    assert.ok(!s.upgrades.some((u) => u.path === DB), "not also an upgrade");
    // The mods fit the 30 actually counted.
    assert.equal(s.capacity.max, 30);
    assert.ok(s.capacity.used <= 30, `${frame}: ${s.capacity.used} of 30`);
    // The page's count agrees: the same tier, capacity 30, and the line says what it becomes.
    const t = tierOf(toBuild(s), it, CAT, "warframe", { uncounted: s.uncounted });
    assert.equal(t.tier, "low", frame);
    assert.equal(t.capacity, 30);
    assert.ok(t.drain <= 30);
    assert.equal(t.slots.find((x) => x.slot === "aura")?.uncounted, true);
    assert.ok(t.reasons.includes("Dreamer's Bond (aura) not owned yet, so not counted: capacity 30, 37 once you have it."), t.reasons.join(" | "));
  }
});

test("Dreamer's Bond owned is used and counted like any aura; an owned aura comes before it", () => {
  const rhino = item("Rhino Prime");
  const s = suggest(rhino, "low", owns([...BASICS, STARTER_AURA]), index);
  assert.equal(s.aura?.path, DB);
  assert.deepEqual(s.uncounted, []);
  assert.match(s.reasons.aura ?? "", /^Dreamer's Bond: an aura you hold, for the capacity it adds \(7 in this slot\)/);
  // An aura the frame's list prefers, owned and allowed: it wins (Intermediate: auras drop past the early star chart).
  const m = suggest(rhino, "medium", owns([...BASICS, STARTER_AURA, "Corrosive Projection"]), index);
  assert.equal(m.names.aura, "Corrosive Projection");
  assert.deepEqual(m.uncounted, []);
});

test("Intermediate and Veteran with no aura owned: the frame's aura is shown, marked, not counted, not an upgrade", () => {
  const rhino = item("Rhino Prime");
  for (const tier of ["medium", "high"] as const) {
    const s = suggest(rhino, tier, owns(BASICS), index);
    assert.equal(s.names.aura, "Corrosive Projection", tier);
    assert.deepEqual(s.uncounted, ["aura"]);
    assert.ok(!s.upgrades.some((u) => u.name === "Corrosive Projection"));
    assert.match(s.reasons.aura ?? "", /It isn't in your inventory yet, so the capacity it adds isn't counted: \d+ more once you have it\.$/);
  }
});

test("a melee build with no stance owned shows one, marked and not counted", () => {
  const gram = item("Gram Prime");
  const s = suggest(gram, "medium", owns(BASICS), index);
  assert.ok(s.stance, "a stance shown");
  assert.equal(index.byPath.get(s.stance!.path)?.type, "Stance Mod");
  assert.deepEqual(s.uncounted, ["stance"]);
  assert.ok(!s.upgrades.some((u) => u.path === s.stance!.path));
  const t = tierOf(toBuild(s), gram, CAT, "melee", { uncounted: s.uncounted });
  // Capacity is the rank (doubled with a Catalyst), the stance left out.
  assert.equal(t.capacity, t.rank * (t.catalyst ? 2 : 1));
  const stanceSlot = t.slots.find((x) => x.slot === "stance")!;
  assert.equal(stanceSlot.uncounted, true);
  assert.ok(t.reasons.includes(`${s.names.stance} (stance) not owned yet, so not counted: capacity ${t.capacity}, ${t.capacity - stanceSlot.drain} once you have it.`), t.reasons.join(" | "));
});

test("a pasted or saved build counts its aura as written: the inventory never changes its count", () => {
  const rhino = item("Rhino Prime");
  const s = suggest(rhino, "low", owns(BASICS), index);
  const b = toBuild(s);
  const asWritten = capacityOf(b, rhino, CAT);
  assert.equal(asWritten.capacity, 37, "a saved copy counts the aura it holds");
  assert.ok(!asWritten.slots.some((x) => x.uncounted));
  assert.equal(capacityOf({ ...b, source: "pasted" }, rhino, CAT).capacity, 37);
  assert.equal(tierOf(b, rhino, CAT).capacity, 37);
});

test("the what's-missing list counts an unowned aura shown in its slot once, with its Endo and price", () => {
  const rhino = item("Rhino Prime");
  const s = suggest(rhino, "low", owns(BASICS), index);
  const b = toBuild(s);
  const m = modelOf(BASICS);
  const t = tierOf(b, rhino, CAT, "warframe", { uncounted: s.uncounted });
  const r = missing(b, m, { tier: t });
  const lines = r.lines.filter((l) => l.path === DB);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].have, "missing");
  assert.equal(lines[0].endo, 620, "Uncommon to rank 5: 20 × (2^5 − 1)");
  assert.equal(lines[0].price, 4);
  // The Endo total adds up line by line, and the upgrades don't repeat it.
  assert.equal(r.endo, r.lines.reduce((n, l) => n + (l.kind === "mod" ? (l.endo ?? 0) : 0), 0));
  assert.ok(!s.upgrades.some((u) => u.path === DB));
});
