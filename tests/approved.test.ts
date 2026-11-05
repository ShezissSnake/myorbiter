// Automatic repricing never takes a listing under 70% of the price last set or approved for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_FLOOR_SHARE, approvedOf, autoFloor, unattendedMove } from "../src/lib/core/approved";

test("the floor is 70% of the approved price, rounded up to whole platinum", () => {
  assert.equal(AUTO_FLOOR_SHARE, 0.7);
  assert.equal(autoFloor(100), 70);
  assert.equal(autoFloor(15), 11, "10.5 rounds up");
  assert.equal(autoFloor(10), 7);
  assert.equal(autoFloor(1), 1);
});

test("above the floor a pass goes where the market is; under it, to the floor and then no further", () => {
  assert.deepEqual(unattendedMove(80, 100, 100), { go: true, target: 80, atFloor: false });
  assert.deepEqual(unattendedMove(70, 100, 100), { go: true, target: 70, atFloor: false }, "the floor itself is allowed");
  assert.deepEqual(unattendedMove(51, 100, 100), { go: true, target: 70, atFloor: true });
  assert.deepEqual(unattendedMove(40, 70, 100), { go: false, floor: 70 }, "at the floor: stays");
  assert.deepEqual(unattendedMove(40, 60, 100), { go: false, floor: 70 }, "under it (set by hand before): not raised to it");
  assert.deepEqual(unattendedMove(120, 100, 100), { go: true, target: 120, atFloor: false }, "raising is never held");
});

test("saved approvals keep only whole positive prices", () => {
  assert.deepEqual(approvedOf({ "a||": 20, "b||": 0, "c||": 1.5, "d||": "9", "e||": 7 }), { "a||": 20, "e||": 7 });
  assert.deepEqual(approvedOf(null), {});
  assert.deepEqual(approvedOf([1, 2]), {});
});
