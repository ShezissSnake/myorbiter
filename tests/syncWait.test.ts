// Sync ends when TennoScope's new read lands, not after a fixed wait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncFill, waitForNewRead } from "../src/lib/core/syncWait";

/** A clock that only moves when the wait sleeps. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

test("the fill eases toward 0.8 by time and never reaches it", () => {
  assert.equal(syncFill(0), 0.15);
  assert.ok(syncFill(10_000) > syncFill(5_000));
  assert.ok(syncFill(30_000) < 0.8);
  assert.ok(syncFill(10 * 60_000) <= 0.8);
  assert.ok(syncFill(30_000) > 0.7, "near the end by the time limit");
});

test("returns as soon as the stamp changes", async () => {
  const c = clock();
  const stamps = [5, 5, 5, 9];
  const ticks: number[] = [];
  const got = await waitForNewRead(async () => stamps.shift() ?? 9, 5, { ...c, onTick: (ms) => ticks.push(ms) });
  assert.equal(got, 9);
  assert.equal(c.now(), 3000, "three looks a second apart");
  assert.deepEqual(ticks, [0, 1000, 2000]);
});

test("a look that fails counts as no change yet", async () => {
  const c = clock();
  let n = 0;
  const got = await waitForNewRead(async () => {
    if (++n < 3) throw new Error("folder missing");
    return 7;
  }, 5, c);
  assert.equal(got, 7);
});

test("gives up with a reason after the limit", async () => {
  const c = clock();
  await assert.rejects(waitForNewRead(async () => 5, 5, { ...c, limit: 30_000 }), /within 30 seconds/);
  assert.equal(c.now(), 30_000);
});

test("stops at once when TennoScope reports a problem", async () => {
  const c = clock();
  let err: string | null = null;
  const w = waitForNewRead(async () => {
    err = "TennoScope stopped";
    return 5;
  }, 5, { ...c, abort: () => err });
  await assert.rejects(w, /TennoScope stopped/);
  assert.equal(c.now(), 1000);
});
