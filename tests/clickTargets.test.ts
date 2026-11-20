// Click targets under 24 px with nothing round them that takes the click (measured at 1280x800):
// Sell spares' kind boxes (14x14), Orders' two switches a row (37x18), the page head's Details link
// (46x20) and Home's weekly ticks (21x21). Each now takes the click over at least 24 px each way, by
// an invisible ::before round it: nothing is drawn bigger or moves, and on Orders a near miss
// stays in the switch's own row (rows are taller than the 26 px it takes). The sweep measures the
// same in the page (keyboardExtras, smallTargets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const REM = 16;
/** A CSS length in px: rem at 16 px, px as is. */
const px = (v: string) => (v.endsWith("rem") ? parseFloat(v) * REM : parseFloat(v));

function rulesOf(file: string) {
  const src = readFileSync(file, "utf8");
  const css = src.slice(src.lastIndexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
    const decl = new Map<string, string>();
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decl.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    return { sel: m[1].trim(), decl };
  });
}

/** How far the ::before reaches past the padding box: [top/bottom, left/right], from `inset`. */
function reach(file: string, sel: string): [number, number] | null {
  const r = rulesOf(file).find((x) => x.sel === `${sel}::before`);
  if (!r || r.decl.get("content") === undefined || r.decl.get("position") !== "absolute") return null;
  const parts = (r.decl.get("inset") ?? "").split(/\s+/).map((v) => -px(v));
  if (!parts.length || parts.some(Number.isNaN)) return null;
  return [parts[0], parts[1] ?? parts[0]];
}

/** Each target: where it is, its drawn size in px (border box) and its border; Details' width is its text's. */
const TARGETS = [
  { name: "Sell spares' kind box", file: "src/lib/ui/spares/CategoryRow.svelte", sel: ".box", w: 0.85 * REM, h: 0.85 * REM, border: 1 },
  { name: "Orders' switch", file: "src/lib/ui/Toggle.svelte", sel: ".tog", w: 2.3 * REM, h: 1.15 * REM, border: 1 },
  { name: "Home's weekly tick", file: "src/lib/ui/Tick.svelte", sel: "button.tick", w: 1.3 * REM, h: 1.3 * REM, border: 1 },
  { name: "the page head's Details", file: "src/lib/ui/PageHead.svelte", sel: ".more", w: 46, h: 20, border: 0 },
];

for (const t of TARGETS) {
  test(`${t.name} takes a click over at least 24 px each way`, () => {
    const r = reach(t.file, t.sel);
    assert.ok(r, `${t.sel}::before, positioned absolute with an inset, takes the click round it`);
    const h = t.h - 2 * t.border + 2 * r[0];
    const w = t.w - 2 * t.border + 2 * r[1];
    assert.ok(h >= 24, `${h} px tall`);
    assert.ok(w >= 24, `${w} px wide`);
    // The ::before is placed from the target itself.
    const base = rulesOf(t.file).filter((x) => x.sel.split(",").map((s) => s.trim()).includes(t.sel));
    assert.ok(base.some((x) => x.decl.get("position") === "relative") || t.sel === ".tog", `${t.sel} is positioned`);
  });
}

test("the sizes the test reckons with are the ones drawn", () => {
  assert.match(readFileSync("src/lib/ui/spares/CategoryRow.svelte", "utf8"), /\.box \{[^}]*width: \.85rem; height: \.85rem/);
  assert.match(readFileSync("src/lib/ui/Toggle.svelte", "utf8"), /\.tog \{ width: 2\.3rem; height: 1\.15rem;[^}]*position: relative/);
  assert.match(readFileSync("src/lib/ui/Tick.svelte", "utf8"), /size = 1\.3,/);
  assert.match(readFileSync("src/lib/ui/PageHead.svelte", "utf8"), /\.more \{[^}]*min-height: 20px;/);
});
