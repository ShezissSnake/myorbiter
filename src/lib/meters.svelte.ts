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

/** Whether any of the element is inside the window. */
function onScreen(node: Element): boolean {
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

/** Runs `f` one frame after the next paint; returns a cancel. */
function afterPaint(f: () => void): () => void {
  let id = requestAnimationFrame(() => (id = requestAnimationFrame(f)));
  return () => cancelAnimationFrame(id);
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
    return afterPaint(() => {
      settled = to;
      const el = node();
      const was = untrack(() => drawn);
      if (!key || !el || !onScreen(el)) {
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
