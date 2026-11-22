// The reward screen's file (TennoScope's `tennoscope-reward-screen.json`): the page asks for it
// every 0.8 s, since the reward screen gives the player 15 s to choose. That pace is only worth it
// while a TennoScope can be writing the file.

/** The page's tick for the cards poll. */
export const CARDS_TICK_MS = 800;
/** The slow pace: once in this long. */
export const CARDS_SLOW_MS = 5_000;

export interface CardsPollState {
  now: number;
  /** When the file was last asked for (0: never). */
  last: number;
  /** A read is still under way. */
  polling: boolean;
  console: boolean;
  /** TennoScope's report, if one reports now (null: none running, or none reporting yet). */
  report: { game_running: boolean } | null;
}

/**
 * Whether the cards poll asks for the file on this tick: never on a console account (the game isn't
 * on this computer), at the slow pace while no TennoScope reports or the one that does says the
 * game is closed, else on every tick.
 */
export function cardsPollDue(s: CardsPollState): boolean {
  if (s.polling || s.console) return false;
  const slow = !s.report || s.report.game_running === false;
  return !(slow && s.now - s.last < CARDS_SLOW_MS);
}

/**
 * Whether the page's `clock` moves on this tick. It moves with a read, at least once in
 * CARDS_SLOW_MS without one, and on the first tick at or past a deadline it passed: the +rep
 * offers' windows end there, and they end on time (within a tick), not up to 5 s late. It also
 * follows the computer's clock set back (now before it), at once, so the offers don't close early.
 */
export function clockMoves(o: { now: number; clock: number; due: boolean; deadlines: readonly number[] }): boolean {
  return o.due || o.now < o.clock || o.now - o.clock >= CARDS_SLOW_MS || o.deadlines.some((d) => d > o.clock && d <= o.now);
}
