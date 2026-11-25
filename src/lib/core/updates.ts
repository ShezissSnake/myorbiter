// Release channels and the rules around updates, without the app: which channel is which, how
// versions compare, what the settings may hold, and where a build's release page is. The app side
// (asking for and installing updates) is lib/updates.svelte.ts and src-tauri/src/updates.rs.
//
// Every build CI makes is version 0.2.<build number>, the number of its `build-<n>` release, and
// keeps that version when it moves from Experimental to Beta to Stable. A local build is 0.1.0.

import { cleanLine } from "./untrusted";

export type Channel = "stable" | "beta" | "experimental";

/** The channels, most stable first, with what each means (the segmented control's tooltips). */
export const CHANNELS: readonly { v: Channel; label: string; title: string }[] = [
  { v: "stable", label: "Stable", title: "Stable: tested builds. Updates come less often" },
  { v: "beta", label: "Beta", title: "Beta: the next Stable, a few days early" },
  { v: "experimental", label: "Experimental", title: "Experimental: every change, as soon as it's built. May break" },
];

export const CHANNEL_LABEL: Record<Channel, string> = { stable: "Stable", beta: "Beta", experimental: "Experimental" };

export const isChannel = (x: unknown): x is Channel => x === "stable" || x === "beta" || x === "experimental";

/** How often MyOrbiter looks for an update while it runs. */
export const CHECK_EVERY = 6 * 60 * 60 * 1000;
/**
 * How often the schedule looks whether a check is due. Due-ness is measured on the wall clock from
 * the last check (`checkDue`), so a long sleep or a suspended window can't push a check hours late,
 * as one 6-hour timer would.
 */
export const SCHEDULE_TICK = 5 * 60 * 1000;
/** The check at start waits for a quiet moment, but never longer than this. */
export const START_WAIT = 30 * 1000;

/**
 * Whether the periodic check is due at `now`: never checked, the last check (whatever it found, or
 * a failure) `CHECK_EVERY` ago, or a clock that went back since.
 */
export function checkDue(last: number | null, now: number): boolean {
  return last == null || now < last || now - last >= CHECK_EVERY;
}

/** How a check ended, for the line under Check now. `at`: when it ended (ms). */
export type CheckOutcome =
  | { kind: "newer"; channel: Channel; version: string; at: number }
  | { kind: "older"; channel: Channel; version: string; at: number }
  | { kind: "current"; channel: Channel; version: string; at: number }
  | { kind: "failed"; channel: Channel; reason: string; at: number }
  | { kind: "empty"; channel: Channel; system: boolean; nearest: { channel: Channel; version: string } | null; at: number }
  | { kind: "off"; at: number };

/**
 * Where to look when a channel has no build, nearest first: the channels either side, the more
 * stable of two at the same distance first (a channel with a build there is the gentler switch).
 */
export const NEAREST: Record<Channel, readonly Channel[]> = {
  stable: ["beta", "experimental"],
  beta: ["stable", "experimental"],
  experimental: ["beta", "stable"],
};

/** "Stable has no build yet.": an empty channel, in words. */
export function emptyWords(channel: Channel, system: boolean): string {
  return `${CHANNEL_LABEL[channel]} has no build ${system ? "for this system " : ""}yet`;
}

/** "19:52", in the computer's own time zone. */
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * What the last check found, without when: what a screen reader announces as it changes (the
 * line itself ages every minute, which would be read out again each time). "" before any check.
 */
export function checkHeadline(outcome: CheckOutcome | null, checking: boolean): string {
  if (checking) return "Checking for updates…";
  if (!outcome) return "";
  switch (outcome.kind) {
    case "newer":
      return `${outcome.version} is available on ${CHANNEL_LABEL[outcome.channel]}`;
    case "older":
      return `${CHANNEL_LABEL[outcome.channel]} has ${outcome.version}, older than this build`;
    case "current":
      return "Up to date";
    case "failed":
      return outcome.reason;
    case "empty":
      return emptyWords(outcome.channel, outcome.system);
    case "off":
      return "This copy of MyOrbiter doesn't check for updates";
  }
}

/**
 * The line under Check now: what the last check found, and when. Before any check this session,
 * when the last one (maybe from an earlier start) answered; "Checking…" while one runs.
 */
export function checkLine(outcome: CheckOutcome | null, lastCheck: number | null, checking: boolean, now: number): string {
  if (checking) return "Checking for updates…";
  if (!outcome) return `Last checked ${checkedAgo(lastCheck, now)}.`;
  const ago = checkedAgo(outcome.at, now);
  switch (outcome.kind) {
    case "newer":
      return `${outcome.version} is available on ${CHANNEL_LABEL[outcome.channel]} (checked ${ago}).`;
    case "older":
      return `${CHANNEL_LABEL[outcome.channel]} has ${outcome.version}, older than this build (checked ${ago}).`;
    case "current":
      return `Up to date (checked ${ago}).`;
    case "failed":
      return `${outcome.reason} (at ${clockTime(outcome.at)}, ${ago}).`;
    case "empty":
      return `${emptyWords(outcome.channel, outcome.system)}, so there's nothing to update to there (checked ${ago}).`;
    case "off":
      return "This copy of MyOrbiter doesn't check for updates.";
  }
}

/** MyOrbiter's home: the repository on GitHub, with its releases and issues. */
export const REPO_URL = "https://github.com/ShezissSnake/myorbiter";
/** The mirror on GitLab, which keeps the releases GitLab made (builds 100 to 119). */
export const GITLAB_URL = "https://gitlab.com/sheziss-group/myorbiter";

/** Builds from 100 were made on GitLab (its pipeline's BUILD_OFFSET), builds from 120 on GitHub
 *  again (the Release workflow's BUILD_OFFSET); the builds below 100, from before the move to
 *  GitLab, have no release page of their own any more. */
const FIRST_GITLAB_BUILD = 100;
const FIRST_GITHUB_BUILD = 120;

/** What the settings keep about updates. */
export interface UpdateSettings {
  /** The channel updates come from. */
  channel: Channel;
  /** A version put off with Later: its notice stays away, and any other version's shows. "" for none. */
  later: string;
  /** When the last check ended (ms): found something, found nothing, or failed. */
  lastCheck: number | null;
  /** The build last installed through the updater, and the channel it came from. */
  from: { version: string; channel: Channel } | null;
  /**
   * Whether `channel` stands: chosen in Settings, kept from settings saved before, or settled by a
   * new install's first check. False only on a new install (no settings saved yet, a damaged
   * settings file moved aside, or one that couldn't be read at all, whose channel isn't known)
   * until then:
   * `channel` is only what Settings shows meanwhile, and the first check that hears back from the
   * channels settles it (`newInstallStep`), once.
   */
  picked: boolean;
  /**
   * Whether `channel` follows the most stable build: true when MyOrbiter chose it (a new install's
   * first check, `newInstallStep`), or when the player asked for that (`Updates.follow`). An empty
   * channel's switch (`Updates.switchTo`) leaves it as it was. Such a channel moves by itself to a more stable one once that one's
   * build is the running one or newer (`followStep`), never to a less stable one and never to an
   * older build. False for a channel picked by hand, and for one kept from settings saved before
   * this was recorded: those never move by themselves.
   */
  follows: boolean;
}

export const defaultUpdates = (): UpdateSettings => ({ channel: "stable", later: "", lastCheck: null, from: null, picked: true, follows: false });

/**
 * A new install's (no settings saved yet), and a start's whose settings file was damaged and moved
 * aside or couldn't be read at all (`loadSettings`): its channel is settled by its first check
 * (`newInstallStep`).
 */
export const newInstallUpdates = (): UpdateSettings => ({ ...defaultUpdates(), picked: false });

/**
 * The channel a build was published to. Every build the Release workflow makes lands on
 * Experimental first; Beta and Stable get the same files later, by hand, and the files don't say
 * which channel they were downloaded from. So a CI build (0.2.n) says Experimental, and a build
 * made locally (0.1.0), published nowhere, says Stable, as before.
 */
export function publishedTo(version: string): Channel {
  return buildNumber(version) != null ? "experimental" : "stable";
}

/**
 * A new install's channel without asking any channel (`settlesByAsking` false): a local build,
 * published nowhere, on Stable; a CI build that doesn't check for updates on Experimental, where it
 * was published first. Settings saved before (any channel, or none) are left as they are. True when
 * it changed something.
 */
export function settleChannel(u: UpdateSettings, version: string): boolean {
  if (u.picked) return false;
  u.channel = publishedTo(version);
  u.picked = true;
  return true;
}

/**
 * Whether a new install settles its channel by asking the channels (`newInstallStep`): a CI build
 * that checks for updates. A local build and a copy that doesn't check ask nothing for it.
 */
export const settlesByAsking = (version: string, checks: boolean) => checks && buildNumber(version) != null;

/**
 * What a channel answered a new install: its build's version, "empty" (GitHub's own "no build": a
 * 404 for the channel's file, or its manifest with no build for this system), or null for the
 * app's "off". A check that failed never gets here: it throws (the store's `settle`).
 */
export type ChannelAnswer = { version: string } | "empty" | null;

/**
 * Whether a channel's answer makes it one to settle on: a build that is the running one or newer.
 * A new install's checks ask the first address alone (updates.rs, `updates_check` with
 * `firstOnly`), so every answer here is GitHub's own: a build there, or its 404 ("empty"). GitHub
 * not reached, a time-out or any other status (a 403, a 429, a 503) is a failed check, which
 * throws and settles nothing; GitLab's frozen copy is never read for it, nor waited on. What stays
 * open: the read GitHub answered with a file, then failed for the plugin (a failure too); a
 * repository that moved, whose old addresses answer with a redirect for every channel, so a
 * channel with no build reads as a failed check, never empty, and a new install of a build made
 * before the move that has to ask a channel with no build (as with Stable and Beta empty) settles
 * only by a pick; and a repository that is gone, answering 404 for every
 * channel: Experimental doesn't count then, and nothing settles.
 */
export const buildCounts = (a: ChannelAnswer | undefined, running: string) => !!a && a !== "empty" && compareVersions(a.version, running) >= 0;
const counts = buildCounts;

/**
 * A new install's channel, from what Stable and Beta answered (`beta` undefined: not asked yet) and
 * the running version: the most stable channel whose build is the running one or newer, so no step
 * back is offered by itself and the version line never names a channel whose build is older.
 * Stable if its build counts; else Beta if its build counts; else "experimental": Experimental is
 * asked next, as the check it gets anyway, and the install settles there only if its build counts
 * too (`buildCounts`). An Experimental that answers empty or older settles nothing. "ask beta": Stable doesn't count and Beta wasn't
 * asked yet. "not yet": a channel that had to be asked didn't answer, so nothing settles and the
 * next check asks again.
 */
export function newInstallStep(running: string, stable: ChannelAnswer, beta?: ChannelAnswer): Channel | "ask beta" | "not yet" {
  if (stable == null) return "not yet";
  if (counts(stable, running)) return "stable";
  if (beta === undefined) return "ask beta";
  if (beta == null) return "not yet";
  return counts(beta, running) ? "beta" : "experimental";
}

/** Why a new install settled on `channel`, for the log line that says so. */
export function newInstallWhy(running: string, channel: Channel, stable: ChannelAnswer, beta?: ChannelAnswer, experimental?: ChannelAnswer): string {
  const said = (c: Channel, a: ChannelAnswer | undefined) =>
    a == null || a === "empty" ? `${CHANNEL_LABEL[c]} has no build` : compareVersions(a.version, running) < 0 ? `${CHANNEL_LABEL[c]}'s build ${a.version} is older` : `${CHANNEL_LABEL[c]} has ${a.version}`;
  if (channel === "stable") return `the most stable channel with this build or a newer one (${said("stable", stable)})`;
  if (channel === "beta") return `the most stable channel with this build or a newer one (${said("stable", stable)}, ${said("beta", beta)})`;
  return `neither Stable nor Beta has this build or a newer one (${said("stable", stable)}, ${said("beta", beta)}${experimental === undefined ? "" : `, ${said("experimental", experimental)}`})`;
}

/**
 * The channels a following install asks before its own, most stable first: those more stable than
 * `current`, and nothing less stable, at every check that follows, the first after Follow is turned
 * on included.
 */
export function followOrder(current: Channel): Channel[] {
  const order = CHANNELS.map((c) => c.v);
  return order.slice(0, order.indexOf(current));
}

/**
 * What an empty channel's Switch to leaves behind, where it is offered (the banner, the version's
 * panel, Settings): following, kept as it was, moves only to a more stable channel, so it leads
 * back towards `from` only when `from` is the more stable of the two. No full stop.
 */
export function switchAfter(from: Channel, to: Channel, follows: boolean): string {
  const [f, t] = [CHANNEL_LABEL[from], CHANNEL_LABEL[to]];
  const up = `it moves by itself to a more stable channel, ${f} included, once that one has this build or a newer one`;
  if (moreStable(from, to)) return follows ? `MyOrbiter still follows the most stable build: ${up}` : `${t} then stays until you choose again, or turn on Follow the most stable build: ${up}`;
  return follows ? `MyOrbiter still follows the most stable build, which never moves to a less stable channel, so it doesn't come back to ${f} by itself` : `${t} then stays until you choose again; Follow the most stable build never moves to a less stable channel`;
}

/** Whether channel `a` is more stable than `b` (Stable, then Beta, then Experimental). */
export function moreStable(a: Channel, b: Channel): boolean {
  const order = CHANNELS.map((c) => c.v);
  return order.indexOf(a) < order.indexOf(b);
}

/**
 * Following: from what the channels in `order` answered so far (missing: not asked yet), the
 * channel to be on, or the next one to ask. The first channel in `order` whose build is the running
 * one or newer (`buildCounts`) is the one, once every channel before it has answered without such a
 * build. Null when none in `order` counts: the install stays where it is. An answer of null (the
 * app's "off") counts as none; a read that failed never gets here: the store logs it, and nothing
 * moves.
 * The result is always more stable than the channel `followOrder` was given, so following never
 * moves to a less stable channel, and never to an older build, by itself.
 */
export function followStep(running: string, order: readonly Channel[], answers: Partial<Record<Channel, ChannelAnswer>>): Channel | { ask: Channel } | null {
  for (const c of order) {
    if (!(c in answers)) return { ask: c };
    if (buildCounts(answers[c], running)) return c;
  }
  return null;
}

/** Why a following install moved from `from` to `to`, for the log line that says so. */
export function followWhy(running: string, from: Channel, to: Channel, answer: ChannelAnswer | undefined): string {
  const v = answer && answer !== "empty" ? answer.version : null;
  const has = !v ? "a build" : compareVersions(v, running) === 0 ? `this build (${v})` : `${v}, newer than this build (${running})`;
  return `from ${CHANNEL_LABEL[from]} to ${CHANNEL_LABEL[to]}, the most stable channel with this build or a newer one (${CHANNEL_LABEL[to]} has ${has})`;
}

/**
 * The channel as a word for the places outside Settings: its name once chosen, by hand or by
 * MyOrbiter; "channel not chosen yet" while a new install hasn't settled (the one Settings shows
 * meanwhile was never chosen); "local build" for a build made here.
 */
export function channelWord(version: string, u: UpdateSettings): string {
  if (buildNumber(version) == null) return "local build";
  return u.picked ? CHANNEL_LABEL[u.channel] : "channel not chosen yet";
}

/**
 * How the channel is kept, in a sentence: following (and where it may go next), or picked by
 * hand. Null for a local build, and while a new install hasn't settled (`unsettledWords` says that).
 */
export function followWords(version: string, u: UpdateSettings): string | null {
  if (buildNumber(version) == null || !u.picked) return null;
  if (!u.follows) return `${CHANNEL_LABEL[u.channel]} stays as chosen: MyOrbiter never switches it by itself.`;
  if (u.channel === "stable") return "Following the most stable build: Stable is the most stable channel, so there is nothing to move to.";
  const up = followOrder(u.channel).map((c) => CHANNEL_LABEL[c]);
  const when = up.length === 1 ? `once ${up[0]} has` : "once one of them has";
  return `Following the most stable build: MyOrbiter moves to ${up.join(" or ")} by itself ${when} this build or a newer one, never to a less stable channel or an older build.`;
}

/**
 * An empty channel's way out, as said outside Settings: the nearest channel with a build, when that
 * build is the running one or newer (switching to it is never a step back). Null otherwise: an
 * empty channel whose nearest build is older is said in Settings alone, with its own switch.
 */
export function switchOffer(outcome: CheckOutcome | null, current: Channel, running: string): { from: Channel; to: Channel; version: string } | null {
  if (!outcome || outcome.kind !== "empty" || outcome.channel !== current || !outcome.nearest) return null;
  if (!buildCounts({ version: outcome.nearest.version }, running)) return null;
  return { from: outcome.channel, to: outcome.nearest.channel, version: outcome.nearest.version };
}

/**
 * What Settings, Updates says while a new install hasn't settled its channel: which channel is
 * shown, and that MyOrbiter is still finding out. `failed`: its last try settled nothing, whether
 * no channel answered or every channel answered without this build or a newer one; the words are
 * true of both. `unreadable`: the saved settings couldn't be read at this start (backend.ts,
 * loadSettings), so their channel isn't known and nothing chosen now is saved over them.
 */
export function unsettledWords(shown: Channel, failed: boolean, unreadable = false): string {
  const asks = failed ? "No channel has answered with this build or a newer one yet, so MyOrbiter asks again at its next check." : "It asks them at its first check.";
  if (unreadable) return `${CHANNEL_LABEL[shown]} is shown, but no channel is chosen: MyOrbiter couldn't read your saved settings, so the channel saved in them isn't known. MyOrbiter finds out which to use for now, as on a new install: the most stable channel with this build or a newer one. ${asks} Until one is chosen no update is offered: pick a channel and MyOrbiter looks for its updates at once. Nothing is saved while your settings can't be read, so the channel chosen now is kept until MyOrbiter restarts, and your saved settings are read again then.`;
  return `${CHANNEL_LABEL[shown]} is shown, but no channel is chosen yet: MyOrbiter is still finding out which to start on, the most stable channel with this build or a newer one. ${asks} Until one is chosen no update is offered: pick a channel and MyOrbiter looks for its updates at once, and that channel stays.`;
}

const VERSION = /^\d+\.\d+\.\d+$/;

/** The update settings as saved, with anything unexpected put back to its default. */
export function sanitizeUpdates(raw: unknown): UpdateSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const from = r.from && typeof r.from === "object" ? (r.from as Record<string, unknown>) : null;
  return {
    channel: isChannel(r.channel) ? r.channel : "stable",
    later: typeof r.later === "string" && VERSION.test(r.later) ? r.later : "",
    lastCheck: typeof r.lastCheck === "number" && Number.isFinite(r.lastCheck) && r.lastCheck > 0 ? r.lastCheck : null,
    from: from && typeof from.version === "string" && VERSION.test(from.version) && isChannel(from.channel) ? { version: from.version, channel: from.channel } : null,
    // Saved settings keep their channel: only a new install that hasn't settled yet saves false
    // (a start after a damaged settings file is one too; one whose file couldn't be read saves
    // nothing).
    picked: r.picked !== false,
    // Only a channel recorded as chosen by MyOrbiter (or followed on the player's word) follows;
    // settings saved before this was recorded don't say, so their channel counts as picked by hand.
    // Read only once `picked`: an unsettled install follows once its first check settles it
    // (`Updates.settle`), and a pick by hand meanwhile clears it.
    follows: r.follows === true,
  };
}

/** Compares two x.y.z versions by number (0.1.9 < 0.1.52); a leading "v" is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** The build number of a CI build ("0.2.52" → 52); null for a local build (0.1.0) or anything else. */
export function buildNumber(version: string): number | null {
  const m = /^0\.2\.(\d+)$/.exec(version);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

/** The release page of a build: on GitHub, or on GitLab for a build GitLab made; the list of
 *  releases for a local build or one made before the move to GitLab. */
export function releasePage(version: string): string {
  const n = buildNumber(version);
  if (n && n >= FIRST_GITHUB_BUILD) return `${REPO_URL}/releases/tag/build-${n}`;
  if (n && n >= FIRST_GITLAB_BUILD) return `${GITLAB_URL}/-/releases/build-${n}`;
  return `${REPO_URL}/releases`;
}

/**
 * Whether the notice for `version` shows: not when that version was put off with Later. Only that
 * one: a version a channel's file once named (a high number, for a while) mustn't keep every build
 * below it quiet, so a lower one offered later shows, and so does a newer one.
 */
export const noticeShows = (version: string, later: string) => !later || compareVersions(version, later) !== 0;

/**
 * The channel the running build came from, as far as MyOrbiter knows: the one it was installed from
 * through the updater; "local" for a build made here (0.1.0); else the channel chosen in Settings
 * (a build downloaded by hand doesn't say which channel it was on).
 */
export function cameFrom(version: string, u: UpdateSettings): Channel | "local" {
  if (buildNumber(version) == null) return "local";
  if (u.from && u.from.version === version) return u.from.channel;
  return u.channel;
}

/**
 * "0.2.52 · Experimental", "0.1.0 · local build"; "0.2.52 · channel not chosen yet" on a new install
 * that hasn't settled its channel (the one Settings shows meanwhile was never chosen).
 */
export function versionLine(version: string, u: UpdateSettings): string {
  const c = cameFrom(version, u);
  if (c !== "local" && !u.picked && !(u.from && u.from.version === version)) return `${version} · channel not chosen yet`;
  return `${version} · ${c === "local" ? "local build" : CHANNEL_LABEL[c]}`;
}

/**
 * Release notes as lines to show: blank ones dropped, at most `max`. They're commit subjects, some
 * written by contributors: hidden and bidi characters go, and each line is capped (core/untrusted.ts).
 */
export const noteLines = (notes: string | null | undefined, max = 6) =>
  (notes ?? "")
    .split("\n")
    .map((l) => cleanLine(l.replace(/^[-*•]\s*/, ""), 200))
    .filter((l): l is string => !!l)
    .slice(0, max);

/** How a copy of MyOrbiter was installed (updates.rs `Install`), as the app reports it. */
export type Install =
  | { how: "appImage"; path: string }
  | { how: "readOnly"; folder: string }
  | { how: "windows" }
  | { how: "package" }
  | { how: "dev" }
  | { how: "manual" }
  | { how: "mac" };

/** Whether this install checks for updates, and whether it can install them. */
export const installChecks = (i: Install) => i.how === "appImage" || i.how === "readOnly" || i.how === "windows";
export const installInstalls = (i: Install) => i.how === "appImage" || i.how === "windows";

/** Why this copy doesn't update itself, in a sentence; null when it does. */
export function installNote(i: Install): string | null {
  switch (i.how) {
    case "appImage":
    case "windows":
      return null;
    case "readOnly":
      return `Updates are checked, but MyOrbiter can't replace its own file: ${i.folder} isn't writable. Move the AppImage to a folder you own, or download new builds by hand.`;
    case "package":
      return "Updates come from your package manager.";
    case "dev":
      return "Updates aren't available in dev builds.";
    case "mac":
      return "On macOS, download a new build by hand: the updater doesn't carry Mac builds.";
    case "manual":
      return "This copy wasn't installed from the AppImage or the Windows installer, so it can't update itself. Update it the way you installed it.";
  }
}

/** "just now", "12 min ago", "3 h ago", "2 d ago"; "not yet" before the first check. */
export function checkedAgo(at: number | null, now: number): string {
  if (at == null) return "not yet";
  const m = Math.floor((now - at) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
