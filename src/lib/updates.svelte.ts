// Looking for and installing updates, for the whole app: Settings → Updates and the update notice
// read this. A check runs once at start (after the first paint, once things are quiet, or after
// START_WAIT at the latest), then whenever the last one is CHECK_EVERY old, on a channel switch,
// and from Check now (docs/privacy.md, Updates). Nothing installs without a click.
//
// Every check ends in one state, shown under Check now with its time (`checkLine`): a build on
// offer, up to date, or why it failed. A failure is never a notification: it says so in that line,
// and the app's log has the details (updates.rs).
import { tick } from "svelte";
import { flushSettings, logLine, updater, type UpdateCheck, type UpdateInfo } from "./backend";
import { CHANNEL_LABEL, checkDue, checkHeadline, checkLine, installChecks, installInstalls, noticeShows, SCHEDULE_TICK, START_WAIT, versionLine, type Channel, type CheckOutcome, type UpdateSettings } from "./core/updates";
import { Job, JobError } from "./job.svelte";
import { whenIdle } from "./pane.svelte";
import { afterPaint } from "./ui/soon";

/** The longest a check may take, as the page sees it: past the app's own limit (updates.rs, 10 s). */
export const CHECK_LIMIT = 20 * 1000;

/** An update on offer: a newer build, or (after a switch to a more stable channel) an older one. */
export interface Offer {
  channel: Channel;
  version: string;
  notes: string | null;
  older: boolean;
}

/** The reason a check failed, as one sentence starting with a capital. */
function plain(e: unknown): string {
  const s = (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "").trim() || "Couldn't check for updates";
  return s[0].toUpperCase() + s.slice(1);
}

/** A check the app didn't answer in time (`limited`): the app never saw it end, so the page logs it. */
class Late extends Error {}

/** `p`, or a failure once `ms` have gone by without an answer. */
function limited<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => (t = setTimeout(() => no(new Late(`The check didn't finish in ${Math.round(ms / 1000)} s`)), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

export class Updates {
  /** This copy: its version and how it was installed. Null until the app has said. */
  info = $state<UpdateInfo | null>(null);
  /** The last check's answer, and the channel it was for. */
  result = $state<UpdateCheck | null>(null);
  checked = $state<Channel | null>(null);
  /** Why the last check failed (cleared by the next that answers). */
  error = $state<string | null>(null);
  /** How the last check this session ended, for the line under Check now. */
  outcome = $state<CheckOutcome | null>(null);
  /** A check is running, whoever started it (Check now, the schedule, a channel switch). */
  checking = $state(false);
  /** Check now. */
  checkJob = new Job(4000);
  /** Update and restart (or Switch to …): its progress is the download's. */
  installJob = new Job();
  private get: (() => UpdateSettings) | null = null;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private cancelStart: (() => void) | null = null;
  private running: Promise<string> | null = null;
  private onVisible = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") this.due();
  };

  /** The settings to read and write; starts the checks. Call once the settings are loaded. */
  start(get: () => UpdateSettings) {
    this.get = get;
    void updater.info().then(
      (i) => {
        this.info = i;
        if (!installChecks(i.install)) return;
        // Not before the first frame, and not while the page is busy, so the start stays as quick;
        // but not held back for long either.
        this.cancelStart = afterPaint(() => (this.cancelStart = soonIdle(() => void this.quiet(), START_WAIT)));
        clearInterval(this.ticker);
        this.ticker = setInterval(() => this.due(), SCHEDULE_TICK);
        // Back from a sleep or a hidden window: a check that came due meanwhile runs now.
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisible);
      },
      (e) => logLine("warn", "updates", `couldn't tell which build this is, so no update checks: ${plain(e)}`),
    );
  }

  stop() {
    clearInterval(this.ticker);
    this.ticker = undefined;
    this.cancelStart?.();
    this.cancelStart = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
  }

  /** "0.1.52 · Experimental": this copy's version and the channel it came from, once known. */
  get line(): string | null {
    const u = this.get?.();
    return this.info && u ? versionLine(this.info.version, u) : null;
  }

  /** The line under Check now, as of `now`. */
  status(now: number): string {
    return checkLine(this.outcome, this.get?.()?.lastCheck ?? null, this.checking, now);
  }

  /** The same, without its age: what a screen reader announces. */
  get headline(): string {
    return checkHeadline(this.outcome, this.checking);
  }

  /** The offer to show, if there is one for the channel chosen now. */
  get offer(): Offer | null {
    const r = this.result;
    const u = this.get?.();
    if (!r || !u || this.checked !== u.channel || (r.state !== "newer" && r.state !== "older")) return null;
    return { channel: this.checked, version: r.version, notes: r.notes, older: r.state === "older" };
  }

  /** The notice in the corner: a newer build this copy can install, unless put off with Later. */
  get notice(): Offer | null {
    const o = this.offer;
    const u = this.get?.();
    if (!o || o.older || !u || !this.info || !installInstalls(this.info.install)) return null;
    return noticeShows(o.version, u.later) ? o : null;
  }

  /** The schedule's look: a check if the last one is old enough (`checkDue`). */
  private due() {
    const u = this.get?.();
    if (!u || !this.info || !installChecks(this.info.install)) return;
    if (checkDue(u.lastCheck, Date.now())) void this.quiet();
  }

  /** A check nobody clicked for: it ends in the line under Check now like any other. */
  private async quiet() {
    try {
      await this.ask();
    } catch {
      // Already shown (`outcome`) and, for a check the app ran, in its log with the details.
    }
  }

  /**
   * Asks the chosen channel; the done word for Check now. One check at a time: a second ask while
   * one runs gets the same answer (a channel switch while it runs is asked again, below).
   */
  private ask(): Promise<string> {
    if (!this.running) {
      // Whichever check runs first is the start's: the one still waiting for a quiet moment goes.
      this.cancelStart?.();
      this.cancelStart = null;
      this.checking = true;
      this.running = this.askChosen().finally(() => {
        this.running = null;
        this.checking = false;
      });
    }
    return this.running;
  }

  private async askChosen(): Promise<string> {
    for (;;) {
      const u = this.get?.();
      if (!u || !this.info || !installChecks(this.info.install)) throw new JobError("Not here", "this copy of MyOrbiter doesn't check for updates");
      const channel = u.channel;
      let r: UpdateCheck;
      try {
        r = await limited(updater.check(channel), CHECK_LIMIT);
      } catch (e) {
        // A switch while it ran: this failure was the old channel's. Ask the new one.
        if (this.get?.().channel !== channel) continue;
        const reason = plain(e);
        const at = Date.now();
        u.lastCheck = at;
        this.error = reason;
        this.outcome = { kind: "failed", channel, reason, at };
        if (e instanceof Late) logLine("warn", "updates", `${channel} check: ${reason}`);
        throw new JobError("Couldn't check", reason);
      }
      if (this.get?.().channel !== channel) continue;
      const at = Date.now();
      u.lastCheck = at;
      this.result = r;
      this.checked = channel;
      this.error = null;
      if (r.state === "off") {
        this.outcome = { kind: "off", at };
        return "Not here";
      }
      this.outcome = { kind: r.state, channel, version: r.version, at };
      if (r.state === "newer") return `${r.version} is out`;
      if (r.state === "older") return `${CHANNEL_LABEL[channel]} has ${r.version}`;
      return `Up to date · ${this.info.version}`;
    }
  }

  /** Check now: answers on the button and in the line under it. */
  checkNow() {
    return this.checkJob.run(() => this.ask());
  }

  /** A channel picked in Settings: what it offers is asked at once (a more stable one may be behind). */
  setChannel(c: Channel) {
    const u = this.get?.();
    if (!u || u.channel === c) return;
    u.channel = c;
    this.result = null;
    this.checked = null;
    this.outcome = null;
    if (this.info && installChecks(this.info.install)) void this.checkNow();
  }


  /** Later: this version's notice goes until a newer one is out. */
  later() {
    const o = this.offer;
    const u = this.get?.();
    if (o && u) u.later = o.version;
  }

  /**
   * Update and restart, or Switch to an older build: downloads it (the button fills), installs it
   * once its signature checks out, and restarts MyOrbiter into it. On Windows the installer takes
   * over and restarts it.
   */
  install() {
    const o = this.offer;
    const u = this.get?.();
    if (!o || !u) return Promise.resolve(false);
    return this.installJob.run(async (job) => {
      job.phase = "Downloading";
      // Saved before installing: on Windows the installer closes MyOrbiter itself.
      const before = u.from;
      u.from = { version: o.version, channel: o.channel };
      u.later = "";
      await tick();
      await flushSettings();
      try {
        await updater.install(o.channel, o.version, o.older, (done, total) => {
          job.fraction = total ? done / total : null;
          job.phase = total ? `Downloading ${Math.floor((100 * done) / total)}%` : "Downloading";
        });
      } catch (e) {
        u.from = before;
        const reason = String(e).replace(/^Error:\s*/, "");
        logLine("warn", "updates", `installing ${o.version} failed: ${reason}`);
        throw new JobError("Not installed", reason);
      }
      job.fraction = 1;
      job.phase = "Restarting";
      await updater.restart();
      return "Restarting";
    });
  }
}

export const updates = new Updates();

/** `f` once the page is quiet (`whenIdle`), or after `ms` whatever happens: never held back for good. */
function soonIdle(f: () => void, ms: number): () => void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    cancel();
    f();
  };
  const cancelIdle = whenIdle(go);
  const cap = setTimeout(go, ms);
  const cancel = () => {
    done = true;
    cancelIdle();
    clearTimeout(cap);
  };
  return cancel;
}
