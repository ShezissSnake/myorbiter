// Looking for and installing updates, for the whole app: Settings → Updates, the banner over every
// page and the version in the sidebar read this. A check runs once at start (after the first paint,
// once things are quiet, or after START_WAIT at the latest), then whenever the last one is
// CHECK_EVERY old, on a channel switch, and from Check now (docs/privacy.md, Updates). Nothing
// installs without a click.
//
// A new install (no settings saved yet) of a CI build that checks has no channel until its first
// check hears back, and neither has a start whose settings file was damaged or couldn't be read: that check asks Stable, then Beta and Experimental if need be, and settles on
// the most stable channel whose build is this one or newer (`settle`, core/updates.ts
// `newInstallStep`), each asked of GitHub alone (`firstOnly`). A check that failed never settles it:
// see `buildCounts` for what an answer shows and what stays open.
//
// A channel MyOrbiter chose that way follows the most stable build (`follows`): each of its checks
// first asks the more stable channels, of GitHub alone, and moves to the first whose build is this
// one or newer (`followed`, core/updates.ts `followStep`): never to a less stable channel and never
// to an older build by itself. A channel picked by hand, or kept from settings saved before this was
// recorded, never moves by itself; Follow (`follow`) and an empty channel's switch (`switchTo`) set
// it following again, on the player's click.
//
// Every check ends in one state, shown under Check now with its time (`checkLine`): a build on
// offer, up to date, or why it failed. A failure is never a notification: it says so in that line,
// and the app's log has the details (updates.rs).
import { tick } from "svelte";
import { flushSettings, logLine, settingsMovedAside, settingsUnreadable, updater, type UpdateCheck, type UpdateInfo } from "./backend";
import { buildCounts, buildNumber, CHANNEL_LABEL, checkDue, checkHeadline, checkLine, emptyWords, followOrder, followStep, followWhy, installChecks, installInstalls, NEAREST, newInstallStep, newInstallWhy, noticeShows, SCHEDULE_TICK, settleChannel, settlesByAsking, START_WAIT, switchOffer, unsettledWords, versionLine, type Channel, type ChannelAnswer, type CheckOutcome, type UpdateSettings } from "./core/updates";
import { Job, JobError } from "./job.svelte";
import { whenIdle } from "./pane.svelte";
import { afterPaint } from "./ui/soon";

/** The longest a check may take, as the page sees it: past the app's own limit (updates.rs, 10 s). */
export const CHECK_LIMIT = 20 * 1000;

/**
 * Whose channel the log says just settled: a new install's, a start's whose settings file was
 * damaged and moved aside, or one whose saved settings couldn't be read at all (backend.ts,
 * loadSettings). The last two settle the same way but aren't new, and the last saves nothing.
 */
export const settledWho = () => (settingsUnreadable() ? "after saved settings that couldn't be read" : settingsMovedAside() ? "after a damaged settings file" : "new install");

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

/**
 * One channel asked of GitHub alone (`firstOnly`), as a new install's settling and a following
 * channel's check ask the channels: its 404 is "empty", anything else that isn't a build throws
 * (updates.rs). The answer goes into `known`, so the check doesn't ask that channel twice; `asking`
 * names the channel on its way, for the log line of a check the app never answered.
 */
async function askFirst(c: Channel, known: Partial<Record<Channel, UpdateCheck>>, asking: { channel: Channel }): Promise<ChannelAnswer> {
  asking.channel = c;
  const r = await limited(updater.check(c, true), CHECK_LIMIT);
  known[c] = r;
  return r.state === "current" || r.state === "newer" || r.state === "older" ? { version: r.version } : r.state === "empty" ? "empty" : null;
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
  /** Follow was asked for (`follow`): the next check asks every channel, most stable first. */
  private followAll = false;
  private onVisible = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") this.due();
  };

  /** The settings to read and write; starts the checks. Call once the settings are loaded. */
  start(get: () => UpdateSettings) {
    this.get = get;
    void updater.info().then(
      (i) => {
        this.info = i;
        // A new install of a local build, or of a copy that doesn't check for updates, settles its
        // channel here without asking anything; one that checks settles at its first check that
        // hears back from the channels (`settle`). Saved settings keep theirs.
        const u = this.get?.();
        const checks = installChecks(i.install);
        if (u && !settlesByAsking(i.version, checks) && settleChannel(u, i.version)) logLine("info", "updates", `${settledWho()}: on ${CHANNEL_LABEL[u.channel]}, ${buildNumber(i.version) == null ? "a local build" : "the channel this build was published to (this copy doesn't check for updates)"}`);
        if (!checks) return;
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

  /** The banner's newer build when this copy can install it (Update and restart), unless put off with Later. */
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
      let channel = u.channel;
      // What each channel answered this time round: a channel the new install's settling asked
      // isn't asked again for the check or for the nearest channel with a build.
      const known: Partial<Record<Channel, UpdateCheck>> = {};
      const asking = { channel };
      const settling = !u.picked && settlesByAsking(this.info.version, true);
      // A channel that follows the most stable build (not one picked by hand): the more stable
      // channels are asked first, and the install moves to the first whose build counts. Every
      // channel when the player has just asked to follow (`follow`).
      const following = !settling && u.picked && u.follows && settlesByAsking(this.info.version, true);
      const all = following && this.followAll;
      this.followAll = false;
      let settled = false;
      let r: UpdateCheck;
      try {
        if (settling) {
          const s = await this.settle(u, this.info.version, known, asking);
          // The player picked a channel meanwhile: the answers are dropped, and that channel is asked.
          if (s == null) continue;
          channel = s;
          settled = true;
        } else if (following) {
          const s = await this.followed(u, this.info.version, known, asking, all);
          // A channel picked by hand meanwhile: what was heard is dropped, and that channel is asked.
          if (s == null) continue;
          channel = s;
        }
        asking.channel = channel;
        r = known[channel] ?? (await limited(updater.check(channel), CHECK_LIMIT));
      } catch (e) {
        // A switch while it ran, or a pick while a new install was settling or a channel was
        // following: this failure was for what was shown before. Ask the channel chosen now.
        // A Follow asked for while it ran: asked again, as Follow asks.
        if (this.get?.().channel !== channel || (settling && !settled && this.get?.().picked) || (following && !this.get?.().follows) || this.followAll) continue;
        const reason = plain(e);
        const at = Date.now();
        u.lastCheck = at;
        this.error = reason;
        this.outcome = { kind: "failed", channel, reason, at };
        if (e instanceof Late) logLine("warn", "updates", `${asking.channel} check: ${reason}`);
        throw new JobError("Couldn't check", reason);
      }
      if (this.get?.().channel !== channel || this.followAll) continue;
      const at = Date.now();
      u.lastCheck = at;
      this.result = r;
      this.checked = channel;
      this.error = null;
      if (r.state === "off") {
        this.outcome = { kind: "off", at };
        return "Not here";
      }
      if (r.state === "empty") {
        // Not a failure: said plainly, with the nearest channel that has a build, to switch to by
        // a click (`switchOffer`). Nothing switches to a less stable channel by itself.
        const nearest = await this.nearest(channel, known);
        if (this.get?.().channel !== channel) continue;
        this.outcome = { kind: "empty", channel, system: r.system, nearest, at };
        return `${CHANNEL_LABEL[channel]} is empty`;
      }
      this.outcome = { kind: r.state, channel, version: r.version, at };
      if (r.state === "newer") return `${r.version} is out`;
      if (r.state === "older") return `${CHANNEL_LABEL[channel]} has ${r.version}`;
      return `Up to date · ${this.info.version}`;
    }
  }

  /**
   * The nearest channel to `empty` that has a build (`NEAREST`), and its version; null if none
   * answers with one. Asked only when the chosen channel turned out empty, at most once a check,
   * from the same addresses a switch to that channel asks. A channel already in `known` (a new
   * install's settling asked it this check) isn't asked again.
   */
  private async nearest(empty: Channel, known: Partial<Record<Channel, UpdateCheck>> = {}): Promise<{ channel: Channel; version: string } | null> {
    for (const c of NEAREST[empty]) {
      let r: UpdateCheck;
      try {
        r = known[c] ?? (await limited(updater.check(c), CHECK_LIMIT));
      } catch {
        return null;
      }
      if (r.state === "newer" || r.state === "older" || r.state === "current") return { channel: c, version: r.version };
      if (r.state !== "empty") return null;
    }
    return null;
  }

  /**
   * A new install's channel, settled by asking Stable, Beta only when Stable's build doesn't count,
   * and Experimental only when neither does (`newInstallStep`; Experimental must count too): the
   * channel settled on, marked picked (saved with the settings, unless they couldn't be read at
   * start: then it lasts until a restart) and said in the log once.
   * Null when the player picked a channel meanwhile: what was heard is dropped. Throws when a
   * channel that had to be asked didn't answer: nothing settles, nothing is marked picked, and the
   * next check (when due, or at the next start) asks again. What each channel answered goes into
   * `known`, so the check that follows doesn't ask it twice; `asking` names the channel on its way.
   */
  private async settle(u: UpdateSettings, version: string, known: Partial<Record<Channel, UpdateCheck>>, asking: { channel: Channel }): Promise<Channel | null> {
    const ask = (c: Channel) => askFirst(c, known, asking);
    const stable = await ask("stable");
    if (this.get?.().picked) return null;
    let beta: ChannelAnswer | undefined;
    let step = newInstallStep(version, stable);
    if (step === "ask beta") {
      beta = await ask("beta");
      if (this.get?.().picked) return null;
      step = newInstallStep(version, stable, beta);
    }
    if (step === "not yet" || step === "ask beta") throw new Error("Couldn't find out which channel has this build");
    // Neither Stable nor Beta counts: Experimental is asked (the check it would get anyway) and
    // must answer with this build or a newer one (`buildCounts`). If GitHub has none there either,
    // nothing settles, and the next check asks again.
    let experimental: ChannelAnswer | undefined;
    if (step === "experimental") {
      experimental = await ask("experimental");
      if (this.get?.().picked) return null;
      if (!buildCounts(experimental, version)) throw new Error("No channel answered with this build or a newer one");
    }
    u.channel = step;
    u.picked = true;
    // Chosen by MyOrbiter, not by hand: it follows the most stable build from now on (`followed`).
    u.follows = true;
    logLine("info", "updates", `${settledWho()}: on ${CHANNEL_LABEL[step]}, ${newInstallWhy(version, step, stable, beta, experimental)}`);
    return step;
  }

  /**
   * A following channel's check, before its own: the channels more stable than it (every channel
   * with `all`, when the player has just asked to follow) are asked, most stable first, each from
   * GitHub alone as a new install's are (`askFirst`), stopping at the first whose build is the
   * running one or newer (`followStep`); the install moves there and says so in the log. The channel
   * to ask for the check; the one it was on when none counts. Null when the player picked a channel
   * by hand meanwhile (or switched): what was heard is dropped. A read that fails throws: nothing
   * moves, and the check fails, so no "up to date" is said for a check that didn't finish.
   *
   * The channel the check ends on is asked last, so the app's kept update (updates.rs `Pending`, one
   * for the last check) is that channel's: a move reuses its answer from `known`.
   */
  private async followed(u: UpdateSettings, version: string, known: Partial<Record<Channel, UpdateCheck>>, asking: { channel: Channel }, all: boolean): Promise<Channel | null> {
    const from = u.channel;
    const order = followOrder(from, all);
    const answers: Partial<Record<Channel, ChannelAnswer>> = {};
    for (;;) {
      const step = followStep(version, order, answers);
      if (step == null) return from;
      if (typeof step === "object") {
        answers[step.ask] = await askFirst(step.ask, known, asking);
        const now = this.get?.();
        if (!now || !now.follows || now.channel !== from) return null;
        continue;
      }
      if (step !== from) {
        u.channel = step;
        logLine("info", "updates", `following the most stable build: ${followWhy(version, from, step, answers[step])}`);
      }
      return step;
    }
  }

  /**
   * While a new install, or a start whose saved channel couldn't be read, hasn't settled its
   * channel: what Settings, Updates says about the channel it shows (`unsettledWords`). Null once settled, and on an install that settles without asking.
   */
  get unsettled(): string | null {
    const u = this.get?.();
    const i = this.info;
    if (!u || u.picked || !i || !settlesByAsking(i.version, installChecks(i.install))) return null;
    return unsettledWords(u.channel, this.outcome?.kind === "failed", settingsUnreadable());
  }

  /**
   * Whether this copy can follow the most stable build: a build that checks, with a build number
   * (not a local build). What the Follow switch is shown for.
   */
  get followable(): boolean {
    const i = this.info;
    return !!i && settlesByAsking(i.version, installChecks(i.install));
  }

  /** Something to do about updates, put off with Later or not: the dot by the version. */
  get waiting(): boolean {
    const o = this.offer;
    return (!!o && !o.older && !!this.info && installChecks(this.info.install)) || this.switchOffer != null;
  }

  /** The empty channel's line in Settings, Updates, and the switch it offers; null otherwise. */
  get empty(): { words: string; to: { channel: Channel; version: string } | null } | null {
    const o = this.outcome;
    const u = this.get?.();
    if (!o || o.kind !== "empty" || !u || o.channel !== u.channel) return null;
    return { words: emptyWords(o.channel, o.system), to: o.nearest };
  }

  /** Check now: answers on the button and in the line under it. */
  checkNow() {
    return this.checkJob.run(() => this.ask());
  }

  /** A channel picked in Settings: what it offers is asked at once (a more stable one may be behind). */
  setChannel(c: Channel) {
    const u = this.get?.();
    if (!u) return;
    // The player's own choice, from the channel buttons or an empty channel's Switch to: it
    // settles a new install for good, even on the channel already shown, and an answer the
    // settling was waiting for is dropped (`settle`). Saved with the settings, so a later start
    // never asks again; when they couldn't be read at start nothing is saved, so it lasts until a
    // restart, which reads the file again.
    const unsettled = !u.picked;
    u.picked = true;
    // Picked by hand: it never moves by itself again (until the player asks to follow, `follow`).
    // Even the channel already shown: a click on it is a pick too.
    u.follows = false;
    if (u.channel === c) {
      // A new install that picks the channel it shows: its updates are looked for at once, as the
      // unsettled line says (a settling under way drops its answers and asks this channel).
      if (unsettled && this.info && installChecks(this.info.install)) void this.checkNow();
      return;
    }
    u.channel = c;
    this.result = null;
    this.checked = null;
    this.outcome = null;
    if (this.info && installChecks(this.info.install)) void this.checkNow();
  }

  /**
   * Follow the most stable build, on the player's word (the way back after a pick by hand): the
   * channel is no longer kept as picked, and a check asks every channel, most stable first, and
   * moves to the first whose build is this one or newer (`followed` with `all`); if none has one,
   * the channel stays. From then on it moves by itself only to a more stable channel.
   */
  follow() {
    const u = this.get?.();
    if (!u || !this.info || !settlesByAsking(this.info.version, installChecks(this.info.install))) return;
    u.picked = true;
    u.follows = true;
    this.followAll = true;
    void this.checkNow();
  }

  /** Stop following: the channel shown now stays, as if picked by hand. */
  unfollow() {
    const u = this.get?.();
    if (u) u.follows = false;
  }

  /**
   * An empty channel's switch: to `c`, the nearest channel whose build is this one or newer
   * (`switchOffer`), following the most stable build from there, so the install comes back to the
   * more stable channel by itself once that one has this build or a newer one. Asked at once.
   */
  switchTo(c: Channel) {
    const u = this.get?.();
    if (!u) return;
    u.picked = true;
    u.follows = true;
    if (u.channel !== c) {
      u.channel = c;
      this.result = null;
      this.checked = null;
      this.outcome = null;
    }
    if (this.info && installChecks(this.info.install)) void this.checkNow();
  }

  /**
   * Outside Settings, an empty channel's way out: the nearest channel whose build is this one or
   * newer, to switch to by a click (`switchTo`). Null otherwise, and while a check runs.
   */
  get switchOffer(): { from: Channel; to: Channel; version: string } | null {
    const u = this.get?.();
    if (!u || !this.info) return null;
    return switchOffer(this.outcome, u.channel, this.info.version);
  }

  /**
   * The banner over every page, one at a time: a newer build on the channel (with Update and
   * restart when this copy can install it; `installs` false for an AppImage in a folder it can't
   * write to, which is told why instead), or an empty channel's switch. Each one put off with Later
   * stays away for that version alone. Nothing while a new install hasn't settled, after a check
   * that failed with nothing on offer, or on a copy that doesn't check.
   */
  get banner(): { kind: "update"; offer: Offer; installs: boolean } | { kind: "switch"; from: Channel; to: Channel; version: string } | null {
    const u = this.get?.();
    const i = this.info;
    if (!u || !i || !installChecks(i.install)) return null;
    const o = this.offer;
    if (o && !o.older) return noticeShows(o.version, u.later) ? { kind: "update", offer: o, installs: installInstalls(i.install) } : null;
    const s = this.switchOffer;
    return s && noticeShows(s.version, u.later) ? { kind: "switch", ...s } : null;
  }

  /** Later: this version's banner goes; another version, newer or lower, shows (`noticeShows`). */
  later() {
    const b = this.banner;
    const o = b?.kind === "update" ? b.offer : b?.kind === "switch" ? b : this.offer;
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

/**
 * The version's panel (UpdatesPanel): open from the version at the top of the sidebar, or from the
 * banner's Details. One for the whole window.
 */
export const updatesPanel = $state({ open: false });

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
