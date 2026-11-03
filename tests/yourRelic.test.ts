import { test } from "node:test";
import assert from "node:assert/strict";
import { yourRelicIndex } from "../src/lib/core/views";

test("your relic: the only squad relic that drops what you got", () => {
  const relics = [{ rewards: [{ name: "Forma Blueprint" }, { name: "Lex Prime Barrel" }] }, { rewards: [{ name: "Forma Blueprint" }, { name: "Afentis Prime Blade" }] }];
  assert.equal(yourRelicIndex(relics, "Afentis Prime Blade"), 1);
  // A Forma could have come from either: not known.
  assert.equal(yourRelicIndex(relics, "Forma Blueprint"), null);
  assert.equal(yourRelicIndex(relics, "Braton Prime Stock"), null);
  assert.equal(yourRelicIndex(relics, null), null);
});
