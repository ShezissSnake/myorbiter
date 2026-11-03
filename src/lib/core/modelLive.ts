// The worldstate the collection is built with. The collection (model.ts) reads only a little of it:
// the fissures (Relics, Wishlist), Baro (Parts, his stock) and Varzia (relics in resurgence). A
// worldstate read comes every few minutes and with every sync, and most change none of that
// (bounties, cycles and alerts change far more often). Each new collection redoes every page's rows,
// so the collection is rebuilt only when what it reads changed: the same object otherwise.
import type { Live } from "./types";

/** What of the worldstate the collection reads. */
export function liveForModel(live: Live): Live {
  return { fissures: live.fissures, resurgence: live.resurgence, resurgenceExpiry: live.resurgenceExpiry, baro: live.baro ?? null };
}

/** A key that changes when what the collection reads changes, and only then. */
function keyOf(l: Live): string {
  // A fissure's own fields only: the feed also sends a countdown ("eta") that changes every read.
  const fissures = l.fissures?.map((f) => [f.id, f.node, f.missionType, f.enemy, f.tier, f.tierNum, f.isStorm, f.isHard, f.expiry]) ?? null;
  const resurgence = l.resurgence?.map((v) => [v.uniqueName, v.item, v.ducats ?? null, v.credits ?? null]) ?? null;
  const b = l.baro ?? null;
  const baro = b ? [b.activation, b.expiry, b.location, b.inventory?.map((i) => [i.uniqueName, i.item, i.ducats, i.credits]) ?? null] : null;
  return JSON.stringify([fissures, resurgence, l.resurgenceExpiry, baro]);
}

/**
 * The worldstate for the collection, after `next` was read: `kept` itself when what the collection
 * reads is the same in both (so it isn't rebuilt), else the new one.
 */
export function keepModelLive(kept: Live | null, next: Live): Live {
  const fresh = liveForModel(next);
  return kept && keyOf(kept) === keyOf(fresh) ? kept : fresh;
}
