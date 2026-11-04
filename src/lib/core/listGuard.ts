// The last check before orbiter puts copies up for sale on warframe.market: a new listing, a
// listing raised to more copies, or a hidden one shown again. It works the keep rules out again
// from the inventory as it is now, whatever path asked (the spares plan, the listing form, Orders,
// the last-copy timer), and refuses anything it can't prove is spare. Pure: the store sends or
// doesn't, and writes the line it returns to the log.
import { KIND_LABEL, ducatWorth, ducatsBeat, kindOfItem, platToBeat, provenSpare, type SpareContext } from "./bulk";
import { heldFor, type MarketItem } from "./market";
import type { Model } from "./model";
import { neverSells } from "./sparesRules";

/** The refusal for something on the never-sell list, after "Didn't list Khra R0: ". */
export const NEVER_SOLD_REFUSAL = "it's on your never-sell list (Sell spares). Sell again takes it off the list, then it can be listed";

/**
 * An inventory read older than this proves nothing for a listing orbiter makes by itself: copies
 * may have been sold, traded, used or installed since. Full mode reads again after each trade.
 */
export const MAX_INVENTORY_AGE_MS = 3 * 60 * 60_000;

export type Trust = { ok: true } | { ok: false; why: string };

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
  /** Copies of the same item, rank and variant already up in your other listings. */
  listedElsewhere?: number;
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

/**
 * Whether `r` may go up: never more copies than the keep rules prove spare, less the ones already
 * listed, and (automatic listings) never a prime part or set at a price its ducats beat. The audit
 * line says why it was spare, for the log; a refusal says why not, as "Didn't list …: …".
 */
export function guardListing(c: GuardContext, r: GuardRequest): GuardResult {
  const tag = listingTag(r.item, r.rank, r.subtype);
  const refuse = (why: string): GuardResult => ({ ok: false, why: `Didn't list ${tag}: ${upper(why)}` });
  const elsewhere = Math.max(0, r.listedElsewhere ?? 0);
  if (!(r.quantity > 0)) return refuse("nothing to list");
  // Never sold, whoever asks (the plan, the listing form, Orders): Sell again takes it off the list.
  if (c.rules && neverSells(c.rules, r.item.id)) return refuse(NEVER_SOLD_REFUSAL);
  const m = c.model;
  const noInventory = !m.observedAt && m.inventoryByBase.size === 0;
  if (r.manual && noInventory) return { ok: true, audit: `${tag}: ${r.quantity} at ${r.platinum ?? "?"}p, as asked (no inventory read to check against)` };
  const trust = inventoryTrust(m, c.now ?? Date.now(), c.fullMode ?? null);
  if (!trust.ok && !r.manual) return refuse(`orbiter can't prove it's spare: ${trust.why}`);
  const kind = kindOfItem(m, r.item);
  const held = heldFor(m, r.item, { rank: r.rank, subtype: r.subtype });
  const proven = kind ? provenSpare(c, kind, r.item, r.rank, r.subtype) : null;
  const stale = trust.ok ? "" : ` (${trust.why})`;
  if (!kind || !proven) {
    if (!r.manual) return refuse("orbiter has no keep rule to count it by");
    if (held != null && r.quantity + elsewhere > held) return refuse(`you hold ${held}${elsewhere ? `, ${elsewhere} already listed` : ""}`);
    return { ok: true, audit: `${tag}: ${r.quantity} at ${r.platinum ?? "?"}p, as asked; ${held ?? "?"} held, no keep rule applies${stale}` };
  }
  const allowed = Math.max(0, proven.spare - elsewhere);
  if (r.quantity > allowed) {
    const counts = `${held ?? "?"} held, ${proven.spare} spare${elsewhere ? `, ${elsewhere} already listed` : ""}`;
    return refuse(allowed > 0 ? `only ${allowed} can go (${counts}): ${proven.short}` : `${proven.short} (${counts})`);
  }
  if (!r.manual) {
    const ducats = ducatRefusal(c, r.item, r.platinum);
    if (ducats) return refuse(ducats);
  }
  return {
    ok: true,
    audit: `${tag}: ${r.quantity} at ${r.platinum ?? "?"}p; ${held ?? "?"} held, ${proven.spare} spare${elsewhere ? `, ${elsewhere} already listed` : ""}; kept: ${proven.kept} (${KIND_LABEL[kind].toLowerCase()} rule)${stale}`,
  };
}
