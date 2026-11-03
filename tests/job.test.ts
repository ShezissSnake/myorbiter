// A button's job: one run at a time, its progress, and its done and failed words.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

const { Job, JobError, Jobs } = await import("../src/lib/job.svelte");

test("a second run while one works is ignored, so a double click starts it once", async () => {
  const j = new Job(10, 10);
  let runs = 0;
  let finish!: () => void;
  const first = j.run(async () => {
    runs++;
    await new Promise<void>((r) => (finish = r));
    return "Done it";
  });
  assert.equal(j.state, "working");
  assert.equal(await j.run(async () => void runs++), false, "ignored");
  finish();
  assert.equal(await first, true);
  assert.equal(runs, 1);
  assert.equal(j.state, "done");
  assert.equal(j.note, "Done it");
});

test("progress is a share of the steps, or the fraction when work is measured in time", async () => {
  const j = new Job();
  await j.run(async (job) => {
    assert.equal(job.progress, null, "nothing known yet: a sweep");
    job.step(3, 12);
    assert.equal(job.progress, 0.25);
    job.fraction = 0.8;
    assert.equal(job.progress, 0.8, "the fraction wins");
    job.fraction = 1.5;
    assert.equal(job.progress, 1, "never past full");
  });
  j.reset();
});

test("a failure keeps its full reason, and a short word when it gives one", async () => {
  const j = new Job(10, 10);
  assert.equal(await j.run(async () => { throw new Error("Error: warframe.market didn't answer"); }), false);
  assert.equal(j.state, "failed");
  assert.equal(j.error, "warframe.market didn't answer");
  assert.equal(j.short, null);
  await j.run(async () => { throw new JobError("2 failed", "Two listings were refused"); });
  assert.equal(j.short, "2 failed");
  assert.equal(j.error, "Two listings were refused");
  j.reset();
});

test("done and failed go back to idle on their own", async () => {
  const j = new Job(5, 5);
  await j.run(async () => "ok");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(j.state, "idle");
  await j.run(async () => { throw new Error("no"); });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(j.state, "idle");
});

test("one job per row, made when first asked for", () => {
  const rows = new Jobs();
  assert.equal(rows.busy("a"), false);
  assert.equal(rows.get("a"), rows.get("a"));
  assert.notEqual(rows.get("a"), rows.get("b"));
});
