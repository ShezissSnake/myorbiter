// A search box over a long list (typed.svelte.ts): the list follows the box a moment later, and
// ends on exactly what's in the box.
import { flush, effectRoot } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

const { typed } = await import("../src/lib/typed.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const internal = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function box(now?: (v: string) => boolean) {
  const s = internal.proxy({ query: "" });
  let q!: () => string;
  const stop = effectRoot(() => {
    q = typed(() => s.query, now);
  });
  flush();
  return { s, q, stop };
}

test("a first change after a pause follows at once, after the box draws", async () => {
  const b = box();
  b.s.query = "g";
  flush();
  assert.equal(b.q(), "", "not in the same task as the key");
  await wait(5);
  flush();
  assert.equal(b.q(), "g");
  b.stop();
});

test("while typing, the list waits for a pause and ends on the whole word", async () => {
  const b = box();
  const seen: string[] = [];
  for (const k of ["g", "ga", "gau", "gaus", "gauss"]) {
    b.s.query = k;
    flush();
    await wait(30);
    flush();
    seen.push(b.q());
  }
  assert.ok(!seen.includes("gau") && !seen.includes("gaus"), `not every letter: ${seen}`);
  await wait(160);
  flush();
  assert.equal(b.q(), "gauss");
  b.stop();
});

test("a value marked as now is taken at once", async () => {
  const b = box((v) => !v);
  b.s.query = "gauss";
  flush();
  await wait(200);
  flush();
  assert.equal(b.q(), "gauss");
  b.s.query = "";
  flush();
  assert.equal(b.q(), "");
  b.stop();
});
