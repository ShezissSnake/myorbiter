// Rows worked out once per collection. Several pages and helpers ask for the same rows of the same
// model (Home, Relics, the hover cards and the spare ledger all want relicRows; Inventory, Home and
// the bulk sale all want spareRows): each was worked out again by every caller, after every sync.
// A model never changes once built (a new read builds a new one), so the rows for a model and the
// same arguments are the same: kept per model (dropped with it), and handed out as they are.
// Callers must treat the rows as read-only, as they already do.
import type { Model } from "./model";

const ids = new WeakMap<object, number>();
let nextId = 1;
/** A key part for an object argument: its identity (a Map of drops, the market's index). */
export function idOf(o: object | null | undefined): string {
  if (o == null) return "-";
  let id = ids.get(o);
  if (id == null) ids.set(o, (id = nextId++));
  return `#${id}`;
}

type Rest<F> = F extends (m: Model, ...rest: infer A) => unknown ? A : never;

/**
 * `fn`, worked out once per model and `key` of the other arguments. `key` must tell apart every
 * argument that changes the result (use `idOf` for objects compared by identity).
 *
 * `rowKey`, for a function that returns a list of rows: each row of a new model's list that holds
 * just what a row of the same key held in the list worked out last is handed out as that row
 * (`keepRows`), and the whole list as the last one when every row is. A sync then changes only
 * the rows that changed, and a card drawn from a row that didn't has nothing to redo.
 */
export function perModel<F extends (m: Model, ...rest: never[]) => unknown>(fn: F, key: (...rest: Rest<F>) => string, rowKey?: (row: never) => string): F {
  const cache = new WeakMap<Model, Map<string, ReturnType<F>>>();
  /** The lists worked out last, by `key` (a few: a key that names an object changes with it). */
  const last = new Map<string, ReturnType<F>>();
  let lastAny: ReturnType<F> | undefined;
  return ((m: Model, ...rest: Rest<F>) => {
    let byKey = cache.get(m);
    if (!byKey) cache.set(m, (byKey = new Map()));
    const k = key(...rest);
    if (byKey.has(k)) return byKey.get(k);
    let out = (fn as unknown as (m: Model, ...a: Rest<F>) => ReturnType<F>)(m, ...rest);
    if (rowKey && Array.isArray(out)) {
      const before = last.get(k) ?? lastAny;
      if (Array.isArray(before)) out = keepRows(before, out, rowKey as (row: unknown) => string) as ReturnType<F>;
      last.delete(k);
      last.set(k, out);
      if (last.size > KEPT_LISTS) last.delete(last.keys().next().value!);
      lastAny = out;
    }
    byKey.set(k, out);
    return out;
  }) as F;
}

/** How many lists `perModel` keeps per function to keep rows from. */
const KEPT_LISTS = 4;

/**
 * `next`, with each row that holds just what the row of the same key in `before` holds (`sameData`)
 * replaced by that row; `before` itself when that's every row, in the same order.
 */
export function keepRows<T>(before: readonly T[], next: T[], key: (row: T) => string): T[] {
  if (!before.length) return next;
  const old = new Map<string, T>();
  for (const r of before) old.set(key(r), r);
  let all = next.length === before.length;
  const out = next.map((r, i) => {
    const o = old.get(key(r));
    if (o !== undefined && sameData(o, r)) {
      if (before[i] !== o) all = false;
      return o;
    }
    all = false;
    return r;
  });
  return all ? (before as T[]) : out;
}

/**
 * Whether `a` and `b` hold the same data: the same primitives, and plain objects and arrays holding
 * the same, to a few levels down. Anything else (a Map, a Set, a class, a function) only as itself.
 */
export function sameData(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || depth > 6) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i], depth + 1)) return false;
    return true;
  }
  const proto = Object.getPrototypeOf(a);
  if ((proto !== Object.prototype && proto !== null) || Object.getPrototypeOf(b) !== proto) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1)) return false;
  }
  return true;
}
