// Builds: tags (tags.ts), in pasted text (parse.ts) and on saved builds (types.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { byFamily, canonicalTag, familyOfTag, NOX_TAGS, onlyTags, parsePaste, sanitizeBuild, TAG_FAMILY, TAGS, tagsInText } from "../src/lib/core/builds";
import type { CatalogItem } from "../src/lib/core/types";

const catalog = (JSON.parse(readFileSync(new URL("./fixtures/builds-catalog.json", import.meta.url), "utf8")) as { catalog: CatalogItem[] }).catalog;
const gear = (name: string) => {
  const x = catalog.find((c) => c.name === name && c.category !== "Mods" && c.category !== "Arcanes");
  assert.ok(x, `${name} in the fixture`);
  return x;
};


test("tags: families with Nox's modes verbatim, a family map for the UI", () => {
  for (const t of NOX_TAGS) assert.ok(TAGS.Content.includes(t), t);
  assert.equal(TAG_FAMILY["steel path"], "Content");
  assert.equal(TAG_FAMILY["shield gating"], "Survivability");
  assert.equal(TAG_FAMILY["nuke"], "Style");
  assert.equal(familyOfTag("SP"), "Content");
  assert.equal(familyOfTag("whatever"), "Other");
  assert.deepEqual(byFamily(["Nuke", "Steel Path", "Tank", "mine"]).map((g) => g.family), ["Role", "Content", "Style", "Other"]);
  assert.equal(canonicalTag("  level   cap "), "Level cap");
  assert.equal(canonicalTag("shield gate"), "Shield gating");
});

test("tags in pasted text: the title reads every tag, the body only safe phrases", () => {
  assert.deepEqual(tagsInText("", "Saryn SP nuke"), ["Steel Path", "Nuke"]);
  assert.deepEqual(tagsInText("Built for Steel Path and level cap.\nPrimed Flow, Blind Rage"), ["Steel Path", "Level cap"]);
  assert.deepEqual(tagsInText("Good for SP endurance runs"), ["Steel Path", "Endurance"]);
  // Mod text that looks like a tag isn't one: "Status Chance", "Armored Agility", "Archon Intensify", a lower-case "sp".
  assert.deepEqual(tagsInText("Rifle Aptitude: +90% Status Chance\nArmored Agility\nArchon Intensify\nwasp"), []);
  assert.deepEqual(tagsInText("", "Shield gating tank / Steel Path"), ["Tank", "Steel Path", "Shield gating"]);
  assert.equal(onlyTags("Steel Path nuke"), true);
  assert.equal(onlyTags("Primed Flow"), false);
});

test("parsePaste: tags from the title, the text and a Tags line; a tag phrase isn't an unmatched mod", () => {
  const saryn = gear("Saryn Prime");
  const text = "Steel Path nuke\nTags: Level cap, squad\nIntensify, Streamline, Primed Flow";
  const r = parsePaste(text, saryn, catalog, { title: "Saryn shield gate", now: 0 });
  assert.deepEqual(r.build.tags, ["Level cap", "Squad", "Steel Path", "Shield gating", "Nuke"]);
  assert.equal(r.unmatched.length, 0, JSON.stringify(r.unmatched.map((u) => u.text)));
  assert.equal(r.build.mods.filter(Boolean).length, 3);
});

test("sanitizeBuild keeps tags clean: trimmed, each once, at most 12", () => {
  const b = sanitizeBuild({ item: "/x", kind: "warframe", mods: [], tags: [" Steel Path ", "Steel Path", "", 3, ...Array.from({ length: 20 }, (_, i) => `t${i}`)] });
  assert.equal(b!.tags![0], "Steel Path");
  assert.equal(b!.tags!.length, 12);
  assert.equal(sanitizeBuild({ item: "/x", kind: "warframe", mods: [], tags: [] })!.tags, undefined);
});
