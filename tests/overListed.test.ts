import { test } from "node:test";
import assert from "node:assert/strict";
import { overListed } from "../src/lib/core/market";

const o = (id: string, quantity: number, visible: boolean) => ({ id, quantity, visible });

test("listings over what you hold: visible and hidden apart, as Orders and Home count them", () => {
  const held: Record<string, number | null> = { a: 2, b: 5, c: 3, d: null };
  // a: listed 5, hold 2 (hidden); b: listed 6, hold 5 (shown); c: listed 3, hold 3; d: unknown.
  const r = overListed([o("a", 5, false), o("b", 6, true), o("c", 3, true), o("d", 9, true)], (x) => held[x.id]);
  assert.deepEqual(r.shown.map((x) => x.id), ["b"]);
  assert.deepEqual(r.hidden.map((x) => x.id), ["a"]);
});

test("listings over what you hold: a buy order is never one", () => {
  const r = overListed([{ id: "x", quantity: 5, visible: true, type: "buy" }, { id: "y", quantity: 5, visible: true, type: "sell" }], () => 0);
  assert.deepEqual(r.shown.map((x) => x.id), ["y"]);
});

test("listings over what you hold: none listed, none flagged", () => {
  assert.deepEqual(overListed([], () => 0), { shown: [], hidden: [] });
});
