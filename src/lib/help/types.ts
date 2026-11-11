// The shape of the in-place help: walk-throughs of a few pages, each page one idea, a picture of
// a piece of the screen with what matters marked and a few words beside it. The list lives in
// ./index.ts; the "?" control (ui/HelpMark.svelte) opens the one that covers its part, at
// the page about that part. Plain TypeScript, no Svelte: the tests and the picture script
// (scripts/screenshots.mjs --only help) read it too.

import type { PageId } from "../pages";

/**
 * A step that brings the demo to the state a picture shows. Selectors are Playwright's (CSS, plus
 * `:has-text()`); the part and the marks are plain CSS. Steps never press anything that writes.
 */
export type Step =
  /** Click the first element that matches (it must exist). */
  | { click: string }
  /** Type into a field. */
  | { fill: string; text: string }
  /** Press a key ("Escape", "Enter"). */
  | { press: string }
  /** Wait this many milliseconds (an order book read, a fold opening). */
  | { wait: number };

/**
 * A mark drawn on a picture: a numbered marker beside the element (keyed to the page's lines,
 * 1 to 4), an arrow pointing at it, or an outline round it with the rest of the picture dimmed.
 */
export interface Mark {
  at: string;
  is: "n" | "arrow" | "outline";
  /** The number, for `n`. */
  n?: number;
  /** Where the marker or the arrow sits, from the element: left by default; "corner" puts a number on its top-left corner, with no leader. */
  from?: "left" | "right" | "top" | "bottom" | "corner";
}

/** How a page's picture is taken: where, after which clicks, which piece, with which marks. */
export interface Shot {
  /** The app page to open first; "settings" opens the Settings panel. */
  open: PageId | "settings";
  steps?: Step[];
  /** The piece of the screen to crop (every match together), with a little room round it. */
  part: string;
  marks: Mark[];
  /** The window the picture is taken in, CSS pixels; 1280×800 unless given. */
  size?: [number, number];
  /**
   * A dialog that only opens as MyOrbiter starts: "first-run", the first start's Full mode question,
   * not asked yet. The picture is taken in a window of its own, of that dialog as it opens, with no
   * answer given; `open` and `steps` are not used.
   */
  startup?: "first-run";
}

/** One page of a walk-through: one idea. */
export interface HelpPage {
  /** At most six words. */
  title: string;
  /** Up to four lines of at most 16 words; with numbered marks, line i is about mark i + 1, and lines past the last number are plain. */
  lines: string[];
  /** Its picture (the tests and the sweep fail on a page without one). */
  shot?: Shot;
}

export interface Walkthrough {
  id: string;
  /** The app page it belongs to, or "shared" for a panel every page has. */
  app: PageId | "shared";
  title: string;
  /** Where "More in the Guide" goes: the Guide's entry for that page (goTo target). */
  guide: string;
  pages: HelpPage[];
  /** A rule or warning the player relies on, on the last page. `warn` shows the state diamond in red. */
  good?: { text: string; warn?: boolean };
  /** Each part this walk-through covers (the "?" controls' part ids), with the page about it (1-based). */
  covers: Record<string, number>;
}
