// The sidebar foot's tools read as buttons at rest, not only when hovered: each carries the app's
// control look (app.css `button`: a square edge in --rule-bright on the --plate ground), in the
// full bar's grid and in the folded bar's column alike. The status lines above them are told, not
// pressed, and keep no edge and no ground of their own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Every rule of a stylesheet, in order: its selector and its declarations by property. */
function rules(css: string): { sel: string; decl: Map<string, string> }[] {
  const out: { sel: string; decl: Map<string, string> }[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = new Map<string, string>();
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decl.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    out.push({ sel: m[1].trim(), decl });
  }
  return out;
}

const app = readFileSync("src/App.svelte", "utf8");
const style = rules(app.slice(app.lastIndexOf("<style>"), app.lastIndexOf("</style>")));
const base = rules(readFileSync("src/app.css", "utf8")).find((r) => r.sel === "button")!;

/** What the last rule that sets `prop` for exactly one of `sels` gives (no state, no part inside). */
function last(sels: string[], prop: string): string | undefined {
  let v: string | undefined;
  for (const r of style) {
    if (r.sel.split(",").some((s) => sels.includes(s.trim().replace(/\s+/g, " "))) && r.decl.has(prop)) v = r.decl.get(prop);
  }
  return v;
}

const TOOL = [".foot :global(.tool)", ".tools :global(.tool)", ".tools.grid :global(.tool)"];

test("the base button look the foot follows is a rule-bright edge on the plate", () => {
  assert.ok(base, "app.css has a rule for button");
  assert.match(base.decl.get("border") ?? "", /^1px solid var\(--rule-bright\)$/);
  assert.equal(base.decl.get("background"), "var(--plate)");
});

test("every tool in the sidebar's foot has an edge and a ground at rest", () => {
  const border = last(TOOL, "border");
  assert.ok(border, "a border is set for the foot's tools");
  assert.notEqual(border, "0", "no bare icon: the tool has an edge");
  assert.equal(border, base.decl.get("border"), "the edge is the app's control edge");
  const bg = last(TOOL, "background");
  assert.ok(bg && bg !== "transparent" && bg !== "none", `the tool has a ground (${bg})`);
  assert.equal(bg, base.decl.get("background"), "the ground is the app's control ground");
});

test("the cells stand apart, so each reads as a button of its own", () => {
  const gap = last([".tools"], "gap");
  assert.ok(gap && parseFloat(gap) > 0, `a gap between the tools (${gap})`);
});

test("the status lines above the tools stay told, not pressed: no edge, no ground", () => {
  for (const r of style) {
    const s = r.sel.replace(/\s+/g, " ");
    if (!/^(\.compact )?\.(state|st)\b/.test(s) || s.includes("helpmark")) continue;
    for (const p of ["border", "border-color", "background", "background-color", "box-shadow"]) assert.ok(!r.decl.has(p), `${s} sets ${p}`);
  }
});
