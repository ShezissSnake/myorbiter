// Getting in: which page a start without a collection gets, what saving trouble says, and what
// leaving the setup page does to the automatic actions. App.svelte acts on it; nothing here
// touches the app, so tests can run it.

import { nothingYet } from "../backend";

/** TennoScope's data isn't where MyOrbiter looks: its folder or a file in it is missing. */
export const dataMissing = (e: string) => /not found at|os error [23]\b/i.test(e);

/**
 * A read error that means nothing has been read yet: the setup page's case. `readBefore`: an
 * inventory has been read here before. Then TennoScope's data missing from where MyOrbiter looks
 * (TennoScope reinstalled, its folder moved or deleted, a drive not there) is not "not read yet":
 * the "Can't read TennoScope's data" page says it can't be found, with the folder and Settings. A
 * TennoScope that runs and hasn't read an inventory yet is still the setup page's.
 */
export function notReadYet(e: string, readBefore: boolean): boolean {
  return nothingYet(e) && !(readBefore && dataMissing(e));
}

/**
 * A read that failed gives an empty collection instead of an error: nothing read yet and the
 * player chose to carry on without it, or TennoScope doesn't run here (a Mac, a console). Never
 * for data that's missing once an inventory has been read. `held`: a collection with an inventory
 * is on screen (a failed read keeps it, with a note).
 */
export function carryOnEmpty(o: { error: string; withoutInventory: boolean; noTennoScope: boolean; readBefore: boolean; held: boolean }): boolean {
  if (o.held || !nothingYet(o.error)) return false;
  if (o.noTennoScope) return true;
  return o.withoutInventory && notReadYet(o.error, o.readBefore);
}

/** "Continue without inventory" (or Finish later) after a read: it counts until an inventory is read. */
export function stillWithout(withoutInventory: boolean, read: { inventory: boolean }): boolean {
  return withoutInventory && !read.inventory;
}

/** What went wrong reading TennoScope's data, in words, when its data is missing (null otherwise). */
export function missingWords(e: string, folder: string, readBefore: boolean): string | null {
  if (readBefore && dataMissing(e)) return `MyOrbiter can't find TennoScope's data in ${folder}, where it read your inventory before. If TennoScope keeps it somewhere else now, set that folder in Settings, Where things are.`;
  const missing = /not found at (\S+?):? TennoScope/i.exec(e)?.[1];
  if (missing) return `TennoScope's data in ${folder} is missing ${missing.split(/[\\/]/).slice(-2).join("/")}, so MyOrbiter can't load it yet.`;
  if (/not found at|No dev bundle/i.test(e)) return `There's no TennoScope data in ${folder} yet.`;
  return null;
}

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
