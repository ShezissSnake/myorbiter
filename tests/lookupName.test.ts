// Find anything (Ctrl+K) puts the focus on its field, and a screen reader says the field's name. It
// had none of its own, so the name came from its title, the words every filter box carries ("Shows
// only what matches what you type"): the field is named now for what it does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Find anything's field is named for finding", () => {
  const src = readFileSync("src/lib/ui/Lookup.svelte", "utf8");
  const field = src.match(/<input bind:this=\{field\}[^>]*>/)?.[0];
  assert.ok(field, "the field");
  const name = field.match(/aria-label="([^"]+)"/)?.[1];
  assert.ok(name, "an aria-label of its own, not the title");
  assert.match(name, /^Find /);
  assert.doesNotMatch(name, /Shows only what matches/);
});
