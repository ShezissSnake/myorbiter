// What still runs after one of App.svelte's own effects throws (they have no error boundary above
// them, only the pages do). Svelte flushes effects from a microtask, so the throw leaves that
// microtask: in the window it is an uncaught "error" event, not a rejection (applog.ts hears both).
// The effects here change state as the app does and let Svelte's own microtask flush them.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { settle } from "./support/runes";
// After the hooks are registered (a static import would load it before them).
const { throwingEffects } = await import("./support/throwingEffects.svelte");

/** Runs `f` with queueMicrotask wrapped: a callback's throw is recorded where a browser would raise an error event. */
async function catchingMicrotasks(f: (thrown: unknown[]) => Promise<void>) {
  const original = globalThis.queueMicrotask;
  const thrown: unknown[] = [];
  globalThis.queueMicrotask = (cb: () => void) =>
    original(() => {
      try {
        cb();
      } catch (e) {
        thrown.push(e);
      }
    });
  try {
    await f(thrown);
  } finally {
    globalThis.queueMicrotask = original;
  }
}

test("after an effect throws once, later effects and later changes still run", async () => {
  await catchingMicrotasks(async (thrown) => {
    const { s, ran, stop } = throwingEffects();
    try {
      await settle();
      assert.deepEqual(ran, { thrower: [0], after: [0], other: [0], late: [0] }, "all ran once at the start");

      // The thrower fails on a = 1; `other` changes in the same turn.
      s.throwOn = 1;
      s.a = 1;
      s.other = 1;
      await settle();
      assert.equal(thrown.length, 1, "the throw left Svelte's microtask (an error event in the window)");
      assert.equal((thrown[0] as Error).message, "an effect failed");
      assert.deepEqual(ran.thrower, [0, 1], "the thrower ran up to its throw");
      // What the throw skipped in that same flush: the effects queued behind it.
      const skipped = { after: ran.after.at(-1) !== 1, other: ran.other.at(-1) !== 1 };
      assert.deepEqual(skipped, { after: true, other: true }, "effects behind the throw are skipped in that flush");

      // Nothing else changes: the skipped effects stay waiting.
      await settle();
      assert.deepEqual(ran.after, [0]);
      assert.deepEqual(ran.other, [0]);

      // The next change, even to unrelated state, flushes again: the skipped effects run then,
      // with the values as they are now.
      s.b = 1;
      await settle();
      assert.equal(thrown.length, 1, "no second throw");
      assert.deepEqual(ran.late, [0, 1], "a later change runs its effect");
      assert.deepEqual(ran.after, [0, 1], "the effect skipped behind the throw runs at the next flush");
      assert.deepEqual(ran.other, [0, 1], "so does the one on state changed in the throw's turn");

      // The thrower itself runs again when what it read changes, and stops throwing.
      s.a = 2;
      await settle();
      assert.deepEqual(ran.thrower, [0, 1, 2]);
      assert.deepEqual(ran.after, [0, 1, 2]);

      // Changes two and three flushes later still flush.
      s.b = 2;
      await settle();
      s.other = 2;
      await settle();
      assert.deepEqual(ran.late, [0, 1, 2]);
      assert.deepEqual(ran.other, [0, 1, 2]);
      assert.equal(thrown.length, 1);
    } finally {
      stop();
    }
  });
});
