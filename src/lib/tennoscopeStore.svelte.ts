// TennoScope, as MyOrbiter sees it: whether it runs, what a patched one reports about itself, and
// the few things MyOrbiter can ask of it (sync the inventory, set your warframe.market status,
// allow screen capture, open its window).

import { tennoscope, type TennoscopeAccess, type TennoscopeAsk, type TennoscopeStatus } from "./backend";
import { failureWords, gaveUpWords } from "./core/upkeep";

class TennoscopeStore {
  status = $state.raw<TennoscopeStatus | null>(null);
  error = $state<string | null>(null);
  /**
   * Takes in a status check: read every 15 s and mostly the same, so the status stays the object it
   * was unless something in it changed (the strips under every page head and the buttons read it).
   */
  private put(next: TennoscopeStatus | null) {
    if (JSON.stringify(next) !== JSON.stringify(this.status)) this.status = next;
  }
  /** A request just sent, until the next report shows its effect. */
  pending = $state<TennoscopeAsk | null>(null);
  /** The last Full or Overlay asked for, and when (the first start's access step times it). */
  askedAccess = $state<{ mode: "full" | "overlay"; at: number } | null>(null);
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

  /**
   * Reads the state; with `start`, also starts TennoScope in the background if it isn't running.
   * How often it is started again is MyOrbiter's Rust side's to decide, from how each TennoScope
   * ended (companion.rs, `Relaunch`): a routine check (not `force`) is held back while it waits out
   * a restart, and once TennoScope has ended four times in a row within two minutes of starting,
   * until it's pressed Start (`force`). Here that shows as the status's `restart`.
   */
  private upSince = 0;
  /** The note that MyOrbiter gave up is up, until TennoScope runs again or is asked for again. */
  private gaveUpShown = false;

  /** `force`: you asked for it (Start TennoScope), so it starts now whatever came before. */
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
      if (force) this.gaveUpShown = false;
      const wasRunning = !!this.status?.running;
      // Not where TennoScope can't run (macOS), and not once MyOrbiter has given up on it: only
      // Start (`force`) starts it then.
      const gaveUp = !!this.status?.restart?.gave_up && !force;
      const relaunch = start && !this.asking && (force || this.launch) && this.status?.supported !== false && !wasRunning && !gaveUp;
      this.put(relaunch ? await tennoscope.start(force) : await tennoscope.status());
      this.follow();
      // Just started with an answer to pass on: look again soon, rather than at the next poll.
      if (relaunch && this.wanted) for (const ms of [1500, 4000, 8000]) setTimeout(() => this.check(), ms);
      if (this.status?.running) {
        this.upSince ||= now;
        this.gaveUpShown = false;
      } else this.upSince = 0;
      if (this.error && this.status?.running && now - this.upSince > 30_000) this.error = null;
      // Stopped again right after a few starts: say why, from its own log; and once MyOrbiter has
      // stopped starting it, say that (a notice under the bell, App.svelte), once.
      const r = this.status?.restart;
      if (!this.status?.running && r && (r.gave_up || r.tries >= 3) && !this.gaveUpShown) {
        const f = await tennoscope.failure(this.dataDir).catch(() => null);
        const why = f && now - f.at < 15 * 60_000 ? f.message : null;
        if (r.gave_up) {
          this.error = gaveUpWords(r.tries, why);
          this.gaveUpShown = true;
        } else if (why) this.error = failureWords(why, r.retry_in_ms ?? 0);
      }
    } catch (e) {
      this.error = clean(e);
      this.put(await tennoscope.status().catch(() => null));
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
    if (ask === "--access=full" || ask === "--access=overlay") this.askedAccess = { mode: ask === "--access=full" ? "full" : "overlay", at: Date.now() };
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
