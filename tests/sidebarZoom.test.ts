// The sidebar's pages stay reachable when the page is zoomed. A zoom makes the page's own height
// smaller (a 900 by 500 window at 200 % is a page 250 px high); the sidebar's top and foot keep
// their heights, so at some zoom they leave the page list no room. Below a height the window
// itself never reaches (so never at 100 %), the whole bar scrolls as one instead: the list at its
// full height inside it, and the list's own two fades drawn over the bar. The tests read
// src/App.svelte; what a zoomed page then shows was measured in a browser, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const css = app.slice(app.lastIndexOf("<style>"), app.lastIndexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the block that starts at `open` (the index of its `{`), braces balanced. */
function block(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/** The declarations of the rules whose selector list holds exactly `sel`, at the top of `text` (not in a nested block). */
function decls(text: string, sel: string): Map<string, string> {
  const out = new Map<string, string>();
  let flat = text;
  for (let m; (m = /@media[^{]*\{/.exec(flat)); ) flat = flat.slice(0, m.index) + flat.slice(m.index + m[0].length + block(flat, m.index + m[0].length - 1).length + 1);
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(",").some((s) => s.trim().replace(/\s+/g, " ") === sel)) continue;
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
  }
  return out;
}

/** The `@media (max-height: Npx)` blocks of the style: N and the body. */
const short = [...css.matchAll(/@media\s*\(max-height:\s*(\d+)px\)\s*\{/g)].map((m) => ({ px: Number(m[1]), body: block(css, m.index! + m[0].length - 1) }));
const whole = short.find((s) => decls(s.body, ".railin").size > 0);
const minHeight: number = conf.app.windows[0].minHeight;

test("on a very short page the whole bar scrolls as one, and the list in it doesn't", () => {
  assert.ok(whole, "a max-height rule gives the bar's contents a box of their own");
  const box = decls(whole.body, ".railin");
  assert.equal(box.get("display"), "flex");
  assert.match(box.get("overflow-y") ?? box.get("overflow") ?? "", /(^|\s)(auto|scroll)$/, "the bar scrolls up and down");
  assert.equal(box.get("min-height"), "0", "it may be shorter than what it holds");
  const nav = decls(whole.body, "nav");
  assert.equal(nav.get("flex"), "none", "the list at its full height");
  assert.equal(nav.get("overflow"), "visible", "the list doesn't scroll inside the bar: one box scrolls");
  assert.equal(nav.get("mask-image"), "none", "the list's fades are not drawn twice");
});

test("the window itself never reaches that height, so at 100 % the bar is as it was", () => {
  assert.ok(whole);
  assert.ok(whole.px < minHeight, `${whole.px} px is under the window's smallest height, ${minHeight} px`);
  assert.equal(decls(css, ".railin").get("display"), "contents", "above it the bar's contents have no box of their own");
  // Room enough above it: the folded bar's top (about 100 px) and foot (about 150 px) and one page
  // row (34 px) clear of the list's two fades (2.5rem and 3rem) need some 370 px.
  assert.ok(whole.px >= 370, `${whole.px} px leaves the list a row clear of its fades just above it`);
});

test("the bar says there is more the way the list does: the same two marks, the same fades", () => {
  // The list's own fades and the room focus keeps from them.
  assert.match(decls(css, "nav").get("scroll-padding-block") ?? "", /^2\.5rem 3rem$/);
  assert.equal(decls(whole!.body, ".railin").get("scroll-padding-block"), "2.5rem 3rem", "focus is kept clear of the bar's fades");
  assert.equal(decls(css, ".rail.above::before").get("height"), "2.5rem");
  assert.equal(decls(css, ".rail.more::after").get("height"), "3rem");
  for (const fade of [".rail.above::before", ".rail.more::after"]) assert.equal(decls(css, fade).get("pointer-events"), "none", `${fade} never takes a click`);
  // One of the two boxes carries the marks at a time.
  assert.match(app, /<aside class="rail"[^>]*class:more=\{navMore && railScrolls\} class:above=\{navAbove && railScrolls\}/);
  assert.match(app, /<nav [^>]*class:more=\{navMore && !railScrolls\} class:above=\{navAbove && !railScrolls\}/);
});
