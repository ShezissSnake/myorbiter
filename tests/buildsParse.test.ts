// Builds: reading a build from pasted text (parse.ts). Every sample is written for the test:
// MyOrbiter never fetches build pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePaste,
} from "../src/lib/core/builds";
import { CAT, item, P, NOW } from "./support/buildsCatalog";

// ---------------------------------------------------------------- the paste parser

const FRAME_PAGE = `Rhino Prime - Iron Skin tank (Update 39)
Aura: Steel Charge
Exilus: Adaptation
Mods:
• Umbral Vitality R10
• Umbral Fiber (rank 10)
• Umbral Intensify [8]
• Primed Continuity (7/10)
• Stretch? no: Streamline max, Vitality
• Intensify
Arcanes: Arcane Energize, Arcane Grace, Molt Augmented
Orokin Reactor, 5 Forma (3 Umbral Forma)
2x Tauforged Azure Archon Shard: Health
Tauforged Crimson Archon Shard (Ability Strength)
Amber Archon Shard - Casting Speed
Helminth: Roar replacing Rhino Stomp
Notes: Iron Skin scales with armor, so Umbral Fiber is a must.`;

test("a build page copied whole is read: slots, ranks, arcanes, forma, reactor, shards, Helminth", () => {
  const r = parsePaste(FRAME_PAGE, item(P.rhino), CAT, { now: NOW });
  const b = r.build;
  assert.equal(b.kind, "warframe");
  assert.equal(b.source, "pasted");
  assert.equal(b.importedAt, NOW);
  assert.deepEqual(b.aura, { path: P.steelCharge });
  assert.deepEqual(b.exilus, { path: P.adaptation });
  assert.deepEqual(b.mods.slice(0, 7), [
    { path: P.umbralVitality, rank: 10 },
    { path: P.umbralFiber, rank: 10 },
    { path: P.umbralIntensify, rank: 8 },
    { path: P.primedContinuity, rank: 7 },
    { path: P.streamline },
    { path: P.vitality },
    { path: P.intensify },
  ]);
  assert.equal(b.mods.length, 8, "padded to the frame's eight slots");
  assert.equal(b.mods[7], null);
  assert.deepEqual(b.arcanes, [{ path: P.energize }, { path: P.grace }]);
  assert.deepEqual(r.leftOut, [{ name: "Molt Augmented", path: P.moltAugmented, why: "only 2 arcane slots" }]);
  assert.equal(b.catalyst, true);
  assert.equal(b.forma, 8, "5 Forma and 3 Umbra Forma");
  assert.ok(r.notes.some((n) => /3 of the Forma are Umbra/.test(n)));
  assert.deepEqual(b.shards, [
    { colour: "azure", tauforged: true, stat: "Health" },
    { colour: "azure", tauforged: true, stat: "Health" },
    { colour: "crimson", tauforged: true, stat: "Ability Strength" },
    { colour: "amber", tauforged: false, stat: "Casting Speed" },
  ]);
  assert.deepEqual(b.helminth, { ability: "Roar", replaces: "Rhino Stomp" });
  assert.equal(b.gameUpdate, "39");
  // The title line names the frame and an ability: neither is reported as an unknown mod.
  assert.deepEqual(r.unmatched.map((u) => u.text), ["Stretch"]);
  assert.ok(r.matched.every((x) => x.via === "exact"));
});

test("a chat message: names among other words, commas and plus signs, lowercase", () => {
  const msg = "running serration r10, split chamber, vital sense + point strike on my braton w/ catalyst and 2 forma. hellfire rank 3";
  const r = parsePaste(msg, item(P.braton), CAT, { now: NOW });
  assert.deepEqual(r.build.mods.filter(Boolean), [{ path: P.serration, rank: 10 }, { path: P.splitChamber }, { path: P.vitalSense }, { path: P.pointStrike }, { path: P.hellfire, rank: 3 }]);
  assert.equal(r.build.catalyst, true);
  assert.equal(r.build.forma, 2);
  assert.deepEqual(r.unmatched, []);
});

test("in a sentence, a one-word name counts only with a capital; labels and prose don't become names", () => {
  const prose = "I tried this for a while and found that the vitality boost is nice but you should really put Intensify in for strength builds.";
  const r = parsePaste(prose, item(P.rhino), CAT, { now: NOW });
  assert.deepEqual(r.build.mods.filter(Boolean), [{ path: P.intensify }]);
  assert.deepEqual(r.unmatched, []);
});

test("ranks next to names: R10, rank 5, (3/5), [10], max, unranked; capped at the mod's max", () => {
  const r = parsePaste("Serration rank 5\nSplit Chamber (3/5)\nVital Sense [12]\nPoint Strike unranked\nHellfire max", item(P.braton), CAT, { now: NOW });
  assert.deepEqual(r.build.mods.filter(Boolean), [
    { path: P.serration, rank: 5 },
    { path: P.splitChamber, rank: 3 },
    { path: P.vitalSense, rank: 5 },
    { path: P.pointStrike, rank: 0 },
    { path: P.hellfire },
  ]);
});

test("typos and mods for other gear come back unmatched with suggestions; nothing is placed for them", () => {
  const r = parsePaste("- Serraton\n- Hornet Strike\n- Split Chamber\n- Split Chamber", item(P.braton), CAT, { now: NOW });
  assert.deepEqual(r.build.mods.filter(Boolean), [{ path: P.splitChamber }]);
  const byText = Object.fromEntries(r.unmatched.map((u) => [u.text, u]));
  assert.equal(byText["Serraton"].reason, "unknown");
  assert.equal(byText["Serraton"].suggestions[0].name, "Serration");
  assert.equal(byText["Hornet Strike"].reason, "wrong-gear");
  assert.deepEqual(r.leftOut, [{ name: "Split Chamber", path: P.splitChamber, why: "listed twice" }]);
});

test("a ninth mod goes to the exilus slot, said in a note; a riven is skipped with a note", () => {
  const nine = [P.serration, P.splitChamber, P.vitalSense, P.pointStrike, P.hellfire, P.infectedClip, P.stormbringer, P.serrationMid, P.vigilante].map((p) => CAT.get(p)!.name);
  nine[7] = "Flawed Serration";
  const r = parsePaste(`${nine.join("\n")}\nRiven (optional)`, item(P.braton), CAT, { now: NOW });
  assert.equal(r.build.mods.filter(Boolean).length, 8);
  assert.deepEqual(r.build.exilus, { path: P.vigilante });
  assert.ok(r.notes.some((n) => /exilus slot/.test(n)));
  assert.ok(r.notes.some((n) => /riven/.test(n)));
});

test("a stance goes to the stance slot; an aura on a weapon has nowhere to go", () => {
  const r = parsePaste("Crimson Dervish, Pressure Point", item(P.nikana), CAT, { now: NOW });
  assert.deepEqual(r.build.stance, { path: P.crimsonDervish });
  assert.ok(r.matched.find((x) => x.path === P.crimsonDervish)?.note?.includes("stance"));
  assert.deepEqual(r.build.mods.filter(Boolean), [{ path: P.pressurePoint }]);
  const w = parsePaste("Steel Charge", item(P.braton), CAT, { now: NOW });
  assert.equal(w.unmatched[0]?.reason, "wrong-gear");
});

test("Helminth by ability number; shards and Helminth on a weapon are noted, not kept", () => {
  const r = parsePaste("Helminth: Nourish over 3", item(P.rhino), CAT, { now: NOW });
  assert.deepEqual(r.build.helminth, { ability: "Nourish", replaces: "Roar" });
  const odd = parsePaste("Helminth: Nourish replacing Smash", item(P.rhino), CAT, { now: NOW });
  assert.ok(odd.notes.some((n) => /Smash isn't one of Rhino Prime's abilities/.test(n)));
  const w = parsePaste("Nourish replacing Roar\nAzure Archon Shard: Health", item(P.braton), CAT, { now: NOW });
  assert.equal(w.build.helminth, undefined);
  assert.ok(w.notes.some((n) => /only for warframes/.test(n)));
  assert.ok(w.notes.some((n) => /warframes only/.test(n)));
});

test("a pasted line built to make the Helminth pattern backtrack reads in well under a second", () => {
  // "helminth " then "a on " over and over, ending in "!": each start tries each " on ", and the
  // second name then runs to the "!" and fails.
  for (const size of [200, 5_000, 20_000]) {
    const line = `helminth ${"a on ".repeat(Math.ceil(size / 5))}`.slice(0, size - 1) + "!";
    assert.equal(line.length, size);
    const t0 = performance.now();
    parsePaste(line, item(P.rhino), CAT, { now: NOW });
    const ms = performance.now() - t0;
    console.log(`${size} characters: ${ms.toFixed(1)} ms`);
    assert.ok(ms < 1000, `${size} characters: ${Math.round(ms)} ms`);
  }
  // The same, cut by commas into stretches of the longest length the pattern reads.
  const stretch = `${"a on ".repeat(40)}`.slice(0, 199) + "!";
  const line = `helminth ${Array(100).fill(stretch).join(",")}`;
  const t0 = performance.now();
  parsePaste(line, item(P.rhino), CAT, { now: NOW });
  const ms = performance.now() - t0;
  console.log(`${line.length} characters in stretches of 200: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000, `${line.length} characters in stretches: ${Math.round(ms)} ms`);
});

test("a long run of spaces after a rank, a forma count or a shard reads in well under a second", () => {
  // Each pattern once had two runs of spaces side by side, so a line of spaces was tried every way
  // it can be split in two: a 20,000-character line took about half a second.
  const lines: [string, string][] = [
    ["a rank", "r" + " ".repeat(19_998) + "x"],
    ["a forma count", "1" + " ".repeat(19_998) + "!"],
    ["a shard", "crimson shard:" + " ".repeat(19_985) + ","],
    ["a loose shard", "Shards: crimson:" + " ".repeat(19_983) + ","],
    ["a label", "aura" + " ".repeat(19_995) + "x"],
  ];
  for (const [what, line] of lines) {
    assert.equal(line.length, 20_000);
    const t0 = performance.now();
    parsePaste(line, item(P.rhino), CAT, { now: NOW });
    const ms = performance.now() - t0;
    console.log(`${what}, 20,000 characters: ${ms.toFixed(1)} ms`);
    assert.ok(ms < 250, `${what}: ${Math.round(ms)} ms`);
  }
});

test("a rank, a forma count and a shard read the same with spaces around their parts", () => {
  const r = parsePaste("Serration r  :  10\nSplit Chamber rank 5\n2 x  Forma\n3 Umbra Forma\nCrimson Archon Shard :  Ability Strength\nAzure shard (Health)", item(P.braton), CAT, { now: NOW });
  assert.deepEqual(r.build.mods.filter(Boolean), [{ path: P.serration, rank: 10 }, { path: P.splitChamber, rank: 5 }]);
  const w = parsePaste("Crimson Archon Shard :  Ability Strength\nAzure Archon Shard - Health  \n2 x  Forma", item(P.rhino), CAT, { now: NOW });
  assert.deepEqual(w.build.shards, [{ colour: "crimson", tauforged: false, stat: "Ability Strength" }, { colour: "azure", tauforged: false, stat: "Health" }]);
  assert.equal(w.build.forma, 2);
  const s = parsePaste("Shards: crimson : Ability Strength, azure", item(P.rhino), CAT, { now: NOW });
  assert.deepEqual(s.build.shards, [{ colour: "crimson", tauforged: false, stat: "Ability Strength" }, { colour: "azure", tauforged: false }]);
});

test("a whole build on one long line keeps its Helminth", () => {
  const line = "Rhino build for steel path, all mods maxed: Steel Charge, Primed Continuity, Intensify, Umbral Vitality, Umbral Fiber, Umbral Intensify, Streamline, Adaptation, Iron Shrapnel, Arcane Energize, Arcane Grace, Roar replacing Rhino Stomp, 5 Forma";
  assert.ok(line.length > 200);
  const r = parsePaste(line, item(P.rhino), CAT, { now: NOW });
  assert.deepEqual(r.build.helminth, { ability: "Roar", replaces: "Rhino Stomp" });
  assert.ok(!r.unmatched.some((u) => /roar|stomp/i.test(u.text)), JSON.stringify(r.unmatched));
});

test("a very long paste is read up to its first 20,000 characters, and says so", () => {
  // Ranks are taken out one by one, the line rebuilt each time: a paste of hundreds of thousands
  // of characters would take seconds.
  const text = "Vitality\n" + "r 1 ".repeat(50_000);
  const t0 = performance.now();
  const r = parsePaste(text, item(P.rhino), CAT, { now: NOW });
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${text.length} characters: ${Math.round(ms)} ms`);
  assert.deepEqual(r.build.mods.filter(Boolean), [{ path: P.vitality }]);
  assert.ok(r.notes.includes("Only the first 20,000 characters were read."), r.notes.join(" | "));
  // A paste of that size or less has no such note.
  assert.ok(!parsePaste("Vitality", item(P.rhino), CAT, { now: NOW }).notes.some((n) => /first 20,000/.test(n)));
});

test("Necramechs get twelve slots, and a gear kind can be given for what the catalog can't say", () => {
  const r = parsePaste("Necramech Vitality", item(P.voidrig), CAT, { now: NOW });
  assert.equal(r.build.kind, "necramech");
  assert.equal(r.build.mods.length, 12);
  assert.throws(() => parsePaste("x", { uniqueName: "/Lotus/Types/Items/MiscItems/Forma", name: "Forma", category: "Misc" }, CAT));
  assert.equal(parsePaste("Pressure Point", { uniqueName: "/Lotus/Exalted/Blade", name: "Exalted Blade", category: "Misc" }, CAT, { kind: "exalted" }).build.kind, "exalted");
});
