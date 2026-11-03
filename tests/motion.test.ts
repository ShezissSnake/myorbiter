// The motion kit: the one easing, and the guards that keep motion to answering a click.
import { test } from "node:test";
import assert from "node:assert/strict";

const { bezier, out, ms, arrive, leave, reveal, opens, SNAP, QUICK, SETTLE, FRAME_BUDGET } = await import("../src/lib/motion");

test("the easing starts at 0, ends at 1 and only goes forward", () => {
  assert.equal(out(0), 0);
  assert.equal(out(1), 1);
  let last = 0;
  for (let i = 1; i <= 100; i++) {
    const v = out(i / 100);
    assert.ok(v >= last - 1e-9, `not forward at ${i / 100}`);
    last = v;
  }
});

test("--out is quick off the mark: most of the way there in the first third", () => {
  assert.ok(out(1 / 3) > 0.75);
  // A straight line stays a straight line.
  const linear = bezier(1 / 3, 1 / 3, 2 / 3, 2 / 3);
  for (const t of [0.1, 0.5, 0.9]) assert.ok(Math.abs(linear(t) - t) < 1e-4);
});

test("three durations, in order, none over a quarter second", () => {
  assert.ok(SNAP < QUICK && QUICK < SETTLE && SETTLE <= 250);
  assert.equal(ms(QUICK), QUICK);
});

test("an arrival with no click or key behind it doesn't move (no motion on load)", () => {
  assert.equal(arrive({} as Element).duration, 0);
  assert.equal(arrive({} as Element, { always: true }).duration, QUICK);
});

test("leaving fades and lifts; past the frame's budget the rest just go", async () => {
  await new Promise((r) => setTimeout(r, 20)); // a new frame's budget
  const first = leave({} as Element);
  assert.equal(first.duration, QUICK);
  assert.match(first.css!(0.5, 0.5), /opacity:0\.5;transform:translateY\(-2\.00px\)/);
  let moved = 1;
  for (let i = 0; i < FRAME_BUDGET + 10; i++) if (leave({} as Element).duration) moved++;
  assert.equal(moved, FRAME_BUDGET);
});

test("a fold opens on grid rows; a dialog opens faster than it closes", async () => {
  await new Promise((r) => setTimeout(r, 20)); // a new frame's budget
  const cls = new Set<string>();
  const node = { classList: { add: (c: string) => cls.add(c) } } as unknown as Element;
  const r = reveal(node, { always: true });
  assert.ok(cls.has("reveal"));
  assert.match(r.css!(0.5, 0.5), /grid-template-rows:0\.5000fr/);
  assert.equal(opens(node, {}, { direction: "in" }).duration, 120);
  assert.equal(opens(node, {}, { direction: "out" }).duration, 100);
  assert.doesNotMatch(opens(node, { fade: false }, { direction: "in" }).css!(0.5, 0.5), /opacity/);
});

test("a row leaving a flipped list stays where Svelte holds it while it fades", async () => {
  await new Promise((r) => setTimeout(r, 20)); // a new frame's budget
  const node = { style: { transform: "translate(0px, 96px)" } } as unknown as Element;
  assert.match(leave(node).css!(0.5, 0.5), /transform:translate\(0px, 96px\) translateY\(-2\.00px\)/);
});

test("rows sliding to their new places only slide: none is squashed on the way", async () => {
  await new Promise((r) => setTimeout(r, 20)); // a new frame's budget
  const { flip } = await import("../src/lib/motion");
  const rect = (left: number, top: number, w: number, h: number) => ({ left, top, width: w, height: h, right: left + w, bottom: top + h }) as DOMRect;
  const node = { getBoundingClientRect: () => rect(0, 0, 100, 40) } as unknown as Element;
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle ??= () => ({ transform: "none", transformOrigin: "0px 0px" });
  const c = flip(node, { from: rect(200, 100, 100, 60), to: rect(0, 0, 100, 40) });
  assert.equal(c.css!(0, 1), "transform:translate(200.00px,100.00px)");
  assert.doesNotMatch(c.css!(0.5, 0.5), /scale/);
});
