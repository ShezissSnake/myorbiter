// Relics' era tiles: the keyboard focus has a mark of its own. It was the same thin white edge
// that means "chosen", and the chosen tile's rule came later, so on the chosen tile ("All", where
// Tab lands first) the focus showed nothing, and on another tile two tiles looked chosen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/tabs/Relics.svelte", "utf8");
const css = src.slice(src.lastIndexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const at = (sel: string) => rules.findIndex((r) => r.sel.split(",").map((s) => s.trim()).includes(sel));

test("the focus rule comes after the chosen one, so it shows on the chosen tile too", () => {
  const focus = at(".era:focus-visible");
  const on = at(".era.on");
  assert.ok(focus >= 0 && on >= 0);
  assert.ok(focus > on, "the focus rule is the later one");
});

test("the focus mark is not the chosen mark: an outline of its own, not the chosen tile's edge", () => {
  const focus = rules[at(".era:focus-visible")].body;
  assert.match(focus, /outline:\s*2px solid/, "a 2 px outline");
  // It doesn't take the chosen tile's look away (no box-shadow of its own that would replace it).
  assert.doesNotMatch(focus, /box-shadow/);
  // Drawn inside the cut corner (clip-path cuts anything outside the tile).
  assert.match(focus, /outline-offset:\s*-\d/);
});
