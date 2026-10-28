import { test } from "node:test";
import assert from "node:assert/strict";
import { auctionItemFor, auctionOf, marketValue, parseMyAuctions, type Riven, type RivenMeta } from "../src/lib/core/rivens";

const meta: RivenMeta = {
  weapons: [{ slug: "okina", gameRef: "/Lotus/Weapons/Tenno/Melee/Okina", name: "Okina", group: "primary", rivenType: "melee" }],
  attributes: [
    { slug: "critical_damage", gameRef: "WeaponCritDamageMod", name: "Critical Damage", unit: "percent" },
    { slug: "channeling_efficiency", gameRef: "WeaponMeleeComboEfficiencyMod", name: "Heavy Attack Efficiency", unit: "percent" },
    { slug: "damage_vs_grineer", gameRef: "WeaponFactionDamageGrineer", name: "Damage to Grineer", unit: "multiply" },
    { slug: "range", gameRef: "WeaponMeleeRangeIncMod", name: "Range", unit: "seconds" },
  ],
};
const stat = (tag: string, value: number, buff = true) => ({ tag, label: tag, display: "", value, buff, quality: 0.5, grade: "B", spliced: false });
const riven: Riven = {
  id: "r1", type: "PlayerMeleeWeaponRandomModRare", kind: "Melee", weapon: "Okina", weaponUnique: "/Lotus/Weapons/Tenno/Melee/Okina", image: null,
  name: "Cali-Acritio", rank: 8, rerolls: 221, mastery: 13, polarity: "vazarin",
  stats: [stat("WeaponCritDamageMod", 0.961), stat("WeaponMeleeRangeIncMod", 1.23), stat("WeaponMeleeComboEfficiencyMod", -0.634, false)],
  quality: 0.5, grade: "B", spliced: false, companion: false,
};

test("a riven in warframe.market's auction form, in the numbers the site shows", () => {
  const made = auctionItemFor(meta, riven);
  assert.ok("item" in made);
  assert.deepEqual(made.item, {
    type: "riven", weapon_url_name: "okina", name: "cali-acritio", mastery_level: 13, mod_rank: 8, re_rolls: 221, polarity: "vazarin",
    attributes: [
      { url_name: "critical_damage", positive: true, value: 96.1 },
      { url_name: "range", positive: true, value: 1.23 },
      { url_name: "channeling_efficiency", positive: false, value: -63.4 },
    ],
  });
  assert.equal(marketValue(meta, "damage_vs_grineer", -0.16), 0.84);
});

test("a riven the site can't take says why", () => {
  const made = auctionItemFor(meta, { ...riven, stats: [...riven.stats, stat("WeaponSomethingNew", 0.2)] });
  assert.ok("error" in made && /no stat for WeaponSomethingNew/.test(made.error));
  const nowhere = auctionItemFor(meta, { ...riven, weapon: "Mystery", weaponUnique: "/X" });
  assert.ok("error" in nowhere && /doesn't list rivens for Mystery/.test(nowhere.error));
});

test("your open auction for a riven is found by weapon and name", () => {
  const mine = parseMyAuctions([
    { id: "a1", starting_price: 100, buyout_price: 150, top_bid: 120, closed: false, visible: true, note_raw: "", minimal_reputation: 0, updated: "", item: { type: "riven", weapon_url_name: "okina", name: "cali-acritio" } },
    { id: "a2", starting_price: 50, buyout_price: 50, closed: true, item: { type: "riven", weapon_url_name: "okina", name: "cali-acritio" } },
    { id: "a3", item: { type: "lich" } },
  ]);
  assert.equal(mine.length, 2);
  assert.equal(auctionOf(meta, riven, mine)?.id, "a1", "the closed one doesn't count");
  assert.equal(mine[0].topBid, 120);
});
