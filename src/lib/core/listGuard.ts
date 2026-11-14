// The last check before MyOrbiter puts copies up for sale on warframe.market: a new listing, a
// listing raised to more copies, or a hidden one shown again. It works the keep rules out again
// from the inventory as it is now, whatever path asked (the spares plan, the listing form, Orders,
// the last-copy timer), and refuses anything it can't prove is spare. Pure: the store sends or
// doesn't, and writes the line it returns to the log.
import { KIND_LABEL, ducatWorth, ducatsBeat, freeToList, kindOfItem, neverHeld, neverWhy, platToBeat, provenSpare, type Listed, type SpareContext } from "./bulk";
import { heldFor, type MarketItem } from "./market";
import type { Model } from "./model";

/** The refusal for something on the never-sell list, after "Didn't list Khra R0: ". */
export const NEVER_SOLD_REFUSAL = "it's on your never-sell list (Sell spares). Sell again takes it off the list, then it can be listed";
/** The refusal for a set held back by a part on the never-sell list, or a part by its set. */
const neverAcrossRefusal = (why: string, n: number) => `${why}. Sell again takes ${n === 1 ? "it" : "them"} off the list`;

/**
 * An inventory read older than this proves nothing for a listing MyOrbiter makes by itself: copies
 * may have been sold, traded, used or installed since. Full mode reads again after each trade.
 */
export const MAX_INVENTORY_AGE_MS = 3 * 60 * 60_000;

/**
 * A read time this far ahead of the clock proves nothing either: a time in the wrong unit or a
 * clock set wrong would otherwise count as fresh for as long as it stays ahead.
 */
export const MAX_CLOCK_AHEAD_MS = 10 * 60_000;

export type Trust = { ok: true } | { ok: false; why: string };

/** No inventory read at all: on a console, or on PC before TennoScope's first read. */
export const noInventoryRead = (m: Model) => !m.observedAt && m.inventoryByBase.size === 0;

/**
 * A listing made by hand before the first inventory read, in Full mode (on PC): it goes as typed,
 * since nothing can be checked, and the listing form says so before it's sent. Nothing MyOrbiter
 * lists by itself goes up then: an automatic listing needs a trusted read (inventoryTrust).
 */
export const keepUnchecked = (m: Model, fullMode: boolean | null) => fullMode === true && noInventoryRead(m);
export const KEEP_UNCHECKED_WARNING = "MyOrbiter hasn't read your inventory yet, so it can't check what you keep: list only copies you know you can spare.";

/**
 * Whether the inventory read can prove anything spare: there is one, with the item catalog the keep
 * rules are worked out from and the mastery they depend on, and it's recent. `fullMode`: whether
 * TennoScope reads the inventory at all (null: unknown), only to say why.
 */
export function inventoryTrust(m: Model, now = Date.now(), fullMode: boolean | null = null, maxAge = MAX_INVENTORY_AGE_MS): Trust {
  const off = fullMode === false ? " (Full mode is off, so TennoScope doesn't read it)" : "";
  if (!m.observedAt && m.inventoryByBase.size === 0) return { ok: false, why: `your inventory hasn't been read${off}` };
  if (m.inventoryByBase.size === 0) return { ok: false, why: `the last inventory read was empty${off}` };
  // The catalog TennoScope downloads names what's held: with none of it known, no keep rule can be worked out.
  let named = false;
  for (const u of m.inventoryByBase.keys()) if (m.catalogByUnique.has(u)) {
    named = true;
    break;
  }
  if (!named) return { ok: false, why: "the item catalog hasn't been read, so the keep rules can't be worked out" };
  // Every account has mastered something: a read without any mastery is a partial one, and the keep
  // rules (sets to build, Requiem mods while lich weapons are left) depend on it.
  if (m.mastered.size === 0) return { ok: false, why: "the inventory read has no mastery in it (a partial read)" };
  if (!m.observedAt) return { ok: false, why: "when your inventory was read isn't known" };
  const age = now - +m.observedAt;
  if (!Number.isFinite(age)) return { ok: false, why: "when your inventory was read isn't known" };
  if (age < -MAX_CLOCK_AHEAD_MS) return { ok: false, why: "your inventory's read time is ahead of this PC's clock, so how recent it is can't be told" };
  if (age > maxAge) {
    const h = age / 3_600_000;
    const ago = h >= 48 ? `${Math.round(h / 24)} days` : h >= 1.5 ? `${Math.round(h)} hours` : `${Math.round(age / 60_000)} minutes`;
    return { ok: false, why: `your inventory was last read ${ago} ago${off || ": sync first"}` };
  }
  return { ok: true };
}

export interface GuardContext extends SpareContext {
  now?: number;
  fullMode?: boolean | null;
}

export interface GuardRequest {
  item: MarketItem;
  rank: number | null;
  subtype: string | null;
  /** Copies this listing would offer once sent. */
  quantity: number;
  platinum: number | null;
  /**
   * Copies of the same item, rank and variant already up in your other listings (hidden ones
   * included). Counted from `listed` when left out.
   */
  listedElsewhere?: number;
  /**
   * Your other listings, every item, hidden ones included (not the one being changed): the copies
   * they offer are counted once, across an arcane's ranks and between a set and its parts.
   */
  listed?: readonly Listed[];
  /**
   * The item's minimum price (its Sell spares category's, or the global one): a price under it is
   * refused, asked for by hand or not. Left out where a price isn't being chosen (shown again as listed).
   */
  minimum?: number;
  /**
   * You asked for this one listing yourself (the listing form, a switch on Orders): the keep rules
   * still hold when there's an inventory to check against, but an old read doesn't stop it, and
   * with no inventory at all (a console) what you typed goes. Everything else is automatic: no
   * trusted inventory, no listing.
   */
  manual?: boolean;
}

export type GuardResult = { ok: true; audit: string } | { ok: false; why: string };

/** "Khra R0", "Axi A1 Relic (radiant)": the listing in a few words. */
export function listingTag(it: MarketItem, rank: number | null, subtype: string | null): string {
  return `${it.name}${it.maxRank != null ? ` R${rank ?? 0}` : ""}${subtype && it.subtypes && it.subtypes.length > 1 ? ` (${subtype})` : ""}`;
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A prime part or set offered at a price its ducats beat (or come close to), at your rate: why, or null. */
export function ducatRefusal(c: SpareContext, it: MarketItem, platinum: number | null): string | null {
  const kind = kindOfItem(c.model, it);
  if ((kind !== "part" && kind !== "set") || platinum == null || !c.advice) return null;
  const worth = ducatWorth(c.model, it, c.advice.platPerDucat);
  if (worth == null || !ducatsBeat(platinum, worth)) return null;
  return `at ${platinum}p it's ${platinum <= worth ? "worth less than" : "too close to"} its ducats (~${round1(worth)}p to you at ${c.advice.platPerDucat}p a ducat; it needs ${Math.ceil(platToBeat(worth) - 1e-9)}p or more)`;
}

/** A price under the minimum: why, after "Didn't list Khra R0: ", or null. */
export function minimumRefusal(platinum: number | null, minimum: number | null | undefined): string | null {
  if (platinum == null || minimum == null || platinum >= minimum) return null;
  return `${platinum}p is under your ${minimum}p minimum (Sell spares): it needs ${minimum}p or more`;
}

/**
 * Whether `r` may go up: never more copies than the keep rules prove spare, less the ones already
 * listed, never under its minimum when one is given, and (automatic listings) never a prime part
 * or set at a price its ducats beat. The audit
 * line says why it was spare, for the log; a refusal says why not, as "Didn't list …: …".
 */
export function guardListing(c: GuardContext, r: GuardRequest): GuardResult {
  const tag = listingTag(r.item, r.rank, r.subtype);
  const refuse = (why: string): GuardResult => ({ ok: false, why: `Didn't list ${tag}: ${upper(why)}` });
  if (!(r.quantity > 0)) return refuse("nothing to list");
  // warframe.market takes whole copies and whole platinum; anything else is a fault upstream, and a
  // missing price would also skip the ducat check below.
  if (!Number.isInteger(r.quantity)) return refuse(`${r.quantity} isn't a whole number of copies`);
  if (r.platinum == null ? !r.manual : !(Number.isInteger(r.platinum) && r.platinum >= 1)) return refuse(r.platinum == null ? "it has no price" : `${r.platinum}p isn't a price warframe.market takes`);
  if (r.listedElsewhere != null && !Number.isFinite(r.listedElsewhere)) return refuse("your other listings of it couldn't be counted");
  const def = r.item.subtypes?.[0] ?? null;
  const sameKey = (o: Listed) => o.itemId === r.item.id && (r.item.maxRank == null || (o.rank ?? 0) === (r.rank ?? 0)) && (o.subtype ?? def) === (r.subtype ?? def);
  const listed = r.listed ?? [];
  const elsewhere = Math.max(0, r.listedElsewhere ?? listed.filter(sameKey).reduce((n, o) => n + o.quantity, 0));
  // Never sold, whoever asks (the plan, the listing form, Orders): Sell again takes it off the list.
  // A part on the list holds back the sets it goes into, and a set its parts.
  const never = neverHeld(c.rules, c.model, c.index, r.item);
  if (never) return refuse(never.self ? NEVER_SOLD_REFUSAL : neverAcrossRefusal(neverWhy(never), never.by.length));
  // Never under the minimum, typed in by hand or not, inventory or none.
  const cheap = minimumRefusal(r.platinum, r.minimum);
  if (cheap) return refuse(cheap);
  const m = c.model;
  // By hand with no inventory read (a console, or Full mode before its first read, where the form
  // warns first): what you typed goes. Nothing automatic: inventoryTrust refuses below.
  if (r.manual && noInventoryRead(m)) {
    const why = c.fullMode === true ? "Full mode, before the first inventory read: what you keep wasn't checked" : "no inventory read to check against";
    return { ok: true, audit: `${tag}: ${r.quantity} at ${r.platinum ?? "?"}p, as asked (${why})` };
  }
  const trust = inventoryTrust(m, c.now ?? Date.now(), c.fullMode ?? null);
  if (!trust.ok && !r.manual) return refuse(`MyOrbiter can't prove it's spare: ${trust.why}`);
  const kind = kindOfItem(m, r.item);
  const held = heldFor(m, r.item, { rank: r.rank, subtype: r.subtype });
  const proven = kind ? provenSpare(c, kind, r.item, r.rank, r.subtype) : null;
  const stale = trust.ok ? "" : ` (${trust.why})`;
  if (!kind || !proven) {
    if (!r.manual) return refuse("MyOrbiter has no keep rule to count it by");
    if (held != null && r.quantity + elsewhere > held) return refuse(`you hold ${held}${elsewhere ? `, ${elsewhere} already listed` : ""}`);
    return { ok: true, audit: `${tag}: ${r.quantity} at ${r.platinum ?? "?"}p, as asked; ${held ?? "?"} held, no keep rule applies${stale}` };
  }
  // Copies counted once: what your other listings offer of the same copies is taken off.
  const { free, across } = freeToList(c, kind, r.item, r.rank, proven, elsewhere, listed.filter((o) => !sameKey(o)));
  const allowed = Math.max(0, free);
  if (r.quantity > allowed) {
    const counts = `${held ?? "?"} held, ${proven.spare} spare${elsewhere ? `, ${elsewhere} already listed` : ""}${across ? `, ${across}` : ""}`;
    return refuse(allowed > 0 ? `only ${allowed} can go (${counts}): ${proven.short}` : across && proven.spare > elsewhere ? `its spare copies are listed already (${counts})` : `${proven.short} (${counts})`);
  }
  if (!r.manual) {
    const ducats = ducatRefusal(c, r.item, r.platinum);
    if (ducats) return refuse(ducats);
  }
  return {
    ok: true,
    audit: `${tag}: ${r.quantity} at ${r.platinum ?? "?"}p; ${held ?? "?"} held, ${proven.spare} spare${elsewhere ? `, ${elsewhere} already listed` : ""}${across ? `, ${across}` : ""}; kept: ${proven.kept} (${KIND_LABEL[kind].toLowerCase()} rule)${stale}`,
  };
}
