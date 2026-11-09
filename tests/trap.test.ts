// trap's focusables: what Tab can reach inside a dialog. A page kept in the DOM after it was left
// (`visibility: hidden`) has layout boxes but takes no focus, so it mustn't count, or the dialog
// believes its last control is one it can't focus and the focus cycles on too few.
import { test } from "node:test";
import assert from "node:assert/strict";

const { focusables, reachable } = await import("../src/lib/ui/trap");

interface Fake {
  name: string;
  visibility: string;
  boxes: number;
  /** An ancestor with the hidden attribute or inert. */
  shut?: boolean;
  getClientRects: () => { length: number };
  closest: (sel: string) => Fake | null;
}
const g = globalThis as Record<string, unknown>;
g.getComputedStyle = (el: Fake) => ({ visibility: el.visibility });

function control(name: string, o: Partial<Pick<Fake, "visibility" | "boxes" | "shut">> = {}): Fake {
  const c: Fake = {
    name,
    visibility: o.visibility ?? "visible",
    boxes: o.boxes ?? 1,
    shut: o.shut,
    getClientRects: () => ({ length: c.boxes }),
    closest: (sel) => (c.shut && /hidden|inert/.test(sel) ? c : null),
  };
  return c;
}
const dialog = (...els: Fake[]) => ({ querySelectorAll: () => els }) as never;
const names = (els: unknown[]) => (els as Fake[]).map((e) => e.name);

test("a control with a box and visible is reachable", () => {
  assert.equal(reachable(control("Save") as never), true);
});

test("a visibility: hidden control is skipped though it has a layout box", () => {
  const els = [control("First"), control("Kept page", { visibility: "hidden", boxes: 3 }), control("Last")];
  assert.deepEqual(names(focusables(dialog(...els))), ["First", "Last"]);
});

test("the last control, when hidden, isn't the one the trap wraps at", () => {
  const els = [control("First"), control("Second"), control("Gone", { visibility: "hidden" })];
  const found = focusables(dialog(...els)) as unknown as Fake[];
  assert.equal(found[found.length - 1].name, "Second");
});

test("a control with no box (display: none) is skipped", () => {
  assert.deepEqual(names(focusables(dialog(control("A"), control("B", { boxes: 0 })))), ["A"]);
});

test("a control inside something hidden or inert is skipped", () => {
  assert.deepEqual(names(focusables(dialog(control("A"), control("B", { shut: true })))), ["A"]);
});
