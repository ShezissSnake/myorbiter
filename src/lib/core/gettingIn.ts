// Getting in: what leaving the setup page does to the automatic actions. App.svelte acts on it;
// nothing here touches the app, so tests can run it.

/** Saving the settings failed: the write itself, or nothing is saved because the saved settings couldn't be read at start. */
export interface SaveTrouble {
  unreadable: boolean;
  /** The error, in the system's words. */
  cause: string;
}

/**
 * The banner's words, shown over every page, the setup page and the "Can't read" pages included.
 * A write that failed is tried again 15 s later (backend.ts, flushSettings); settings that
 * couldn't be read at start are never saved over, and only a restart reads them again.
 */
export function saveTroubleWords(t: SaveTrouble): string {
  if (t.unreadable) return `MyOrbiter couldn't read your saved settings (${t.cause}), so it doesn't save over them: what you change now isn't kept. Restart MyOrbiter to read them again.`;
  return `Couldn't save your settings (${t.cause}): what you change now may not be kept. MyOrbiter keeps trying.`;
}

/** The three automatic actions on warframe.market (Settings, warframe.market). */
export interface AutoSwitches {
  auto: boolean;
  autoTrades: boolean;
  autoRep: boolean;
}
const NAMES: Record<keyof AutoSwitches, string> = { auto: "Apply automatically", autoTrades: "automatic trades", autoRep: "automatic +rep" };

/**
 * Leaving the setup page: Finish later (or Esc), or "Not now: overlay only". `firstStart`: this
 * start began with the first start's question, or it was never answered. The switches as they
 * become, and the names of those that were on and are now off.
 *
 * Finish later switches every automatic action off, first start or not, until the player turns
 * them on again: MyOrbiter then runs on an empty collection, and the timed repricing pass would
 * still run on it, with the player's own floors but without the ones that come from item data.
 * "Not now: overlay only" switches them off on a first start only. Nothing is ever switched on.
 */
export function leaveSetup(how: "later" | "overlay", m: AutoSwitches, firstStart: boolean): { next: AutoSwitches; off: string[] } {
  if (how === "overlay" && !firstStart) return { next: { ...m }, off: [] };
  const off = (Object.keys(NAMES) as (keyof AutoSwitches)[]).filter((k) => m[k]).map((k) => NAMES[k]);
  return { next: { auto: false, autoTrades: false, autoRep: false }, off };
}
