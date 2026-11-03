// The Trade ticker tape marks the figures that moved since you last looked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LastSeen, moves } from "../src/lib/core/ticker";

test("a figure moved when it was known on both looks and differs", () => {
  const before = new Map<string, number | null>([["left", 24], ["value", 1200], ["reprice", null], ["check", 5]]);
  const now = new Map<string, number | null>([["left", 21], ["value", 1350], ["reprice", 2], ["check", 5], ["new", 3]]);
  assert.deepEqual([...moves(before, now)], [["left", "down"], ["value", "up"]]);
  assert.equal(moves(undefined, now).size, 0, "the first look marks nothing");
  assert.equal(moves(before, new Map([["left", null]])).size, 0, "still loading isn't a move");
});

test("last seen is kept per tape, and a figure still loading keeps what was seen of it", () => {
  const seen = new LastSeen();
  assert.equal(seen.get("orders"), undefined);
  seen.set("orders", new Map([["left", 24], ["value", 900]]));
  seen.set("orders", new Map<string, number | null>([["left", 20], ["value", null]]));
  assert.deepEqual([...seen.get("orders")!], [["left", 20], ["value", 900]]);
  assert.equal(seen.get("sales"), undefined);
});
