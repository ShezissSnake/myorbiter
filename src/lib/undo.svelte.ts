// Undo instead of instant loss: dismissing or removing something waits a few seconds first, with
// the thing collapsed to a "Dismissed · Undo" line meanwhile. Only once the time is up is it
// really gone (the change is committed); Undo in that time leaves everything as it was.

import { madeWhileLeaving, whenQuitting } from "./backend";

/** How long the Undo stays before the change is made. */
export const UNDO_MS = 5000;

export class UndoSlots {
  /** The keys waiting, so a page can draw their collapsed line instead of the thing. */
  held = $state<Record<string, true>>({});
  private waiting = new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>();
  /** While something waits: quitting and Reload the window make it first (backend.ts › beforeLeaving). */
  private quitting: (() => void) | null = null;

  constructor(private ms = UNDO_MS) {}

  has(key: string): boolean {
    return !!this.held[key];
  }

  /** Starts the wait: `commit` runs once it's up, unless undone first. Holding a key again restarts it. */
  hold(key: string, commit: () => void) {
    this.drop(key);
    this.held = { ...this.held, [key]: true };
    this.waiting.set(key, { timer: setTimeout(() => this.commit(key), this.ms), commit });
    this.quitting ??= whenQuitting(() => this.flush());
    // Removed while MyOrbiter is already leaving: the Undo would outlast the window, so it's made now and saved.
    if (madeWhileLeaving()) this.commit(key);
  }

  /** Changed your mind: nothing happens. */
  undo(key: string) {
    this.drop(key);
    this.forget(key);
  }

  /** Makes the change now (the time is up, or the page is going away). */
  commit(key: string) {
    const w = this.waiting.get(key);
    this.drop(key);
    this.forget(key);
    w?.commit();
  }

  /** Every change still waiting is made: leaving the page doesn't lose a dismissal. */
  flush() {
    for (const key of [...this.waiting.keys()]) this.commit(key);
  }

  private drop(key: string) {
    const w = this.waiting.get(key);
    if (w) clearTimeout(w.timer);
    this.waiting.delete(key);
    if (!this.waiting.size && this.quitting) {
      this.quitting();
      this.quitting = null;
    }
  }
  private forget(key: string) {
    if (!(key in this.held)) return;
    const { [key]: _, ...rest } = this.held;
    this.held = rest;
  }
}
