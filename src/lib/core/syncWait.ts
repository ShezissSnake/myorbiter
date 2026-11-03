// Sync: TennoScope is asked to read the inventory from the game, and the new read lands in its
// folder a few seconds later. The sync is over when that new read is there (the folder's data
// stamp changes), not after a fixed wait: a slow read isn't cut short, a quick one isn't padded.

/** How long a sync waits for the new read before saying it didn't come. */
export const SYNC_LIMIT_MS = 30_000;
/** How often the stamp is looked at meanwhile. */
export const SYNC_EVERY_MS = 1_000;

/**
 * How full the Sync button is while it waits, by time: past the first step (asking) it eases
 * toward 0.8 and never gets there, so the last fifth is left for the read actually arriving.
 */
export function syncFill(elapsedMs: number, limitMs = SYNC_LIMIT_MS): number {
  const t = Math.max(0, elapsedMs) / limitMs;
  return 0.15 + 0.65 * (1 - Math.exp(-3 * t));
}

export interface WaitOptions {
  every?: number;
  limit?: number;
  /** A reason to stop waiting (TennoScope reported an error), or null to go on. */
  abort?: () => string | null;
  /** Called after each look with the time waited so far. */
  onTick?: (elapsedMs: number) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Looks at the data stamp every second until it differs from `before`. Returns the new stamp;
 * throws when it doesn't change in time, or when `abort` gives a reason. A look that fails (the
 * folder is briefly missing while TennoScope writes) just counts as no change yet.
 */
export async function waitForNewRead(read: () => Promise<number | null>, before: number | null, o: WaitOptions = {}): Promise<number | null> {
  const every = o.every ?? SYNC_EVERY_MS;
  const limit = o.limit ?? SYNC_LIMIT_MS;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  for (;;) {
    const why = o.abort?.();
    if (why) throw new Error(why);
    let stamp: number | null | undefined;
    try {
      stamp = await read();
    } catch {
      stamp = undefined;
    }
    if (stamp !== undefined && stamp !== before) return stamp;
    const waited = now() - start;
    o.onTick?.(waited);
    if (waited >= limit) throw new Error(`No new read from TennoScope within ${Math.round(limit / 1000)} seconds. If it's still reading, orbiter picks the read up when it lands.`);
    await sleep(every);
  }
}
