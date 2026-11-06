// Each copy of your gear as the patched TennoScope passes it: slot polarities, archon shards,
// Helminth abilities, and the warframes fed to the Helminth, read for the Builds page. An older
// TennoScope passes none of them, and that must still read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { FEATURE, polarityName, slotPolarities, type GearCopy } from "../src/lib/core/notNeeded";
import { defaultGame, loadSettings, type TennoscopeReport } from "../src/lib/backend";
import type { Bundle } from "../src/lib/core/types";

const EXCAL = "/Lotus/Powersuits/Excalibur/Excalibur";
const VOIDRIG = "/Lotus/Powersuits/EntratiMech/NechroTechSuit";
const SWORD = "/Lotus/Powersuits/Excalibur/ExcaliburSword";
const STRENGTH = "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeAbilityStrength";
const HEALTH = "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeHealthMaxMythic";
const RAVENOUS = "/Lotus/Powersuits/PowersuitAbilities/Nidus/NidusRavenousAbility";

// The rows exactly as the patched TennoScope writes them into its status report.
const GEAR: GearCopy[] = [
  { type: EXCAL, f: 1, p: 3, s: "Suits", pol: [[5, "AP_UMBRA"], [1, "AP_ATTACK"], [2, "AP_ANY"]], shards: [[2, "ACC_GREEN_MYTHIC", HEALTH], [0, "ACC_RED", STRENGTH]], ab: [[1, RAVENOUS, 3]] },
  { type: EXCAL, f: 0, p: 0, s: "Suits" },
  { type: VOIDRIG, f: FEATURE.DOUBLED | FEATURE.GRAVIMAG, p: 1, s: "MechSuits", x: 1600000, pol: [[0, "AP_UNIVERSAL"]] },
  { type: SWORD, f: FEATURE.ARCANE_SLOT, p: 0, s: "SpecialItems", pol: [[9, "AP_PRECEPT"]] },
];
const model = (gear: GearCopy[] | null, consumed: string[] | null = null) =>
  buildModel({ observed_at: 1, inventory: [], catalog: [], relics: [], prices: null } as Bundle, undefined, null, null, null, null, gear, consumed);

test("polarity codes read as the catalog names them", () => {
  assert.equal(polarityName("AP_ATTACK"), "madurai");
  assert.equal(polarityName("AP_DEFENSE"), "vazarin");
  assert.equal(polarityName("AP_TACTIC"), "naramon");
  assert.equal(polarityName("AP_POWER"), "zenurik");
  assert.equal(polarityName("AP_WARD"), "unairu");
  assert.equal(polarityName("AP_UMBRA"), "umbra");
  assert.equal(polarityName("AP_PRECEPT"), "penjaga");
  assert.equal(polarityName("AP_UNIVERSAL"), "universal");
  assert.equal(polarityName("AP_ANY"), "aura", "WFCD's name for AP_ANY");
  assert.equal(polarityName("AP_SOMETHING_NEW"), null);
});

test("gearOf gives each copy of an item, with its polarities", () => {
  const m = model(GEAR);
  const excal = m.gearOf(EXCAL);
  assert.equal(excal.length, 2, "both copies");
  const [built, plain] = excal;
  assert.deepEqual(slotPolarities(built), [
    { slot: 1, polarity: "madurai" },
    { slot: 2, polarity: "aura" },
    { slot: 5, polarity: "umbra" },
  ]);
  assert.deepEqual(slotPolarities(plain), [], "a copy without any reads as none");
  assert.deepEqual(m.gearOf("/Lotus/Powersuits/Saryn/Saryn"), [], "none held");
});

test("Necramechs and exalted weapons come through with their sections and feature bits", () => {
  const m = model(GEAR);
  const [voidrig] = m.gearOf(VOIDRIG);
  assert.equal(voidrig.s, "MechSuits");
  assert.ok(voidrig.f & FEATURE.GRAVIMAG);
  assert.deepEqual(slotPolarities(voidrig), [{ slot: 0, polarity: "universal" }]);
  const [sword] = m.gearOf(SWORD);
  assert.equal(sword.s, "SpecialItems");
  assert.ok(sword.f & FEATURE.ARCANE_SLOT);
  assert.deepEqual(slotPolarities(sword), [{ slot: 9, polarity: "penjaga" }]);
});

test("the warframes fed to the Helminth", () => {
  const m = model(GEAR, ["/Lotus/Powersuits/Nidus/Nidus", 7 as unknown as string]);
  assert.deepEqual([...m.consumedSuits!], ["/Lotus/Powersuits/Nidus/Nidus"], "what isn't a path is left out");
  assert.equal(model(GEAR).consumedSuits, null, "unknown, not none, before TennoScope passed them");
  assert.equal(model(GEAR, []).consumedSuits?.size, 0, "no Helminth: none fed");
});

test("an older TennoScope's rows, and odd entries, still read", () => {
  const old: GearCopy[] = [{ type: EXCAL, f: 1, p: 2 }, { type: EXCAL, f: 0, p: 0, s: "Suits" }];
  const m = model(old);
  assert.equal(m.gearOf(EXCAL).length, 2);
  for (const c of m.gearOf(EXCAL)) assert.deepEqual(slotPolarities(c), []);
  assert.deepEqual(model(null).gearOf(EXCAL), [], "no gear passed at all");
  assert.equal(model(null).gear, null);

  const odd = { type: EXCAL, f: 0, p: 0, pol: [[1, "AP_NEW"], ["x", "AP_ATTACK"], null, [2]], shards: [[0, null, STRENGTH], [1, "ACC_RED"], "x"], ab: [[0, RAVENOUS]] } as unknown as GearCopy;
  assert.deepEqual(slotPolarities(odd), [{ slot: 1, polarity: "AP_NEW" }], "an unknown code keeps the game's own; malformed ones are dropped");
  const notList = { type: EXCAL, f: 0, p: 0, pol: "AP_ATTACK", shards: {}, ab: 3 } as unknown as GearCopy;
  assert.deepEqual(slotPolarities(notList), []);
});

test("the report's new fields are optional, and the saved game state starts without them", () => {
  const older: Pick<TennoscopeReport, "gear" | "consumed_suits"> = { gear: [{ type: EXCAL, f: 0, p: 0 }] };
  assert.equal(older.consumed_suits, undefined);
  assert.equal(defaultGame().consumedSuits, null);
});

test("the Helminth's warframes are kept with the game state; settings from before them, or odd ones, read as unknown", async () => {
  const ls = (v: unknown) => ((globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(v) });
  ls({ game: { consumedSuits: ["/Lotus/Powersuits/Nidus/Nidus", 3], gear: [{ type: EXCAL, f: 0, p: 0, pol: [[1, "AP_ATTACK"]] }] } });
  const s = await loadSettings();
  assert.deepEqual(s.game.consumedSuits, ["/Lotus/Powersuits/Nidus/Nidus"]);
  assert.deepEqual(s.game.gear?.[0].pol, [[1, "AP_ATTACK"]], "the new gear fields are kept as they came");
  ls({ game: { gear: [{ type: EXCAL, f: 0, p: 0 }] } });
  assert.equal((await loadSettings()).game.consumedSuits, null);
  ls({ game: { consumedSuits: "Nidus" } });
  assert.equal((await loadSettings()).game.consumedSuits, null);
});
