// Pop-ups inside orbiter's window: a notification that arrives while you're looking at orbiter
// shows here instead of on the desktop. Each goes by itself after a few seconds (hovering or
// focusing it holds it, and it carries on from there); a click opens the page it's about.
import type { Notice } from "./notices";

export const SHOWN_FOR = 7000;

class Toasts {
  list = $state<Notice[]>([]);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Time left for each one: its deadline while running, what's left while held. */
  private left = new Map<string, number>();
  private due = new Map<string, number>();

  push(n: Notice) {
    // At most three at once: a burst drops the oldest.
    const kept = [n, ...this.list.filter((t) => t.id !== n.id)];
    for (const gone of kept.slice(3)) this.forget(gone.id);
    this.list = kept.slice(0, 3);
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
