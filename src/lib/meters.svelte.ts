// How meters move (design/motion.md rule 9): each meter remembers the value it last showed on
// screen (core/meterMemory.ts, kept in the settings with the other interface state). When its page
// opens, or its value changes while the page is open, a meter on screen whose value differs from
// that one steps from the old value to the new over SETTLE, one frame after the page has painted.
// Unchanged, never shown before, off screen, or with reduced motion on: it shows the new value at
// once. Each meter moves one layer per part, by transform only; past FRAME_BUDGET moving layers in
// one frame, the rest jump.
//
// Used by the two meters (ui/Segments.svelte, ui/Vessel.svelte) through `meterMotion`.
import { getContext, untrack } from "svelte";
import { calm, FRAME_BUDGET, moving, out, SETTLE } from "./motion";
import { shownPage } from "./pane.svelte";
import { PANE } from "./statusStrip.svelte";
import { moveFrom, recall, remember, type MeterMemory } from "./core/meterMemory";

/** App: where the memory is read from and saved to (Settings `meters`). */
export const meterBook: { read: () => MeterMemory; save: (m: MeterMemory) => void } = { read: () => [], save: () => {} };

/** Values shown since the last save, written in one go once the moves are over. */
const pending = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  flushTimer = null;
  if (!pending.size) return;
  const was = meterBook.read();
  const next = remember(was, pending);
  pending.clear();
  if (next !== was) meterBook.save(next);
}
function shown(key: string, value: number) {
  pending.set(key, value);
  // After the moves, in a task of its own: saving re-serializes the settings, which mustn't land
  // in the frame a move starts in (motion rule 5).
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, SETTLE + 120);
}
/** The value a meter last showed (one not saved yet included). */
export function lastShown(key: string): number | undefined {
  return pending.has(key) ? pending.get(key) : untrack(() => recall(meterBook.read(), key));
}

let spent = 0;
let resetQueued = false;
/** Whether `n` more layers may move this frame (FRAME_BUDGET in all). */
function takeMoves(n: number): boolean {
  if (!resetQueued) {
    resetQueued = true;
    requestAnimationFrame(() => ((spent = 0), (resetQueued = false)));
  }
  if (spent + n > FRAME_BUDGET) return false;
  spent += n;
  return true;
}

/**
 * Whether a meter is on screen, asked of one IntersectionObserver for all of them: it answers with
 * the next frame's layout, where reading a box (getBoundingClientRect) would lay the page out at
 * once, a page just shown included (132–206 ms on Arcanes' first visit). Each meter is watched only
 * from its question to the answer.
 */
const asking = new Map<Element, Set<(on: boolean) => void>>();
let watcher: IntersectionObserver | null = null;
/** Meters asked about whose first answer came before they were laid out. */
const unlaid = new WeakSet<Element>();
function answer(node: Element, on: boolean) {
  const waiting = asking.get(node);
  asking.delete(node);
  unlaid.delete(node);
  watcher?.unobserve(node);
  for (const f of waiting ?? []) f(on);
}
function onScreen(node: Element, reply: (on: boolean) => void): () => void {
  watcher ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      const waiting = asking.get(e.target);
      if (!waiting) continue;
      // Some of it inside the window and the page's scrolling box: a box of no size, or one only
      // touching the edge, isn't seen.
      const on = e.isIntersecting && e.intersectionRect.width > 0 && e.intersectionRect.height > 0;
      // No box at all: not laid out yet, inside a card that content-visibility still skips in the
      // first frame of a page just shown. The card is laid out in the next frame if it's near the
      // screen, and the observer answers again then; one that stays skipped is off screen.
      const box = e.boundingClientRect;
      if (!on && !box.width && !box.height && !unlaid.has(e.target)) {
        const target = e.target;
        unlaid.add(target);
        requestAnimationFrame(() => requestAnimationFrame(() => asking.get(target) === waiting && answer(target, false)));
        continue;
      }
      answer(e.target, on);
    }
  });
  const waiting = asking.get(node) ?? new Set<(on: boolean) => void>();
  if (!asking.has(node)) {
    asking.set(node, waiting);
    watcher.observe(node);
  }
  waiting.add(reply);
  return () => {
    waiting.delete(reply);
    if (waiting.size || asking.get(node) !== waiting) return;
    asking.delete(node);
    unlaid.delete(node);
    watcher?.unobserve(node);
  };
}

/**
 * Runs `f` with whether `node()` is on screen, one frame after the next paint: the question goes
 * in the frame after the page painted, and the observer answers after that frame's layout. With no
 * element, `f(false)` then. Returns a cancel.
 */
function afterPaint(node: () => Element | undefined, f: (on: boolean) => void): () => void {
  let unask: (() => void) | null = null;
  const id = requestAnimationFrame(() => {
    const el = node();
    if (!el) return f(false);
    unask = onScreen(el, f);
  });
  return () => {
    cancelAnimationFrame(id);
    unask?.();
  };
}

/** A layer's key in the memory: the meter's own for the first part, then key#1, key#2… */
export const layerKey = (key: string, i: number) => (i ? `${key}#${i}` : key);

export interface MeterMotion {
  /** The values drawn now, one a part (the last shown until a move or a jump sets the new ones). */
  readonly drawn: number[];
  /** The headline number beside the meter: ticks from the old value to the new along with a move. */
  readonly figure: number;
}

/**
 * The motion of one meter. Call while the component initializes.
 * - `read`: its key (null: not remembered, never moves) and the values of its parts now.
 * - `node`: the meter's element, to see whether it's on screen.
 * - `play(from, to)`: start the move (Web Animations on transform, SETTLE); returns the number of
 *   layers whose value changed. It's called only when the move may happen.
 */
export function meterMotion(read: () => { key: string | null; values: number[] }, node: () => Element | undefined, play: (from: number[], to: number[]) => void): MeterMotion {
  const pane = getContext<string | undefined>(PANE);
  const start = untrack(read);
  const first = start.key && !calm.current ? start.values.map((v, i) => lastShown(layerKey(start.key!, i)) ?? v) : start.values;
  let drawn = $state(first);
  let figure = $state(first[0] ?? 0);
  let tickFrame = 0;
  /** The values last settled on while the page was on screen, so a redraw with the same ones does nothing. */
  let settled: number[] | null = null;

  function tick(from: number, to: number) {
    cancelAnimationFrame(tickFrame);
    if (from === to) {
      figure = to;
      return;
    }
    let t0 = -1;
    tickFrame = requestAnimationFrame(function step(now) {
      if (t0 < 0) t0 = now;
      const t = Math.min(1, (now - t0) / SETTLE);
      figure = t >= 1 ? to : from + (to - from) * out(t);
      if (t < 1) tickFrame = requestAnimationFrame(step);
    });
  }

  $effect(() => {
    const { key, values } = read();
    const visible = pane ? shownPage(pane) : true;
    // Hidden with its page: it keeps what it showed, to move from when the page opens again.
    if (!visible) {
      settled = null;
      return;
    }
    const to = [...values];
    if (settled && settled.length === to.length && settled.every((v, i) => v === to[i])) return;
    return afterPaint(node, (on) => {
      settled = to;
      const was = untrack(() => drawn);
      if (!key || !on) {
        // Not remembered, or off screen: the new value, no motion, nothing remembered.
        drawn = to;
        tick(to[0] ?? 0, to[0] ?? 0);
        return;
      }
      const from = to.map((v, i) => moveFrom(lastShown(layerKey(key, i)), v) ?? v);
      to.forEach((v, i) => shown(layerKey(key, i), v));
      const differs = from.some((f, i) => f !== to[i]);
      if (!differs) {
        if (was.some((w, i) => w !== to[i])) drawn = to;
        tick(to[0] ?? 0, to[0] ?? 0);
        return;
      }
      if (calm.current || !takeMoves(from.filter((f, i) => f !== to[i]).length)) {
        drawn = to;
        tick(to[0] ?? 0, to[0] ?? 0);
        return;
      }
      moving(SETTLE);
      play(from, to);
      drawn = to;
      tick(from[0] ?? 0, to[0] ?? 0);
    });
  });
  $effect(() => () => cancelAnimationFrame(tickFrame));

  return {
    get drawn() {
      return drawn;
    },
    get figure() {
      return figure;
    },
  };
}
