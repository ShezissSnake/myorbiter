// Automatic repricing changes a listing's price only when it has drifted. Three rules, checked
// after the floors (yours, the minimum, a relic's crack value, a prime part's ducats, and the 70%
// of the price you last set), so a listing that sits on a floor never changes by itself:
//
// - The target ignores bait: the second-lowest price among sellers who are online or in game
//   (one order each), never the single lowest. With three or more sellers that is the median of
//   the three lowest; with one seller there is no target and the price stays.
// - A dead band: no change unless the gap from the listing's price to the target is more than
//   the larger of 2 platinum and 5% of the listing's price.
// - A cooldown: at most one change per listing an hour, and at most six a day. The changes are
//   kept in your settings, so a restart doesn't start the count again.
//
// warframe.market calls automation a grey area. With these rules a listing changes a few times a
// day at most, within bounds that can be stated in a sentence. The numbers live here only.

/** The rules' numbers. */
export const DRIFT = {
  /** The dead band: a change needs a gap of more than this many platinum… */
  bandPlat: 2,
  /** …and more than this share of the listing's price, whichever is larger. */
  bandShare: 0.05,
  /** At most one change per listing in this long (an hour). */
  cooldownMs: 60 * 60_000,
  /** At most this many changes per listing… */
  perDay: 6,
  /** …in this long (a day). */
  dayMs: 24 * 60 * 60_000,
} as const;

/** "an hour", "every 2 hours", "every 30 minutes": how often a listing may change. */
export function every(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min === 60) return "an hour";
  return min % 60 === 0 ? `every ${min / 60} hours` : `every ${min} minutes`;
}

/** The dead band, in words: "2p or 5% (whichever is more)". */
export const BAND_WORDS = `${DRIFT.bandPlat}p or ${Math.round(DRIFT.bandShare * 100)}% (whichever is more)`;

/** The plain sentence Settings, Orders and the Guide show. */
export const DRIFT_RULES =
  `A price changes only when it has drifted more than ${BAND_WORDS} from the second-cheapest seller online or in game, ` +
  `at most once ${every(DRIFT.cooldownMs)} and ${DRIFT.perDay} times a day per listing`;

/** Said beside the switch, in Settings and on Orders. */
export const GREY_AREA = "warframe.market calls automation like this a grey area and may limit apps that do it";

/** The gap a change has to beat, for a listing at `current`. */
export const deadBand = (current: number) => Math.max(DRIFT.bandPlat, current * DRIFT.bandShare);

/** Whether moving a listing from `current` to `target` is a change worth sending. */
export const drifted = (current: number, target: number) => Math.abs(target - current) > deadBand(current);

/**
 * The bait-proof target among `prices` (one per seller, any order): the second-lowest, which is
 * the median of the three lowest once there are three. Null with fewer than two sellers.
 */
export function baitProof(prices: number[]): number | null {
  if (prices.length < 2) return null;
  return [...prices].sort((a, b) => a - b)[1];
}

/** When each listing (by listingKey) was changed in the last day, oldest first. */
export type ChangeLog = Record<string, number[]>;

export type Cooldown =
  | { ok: true }
  /** Not before `until`: changed within the hour, or already six times today. */
  | { ok: false; until: number; why: "hour" | "day" };

/** Whether a listing changed at `times` may change again at `now`. */
export function cooldown(times: readonly number[] | undefined, now: number): Cooldown {
  // Times ahead of now (a clock set back) count too: they hold the listing longer, never less.
  const day = (times ?? []).filter((t) => t > now - DRIFT.dayMs).sort((a, b) => a - b);
  const last = day[day.length - 1];
  if (last != null && now - last < DRIFT.cooldownMs) return { ok: false, until: last + DRIFT.cooldownMs, why: "hour" };
  if (day.length >= DRIFT.perDay) return { ok: false, until: day[day.length - DRIFT.perDay] + DRIFT.dayMs, why: "day" };
  return { ok: true };
}

/** The log with a change to `key` at `now` added, and anything older than a day dropped. */
export function noteChange(log: ChangeLog | undefined, key: string, now: number): ChangeLog {
  const kept = changesOf(log, now);
  return { ...kept, [key]: [...(kept[key] ?? []), now] };
}

/**
 * Saved changes, from a settings file: per listing, the times of the last day only (whole
 * milliseconds; one ahead of now, from a clock set back, counts as now), oldest first, at most a
 * day's worth. Anything else is dropped, never read as permission to change sooner.
 */
export function changesOf(raw: unknown, now: number): ChangeLog {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ChangeLog = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    // A time ahead of now (a clock set back) counts as a change just now: it never frees the listing sooner.
    const times = v.filter((t): t is number => Number.isInteger(t) && t > now - DRIFT.dayMs).map((t) => Math.min(t, now)).sort((a, b) => a - b);
    if (times.length) out[key] = times.slice(-DRIFT.perDay);
  }
  return out;
}
