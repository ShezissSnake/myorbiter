// What tells the player what to do must reach the keyboard too. The focus tip (focusTip.ts) shows a
// control's title when the keyboard reaches it, but only on what can take the focus: Orders' "over
// market", "floor", "minimum" and "crack" tags carried their advice in a title on a plain span, and
// a disabled button can't be focused at all, so the reason it gives in its title was the mouse's
// alone. The tags take the focus now; the two build dialogs' Save stays reachable and says why it
// can't be pressed (aria-disabled, not disabled), and pressed then it still does nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orders = readFileSync("src/lib/tabs/Orders.svelte", "utf8");

test("Orders' advice tags take the focus, so their title shows as a focus tip", () => {
  for (const word of ["crack", "over market"]) {
    const tag = orders.match(new RegExp(`<span class="tag[^"]*"[^>]*>${word}</span>`))?.[0];
    assert.ok(tag, `the ${word} tag`);
    assert.match(tag, /tabindex="0"/, `the ${word} tag takes the focus`);
    assert.match(tag, /title=/);
  }
  const held = orders.match(/<span class="tag ok"[^>]*>\{minimumHeld\(o, p\) != null \? "minimum" : "floor"\}<\/span>/)?.[0];
  assert.ok(held, "the floor or minimum tag");
  assert.match(held, /tabindex="0"/);
});

for (const [file, cond] of [
  ["src/lib/ui/builds/BuildEditor.svelte", "problems > 0"],
  ["src/lib/ui/builds/PasteDialog.svelte", "!draft || !found || !linkOk"],
] as const) {
  test(`${file.split("/").pop()}: Save stays reachable while it can't be pressed, and says why`, () => {
    const src = readFileSync(file, "utf8");
    const save = src.match(/<button type="button" class="stamp gold".*?onclick=\{save\}>/)?.[0];
    assert.ok(save, "its Save");
    assert.doesNotMatch(save, /\sdisabled=/, "not disabled: a disabled button can't take the focus");
    assert.match(save, /aria-disabled=/, "aria-disabled says it can't be pressed");
    assert.ok(src.includes(cond), "the same condition as before");
    assert.match(save, /title=\{/, "its reason in the title, shown as a focus tip");
  });
}

test("the build editor's Save, pressed while names are left to fix, does nothing", () => {
  const src = readFileSync("src/lib/ui/builds/BuildEditor.svelte", "utf8");
  assert.match(src, /function save\(\) \{\n\s+if \(problems > 0\) return;/);
});

test("a button that keeps the focus while it can't be pressed is drawn as a disabled one", () => {
  const css = readFileSync("src/app.css", "utf8");
  assert.match(css, /\.stamp\.gold\[aria-disabled="true"\](:not\(\.pb\))?:hover/);
  assert.match(css, /\.stamp\[aria-disabled="true"\][^{]*\{[^}]*color: var\(--platinum-deep\)/);
});
