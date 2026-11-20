// A dialog that closes on a click on its shade closes only when the press began on the shade too.
// A text selection dragged from a field and let go past the dialog's edge ends in a click on the
// shade (the common parent of where the press and the release were): that must not close it. The
// six dialogs that close on their shade share the one way (scrim.ts), and the two build dialogs ask
// before they discard what the player changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { scrim } = await import("../src/lib/ui/scrim");

type Handler = (e: { target: unknown }) => void;
function shade() {
  const on = new Map<string, Handler[]>();
  const node = {
    addEventListener: (t: string, h: Handler) => on.set(t, [...(on.get(t) ?? []), h]),
    removeEventListener: (t: string, h: Handler) => on.set(t, (on.get(t) ?? []).filter((x) => x !== h)),
  };
  const fire = (t: string, target: unknown) => (on.get(t) ?? []).forEach((h) => h({ target }));
  return { node, fire };
}
const field = { name: "the Title field" };

test("a press and a release on the shade close the dialog", () => {
  const { node, fire } = shade();
  let closed = 0;
  scrim(node as never, () => closed++);
  fire("pointerdown", node);
  fire("click", node);
  assert.equal(closed, 1);
});

test("a press in a field, dragged and let go on the shade, leaves the dialog open", () => {
  const { node, fire } = shade();
  let closed = 0;
  scrim(node as never, () => closed++);
  fire("pointerdown", field);
  fire("click", node);
  assert.equal(closed, 0);
});

test("a press on the shade let go inside the dialog closes nothing", () => {
  const { node, fire } = shade();
  let closed = 0;
  scrim(node as never, () => closed++);
  fire("pointerdown", node);
  fire("click", field);
  assert.equal(closed, 0);
});

test("a later press in the dialog forgets an earlier one on the shade", () => {
  const { node, fire } = shade();
  let closed = 0;
  scrim(node as never, () => closed++);
  fire("pointerdown", node);
  fire("click", field);
  fire("pointerdown", field);
  fire("click", node);
  assert.equal(closed, 0);
});

test("the close the shade calls follows an update", () => {
  const { node, fire } = shade();
  const calls: string[] = [];
  const action = scrim(node as never, () => calls.push("first"));
  action.update?.(() => calls.push("second"));
  fire("pointerdown", node);
  fire("click", node);
  assert.deepEqual(calls, ["second"]);
});

const DIALOGS = ["src/lib/ui/builds/BuildEditor.svelte", "src/lib/ui/builds/PasteDialog.svelte", "src/lib/ui/ListDialog.svelte", "src/lib/ui/BuyDialog.svelte", "src/lib/ui/BugReport.svelte", "src/lib/ui/Lookup.svelte"];

test("the six dialogs close on their shade by scrim.ts alone, with no click handler of their own", () => {
  for (const f of DIALOGS) {
    const src = readFileSync(f, "utf8");
    const tag = src.match(/<div class="scrim"[^>]*>/)?.[0];
    assert.ok(tag, `${f}: has its shade`);
    assert.match(tag, /use:scrim=\{/, `${f}: the shade closes through scrim.ts`);
    assert.doesNotMatch(tag, /onclick/, `${f}: no click handler on the shade`);
  }
});

const { leaving } = await import("../src/lib/ui/builds/leaving");

test("with nothing changed, Esc, the shade and Cancel close at once", () => {
  assert.equal(leaving(false, false), "close");
});

test("with something changed, the first try asks, and the question's own Esc keeps editing", () => {
  assert.equal(leaving(true, false), "ask");
  assert.equal(leaving(true, true), "stay");
});

for (const f of ["src/lib/ui/builds/BuildEditor.svelte", "src/lib/ui/builds/PasteDialog.svelte"]) {
  test(`${f.split("/").pop()}: Esc, the shade and Cancel go through the question, never straight to onclose`, () => {
    const src = readFileSync(f, "utf8");
    assert.match(src, /use:scrim=\{leave\}/, "the shade");
    assert.match(src, /onescape: leave\b/, "Esc");
    assert.match(src, /<button type="button" onclick=\{leave\}[^>]*>Cancel<\/button>/, "Cancel");
    assert.match(src, /Discard/, "the question offers to discard");
    assert.match(src, /Keep editing/, "and to keep editing");
    assert.doesNotMatch(src, /\bconfirm\(/, "the app's own question, not the browser's");
  });
}
