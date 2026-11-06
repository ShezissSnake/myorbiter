import { test } from "node:test";
import assert from "node:assert/strict";
import { gearOf, noticesOf, relicRunsOf, rivensOf, valueHistoryOf } from "../src/lib/core/savedGame";

const JUNK = [null, 5, "x", [], {}, { at: "1" }];

test("the saved game state reads back as saved; entries a damaged file turned into something else are left out", () => {
  const point = { at: 1, worth: 100, liquid: 80, platinum: null, credits: 5, endo: null, held: { ducats: 3 }, complete: true };
  assert.deepEqual(valueHistoryOf([...JUNK, point, { ...point, held: 4 }]), [point]);
  const run = { at: 2, cards: ["Ash Prime Systems Blueprint"], relics: ["/Lotus/Types/Game/Projections/T1VoidProjectionAIntact"], mission: null, own: null, before: { "Ash Prime Systems Blueprint": 0 }, baseAt: 1 };
  assert.deepEqual(relicRunsOf([...JUNK, run, { ...run, cards: [3] }, { ...run, imported: true, before: undefined }]), [run, { ...run, imported: true, before: undefined }]);
  const notice = { id: "1-abc", at: 3, kind: "sold", title: "You sold", body: "", read: false, rep: { key: "k", partner: "ExamplePlayer" } };
  assert.deepEqual(noticesOf([...JUNK, notice, { ...notice, read: "no" }]), [notice]);
  const gear = { type: "/Lotus/Weapons/Tenno/Rifle/Braton", f: 513, p: 2, s: "LongGuns" };
  assert.deepEqual(gearOf([...JUNK, gear, { ...gear, f: "1" }]), [gear]);
  assert.equal(gearOf(null), null);
  assert.equal(gearOf({ 0: gear }), null);
  const riven = { type: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare", id: "r1", fp: { compat: "x", buffs: [] } };
  assert.deepEqual(rivensOf([...JUNK, riven, { ...riven, pending: { buffs: [] } }, { ...riven, fp: "x" }]), [riven, { ...riven, pending: { buffs: [] } }]);
  assert.equal(rivensOf("x"), null);
});
