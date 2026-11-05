// Baro Ki'Teer's stock and Varzia's Prime Resurgence, read against your collection: what in them
// you still need for mastery, what's new to you, and what you already have.
import { masteryPoints } from "./acquire";
import { normaliseStoreUnique, type Model } from "./model";
import type { MasteryRow } from "./views";

export interface StockItem {
  name: string;
  unique: string;
  image: string | null;
  ducats: number | null;
  credits: number | null;
  /** "mastery": something you haven't mastered; "new": a mod or arcane you don't have; "have": you have it. */
  mark: "mastery" | "new" | "have" | null;
  points: number | null;
  owned: number;
}

/** Store names come through as "Evil Baro Armour A": the catalog name where there is one. */
export function baroStock(m: Model): StockItem[] {
  const inv = m.live.baro?.inventory ?? [];
  const out: StockItem[] = [];
  for (const x of inv) {
    const unique = normaliseStoreUnique(x.uniqueName);
    const c = m.catalogByUnique.get(unique);
    const name = c?.name ?? x.item;
    // Held plus any being built (m.owned counts both, so the inventory isn't added twice).
    const owned = m.owned(unique);
    let mark: StockItem["mark"] = null;
    if (c?.masterable) mark = m.isMastered(unique) || owned > 0 ? "have" : "mastery";
    else if (c && /Mods|Arcanes/.test(c.category)) mark = owned > 0 ? "have" : "new";
    else if (owned > 0) mark = "have";
    out.push({
      name,
      unique,
      image: m.imageOf(name),
      ducats: x.ducats,
      credits: x.credits,
      mark,
      points: c?.masterable && mark === "mastery" ? masteryPoints(c) : null,
      owned,
    });
  }
  const order = { mastery: 0, new: 1, null: 2, have: 3 } as const;
  return out.sort((a, b) => order[`${a.mark}`] - order[`${b.mark}`] || (b.ducats ?? 0) - (a.ducats ?? 0));
}

/** What a ducat turned out to be worth on Baro's last visit: his stock that sells, at market prices. */
export interface BaroRate {
  /** Platinum per ducat, two decimals. */
  rate: number;
  /** The item that gives it, what it sells for, what he asks. */
  item: string;
  price: number;
  ducats: number;
  /** When that visit began (ms). */
  visit: number;
}

/**
 * What a ducat is worth in platinum, by what Baro has for sale right now: the best price per ducat
 * among his items that sell at least once a day on warframe.market (you'd buy them to sell). Null
 * while he's away, or when nothing he has sells often enough to count.
 */
export function baroRate(m: Model, stock: StockItem[] = baroStock(m)): BaroRate | null {
  const visit = m.live.baro?.activation ? Date.parse(m.live.baro.activation) : NaN;
  if (!Number.isFinite(visit)) return null;
  let best: BaroRate | null = null;
  for (const s of stock) {
    const price = m.price(s.name);
    if (!s.ducats || price == null || (m.tradesPerDay(s.name) ?? 0) < 1) continue;
    const rate = Math.round((price / s.ducats) * 100) / 100;
    if (!best || rate > best.rate) best = { rate, item: s.name, price, ducats: s.ducats, visit };
  }
  return best;
}

/** One of Baro's items as a ducats-to-platinum flip: buy it from him, sell it on warframe.market. */
export interface BaroFlip {
  name: string;
  unique: string;
  ducats: number;
  credits: number | null;
  /** What it sells for (warframe.market's daily median). */
  price: number;
  /** Platinum per ducat, two decimals. */
  perDucat: number;
  /** Trades a day on warframe.market, when known: how quickly it would sell. */
  tradesPerDay: number | null;
}

/**
 * Baro's stock that trades on warframe.market, best platinum per ducat first: what to turn your
 * ducats into to sell. Items that sell under once a week (or have no price) are left out.
 */
export function baroFlips(m: Model, stock: StockItem[] = baroStock(m), max = 5): BaroFlip[] {
  const out: BaroFlip[] = [];
  for (const s of stock) {
    const price = m.price(s.name);
    if (!s.ducats || price == null || price <= 0) continue;
    const tradesPerDay = m.tradesPerDay(s.name);
    if (tradesPerDay != null && tradesPerDay < 1 / 7) continue;
    out.push({ name: s.name, unique: s.unique, ducats: s.ducats, credits: s.credits, price, perDucat: Math.round((price / s.ducats) * 100) / 100, tradesPerDay });
  }
  return out.sort((a, b) => b.perDucat - a.perDucat || (b.tradesPerDay ?? 0) - (a.tradesPerDay ?? 0)).slice(0, max);
}

/** "100,000" → "100k", "1,250,000" → "1.25M": a credit cost, short. */
export function shortCredits(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 10_000) / 100}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

export interface VarziaNeed {
  name: string;
  image: string | null;
  points: number;
  /** Regal Aya, when Varzia sells the whole thing. */
  regalAya: number | null;
  /** Her relics that drop a part you're missing. */
  relics: string[];
  /** Parts you're missing that only drop from her relics right now. */
  onlyHere: number;
  missing: number;
}

/** Primes you haven't mastered that Varzia can get you: whole, or the relics for missing parts. */
export function varziaNeeds(m: Model, rows: MasteryRow[]): VarziaNeed[] {
  const stock = new Map((m.live.resurgence ?? []).map((v) => [normaliseStoreUnique(v.uniqueName), v]));
  const out: VarziaNeed[] = [];
  for (const r of rows) {
    if (!r.isPrime || r.status === "level" || r.status === "build" || !r.partsTotal) continue;
    const whole = stock.get(r.unique);
    const relics = new Set<string>();
    let onlyHere = 0;
    for (const p of r.missingParts) {
      const here = p.sources.filter((s) => s.resurgence);
      for (const s of here) relics.add(s.base);
      if (here.length && p.availability === "resurgence") onlyHere++;
    }
    if (!whole && !relics.size) continue;
    out.push({ name: r.name, image: m.imageOf(r.name), points: r.points, regalAya: whole?.ducats ?? null, relics: [...relics], onlyHere, missing: r.missingParts.length });
  }
  return out.sort((a, b) => b.onlyHere - a.onlyHere || a.missing - b.missing || b.points - a.points);
}

/** "3 d 4 h", "5 h 10 min", "12 min". */
export function until(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - now;
  // An expiry that isn't a time (a damaged worldstate): no countdown rather than "under a minute".
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "now";
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${min % 60} min`;
  return min ? `${min} min` : "under a minute";
}
