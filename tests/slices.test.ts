// Background work where the webview has no idle callback (core/slices.ts, used by whenIdle): jobs
// falling due together share a frame's budget, the rest go on after the next frame, in order, and
// none is ever cut or lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SLICE_BUDGET_MS, Slices } from "../src/lib/core/slices";

/** A hand-driven clock: tasks and frames run only when the test says so. */
function rig(budget = SLICE_BUDGET_MS) {
  let t = 0;
  const tasks: (() => void)[] = [];
  const frames: (() => void)[] = [];
  const s = new Slices({ now: () => t, afterFrame: (f) => void frames.push(f), task: (f) => void tasks.push(f) }, budget);
  const log: string[] = [];
  /** A job that takes `ms` and notes its name and when it started. */
  const job = (name: string, ms: number) => () => {
    log.push(`${name}@${t}`);
    t += ms;
  };
  const runTasks = () => {
    while (tasks.length) tasks.shift()!();
  };
  const frame = () => {
    const fs = frames.splice(0);
    for (const f of fs) f();
  };
  return { s, log, job, runTasks, frame, tasks, frames, advance: (ms: number) => (t += ms) };
}

test("a job with nothing before it runs at once", () => {
  const r = rig();
  r.s.run(r.job("a", 3));
  assert.deepEqual(r.log, ["a@0"]);
  assert.equal(r.s.waiting, 0);
});

test("jobs falling due one after another run while the frame's budget lasts, the rest after the next frame", () => {
  const r = rig(12);
  // Each from a timer of its own, as whenIdle's are.
  r.s.run(r.job("a", 4));
  r.s.run(r.job("b", 4));
  r.s.run(r.job("c", 4));
  r.s.run(r.job("d", 4));
  r.s.run(r.job("e", 1));
  assert.deepEqual(r.log, ["a@0", "b@4", "c@8"]);
  assert.equal(r.s.waiting, 2);
  r.runTasks();
  assert.deepEqual(r.log, ["a@0", "b@4", "c@8"], "nothing more in this frame");
  r.frame();
  // d in the new frame; e in a task of its own after it, within that frame's budget.
  assert.deepEqual(r.log, ["a@0", "b@4", "c@8", "d@12"]);
  r.runTasks();
  assert.deepEqual(r.log, ["a@0", "b@4", "c@8", "d@12", "e@16"]);
});

test("jobs waiting for a frame go one task each, so what one set off counts before the next starts", () => {
  const r = rig(12);
  r.s.run(r.job("a", 20));
  r.s.run(r.job("b", 1));
  r.s.run(r.job("c", 1));
  r.frame();
  assert.deepEqual(r.log, ["a@0", "b@20"]);
  assert.equal(r.tasks.length, 1);
  r.runTasks();
  assert.deepEqual(r.log, ["a@0", "b@20", "c@21"]);
});

test("a job longer than the budget runs whole, and the next waits for the frame after it", () => {
  const r = rig(12);
  r.s.run(r.job("page", 40));
  r.s.run(r.job("list", 2));
  r.runTasks();
  assert.deepEqual(r.log, ["page@0"]);
  r.frame();
  assert.deepEqual(r.log, ["page@0", "list@40"]);
});

test("a job arriving once the budget is spent waits for the next frame, behind those already waiting", () => {
  const r = rig(12);
  r.s.run(r.job("a", 20));
  r.s.run(r.job("b", 1));
  r.runTasks();
  r.s.run(r.job("c", 1));
  assert.deepEqual(r.log, ["a@0"]);
  r.frame();
  r.runTasks();
  assert.deepEqual(r.log, ["a@0", "b@20", "c@21"]);
});

test("a job started by a job waits for a task of its own", () => {
  const r = rig(12);
  r.s.run(() => {
    r.log.push("outer");
    r.s.run(r.job("inner", 1));
    assert.deepEqual(r.log, ["outer"]);
  });
  r.runTasks();
  assert.deepEqual(r.log, ["outer", "inner@0"]);
});

test("a job that throws doesn't stop the ones after it", () => {
  const r = rig(12);
  r.s.run(r.job("a", 20));
  r.s.run(() => {
    throw new Error("boom");
  });
  r.s.run(r.job("c", 1));
  assert.throws(() => r.frame(), /boom/);
  r.runTasks();
  assert.deepEqual(r.log, ["a@0", "c@20"]);
});

test("a new frame starts a new budget; with nothing waiting no frame is awaited", () => {
  const r = rig(12);
  r.s.run(r.job("a", 1));
  assert.equal(r.frames.length, 1);
  r.frame();
  assert.equal(r.frames.length, 0);
  r.advance(100);
  r.s.run(r.job("b", 1));
  assert.deepEqual(r.log, ["a@0", "b@101"]);
});
