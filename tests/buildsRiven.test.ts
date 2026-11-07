import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { idealRiven, MIN_LISTED, rivenClassOf, rivenFamily, rivenFit, rivensFor, RIVEN_STATS, type RivenMarketData } from "../src/lib/core/builds/riven";
import { modIndex, rivenFor, suggest } from "../src/lib/core/builds/suggest";
import type { Riven, RivenAuction } from "../src/lib/core/rivens";
import type { CatalogItem } from "../src/lib/core/types";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] };
const catalog = fixture.catalog;
const index = modIndex(catalog);
const item = (name: string) => {
  const x = catalog.find((c) => c.name === name && c.category !== "Mods");
  assert.ok(x, `${name} in the fixture`);
  return x;
};
const soma = item("Soma Prime");
const gram = item("Gram Prime");

/** A listed riven: positives and a negative by market slug. */
let n = 0;
const listing = (price: number, pos: string[], neg: string | null = null, updated = "2026-10-20T10:00:00.000+00:00"): RivenAuction => ({
  id: `a${n++}`,
  price,
  starting: price,
  name: "",
  rank: 8,
  rerolls: 3,
  mr: 10,
  polarity: "madurai",
  attributes: [...pos.map((url_name) => ({ url_name, value: 100, positive: true })), ...(neg ? [{ url_name: neg, value: -20, positive: false }] : [])],
  seller: "",
  status: "ingame",
  updated,
});

/** One of the player's rivens, with its stats by game tag. */
const riven = (weapon: string, weaponUnique: string | null, buffs: string[], curse: string | null): Riven => {
  const label = (tag: string) => Object.values(RIVEN_STATS).find((d) => d.tags.includes(tag))?.label ?? tag;
  const stat = (tag: string, buff: boolean) => ({ tag, label: label(tag), display: "", value: 0, buff, quality: 0.5, grade: "B", spliced: false });
  return {
    id: `${weapon}-${buffs.join("+")}`, type: "", kind: "Rifle", weapon, weaponUnique, image: null, name: "", rank: 8, rerolls: 0, mastery: 8, polarity: null,
    stats: [...buffs.map((t) => stat(t, true)), ...(curse ? [stat(curse, false)] : [])], quality: 0.5, grade: "B", spliced: false, companion: false,
  };
};

test("Soma Prime, by MyOrbiter's rule alone: a crit rifle wants Critical Chance, Critical Damage and Multishot; −Zoom, −Ammo and −Impact are harmless", () => {
  const r = idealRiven(soma);
  assert.deepEqual([r.cls, r.focus], ["rifle", "crit"]);
  assert.deepEqual(r.positives.map((p) => p.stat), ["Critical Chance", "Critical Damage", "Multishot"]);
  assert.ok(r.positives.every((p) => p.basis === "rule" && /^MyOrbiter's rule: /.test(p.why)));
  const neg = r.negatives.map((x) => x.stat);
  for (const s of ["Zoom", "Ammo Maximum", "Impact"]) assert.ok(neg.includes(s), `${s} harmless`);
  assert.ok(!neg.includes("Slash") && !neg.includes("Puncture"), "Slash and Puncture are half its damage");
  assert.match(r.negatives.find((x) => x.stat === "Impact")!.why, /Impact is 10% of its damage/);
  assert.deepEqual(r.disposition.value, 1.2);
  assert.match(r.disposition.note, /Hotfix 44\.1\.3/);
  assert.deepEqual(r.basedOn, { auctions: 0, since: null });
  assert.match(r.label, /no listings read yet/);
});

test("Gram Prime: a hybrid melee wants crit and melee damage; −Puncture and −Impact cost it little, −Slash doesn't", () => {
  const r = idealRiven(gram);
  assert.deepEqual([r.cls, r.focus], ["melee", "hybrid"]);
  assert.deepEqual(r.positives.map((p) => p.stat), ["Critical Chance", "Critical Damage", "Damage"]);
  const neg = r.negatives.map((x) => x.stat);
  assert.ok(neg.includes("Puncture") && neg.includes("Impact") && neg.includes("Heavy Attack Efficiency"));
  assert.ok(!neg.includes("Slash") && !neg.includes("Zoom"), "Slash is 75% of it; melee has no zoom");
});

test("the market moves the ideal: what players pay most for comes up, labelled, with the listings' own numbers", () => {
  const listed = [
    ...[300, 320, 280, 310, 290, 305].map((p) => listing(p, ["critical_chance", "critical_damage", "multishot"], "zoom")),
    ...[900, 950, 880, 920].map((p) => listing(p, ["critical_chance", "critical_damage", "toxin_damage"], "impact_damage", "2026-09-01T08:00:00.000+00:00")),
    listing(150, ["reload_speed", "zoom"], "slash_damage"),
    listing(160, ["magazine_capacity"], "slash_damage"),
  ];
  const r = idealRiven(soma, { listed });
  assert.equal(r.basedOn.auctions, 12);
  assert.equal(r.basedOn.since, "2026-09-01T08:00:00.000+00:00", "the oldest listing");
  // Multishot drops out: listings with it ask less; Toxin comes in: listings with it ask three times as much.
  assert.deepEqual(r.positives.map((p) => p.stat), ["Critical Chance", "Critical Damage", "Toxin"]);
  assert.deepEqual(r.positives[0].market, { with: 10, of: 12, withIt: 320, without: 160 });
  assert.equal(r.positives[0].basis, "both");
  const tox = r.positives[2];
  assert.equal(tox.basis, "both");
  assert.deepEqual(tox.market, { with: 4, of: 12, withIt: 920, without: 300 });
  assert.match(tox.why, /MyOrbiter's rule: .*What players pay most for: On warframe\.market, 4 of 12 listed rivens have it, asking 920 platinum in the middle against 300 without it\./);
  // Every price it states is one of the listings' own.
  const prices = new Set(listed.map((a) => a.price));
  for (const p of r.positives) if (p.market) for (const v of [p.market.withIt, p.market.without]) assert.ok(v == null || prices.has(v), `${v} is a listed price`);
  // −Impact sits on the dearest listings: the market backs the rule.
  assert.equal(r.negatives.find((x) => x.stat === "Impact")!.basis, "both");
  assert.equal(r.negatives.find((x) => x.stat === "Zoom")!.basis, "rule", "−Zoom sits on the cheaper ones here: the rule alone");
  assert.match(r.label, /what players pay most for on warframe\.market \(12 listed rivens\)/);
});

test("too few listings: the rule alone, and it says so; kept [price, buffs] listings work too", () => {
  const few = idealRiven(soma, { listed: Array.from({ length: MIN_LISTED - 1 }, () => listing(999, ["toxin_damage"])) });
  assert.deepEqual(few.positives.map((p) => p.stat), ["Critical Chance", "Critical Damage", "Multishot"]);
  assert.match(few.label, /only 7 listed rivens read: too few/);
  const packed: RivenMarketData = { listed: [...Array.from({ length: 6 }, (): [number, string[]] => [200, ["multishot", "critical_chance"]]), ...Array.from({ length: 4 }, (): [number, string[]] => [800, ["critical_damage", "toxin_damage"]])], at: Date.parse("2026-11-01T00:00:00Z") };
  const r = idealRiven(soma, packed);
  assert.equal(r.basedOn.auctions, 10);
  assert.equal(r.basedOn.since, "2026-11-01T00:00:00.000Z", "no dates on kept listings: when they were read");
  assert.deepEqual(r.positives.map((p) => [p.stat, p.basis]), [["Critical Damage", "both"], ["Toxin", "both"], ["Damage", "rule"]], "Critical Chance and Multishot sit on the cheap ones");
});

test("rivenFit scores the player's rivens against the ideal", () => {
  const ideal = idealRiven(soma);
  const best = rivenFit(riven("Soma", null, ["WeaponCritChanceMod", "WeaponCritDamageMod", "WeaponFireIterationsMod"], "WeaponZoomFovMod"), ideal);
  assert.equal(best.text, "3 of 3 wanted stats, harmless negative (−Zoom)");
  assert.equal(best.score, 1);
  const two = rivenFit(riven("Soma", null, ["WeaponCritChanceMod", "WeaponReloadSpeedMod", "WeaponCritDamageMod"], null), ideal);
  assert.equal(two.text, "2 of 3 wanted stats, no negative");
  const bad = rivenFit(riven("Soma", null, ["WeaponClipMaxMod", "WeaponDamageAmountMod"], "WeaponCritChanceMod"), ideal);
  assert.equal(bad.text, "0 of 3 wanted stats, a negative that hurts (−Critical Chance)");
  assert.equal(bad.score, 0);
  const mild = rivenFit(riven("Soma", null, ["WeaponCritChanceMod"], "WeaponReloadSpeedMod"), ideal);
  assert.equal(mild.negative, "mild");
  assert.ok(best.score > two.score && two.score > mild.score && mild.score > bad.score);
  // Melee damage has its own tag.
  const g = rivenFit(riven("Gram", null, ["WeaponMeleeDamageMod", "WeaponCritChanceMod"], "WeaponArmorPiercingDamageMod"), idealRiven(gram));
  assert.equal(g.text, "2 of 3 wanted stats, harmless negative (−Puncture)");
});

test("riven families: a Soma riven goes on the Soma Prime, a Hek's on the Kuva Hek; others don't", () => {
  assert.equal(rivenFamily("Soma Prime"), "soma");
  assert.equal(rivenFamily("Kuva Hek"), "hek");
  assert.equal(rivenFamily("Mk1-Braton"), "braton");
  assert.equal(rivenFamily("Prisma Gorgon"), "gorgon");
  const mine = [riven("Soma", "/x/Soma", ["WeaponCritChanceMod"], null), riven("Hek", null, ["WeaponFireIterationsMod"], null), riven("Rubico Prime", null, ["WeaponCritChanceMod"], null)];
  assert.deepEqual(rivensFor(soma, mine).map((r) => r.weapon), ["Soma"]);
  assert.deepEqual(rivensFor(item("Kuva Hek"), mine).map((r) => r.weapon), ["Hek"]);
});

test("suggest() carries the riven for weapons that take one, the player's sorted best first, and none for frames", () => {
  const mine = [riven("Soma", null, ["WeaponReloadSpeedMod"], "WeaponCritChanceMod"), riven("Soma", null, ["WeaponCritChanceMod", "WeaponCritDamageMod"], "WeaponZoomFovMod")];
  const s = suggest(soma, "high", new Map(), index, 0, null, { mine });
  assert.ok(s.riven);
  assert.deepEqual(s.riven.yours!.map((y) => y.fit.text), ["2 of 3 wanted stats, harmless negative (−Zoom)", "0 of 3 wanted stats, a negative that hurts (−Critical Chance)"]);
  assert.equal(suggest(soma, "low", new Map(), index).riven?.yours, undefined, "no rivens passed: no `yours`");
  assert.ok(suggest(soma, "low", new Map(), index).riven?.ideal, "the rule needs nothing passed");
  assert.equal(suggest(item("Saryn Prime"), "high", new Map(), index).riven, undefined);
  assert.equal(rivenFor(item("Saryn Prime"), "warframe", null), null);
  assert.equal(rivenClassOf(item("Kuva Hek")), "shotgun");
  assert.equal(rivenClassOf(item("Lex Prime")), "pistol");
  assert.equal(rivenClassOf(item("Kuva Grattler")), "archgun");
});

const metaPath = new URL("../public/dev-rivens.json", import.meta.url);
test("every stat the rules name is a warframe.market slug with a game tag", { skip: !existsSync(metaPath) && "public/dev-rivens.json not present: run `npm run dev-data`" }, () => {
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { attributes: { slug: string; gameRef: string }[] };
  for (const [slug, d] of Object.entries(RIVEN_STATS)) {
    const a = meta.attributes.find((x) => x.slug === slug);
    assert.ok(a, `${slug} is a market slug`);
    assert.ok(d.tags.includes(a.gameRef), `${slug}: ${a.gameRef}`);
  }
  for (const w of [soma, gram, item("Kuva Hek"), item("Lex Prime")]) {
    const r = idealRiven(w);
    for (const x of [...r.positives, ...r.negatives]) assert.ok(RIVEN_STATS[x.slug], `${w.name}: ${x.slug}`);
  }
});
