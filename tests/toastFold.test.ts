// The pop-ups inside MyOrbiter (toasts.svelte.ts): a burst folds the oldest into "N more", never
// a sale whose +rep is still to give, nor the notice of what leaving the setup page switched off,
// which comes just before the burst that leaving brings (App.svelte, tellSwitchedOff).
import "./support/runes";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Notice } from "../src/lib/notices";

const { toasts, MAX_SHOWN } = await import("../src/lib/toasts.svelte");

const n = (id: string, rep = false): Notice => ({ id, at: 0, kind: "alerts", title: id, body: "", read: false, ...(rep ? { rep: { key: id, partner: "ExamplePlayer" } } : {}) });
const shown = () => toasts.list.map((t) => t.id);
const reset = () => {
  for (const id of shown()) toasts.dismiss(id);
  toasts.dropMore();
};

afterEach(reset);

test("two at once: the oldest of a burst folds into \"N more\"", () => {
  assert.equal(MAX_SHOWN, 2);
  for (const id of ["a", "b", "c", "d"]) toasts.push(n(id));
  assert.deepEqual(shown(), ["d", "c"]);
  assert.equal(toasts.more, 2);
});

test("the setup page's switch-off notice stays up through the burst that follows it", () => {
  toasts.push(n("setup"), true);
  for (const id of ["a", "b", "c", "d"]) toasts.push(n(id));
  assert.deepEqual(shown(), ["d", "setup"]);
  assert.equal(toasts.more, 3);
});

test("a sale whose +rep is still to give is folded no more than before, kept-out notice or not", () => {
  // As before: the oldest other one goes, the +rep sale stays.
  toasts.push(n("sale", true));
  toasts.push(n("x"));
  toasts.push(n("y"));
  assert.deepEqual(shown(), ["y", "sale"]);
  reset();
  // With the setup notice beside it, in either order: the +rep sale stays.
  toasts.push(n("sale", true));
  toasts.push(n("setup"), true);
  toasts.push(n("y"));
  assert.deepEqual(shown(), ["y", "sale"]);
  reset();
  toasts.push(n("setup"), true);
  toasts.push(n("sale", true));
  toasts.push(n("y"));
  assert.deepEqual(shown(), ["y", "sale"]);
});

test("once gone, a kept-out notice's id folds as any other", () => {
  toasts.push(n("setup"), true);
  toasts.dismiss("setup");
  toasts.push(n("setup"));
  toasts.push(n("a"));
  toasts.push(n("b"));
  assert.deepEqual(shown(), ["b", "a"]);
});
