// The sidebar's platinum is formatted as every other number in the app: in English ("1,240"),
// not in the system's locale, where German, Spanish or French give "1.240", which reads as 1.24.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the sidebar's platinum is formatted in English, whatever the system's locale", () => {
  const line = readFileSync("src/App.svelte", "utf8").split("\n").find((l) => /\{ label: "Plat", value: /.test(l));
  assert.ok(line, "the sidebar's platinum");
  const value = line.match(/value: (.*?), title:/)?.[1];
  assert.ok(value, line);
  assert.doesNotMatch(value, /toLocaleString\(\)/, "no locale: the system's");
  assert.match(value, /toLocaleString\("en"\)/);
  // What that gives, against what a German system gives without a locale.
  assert.equal((1240).toLocaleString("en"), "1,240");
  assert.equal((1240).toLocaleString("de-DE"), "1.240");
});
