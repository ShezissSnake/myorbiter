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
  // Which file, when it's one file: "there's no data" while TennoScope runs and reads reads as "TennoScope isn't there".
  const path = /not found at (\S+?):? TennoScope/i.exec(e)?.[1];
  const file = path?.split(/[\\/]/).slice(-2).join("/");
  // An inventory was read on this install, not necessarily from the folder set now (Settings can change it).
  if (readBefore && dataMissing(e)) return `MyOrbiter has read your inventory before, and now can't find TennoScope's data in ${folder}${file ? ` (${file} is missing)` : ""}. If TennoScope keeps it somewhere else, set that folder in Settings, Where things are.`;
  if (file) return `TennoScope's data in ${folder} is missing ${file}, so MyOrbiter can't load it yet.`;
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

/**
 * Where MyOrbiter's settings folder is on each system (Tauri's config folder for
 * `dev.myorbiter.app`; on Linux under `$XDG_CONFIG_HOME` when that is set).
 */
export const SETTINGS_FOLDER = {
  linux: "~/.config/dev.myorbiter.app, or $XDG_CONFIG_HOME/dev.myorbiter.app when that is set",
  windows: "%APPDATA%\\dev.myorbiter.app",
  macos: "~/Library/Application Support/dev.myorbiter.app",
} as const;

/** Which system the window runs on, from the web view's user agent, for `SETTINGS_FOLDER`. */
export const systemOf = (userAgent: string): keyof typeof SETTINGS_FOLDER => (/Windows/i.test(userAgent) ? "windows" : /Mac OS X|Macintosh/i.test(userAgent) ? "macos" : "linux");

/**
 * The banner's words after a damaged settings file was moved aside (`read_settings` in lib.rs):
 * shown over every page, the setup page and the "Can't read" pages included, until dismissed.
 * Nothing is read back from the old file by itself. "Was moved aside", not "is kept": the player
 * may have deleted it since. The platform is back on PC, unless the player is signed in to
 * warframe.market and it answers at this start: then the account sets it (App.svelte, after
 * mkt.init). An offline start leaves PC until a later start.
 */
export function movedAsideWords(name: string, system: keyof typeof SETTINGS_FOLDER): string {
  return `Your saved settings and records (sales, trades, value over time) couldn't be read, so MyOrbiter started with the usual settings, as on a first start. The old file was moved aside as ${name} in MyOrbiter's settings folder (${SETTINGS_FOLDER[system]}); nothing is read back from it. Look through Settings again, your platform first: it is back on PC, unless you are signed in to warframe.market and it answered as MyOrbiter started, when your account set it.`;
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
  // Only the three switches, whatever else `m` holds: the caller writes `next` back over them.
  if (how === "overlay" && !firstStart) return { next: { auto: m.auto, autoTrades: m.autoTrades, autoRep: m.autoRep }, off: [] };
  const off = (Object.keys(NAMES) as (keyof AutoSwitches)[]).filter((k) => m[k]).map((k) => NAMES[k]);
  return { next: { auto: false, autoTrades: false, autoRep: false }, off };
}

/** Each switch as Orders' Auto panel names it, where it is turned on again (Settings, Trades, has the same three). */
const SWITCH_LABEL: Record<keyof AutoSwitches, string> = { auto: "Apply automatically", autoTrades: "Mark sales sold from the game", autoRep: "Give +rep by itself" };

/**
 * What the player is told after leaving the setup page switched automatic actions off: `off` is
 * what `leaveSetup` returned. Null when nothing was switched off, so nothing is said.
 */
export function leftSetupNotice(how: "later" | "overlay", off: string[]): { title: string; body: string } | null {
  const keys = (Object.keys(NAMES) as (keyof AutoSwitches)[]).filter((k) => off.includes(NAMES[k]));
  if (!keys.length) return null;
  const names = keys.map((k) => SWITCH_LABEL[k]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const way = how === "overlay" ? "\"Not now: overlay only\"" : "Finish later";
  return {
    title: names.length === 1 ? "Automatic action switched off" : "Automatic actions switched off",
    body: `Leaving the setup page with ${way} switched off ${list}. ${names.length === 1 ? "It stays" : "They stay"} off until you turn ${names.length === 1 ? "it" : "them"} on again: on Orders, under the Auto line, or in Settings, Trades.`,
  };
}
