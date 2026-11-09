// The automatic actions on warframe.market besides repricing, in one line each: what the switch
// does on the site. Settings (Trades) and Orders show the same lines, so the two can't drift apart.
// Both are off for a new install and stay off until the player turns them on (backend.ts,
// marketSafetyOf: only an explicit true survives loading).

/** `autoTrades`: a sale read from the game's log closes or lowers the listing it sold from. */
export const AUTO_TRADES_LINE =
  "Off unless you turn it on. On: when a trade in game shows you gave items for platinum, MyOrbiter marks the listing it sold from sold on warframe.market (recorded on your profile there) and logs the sale.";

/** `autoRep`: +rep is a review on the partner's warframe.market profile, posted as you. */
export const AUTO_REP_LINE =
  "Off unless you turn it on. On: each player you trade with in game gets +rep on warframe.market, a review on their profile with your +rep message, posted as you, once per player. Off: a +rep button shows after each trade instead.";
