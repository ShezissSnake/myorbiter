import { test } from "node:test";
import assert from "node:assert/strict";
import { dropsVersion, sameDrops } from "../src/lib/core/drops";

test("sameDrops compares what the maps hold", () => {
  assert.ok(sameDrops(new Map([["a", 1]]), new Map([["a", 1]])));
  assert.ok(!sameDrops(new Map([["a", 1]]), new Map([["a", 2]])));
  assert.ok(!sameDrops(new Map([["a", 1]]), new Map([["b", 1]])));
  assert.ok(!sameDrops(new Map([["a", 1]]), new Map()));
});

test("a rebuilt map with the same contents keeps its version; other contents get a new one", () => {
  const first = dropsVersion(new Map([["Rhino Prime Neuroptics", 2]]));
  assert.equal(dropsVersion(new Map([["Rhino Prime Neuroptics", 2]])), first);
  const second = dropsVersion(new Map([["Rhino Prime Neuroptics", 3]]));
  assert.notEqual(second, first);
  assert.equal(dropsVersion(new Map([["Rhino Prime Neuroptics", 3]])), second);
  assert.equal(dropsVersion(null), "-");
});
