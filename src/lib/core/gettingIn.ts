// Getting in: what leaving the setup page does to the automatic actions. App.svelte acts on it;
// nothing here touches the app, so tests can run it.

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
