// Looking for and installing updates, for the whole app: Settings → Updates and the update notice
// read this. A check runs once at start (after the first paint, when nothing else is going on),
// then every 6 hours, on a channel switch, and from Check now. Nothing installs without a click.
// A check that fails (offline, or the repository still private) only says so where you look:
// Check now's own frame and the line under it, never a notification.
import { tick } from "svelte";
import { flushSettings, logLine, updater, type UpdateCheck, type UpdateInfo } from "./backend";
import { CHANNEL_LABEL, CHECK_EVERY, installChecks, installInstalls, noticeShows, versionLine, type Channel, type UpdateSettings } from "./core/updates";
import { Job, JobError } from "./job.svelte";
import { whenIdle } from "./pane.svelte";
import { afterPaint } from "./ui/soon";

/** An update on offer: a newer build, or (after a switch to a more stable channel) an older one. */
export interface Offer {
  channel: Channel;
  version: string;
  notes: string | null;
  older: boolean;
}

class Updates {
  /** This copy: its version and how it was installed. Null until the app has said. */
  info = $state<UpdateInfo | null>(null);
  /** The last check's answer, and the channel it was for. */
  result = $state<UpdateCheck | null>(null);
  checked = $state<Channel | null>(null);
  /** Why the last check failed (cleared by the next that answers). */
  error = $state<string | null>(null);
  /** Check now. */
  checkJob = new Job(4000);
  /** Update and restart (or Switch to …): its progress is the download's. */
  installJob = new Job();
  private get: (() => UpdateSettings) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancelStart: (() => void) | null = null;

  /** The settings to read and write; starts the checks. Call once the settings are loaded. */
  start(get: () => UpdateSettings) {
    this.get = get;
    void updater.info().then((i) => {
      this.info = i;
      if (!installChecks(i.install)) return;
      // Not before the first frame, and not while the page is busy: the start stays as quick.
      this.cancelStart = afterPaint(() => (this.cancelStart = whenIdle(() => void this.quiet())));
    });
  }

  stop() {
    clearTimeout(this.timer);
    this.cancelStart?.();
  }

  /** "0.1.52 · Experimental": this copy's version and the channel it came from, once known. */
  get line(): string | null {
    const u = this.get?.();
    return this.info && u ? versionLine(this.info.version, u) : null;
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

  /** A check nobody asked for: its result shows where you look; a failure stays quiet. */
  private async quiet() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => whenIdle(() => void this.quiet()), CHECK_EVERY);
    try {
      await this.ask();
    } catch {
      // Said under Check now (`error`), and in orbiter's log by the app.
    }
  }

  /** Asks the chosen channel; the done word for Check now. */
  private async ask(): Promise<string> {
    const u = this.get?.();
    if (!u || !this.info || !installChecks(this.info.install)) throw new JobError("Not here", "this copy of orbiter doesn't check for updates");
    const channel = u.channel;
    try {
      const r = await updater.check(channel);
      // A switch while it ran: this answer is for the old channel.
      if (this.get?.().channel !== channel) return "Switched";
      this.result = r;
      this.checked = channel;
      this.error = null;
      u.lastCheck = Date.now();
      if (r.state === "newer") return `${r.version} is out`;
      if (r.state === "older") return `${CHANNEL_LABEL[channel]} has ${r.version}`;
      return `Up to date · ${this.info.version}`;
    } catch (e) {
      const reason = String(e).replace(/^Error:\s*/, "");
      this.error = reason;
      throw new JobError("Couldn't check", `Couldn't check for updates: ${reason}`);
    }
  }

  /** Check now: answers on the button, then every 6 hours from here. */
  checkNow() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => whenIdle(() => void this.quiet()), CHECK_EVERY);
    return this.checkJob.run(() => this.ask());
  }

  /** A channel picked in Settings: what it offers is asked at once (a more stable one may be behind). */
  setChannel(c: Channel) {
    const u = this.get?.();
    if (!u || u.channel === c) return;
    u.channel = c;
    this.result = null;
    this.checked = null;
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
   * once its signature checks out, and restarts orbiter into it. On Windows the installer takes
   * over and restarts it.
   */
  install() {
    const o = this.offer;
    const u = this.get?.();
    if (!o || !u) return Promise.resolve(false);
    return this.installJob.run(async (job) => {
      job.phase = "Downloading";
      // Saved before installing: on Windows the installer closes orbiter itself.
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
