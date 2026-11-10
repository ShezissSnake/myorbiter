// What each meter last showed, so a meter whose value changed since can move from the old value to
// the new (design rule: a meter moves only when its value changed; unchanged, or never shown
// before, it stays still). Kept with the other interface state in the settings: a small list of
// [key, value] pairs, oldest first, at most METER_CAP long. Pure, so it can be tested.

/** The pairs kept, oldest first. */
export type MeterMemory = [string, number][];

/** At most this many meters are remembered; the one shown longest ago goes first. */
export const METER_CAP = 240;
/** A key longer than this isn't kept (a meter's key is short: "orders.trades", "arcane:Energize"). */
export const METER_KEY_MAX = 120;

/** The value a meter last showed, or undefined if it hasn't been shown (or was forgotten). */
export function recall(memory: MeterMemory, key: string): number | undefined {
  for (let i = memory.length - 1; i >= 0; i--) if (memory[i][0] === key) return memory[i][1];
  return undefined;
}

/**
 * Where a meter starts when it's shown now with `next`: the value it last showed if that differs,
 * null for no motion (never shown before, unchanged, or a value that isn't a number).
 */
export function moveFrom(last: number | undefined, next: number): number | null {
  if (last === undefined || !Number.isFinite(last) || !Number.isFinite(next)) return null;
  return last === next ? null : last;
}

/**
 * The memory with these meters' values as shown now: each moves to the newest end, and past the
 * cap the oldest go. Returns the same list when nothing changed, so saving can be skipped.
 */
export function remember(memory: MeterMemory, shown: Iterable<[string, number]>, cap = METER_CAP): MeterMemory {
  const fresh = new Map<string, number>();
  for (const [k, v] of shown) if (typeof k === "string" && k && k.length <= METER_KEY_MAX && Number.isFinite(v)) {
    fresh.delete(k);
    fresh.set(k, v);
  }
  if (!fresh.size) return memory;
  // Nothing new: every value is already the newest entries' and in that order.
  const tail = memory.slice(-fresh.size);
  const keys = [...fresh.keys()];
  if (tail.length === fresh.size && tail.every(([k, v], i) => k === keys[i] && v === fresh.get(k))) return memory;
  const kept = memory.filter(([k]) => !fresh.has(k));
  const next: MeterMemory = [...kept, ...fresh.entries()];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** The memory as read from a settings file: well-formed pairs only, each key once (its last), capped. */
export function meterMemoryOf(raw: unknown, cap = METER_CAP): MeterMemory {
  if (!Array.isArray(raw)) return [];
  const pairs = raw.filter((p): p is [string, number] => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && p[0].length > 0 && p[0].length <= METER_KEY_MAX && typeof p[1] === "number" && Number.isFinite(p[1]));
  return remember([], pairs, cap);
}
