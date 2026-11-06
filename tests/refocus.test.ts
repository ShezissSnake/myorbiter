// refocus: when a press takes away its own button (Undo, Keep), the keyboard focus goes on to the
// control that came back or a neighbour, not to the top of the page.
import { test } from "node:test";
import assert from "node:assert/strict";

const { refocus, usable } = await import("../src/lib/ui/refocus");

// Just enough of a page: the focus, frames run by hand, and buttons that can leave it.
const body = { tag: "body" };
const doc = { body, activeElement: body as unknown };
let frames: (() => void)[] = [];
const g = globalThis as Record<string, unknown>;
g.document = doc;
g.requestAnimationFrame = (f: () => void) => (frames.push(f), frames.length);
const run = (n = 60) => {
  for (let i = 0; i < n && frames.length; i++) {
    const now = frames;
    frames = [];
    for (const f of now) f();
  }
};
function el(name: string) {
  const b = {
    name,
    isConnected: true,
    inert: false,
    closest: (sel: string) => (sel === "[inert]" && b.inert ? b : null),
    focus: () => void (doc.activeElement = b),
  };
  return b;
}
const start = () => {
  frames = [];
  doc.activeElement = body;
};

test("the focus goes to the control that came back once the pressed one is gone", () => {
  start();
  const undo = el("Undo");
  const back = el("Remove it");
  back.isConnected = false;
  doc.activeElement = undo;
  refocus(undo as never, () => back as never);
  run(2);
  assert.equal(doc.activeElement, undo, "still on Undo while it's there");
  // Undo goes, the focus falls to the page; what it brings back is drawn a frame later.
  undo.isConnected = false;
  doc.activeElement = body;
  run(1);
  assert.equal(doc.activeElement, body);
  back.isConnected = true;
  run(2);
  assert.equal(doc.activeElement, back);
});

test("a button turned inert while it leaves counts as gone", () => {
  start();
  const keep = el("Keep");
  const next = el("Keep (next)");
  doc.activeElement = keep;
  refocus(keep as never, () => next as never);
  keep.inert = true;
  run();
  assert.equal(doc.activeElement, next);
});

test("nothing moves when the pressed button hadn't the focus, or the focus moved on", () => {
  start();
  const keep = el("Keep");
  const next = el("Keep (next)");
  refocus(keep as never, () => next as never);
  keep.isConnected = false;
  run();
  assert.equal(doc.activeElement, body, "a click that didn't focus the button");

  const other = el("Search");
  const keep2 = el("Keep");
  doc.activeElement = keep2;
  refocus(keep2 as never, () => next as never);
  doc.activeElement = other;
  keep2.isConnected = false;
  run();
  assert.equal(doc.activeElement, other);
});

test("a target that's leaving too, or never comes, isn't focused, and the watch ends", () => {
  start();
  const undo = el("Undo");
  const leaving = el("Undo (next)");
  leaving.inert = true;
  doc.activeElement = undo;
  refocus(undo as never, () => leaving as never);
  undo.isConnected = false;
  doc.activeElement = body;
  run(100);
  assert.equal(doc.activeElement, body);
  assert.equal(frames.length, 0);
  assert.equal(usable(leaving as never), false);
  assert.equal(usable(null), false);
});
