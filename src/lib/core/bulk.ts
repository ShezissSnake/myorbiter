// "Put my spares on sale": what you'd want listed under the categories you tick, and the changes
// that bring your warframe.market listings in line with it. Pure: the store fetches order books
// and sends the changes (marketStore.planBulk / applyBulk).
import { decide, type DucatOptions } from "./advice";
import { competitor, findItem, heldFor, marketValue, overAsked, type BookOrder, type FloorRule, type Me, type MarketIndex, type MarketItem, type MyOrder, listingKey, referencePrice } from "./market";
import { aboveCrack, allSetRows, spareRows, type SellChoices, type SpareRow } from "./spares";
import type { Model } from "./model";
import { arcaneRows, inventoryRows, modRows, modSpares, partRows, saveForSets, savedLine } from "./views";
import { gearSetParts } from "./model";
import { packValues, spareArcanes, vosforWorth } from "./vosfor";

export type BulkKind = "set" | "arcane" | "mod" | "part" | "imprint" | "other";

export interface BulkRules {
  /**
   * Complete sets you don't need: all of them once mastered or built, otherwise all but one. Prime
   * sets, and the others warframe.market trades whole (Mandonel, Lato Vandal…), sold as the set
   * rather than part by part.
   */
  sets: boolean;
  /** Maxed arcanes beyond the one you keep, at max rank. */
  arcanes: boolean;
  /** Mods beyond the two you keep (your best and one to give away), if they sell at least once a day. */
  mods: boolean;
  /**
   * Spare prime parts, as Prime parts counts them (all but what you need to build and master),
   * never leaving you fewer than `partsKeep` of one; not the ones worth more as ducats.
   */
  parts: boolean;
  partsKeep: number;
  /**
   * Everything else you hold more of than you need (see spares.ts): weapon parts and blueprints,
   * relics, gems, fish, Captura scenes, Ayatan sculptures, veiled rivens. Only what sells at least
   * once a day, and never a relic worth more cracked.
   */
  other: boolean;
  /**
   * Kubrow and Kavat imprints (and Vulpaphyla, Predasite, Helminth Charger ones): every one you
   * hold, by breed, since an imprint only hatches a companion. Imprints sell a few times a week, so
   * they aren't held to the once-a-day rule of everything else.
   */
  imprints: boolean;
  /**
   * When there's more to list than warframe.market's 100 listings allow, which win: the ones worth
   * the most platinum, or the ones that sell most often (most trades a day), so the slots turn over.
   * Either way only what the rules above let through.
   */
  priority: "plat" | "trades";
}
export const defaultBulkRules = (): BulkRules => ({ sets: true, arcanes: true, mods: true, parts: true, partsKeep: 0, other: false, imprints: true, priority: "plat" });

export const KIND_LABEL: Record<BulkKind, string> = { set: "Set", arcane: "Arcane", mod: "Mod", part: "Prime part", imprint: "Imprint", other: "Other item" };
/** Each kind's switch in BulkRules. */
export const RULE_OF: Record<BulkKind, "sets" | "arcanes" | "mods" | "parts" | "imprints" | "other"> = { set: "sets", arcane: "arcanes", mod: "mods", part: "parts", imprint: "imprints", other: "other" };
export const BULK_KINDS: BulkKind[] = ["set", "arcane", "mod", "part", "imprint", "other"];

/** One thing you'd want listed: an item, at a rank, and how many. */
export interface SellTarget {
  kind: BulkKind;
  /** The name warframe.market lists it under. */
  name: string;
  unique: string | null;
  rank: number | null;
  /** The variant to list (a relic's refinement); the item's default when absent. */
  subtype?: string | null;
  quantity: number;
  why: string;
  /** Each, when the target knows it (relics by refinement). */
  each?: number | null;
  /**
   * Not to be sold, and why: worth more to you as ducats, say. A listing of yours for it comes
   * down when `takeDown` is set; otherwise it's left as you listed it.
   */
  hold?: { why: string; takeDown: boolean };
  /** Relics: what one crack at this refinement is worth. A price at or under it isn't worth selling for. */
  crack?: number | null;
}

/** Spare-rows that go under "Everything else": not prime parts, sets, arcanes or (non-riven) mods. */
export function otherSpare(r: SpareRow): boolean {
  return r.kind === "resource" || r.kind === "blueprint" || r.kind === "relic" || r.type === "Veiled riven";
}

/** What your collection says should be on sale, for the ticked categories. */
/** `drops`: what you got of each part lately (core/drops.ts), for which parts wait for a set. */
export function sellTargets(m: Model, rules: BulkRules, advice: DucatOptions, index: MarketIndex | null = null, sell?: SellChoices, drops: ReadonlyMap<string, number> = new Map()): SellTarget[] {
  const out: SellTarget[] = [];
  if (rules.sets) {
    for (const s of allSetRows(m, index)) {
      if (s.sellable <= 0) continue;
      const set: SellTarget = {
        kind: "set",
        name: `${s.name} Set`,
        unique: null,
        rank: null,
        quantity: s.sellable,
        why: s.mastered || s.ownedBuilt ? `${s.mastered ? "Mastered" : "Built"}: every complete set can go` : "A spare set: one is kept to build and master",
      };
      // Worth more traded to Baro, part by part, than sold for platinum: kept for ducats.
      const asDucats = ducatsWin(s.setPrice, s.ducats, advice);
      if (asDucats) set.hold = { why: asDucats, takeDown: true };
      out.push(set);
    }
  }
  if (rules.arcanes) {
    // Arcanes worth more dissolved for Vosfor stay off the market, like parts worth more as ducats.
    const rows = arcaneRows(m);
    const lens = advice.vosforLens ?? "need";
    const { perVosfor } = vosforWorth(packValues(m, rows), lens);
    const dissolve = new Set(spareArcanes(m, rows, perVosfor, { lens, minPrice: advice.minPlat }).filter((s) => s.verdict === "dissolve").map((s) => s.row.name));
    for (const a of rows) {
      if (a.extraMaxed <= 0 || !a.tradable || dissolve.has(a.name)) continue;
      out.push({ kind: "arcane", name: a.name, unique: a.unique, rank: a.maxRank, quantity: a.extraMaxed, why: `${a.maxedCopies} maxed, one kept` });
    }
  }
  if (rules.mods) {
    for (const mod of modRows(m)) {
      // Rivens aren't kept two to a name: veiled ones go under everything else, unveiled ones by auction.
      if (!mod.tradable || mod.extras <= 0 || / Riven Mod/.test(mod.name)) continue;
      // Common mods at a few platinum hardly ever move: only the ones that trade daily.
      if ((mod.tradesPerDay ?? 0) < 1) continue;
      const best = mod.ranks[0];
      for (const r of modSpares(mod)) {
        if (r.count <= 0) continue;
        out.push({
          kind: "mod",
          name: mod.name,
          unique: mod.unique,
          rank: mod.maxRank != null ? r.rank : null,
          quantity: r.count,
          why: `${mod.total} copies: your best (R${best?.rank ?? 0}) and one to give away kept`,
        });
      }
    }
  }
  if (rules.parts) {
    for (const p of partRows(m, saveForSets(sell, advice.platPerDucat, drops))) {
      // Parts going out inside a set aren't listed again on their own.
      const loose = p.spare - (rules.sets ? p.inSets : 0);
      const over = p.quantity - (rules.sets ? p.inSets : 0) - rules.partsKeep;
      const n = Math.min(loose, over);
      if (n <= 0) {
        // Every copy you don't need to build waits for a set (Settings → Selling): a listing of yours
        // for it comes down. With copies kept to build or inside complete sets too, it's left as listed.
        if (p.saving && p.spare <= 0) out.push({ kind: "part", name: p.name, unique: null, rank: null, quantity: p.forSet, why: `${p.quantity} held`, hold: { why: savedLine(p.forSet, p.saving), takeDown: p.keep === p.forSet } });
        continue;
      }
      const build = p.keep - p.forSet;
      let why = build ? `${p.quantity} held, ${build} kept to build ${p.parentName}` : `${p.quantity} held, ${p.parentName} ${p.parentMastered ? "mastered" : "built"}`;
      if (p.saving) why = `${why}, ${savedLine(p.forSet, p.saving)}`;
      const part: SellTarget = { kind: "part", name: p.name, unique: null, rank: null, quantity: n, why: rules.partsKeep > p.keep ? `${why}, ${rules.partsKeep} kept in all` : why };
      // Better traded to Baro: kept for ducats, and a listing of yours for it comes down. Not worth a
      // trade, or slow and close to its ducats: not listed, but a listing you made stays.
      const asDucats = ducatsWin(p.price, p.ducats, advice);
      const d = decide(p.price, p.ducats, p.tradesPerDay, advice, n);
      if (asDucats) part.hold = { why: asDucats, takeDown: true };
      else if (d.verdict === "ducats") part.hold = { why: `Better as ducats: ${d.reason.charAt(0).toLowerCase()}${d.reason.slice(1)}`, takeDown: false };
      out.push(part);
    }
  }
  if (rules.imprints) {
    // Every imprint you hold, by breed: warframe.market lists them under the companion's path.
    for (const r of inventoryRows(m)) {
      if (r.kind !== "imprint" || !r.marketName || r.quantity <= 0) continue;
      out.push({ kind: "imprint", name: r.marketName, unique: r.unique, rank: null, quantity: r.quantity, why: `${r.quantity} held: an imprint only hatches a companion` });
    }
  }
  if (rules.other) {
    for (const r of spareRows(m, index, sell, advice.platPerDucat, advice.squad ?? 1, drops)) {
      if (!otherSpare(r)) continue;
      if (r.spare <= 0) {
        // Every copy waits for a set (a Lato Vandal part): a listing of yours for it comes down.
        if (r.forSet > 0 && r.keep === r.forSet) out.push({ kind: "other", name: r.name, unique: r.unique, rank: null, subtype: r.subtype, quantity: r.forSet, why: `${r.quantity} held`, hold: { why: r.why, takeDown: true } });
        continue;
      }
      // Relics have no trade count of their own: what they sell for decides, and cracking may beat it.
      if (r.kind === "relic" ? r.crack != null && r.price != null && r.crack >= r.price : (r.tradesPerDay ?? 0) < 1) continue;
      // Copies that go out inside a whole set (Sets I don't need) aren't listed again on their own.
      const loose = r.spare - (rules.sets ? r.inSets : 0);
      if (loose <= 0) continue;
      out.push({
        kind: "other",
        name: r.name,
        // The game's path finds internally named parts; relics and veiled rivens go by name.
        unique: r.kind === "relic" || r.type === "Veiled riven" ? null : r.unique,
        rank: null,
        subtype: r.subtype,
        quantity: loose,
        crack: r.kind === "relic" ? r.crack : undefined,
        why: r.keep ? `${r.quantity} held, ${r.keep} kept: ${r.why}` : `${r.quantity} held: ${r.why.charAt(0).toLowerCase()}${r.why.slice(1)}`,
        each: r.price,
      });
    }
  }
  return out;
}

/**
 * When something's ducats are worth more to you than what it sells for, at your own ducat rate
 * (Prime parts, Your rates): why, in words. Null when platinum wins, or it has no ducats.
 */
export function ducatsWin(plat: number | null, ducats: number, advice: DucatOptions): string | null {
  if (!ducats || plat == null) return null;
  const worth = ducats * advice.platPerDucat;
  return worth >= plat ? `Worth more as ducats: ${ducats} ducats are ~${Math.round(worth * 10) / 10}p to you, it sells for ${Math.round(plat)}p` : null;
}

const OTHER_TAGS = ["relic", "gem", "fish", "scene", "simulacrum", "ayatan_sculpture", "ayatan_star", "blueprint", "component", "lens"];

/** Which category a listing of yours belongs to, if any of the four. */
export function kindOfItem(m: Model, it: MarketItem): BulkKind | null {
  const tags = it.tags ?? [];
  // Imprints share the companion's path; orbiter counts them apart from your companions.
  if (tags.includes("imprint")) return m.imprints ? "imprint" : null;
  // Only sets orbiter knows the parts of: the rest it can't count, so it doesn't manage them.
  if (tags.includes("set")) return it.gameRef && (m.partsByParent.has(it.gameRef) || gearSetParts(m, it.gameRef)) ? "set" : null;
  if (tags.includes("arcane_enhancement")) return "arcane";
  if (/ \(Veiled\)$/.test(it.name)) return "other";
  if (tags.includes("mod")) return "mod";
  if (m.partByName.has(it.name)) return "part";
  // Everything else orbiter counts: never built gear, which can't be traded once built.
  if (OTHER_TAGS.some((t) => tags.includes(t)) && !tags.includes("warframe") && !tags.includes("set")) return "other";
  return null;
}

export type BulkAction =
  | { type: "create"; kind: BulkKind; item: MarketItem; rank: number | null; subtype: string | null; quantity: number; platinum: number; why: string; priceWhy: string }
  | { type: "update"; kind: BulkKind; item: MarketItem; order: MyOrder; quantity: number; platinum: number; why: string; priceWhy: string }
  | { type: "remove"; kind: BulkKind; item: MarketItem; order: MyOrder; why: string }
  | { type: "skip"; kind: BulkKind; name: string; rank: number | null; why: string; subtype?: string | null };

/** warframe.market's cap on how many orders one account can have up at once. */
export const LISTING_LIMIT = 100;
export const LIMIT_WHY = `Over warframe.market's ${LISTING_LIMIT}-listing limit: your other listings are worth more`;
export const LIMIT_WHY_TRADES = `Over warframe.market's ${LISTING_LIMIT}-listing limit: your other listings sell more often`;
/** How the plan ends the reason for a listing of yours it leaves up though a rule wouldn't have made it. */
export const AS_LISTED = "left as you listed it";

export interface BulkContext {
  model: Model;
  index: MarketIndex;
  orders: MyOrder[];
  me: Me;
  books: Record<string, BookOrder[] | undefined>;
  /** Never list or keep a listing under this price. */
  minPrice: number;
  /** The same for relics (they go in stacks); minPrice when not set. */
  minRelicPrice?: number;
  minShare: number;
  floors: Record<string, number>;
  paused: Record<string, boolean>;
  /** Orders that aren't sell listings (buy orders): they count toward the limit too. */
  otherOrders?: number;
  /** Defaults to LISTING_LIMIT. */
  limit?: number;
  /** Which veiled rivens and relics count as spare (see SellChoices). */
  sell?: SellChoices;
  /** Your ducat rate: a prime part or set worth more as ducats comes off the market. */
  advice?: DucatOptions;
  /** What you got of each part lately (core/drops.ts): which parts wait for a set. */
  drops?: ReadonlyMap<string, number>;
}

/** The market item for a target, or null when warframe.market doesn't trade it. */
export function resolve(idx: MarketIndex, t: SellTarget): MarketItem | null {
  return findItem(idx, t.name, t.unique);
}

/**
 * Clearly under your minimum by its daily median (less than half of it): not worth fetching its
 * order book to find out. Saves most of the time on a collection of cheap mods.
 */
export function cheapByMedian(m: Model, it: MarketItem, rank: number | null, minPrice: number, subtype: string | null = it.subtypes?.[0] ?? null): number | null {
  const ref = referencePrice(m, it, rank, subtype);
  return ref != null && ref < minPrice / 2 ? ref : null;
}

/** The price to ask: the cheapest seller in game, held at your floors; with nobody in game, the daily median. */
export function priceFor(c: BulkContext, it: MarketItem, rank: number | null, subtype: string | null, book: BookOrder[], existing: MyOrder | null = null, keepAbove: number | null = null): { price: number | null; why: string; value: number | null } {
  const probe: MyOrder = { id: "", itemId: it.id, type: "sell", platinum: 0, quantity: 1, rank, subtype, visible: true, updatedAt: null };
  // Your own floor for this listing: Orders keeps it under the listing's own key, whose variant
  // may be unnamed (null) where the probe names the default one.
  const floor0 = (existing && c.floors[listingKey(existing)]) ?? c.floors[listingKey(probe)] ?? c.floors[listingKey({ ...probe, subtype: null })] ?? null;
  const relic = !!it.tags?.includes("relic");
  const rule: FloorRule = { floor: floor0, minShare: c.minShare, reference: referencePrice(c.model, it, rank, subtype), defaultSubtype: it.subtypes?.[0] ?? null };
  const comp = competitor(probe, book, c.me, rule.defaultSubtype ?? null);
  // Relics: what one sells for now, not what a few lucky ones sold for.
  const value = relic ? marketValue(rule.reference, comp) : rule.reference;
  const floor = Math.max(1, rule.floor ?? 0, keepAbove ?? 0, value != null ? Math.ceil(value * rule.minShare) : 0);
  const held = keepAbove != null && floor === keepAbove ? "held just above what a crack is worth" : "held at your floor";
  if (comp.price != null) {
    const sells = overAsked(comp.price, value);
    if (sells != null) return sells >= floor ? { price: sells, why: `what it sells for: in game it's ${comp.price}p and up, far above that`, value } : { price: floor, why: held, value };
    return comp.price >= floor ? { price: comp.price, why: `cheapest in game: ${comp.cheapest?.name ?? "?"}`, value } : { price: floor, why: held, value };
  }
  if (value != null) return { price: Math.max(floor, Math.round(value)), why: !relic ? "nobody in game: the daily median" : rule.reference != null && value < rule.reference ? "nobody in game: what sellers on the site ask" : "nobody in game: what it sold for lately", value };
  return { price: null, why: "no price to go by", value };
}

/** One line per change, to tell whether two plans would do the same thing. */
export function planSignature(actions: BulkAction[]): string {
  return actions
    .filter((a) => a.type !== "skip")
    .map((a) => (a.type === "create" ? `c|${a.item.id}|${a.rank}|${a.quantity}|${a.platinum}` : a.type === "update" ? `u|${a.order.id}|${a.quantity}|${a.platinum}` : a.type === "remove" ? `r|${a.order.id}` : ""))
    .sort()
    .join("\n");
}

/** The changes, for the ticked categories only. Listings you set to be left alone, or hid, are never touched. */
export function bulkPlan(c: BulkContext, rules: BulkRules, targets: SellTarget[]): BulkAction[] {
  const ticked = new Set<BulkKind>(BULK_KINDS.filter((k) => rules[RULE_OF[k]]));
  const actions: BulkAction[] = [];
  const claimed = new Set<string>();
  const keyOf = (it: MarketItem, rank: number | null, subtype: string | null) => `${it.id}|${it.maxRank != null ? (rank ?? 0) : ""}|${subtype ?? it.subtypes?.[0] ?? ""}`;
  const orderKey = (o: MyOrder, it: MarketItem) => keyOf(it, o.rank, o.subtype);
  /**
   * A listing of yours that a rule (your minimum, the copies orbiter keeps) wouldn't have made:
   * it stays up as you listed it, only lowered to what you hold, and the plan says why.
   */
  const leaveListed = (kind: BulkKind, it: MarketItem, o: MyOrder, why: string) => {
    const held = heldFor(c.model, it, o);
    if (held != null && held <= 0) actions.push({ type: "remove", kind, item: it, order: o, why: "You don't hold any now" });
    else if (held != null && held < o.quantity) actions.push({ type: "update", kind, item: it, order: o, quantity: held, platinum: o.platinum, why: `You hold ${held} now`, priceWhy: "price kept" });
    else actions.push({ type: "skip", kind, name: it.name, rank: it.maxRank != null ? (o.rank ?? 0) : null, why: `${why}: ${AS_LISTED}` });
  };

  for (const target of targets) {
    const it = resolve(c.index, target);
    if (!it) {
      actions.push({ type: "skip", kind: target.kind, name: target.name, rank: target.rank, why: "Not on warframe.market" });
      continue;
    }
    // Ranked on warframe.market: a rank always (unranked is 0), even when orbiter's catalog
    // doesn't know the item has ranks (Quick Thinking), so in-game rank-0 sellers count.
    const t = { ...target, rank: it.maxRank != null ? (target.rank ?? 0) : null };
    const subtype = t.subtype ?? it.subtypes?.[0] ?? null;
    const key = keyOf(it, t.rank, subtype);
    const existing = c.orders.find((o) => o.itemId === it.id && orderKey(o, it) === key) ?? null;
    if (existing) claimed.add(existing.id);
    if (existing && (c.paused[listingKey(existing)] || !existing.visible)) {
      actions.push({ type: "skip", kind: t.kind, name: it.name, rank: t.rank, subtype, why: existing.visible ? "Your listing is set to be left alone" : "Your listing is hidden: left as it is" });
      continue;
    }
    if (t.hold) {
      if (existing && t.hold.takeDown) actions.push({ type: "remove", kind: t.kind, item: it, order: existing, why: t.hold.why });
      else if (existing) leaveListed(t.kind, it, existing, t.hold.why);
      else actions.push({ type: "skip", kind: t.kind, name: it.name, rank: t.rank, subtype, why: t.hold.why });
      continue;
    }
    const min = it.tags?.includes("relic") ? (c.minRelicPrice ?? c.minPrice) : c.minPrice;
    const minWords = it.tags?.includes("relic") && c.minRelicPrice != null ? `${min}p relic minimum` : `${min}p minimum`;
    const cheap = cheapByMedian(c.model, it, t.rank, min, subtype);
    if (cheap != null) {
      const why = `Sells for about ${Math.round(cheap)}p, under your ${minWords}`;
      if (existing) leaveListed(t.kind, it, existing, why);
      else actions.push({ type: "skip", kind: t.kind, name: it.name, rank: t.rank, subtype, why });
      continue;
    }
    const book = c.books[it.slug];
    if (!book) {
      actions.push({ type: "skip", kind: t.kind, name: it.name, rank: t.rank, subtype, why: "Couldn't load its prices" });
      continue;
    }
    const { price, why: priceWhy, value } = priceFor(c, it, t.rank, subtype, book, existing, t.crack != null ? aboveCrack(t.crack) : null);
    // A relic that sells for no more than a crack of it is worth: crack it instead. What it
    // sells for is what sellers you could trade with ask, not a few lucky sales.
    const worth = value == null ? price : price == null ? value : Math.min(price, value);
    if (worth != null && t.crack != null && worth <= t.crack) {
      const ref = subtype ?? "intact";
      const why = `Goes for about ${Math.round(worth * 10) / 10}p, no more than ${/^[aeiou]/.test(ref) ? "an" : "a"} ${ref} crack is worth (about ${t.crack}p): kept to crack`;
      if (existing) leaveListed(t.kind, it, existing, why);
      else actions.push({ type: "skip", kind: t.kind, name: it.name, rank: t.rank, subtype, why });
      continue;
    }
    if (price == null || price < min) {
      const why = price == null ? "No price to go by" : `Sells for ${price}p, under your ${minWords}`;
      if (existing) leaveListed(t.kind, it, existing, why);
      else actions.push({ type: "skip", kind: t.kind, name: it.name, rank: t.rank, subtype, why });
      continue;
    }
    if (!existing) {
      actions.push({ type: "create", kind: t.kind, item: it, rank: it.maxRank != null ? t.rank : null, subtype, quantity: t.quantity, platinum: price, why: t.why, priceWhy });
    } else if (existing.quantity !== t.quantity || existing.platinum !== price) {
      actions.push({ type: "update", kind: t.kind, item: it, order: existing, quantity: t.quantity, platinum: price, why: t.why, priceWhy });
    }
  }

  let modIndex: Map<string, ReturnType<typeof modRows>[number]> | null = null;
  const mods = () => (modIndex ??= new Map(modRows(c.model).map((r) => [r.name, r])));
  let setIndex: Map<string, ReturnType<typeof allSetRows>[number]> | null = null;
  const setsByUnique = () => (setIndex ??= new Map(allSetRows(c.model, c.index).map((r) => [r.unique, r])));
  let partIndex: Map<string, ReturnType<typeof partRows>[number]> | null = null;
  const parts = () => (partIndex ??= new Map(partRows(c.model, saveForSets(c.sell, c.advice?.platPerDucat ?? 0, c.drops)).map((r) => [r.name, r])));
  let otherIndex: Map<string, SpareRow> | null = null;
  const others = () => (otherIndex ??= new Map(spareRows(c.model, c.index, c.sell, c.advice?.platPerDucat ?? 0, c.advice?.squad ?? 1, c.drops).filter(otherSpare).map((r) => [`${r.name}|${r.subtype ?? ""}`, r])));
  let arcaneIndex: Map<string, ReturnType<typeof arcaneRows>[number]> | null = null;
  const arcanes = () => (arcaneIndex ??= new Map(arcaneRows(c.model).map((r) => [r.name, r])));
  /**
   * What the keep rules leave you to sell of a listing, or null when no rule applies: a set and the
   * parts to build anything unbuilt, two copies of each mod, and the copies of your one maxed arcane.
   * Only said in the plan: a listing you made for more stays up.
   */
  const spareFor = (kind: BulkKind, it: MarketItem, o: MyOrder): { spare: number; kept: string } | null => {
    if (kind === "mod") {
      const mod = mods().get(it.name);
      if (!mod) return null;
      const spare = modSpares(mod).filter((r) => it.maxRank == null || r.rank === (o.rank ?? 0)).reduce((n, r) => n + r.count, 0);
      return { spare, kept: mod.keptFor ? mod.keptFor.split(":")[0].replace(/^For/, "for") : "your own copy and one to give away" };
    }
    if (kind === "set") {
      const set = it.gameRef ? setsByUnique().get(it.gameRef) : undefined;
      return set ? { spare: set.sellable, kept: "one set to build and master" } : null;
    }
    if (kind === "part") {
      const part = parts().get(it.name);
      if (!part) return null;
      const build = part.keep - part.forSet;
      const kept = [build ? `the ${build > 1 ? "copies" : "copy"} to build ${part.parentName}` : "", part.forSet ? `${part.forSet} saved for the ${part.parentName} Set` : ""].filter(Boolean).join(" and ");
      return { spare: part.spare, kept: kept || "nothing" };
    }
    if (kind === "imprint") {
      const held = it.gameRef ? (c.model.imprints?.get(it.gameRef) ?? 0) : 0;
      return { spare: held, kept: "nothing" };
    }
    if (kind === "other") {
      const r = others().get(`${it.name}|${o.subtype ?? it.subtypes?.[0] ?? ""}`) ?? others().get(`${it.name}|`);
      return r ? { spare: r.spare, kept: r.keep ? `${r.keep} (${r.why.charAt(0).toLowerCase()}${r.why.slice(1)})` : "nothing" } : null;
    }
    const a = arcanes().get(it.name);
    if (!a) return null;
    const rank = o.rank ?? 0;
    // Whole maxed ones still to fuse count too: a listing made for them (Arcanes' List button) stays.
    if (rank >= a.maxRank) return { spare: a.extraSets, kept: "your maxed copy" };
    if (rank === 0) return { spare: Math.min(a.unranked, a.spare), kept: a.complete ? "the copies your maxed one needs" : `the copies toward a maxed one (${a.copies}/${a.needed})` };
    return null;
  };
  // Other listings in a ticked category (ones you made yourself, or for spares that are gone):
  // never more than you hold. Removed when you hold none, lowered when you hold fewer, else kept.
  // One that lists copies the keep rules would hold back is your call: it stays, and the plan says so.
  for (const o of c.orders) {
    if (claimed.has(o.id) || !o.visible || c.paused[listingKey(o)]) continue;
    const it = c.index.byId.get(o.itemId);
    if (!it) continue;
    const kind = kindOfItem(c.model, it);
    if (!kind || !ticked.has(kind)) continue;
    const held = heldFor(c.model, it, o);
    // null: orbiter can't count it (a set it doesn't know the parts of, a renamed mod): leave it.
    if (held == null) continue;
    if (held <= 0) {
      actions.push({ type: "remove", kind, item: it, order: o, why: "You don't hold any now" });
      continue;
    }
    if (held < o.quantity) {
      actions.push({ type: "update", kind, item: it, order: o, quantity: held, platinum: o.platinum, why: `You hold ${held} now`, priceWhy: "price kept" });
      continue;
    }
    // A prime part or set now worth more to you as ducats than it sells for: it comes down.
    const asDucats = c.advice && (kind === "part" || kind === "set") ? ducatsFor(c, kind, it) : null;
    if (asDucats) {
      actions.push({ type: "remove", kind, item: it, order: o, why: asDucats });
      continue;
    }
    const rule = spareFor(kind, it, o);
    if (rule && rule.spare < o.quantity) {
      actions.push({ type: "skip", kind, name: it.name, rank: it.maxRank != null ? (o.rank ?? 0) : null, why: `${upper(rule.kept)} would be kept: ${AS_LISTED}` });
    }
  }
  return fitLimit(c, ticked, actions, rules.priority ?? "plat");
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A prime part's or set's ducats against what it sells for, at your rate: why it's better as ducats, or null. */
function ducatsFor(c: BulkContext, kind: BulkKind, it: MarketItem): string | null {
  if (!c.advice) return null;
  if (kind === "part") {
    const part = c.model.partByName.get(it.name)?.[0];
    return part ? ducatsWin(c.model.price(it.name), part.ducats, c.advice) : null;
  }
  const parts = it.gameRef ? c.model.partsByParent.get(it.gameRef) : undefined;
  if (!parts?.length) return null;
  return ducatsWin(c.model.price(it.name), parts.reduce((n, p) => n + p.ducats * p.required, 0), c.advice);
}

/**
 * warframe.market takes at most 100 orders per account. When the plan would go over, the listings
 * worth the most platinum (quantity × price) win, or with `priority` "trades" the ones that sell
 * most often (trades a day, worth breaking ties): the rest of the new ones are left out, and the
 * rest of your existing ones in the ticked categories make way. Listings you set to be left
 * alone, hidden ones and ones outside the ticked categories are never moved: they just take a slot.
 */
export function fitLimit(c: BulkContext, ticked: Set<BulkKind>, actions: BulkAction[], priority: BulkRules["priority"] = "plat"): BulkAction[] {
  const limit = c.limit ?? LISTING_LIMIT;
  const removed = new Set(actions.flatMap((a) => (a.type === "remove" ? [a.order.id] : [])));
  const updates = new Map(actions.flatMap((a) => (a.type === "update" ? [[a.order.id, a] as const] : [])));

  type Slot = { value: number; trades: number; create?: Extract<BulkAction, { type: "create" }>; order?: MyOrder; item?: MarketItem; kind?: BulkKind };
  const tradesOf = (it: MarketItem) => c.model.tradesPerDay(it.name) ?? 0;
  const flexible: Slot[] = [];
  let fixed = c.otherOrders ?? 0;
  for (const o of c.orders) {
    if (removed.has(o.id)) continue;
    const it = c.index.byId.get(o.itemId);
    const kind = it ? kindOfItem(c.model, it) : null;
    if (!it || !kind || !ticked.has(kind) || !o.visible || c.paused[listingKey(o)]) {
      fixed++;
      continue;
    }
    const u = updates.get(o.id);
    flexible.push({ value: (u ? u.quantity * u.platinum : o.quantity * o.platinum), trades: tradesOf(it), order: o, item: it, kind });
  }
  for (const a of actions) if (a.type === "create") flexible.push({ value: a.quantity * a.platinum, trades: tradesOf(a.item), create: a });

  const room = Math.max(0, limit - fixed);
  if (flexible.length <= room) return actions;

  const byTrades = priority === "trades";
  const keep = new Set([...flexible].sort((a, b) => (byTrades ? b.trades - a.trades : 0) || b.value - a.value).slice(0, room));
  const dropCreates = new Set(flexible.filter((f) => !keep.has(f) && f.create).map((f) => f.create!));
  const dropOrders = new Map(flexible.filter((f) => !keep.has(f) && f.order).map((f) => [f.order!.id, f] as const));

  const out: BulkAction[] = [];
  for (const a of actions) {
    if (a.type === "create" && dropCreates.has(a)) out.push({ type: "skip", kind: a.kind, name: a.item.name, rank: a.rank, why: byTrades ? LIMIT_WHY_TRADES : LIMIT_WHY });
    else if (a.type === "update" && dropOrders.has(a.order.id)) continue; // replaced by the removal below
    else out.push(a);
  }
  for (const f of dropOrders.values()) {
    out.push({ type: "remove", kind: f.kind!, item: f.item!, order: f.order!, why: `Makes room for listings ${byTrades ? "that sell more often" : "worth more"} (warframe.market allows ${limit})` });
  }
  return out;
}
