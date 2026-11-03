// The listing and buy forms only send whole, sane numbers to warframe.market.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PLAT, MAX_QTY, amountProblem, shown, wholeIn } from "../src/lib/core/amounts";

test("prices and quantities are whole numbers in range", () => {
  assert.equal(wholeIn(12, 1, MAX_PLAT), true);
  assert.equal(wholeIn(12.75, 1, MAX_PLAT), false);
  assert.equal(wholeIn(-5, 1, MAX_PLAT), false);
  assert.equal(wholeIn(0, 1, MAX_PLAT), false);
  assert.equal(wholeIn(0, 0, MAX_QTY), true, "adding nothing to a listing only changes its price");
  assert.equal(wholeIn(null, 0, MAX_QTY), false, "an empty box isn't 0");
  assert.equal(wholeIn(undefined, 1, MAX_QTY), false);
  assert.equal(wholeIn(Number.NaN, 1, MAX_QTY), false);
  assert.equal(wholeIn(MAX_PLAT + 1, 1, MAX_PLAT), false);
  assert.equal(wholeIn(MAX_QTY, 1, MAX_QTY), true);
});

test("labels show … for an empty box, and the form says what's wrong with a typed number", () => {
  assert.equal(shown(null), "…");
  assert.equal(shown(undefined), "…");
  assert.equal(shown(3), "3");
  assert.equal(amountProblem(null, null), null, "empty boxes: the button says … and stays off");
  assert.equal(amountProblem(2, 15), null);
  assert.match(amountProblem(2.5, 15)!, /quantity is a whole number from 1/);
  assert.match(amountProblem(0, 15, 0) ?? "ok", /ok/);
  assert.match(amountProblem(2, -5)!, /price is a whole number/);
  assert.match(amountProblem(2, 12.75)!, /price/);
});
