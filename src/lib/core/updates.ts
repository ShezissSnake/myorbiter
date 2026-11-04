// Release channels and the rules around updates, without the app: which channel is which, how
// versions compare, what the settings may hold, and where a build's release page is. The app side
// (asking for and installing updates) is lib/updates.svelte.ts and src-tauri/src/updates.rs.
//
// Every build CI makes is version 0.1.<build number>, the number of its `build-<n>` release, and
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

/** How often orbiter looks for an update while it runs. */
export const CHECK_EVERY = 6 * 60 * 60 * 1000;

export const REPO_URL = "https://github.com/ShezissSnake/orbiter";

/** What the settings keep about updates. */
export interface UpdateSettings {
  /** The channel updates come from. */
  channel: Channel;
  /** A version put off with Later: its notice stays away until a newer one comes. "" for none. */
  later: string;
  /** When the last check answered (ms), whether or not it found anything. */
  lastCheck: number | null;
  /** The build last installed through the updater, and the channel it came from. */
  from: { version: string; channel: Channel } | null;
}

export const defaultUpdates = (): UpdateSettings => ({ channel: "stable", later: "", lastCheck: null, from: null });

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

/** The build number of a CI build ("0.1.52" → 52); null for a local build (0.1.0) or anything else. */
export function buildNumber(version: string): number | null {
  const m = /^0\.1\.(\d+)$/.exec(version);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

/** The release page of a build, or the list of releases for a local build. */
export function releasePage(version: string): string {
  const n = buildNumber(version);
  return n ? `${REPO_URL}/releases/tag/build-${n}` : `${REPO_URL}/releases`;
}

/** Whether the notice for `version` shows: not when it (or something newer) was put off with Later. */
export const noticeShows = (version: string, later: string) => !later || compareVersions(version, later) > 0;

/**
 * The channel the running build came from, as far as orbiter knows: the one it was installed from
 * through the updater; "local" for a build made here (0.1.0); else the channel chosen in Settings
 * (a build downloaded by hand doesn't say which channel it was on).
 */
export function cameFrom(version: string, u: UpdateSettings): Channel | "local" {
  if (buildNumber(version) == null) return "local";
  if (u.from && u.from.version === version) return u.from.channel;
  return u.channel;
}

/** "0.1.52 · Experimental", "0.1.0 · local build". */
export function versionLine(version: string, u: UpdateSettings): string {
  const c = cameFrom(version, u);
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

/** How a copy of orbiter was installed (updates.rs `Install`), as the app reports it. */
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
      return `Updates are checked, but orbiter can't replace its own file: ${i.folder} isn't writable. Move the AppImage to a folder you own, or download new builds by hand.`;
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
