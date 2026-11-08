// TennoScope, as MyOrbiter sees it: whether it runs, what a patched one reports about itself, and
// the few things MyOrbiter can ask of it (sync the inventory, set your warframe.market status,
// allow screen capture, open its window).

import { tennoscope, type TennoscopeAccess, type TennoscopeAsk, type TennoscopeStatus } from "./backend";
import { failureWords } from "./core/upkeep";

class TennoscopeStore {
  status = $state.raw<TennoscopeStatus | null>(null);
  error = $state<string | null>(null);
  /** A request just sent, until the next report shows its effect. */
  pending = $state<TennoscopeAsk | null>(null);
  /** Start it whenever it isn't running. */
  launch = true;
  /**
   * The first start's question is open (FirstRun.svelte): TennoScope isn't started and isn't asked
   * anything until it's answered.
   */
  asking = $state(false);
  /**
   * The first start's answer, until TennoScope reports that mode: once it runs and reports another
   * mode, it's asked to switch (`--access=…`, as the Full mode switch asks). So a start that failed,
   * or a TennoScope found only later, still gets it. Not on TennoScope's command line: there it would
   * race TennoScope's own start in the mode its folder holds.
   */
  wanted: TennoscopeAccess | null = null;
  private follows = 0;
  /** TennoScope's data folder (Settings), where its log says why it wouldn't start; empty finds it. */
  dataDir = "";
  private busy = false;
  private forceWaiting = false;

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

  /** `force`: you asked for it (Start TennoScope), so it starts now whatever the wait. */
  async check(start = false, force = false) {
    // A press of Start isn't dropped because a routine check is under way: it runs right after,
    // once however many times it was pressed.
    if (this.busy) {
      if (force && !this.forceWaiting) {
        this.forceWaiting = true;
        setTimeout(() => {
          this.forceWaiting = false;
          void this.check(start, force);
        }, 400);
      }
      return;
    }
    this.busy = true;
    try {
      const now = Date.now();
      if (force) this.nextLaunch = 0;
      const wasRunning = !!this.status?.running;
      // Not where TennoScope can't run (macOS); and a start that fails waits longer each time,
      // like one that crashes, rather than trying (and notifying) every 15 seconds.
      const relaunch = start && !this.asking && (force || this.launch) && this.status?.supported !== false && !wasRunning && now >= this.nextLaunch;
      if (relaunch) {
        this.relaunches++;
        this.nextLaunch = now + Math.min(15_000 * 2 ** (this.relaunches - 1), 600_000);
      }
      // Only a relaunch starts it: a check while it seemed to run only looks, so one that stops as
      // soon as it starts waits out the longer gaps above instead of being started every 15 s.
      this.status = relaunch ? await tennoscope.start() : await tennoscope.status();
      this.follow();
      // Just started with an answer to pass on: look again soon, rather than at the next poll.
      if (relaunch && this.wanted) for (const ms of [1500, 4000, 8000]) setTimeout(() => this.check(), ms);
      if (this.status?.running) {
        this.upSince ||= now;
        if (now - this.upSince > 120_000) this.relaunches = 0;
      } else this.upSince = 0;
      if (this.error && this.status?.running && now - this.upSince > 30_000) this.error = null;
      // Stopped again right after a few starts: say why, from its own log.
      if (!this.status?.running && this.relaunches >= 3) {
        const f = await tennoscope.failure(this.dataDir).catch(() => null);
        if (f && now - f.at < 15 * 60_000) this.error = failureWords(f.message, this.nextLaunch - now);
      }
    } catch (e) {
      this.error = clean(e);
      this.status = await tennoscope.status().catch(() => null);
    } finally {
      this.busy = false;
    }
  }

  /** The first start's answer: kept until TennoScope reports that mode (see `wanted`). */
  answer(access: TennoscopeAccess) {
    this.wanted = access;
    this.asking = false;
  }
  /**
   * Done once TennoScope reports the mode asked for; a running one in another mode is asked to
   * switch, three times at most (then Settings, TennoScope is where to choose it).
   */
  private follow() {
    const want = this.wanted;
    const mode = this.report?.setup.access_mode;
    if (!want || !this.report) return;
    if (mode === want.slice("--access=".length)) {
      this.wanted = null;
      this.follows = 0;
    } else if (this.pending !== want) {
      if (++this.follows > 3) {
        this.wanted = null;
        this.follows = 0;
        this.error = `TennoScope didn't switch to ${want === "--access=full" ? "Full" : "Overlay"} mode: choose it in Settings, TennoScope`;
        return;
      }
      void this.ask(want);
    }
  }

  async ask(ask: TennoscopeAsk) {
    // Nothing goes to TennoScope while the first start's question is open (a sync from the riven key).
    if (this.asking) return;
    // A mode chosen since (the setup step's "Not now", the Full mode switch) replaces the first
    // start's answer: it's never asked for again over the newer choice.
    if (this.wanted && ask.startsWith("--access=") && ask !== this.wanted) {
      this.wanted = null;
      this.follows = 0;
    }
    try {
      this.pending = ask;
      await tennoscope.ask(ask);
      this.error = null;
      // The running TennoScope acts on it and reports within a few seconds.
      for (const ms of [1200, 3500, 7000]) setTimeout(() => this.check(), ms);
      setTimeout(() => this.pending === ask && (this.pending = null), 8000);
    } catch (e) {
      this.pending = null;
      this.error = clean(e);
    }
  }

  /** Settings → TennoScope → Program → Choose: the native file dialog. Throws why a pick was refused. */
  async chooseProgram() {
    const status = await tennoscope.chooseProgram();
    if (status) this.status = status;
  }

  /** Settings → TennoScope → Program → Find it: MyOrbiter finds TennoScope again. */
  async forgetProgram() {
    this.status = await tennoscope.forgetProgram();
  }

  async show() {
    try {
      await tennoscope.show();
      this.error = null;
      setTimeout(() => this.check(), 2000);
    } catch (e) {
      this.error = clean(e);
    }
  }
}

const clean = (e: unknown) => String(e).replace(/^Error: /, "");

export const ts = new TennoscopeStore();
