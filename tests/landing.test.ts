// The website's landing page says what each page does: every page in the sidebar's four sections
// has two to four short lines (src/lib/help/, the `does` of its main walk-through), each starting
// with a verb, each at most LANDING.chars characters, each marker a picture the app bundles.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

const { WALKTHROUGHS, LANDING, doesOf } = await import("../src/lib/help/index");
const { PAGES } = await import("../src/lib/pages");

const root = join(import.meta.dirname, "..");
const SECTION_PAGES = PAGES.filter((p) => p.group);

test("every page in the four sections has two to four lines, none over the length", () => {
  for (const p of SECTION_PAGES) {
    const lines = doesOf(p.id);
    assert.ok(lines.length >= LANDING.lines[0], `${p.label} has no lines for the landing page (does, in src/lib/help/)`);
    assert.ok(lines.length <= LANDING.lines[1], `${p.label} has ${lines.length} lines, at most ${LANDING.lines[1]}`);
    for (const l of lines) assert.ok(l.text.length <= LANDING.chars, `${p.label}: "${l.text}" is ${l.text.length} characters, at most ${LANDING.chars}`);
  }
});

test("a page's lines sit on one walk-through, and only pages in the sections have any", () => {
  const ids = new Set(SECTION_PAGES.map((p) => p.id as string));
  const seen = new Map<string, string>();
  for (const w of WALKTHROUGHS) {
    if (!w.does) continue;
    assert.ok(ids.has(w.app), `${w.id}: lines for the landing page on something that is no page of a section`);
    assert.ok(!seen.has(w.app), `${w.app} has lines on both ${seen.get(w.app)} and ${w.id}`);
    seen.set(w.app, w.id);
  }
});

test("each line starts with what the page does, says no more than that and names no price in money", () => {
  for (const p of SECTION_PAGES) {
    for (const { text } of doesOf(p.id)) {
      assert.match(text, /^[A-Z][a-z]+s\s/, `${p.label}: "${text}" should start with a verb such as Shows, Marks, Lists, Warns`);
      assert.doesNotMatch(text, /\bsimply\b|\bjust\b|\beasily\b|!|[$€£]|\bUSD\b|\bEUR\b|\bGBP\b/i, `${p.label}: "${text}" has marketing or a real-money figure`);
      assert.equal(text, text.trim(), `${p.label}: "${text}" has stray space`);
    }
  }
});

test("a line's marker is a picture in public/game/, and no line repeats on its page", () => {
  for (const p of SECTION_PAGES) {
    const lines = doesOf(p.id);
    assert.equal(new Set(lines.map((l) => l.text)).size, lines.length, `${p.label}: a line twice`);
    for (const l of lines) if (l.icon) assert.ok(existsSync(join(root, "public/game", `${l.icon}.png`)), `${p.label}: public/game/${l.icon}.png isn't there`);
  }
});
