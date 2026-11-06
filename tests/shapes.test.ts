// What orbiter reads is checked before pages use it: a file in the wrong shape means nothing to
// show, not a page that throws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { marketItemsOf, recipeDataOf, relicDataOf, rivenMetaOf } from "../src/lib/core/shapes";

test("the market item list: anything but a list is no items, and broken entries are left out", () => {
  assert.deepEqual(marketItemsOf({}), []);
  assert.deepEqual(marketItemsOf(null), []);
  const good = { id: "a", slug: "ash_prime_set", name: "Ash Prime Set", gameRef: "/Lotus/Ash", maxRank: null, subtypes: null, tags: ["set"] };
  const items = marketItemsOf([good, { id: "b", slug: "x" }, null, "nope", { ...good, id: "c", tags: "set", subtypes: [1, "intact"] }]);
  assert.deepEqual(items.map((i) => i.id), ["a", "c"]);
  assert.equal(items[1].tags, null);
  assert.deepEqual(items[1].subtypes, ["intact"]);
});

test("recipe and relic data in the wrong shape read as none", () => {
  assert.equal(recipeDataOf({}), null);
  assert.equal(recipeDataOf([]), null);
  const r = recipeDataOf({ checkedAt: 5, recipes: { a: { c: 1, i: [["b", 2], "junk"] }, bad: 3 }, names: { a: { n: "A", img: "", r: "", k: "chart" }, b: null } });
  assert.deepEqual(r, { checkedAt: 5, recipes: { a: { c: 1, i: [["b", 2]] } }, names: { a: { n: "A", img: "", r: "", k: "chart" } } });
  assert.equal(relicDataOf({}), null);
  assert.equal(relicDataOf({ relics: {}, drops: {}, paths: {} }), null);
  assert.deepEqual(relicDataOf({ hash: "h", modified: 1, checkedAt: 1, relics: [{ name: "Lith A1", rewards: [] }, { name: null }], drops: {}, paths: {} })?.relics, [{ name: "Lith A1", rewards: [] }]);
});

test("riven data in the wrong shape throws, so Rivens says it couldn't read it", () => {
  assert.throws(() => rivenMetaOf({}));
  const m = rivenMetaOf({ weapons: [{ slug: "braton", name: "Braton" }, { slug: 1 }], attributes: [{ slug: "damage", name: "Damage" }, null] });
  assert.deepEqual(m.weapons.map((w) => [w.name, w.rivenType]), [["Braton", ""]]);
  assert.equal(m.attributes.length, 1);
});

test("odd but readable entries get their fallbacks: no game path, no rank, no time, no riven type", () => {
  assert.deepEqual(marketItemsOf([{ id: "1", slug: "x", name: "X", gameRef: 5, maxRank: "10", subtypes: "a", tags: [1, "mod"] }]), [{ id: "1", slug: "x", name: "X", gameRef: null, maxRank: null, subtypes: null, tags: ["mod"] }]);
  assert.equal(recipeDataOf({ recipes: {}, names: {}, checkedAt: "soon" })?.checkedAt, 0);
  const meta = rivenMetaOf({ weapons: [{ slug: "braton", name: "Braton", gameRef: 1 }], attributes: [] });
  assert.deepEqual([meta.weapons[0].gameRef, meta.weapons[0].group, meta.weapons[0].rivenType], ["", "", ""]);
});

test("relic data: a reward or drop place that isn't one is left out, the relic kept", () => {
  const good = { name: "Forma Blueprint", rarity: "Common", chance: 25.33 };
  const d = relicDataOf({ relics: [{ name: "Axi A1 Intact", rewards: [null, 5, { name: 3 }, good, { name: "X", chance: "1" }] }], drops: { "Axi A1": [null, { location: "Void/Mot", chance: 5, rarity: "Rare" }], "Lith B1": "x" }, paths: { "/a": "Axi A1 Intact", "/b": 5 } })!;
  assert.deepEqual(d.relics, [{ name: "Axi A1 Intact", rewards: [good] }]);
  assert.deepEqual(d.drops, { "Axi A1": [{ location: "Void/Mot", chance: 5, rarity: "Rare" }] });
  assert.deepEqual(d.paths, { "/a": "Axi A1 Intact" });
  const clean = { relics: [{ name: "Axi A1 Intact", rewards: [good] }], drops: {}, paths: {} };
  assert.equal(relicDataOf(clean)!.relics[0], clean.relics[0], "a clean relic is the same object");
});
