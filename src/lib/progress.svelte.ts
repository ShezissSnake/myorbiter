// Long lists (tables, card grids) redraw a slice at a time: the rows in sight at once, the rest a few
// a frame after (core/progress.ts says which rows each step draws). A click that re-sorts fifty rows
// then waits only for the dozen on screen.
import { untrack } from "svelte";
import { rowsInView, settled, stepRows } from "./core/progress";

/**
 * How many of a list's items fill the window, kept up to date as the page scrolls and as the list
 * is first drawn (measured when the layout is fresh, never in the middle of a redraw: reading the
 * layout costs a lot when it isn't). `box()`: the element whose children are the items (a tbody, a
 * grid). Until it's drawn and in sight: a guess, `guess` px an item.
 */
export function inView(box: () => HTMLElement | null, { min = 8, guess = 44 }: { min?: number; guess?: number } = {}) {
  let measured = false;
  let count = typeof window === "undefined" ? min : Math.max(min, Math.ceil(window.innerHeight / guess) + 2);
  /** Once after the list is first drawn (`always`: on every scroll); after that, as you scroll. */
  function measure(always = false) {
    if (measured && !always) return;
    const el = box();
    if (!el || typeof window === "undefined") return;
    // On a page or a view out of sight (kept drawn but not laid out): reading its layout would lay
    // it out just for this, the slowest thing here. Measured once it's shown.
    if (el.closest(".pane:not(.shown), .off")) return;
    const kids = el.children;
    if (!kids.length) return;
    const a = kids[0].getBoundingClientRect();
    // Items side by side (a grid): those on the first item's line.
    let cols = 1;
    let next: DOMRect | null = null;
    for (let i = 1; i < kids.length && i < 16; i++) {
      const r = kids[i].getBoundingClientRect();
      if (Math.abs(r.top - a.top) < 2) cols++;
      else {
        next = r;
        break;
      }
    }
    // Not laid out (on a hidden page or tab): keep the guess, and look again next time.
    if (!(a.height > 0)) return;
    const h = next ? next.top - a.top : a.height;
    measured = true;
    count = rowsInView(a.top, h, window.innerHeight, Math.ceil(min / cols)) * cols;
  }
  let scrollFrame = 0;
  const onScroll = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => ((scrollFrame = 0), measure(true)));
  };
  /** The action for the list's scrolling page: <div use:watch> on any element inside it. */
  function watch(node: HTMLElement) {
    const page = node.closest<HTMLElement>(".page") ?? window;
    page.addEventListener("scroll", onScroll, { passive: true });
    return { destroy: () => page.removeEventListener("scroll", onScroll) };
  }
  return { count: () => count, measure, watch };
}

let quietly = false;
/** Rows a list drawn in the background (a page or a view out of sight) draws at first. */
const BACKGROUND_FIRST = 6;
/**
 * Runs `f` as background work: a list it draws or redraws in this task (a page opened out of sight,
 * a hidden page catching up) draws only a few rows now and the rest a slice a frame, since nobody
 * is looking at it yet. The page drawn in one slice of idle time then costs a fraction.
 */
export function inBackground(f: () => void) {
  quietly = true;
  try {
    f();
  } finally {
    // The drawing itself happens in this task's microtasks (Svelte's flush, a page's module).
    setTimeout(() => (quietly = false), 0);
  }
}

/**
 * `target()` drawn a slice at a time: when it changes, its first `first()` items at once, then
 * `step` more a slice (each once the last was drawn, see `later`), until all are. `measure` runs just
 * before each later step, while the layout is fresh. Use as
 *   const drawn = $derived.by(progressive(() => sorted.slice(0, shown), key, { first: view.count, measure: view.measure }));
 * Call while a component initializes.
 */
export function progressive<T>(
  target: () => readonly T[],
  key: (r: T) => string,
  { first, step = 12, measure }: { first: () => number; step?: number; measure?: () => void },
): () => readonly T[] {
  const now = () => (quietly ? Math.min(BACKGROUND_FIRST, first()) : first());
  let drawn = $state.raw<readonly T[]>(untrack(() => target().slice(0, now())));
  let frame = 0;
  let idle = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    if (idle) window.cancelIdleCallback(idle);
    clearTimeout(timer);
    frame = idle = 0;
  };
  /**
   * `f` once the step before has been drawn: in the next idle moment with a little room, so the
   * rows below the screen give way to what's moving on it (a figure rolling, a row closing up),
   * or within 150 ms anyway. Where there's no requestIdleCallback (WebKitGTK): the next frame,
   * then a task.
   */
  const later = (f: () => void) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const due = performance.now() + 150;
      const ask = () =>
        (idle = window.requestIdleCallback(
          (d) => {
            idle = 0;
            if (d.didTimeout || d.timeRemaining() >= 8 || performance.now() >= due) f();
            else ask();
          },
          { timeout: Math.max(1, due - performance.now()) },
        ));
      ask();
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      timer = setTimeout(f, 0);
    });
  };
  $effect.pre(() => {
    const t = target();
    untrack(() => {
      stop();
      let upto = now();
      drawn = stepRows(t, drawn, key, upto);
      const next = () => {
        measure?.();
        upto = Math.max(upto + step, first());
        drawn = stepRows(t, drawn, key, upto);
        if (!settled(t, drawn)) later(next);
      };
      if (!settled(t, drawn)) later(next);
    });
    return stop;
  });
  return () => drawn;
}
