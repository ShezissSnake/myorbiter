// Builds: matching mod and arcane names, as people write them, against the catalog (match.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchName,
  nameIndex,
  normName,
} from "../src/lib/core/builds";
import { CAT, CATALOG, item, P } from "./support/buildsCatalog";

const IDX = nameIndex(CAT);

// ---------------------------------------------------------------- the matcher

test("names are compared without case, accents, apostrophes, punctuation or spacing", () => {
  assert.equal(normName("Hell's Chamber"), normName("hells   chamber"));
  assert.equal(normName("HELL’S CHAMBER"), "hells chamber");
  assert.equal(normName("Rubedo-Lined Barrel"), "rubedo lined barrel");
  assert.equal(normName("Ack & Brunt"), "ack and brunt");
  assert.equal(normName("Éxodia Might"), "exodia might");
});

test("a name matches the plain PvE mod, not its Flawed, Intermediate or Conclave twins", () => {
  const braton = item(P.braton);
  const s = matchName("serration", IDX, braton, "primary");
  assert.ok(s.ok);
  assert.equal(s.path, P.serration);
  assert.equal(s.via, "exact");
  const ps = matchName("Point Strike", IDX, braton, "primary");
  assert.ok(ps.ok);
  assert.equal(ps.path, P.pointStrike, "the Conclave one isn't picked");
  const flawed = matchName("Flawed Serration", IDX, braton, "primary");
  assert.ok(flawed.ok);
  assert.equal(flawed.path, P.serrationFlawed);
  assert.equal(flawed.name, "Flawed Serration");
  const none = matchName("Flawed Split Chamber", IDX, braton, "primary");
  assert.equal(none.ok, false);
  assert.equal(!none.ok && none.reason, "no-flawed");
});

test("Primed, Umbral and Galvanized spellings people use are read, and say so", () => {
  const rhino = item(P.rhino);
  const pc = matchName("Prime Continuity", IDX, rhino, "warframe");
  assert.ok(pc.ok);
  assert.equal(pc.path, P.primedContinuity);
  assert.equal(pc.via, "alias");
  const uv = matchName("umbra vitality", IDX, rhino, "warframe");
  assert.ok(uv.ok);
  assert.equal(uv.path, P.umbralVitality);
  const en = matchName("Energize", IDX, rhino, "warframe");
  assert.ok(en.ok, "Arcane Energize without the word");
  assert.equal(en.path, P.energize);
});

test("between same-name entries, odd folders lose and the one you hold wins a tie", () => {
  const rhino = item(P.rhino);
  const a = matchName("Adaptation", IDX, rhino, "warframe");
  assert.ok(a.ok);
  assert.equal(a.path, P.adaptation, "the Nemesis copy loses");
  // Two equal entries: the one held wins; the other is offered as an alternative.
  const twin = { ...item(P.continuity), uniqueName: "/Lotus/Upgrades/Mods/Warframe/AvatarAbilityDurationModB" };
  const idx = nameIndex([...CATALOG, twin]);
  const held = matchName("Continuity", idx, rhino, "warframe", "mod", (p) => (p === twin.uniqueName ? 1 : 0));
  assert.ok(held.ok);
  assert.equal(held.path, twin.uniqueName);
  assert.deepEqual(held.alternatives, [P.continuity]);
});

test("a mod for other gear isn't matched silently: it says what it's for", () => {
  const rhino = item(P.rhino);
  const s = matchName("Serration", IDX, rhino, "warframe");
  assert.equal(s.ok, false);
  assert.equal(!s.ok && s.reason, "wrong-gear");
  assert.equal(!s.ok && s.why, "a primary mod");
  // A rifle mod on a shotgun, a shotgun mod on a rifle, a pistol mod on a rifle.
  assert.equal(matchName("Serration", IDX, item(P.hek), "primary").ok, false);
  assert.equal(matchName("Point Blank", IDX, item(P.braton), "primary").ok, false);
  assert.ok(matchName("Point Blank", IDX, item(P.hek), "primary").ok);
  assert.equal(matchName("Hornet Strike", IDX, item(P.braton), "primary").ok, false);
  // An augment for another frame.
  const aug = matchName("Iron Shrapnel", IDX, { ...item(P.rhino), name: "Excalibur", uniqueName: "/Lotus/Powersuits/Excalibur/Excalibur" }, "warframe");
  assert.equal(!aug.ok && aug.why, "for Rhino");
  assert.ok(matchName("Iron Shrapnel", IDX, item(P.rhino), "warframe").ok, "Rhino Prime takes Rhino's augments");
  // Focus abilities never match gear.
  assert.equal(matchName("Lightning Dash", IDX, item(P.rhino), "warframe").ok, false);
});

test("a typo comes back unmatched with the close names that fit", () => {
  const r = matchName("Serraton", IDX, item(P.braton), "primary");
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "unknown");
  assert.equal(!r.ok && r.suggestions[0]?.name, "Serration");
  const s = matchName("Split Chambre", IDX, item(P.braton), "primary");
  assert.equal(!s.ok && s.suggestions[0]?.path, P.splitChamber);
});
