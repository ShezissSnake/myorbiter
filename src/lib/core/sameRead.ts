// A sync (or the stamp poll) reads TennoScope's data again, and most often finds what was read
// last: the same inventory, prices and time. The read is a new object all the same, and a new
// object rebuilds the model and every page's rows from it. So a read is compared with the one
// held by its content: the same `observed_at`, the same catalogs (bundleLoader in backend.ts hands
// back the objects it holds while their revision stays) and the same inventory and prices.
import type { Bundle } from "./types";

/** FNV-1a over the string's UTF-16 units, from `seed`: 32 bits. */
function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * What a read holds that changes from one read to the next (its time, inventory and prices), as a
 * short key: the length of its JSON and two 32-bit hashes of it. The catalogs aren't in it: they're
 * compared by identity (`sameRead`).
 */
export function readKey(b: Bundle): string {
  const s = JSON.stringify([b.observed_at, b.inventory, b.prices]);
  return `${s.length}:${fnv(s, 0x811c9dc5).toString(36)}:${fnv(s, 0x9e3779b9).toString(36)}`;
}

/**
 * Whether `next` (whose key is `nextKey`) holds what `held` (key `heldKey`) holds, so the model
 * built from `held` stands: the same time, the same catalog and relic objects, the same key.
 */
export function sameRead(held: Bundle | null, heldKey: string | null, next: Bundle, nextKey: string): boolean {
  return !!held && heldKey != null && heldKey === nextKey && held.observed_at === next.observed_at && held.catalog === next.catalog && held.relics === next.relics;
}
