// The Watching column's own choice of fissures (core/board.ts › chosenFissures, fissureChoiceOf):
// kinds, eras and mission types apart from Home's board, or only what the fissure alerts match.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chosenFissures, choiceFromHome, fissureChoiceOf, fissuresByEra, missionTypes, MISSIONS, type FissureChoice } from "../src/lib/core/board";
import type { FissureRule } from "../src/lib/core/timers";
import type { Fissure } from "../src/lib/core/types";

const NOW = Date.parse("2026-11-13T20:00:00Z");
const f = (id: string, tier: string, extra: Partial<Fissure> = {}): Fissure => ({ id, node: "Everest (Earth)", missionType: "Excavation", enemy: "Grineer", tier, tierNum: 1, isStorm: false, isHard: false, expiry: "2026-11-13T21:00:00Z", ...extra });
const FS = [
  f("lith-cap", "Lith", { missionType: "Capture", expiry: "2026-11-13T21:30:00Z" }),
  f("lith-exc", "Lith"),
  f("meso-def", "Meso", { missionType: "Defense", expiry: "2026-11-13T20:30:00Z" }),
  f("axi-cap-sp", "Axi", { missionType: "Capture", isHard: true }),
  f("neo-surv-sp", "Neo", { missionType: "Survival", isHard: true, expiry: "2026-11-13T20:20:00Z" }),
  f("neo-cap-storm", "Neo", { missionType: "Capture", isStorm: true, node: "Nsu Grid (Veil Proxima)" }),
  f("closed", "Axi", { missionType: "Capture", expiry: "2026-11-13T19:00:00Z" }),
  f("closed-sp", "Lith", { missionType: "Capture", isHard: true, expiry: "2026-11-13T19:59:00Z" }),
];
const choice = (c: Partial<FissureChoice> = {}): FissureChoice => ({ kinds: ["normal"], eras: [], missions: [], only: false, ...c });
const ids = (r: ReturnType<typeof chosenFissures>) => (r.mine ? r.soonest : r.eras.flatMap((e) => e.list)).map((x) => x.id);
const byEra = (r: ReturnType<typeof chosenFissures>) => r.eras.map((e) => [e.era, e.list.map((x) => x.id)]);
const rule = (r: Partial<FissureRule>): FissureRule => ({ id: "r", kinds: [], tiers: [], missions: [], planets: [], ...r });

test("Watching's fissures: each kind alone is what Home's board lists for it, in the same order", () => {
  for (const kind of ["normal", "steel", "storm"] as const) {
    const r = chosenFissures(FS, choice({ kinds: [kind] }), [], NOW);
    assert.equal(r.mine, false);
    assert.deepEqual(r.eras, fissuresByEra(FS, kind, NOW), kind);
    assert.equal(r.narrowed, false);
  }
  assert.deepEqual(byEra(chosenFissures(FS, choice({ kinds: ["normal"] }), [], NOW)), [["Lith", ["lith-cap", "lith-exc"]], ["Meso", ["meso-def"]]]);
  assert.deepEqual(ids(chosenFissures(FS, choice({ kinds: ["steel"] }), [], NOW)), ["neo-surv-sp", "axi-cap-sp"]);
  assert.deepEqual(ids(chosenFissures(FS, choice({ kinds: ["storm"] }), [], NOW)), ["neo-cap-storm"]);
});

test("Watching's fissures: two kinds together stay grouped by era, quick missions first, then soonest", () => {
  const r = chosenFissures(FS, choice({ kinds: ["normal", "steel"] }), [], NOW);
  assert.deepEqual(byEra(r), [["Lith", ["lith-cap", "lith-exc"]], ["Meso", ["meso-def"]], ["Neo", ["neo-surv-sp"]], ["Axi", ["axi-cap-sp"]]]);
  assert.deepEqual(r.eras, fissuresByEra(FS.filter((x) => !x.isStorm), "all", NOW));
  assert.deepEqual(byEra(chosenFissures(FS, choice({ kinds: ["steel", "storm"] }), [], NOW)), [["Neo", ["neo-cap-storm", "neo-surv-sp"]], ["Axi", ["axi-cap-sp"]]]);
  assert.equal(chosenFissures(FS, choice({ kinds: ["normal", "steel", "storm"] }), [], NOW).count, 6, "every open one, the closed ones left out");
});

test("Watching's fissures: one era, two eras, none", () => {
  const all = choice({ kinds: ["normal", "steel", "storm"] });
  const one = chosenFissures(FS, { ...all, eras: ["Neo"] }, [], NOW);
  assert.deepEqual(byEra(one), [["Neo", ["neo-cap-storm", "neo-surv-sp"]]]);
  assert.equal(one.narrowed, true);
  assert.deepEqual(byEra(chosenFissures(FS, { ...all, eras: ["Axi", "Lith"] }, [], NOW)).map(([e]) => e), ["Lith", "Axi"]);
  const none = chosenFissures(FS, all, [], NOW);
  assert.deepEqual(byEra(none).map(([e]) => e), ["Lith", "Meso", "Neo", "Axi"], "no era chosen is every era");
  assert.equal(none.narrowed, false);
});

test("Watching's fissures: one mission type, none", () => {
  const r = chosenFissures(FS, choice({ kinds: ["normal", "steel", "storm"], missions: ["Capture"] }), [], NOW);
  assert.deepEqual(ids(r), ["lith-cap", "neo-cap-storm", "axi-cap-sp"]);
  assert.equal(r.narrowed, true);
  assert.equal(chosenFissures(FS, choice({ kinds: ["normal"], missions: [] }), [], NOW).count, 3, "no mission chosen is every mission");
});

test("Watching's fissures: kind, era and mission type at once", () => {
  assert.deepEqual(ids(chosenFissures(FS, choice({ kinds: ["steel"], eras: ["Axi", "Neo"], missions: ["Capture"] }), [], NOW)), ["axi-cap-sp"]);
  const nothing = chosenFissures(FS, choice({ kinds: ["storm"], eras: ["Lith"], missions: ["Capture"] }), [], NOW);
  assert.deepEqual(nothing.eras, []);
  assert.equal(nothing.count, 0);
  assert.equal(nothing.narrowed, true);
});

test("Watching's fissures: Only my alerts lists the alerts' matches of every kind, soonest first, the three choices aside", () => {
  const rules = [rule({ missions: ["Capture"], kinds: ["normal", "steel", "storm"] }), rule({ id: "s", tiers: ["Neo"] })];
  const r = chosenFissures(FS, { kinds: ["normal"], eras: ["Meso"], missions: ["Defense"], only: true }, rules, NOW);
  assert.equal(r.mine, true);
  assert.equal(r.narrowed, false, "eras and missions don't apply, so they narrow nothing");
  assert.deepEqual(r.eras, []);
  assert.deepEqual(ids(r), ["neo-surv-sp", "axi-cap-sp", "neo-cap-storm", "lith-cap"]);
  // No alert: Only my alerts has nothing to go by, and the choices apply again.
  const none = chosenFissures(FS, { kinds: ["normal"], eras: ["Meso"], missions: [], only: true }, [], NOW);
  assert.equal(none.mine, false);
  assert.deepEqual(ids(none), ["meso-def"]);
});

test("Watching's fissures: a closed fissure is left out, with and without Only my alerts", () => {
  const every = choice({ kinds: ["normal", "steel", "storm"], missions: ["Capture"] });
  assert.ok(!ids(chosenFissures(FS, every, [], NOW)).some((x) => x.startsWith("closed")));
  assert.ok(!ids(chosenFissures(FS, { ...every, only: true }, [rule({ missions: ["Capture"], kinds: ["normal", "steel"] })], NOW)).some((x) => x.startsWith("closed")));
  assert.equal(chosenFissures(null, every, [], NOW).count, 0);
});

test("Watching's fissures: the count the heading shows is the number of cards listed", () => {
  const rules = [rule({ tiers: ["Lith", "Neo"], kinds: ["normal", "steel", "storm"] })];
  for (const c of [
    choice(),
    choice({ kinds: ["steel"] }),
    choice({ kinds: ["normal", "storm"], eras: ["Neo", "Lith"] }),
    choice({ kinds: ["normal", "steel", "storm"], missions: ["Capture", "Survival"] }),
    choice({ kinds: ["storm"], eras: ["Requiem"] }),
    choice({ only: true }),
  ]) {
    const r = chosenFissures(FS, c, rules, NOW);
    assert.equal(r.count, ids(r).length, JSON.stringify(c));
  }
});

test("Watching's fissures: the mission types offered are the alert form's, what's open and what's chosen", () => {
  const offered = missionTypes([f("x", "Lith", { missionType: "Netracells" })], ["Ascension"]);
  for (const m of [...MISSIONS, "Netracells", "Ascension"]) assert.ok(offered.includes(m), m);
  assert.deepEqual(offered, [...offered].sort());
  assert.equal(new Set(offered).size, offered.length);
});

test("Watching's fissures: a saved choice is taken on no trust, each part falling to the older file's start", () => {
  const start = choiceFromHome("steel", true);
  assert.deepEqual(start, { kinds: ["steel"], eras: [], missions: [], only: true });
  const ok = { kinds: ["storm", "normal"], eras: ["Axi", "Lith"], missions: ["Capture", "Survival"], only: false };
  assert.deepEqual(fissureChoiceOf(ok, start), { kinds: ["normal", "storm"], eras: ["Lith", "Axi"], missions: ["Capture", "Survival"], only: false }, "kept, in the usual order");
  // Kinds: only the three, never none.
  assert.deepEqual(fissureChoiceOf({ ...ok, kinds: [] }, start).kinds, ["steel"]);
  assert.deepEqual(fissureChoiceOf({ ...ok, kinds: ["normal", "arbitration"] }, start).kinds, ["steel"]);
  assert.deepEqual(fissureChoiceOf({ ...ok, kinds: "normal" }, start).kinds, ["steel"]);
  // Eras: only TIERS.
  assert.deepEqual(fissureChoiceOf({ ...ok, eras: ["Axi", "Vanguard"] }, start).eras, []);
  assert.deepEqual(fissureChoiceOf({ ...ok, eras: ["axi"] }, start).eras, []);
  assert.deepEqual(fissureChoiceOf({ ...ok, eras: { 0: "Axi" } }, start).eras, []);
  // Missions: strings only, at most 40, each at most 60 characters.
  assert.deepEqual(fissureChoiceOf({ ...ok, missions: ["Capture", 7] }, start).missions, []);
  assert.deepEqual(fissureChoiceOf({ ...ok, missions: Array.from({ length: 41 }, (_, i) => `M${i}`) }, start).missions, []);
  assert.equal(fissureChoiceOf({ ...ok, missions: Array.from({ length: 40 }, (_, i) => `M${i}`) }, start).missions.length, 40);
  assert.deepEqual(fissureChoiceOf({ ...ok, missions: ["x".repeat(61)] }, start).missions, []);
  assert.deepEqual(fissureChoiceOf({ ...ok, missions: ["x".repeat(60)] }, start).missions, ["x".repeat(60)]);
  // Only my alerts: true or false.
  assert.equal(fissureChoiceOf({ ...ok, only: "yes" }, start).only, true);
  // Not an object at all: the start, whole.
  for (const raw of [null, undefined, 3, "steel", [ok]]) assert.deepEqual(fissureChoiceOf(raw, start), start);
});
