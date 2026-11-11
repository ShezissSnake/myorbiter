// Which walk-through is open, and at which page. A part's "?" (ui/HelpMark.svelte) opens it; the
// one dialog (ui/HelpDialog.svelte) shows it over the content area. Closing gives the keyboard
// back to the "?" that opened it.

import { forPart, walkthroughById, type Walkthrough } from "./index";

/** Something that can take the focus back: the "?" pressed. */
type Opener = { focus: (o?: FocusOptions) => void; isConnected?: boolean } | null;

class Help {
  /** The open walk-through's id, or null when the help is closed. */
  id = $state<string | null>(null);
  /** The page shown, from 0. */
  at = $state(0);
  #opener: Opener = null;

  get wt(): Walkthrough | null {
    return this.id ? (walkthroughById[this.id] ?? null) : null;
  }
  get count(): number {
    return this.wt?.pages.length ?? 0;
  }
  get last(): boolean {
    return !!this.wt && this.at === this.count - 1;
  }

  /** Opens the walk-through that covers `part`, at the page about it. False for an unknown part. */
  open(part: string, opener: Opener = null): boolean {
    const hit = forPart(part);
    if (!hit) return false;
    this.#opener = opener;
    this.id = hit.wt.id;
    this.at = hit.at;
    return true;
  }

  /** Closes it; the focus goes back to the "?" (`refocus` false: something else takes it, as a page switch does). */
  close(refocus = true) {
    if (!this.id) return;
    const back = this.#opener;
    this.#opener = null;
    this.id = null;
    this.at = 0;
    // After the dialog has gone, so its own focus trap doesn't put it somewhere else.
    if (refocus && back) setTimeout(() => back.isConnected !== false && back.focus({ preventScroll: true }));
  }

  go(i: number) {
    if (!this.wt) return;
    this.at = Math.min(Math.max(0, i), this.count - 1);
  }
  next() {
    this.go(this.at + 1);
  }
  prev() {
    this.go(this.at - 1);
  }

  /** The dialog's keys: the arrows browse, Esc closes. True when the key was the help's. */
  key(k: string): boolean {
    if (!this.wt) return false;
    if (k === "ArrowRight") this.next();
    else if (k === "ArrowLeft") this.prev();
    else if (k === "Home") this.go(0);
    else if (k === "End") this.go(this.count - 1);
    else if (k === "Escape") this.close();
    else return false;
    return true;
  }
}

export const help = new Help();
