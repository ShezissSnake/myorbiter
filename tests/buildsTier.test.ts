// Builds: mod capacity (capacityOf) and the progression tier a build needs (tierOf), rule by rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bonusIn,
  drainIn,
  matches,
  rankWith,
  slotLayout,
  capacityOf,
  tierOf,
} from "../src/lib/core/builds";
import { CAT, item, P, build } from "./support/buildsCatalog";

// ---------------------------------------------------------------- capacity rules

test("drain: half on its polarity, 25% more on another (both rounded up), as listed on none", () => {
  assert.equal(drainIn(9, "madurai", "madurai"), 5);
  assert.equal(drainIn(14, "madurai", "madurai"), 7);
  assert.equal(drainIn(9, "madurai", "naramon"), 12);
  assert.equal(drainIn(12, "madurai", "vazarin"), 15);
  assert.equal(drainIn(9, "madurai", null), 9);
  assert.equal(drainIn(9, null, "madurai"), 9);
});

test("aura and stance: twice on their polarity, 20% less on another (rounded down), as listed on none", () => {
  assert.equal(bonusIn(9, "madurai", "madurai"), 18);
  assert.equal(bonusIn(7, "naramon", "madurai"), 5);
  assert.equal(bonusIn(7, "naramon", null), 7);
});

test("Omni matches every polarity but Umbra; Umbra slots match only Umbra mods", () => {
  assert.equal(matches("madurai", "universal"), true);
  assert.equal(matches("umbra", "universal"), false);
  assert.equal(matches("umbra", "umbra"), true);
  assert.equal(matches("madurai", "umbra"), false);
  assert.equal(drainIn(16, "umbra", "universal"), 20);
});

test("rank: 30; Kuva, Tenet, Coda and Paracesis two more a Forma to 40; Necramechs 40", () => {
  assert.equal(rankWith(item(P.braton), "primary", 5), 30);
  assert.equal(rankWith(item(P.bramma), "primary", 0), 30);
  assert.equal(rankWith(item(P.bramma), "primary", 3), 36);
  assert.equal(rankWith(item(P.bramma), "primary", 9), 40);
  assert.equal(rankWith({ name: "Paracesis" }, "melee", 5), 40);
  assert.equal(rankWith({ name: "Tenet Arca Plasmor" }, "primary", 1), 32);
  assert.equal(rankWith(item(P.voidrig), "necramech", 0), 40);
  assert.equal(slotLayout("necramech").mods, 12);
  assert.equal(slotLayout("warframe").aura, true);
  assert.equal(slotLayout("melee").stance, true);
});

// ---------------------------------------------------------------- capacity (capacityOf: what capacity alone needs)

test("capacity low: fits in 30 without a Catalyst", () => {
  const t = capacityOf(build(P.braton, [{ path: P.serration, rank: 3 }, P.pointStrike]), item(P.braton), CAT);
  assert.equal(t.tier, "low");
  assert.equal(t.drain, 16);
  assert.equal(t.capacity, 30);
  assert.equal(t.catalyst, false);
  assert.match(t.reasons[0], /^Fits in 30: drain 16 of 30/);
});

test("capacity medium: needs the Catalyst, no Forma", () => {
  const t = capacityOf(build(P.braton, [P.serration, P.splitChamber, P.vitalSense, P.pointStrike]), item(P.braton), CAT);
  assert.equal(t.tier, "medium");
  assert.equal(t.drain, 42);
  assert.equal(t.capacity, 60);
  assert.equal(t.forma, 0);
  assert.match(t.reasons[0], /Needs an Orokin Catalyst/);
});

test("capacity high: the fewest Forma, greedily where they free the most, named by polarity and slot", () => {
  const t = capacityOf(build(P.braton, [P.serration, P.splitChamber, P.vitalSense, P.pointStrike, P.hellfire, P.infectedClip, P.stormbringer, P.vigilante]), item(P.braton), CAT);
  // 14 + 10 + 9 + 9 + 11 + 11 + 11 + 9 = 84 against 60: Serration frees 7, the 11s and Split Chamber 5 each.
  assert.equal(t.tier, "high");
  assert.equal(t.fits, true);
  assert.equal(t.forma, 5);
  assert.equal(t.drain, 57);
  assert.deepEqual(t.formaPlan.map((f) => [f.slot, f.polarity]), [[1, "madurai"], [5, "naramon"], [6, "naramon"], [7, "naramon"], [2, "madurai"]]);
  assert.equal(t.reasons[0], "Needs an Orokin Catalyst and 5 Forma.");
  assert.equal(t.reasons[1], "Forma: Madurai (V) for Serration (slot 1), Split Chamber (slot 2); Naramon (—) for Hellfire (slot 5), Infected Clip (slot 6), Stormbringer (slot 7).");
  assert.ok(t.slots.find((s) => s.slot === 1 && s.drain === 7 && s.polarity === "madurai"));
});

test("innate polarities are used first: matching mods go on them", () => {
  // Hek: one Madurai slot. Hell's Chamber (11) on it drains 6.
  const t = capacityOf(build(P.hek, [P.hellsChamber, P.pointBlank]), item(P.hek), CAT);
  assert.equal(t.drain, 6 + 9);
  // A mismatched mod goes in a blank slot before a polarized one.
  const v = capacityOf(build(P.rhino, [P.primedContinuity]), item(P.rhino), CAT);
  assert.equal(v.slots[0].polarity, null);
  assert.equal(v.drain, 14);
});

test("the aura adds capacity, twice on its polarity, and the reason says so", () => {
  // Rhino Prime: V aura slot; Vitality on a D slot (6), Streamline on the — slot (5), Primed Continuity (14) and Intensify (9) blank.
  const mods = [P.vitality, P.streamline, P.primedContinuity, P.intensify];
  const t = capacityOf(build(P.rhino, mods, { aura: { path: P.steelCharge } }), item(P.rhino), CAT);
  assert.equal(t.tier, "low");
  assert.equal(t.drain, 34);
  assert.equal(t.capacity, 48);
  assert.equal(t.reasons[0], "Fits in 30 with the Steel Charge aura on its Madurai slot: drain 34 of 48.");
  assert.deepEqual(t.slots[0], { slot: "aura", path: P.steelCharge, name: "Steel Charge", polarity: "madurai", drain: -18 });
  // Corrosive Projection (7) on the V slot gives 5; a Forma on the aura slot is worth 9.
  const cp = capacityOf(build(P.rhino, [...mods, P.umbralVitality, P.umbralFiber], { aura: { path: P.corrosiveProjection } }), item(P.rhino), CAT);
  assert.equal(cp.tier, "high");
  assert.equal(cp.formaPlan[0].slot, "aura");
  assert.equal(cp.formaPlan[0].polarity, "naramon");
});

test("Umbral mods take Umbra Forma on warframes, counted apart", () => {
  const t = capacityOf(build(P.rhino, [P.umbralVitality, P.umbralFiber, P.umbralIntensify, P.primedContinuity]), item(P.rhino), CAT);
  // 16 × 3 + 14 = 62 against 60: one Umbra Forma frees 8.
  assert.equal(t.forma, 1);
  assert.equal(t.umbraForma, 1);
  assert.equal(t.formaPlan[0].polarity, "umbra");
  assert.ok(t.reasons.includes("One of them is an Umbra Forma."));
});

test("an exilus mod needs an adapter, which makes it high even when it fits in 30", () => {
  const t = capacityOf(build(P.braton, [P.serration], { exilus: { path: P.vigilante } }), item(P.braton), CAT);
  assert.equal(t.tier, "high");
  assert.equal(t.exilusAdapter, true);
  assert.equal(t.catalyst, false);
  assert.equal(t.drain, 14 + 5, "Vigilante on the Braton's Naramon exilus slot drains 5");
  assert.equal(t.reasons[0], "Needs an Exilus Adapter.");
});

test("an arcane on a primary needs an Arcane Adapter; on a warframe it doesn't", () => {
  const t = capacityOf(build(P.braton, [P.serration], { arcanes: [{ path: P.merciless }] }), item(P.braton), CAT);
  assert.equal(t.arcaneAdapter, true);
  assert.equal(t.tier, "high");
  assert.match(t.reasons[0], /Arcane Adapter \(Primary\)/);
  const f = capacityOf(build(P.rhino, [P.vitality], { arcanes: [{ path: P.energize }] }), item(P.rhino), CAT);
  assert.equal(f.arcaneAdapter, false);
  assert.equal(f.tier, "low");
});

test("Kuva weapons: Forma also add capacity, two ranks each, to five", () => {
  // Kuva Bramma: one Madurai slot. Eight 14-drain Madurai mods: 14 × 7 + 7 = 105.
  const mods = Array.from({ length: 8 }, (_, i) => ({ path: i % 2 ? P.serration : P.splitChamber, rank: i % 2 ? 10 : 5 }));
  const t = capacityOf(build(P.bramma, mods), item(P.bramma), CAT);
  assert.equal(t.tier, "high");
  assert.ok(t.rank > 30, `rank counted ${t.rank}`);
  assert.ok(t.fits);
  assert.ok(t.reasons.some((r) => /Rank 40 needs five Forma/.test(r)));
});

test("Necramechs count all twelve slots at rank 40", () => {
  const mods = Array.from({ length: 12 }, () => P.necramechVitality);
  const t = capacityOf(build(P.voidrig, mods), item(P.voidrig), CAT);
  // 14 each: one on the Vazarin slot (7), eleven blank (154): 161 > 80.
  assert.equal(t.rank, 40);
  assert.equal(t.slots.length, 12);
  assert.equal(t.tier, "high");
  assert.equal(capacityOf(build(P.voidrig, [P.necramechVitality, P.necramechVitality]), item(P.voidrig), CAT).tier, "low");
});

test("a build that can't fit says by how much; unknown mods are left out and said", () => {
  const big = Array.from({ length: 8 }, () => P.umbralVitality);
  const t = capacityOf(build(P.braton, [...big.slice(0, 7), "/Lotus/Upgrades/Mods/Nope"]), item(P.braton), CAT);
  assert.equal(t.unknown.length, 1);
  assert.ok(t.reasons.some((r) => /1 mod MyOrbiter doesn't know/.test(r)));
  // Umbral mods on a rifle: no Umbra Forma, so nothing frees enough.
  assert.equal(t.fits, false);
  assert.match(t.reasons[0], /^Doesn't fit even with an Orokin Catalyst: drain \d+ of 60, \d+ over\.$/);
});
