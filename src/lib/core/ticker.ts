// The Trade pages' ticker tape (ui/Ticker.svelte): which figures moved since you last looked. The
// last-seen values are kept in memory for the session, by tape and figure; nothing is stored.

export type Move = "up" | "down";

/** Each figure that changed between two looks: up or down. A figure that wasn't known then, or isn't now, didn't move. */
export function moves(before: ReadonlyMap<string, number | null> | undefined, now: ReadonlyMap<string, number | null>): Map<string, Move> {
  const out = new Map<string, Move>();
  if (!before) return out;
  for (const [k, v] of now) {
    const was = before.get(k);
    if (v == null || was == null || !Number.isFinite(v) || !Number.isFinite(was) || v === was) continue;
    out.set(k, v > was ? "up" : "down");
  }
  return out;
}

/** What each tape showed when you last looked away from it, for the session. */
export class LastSeen {
  private seen = new Map<string, Map<string, number | null>>();
  get(tape: string): ReadonlyMap<string, number | null> | undefined {
    return this.seen.get(tape);
  }
  /** Remembers what the tape shows now (you're looking away, or have just seen it change). */
  set(tape: string, values: ReadonlyMap<string, number | null>) {
    const prev = this.seen.get(tape);
    // A figure still loading keeps what was last seen of it.
    const next = new Map(prev ?? []);
    for (const [k, v] of values) if (v != null || !next.has(k)) next.set(k, v);
    this.seen.set(tape, next);
  }
}
