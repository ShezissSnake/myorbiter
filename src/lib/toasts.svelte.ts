// Pop-ups inside MyOrbiter's window: a notification that arrives while you're looking at MyOrbiter
// shows here instead of on the desktop. Each goes by itself after a few seconds (hovering or
// focusing it holds it, and it carries on from there); a click opens the page it's about.
import type { Notice } from "./notices";

export const SHOWN_FOR = 7000;
/** At most this many at once; the rest of a burst (several at launch) fold into one "N more" line. */
export const MAX_SHOWN = 2;

class Toasts {
  list = $state<Notice[]>([]);
  /** How many of this burst were folded away (they're all under the bell): one line, gone with the burst. */
  more = $state(0);
  private moreTimer: ReturnType<typeof setTimeout> | undefined;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Time left for each one: its deadline while running, what's left while held. */
  private left = new Map<string, number>();
  private due = new Map<string, number>();

  push(n: Notice) {
    // At most MAX_SHOWN at once: a burst folds the oldest into the "N more" line, keeping a sale
    // whose +rep is still to give (its button is on the toast).
    const kept = [n, ...this.list.filter((t) => t.id !== n.id)];
    while (kept.length > MAX_SHOWN) {
      let i = kept.length - 1;
      while (i > 0 && kept[i].rep) i--;
      const [gone] = kept.splice(i > 0 ? i : kept.length - 1, 1);
      this.forget(gone.id);
      this.more++;
    }
    this.list = kept;
    if (this.more) {
      clearTimeout(this.moreTimer);
      this.moreTimer = setTimeout(() => (this.more = 0), SHOWN_FOR);
    }
    this.left.set(n.id, SHOWN_FOR);
    this.arm(n.id);
  }
  /** Runs (again) for the time it has left. */
  arm(id: string) {
    clearTimeout(this.timers.get(id));
    const ms = this.left.get(id) ?? SHOWN_FOR;
    this.due.set(id, Date.now() + ms);
    this.timers.set(id, setTimeout(() => this.dismiss(id), ms));
  }
  hold(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const due = this.due.get(id);
    if (due != null) this.left.set(id, Math.max(1500, due - Date.now()));
  }
  /** The "N more" line goes (opened under the bell, or dismissed). */
  dropMore() {
    clearTimeout(this.moreTimer);
    this.more = 0;
  }
  dismiss(id: string) {
    this.forget(id);
    this.list = this.list.filter((t) => t.id !== id);
  }
  private forget(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.left.delete(id);
    this.due.delete(id);
  }
}

export const toasts = new Toasts();
