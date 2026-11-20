// Builds' "Your most built" and "Also often built": a row's figure is a count of builds (from saved
// builds) or the Forma on your copy (without them), so it is drawn with its unit wherever it is
// drawn. "Also often built" once drew a bare "0" under cards that said "0 FORMA".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/tabs/Builds.svelte", import.meta.url), "utf8");

test("every place a most-built row's figure is drawn, its unit is drawn beside it", () => {
  const figs = [...src.matchAll(/\{r\.fig\}/g)];
  assert.ok(figs.length >= 2, "the cards and the Also often built list");
  for (const m of figs) {
    // The figure's own element and the one after it: the unit sits within the same few tags.
    const after = src.slice(m.index, m.index + 120);
    assert.match(after, /\{r\.unit\}/, `a figure without its unit: ${src.slice(Math.max(0, m.index - 60), m.index + 40)}`);
  }
});

test("Also often built draws the unit", () => {
  const also = src.slice(src.indexOf('<ul class="also">'), src.indexOf("</ul>", src.indexOf('<ul class="also">')));
  assert.ok(also.length > 0);
  assert.match(also, /\{r\.fig\}/);
  assert.match(also, /\{r\.unit\}/);
});
