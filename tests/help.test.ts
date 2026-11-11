// The in-place help: the walk-through list keeps its limits, every "?" in the app opens a real page
// of a real walk-through, every picture matches its page's definition, and the dialog opens, browses
// and closes as it should.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { WALKTHROUGHS, LIMITS, forPart, pictures, shotHash, words, walkthroughById } = await import("../src/lib/help/index");
const { help } = await import("../src/lib/help/help.svelte");

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(root, p)).isDirectory()) files(p, out);
    else if (p.endsWith(".svelte")) out.push(p);
  }
  return out;
}

/** A tag's attributes, from `from` to its closing ">" (one inside braces, as in `(r) => r.name`, doesn't count). */
function tagAt(s: string, from: number): string {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return s.slice(from, i);
  }
  return s.slice(from);
}

/** Every part id the app's markup gives a "?": `part="…"`, the page heads' and lists' help props, Home's panel heads, and the lists' own ids. */
function partsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  const add = (id: string, where: string) => found.set(id, where);
  for (const f of files("src")) {
    const s = read(f);
    for (const m of s.matchAll(/\bpart="([^"]+)"/g)) add(m[1], f);
    for (const m of s.matchAll(/\bhelp="([^"]+)"/g)) add(m[1], f);
    for (const m of s.matchAll(/\bhelp=\{\{([^}]*)\}\}/g)) for (const n of m[1].matchAll(/\b(?:band|hero|list|sheet):\s*"([^"]+)"/g)) add(n[1], f);
    for (const m of s.matchAll(/\{@render head\([^)]*"([a-z-]+\.[a-z-]+)"\)\}/g)) add(m[1], f);
    // A list (ui/Browse.svelte) names its "?" after its id unless told otherwise, and has a details panel only with `detail`.
    for (const m of s.matchAll(/<Browse\b/g)) {
      const attrs = tagAt(s, m.index + m[0].length);
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      if (!id || /\bhelp=/.test(attrs)) continue;
      add(`${id}.list`, f);
      if (/\{detail\}|\bdetail=/.test(attrs)) add(`${id}.sheet`, f);
    }
  }
  return found;
}

test("every page keeps the limits: a short heading, a few short lines, at most four marks", () => {
  for (const wt of WALKTHROUGHS) {
    assert.ok(wt.pages.length >= LIMITS.pages[0] && wt.pages.length <= LIMITS.pages[1], `${wt.id}: ${wt.pages.length} pages`);
    for (const [i, p] of wt.pages.entries()) {
      const at = `${wt.id} page ${i + 1}`;
      assert.ok(words(p.title) <= LIMITS.titleWords, `${at}: heading "${p.title}" is over ${LIMITS.titleWords} words`);
      assert.ok(p.lines.length >= 1 && p.lines.length <= LIMITS.lines, `${at}: ${p.lines.length} lines`);
      for (const l of p.lines) assert.ok(words(l) <= LIMITS.lineWords, `${at}: "${l}" is ${words(l)} words`);
      const total = words(p.title) + p.lines.reduce((n, l) => n + words(l), 0);
      assert.ok(total <= LIMITS.pageWords, `${at}: ${total} words`);
      assert.ok(p.shot, `${at}: every page is written: it has a picture`);
      if (!p.shot) continue;
      assert.ok(p.shot.marks.length <= LIMITS.marks, `${at}: ${p.shot.marks.length} marks`);
      // Numbered marks key the first lines: 1 to n, in order, no more numbers than lines.
      const ns = p.shot.marks.filter((m) => m.is === "n").map((m) => m.n);
      assert.ok(ns.length <= p.lines.length, `${at}: more numbers than lines`);
      assert.deepEqual(ns, ns.map((_, k) => k + 1), `${at}: the numbers go 1 to ${ns.length}, in order`);
    }
    if (wt.good) assert.ok(words(wt.good.text) <= LIMITS.lineWords * 2, `${wt.id}: the good-to-know line is short`);
  }
});

test("each walk-through has its own id, an app page, a way to the Guide, and pages for what it covers", () => {
  const ids = WALKTHROUGHS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  const seen = new Map<string, string>();
  for (const wt of WALKTHROUGHS) {
    assert.match(wt.guide, /^guide\b/, `${wt.id}: More in the Guide goes to the Guide`);
    assert.ok(Object.keys(wt.covers).length > 0, `${wt.id}: covers some part`);
    for (const [part, page] of Object.entries(wt.covers)) {
      assert.ok(Number.isInteger(page) && page >= 1 && page <= wt.pages.length, `${wt.id}: ${part} points at page ${page}`);
      assert.ok(!seen.has(part), `${part} is covered by both ${seen.get(part)} and ${wt.id}`);
      seen.set(part, wt.id);
    }
  }
});

test('every "?" in the app opens a real page of a real walk-through, and every covered part has a "?"', () => {
  const inSource = partsInSource();
  assert.ok(inSource.size > 100, `found ${inSource.size} parts`);
  for (const [part, where] of inSource) {
    const hit = forPart(part);
    assert.ok(hit, `${part} (${where}) has no walk-through`);
    assert.ok(hit.at >= 0 && hit.at < hit.wt.pages.length);
  }
  for (const wt of WALKTHROUGHS) for (const part of Object.keys(wt.covers)) assert.ok(inSource.has(part), `${wt.id} covers ${part}, which no "?" in the app has`);
  // No placeholder is left: the page every "?" opens is written.
  for (const part of inSource.keys()) {
    const hit = forPart(part)!;
    assert.ok(hit.wt.pages[hit.at].shot, `${part} opens ${hit.wt.id} page ${hit.at + 1}, which isn't written`);
  }
});

test("every picture belongs to a page, every page's picture is there, taken from its definition as it is now", () => {
  const manifest = JSON.parse(read("src/lib/help/pictures.json")) as Record<string, { hash: string; w: number; h: number; bytes: number }>;
  const wanted = pictures();
  const names = new Set(wanted.map((x) => x.file));
  for (const x of wanted) {
    const m = manifest[x.file];
    assert.ok(m, `${x.file} (${x.wt.id}, page ${x.i + 1}) has no picture: npm run screenshots -- --only help --id ${x.wt.id}`);
    assert.equal(m.hash, x.hash, `${x.file}: its page's picture definition changed since it was taken: take it again`);
    const file = join(root, "public/help", x.file);
    assert.ok(existsSync(file), `public/help/${x.file} is missing`);
    assert.equal(statSync(file).size, m.bytes, `public/help/${x.file} isn't the file the manifest recorded`);
    assert.ok(m.bytes <= 60 * 1024, `${x.file} is over 60 KB`);
    assert.ok(m.w > 0 && m.h > 0);
  }
  for (const f of Object.keys(manifest)) assert.ok(names.has(f), `${f} is in the manifest but no page has it`);
  for (const f of readdirSync(join(root, "public/help"))) assert.ok(names.has(f), `public/help/${f} belongs to no page`);
});

test("a picture's hash follows what it shows, not the order its fields were written in", () => {
  const a = shotHash({ open: "market", part: ".x", marks: [{ at: ".y", is: "n", n: 1 }] });
  const b = shotHash({ marks: [{ n: 1, is: "n", at: ".y" }], part: ".x", open: "market" });
  assert.equal(a, b);
  assert.notEqual(a, shotHash({ open: "market", part: ".x", marks: [{ at: ".y", is: "n", n: 2 }] }));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test("a '?' opens its walk-through at the page about its part; arrows browse within it; Esc closes and gives the focus back", async () => {
  let focused = 0;
  const opener = { focus: () => void focused++, isConnected: true };
  assert.equal(help.open("no.such-part", opener), false);
  assert.equal(help.wt?.id ?? null, null, "an unknown part opens nothing");

  assert.equal(help.open("orders.reprice", opener), true);
  assert.equal(help.wt?.id, "orders");
  assert.equal(help.at, walkthroughById.orders.covers["orders.reprice"] - 1);
  const n = help.count;
  help.key("End");
  assert.equal(help.at, n - 1);
  assert.ok(help.last);
  help.key("ArrowRight");
  assert.equal(help.at, n - 1, "stops at the last page");
  help.key("Home");
  assert.equal(help.at, 0);
  help.key("ArrowLeft");
  assert.equal(help.at, 0, "stops at the first page");
  help.key("ArrowRight");
  assert.equal(help.at, 1);
  assert.equal(help.key("a"), false, "other keys are left alone");

  assert.equal(help.key("Escape"), true);
  assert.equal(help.wt?.id ?? null, null, "Esc closes it");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(focused, 1, "the focus goes back to the '?'");

  // A page change closes it without taking the focus back (the new page takes it).
  help.open("spares.plan", opener);
  help.close(false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(focused, 1);
});

test("the dialog keeps the focus inside, closes on the shade and on a page change, and never blurs through backdrop-filter", () => {
  const dialog = read("src/lib/ui/HelpDialog.svelte");
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  assert.match(dialog, /use:trap=\{\{ onescape: \(\) => help\.close\(\), restore: false \}\}/, "focus kept inside, Esc closes, and only the help puts the focus back (not on a page change)");
  assert.match(dialog, /class="shade"[^>]*onclick=\{\(\) => help\.close\(\)\}/, "a click on the shade closes");
  assert.match(dialog, /\{#if pic && file && shown\}/, "the picture loads only for the page shown");
  assert.match(dialog, /<svg class="ph"/, "a hidden page holds its picture's place without loading it");
  // As tall as the walk-through's tallest page, up to 640 px, the same on every page of it.
  assert.match(dialog, /max-height: min\(640px, calc\(100% - 48px\)\)/);
  assert.doesNotMatch(dialog, /\.box \{[^}]*[;\s]height: min\(640px/, "no fixed height");
  assert.match(dialog, /\{#each wt\.pages as p, i \(i\)\}\s*<div class="sizer" aria-hidden="true" inert>/, "every page of the walk-through is laid out, hidden, to size the box");
  assert.match(dialog, /<svg class="ph" width=\{px\.w\} height=\{px\.h\}/, "a hidden page's picture holds the room the file is drawn at");
  const css = read("src/app.css");
  for (const [name, s] of [["HelpDialog.svelte", dialog], ["app.css", css]] as const) {
    assert.doesNotMatch(s, /backdrop-filter/, `${name}: no backdrop-filter`);
    assert.doesNotMatch(s, /\{@html/, `${name}: no {@html}`);
  }
  const app = read("src/App.svelte");
  assert.match(app, /void settings\.tab;\s*untrack\(\(\) => help\.close\(false\)\)/, "a page change in the sidebar closes the help");
  const mark = read("src/lib/ui/HelpMark.svelte");
  assert.doesNotMatch(mark, /onmouseenter|onpointerenter|onfocus=/, "never opens on hover or focus");
});
