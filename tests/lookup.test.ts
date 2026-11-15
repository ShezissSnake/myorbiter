// Find anything (Ctrl+K): a run of spaces in what's typed counts as one, as the list filters do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupHits } from "../src/lib/core/lookup";

const all = ["Mesa Prime", "Mesa Prime Blueprint", "Mesa Prime Chassis Blueprint", "Mesa", "Axi A1 Relic"].map((name) => ({ name }));
const names = (text: string) => lookupHits(all, text).map((h) => h.name);

test("two spaces, a tab or a pasted run of spaces find what one space finds", () => {
  const one = names("mesa prime");
  assert.deepEqual(one, ["Mesa Prime", "Mesa Prime Blueprint", "Mesa Prime Chassis Blueprint"]);
  assert.deepEqual(names("mesa  prime"), one);
  assert.deepEqual(names(" mesa \t prime  "), one);
  assert.deepEqual(names("prime   chassis"), ["Mesa Prime Chassis Blueprint"]);
});

test("the ranking is kept: start of the name, then a word, then anywhere; nothing for blank", () => {
  assert.deepEqual(names("mesa"), ["Mesa", "Mesa Prime", "Mesa Prime Blueprint", "Mesa Prime Chassis Blueprint"]);
  assert.deepEqual(names("a1"), ["Axi A1 Relic"]);
  assert.deepEqual(names("   "), []);
});
