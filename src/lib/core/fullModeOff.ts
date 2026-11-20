// The inventory is missing because Full mode is off: TennoScope reports a mode other than Full
// (the player answered "Not now" at the first start, or turned it off), and nothing was ever
// read. Sync can't fill it then, so the banner, the empty pages, Home's Ready to list and Sync's
// own word say this one thing instead of "press Sync".

/**
 * Whether the inventory is missing because Full mode is off. `fullMode` is TennoScope's report
 * (`mkt.fullMode`): null with no report (TennoScope off, a console, macOS), which keeps its own
 * words. `nothingRead`: no inventory was read at all (`noInventoryRead`).
 */
export const fullModeOff = (fullMode: boolean | null, nothingRead: boolean): boolean => fullMode === false && nothingRead;

/** The one sentence, said wherever the inventory would show. */
export const FULL_MODE_OFF = "No inventory: Full mode is off, so TennoScope doesn't read it. It's switched on in Settings, TennoScope.";

/** Home's Ready to list with no inventory read, Full mode on or not known: what's spare isn't known yet. */
export const NO_READ_YET = "No inventory read yet: what you can spare shows once TennoScope reads it.";

/** Sync's word while Full mode is off and nothing was read. */
export const SYNC_FULL_MODE_OFF = "Full mode off";

/** An empty text: its own (`plain`), or the one sentence while Full mode is off and nothing was read. */
export const emptyText = (plain: string, off: boolean): string => (off ? FULL_MODE_OFF : plain);
