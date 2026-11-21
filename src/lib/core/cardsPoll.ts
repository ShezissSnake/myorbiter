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
