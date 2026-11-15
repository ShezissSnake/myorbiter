// Sync's word between syncs, beside its picture in the full sidebar's foot: how the last sync of
// your game data (TennoScope's read, or its saved data) ended. It says nothing of the world state
// or of warframe.market: those load on their own and their cards say how they went.

/** How the last sync ended: failed (with the button's short word, if it had one) or done (its word). */
export type SyncEnd = { failed: true; short: string | null } | { failed: false; note: string | null };

/** Done, but without a new read: the button's own words for it, kept until a later sync succeeds. */
export const SYNC_PARTIAL = ["Old read", "No read"] as const;

/**
 * The idle word. A sync that failed, got no answer or no new read keeps its word ("Not synced"
 * when it had none) until a later sync succeeds; so does saved data that couldn't be read.
 * "Up to date" only once the data is in and nothing since says otherwise.
 */
export function syncIdleWord(last: SyncEnd | null, readFailed: boolean, loaded: boolean): string {
  if (last?.failed) return last.short ?? "Not synced";
  if (last && (SYNC_PARTIAL as readonly (string | null)[]).includes(last.note)) return last.note!;
  if (readFailed) return "Not synced";
  return loaded ? "Up to date" : "Waiting…";
}
