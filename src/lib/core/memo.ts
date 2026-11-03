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
 */
export function perModel<F extends (m: Model, ...rest: never[]) => unknown>(fn: F, key: (...rest: Rest<F>) => string): F {
  const cache = new WeakMap<Model, Map<string, ReturnType<F>>>();
  return ((m: Model, ...rest: Rest<F>) => {
    let byKey = cache.get(m);
    if (!byKey) cache.set(m, (byKey = new Map()));
    const k = key(...rest);
    if (byKey.has(k)) return byKey.get(k);
    const out = (fn as unknown as (m: Model, ...a: Rest<F>) => ReturnType<F>)(m, ...rest);
    byKey.set(k, out);
    return out;
  }) as F;
}
