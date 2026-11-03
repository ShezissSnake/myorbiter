// Whether EE.log's fissure is still going. The log says when relics load and reward screens open,
// but not when you leave for the Orbiter or the game closes: a squad loaded hours ago would stay
// "live" until the next mission. With nothing in the log for a while, it's over.

import type { MissionState } from "./types";

/** No log line about the fissure for this long (a round is 5 minutes or less): it's over. */
export const MISSION_STALE_MS = 45 * 60_000;

/** When the log last said something about the fissure (Unix ms), when its clock is known. */
export function lastEventAt(ms: MissionState | null | undefined): number | null {
  if (!ms || ms.session_start == null || ms.last_event == null) return null;
  return (ms.session_start + ms.last_event) * 1000;
}

/** In a fissure right now: relics loaded for a round, and the log heard from recently. */
export function inFissure(ms: MissionState | null | undefined, now = Date.now()): boolean {
  if (!ms?.relics.length) return false;
  const at = lastEventAt(ms);
  return at == null || now - at < MISSION_STALE_MS;
}
