// A long card grid's numbers (core/cards.ts): drawn a screen and a half ahead while in sight,
// folded back to where the player was once its page is left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsAhead, cardsToKeep, foldStep, wholeRows } from "../src/lib/core/cards";

// 4 cards a row, 20 a screen (5 rows), 600 in the list.
const at = (shown: number, reach: number, total = 600) => ({ total, shown, reach, perRow: 4, screenful: 20 });

test("whole rows", () => {
  assert.equal(wholeRows(0, 4), 0);
  assert.equal(wholeRows(1, 4), 4);
  assert.equal(wholeRows(28, 4), 28);
  assert.equal(wholeRows(29, 4), 32);
  // No measured row yet: one card a row.
  assert.equal(wholeRows(29, 0), 29);
  assert.equal(wholeRows(-3, 4), 0);
});

test("in sight: down to the screen's bottom and a screen and a half more, in whole rows", () => {
  // The screen's bottom at card 28: 28 + 30 = 58, to a row: 60.
  assert.equal(cardsAhead(at(24, 28)), 60);
  // Scrolling a row on: a row more, not another 48.
  assert.equal(cardsAhead(at(60, 32)), 64);
  assert.equal(cardsAhead(at(64, 36)), 68);
});

test("a fast scroll or a drag of the scroll bar past what's drawn: the new screen and a screen and a half", () => {
  assert.equal(cardsAhead(at(60, 150)), 180);
  // Never past the list's end.
  assert.equal(cardsAhead(at(590, 598)), 600);
  assert.equal(cardsAhead(at(600, 600)), 600);
});

test("in sight a list never folds: nothing fewer than it shows, and nothing more while far enough ahead", () => {
  assert.equal(cardsAhead(at(200, 40)), 200);
  assert.equal(cardsAhead(at(60, 28)), 60);
  // More shown than the list has (a page's first 24 of 13): left as it is.
  assert.equal(cardsAhead(at(24, 28, 13)), 24);
});

test("a short list: all of it, never more", () => {
  assert.equal(cardsAhead(at(10, 28, 13)), 13);
  assert.equal(cardsAhead(at(13, 28, 13)), 13);
});

test("the end marker near before the grid was measured: a screen more than shown", () => {
  assert.equal(cardsAhead(at(24, 0), { more: true }), 44);
  assert.equal(cardsAhead({ total: 600, shown: 24, reach: 0, perRow: 0, screenful: 0 }, { more: true }), 25);
  assert.equal(cardsAhead(at(590, 0), { more: true }), 600);
});

test("the end marker near while the cards shown are still being drawn: nothing more until they are", () => {
  // 64 shown, 40 drawn: the marker under the 40th is near, and stays near until the rest come.
  assert.equal(cardsAhead(at(64, 28), { more: true, drawn: 40 }), 64);
  // Every time it's seen meanwhile: still 64, not a screen more each time.
  let shown = 64;
  for (let i = 0; i < 10; i++) shown = cardsAhead(at(shown, 28), { more: true, drawn: 40 });
  assert.equal(shown, 64);
  // Once they're all drawn: a screen more.
  assert.equal(cardsAhead(at(64, 28), { more: true, drawn: 64 }), 84);
});

test("folding back: down to where the player was when the page was left, the first screenful at least", () => {
  // Left at the top of a list drawn to its 600th card: back to the first 24.
  assert.equal(cardsToKeep(at(600, 20)), 24);
  // Left a third of the way down: down to the screen's bottom, in whole rows.
  assert.equal(cardsToKeep(at(600, 201)), 204);
  // Left at the bottom: every card is above it.
  assert.equal(cardsToKeep(at(600, 600)), 600);
  // Never more than shown.
  assert.equal(cardsToKeep(at(30, 201)), 30);
  assert.equal(cardsToKeep(at(10, 20)), 10);
});

test("folding back keeps the card with the focus (or Tab's place in the grid), to its row's end", () => {
  assert.equal(cardsToKeep(at(600, 20), 301), 304);
  assert.equal(cardsToKeep(at(600, 20), -1), 24);
  assert.equal(cardsToKeep(at(600, 20), 3), 24);
  assert.equal(cardsToKeep(at(600, 20), 599), 600);
});

test("a fold goes a slice at a time and stops at what it keeps", () => {
  assert.equal(foldStep(600, 24, 100), 500);
  assert.equal(foldStep(100, 24, 100), 24);
  assert.equal(foldStep(24, 24, 100), 24);
  assert.equal(foldStep(20, 24, 100), 20);
  assert.equal(foldStep(600, 24, 0), 599);
  // Every slice of a fold, to the end.
  const seen: number[] = [];
  for (let n = 600; ; ) {
    const next = foldStep(n, 204, 150);
    if (next === n) break;
    seen.push((n = next));
  }
  assert.deepEqual(seen, [450, 300, 204]);
});
