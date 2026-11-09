// A grid of cards is one Tab stop; the arrow keys move between its cards.
import { test } from "node:test";
import assert from "node:assert/strict";

const { arrowTarget, columnsOf, rovingKey } = await import("../src/lib/ui/roving");

test("the columns are the cards sharing the first one's row", () => {
  assert.equal(columnsOf([0, 0, 0, 200, 200, 200, 400]), 3);
  assert.equal(columnsOf([0, 0.4, 200]), 2, "a fraction of a pixel is the same row");
  assert.equal(columnsOf([0, 200, 400]), 1, "one column");
  assert.equal(columnsOf([]), 1);
});

test("Left and Right step one card, carrying over between rows, and stop at the ends", () => {
  assert.equal(arrowTarget("ArrowRight", 2, 7, 3), 3);
  assert.equal(arrowTarget("ArrowLeft", 3, 7, 3), 2);
  assert.equal(arrowTarget("ArrowLeft", 0, 7, 3), null);
  assert.equal(arrowTarget("ArrowRight", 6, 7, 3), null);
});

test("Up and Down keep to the column; below a short last row, the last card", () => {
  assert.equal(arrowTarget("ArrowDown", 1, 8, 3), 4);
  assert.equal(arrowTarget("ArrowUp", 4, 8, 3), 1);
  assert.equal(arrowTarget("ArrowUp", 1, 8, 3), null, "the top row");
  // Eight cards in three columns: the last row has two. Down from the third column has no card
  // under it, so it goes to the last one; from the second, the card under it is the last.
  assert.equal(arrowTarget("ArrowDown", 5, 8, 3), 7);
  assert.equal(arrowTarget("ArrowDown", 4, 8, 3), 7);
  assert.equal(arrowTarget("ArrowDown", 7, 8, 3), null, "the last row");
});

test("Home and End go to the first and the last card; other keys go nowhere", () => {
  assert.equal(arrowTarget("Home", 4, 8, 3), 0);
  assert.equal(arrowTarget("End", 4, 8, 3), 7);
  assert.equal(arrowTarget("Home", 0, 8, 3), null);
  assert.equal(arrowTarget("Enter", 4, 8, 3), null);
  assert.equal(arrowTarget("a", 4, 8, 3), null);
  assert.equal(arrowTarget("ArrowRight", 0, 0, 3), null, "no cards");
});

function grid(n: number, cols: number) {
  const focused: number[] = [];
  const items = Array.from({ length: n }, (_, i) => ({ focus: () => void focused.push(i), getBoundingClientRect: () => ({ top: Math.floor(i / cols) * 200 }) }));
  return { items, focused };
}
const press = (key: string, target: unknown, extra: Record<string, boolean> = {}) => {
  const e = { key, target, preventDefault() { this.prevented = true; }, prevented: false, ...extra };
  return e;
};

test("an arrow key on a card focuses the neighbour and is kept from scrolling the page", () => {
  const { items, focused } = grid(8, 3);
  const e = press("ArrowRight", items[0]);
  assert.equal(rovingKey(e, items), true);
  assert.deepEqual(focused, [1]);
  assert.equal(e.prevented, true);
  const down = press("ArrowDown", items[1]);
  rovingKey(down, items);
  assert.deepEqual(focused, [1, 4]);
});

test("a key from something inside a card (its star, a field), or with a modifier, is left alone", () => {
  const { items, focused } = grid(8, 3);
  const inner = press("ArrowRight", { notACard: true });
  assert.equal(rovingKey(inner, items), false);
  assert.equal(inner.prevented, false);
  const shifted = press("ArrowRight", items[0], { shiftKey: true });
  assert.equal(rovingKey(shifted, items), false);
  assert.deepEqual(focused, []);
});

test("Enter and Space aren't taken: the card opens itself on them", () => {
  const { items, focused } = grid(4, 2);
  for (const k of ["Enter", " "]) {
    const e = press(k, items[0]);
    assert.equal(rovingKey(e, items), false);
    assert.equal(e.prevented, false);
  }
  assert.deepEqual(focused, []);
});
