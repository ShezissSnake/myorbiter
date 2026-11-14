// Switches and Settings' fields go by their own names (ui/Switch.svelte's `name`, a field's
// `data-field`), so the help's pictures mark the switch they mean even after the switches are
// reordered: a mark that found one by its place could land on its neighbour with nothing failing.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NOTICE_KINDS } from "../src/lib/notices";

const { WALKTHROUGHS } = await import("../src/lib/help/index");
const { SETTINGS } = await import("../src/lib/help/settings");

const root = join(import.meta.dirname, "..");
function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(join(root, p)).isDirectory()) svelteFiles(p, out);
    else if (p.endsWith(".svelte")) out.push(p);
  }
  return out;
}
const sources = svelteFiles("src").map((f) => ({ f, s: readFileSync(join(root, f), "utf8") }));

/** Every switch's name as written: a plain name, or one with `{…}` in it (one per notification kind). */
const switchNames: string[] = [];
for (const { f, s } of sources) {
  for (const m of s.matchAll(/<Switch\b/g)) {
    // To the tag's closing ">" (one inside braces, as in `(v) => set(v)`, doesn't count).
    let depth = 0;
    let end = m.index;
    for (; end < s.length; end++) {
      if (s[end] === "{") depth++;
      else if (s[end] === "}") depth--;
      else if (s[end] === ">" && depth === 0) break;
    }
    const tag = s.slice(m.index, end);
    const name = tag.match(/\bname="([^"]+)"/)?.[1];
    assert.ok(name, `${f}: a <Switch> without a name: ${tag.slice(0, 80)}…`);
    switchNames.push(name);
  }
}
const fieldNames = sources.flatMap(({ s }) => [...s.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]));

/** The names a written name stands for: `notices.kind.{k.kind}` is one per notification kind. */
const expand = (n: string) => (n.includes("{k.kind}") ? NOTICE_KINDS.map((k) => n.replace("{k.kind}", k.kind)) : [n]);
const switches = switchNames.flatMap(expand);

test("every switch has a name of its own, and so does every Settings field", () => {
  assert.ok(switchNames.length >= 20, `${switchNames.length} switches found: the scan missed some`);
  assert.equal(new Set(switches).size, switches.length, `a name used twice: ${switches.filter((n, i) => switches.indexOf(n) !== i)}`);
  assert.ok(fieldNames.length >= 7);
  assert.equal(new Set(fieldNames).size, fieldNames.length);
  for (const n of [...switches, ...fieldNames]) assert.match(n, /^[a-z]+(\.[a-z-]+)+$/i, n);
});

const selectors = (wts: typeof WALKTHROUGHS) =>
  wts.flatMap((w) => w.pages.flatMap((p, i) => (p.shot ? [p.shot.part, ...p.shot.marks.map((m) => m.at)].map((sel) => ({ where: `${w.id} page ${i + 1}`, sel })) : [])));

test("every switch or field a picture names exists", () => {
  for (const { where, sel } of selectors(WALKTHROUGHS)) {
    for (const m of sel.matchAll(/\[data-switch="([^"]+)"\]/g)) assert.ok(switches.includes(m[1]), `${where}: no switch named ${m[1]}`);
    for (const m of sel.matchAll(/\[data-field="([^"]+)"\]/g)) assert.ok(fieldNames.includes(m[1]), `${where}: no field named ${m[1]}`);
  }
});

test("Settings' and Notifications' pictures find a switch or a field by its name, never by its place", () => {
  // A label by its place (`label:nth-of-type(3)`, `label:last-of-type`), or the first `label.row`
  // that comes: either is a switch or a field picked by where it sits. (Fissures' first slider
  // stands for any of them: a slider, not a switch.)
  const byPlace = /\blabel(?!\.slider)(\.[\w-]+)*:(nth|first|last)-|\blabel\.(row|field)\b(?![\w-]*\[)|>\s*label\b(?![.\[:\w-])|\[role=["']?switch/;
  const found = selectors(SETTINGS).filter(({ sel }) => byPlace.test(sel));
  assert.deepEqual(found, []);
  // Each switch the Trades page talks about, by name (they were told apart by place before).
  const trades = SETTINGS.find((w) => w.id === "settings-trades")!;
  const named = trades.pages.flatMap((p) => p.shot!.marks.map((m) => m.at.match(/data-switch="([^"]+)"/)?.[1])).filter(Boolean);
  assert.deepEqual(named, ["settings.auto-rep", "settings.auto-trades", "settings.hide-last-copies", "settings.auto-check", "settings.auto-reprice"]);
});
