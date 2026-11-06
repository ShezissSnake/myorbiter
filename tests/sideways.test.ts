// A table's box scrolls sideways only while the table is wider than it (ui/sideways.ts): a box that
// always scrolled would hold the sticky header, which then scrolls away with the page. The flag
// follows the table growing as well as the box shrinking, and is told only when it changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sideways, widerThan } from "../src/lib/ui/sideways";

test("widerThan: a whole pixel past the room is wider, a part of one isn't", () => {
  assert.equal(widerThan(855, 855), false);
  assert.equal(widerThan(855.6, 855), false);
  assert.equal(widerThan(856, 855), true);
  assert.equal(widerThan(906, 855), true);
  assert.equal(widerThan(700, 855), false);
});

/** A box holding a table, with a ResizeObserver and frames run by hand. */
function setup() {
  const observers: { cb: () => void; on: Set<object> }[] = [];
  const frames: (() => void)[] = [];
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver = class {
    on = new Set<object>();
    constructor(cb: () => void) {
      observers.push({ cb, on: this.on });
    }
    observe(t: object) {
      this.on.add(t);
    }
    disconnect() {
      this.on.clear();
    }
  };
  g.requestAnimationFrame = (f: () => void) => frames.push(f);
  g.cancelAnimationFrame = () => {};
  const table = { offsetWidth: 800 };
  const box = { clientWidth: 855, querySelector: () => table };
  /** A size changed: each observer watching `t` reports. */
  const report = (t: object) => {
    for (const o of observers) if (o.on.has(t)) o.cb();
  };
  /** ...and the next frame runs. */
  const resized = (t: object) => {
    report(t);
    frames.splice(0).forEach((f) => f());
  };
  return { table, box, report, resized, frames };
}

test("sideways: flags a table wider than its box, from either side, and only on a change", () => {
  const { table, box, resized } = setup();
  const told: boolean[] = [];
  const act = sideways(box as unknown as HTMLElement, (w) => told.push(w));
  resized(box);
  assert.deepEqual(told, [false]);
  // The page narrows (the box shrinks) below the table's least width.
  box.clientWidth = 700;
  resized(box);
  assert.deepEqual(told, [false, true]);
  // The box grows again: back to fitting.
  box.clientWidth = 855;
  resized(box);
  // Only the table grows (rows drawn, a column shown): the box's size is the same.
  table.offsetWidth = 906;
  resized(table);
  resized(table);
  assert.deepEqual(told, [false, true, false, true]);
  act?.destroy();
  box.clientWidth = 2000;
  resized(box);
  assert.deepEqual(told, [false, true, false, true]);
});

test("sideways: the box and the table reporting together are measured once, a frame later", () => {
  const { table, box, report, frames } = setup();
  const told: boolean[] = [];
  sideways(box as unknown as HTMLElement, (w) => told.push(w));
  table.offsetWidth = 906;
  report(box);
  report(table);
  assert.equal(frames.length, 1);
  assert.deepEqual(told, []);
  frames.splice(0).forEach((f) => f());
  assert.deepEqual(told, [true]);
});
