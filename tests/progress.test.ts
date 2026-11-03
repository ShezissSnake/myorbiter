// Long lists redrawn a slice at a time (core/progress.ts): every step is a list with no row twice
// and only rows of the new list, the rows in sight are right from the first step, and the last
// step is exactly the new list, whatever the order of the old one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsInView, settled, stepRows } from "../src/lib/core/progress";

type R = { id: string; v: number };
const row = (id: string, v = 0): R => ({ id, v });
const key = (r: R) => r.id;
const ids = (rs: readonly R[]) => rs.map(key).join(",");

/** Steps from `drawn` to `target`, `first` rows then `step` more each time, as progressive() does. */
function walk(target: R[], drawn: readonly R[], first: number, step: number): (readonly R[])[] {
  const out: (readonly R[])[] = [];
  let upto = first;
  let cur = stepRows(target, drawn, key, upto);
  out.push(cur);
  while (!settled(target, cur)) {
    upto += step;
    cur = stepRows(target, cur, key, upto);
    out.push(cur);
    assert.ok(out.length < 1000, "steps end");
  }
  return out;
}

const shuffle = (a: R[], seed: number) => {
  const b = [...a];
  let s = seed;
  for (let i = b.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const j = s % (i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

test("a re-sort: the head is right at once, the rest follows, and it ends on the new order", () => {
  const old = Array.from({ length: 50 }, (_, i) => row(`r${i}`, i));
  const target = [...old].reverse().map((r) => row(r.id, -r.v));
  const steps = walk(target, old, 12, 12);
  assert.equal(ids(steps[0].slice(0, 12)), ids(target.slice(0, 12)));
  // The first step keeps the other 38 rows drawn (still in the list), not torn down.
  assert.equal(steps[0].length, 50);
  assert.equal(ids(steps.at(-1)!), ids(target));
  assert.equal(steps.length, 5); // 12, 24, 36, 48, then all 50
});

test("every step: no row twice, only rows of the new list, never longer than it", () => {
  const base = Array.from({ length: 70 }, (_, i) => row(`r${i}`, i));
  for (let seed = 1; seed < 40; seed++) {
    const drawn = shuffle(base, seed).slice(0, 10 + (seed % 41));
    const target = shuffle(base, seed * 7).slice(0, seed % 3 === 0 ? 3 : 50);
    for (const s of walk(target, drawn, 1 + (seed % 15), 1 + (seed % 9))) {
      const k = s.map(key);
      assert.equal(new Set(k).size, k.length, "no row twice");
      const want = new Set(target.map(key));
      assert.ok(k.every((x) => want.has(x)), "only rows of the new list");
      assert.ok(s.length <= target.length);
    }
    assert.equal(ids(walk(target, drawn, 5, 5).at(-1)!), ids(target));
  }
});

test("a filter that leaves a few rows: they're all there in the first step, nothing else", () => {
  const old = Array.from({ length: 50 }, (_, i) => row(`r${i}`));
  const target = [old[40], old[3], old[17]];
  const [first] = walk(target, old, 12, 12);
  assert.equal(ids(first), ids(target));
});

test("rows the new list adds past the first step come in later; rows it drops go at once", () => {
  const old = [row("a"), row("b"), row("c"), row("d")];
  const target = [row("x"), row("a"), row("y"), row("c"), row("z")];
  const steps = walk(target, old, 2, 1);
  // First step: x, a (the head), then c (still listed, drawn before); b and d are gone.
  assert.equal(ids(steps[0]), "x,a,c");
  assert.equal(ids(steps.at(-1)!), "x,a,y,c,z");
});

test("an unchanged list doesn't redraw: the same array comes back", () => {
  const rows = [row("a"), row("b"), row("c")];
  assert.equal(stepRows(rows, rows, key, 1), rows);
  const copy = [...rows];
  assert.equal(stepRows(copy, rows, key, 10), rows);
  // New objects for the same rows (fresh figures): drawn anew.
  const fresh = rows.map((r) => row(r.id, 1));
  assert.equal(stepRows(fresh, rows, key, 10), fresh);
});

test("a list first drawn (nothing before): the first slice, then the rest", () => {
  const target = Array.from({ length: 30 }, (_, i) => row(`r${i}`));
  const steps = walk(target, [], 10, 8);
  assert.deepEqual(steps.map((s) => s.length), [10, 18, 26, 30]);
});

test("rows in view: from the list's top to the window's foot, at least the minimum", () => {
  assert.equal(rowsInView(600, 40, 1000, 8), 12); // 400 px of a 1000 px window: 10 rows, and 2 spare
  assert.equal(rowsInView(-400, 40, 1000, 8), 37); // scrolled 400 px into it: 35 rows down to the foot
  assert.equal(rowsInView(1200, 40, 1000, 8), 8); // below the window
  assert.equal(rowsInView(0, 0, 1000, 8), 8); // not laid out
  assert.equal(rowsInView(0, 40, 1000, 8, false), 8);
});
