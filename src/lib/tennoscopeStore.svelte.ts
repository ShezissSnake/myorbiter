// TennoScope, as orbiter sees it: whether it runs, what a patched one reports about itself, and
// the few things orbiter can ask of it (sync the inventory, set your warframe.market status,
// allow screen capture, open its window).

import { tennoscope, type TennoscopeAsk, type TennoscopeStatus } from "./backend";

class TennoscopeStore {
  status = $state.raw<TennoscopeStatus | null>(null);
  error = $state<string | null>(null);
  /** A request just sent, until the next report shows its effect. */
  pending = $state<TennoscopeAsk | null>(null);
  /** Where to find TennoScope (Settings); empty finds it on its own. */
  path = "";
  /** Start it whenever it isn't running. */
  launch = true;
  private busy = false;

  get running() {
    return !!this.status?.running;
  }
  get report() {
    return this.status?.report ?? null;
  }
  /** Running, but not the patched build that reports its state. */
  get unpatched() {
    return this.running && !this.report;
  }

  /** Reads the state; with `start`, also starts TennoScope in the background if it isn't running. */
  // A TennoScope that keeps crashing on start isn't relaunched every 15 s forever: each relaunch
  // waits twice as long as the last (up to 10 minutes), and a run of 2 minutes resets that.
  private relaunches = 0;
  private nextLaunch = 0;
  private upSince = 0;

  async check(start = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      const wasRunning = !!this.status?.running;
      const relaunch = start && this.launch && !wasRunning && now >= this.nextLaunch;
      this.status = relaunch || (start && this.launch && wasRunning) ? await tennoscope.start(this.path) : await tennoscope.status(this.path);
      if (relaunch) {
        this.relaunches++;
        this.nextLaunch = now + Math.min(15_000 * 2 ** (this.relaunches - 1), 600_000);
      }
      if (this.status?.running) {
        this.upSince ||= now;
        if (now - this.upSince > 120_000) this.relaunches = 0;
      } else this.upSince = 0;
      if (this.error && this.status?.running) this.error = null;
    } catch (e) {
      this.error = clean(e);
      this.status = await tennoscope.status(this.path).catch(() => null);
    } finally {
      this.busy = false;
    }
  }

  async ask(ask: TennoscopeAsk) {
    try {
      this.pending = ask;
      await tennoscope.ask(this.path, ask);
      this.error = null;
      // The running TennoScope acts on it and reports within a few seconds.
      for (const ms of [1200, 3500, 7000]) setTimeout(() => this.check(), ms);
      setTimeout(() => this.pending === ask && (this.pending = null), 8000);
    } catch (e) {
      this.pending = null;
      this.error = clean(e);
    }
  }

  async show() {
    try {
      await tennoscope.show(this.path);
      this.error = null;
      setTimeout(() => this.check(), 2000);
    } catch (e) {
      this.error = clean(e);
    }
  }
}

const clean = (e: unknown) => String(e).replace(/^Error: /, "");

export const ts = new TennoscopeStore();
