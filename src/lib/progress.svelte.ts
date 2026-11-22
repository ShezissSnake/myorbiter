// Long lists (tables, card grids) redraw a slice at a time: the rows in sight at once, the rest a few
// a frame after (core/progress.ts says which rows each step draws). A click that re-sorts fifty rows
// then waits only for the dozen on screen.
import { untrack } from "svelte";
import { drawnHead, itemsToFoot, rowsFor, rowsInView, settled, sightRows, stepRows } from "./core/progress";
import { holdBackground, whenIdle } from "./pane.svelte";
import { stillMoving } from "./motion";

/** A page's scroll holds background work until this long after its last scroll event (ms). */
export const SCROLL_HOLD_MS = 150;
let scrollRelease: (() => void) | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * A list's page is scrolling: background work (lists filling in or folding back out of sight,
 * pages catching up; pane.svelte.ts, `holdBackground`) waits until it has stopped, so none of it
 * lands in a frame of the scroll. Drawing ahead in sight goes on: it doesn't wait for idle time.
 */
function holdWhileScrolling() {
  scrollRelease ??= holdBackground();
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const release = scrollRelease;
    scrollRelease = null;
    release?.();
  }, SCROLL_HOLD_MS);
}

/**
 * How many of a list's items fill the window, kept up to date as the page scrolls and as the list
 * is first drawn (measured when the layout is fresh, never in the middle of a redraw: reading the
 * layout costs a lot when it isn't). `box()`: the element whose children are the items (a tbody, a
 * grid). Until it's drawn and in sight: a guess, `guess` px an item. `exact`: counted to the
 * first item below the window rather than worked out from the first row's height (a grid of cards,
 * whose rows differ), with `spare` rows past the window's foot. `measured`: called after each
 * measure, told whether a scroll of the page asked for it.
 */
export function inView(
  box: () => HTMLElement | null,
  {
    min = 8,
    guess = 44,
    exact = false,
    spare = 2,
    measured: after,
  }: { min?: number; guess?: number; exact?: boolean; spare?: number; measured?: (scrolled: boolean) => void } = {},
) {
  let measured = false;
  let count = typeof window === "undefined" ? min : Math.max(min, Math.ceil(window.innerHeight / guess) + 2);
  /** Items a row, and a row's height (px): a guess until measured. */
  let perRow = 1;
  let rowHeight = guess;
  /** Once after the list is first drawn (`always`: on every scroll); after that, as you scroll (`scrolled`). */
  function measure(always = false, scrolled = false) {
    if (measured && !always) return;
    const el = box();
    if (!el || typeof window === "undefined") return;
    // On a page or a view out of sight (kept drawn but not laid out): reading its layout would lay
    // it out just for this, the slowest thing here. Measured once it's shown.
    if (hidden()) return;
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
    perRow = cols;
    rowHeight = h;
    const vh = window.innerHeight;
    if (exact && a.top < vh) {
      // Far down a grid the first row's height says little (cards differ, and those not laid out
      // yet are guessed): the first item below the window's foot, found by halving the list.
      let lo = 0;
      let hi = kids.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (kids[m].getBoundingClientRect().top >= vh) hi = m;
        else lo = m + 1;
      }
      count = itemsToFoot(lo, cols, Math.ceil(min / cols), spare);
    } else count = rowsInView(a.top, h, vh, Math.ceil(min / cols)) * cols;
    after?.(scrolled);
    for (const f of measuredFns) f();
  }
  const measuredFns = new Set<() => void>();
  let scrollFrame = 0;
  const onScroll = () => {
    holdWhileScrolling();
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => ((scrollFrame = 0), measure(true, true)));
  };
  const wakers = new Set<() => void>();
  /**
   * The action for the list (any element of it, in its scrolling page): follows the page's scroll,
   * and tells `onShow`'s callbacks when the list comes into sight (its page or view shown again).
   */
  function watch(node: HTMLElement) {
    const page = node.closest<HTMLElement>(".page") ?? window;
    page.addEventListener("scroll", onScroll, { passive: true });
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) for (const f of wakers) f();
    });
    io?.observe(node);
    return {
      destroy: () => {
        page.removeEventListener("scroll", onScroll);
        io?.disconnect();
      },
    };
  }
  /** Whether the list is out of sight: on a hidden page, or a view kept drawn but not shown. */
  const hidden = () => !!box()?.closest(".pane:not(.shown), .off");
  /** Calls `f` each time the list comes into sight; returns a stop. */
  const onShow = (f: () => void) => (wakers.add(f), () => void wakers.delete(f));
  /** Calls `f` after each measure (the count may have changed); returns a stop. */
  const onMeasure = (f: () => void) => (measuredFns.add(f), () => void measuredFns.delete(f));
  /** Items a screen holds (whole rows), as last measured. */
  const screenful = () => (typeof window === "undefined" ? min : Math.max(1, Math.ceil(window.innerHeight / Math.max(1, rowHeight))) * perRow);
  return { count: () => count, perRow: () => perRow, screenful, measure, watch, hidden, onShow, onMeasure };
}

let quietly = false;
/** Rows a list drawn in the background (a page or a view out of sight) draws at first. */
const BACKGROUND_FIRST = 6;
/**
 * How long a slice of rows drawn out of sight may take (ms). A click can land on one: it waits for
 * the slice to finish. On a slow machine a dozen rich rows take a lot longer than on a fast one, so
 * each list sizes its next slice by how long the last took (core/progress.ts, `rowsFor`).
 */
const BACKGROUND_BUDGET_MS = 12;
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
 * `step` more a slice (each once the last was drawn, see `later`; fewer where there's no idle time
 * and the frames run long, see `sightStep`), until all are. `measure` runs just
 * before each later step, while the layout is fresh. Use as
 *   const drawn = $derived.by(progressive(() => sorted.slice(0, shown), key, { first: view.count, measure: view.measure }));
 * Call while a component initializes.
 */
export function progressive<T>(
  target: () => readonly T[],
  key: (r: T) => string,
  {
    first,
    step = 12,
    measure,
    hidden,
    onShow,
    onMeasure,
  }: {
    first: () => number;
    step?: number;
    measure?: () => void;
    hidden?: () => boolean;
    onShow?: (f: () => void) => () => void;
    /** Tells when `first()` was measured again (inView's `onMeasure`): a scroll past the rows drawn hurries the next slice. */
    onMeasure?: (f: () => void) => () => void;
  },
): () => readonly T[] {
  // Out of sight (drawn in the background, or on a hidden page or view): a few rows now, the rest
  // when the app is idle and nobody's clicking (pane.svelte.ts, whenIdle), never in the middle of
  // something moving on screen.
  const away = () => quietly || !!hidden?.();
  const now = () => (away() ? Math.min(BACKGROUND_FIRST, first()) : first());
  let drawn = $state.raw<readonly T[]>(untrack(() => target().slice(0, now())));
  let frame = 0;
  let idle = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The next slice, while it waits (for idle time, a frame or a task). */
  let pending: (() => void) | null = null;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    if (idle) window.cancelIdleCallback(idle);
    clearTimeout(timer);
    unidle?.();
    unidle = waiting = pending = null;
    frame = idle = 0;
  };
  /** Rows in sight not drawn yet: a scroll reached the end of what's drawn. */
  const short = () => !away() && drawn.length < first();
  // Scrolled past the rows drawn (a fling, a drag of the scroll bar) while the next slice waits for
  // idle time, which a scroll may not leave until it stops: that slice now, in the frame the scroll
  // was measured in (before it's painted), not a frame later.
  if (onMeasure)
    $effect(() =>
      onMeasure(() => {
        const f = pending;
        if (!f || !short()) return;
        stop();
        f();
      }),
    );
  // Shown again with slices still waiting for idle time: they come now, as for a list in sight.
  if (onShow)
    $effect(() =>
      onShow(() => {
        const f = waiting;
        if (!f || away()) return;
        unidle?.();
        unidle = waiting = null;
        later(f);
      }),
    );
  /**
   * `f` once the step before has been drawn: in the next idle moment with a little room, so the
   * rows below the screen give way to what's moving on it (a figure rolling, a row closing up),
   * or within 250 ms anyway (a figure rolls for 160). Where there's no requestIdleCallback
   * (WebKitGTK): the next frame, then a task.
   */
  let unidle: (() => void) | null = null;
  /** A slice waiting for idle time while out of sight. */
  let waiting: (() => void) | null = null;
  /** Rows a slice out of sight draws: sized by how long the last one took (`BACKGROUND_BUDGET_MS`). */
  let awayStep = step;
  /**
   * Rows a slice in sight draws where there's no idle time to wait for (a slice a frame): sized by
   * how long the frame after the last one took (core/progress.ts, `sightRows`), so a slow webview
   * draws fewer a frame rather than stalling the scroll. The frame the last slice went in, and its rows.
   */
  let sightStep = step;
  let sliceAt = 0;
  let sliceRows = 0;
  const later = (g: () => void) => {
    pending = g;
    const f = () => ((pending = null), g());
    if (away()) {
      waiting = f;
      unidle = whenIdle(() => {
        unidle = waiting = null;
        const t0 = performance.now();
        const rows = awayStep;
        f();
        // The slice's drawing happens in this task's microtasks (Svelte's flush), queued before these.
        queueMicrotask(() => queueMicrotask(() => (awayStep = rowsFor(performance.now() - t0, rows, BACKGROUND_BUDGET_MS, step, awayStep))));
      });
      return;
    }
    // Rows in sight still to draw: in the next frame, before it's painted, not in idle time.
    if (short()) {
      frame = requestAnimationFrame(() => ((frame = 0), f()));
      return;
    }
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const due = performance.now() + 250;
      const ask = () =>
        (idle = window.requestIdleCallback(
          (d) => {
            idle = 0;
            if (d.didTimeout || (d.timeRemaining() >= 8 && !stillMoving()) || performance.now() >= due) f();
            else ask();
          },
          { timeout: Math.max(1, due - performance.now()) },
        ));
      ask();
      return;
    }
    frame = requestAnimationFrame((at) => {
      frame = 0;
      if (sliceAt) sightStep = sightRows(at - sliceAt, sliceRows, sightStep, step);
      sliceAt = at;
      timer = setTimeout(f, 0);
    });
  };
  /** Whether slices in sight wait for idle time (requestIdleCallback), which leaves the frame room. */
  const idleTime = () => typeof window !== "undefined" && "requestIdleCallback" in window;
  /** The list being drawn toward, and how far its slices have come. */
  let cur: readonly T[] = drawn;
  let upto = 0;
  const next = () => {
    measure?.();
    // Out of sight: a slice that fits the budget, never a whole screenful at once. In sight: the
    // rows on the screen at least (a scroll past what's drawn).
    const from = upto;
    upto = away() ? upto + awayStep : Math.max(upto + (idleTime() ? step : sightStep), first());
    sliceRows = upto - from;
    drawn = stepRows(cur, drawn, key, upto);
    if (!settled(cur, drawn)) later(next);
  };
  $effect.pre(() => {
    const t = target();
    untrack(() => {
      // A list that only grew (more of the same rows below): on from the rows already drawn. With a
      // slice waiting, that slice goes on toward the longer list; started again, it would wait
      // anew each time the list grows (each frame of a scroll that draws ahead) and never come.
      const head = drawnHead(t, drawn);
      if (pending && head === drawn.length) {
        cur = t;
        return;
      }
      stop();
      cur = t;
      upto = Math.max(now(), head);
      drawn = stepRows(t, drawn, key, upto);
      if (!settled(t, drawn)) later(next);
    });
  });
  // Gone: nothing more to draw.
  $effect(() => stop);
  return () => drawn;
}
