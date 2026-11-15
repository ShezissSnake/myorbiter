// How old the world state shown is, and what it couldn't give: what the fissure boards, Watching
// and Home say instead of an empty list, and whether it's current enough to announce from.
import { fissureCounts } from "./board";
import type { Fissure, Live } from "./types";

/** The last world-state read: when it landed (null: none yet), whether the latest read failed, whether one landed since start. */
export interface WorldRead {
  at: number | null;
  error: string | null;
  read: boolean;
}

/**
 * The world state is read every 5 minutes: one older than two of those wasn't refreshed when it
 * should have been (the computer slept, or the reads failed), and what it holds may have ended
 * since without the next of it known.
 */
export const LIVE_CURRENT_MS = 10 * 60_000;

/**
 * The world state shown is current enough to announce from: read since start, the latest read
 * didn't fail, and it isn't older than LIVE_CURRENT_MS. Until a fresh read lands, what the 30 s
 * prune takes out of an old one isn't a change in the game.
 */
export function liveCurrent(read: WorldRead, now: number): boolean {
  return read.read && !read.error && read.at != null && now - read.at <= LIVE_CURRENT_MS;
}

/**
 * The fissure list is out of date rather than empty: no fissure in it is open, and either it held
 * some that have all closed, or it isn't current (liveCurrent). What a board says instead of "none open".
 */
export function fissuresOutOfDate(fissures: Fissure[] | null, read: WorldRead, now: number): boolean {
  if (fissures == null) return false;
  const c = fissureCounts(fissures, now);
  if (c.normal + c.steel + c.storm > 0) return false;
  return fissures.length > 0 || !liveCurrent(read, now);
}

/** The parts of the world state Home would show that couldn't be read, by where they'd be: names, capitalised. */
export interface Unread {
  /** Needs you (and Watching's Alerts): "Alerts", "Invasions". */
  needs: string[];
  /** Worth doing today: "The Circuit", "Darvo's deal", "Teshin's offer", "Nightwave". */
  today: string[];
  events: string[];
  /** The clocks the game's own file doesn't hold: "The Zariman's clock", "Duviri's mood". */
  clocks: string[];
}

/**
 * What the world state shown lacks of the parts only api.warframestat.us gives (the game's own
 * file has none of them): each would vanish from Home without a word. Nothing while the first
 * read is on its way.
 */
export function unreadParts(live: Live, read: WorldRead): Unread {
  if (read.at == null && !read.error) return { needs: [], today: [], events: [], clocks: [] };
  const has = (k: string) => (live.cycles ?? []).some((c) => c.key === k);
  return {
    needs: [live.alerts == null && "Alerts", live.invasions == null && "Invasions"].filter((x): x is string => !!x),
    today: [live.duviriCycle == null && "The Circuit", live.darvo == null && "Darvo's deal", live.steelPath == null && "Teshin's offer", live.nightwave == null && "Nightwave"].filter((x): x is string => !!x),
    events: live.events == null ? ["Events"] : [],
    clocks: [!has("zariman") && "The Zariman's clock", !has("duviri") && "Duviri's mood"].filter((x): x is string => !!x),
  };
}

/** "Alerts and invasions couldn't be read just now." */
export function couldntRead(names: string[]): string {
  // After the first, the common nouns start small ("Alerts and invasions"); Nightwave and Darvo keep theirs.
  const xs = names.map((x, i) => (i === 0 ? x : /^(Alerts|Invasions|Events)$/.test(x) ? x.toLowerCase() : x.replace(/^The /, "the ")));
  const list = xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  return `${list} couldn't be read just now.`;
}

/**
 * The Alerts card in Watching: what it says beside (or instead of) its list. `nothing`: it lists
 * nothing. Alerts or invasions that couldn't be read are said as that, never as nothing needing you.
 */
export function watchingAlertsNote(live: Live, read: WorldRead, nothing: boolean): string | null {
  if (read.at == null && !read.error && (live.alerts == null || live.invasions == null)) return nothing ? "Reading the worldstate…" : null;
  const unread = unreadParts(live, read).needs;
  if (unread.length) return couldntRead(unread);
  return nothing ? "Nothing that needs you right now." : null;
}
