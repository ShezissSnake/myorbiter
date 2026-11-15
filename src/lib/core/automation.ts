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

/** The two lines above, short enough for Orders' automatic panel (the full lines are the switches' tooltips). */
export const AUTO_TRADES_SHORT = "Off unless you turn it on. A sale in game marks its listing sold on warframe.market and logs it.";
export const AUTO_REP_SHORT = "Off unless you turn it on. Each partner gets +rep on warframe.market once, posted as you.";

/** `lastCopy.optIn`: listings with one copy hidden on warframe.market while someone whispers you. */
export const LAST_COPY_LINE =
  "When anyone whispers you in game (a buyer, a friend, or you whispering a seller), MyOrbiter hides every listing you have one copy of, so a second buyer doesn't message you for one that's already promised. The game's log says who whispered, not what about, so that's usually most of your listings. Each comes back after the time below, and only if an inventory read newer than the whisper still has the copy; until then it stays hidden. With Full access while Warframe runs, Sync asks TennoScope for a read now, and a listing's Shown switch on Orders shows it at any time, with the checks any listing you show yourself gets. A later whisper doesn't make the wait longer, and one you show or hide yourself is left as you set it until the next whisper.";
