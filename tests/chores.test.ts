// Home's chore ticks: kept per reset, cleared by the reset itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDone, setDone } from "../src/lib/core/chores";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const MONDAY = "2026-11-09T00:00:00.000Z";

test("a tick counts until its reset, then clears on its own", () => {
  const t = setDone({}, "archon", MONDAY, true, NOW);
  assert.equal(isDone(t, "archon", MONDAY, NOW), true);
  assert.equal(isDone(t, "archon", MONDAY, Date.parse(MONDAY) + 1), false, "the reset has passed");
  assert.equal(isDone(t, "archon", "2026-11-16T00:00:00.000Z", NOW), false, "next week's Archon is a new chore");
  assert.equal(isDone(t, "sortie", MONDAY, NOW), false);
});

test("unticking, and old ticks dropped when another is set", () => {
  let t = setDone({}, "sortie", "2026-11-04T16:00:00Z", true, NOW);
  t = setDone(t, "archon", MONDAY, true, NOW);
  assert.deepEqual(Object.keys(t).sort(), ["archon", "sortie"]);
  t = setDone(t, "archon", MONDAY, false, NOW);
  assert.deepEqual(Object.keys(t), ["sortie"]);
  const later = Date.parse("2026-11-05T00:00:00Z");
  t = setDone(t, "kahl", MONDAY, true, later);
  assert.deepEqual(Object.keys(t), ["kahl"], "yesterday's Sortie tick is gone");
});

test("a missing or past reset can't be ticked", () => {
  assert.deepEqual(setDone({}, "x", "2026-11-01T00:00:00Z", true, NOW), {});
  assert.equal(isDone({ x: 5 }, "x", null, NOW), false);
});
