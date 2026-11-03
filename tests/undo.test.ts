// Undo instead of instant loss: a dismissal waits, and Undo in that time changes nothing.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

const { UndoSlots } = await import("../src/lib/undo.svelte");
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("the change is made only once the time is up", async () => {
  const u = new UndoSlots(10);
  let gone = 0;
  u.hold("a", () => gone++);
  assert.equal(u.has("a"), true);
  assert.equal(gone, 0);
  await later(30);
  assert.equal(gone, 1);
  assert.equal(u.has("a"), false);
});

test("Undo in time changes nothing", async () => {
  const u = new UndoSlots(10);
  let gone = 0;
  u.hold("a", () => gone++);
  u.undo("a");
  await later(30);
  assert.equal(gone, 0);
  assert.equal(u.has("a"), false);
});

test("leaving the page makes every waiting change at once", () => {
  const u = new UndoSlots(10_000);
  const made: string[] = [];
  u.hold("a", () => made.push("a"));
  u.hold("b", () => made.push("b"));
  u.flush();
  assert.deepEqual(made, ["a", "b"]);
  assert.deepEqual(u.held, {});
});

test("holding a key again restarts its wait and makes the change once", async () => {
  const u = new UndoSlots(20);
  let gone = 0;
  u.hold("a", () => gone++);
  await later(10);
  u.hold("a", () => gone++);
  await later(15);
  assert.equal(gone, 0, "restarted");
  await later(20);
  assert.equal(gone, 1);
});
