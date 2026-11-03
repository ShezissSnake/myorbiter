import { test } from "node:test";
import assert from "node:assert/strict";
import { nearTraceCap, traceCap } from "../src/lib/core/traces";

test("the Void Trace cap is 100 + 50 a Mastery Rank, and near it within one radiant refine", () => {
  assert.equal(traceCap(24), 1300);
  assert.equal(traceCap(0), 100);
  assert.equal(traceCap(null), null);
  assert.equal(nearTraceCap(1200, 1300), true);
  assert.equal(nearTraceCap(1199, 1300), false);
  assert.equal(nearTraceCap(5000, null), false);
});
