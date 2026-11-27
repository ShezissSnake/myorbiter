// A Sold clicked on Orders waits a few seconds, with Undo, before it's sent: marking sold on
// warframe.market goes on the player's profile and lowers or closes the listing, which a slip of
// the mouse shouldn't do. Undo in that time sends nothing.
//
// A page once opened stays until MyOrbiter goes, and quitting, the window's X and Reload the
// window take no page away first: so while a Sold waits or is being sent, a hook is set with
// backend.ts (whenQuitting) that sends what waits at once and hands leaving the sends that are out,
// which it waits for a moment (beforeLeaving). With nothing waiting and nothing out, no hook is set.
// A Sold clicked while MyOrbiter is already leaving is sent at once (madeWhileLeaving).
import { madeWhileLeaving, whenQuitting } from "./backend";

/** How long a Sold waits before it's sent. */
export const SOLD_WAIT = 4000;

export class SoldWaits {
  /** How many each listing waits to be marked sold, by listing id, for the row's "Sold n · Undo". */
  pending = $state<Record<string, number>>({});
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Each listing's quantity when the Sold was clicked. */
  private from = new Map<string, number>();
  /** Sends under way, until warframe.market answers. */
  private out = new Set<Promise<unknown>>();
  /** While something waits or is out: leaving sends and waits for it (backend.ts › beforeLeaving). */
  private quitting: (() => void) | null = null;

  /**
   * `send(id, n, from)`: marks `n` of listing `id` sold, `from` being its quantity at the click
   * (the caller sends only what a trade from the game didn't mark meanwhile).
   */
  constructor(
    private send: (id: string, n: number, from: number | undefined) => void | Promise<unknown>,
    private ms = SOLD_WAIT,
  ) {}

  /** A Sold of `n` copies of listing `id`, which had `quantity` then: sent once the wait is up. Clicked again, the wait restarts. */
  hold(id: string, n: number, quantity: number) {
    clearTimeout(this.timers.get(id));
    this.pending = { ...this.pending, [id]: n };
    this.from.set(id, quantity);
    this.timers.set(id, setTimeout(() => this.commit(id), this.ms));
    this.quitting ??= whenQuitting(() => this.leave());
    // Clicked while MyOrbiter is already leaving: the wait would outlast the window, so it's sent now.
    if (madeWhileLeaving()) this.commit(id);
  }

  /** Undo: nothing is sent. */
  undo(id: string) {
    this.drop(id);
    this.done();
  }

  /** Sends one now (its wait is up, or MyOrbiter or the page is going away). Once only: a second call finds nothing waiting. */
  commit(id: string) {
    const n = this.pending[id];
    const from = this.from.get(id);
    this.drop(id);
    if (n) this.track(this.send(id, n, from));
    this.done();
  }

  /** Every Sold still waiting is sent: leaving the page doesn't lose one. */
  flush() {
    for (const id of [...this.timers.keys()]) this.commit(id);
  }

  /** A send under way (a Sold, a Try again, a trade's sale): leaving waits for it a moment. */
  track(p: void | Promise<unknown>) {
    if (!p) return;
    this.out.add(p);
    this.quitting ??= whenQuitting(() => this.leave());
    // A send that starts while MyOrbiter is leaving (a Try again, That sale, a Sold clicked then):
    // leaving takes it in, its record saved and its answer waited for while the wait lasts.
    madeWhileLeaving();
    const end = () => {
      this.out.delete(p);
      this.done();
    };
    p.then(end, end);
  }

  /** MyOrbiter is going: every Sold waiting is sent now; resolves once every send out has been answered. */
  leave(): Promise<void> {
    this.flush();
    return Promise.allSettled([...this.out]).then(() => {});
  }

  private drop(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.from.delete(id);
    if (id in this.pending) {
      const { [id]: _, ...rest } = this.pending;
      this.pending = rest;
    }
  }
  /** Nothing waits and nothing is out: leaving has nothing to do here. */
  private done() {
    if (this.timers.size || this.out.size || !this.quitting) return;
    this.quitting();
    this.quitting = null;
  }
}
