// Whether you need a reward, in the marks the reward screen uses (Current fissure): needed for
// mastery, completes a set (or leaves it one part short), on the wishlist, already held. Home's
// alerts and invasions show the same marks, decided by the same rules: a prime part as the
// reward screen decides it (pick.ts, `partNeed` and `setGap`), anything else as an alert's reward
// is (worldNeeds.ts, `masteryHelp`). Where the app has no record to go by (a resource such as
// Orokin Cells or Endo, a reward its data doesn't know), there are no marks: nothing is guessed.
import type { Model } from "./model";
import { normaliseStoreUnique } from "./model";
import { partNeed, resolveName, setGap } from "./pick";
import { masteryHelp } from "./worldNeeds";

export interface RewardMarks {
  /** Toward something you haven't mastered or built: its name, and the part's count held and needed (1 and 1 for the item itself). */
  need: { item: string; whole: boolean; have: number; needed: number } | null;
  /** A prime part that finishes a set (`missing` 1) or leaves it one part short (2). */
  set: { set: string; missing: number } | null;
  /** On your wishlist: the starred item's name (the reward itself, or what it builds). */
  wish: string | null;
  /** Copies you hold already; 0 when none, or when there is no record of it. */
  held: number;
}

/** Nothing to say about a reward. */
export const NO_MARKS: RewardMarks = { need: null, set: null, wish: null, held: 0 };

/** Whether any mark shows. */
export const anyMark = (k: RewardMarks) => !!(k.need || k.set || k.wish || k.held);

/**
 * The marks for one reward. `wishlist`: the starred items' unique names (settings.favourites).
 * A resource (a MiscItems path, or a name the catalog has no blueprint, part or item for) gets none.
 */
export function rewardMarks(m: Model, reward: { uniqueName?: string | null; name: string }, wishlist: readonly string[]): RewardMarks {
  const path = reward.uniqueName ? normaliseStoreUnique(reward.uniqueName) : null;
  if (path && /\/MiscItems\//.test(path)) return NO_MARKS;
  const name = resolveName(m, reward.name.replace(/\s+/g, " ").trim());
  const prime = m.partByName.get(name)?.[0];
  if (prime) {
    const need = partNeed(m, name);
    return {
      need: need ? { item: need.item, whole: false, have: need.have, needed: need.needed } : null,
      set: setGap(m, name),
      wish: wishlist.includes(prime.parentUnique) ? prime.parentName : null,
      held: need ? 0 : m.partHave(name),
    };
  }
  const help = masteryHelp(m, { uniqueName: reward.uniqueName ?? null, name: reward.name });
  // What it builds, or is, when the catalog knows it: for the wishlist and for what you hold.
  const own = path ? m.catalogByUnique.get(path) : undefined;
  const parent = help?.unique ?? own?.uniqueName ?? null;
  const known = !!(help || own || (path && /\/Recipes\//.test(path)));
  if (!known) return NO_MARKS;
  const heldNow = path ? (m.inventoryByBase.get(path) ?? []).reduce((n, r) => n + r.quantity, 0) || (m.inventoryByName.get(reward.name) ?? []).reduce((n, r) => n + r.quantity, 0) : (m.inventoryByName.get(reward.name) ?? []).reduce((n, r) => n + r.quantity, 0);
  return {
    need: help ? { item: help.item, whole: help.whole, have: help.have, needed: help.needed } : null,
    set: null,
    wish: parent && wishlist.includes(parent) ? (m.catalogByUnique.get(parent)?.name ?? null) : null,
    held: help ? 0 : heldNow,
  };
}

/** The marks in words, as the tags read and their tooltips say (one sentence each). */
export function markWords(k: RewardMarks): { text: string; tone: "warn" | "good" | "plain"; why: string }[] {
  const out: { text: string; tone: "warn" | "good" | "plain"; why: string }[] = [];
  if (k.need) out.push({ text: `need · ${k.need.item}`, tone: "warn", why: k.need.whole ? `${k.need.item} itself, which you haven't mastered.` : `A part for ${k.need.item}, which you haven't built or mastered, and you don't have enough of it (${k.need.have} of ${k.need.needed}).` });
  if (k.set) out.push(k.set.missing === 1 ? { text: "completes set", tone: "good", why: `The last part you're missing for a ${k.set.set} set.` } : { text: "set · one short", tone: "good", why: `Leaves your ${k.set.set} set one part short.` });
  if (k.wish) out.push({ text: "wishlist", tone: "good", why: `${k.wish} is on your wishlist.` });
  if (k.held) out.push({ text: `held · ${k.held}`, tone: "plain", why: `You hold ${k.held} already.` });
  return out;
}
