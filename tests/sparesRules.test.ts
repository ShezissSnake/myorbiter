// "Put my spares on sale", the choices: sanitising, the migration from the six switches, and the
// round trip back to them for the plan as it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultBulkRules, type BulkRules } from "../src/lib/core/bulk";
import {
  defaultSparesRules,
  isUsual,
  legacyRules,
  LICH_KEEP,
  neverSoldIn,
  NEVER_SELL_CAP,
  sparesRulesOf,
  summaryOf,
  sparesSettingsOf,
  toStored,
  usualKeeping,
  withNeverSell,
  withoutNeverSell,
} from "../src/lib/core/sparesRules";

const v1 = (x: Partial<BulkRules>): BulkRules => ({ ...defaultBulkRules(), ...x });

test("nothing saved: the usual rules", () => {
  assert.deepEqual(sparesRulesOf(undefined), defaultSparesRules());
  assert.deepEqual(sparesRulesOf("nonsense"), defaultSparesRules());
  assert.ok(isUsual(sparesRulesOf(null)));
});

test("the old defaults migrate to the new defaults", () => {
  assert.deepEqual(sparesRulesOf(defaultBulkRules()), defaultSparesRules());
});

test("old switches map to the same choices", () => {
  const r = sparesRulesOf(v1({ sets: true, parts: false, other: false, partsKeep: 3, priority: "trades" }));
  assert.equal(r.prime.on, true);
  assert.equal(r.prime.sellAs, "sets");
  assert.equal(r.prime.keep, 3);
  assert.deepEqual(r.gear, { on: true, sellAs: "sets" });
  assert.equal(r.relics.on, false);
  assert.equal(r.resources.on, false);
  assert.equal(r.priority, "trades");

  const parts = sparesRulesOf(v1({ sets: false, parts: true, other: true }));
  assert.equal(parts.prime.sellAs, "parts");
  // Weapon parts were under everything else; with sets off, their sets weren't sold whole.
  assert.deepEqual(parts.gear, { on: true, sellAs: "parts" });
  assert.equal(parts.relics.on, true);
  assert.equal(parts.resources.on, true);

  const none = sparesRulesOf(v1({ sets: false, parts: false, other: false, mods: false, arcanes: false, imprints: false }));
  for (const c of ["prime", "mods", "arcanes", "relics", "gear", "resources", "imprints"] as const) assert.equal(none[c].on, false, c);
});

test("every old combination goes back to the same switches", () => {
  for (let bits = 0; bits < 64; bits++) {
    const old = v1({ sets: !!(bits & 1), parts: !!(bits & 2), other: !!(bits & 4), mods: !!(bits & 8), arcanes: !!(bits & 16), imprints: !!(bits & 32), partsKeep: bits % 3 });
    const back = legacyRules(sparesRulesOf(old));
    // partsKeep only matters with prime parts ticked; the rest exactly.
    assert.deepEqual({ ...back, partsKeep: old.parts ? back.partsKeep : old.partsKeep }, old, JSON.stringify(old));
  }
});

test("saved under spares, with the old switches kept under bulk for an older build", () => {
  const r = defaultSparesRules();
  r.prime.sellAs = "sets";
  r.mods.on = false;
  const market = JSON.parse(JSON.stringify(toStored(r)));
  assert.deepEqual(sparesSettingsOf(market), r);
  assert.deepEqual(market.bulk, { ...defaultBulkRules(), parts: false, mods: false }, "an older build sees Mods unticked");
  // Before the first save: the old switches, migrated.
  assert.deepEqual(sparesSettingsOf({ bulk: { ...defaultBulkRules(), mods: false } }).mods.on, false);
  assert.deepEqual(sparesSettingsOf(undefined), defaultSparesRules());
});

test("version 2 is read back as saved, out-of-range numbers clamped", () => {
  const r = defaultSparesRules();
  r.mods.keep = 4;
  r.mods.families.primed = { on: false, keep: 1 };
  r.arcanes.which = "any";
  r.resources.ayatan = "filled";
  r.resources.families.captura = false;
  assert.deepEqual(sparesRulesOf(JSON.parse(JSON.stringify(r))), r);

  const bad = sparesRulesOf({ version: 2, mods: { keep: 0, families: { requiem: { keep: -3 } } }, prime: { keep: 1e9, sellAs: "whatever" }, arcanes: { keepMaxed: 0.2 }, priority: 7 });
  assert.equal(bad.mods.keep, 1, "never below one copy");
  assert.equal(bad.mods.families.requiem.keep, 1);
  assert.equal(bad.mods.families.antivirus.keep, LICH_KEEP);
  assert.equal(bad.prime.keep, 99);
  assert.equal(bad.prime.sellAs, "setsFirst");
  assert.equal(bad.arcanes.keepMaxed, 1);
  assert.equal(bad.priority, "plat");
});

test("never sell: sanitised, deduplicated, kept through a reset", () => {
  const r = sparesRulesOf({
    version: 2,
    neverSell: [
      { id: "5a2feeb1c2c9e90cbdaa23d2", name: "Khra", cat: "mods" },
      { id: "5a2feeb1c2c9e90cbdaa23d2", name: "Khra again", cat: "mods" },
      { id: "bad id with spaces", name: "x" },
      { id: "abc", name: "Zero\u200bwidth\u202e name", cat: "nowhere" },
      "not an object",
    ],
  });
  assert.deepEqual(r.neverSell, [
    { id: "5a2feeb1c2c9e90cbdaa23d2", name: "Khra", cat: "mods" },
    { id: "abc", name: "Zerowidth name", cat: null },
  ]);
  assert.equal(neverSoldIn(r, "mods").length, 1);
  assert.ok(isUsual(r), "never-sell items aren't a change of rules");
  r.mods.keep = 3;
  assert.equal(isUsual(r), false);
  assert.deepEqual(usualKeeping(r).neverSell, r.neverSell);

  const many = sparesRulesOf({ version: 2, neverSell: Array.from({ length: NEVER_SELL_CAP + 10 }, (_, i) => ({ id: `i${i}`, name: "x" })) });
  assert.equal(many.neverSell.length, NEVER_SELL_CAP);
});

test("never sell: add and take back", () => {
  let r = defaultSparesRules();
  r = withNeverSell(r, { id: "a", name: "Khra", cat: "mods" });
  r = withNeverSell(r, { id: "a", name: "Khra", cat: "mods" });
  r = withNeverSell(r, { id: "b", name: "Lohk", cat: "mods" });
  assert.deepEqual(r.neverSell.map((n) => n.id), ["a", "b"]);
  assert.deepEqual(withoutNeverSell(r, ["a"]).neverSell.map((n) => n.id), ["b"]);
});

test("each row's line says its choices", () => {
  const r = defaultSparesRules();
  assert.equal(summaryOf("mods", r, { requiem: 28, antivirus: 7 }), "Keep 2 · Requiem 5 and Antivirus 5 while lich weapons are left");
  assert.equal(summaryOf("mods", r, { requiem: 0, antivirus: 0 }), "Keep 2");
  r.mods.families.primed.on = false;
  r.mods.families.stance.keep = 1;
  assert.equal(summaryOf("mods", r, { requiem: 3, antivirus: 0 }), "Keep 2 · Requiem 5 while lich weapons are left · Stances 1 · Primed left out");
  assert.equal(summaryOf("prime", r), "Sets first, then loose parts · keep what you build");
  assert.equal(summaryOf("arcanes", r), "Maxed extras · keep 1 maxed · Legendary too");
  assert.equal(summaryOf("resources", r), "Every kind · sculptures empty · keep what builds need");
  r.resources.families.captura = false;
  r.resources.families.other = false;
  r.resources.families.ayatan = false;
  assert.equal(summaryOf("resources", r), "Refined gems, whole fish, ayatan stars and focus lenses · keep what builds need");
});
