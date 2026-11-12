// No style rule keys a compound on its place among its siblings alone (`> :last-child`,
// `:global(:only-child)`). WebKit tries such a compound on every element in the app, which marks
// every parent as depending on its last child: from then on, adding or removing any node (a menu, a
// panel, the focus tip) restyles that parent's last child with all it holds. With twenty pages kept
// mounted, that was 100 to 270 ms on every menu, panel and item's card. A class, tag, id or
// attribute in the same compound keeps it to the elements it is meant for; Svelte's own scoping
// does that for every compound not inside :global(). Measured: `:first-child`, `:empty` and
// `:nth-child` cost nothing this way, so only the forms that look at what comes after are checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const COSTLY = /:(last-child|only-child|last-of-type|only-of-type|nth-last-child|nth-last-of-type)\b/;

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (extname(e.name) === ".svelte" || extname(e.name) === ".css") yield p;
  }
}

/** Splits at depth 0 (outside parentheses and brackets) wherever `at(s, i)` gives a length. */
function splitTop(s: string, at: (s: string, i: number) => number): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0) {
      const n = at(s, i);
      if (n) {
        out.push(s.slice(from, i));
        from = i + n;
        i += n - 1;
      }
    }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** The compounds of a selector that nothing scopes: all of them in a .css file, those in :global(…) in a component. */
function unscoped(selector: string, component: boolean): string[] {
  const compounds = splitTop(selector, (s, i) => (/[\s>+~]/.test(s[i]) ? 1 : 0));
  const out: string[] = [];
  for (const c of compounds) {
    if (!component) {
      out.push(c);
      continue;
    }
    // :global(<selector>) holds compounds of its own; :global on its own (Svelte 5's block form) isn't used here.
    const m = /^:global\((.*)\)$/s.exec(c);
    if (m) out.push(...unscoped(m[1], false));
  }
  return out;
}

/** What a compound is keyed on, outside its pseudo-classes' arguments: a tag, class, id or attribute. */
function keyed(compound: string): boolean {
  let flat = "";
  let depth = 0;
  for (const c of compound) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0) flat += c;
  }
  // Attribute selectors keep their brackets: drop pseudo-classes, then see what's left.
  const rest = flat.replace(/::?[a-z-]+/g, "");
  return /^[a-z*]|[.#[]/i.test(rest) && rest !== "*";
}

function selectors(css: string): string[] {
  const out: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Every block's prelude: the text before a "{", back to the last "{", "}" or ";".
  const re = /([^{};]+)\{/g;
  for (let m; (m = re.exec(text)); ) {
    const pre = m[1].trim();
    if (!pre || pre.startsWith("@") || /^(from|to|\d+%)/.test(pre)) continue;
    out.push(...splitTop(pre, (s, i) => (s[i] === "," ? 1 : 0)));
  }
  return out;
}

test("no unscoped compound looks at what follows it among its siblings without a class, tag or attribute", () => {
  const found: string[] = [];
  let read = 0;
  for (const f of files("src")) {
    const src = readFileSync(f, "utf8");
    const component = f.endsWith(".svelte");
    const css = component ? [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n") : src;
    if (!css) continue;
    read++;
    for (const sel of selectors(css))
      for (const c of unscoped(sel, component)) if (COSTLY.test(c) && !keyed(c)) found.push(`${f}: ${sel}`);
  }
  assert.ok(read > 100, `read ${read} files`);
  assert.deepEqual(found, []);
});

test("the check finds what it should", () => {
  const bad = (sel: string, component = true) => unscoped(sel, component).some((c) => COSTLY.test(c) && !keyed(c));
  assert.ok(bad(".relic header > :global(:last-child:not(.who))"));
  assert.ok(bad(".form .plat > :global(:last-child)"));
  assert.ok(bad("ul > :only-child", false));
  assert.ok(bad(":global(.x) :global(:nth-last-child(2))"));
  assert.ok(!bad(".relic header > :global(.cart)"));
  assert.ok(!bad("li:last-child"), "scoped by Svelte");
  assert.ok(!bad(".landing .row > :only-child"), "scoped by Svelte");
  assert.ok(!bad(":global(tr.x td:last-child)"));
  assert.ok(!bad(":global(html[data-room~=\"lt760\"]) .band:has(> :global(:nth-child(4):last-child))"), "inside :has(), tried only on .band's children");
  assert.ok(!bad("li:last-child", false));
  assert.ok(!bad("[data-x]:last-child", false));
  assert.ok(!bad("> :first-child", false));
});
