// Kept-alive pages: a hidden page's heavy rows wait for it to be shown (or to catch up in idle
// time), and what it then shows is what the rows would be worked out fresh.
import { flush, effectRoot } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

const { whileShown, setShownPage, catchUp, shownPage } = await import("../src/lib/pane.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const internal = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T; render_effect: (f: () => void) => void };

/** A page's inputs, the app's tab, and a page that draws `rows` (its template, as an effect). */
function page(id: string) {
  const app = internal.proxy({ tab: id });
  const input = internal.proxy({ squad: 1, items: [3, 1, 2] });
  setShownPage(() => app.tab);
  let runs = 0;
  const work = () => {
    runs++;
    return input.items.map((x) => x * input.squad).sort((a, b) => a - b);
  };
  let rows!: () => number[];
  let drawn: number[] = [];
  let draws = 0;
  const stop = effectRoot(() => {
    rows = whileShown(id, work);
    internal.render_effect(() => {
      drawn = rows();
      draws++;
    });
  });
  flush();
  const fresh = () => input.items.map((x) => x * input.squad).sort((a, b) => a - b);
  return { app, input, rows, fresh, runs: () => runs, drawn: () => drawn, draws: () => draws, stop };
}

test("on screen, the rows follow every change, as before", () => {
  const p = page("relics");
  assert.deepEqual(p.drawn(), [1, 2, 3]);
  p.input.squad = 4;
  flush();
  assert.deepEqual(p.drawn(), p.fresh());
  assert.equal(p.runs(), 2);
  p.stop();
});

test("hidden, a change doesn't redo the rows or redraw the page; showing it does, once", () => {
  const p = page("inventory");
  const before = p.drawn();
  p.app.tab = "planner";
  flush();
  assert.equal(shownPage("inventory"), false);
  const runs = p.runs();
  const draws = p.draws();
  p.input.squad = 4;
  p.input.items = [5, 4];
  flush();
  assert.equal(p.runs(), runs, "no work while hidden");
  assert.equal(p.draws(), draws, "no redraw while hidden");
  assert.equal(p.drawn(), before, "still what it was drawn with");
  p.app.tab = "inventory";
  flush();
  assert.equal(p.runs(), runs + 1, "worked out once on show");
  assert.deepEqual(p.drawn(), p.fresh(), "the same rows as worked out fresh");
  p.stop();
});

test("hidden and shown again with nothing changed: no work, the same rows (no redraw)", () => {
  const p = page("mastery");
  const before = p.drawn();
  const runs = p.runs();
  const draws = p.draws();
  p.app.tab = "home";
  flush();
  p.app.tab = "mastery";
  flush();
  assert.equal(p.runs(), runs);
  assert.equal(p.drawn(), before);
  assert.equal(p.draws(), draws);
  p.stop();
});

test("a hidden page that catches up works out what changed, and only that once", () => {
  const p = page("parts");
  p.app.tab = "home";
  flush();
  p.input.squad = 2;
  flush();
  const runs = p.runs();
  catchUp("parts");
  flush();
  assert.equal(p.runs(), runs + 1);
  assert.deepEqual(p.drawn(), p.fresh());
  // Caught up: a later change while still hidden waits again, and catching up with nothing new does no work.
  p.input.squad = 3;
  flush();
  assert.equal(p.runs(), runs + 1);
  catchUp("parts");
  flush();
  assert.equal(p.runs(), runs + 2);
  catchUp("parts");
  flush();
  assert.equal(p.runs(), runs + 2, "nothing changed: nothing worked out");
  p.app.tab = "parts";
  flush();
  assert.equal(p.runs(), runs + 2, "already current when shown");
  assert.deepEqual(p.drawn(), p.fresh());
  p.stop();
});

test("a page opened in the background works its rows out at once", () => {
  const app = internal.proxy({ tab: "home" });
  setShownPage(() => app.tab);
  let rows!: () => number;
  const stop = effectRoot(() => {
    rows = whileShown("sets", () => 42);
  });
  assert.equal(rows(), 42);
  stop();
});

test("background work starts only in an idle period with room, a second after the last click", async () => {
  const { idleReady, QUIET_MS } = await import("../src/lib/pane.svelte");
  assert.equal(idleReady(40, QUIET_MS + 1), true);
  assert.equal(idleReady(40, 200), false, "just clicked: wait, another click may follow");
  assert.equal(idleReady(10, QUIET_MS + 1), false, "no room left in this idle period");
  assert.equal(idleReady(0, 0, 30, QUIET_MS, true), true, "the idle callback's own deadline passed");
  assert.equal(idleReady(40, QUIET_MS + 1, 30, QUIET_MS, false, true), false, "a row still closing up on screen: after it");
});

test("a hold (a sync) keeps background work back until it's released, and a timed-out idle callback too", async () => {
  const { idleReady, QUIET_MS, holdBackground, backgroundHeld, whenIdle } = await import("../src/lib/pane.svelte");
  assert.equal(idleReady(40, QUIET_MS + 1, 30, QUIET_MS, true, false, true), false, "held: not even past the deadline");
  const release = holdBackground();
  const again = holdBackground();
  assert.equal(backgroundHeld(), true);
  let ran = 0;
  whenIdle(() => ran++);
  const cancelled = whenIdle(() => ran += 100);
  cancelled();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ran, 0, "held: waits");
  release();
  release();
  assert.equal(backgroundHeld(), true, "one release each: the other hold still holds");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(ran, 0);
  again();
  assert.equal(backgroundHeld(), false);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(ran, 1, "runs once released; the cancelled one never");
});
