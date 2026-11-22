// A list's page scrolling holds background work (lists filling in or folding back out of sight,
// pages catching up) until the scroll has stopped: a slice of it landing in the middle of a scroll
// makes that frame late. What's drawn in sight is not held.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

const { inView, SCROLL_HOLD_MS } = await import("../src/lib/progress.svelte");
const { backgroundHeld, whenIdle } = await import("../src/lib/pane.svelte");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A list in a scrolling page, watched as Browse does; `scroll()` fires the page's scroll event. */
function list() {
  const listeners = new Map<string, () => void>();
  const page = { addEventListener: (t: string, f: () => void) => listeners.set(t, f), removeEventListener: (t: string) => listeners.delete(t) };
  const node = { closest: () => page } as unknown as HTMLElement;
  const view = inView(() => null);
  const watched = view.watch(node);
  return { scroll: () => listeners.get("scroll")?.(), stop: () => watched.destroy() };
}

/** No frames here: a scroll's measure waits for one that never comes, which these tests don't need. */
function withFrames<T>(f: () => Promise<T>): Promise<T> {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  return f().finally(() => (globalThis.requestAnimationFrame = raf));
}

test("a scroll holds background work until the page has stopped scrolling", () =>
  withFrames(async () => {
    const l = list();
    assert.equal(backgroundHeld(), false);
    l.scroll();
    assert.equal(backgroundHeld(), true, "held from the first scroll event");
    await sleep(SCROLL_HOLD_MS / 2);
    l.scroll();
    await sleep(SCROLL_HOLD_MS / 2);
    assert.equal(backgroundHeld(), true, "a scroll that goes on keeps it held");
    await sleep(SCROLL_HOLD_MS);
    assert.equal(backgroundHeld(), false, "released once the scroll has stopped");
    l.stop();
  }));

test("background work asked for during a scroll runs after it, not in it", () =>
  withFrames(async () => {
    const l = list();
    let ran = 0;
    l.scroll();
    whenIdle(() => ran++);
    // Scrolling on for longer than the background work would otherwise wait (300 ms, no idle time).
    for (let i = 0; i < 10; i++) {
      await sleep(50);
      l.scroll();
    }
    assert.equal(ran, 0, "nothing ran while the page scrolled");
    await sleep(SCROLL_HOLD_MS + 400);
    assert.equal(ran, 1, "it ran once the scroll had stopped");
    l.stop();
  }));
