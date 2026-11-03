// The motion kit: how orbiter moves, one contract for every page.
//
// - Motion answers a click; it never decorates. No hover motion on cards, nothing on page load:
//   only something leaving, arriving, ticking off, opening or being confirmed.
// - Three durations and one easing, the same as the CSS tokens in app.css:
//   SNAP (--snap, 90 ms) presses, ticks, pops; QUICK (--quick, 160 ms) folds, chevrons, crossfades,
//   counts; SETTLE (--settle, 240 ms) list close-ups (flip) and sheets. Easing `out` (--out).
// - Cheap: transform and opacity only (grid-template-rows for folds). Never width, height or top.
// - Reduced motion (`calm`, live): every duration here goes to 0, and the end state still shows
//   (the check is drawn at once, the row just leaves).
//
// Every helper is safe with `|global` (a parent block's condition, as the item sheet's): arrivals
// and leavings past ~40 in one frame (a whole list or page mounting, or going) skip their motion,
// and arrivals only move in answer to a click or key, never on load or a background refresh.

import { MediaQuery } from "svelte/reactivity";
import { flip as svelteFlip } from "svelte/animate";
import type { AnimationConfig, FlipParams } from "svelte/animate";
import type { TransitionConfig } from "svelte/transition";

export const SNAP = 90;
export const QUICK = 160;
export const SETTLE = 240;
/** --out as CSS, for the Web Animations API. */
export const OUT_CSS = "cubic-bezier(.2,.8,.2,1)";

/** A cubic-bezier easing as a function of t (0..1), as CSS draws it. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton first (fast, nearly always enough), then halving where the slope is flat.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const e = x(s) - t;
      if (Math.abs(e) < 1e-6) return y(s);
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0, hi = 1;
    s = t;
    for (let i = 0; i < 30; i++) {
      const v = x(s);
      if (Math.abs(v - t) < 1e-6) break;
      if (v < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}
/** The one easing (--out): quick off the mark, settling softly. */
export const out = bezier(0.2, 0.8, 0.2, 1);

/** Reduced motion, live: `calm.current` is true while the system asks for less motion. */
export const calm = new MediaQuery("(prefers-reduced-motion: reduce)", false);
/** A duration, or 0 under reduced motion. */
export const ms = (d: number) => (calm.current ? 0 : d);

// ---------------------------------------------------------------- guards

let lastInput = -Infinity;
if (typeof window !== "undefined") {
  const mark = () => (lastInput = performance.now());
  window.addEventListener("pointerdown", mark, { capture: true, passive: true });
  window.addEventListener("keydown", mark, { capture: true, passive: true });
}
/** Whether a click or a key came in just now: arrivals move only in answer to one. */
export const answering = () => typeof performance !== "undefined" && performance.now() - lastInput < 800;

/** At most this many elements move in one frame; past it (a whole list arriving or going), the rest don't. */
export const FRAME_BUDGET = 40;
let spent = 0;
let resetQueued = false;
function spend(): boolean {
  if (!resetQueued) {
    resetQueued = true;
    const reset = () => ((spent = 0), (resetQueued = false));
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(reset);
    else setTimeout(reset, 16);
  }
  return ++spent <= FRAME_BUDGET;
}

const NONE: TransitionConfig = { duration: 0 };

// ---------------------------------------------------------------- transitions

/**
 * Something arriving: fades in from a few px lower (`y`; 0 for a plain crossfade). QUICK.
 *   {#each rows as r (r.id)}<li in:arrive animate:flip>…</li>{/each}
 *   <ul in:arrive={{ y: 0 }}>     (a view swapped in)
 * Only after a click or key (`always: true` for one that should move regardless, as a toast).
 */
export function arrive(node: Element, { y = 6, duration = QUICK, delay = 0, always = false }: { y?: number; duration?: number; delay?: number; always?: boolean } = {}): TransitionConfig {
  if (calm.current || (!always && !answering()) || !spend()) return NONE;
  return { delay, duration, easing: out, css: (t, u) => `opacity:${t};transform:translateY(${(u * y).toFixed(2)}px)` };
}

/**
 * Something leaving: fades with a slight lift. In a keyed list, pair it with `flip` so the rows
 * below close up as it goes (Svelte takes the leaving row out of the flow while it fades):
 *   {#each rows as r (r.id)}<tr out:leave animate:flip>…</tr>{/each}
 * Outside a list, wrap it in a fold to close the gap: <div class="reveal" out:reveal><div>…</div></div>.
 */
export function leave(node: Element, { y = -4, duration = QUICK, delay = 0 }: { y?: number; duration?: number; delay?: number } = {}): TransitionConfig {
  if (calm.current || !spend()) return NONE;
  keepColumns(node);
  return { delay, duration, easing: out, css: (t, u) => `opacity:${t};transform:translateY(${(u * y).toFixed(2)}px)` };
}

/**
 * A table row taken out of the flow while it leaves (flip's close-up) is laid out on its own, so
 * its cells would shrink to their contents and the row squash as it fades. Keeps each cell at its
 * column's width, read from a row still in the table with as many cells.
 */
function keepColumns(node: Element) {
  if (typeof HTMLTableRowElement === "undefined" || !(node instanceof HTMLTableRowElement)) return;
  const ref = [...(node.closest("table")?.rows ?? [])].find((r) => r !== node && r.cells.length === node.cells.length && r.parentElement?.tagName !== "THEAD" && getComputedStyle(r).position !== "absolute")
    ?? node.closest("table")?.tHead?.rows[0];
  if (!ref || ref.cells.length !== node.cells.length) return;
  const widths = [...ref.cells].map((c) => c.getBoundingClientRect().width);
  node.style.display = "table";
  node.style.tableLayout = "fixed";
  [...node.cells].forEach((c, i) => {
    c.style.boxSizing = "border-box";
    c.style.width = `${widths[i]}px`;
  });
}

/**
 * A fold opening or closing: its height runs 0 → full on grid rows (0fr → 1fr), fading in. QUICK.
 * Put it on a wrapper with exactly one child (class="reveal" lays it out):
 *   {#if open}<div class="reveal" transition:reveal><div class="body">…</div></div>{/if}
 * For a body that stays mounted while folded (hidden, not removed), use `use:fold={open}` instead.
 */
export function reveal(node: Element, { duration = QUICK, always = false }: { duration?: number; always?: boolean } = {}): TransitionConfig {
  node.classList.add("reveal");
  if (calm.current || (!always && !answering()) || !spend()) return NONE;
  return { duration, easing: out, css: (t) => `grid-template-rows:${t.toFixed(4)}fr;opacity:${Math.min(1, t * 1.6).toFixed(3)};overflow:hidden` };
}

/**
 * Dialogs (Sell, Buy, Find anything) and confirm rows: in, fades up from .98 over 120 ms; out, 100 ms.
 * Use in: and out: separately (the two run at different speeds). A dialog inside a fading `shade`
 * takes its opacity from the shade (fade: false), so the two don't multiply into a slow fade:
 *   <div class="scrim" in:shade|global out:shade|global><div class="dialog" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }}>
 *   <button in:opens>Remove all</button>     (a confirm row's controls)
 */
export function opens(node: Element, { scale = 0.98, fade = true }: { scale?: number; fade?: boolean } = {}, opts?: { direction?: "in" | "out" | "both" }): TransitionConfig {
  if (calm.current) return NONE;
  const duration = opts?.direction === "out" ? 100 : 120;
  return { duration, easing: out, css: (t) => `${fade ? `opacity:${t};` : ""}transform:scale(${(scale + (1 - scale) * t).toFixed(4)})` };
}

/** The shade behind a dialog or sheet: fades. Pair it with the dialog's own in:/out:. */
export function shade(node: Element, { duration = 120 }: { duration?: number } = {}, opts?: { direction?: "in" | "out" | "both" }): TransitionConfig {
  if (calm.current) return NONE;
  return { duration: opts?.direction === "out" ? 100 : duration, easing: out, css: (t) => `opacity:${t}` };
}

/**
 * Rows closing up or reordering: Svelte's flip over SETTLE with --out. Rows off screen before and
 * after don't move, and no more than ~40 move in a frame (a big grid snaps rather than crawls).
 *   import { flip } from "../motion";   {#each rows as r (r.id)}<li animate:flip>…</li>{/each}
 */
export function flip(node: Element, rects: { from: DOMRect; to: DOMRect }, params: FlipParams = {}): AnimationConfig {
  const vh = typeof innerHeight === "number" ? innerHeight : 1e9;
  const off = (r: DOMRect) => r.bottom < 0 || r.top > vh;
  if (calm.current || (off(rects.from) && off(rects.to)) || !spend()) return { duration: 0 };
  // Moves only, never scales: Svelte's flip also stretches an item whose size changed in the same
  // update (a row growing a status line, a row turning into its one-line ghost), which squashes
  // its text for the whole close-up. Measured from the top left, where rows and cards stack from.
  const from = new DOMRect(rects.from.left, rects.from.top, rects.to.width, rects.to.height);
  return svelteFlip(node, { from, to: rects.to }, { duration: SETTLE, easing: out, ...params });
}

// ---------------------------------------------------------------- actions

/** Replays a CSS animation keyed on a data attribute (a/b alternate, so it restarts with no reflow). */
const timers = new WeakMap<HTMLElement, Map<string, ReturnType<typeof setTimeout>>>();
function replay(node: HTMLElement, attr: string, dur: number) {
  const k = node.dataset[attr] === "a" ? "b" : "a";
  node.dataset[attr] = k;
  const mine = timers.get(node) ?? new Map<string, ReturnType<typeof setTimeout>>();
  timers.set(node, mine);
  clearTimeout(mine.get(attr));
  mine.set(attr, setTimeout(() => {
    if (node.dataset[attr] === k) delete node.dataset[attr];
    mine.delete(attr);
  }, dur + 50));
}

/**
 * Done, with nothing else on screen to show it: a brief gold ring on the control (2 × SETTLE; a
 * colour, so it shows under reduced motion too).
 *   <button use:confirm={savedAt}>Save</button>   pulses each time savedAt changes to something truthy
 * Or by hand: pulse(button).
 */
export function confirm(node: HTMLElement, when?: unknown) {
  let last = when;
  return {
    update(v: unknown) {
      if (v === last) return;
      last = v;
      if (v) pulse(node);
    },
  };
}
export const pulse = (node: HTMLElement) => replay(node, "confirm", SETTLE * 2);

/**
 * A pop (1 → 1.25 → 1 over SNAP) when something turns on: the wishlist star. Nothing on mount,
 * nothing when it turns off, nothing under reduced motion (the state itself shows).
 *   <button use:pop={fav}>   or, where the same button shows different items, use:pop={{ on: fav, of: item.id }}
 */
export function pop(node: HTMLElement, v: boolean | { on: boolean; of?: unknown }) {
  const read = (x: typeof v) => (typeof x === "boolean" ? { on: x, of: undefined } : { on: x.on, of: x.of });
  let last = read(v);
  return {
    update(next: typeof v) {
      const n = read(next);
      if (n.on && !last.on && n.of === last.of && !calm.current) replay(node, "pop", SNAP);
      last = n;
    },
  };
}

/**
 * Just opened, for CSS to answer: data-fresh is on the node for QUICK when `on` turns true (never
 * on mount, so a page shown again doesn't replay it). For a fold drawn by CSS rather than {#if}:
 *   <section class:open use:fresh={open}>   .x[data-fresh] .line { animation: … var(--quick) var(--out); }
 */
export function fresh(node: HTMLElement, on: boolean) {
  let last = on;
  return {
    update(v: boolean) {
      if (v && !last && !calm.current) replay(node, "fresh", QUICK);
      last = v;
    },
  };
}

/**
 * A body that stays mounted while folded (it keeps its state, hidden): opens and closes on grid
 * rows over QUICK, then hides. One child inside, as with `reveal`:
 *   <div id="body" class="reveal" use:fold={open}><div>…</div></div>
 */
export function fold(node: HTMLElement, open: boolean) {
  node.classList.add("reveal");
  node.hidden = !open;
  let anim: Animation | null = null;
  const set = (o: boolean) => {
    anim?.cancel();
    anim = null;
    if (calm.current || typeof node.animate !== "function") {
      node.hidden = !o;
      return;
    }
    node.hidden = false;
    const frames = [{ gridTemplateRows: "0fr", opacity: 0 }, { gridTemplateRows: "1fr", opacity: 1 }];
    node.style.overflow = "hidden";
    const a = node.animate(o ? frames : frames.reverse(), { duration: QUICK, easing: OUT_CSS });
    anim = a;
    a.onfinish = () => {
      if (anim !== a) return;
      anim = null;
      node.style.overflow = "";
      node.hidden = !o;
    };
  };
  let last = open;
  return {
    update(o: boolean) {
      if (o !== last) set((last = o));
    },
    destroy() {
      anim?.cancel();
    },
  };
}
