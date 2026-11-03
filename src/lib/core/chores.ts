// The daily and weekly chores on Home's "Worth doing today", ticked off by hand: the game's
// inventory doesn't say whether this week's Sortie or Archon Hunt is done, so the player says.
// A tick is kept as the moment that chore resets (its worldstate expiry, or the weekly reset):
// it counts while that moment is still ahead, and clears itself when it passes, with nothing
// to reset by hand.

/** Chore key → the reset (ms since 1970) the tick was made for. */
export type ChoreTicks = Record<string, number>;

/** Ticked for this round of the chore: made for the same reset, and that reset is still ahead. */
export function isDone(ticks: ChoreTicks, key: string, resets: string | number | null | undefined, now = Date.now()): boolean {
  const at = typeof resets === "string" ? Date.parse(resets) : resets;
  if (at == null || !Number.isFinite(at)) return false;
  return ticks[key] === at && at > now;
}

/**
 * Ticks (or unticks) one chore and drops ticks whose reset has passed, so the record never grows.
 * Returns a new object, for a settings store that saves on assignment.
 */
export function setDone(ticks: ChoreTicks, key: string, resets: string | number, on: boolean, now = Date.now()): ChoreTicks {
  const at = typeof resets === "string" ? Date.parse(resets) : resets;
  const out: ChoreTicks = {};
  for (const [k, v] of Object.entries(ticks)) if (k !== key && typeof v === "number" && v > now) out[k] = v;
  if (on && Number.isFinite(at) && at > now) out[key] = at;
  return out;
}
