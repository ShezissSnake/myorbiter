// Report a bug's Open on GitHub, while it can't be pressed (nothing typed in What happened yet, or
// MyOrbiter's log still being read): it stays reachable by the keyboard and says why, as the build
// dialogs' Save does (reachableAdvice.test.ts). A disabled button can't take the focus, so its
// reason, in its title, was the mouse's alone; aria-disabled keeps the focus and the focus tip.
// The dialog is rendered here as the app draws it, with a made-up draft.
import "./support/runes";
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register("./support/component-hooks.mjs", import.meta.url);

const { render } = await import("svelte/server");
const { bugReport } = await import("../src/lib/bugReport.svelte");
const { default: BugReport } = await import("../src/lib/ui/BugReport.svelte");

/** The go button's opening tag, with the draft's What happened set to `what`. */
function goButton(what: string): string {
  bugReport.draft.what = what;
  const { body } = render(BugReport, { props: { page: "Orders", tennoscope: "connected", fullMode: "off", names: () => ({ self: ["ExamplePlayer"] }) } });
  const tags = body.match(/<button\b[^>]*\bclass="[^"]*\bgo\b[^"]*"[^>]*>/g) ?? [];
  assert.equal(tags.length, 1, "one go button");
  return tags[0];
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

test("nothing typed yet: Open on GitHub keeps the focus and says to say what happened first", () => {
  const tag = goButton("");
  assert.doesNotMatch(tag, /\sdisabled(\s|=|>)/, "not disabled: a disabled button can't take the focus");
  assert.equal(attr(tag, "aria-disabled"), "true", "says it can't be pressed");
  assert.notEqual(attr(tag, "tabindex"), "-1", "a Tab stop");
  assert.equal(attr(tag, "title"), "Say what happened first", "its reason, shown as a focus tip");
});

test("typed, while the log is still being read: still reachable, and says so", () => {
  // On the server the reads never run, so the dialog stays as it is while they're on their way.
  const tag = goButton("The Orders page froze after a sort");
  assert.doesNotMatch(tag, /\sdisabled(\s|=|>)/);
  assert.equal(attr(tag, "aria-disabled"), "true");
  assert.equal(attr(tag, "title"), "Reading MyOrbiter's log…");
  bugReport.draft.what = "";
});

test("pressed while it can't be, by click or Enter, once or twice, it copies and opens nothing", () => {
  // Enter on a button is its click; the button has no other handler, and the handler's first
  // statement turns it away while it can't be pressed (and while a press is under way).
  const ui = readFileSync("src/lib/ui/BugReport.svelte", "utf8");
  const go = ui.match(/<button bind:this=\{openButton\}[^>]*>/)?.[0];
  assert.ok(go, "the go button");
  assert.match(go, /onclick=\{openOnGitHub\}/);
  assert.doesNotMatch(go, /onkey|onpointer|onmouse/);
  assert.match(ui, /async function openOnGitHub\(\) \{\n\s+if \(empty \|\| reading \|\| busy\) return;/);
});
