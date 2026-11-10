// The kind icons' slots: every name a kind goes by lands on its slot, and what isn't gear on none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kindSlot } from "../src/lib/core/kinds";

test("labels, item types and builds kinds land on their slot", () => {
  const cases: [string, string | null][] = [
    ["Warframe", "warframe"], ["Warframes · MR 5", "warframe"], ["exalted", "warframe"],
    ["Primary · Rifle", "primary"], ["Shotgun", "primary"], ["Bow", "primary"], ["Kitgun chamber", "primary"],
    ["Secondary · Pistol", "secondary"], ["Dual Pistols", "secondary"], ["Tome", "secondary"],
    ["Melee · Glaive", "melee"], ["Zaw strike", "melee"], ["Nikana", "melee"],
    ["Companion", "companion"], ["Sentinel", "companion"], ["companionWeapon", "companion"], ["Kubrow", "companion"], ["Hound", "companion"],
    ["Archwing", "archwing"], ["Arch-Gun", "archwing"], ["archgun", "archwing"], ["archmelee", "archwing"],
    ["Necramech", "necramech"], ["Amp", "amp"], ["Amp prism", "amp"],
    ["Archon shard", null], ["Primary Mod", null], ["Arcane", null], ["Relic", null], ["Rare · Okina Prime Blueprint", null], ["", null],
  ];
  for (const [k, want] of cases) assert.equal(kindSlot(k), want, k);
  assert.equal(kindSlot(null), null);
});
