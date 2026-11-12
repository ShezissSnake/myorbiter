// Builds: the bonus element of a Kuva, Tenet or Coda weapon (element.ts), worked out from a build's mods.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bonusElement, combineElements, elementOfMod, takesBonusElement, type Build } from "../src/lib/core/builds";
import type { CatalogItem } from "../src/lib/core/types";

const mod = (path: string, name: string, stats: string[]): CatalogItem => ({ uniqueName: path, name, category: "Mods", type: "Primary Mod", polarity: "naramon", baseDrain: 6, maxRank: 5, maxStats: stats });
const M = {
  hellfire: mod("/m/Hellfire", "Hellfire", ["+90% <DT_FIRE_COLOR>Heat"]),
  infected: mod("/m/InfectedClip", "Infected Clip", ["+90% <DT_POISON_COLOR>Toxin"]),
  cryo: mod("/m/CryoRounds", "Cryo Rounds", ["+90% <DT_FREEZE_COLOR>Cold"]),
  malignant: mod("/m/MalignantForce", "Malignant Force", ["+60% <DT_POISON_COLOR>Toxin", "+60% Status Chance"]),
  storm: mod("/m/Stormbringer", "Stormbringer", ["+90% <DT_ELECTRICITY_COLOR>Electricity"]),
  serration: mod("/m/Serration", "Serration", ["+165% Damage"]),
};
const kuva: CatalogItem = { uniqueName: "/w/KuvaKarak", name: "Kuva Karak", category: "Primary", type: "Rifle", masterable: true, damage: { impact: 10, puncture: 10, slash: 10 } };
const nukor: CatalogItem = { uniqueName: "/w/KuvaNukor", name: "Kuva Nukor", category: "Secondary", type: "Pistol", masterable: true, damage: { radiation: 21 } };
const agendus: CatalogItem = { uniqueName: "/w/TenetAgendus", name: "Tenet Agendus", category: "Melee", type: "Melee", masterable: true, damage: { impact: 120, electricity: 140 } };
const CAT = new Map([...Object.values(M), kuva, nukor, agendus].map((c) => [c.uniqueName, c]));
const b = (kind: Build["kind"], mods: CatalogItem[]): Pick<Build, "kind" | "mods"> => ({ kind, mods: [...mods.map((m) => ({ path: m.uniqueName })), null, null] });

test("a mod's element comes from its max-rank stats", () => {
  assert.equal(elementOfMod(M.hellfire), "heat");
  assert.equal(elementOfMod(M.malignant), "toxin");
  assert.equal(elementOfMod(M.serration), null);
});

test("elements combine in slot order, the first base element still alone taking the next; a repeat adds to what's there", () => {
  assert.deepEqual(combineElements(["toxin", "cold", "heat"]), ["viral", "heat"]);
  assert.deepEqual(combineElements(["toxin", "heat", "cold"]), ["gas", "cold"]);
  assert.deepEqual(combineElements(["toxin", "cold", "toxin"]), ["viral"]);
  assert.deepEqual(combineElements(["heat"], ["radiation"]), ["heat", "radiation"]);
});

test("only Kuva, Tenet and Coda weapons take a bonus element", () => {
  assert.equal(takesBonusElement({ name: "Kuva Karak" }, "primary"), true);
  assert.equal(takesBonusElement({ name: "Tenet Agendus" }, "melee"), true);
  assert.equal(takesBonusElement({ name: "Coda Tysis" }, "secondary"), true);
  assert.equal(takesBonusElement({ name: "Paracesis" }, "melee"), false);
  assert.equal(takesBonusElement({ name: "Karak" }, "primary"), false);
  assert.equal(bonusElement(b("primary", [M.hellfire]), { ...kuva, name: "Karak" }, CAT), null);
});

test("Viral and Heat: the bonus is the Heat that stands on its own, which frees its mod", () => {
  const r = bonusElement(b("primary", [M.serration, M.infected, M.cryo, M.hellfire]), kuva, CAT)!;
  assert.equal(r.element, "heat");
  assert.deepEqual(r.frees, { path: M.hellfire.uniqueName, name: "Hellfire" });
  assert.deepEqual(r.result, ["viral", "heat"]);
  assert.equal(r.why, "The build keeps Heat on its own beside Viral, so the bonus does Hellfire's job and frees its slot.");
});

test("a pair alone: either half can be the bonus; the first in slot order is named", () => {
  const r = bonusElement(b("primary", [M.infected, M.cryo]), kuva, CAT)!;
  assert.equal(r.element, "toxin");
  assert.equal(r.why, "The build still makes Viral with it, so Infected Clip's slot is free for another mod.");
});

test("the weapon's own elements count: Tenet Agendus's Electricity makes Corrosive with a Toxin mod", () => {
  const alone = bonusElement(b("melee", [M.infected]), agendus, CAT)!;
  assert.deepEqual(alone.result, ["corrosive"]);
  assert.equal(alone.element, "toxin", "a Toxin bonus still makes Corrosive with the weapon's Electricity");
});

test("an innate combined element stays apart: Kuva Nukor's Radiation", () => {
  const r = bonusElement(b("secondary", [M.cryo]), nukor, CAT)!;
  assert.deepEqual(r.result, ["cold", "radiation"]);
  assert.equal(r.element, "cold");
});

test("no elemental mods: no element, and it says why", () => {
  const r = bonusElement(b("primary", [M.serration]), kuva, CAT)!;
  assert.equal(r.element, null);
  assert.match(r.why, /No elemental mods/);
});

test("two pairs: the last element of the second can come last as the bonus", () => {
  // Heat then Toxin make Gas; Electricity then Cold make Magnetic. Without Stormbringer, Cold waits
  // alone and the Electricity bonus joins it: Magnetic again.
  const r = bonusElement(b("primary", [M.hellfire, M.infected, M.storm, M.cryo]), kuva, CAT)!;
  assert.deepEqual(r.result, ["gas", "magnetic"]);
  assert.equal(r.element, "electricity");
  assert.equal(r.frees?.name, "Stormbringer");
});

test("when no bonus can replace a mod without changing the result, none is named", () => {
  // Tenet Agendus: Heat + Toxin make Gas, its own Electricity stays apart. Without Infected Clip the
  // weapon's Electricity would take the Heat (Radiation); without Hellfire, the Toxin (Corrosive).
  const r = bonusElement(b("melee", [M.hellfire, M.infected]), agendus, CAT)!;
  assert.deepEqual(r.result, ["gas", "electricity"]);
  assert.equal(r.element, null);
  assert.equal(r.why, "No bonus element can stand in for one of this build's elemental mods without changing its Gas and Electricity.");
  // Toxin and Cold, with the weapon's Electricity: neither half can be the bonus either.
  assert.equal(bonusElement(b("melee", [M.infected, M.cryo]), agendus, CAT)!.element, null);
});
