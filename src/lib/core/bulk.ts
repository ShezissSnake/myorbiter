// Sell spares: what you'd want listed under the rows you tick and their choices (sparesRules.ts),
// and the changes that bring your warframe.market listings in line with it, each with the rule that
// decided it. Pure: the store fetches order books and sends the changes (marketStore.planBulk /
// applyBulk); the page shows each row's numbers (sparesPreview) and the plan.
import { decide, type DucatOptions } from "./advice";
import { competitor, findItem, heldFor, marketValue, overAsked, type BookOrder, type FloorRule, type Me, type MarketIndex, type MarketItem, type MyOrder, listingKey, referencePrice } from "./market";
import { aboveCrack, allSetRows, gearSetRows, spareRows, type SellChoices, type SpareRow } from "./spares";
import type { Model } from "./model";
import { ANTIVIRUS_MOD, arcaneRows, inventoryRows, LICH_KEEP_ALL, MOD_KEEP, modRows, modSpares, partRows, REQUIEM_MOD, saveForSets, savedLine, setRows, type ArcaneRow, type ModRow } from "./views";
import { allOn, CATEGORY_WORD, LICH_FAMILIES, minimumFor, rulesV2, SPARE_CATEGORIES, type MinByCategory, type ModFamily, type PlanRules, type ResourceFamily, type SpareCategory, type SparesRules } from "./sparesRules";
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
export const BULK_KINDS: BulkKind[] = ["set", "arcane", "mod", "part", "imprint", "other"];

/** Where a thing goes on Sell spares, below its category: a mod family, a kind of resource, or neither. */
export type SpareFamily = ModFamily | ResourceFamily | "ordinary" | "veiled";

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
  /** Its row on Sell spares (worked out from `kind` when absent) and, for mods and resources, its family. */
  cat?: SpareCategory;
  family?: SpareFamily;
  /** The rule that put it in or held it back: an id ("mods.keep") and its words for the plan ("Keep 2"). */
  rule?: string;
  ruleText?: string;
}

/** Spare-rows that go under weapon parts, relics or resources: not prime parts, sets, arcanes or (non-riven) mods. */
export function otherSpare(r: SpareRow): boolean {
  return r.kind === "resource" || r.kind === "blueprint" || r.kind === "relic" || r.type === "Veiled riven";
}

/** The row a kind of target belongs to when it doesn't say (an older caller's target). */
const CAT_OF_KIND: Record<BulkKind, SpareCategory> = { set: "prime", part: "prime", mod: "mods", arcane: "arcanes", imprint: "imprints", other: "resources" };
export const catOfTarget = (t: Pick<SellTarget, "kind" | "cat">): SpareCategory => t.cat ?? CAT_OF_KIND[t.kind];

/** Keys to boss fights and what they're made from: kept as "Keys and the rest" (spares.ts keeps them while needed). */
const KEY_LIKE = /InfestedAlad|Mutalist (Alad V )?Nav Coordinate|Jordas Precept|GolemKey/i;

/**
 * Which row a spare thing other than a prime part, mod or arcane goes under: weapon parts and
 * blueprints (and Necramech parts) under weapon parts and sets, relics under relics, the rest under
 * resources by kind.
 */
export function spareCategoryOf(r: SpareRow): { cat: SpareCategory; family?: SpareFamily } {
  if (r.kind === "relic") return { cat: "relics" };
  switch (r.type) {
    case "Veiled riven": return { cat: "resources", family: "veiled" };
    case "Gem": return { cat: "resources", family: "gems" };
    case "Fish": return { cat: "resources", family: "fish" };
    case "Ayatan sculpture": return { cat: "resources", family: "ayatan" };
    case "Ayatan star": return { cat: "resources", family: "stars" };
    case "Captura scene":
    case "Simulacrum": return { cat: "resources", family: "captura" };
    case "Focus lens": return { cat: "resources", family: "lenses" };
    case "Ship part blueprint":
    case "Resource": return { cat: "resources", family: "other" };
  }
  if (KEY_LIKE.test(r.unique) || KEY_LIKE.test(r.name)) return { cat: "resources", family: "other" };
  // Weapon parts, their blueprints, Necramech parts, and other gear blueprints.
  return { cat: "gear" };
}

/** A mod's family on Sell spares, or null for an ordinary mod. Augments by path: the catalog marks every warframe mod as one. */
export function modFamilyOf(mod: { unique: string; name: string; type?: string }): ModFamily | null {
  if (REQUIEM_MOD.test(mod.unique)) return "requiem";
  if (ANTIVIRUS_MOD.test(mod.unique)) return "antivirus";
  if (/^Primed /.test(mod.name)) return "primed";
  if (/^(Galvanized|Archon) /.test(mod.name)) return "galvanized";
  if (mod.type === "Stance Mod") return "stance";
  if (/\/Powersuits\/.*AugmentCard$/.test(mod.unique)) return "augment";
  return null;
}

/**
 * Copies of a mod kept, installed ones counted: its family's number, or every other mod's. Requiem
 * and Antivirus mods keep theirs while a weapon they're for is left to master (every copy while
 * that isn't known), then the ordinary number.
 */
export function modKeepOf(r: SparesRules, mod: ModRow): number {
  const fam = modFamilyOf(mod);
  if (mod.keptFor) return mod.keep === LICH_KEEP_ALL ? LICH_KEEP_ALL : r.mods.families[fam === "antivirus" ? "antivirus" : "requiem"].keep;
  if (fam && !(LICH_FAMILIES as readonly string[]).includes(fam)) return r.mods.families[fam].keep;
  return r.mods.keep;
}

/** Copies of a spare row kept on top of its own rule: a relic's keep number, resources' margin. */
export function extraKeepOf(r: SparesRules, row: SpareRow): number {
  const { cat } = spareCategoryOf(row);
  return cat === "relics" ? r.relics.keep : cat === "resources" ? r.resources.margin : 0;
}
/** A spare row's spare copies under these rules. */
export const rowSpareUnder = (r: SparesRules, row: SpareRow) => Math.max(0, Math.min(row.spare, row.quantity - row.keep - extraKeepOf(r, row)));

/** Unranked copies of an arcane beyond what the maxed ones kept (and any listed) take. */
export const arcaneUnrankedSpare = (a: ArcaneRow, keepMaxed: number) => Math.min(a.unranked, Math.max(0, a.copies - Math.max(keepMaxed, a.maxedCopies) * a.needed));

/** Every part of a prime set drops from a relic you hold: once sold, another can be cracked. */
export function setFromYourRelics(m: Model, unique: string): boolean {
  const parts = m.partsByParent.get(unique) ?? [];
  return parts.length > 0 && parts.every((p) => (m.sourcesByReward.get(p.fullName) ?? []).some((s) => (m.ownedRelicCount.get(s.base) ?? 0) > 0));
}

/** A mod family in a plan line's rule, short: "Requiem 5", "Primed 2". */
const FAMILY_WORD: Record<ModFamily, string> = { primed: "Primed", galvanized: "Galvanized", augment: "Augments", stance: "Stances", requiem: "Requiem", antivirus: "Antivirus" };
export const NEVER_WHY = "On your never-sell list (Sell spares): Sell again puts it back";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What your collection says should be on sale, under the choices on Sell spares (settings.market.
 * spares; the old switches are read as their migration). Every category keeps what its rules
 * keep; a thing on the never-sell list is held back (with warframe.market's item list to know it
 * by). `drops`: what you got of each part lately (core/drops.ts), for which parts wait for a set.
 */
export function sellTargets(m: Model, rules: PlanRules, advice: DucatOptions, index: MarketIndex | null = null, sell?: SellChoices, drops: ReadonlyMap<string, number> = new Map()): SellTarget[] {
  const r = rulesV2(rules);
  const out: SellTarget[] = [];
  const rate = advice.platPerDucat;

  // Prime sets and parts.
  if (r.prime.on) {
    if (r.prime.sellAs !== "parts") {
      for (const s of setRows(m)) {
        if (s.sellable <= 0) continue;
        const set: SellTarget = {
          kind: "set",
          cat: "prime",
          name: `${s.name} Set`,
          unique: null,
          rank: null,
          quantity: s.sellable,
          why: s.mastered || s.ownedBuilt ? `${s.mastered ? "Mastered" : "Built"}: every complete set can go` : "A spare set: one is kept to build and master",
          rule: "prime.set",
          ruleText: "Spare set",
        };
        // Worth more traded to Baro, part by part, than sold for platinum (or close to it): kept for
        // ducats. The whole set's price against every part's ducats, at your rate.
        const asDucats = s.ducatsKnown === false ? "A part's ducat value isn't known: kept until it can be weighed against its ducats" : ducatsWin(s.setPrice, s.ducats, advice);
        if (asDucats) Object.assign(set, { hold: { why: asDucats, takeDown: true }, rule: "prime.ducats", ruleText: s.ducatsKnown === false ? "Ducats unknown" : "Ducats" });
        else if (r.prime.onlyRelicsHeld && !setFromYourRelics(m, s.unique)) Object.assign(set, { hold: { why: "Not every part drops from a relic you hold: kept whole (Only sets my relics drop)", takeDown: false }, rule: "prime.relics", ruleText: "Not your relics" });
        out.push(set);
      }
    }
    if (r.prime.sellAs !== "sets") {
      const keepN = r.prime.keep;
      const inSets = r.prime.sellAs === "setsFirst";
      for (const p of partRows(m, saveForSets(sell, rate, drops))) {
        // Parts going out inside a set aren't listed again on their own.
        const taken = inSets ? p.inSets : 0;
        const n = Math.min(p.spare - taken, p.quantity - taken - keepN);
        if (n <= 0) {
          // Every copy you don't need to build waits for a set (Sell spares): a listing of yours
          // for it comes down. With copies kept to build or inside complete sets too, it's left as listed.
          if (p.saving && p.spare <= 0) out.push({ kind: "part", cat: "prime", name: p.name, unique: null, rank: null, quantity: p.forSet, why: `${p.quantity} held`, hold: { why: savedLine(p.forSet, p.saving), takeDown: p.keep === p.forSet }, rule: "prime.saving", ruleText: "Saving for a set" });
          continue;
        }
        const build = p.keep - p.forSet;
        let why = build ? `${p.quantity} held, ${build} kept to build ${p.parentName}` : `${p.quantity} held, ${p.parentName} ${p.parentMastered ? "mastered" : "built"}`;
        if (p.saving) why = `${why}, ${savedLine(p.forSet, p.saving)}`;
        const part: SellTarget = { kind: "part", cat: "prime", name: p.name, unique: null, rank: null, quantity: n, why: keepN > p.keep ? `${why}, ${keepN} kept in all` : why, rule: keepN ? "prime.keep" : "prime.part", ruleText: keepN ? `Keep ${keepN}` : "Spare part" };
        // Better traded to Baro: kept for ducats, and a listing of yours for it comes down. Not worth a
        // trade, or slow and close to its ducats: not listed, but a listing you made stays.
        const asDucats = ducatsWin(p.price, p.ducats, advice);
        const d = decide(p.price, p.ducats, p.tradesPerDay, advice, n);
        if (asDucats) Object.assign(part, { hold: { why: asDucats, takeDown: true }, rule: "prime.ducats", ruleText: "Ducats" });
        else if (d.verdict === "ducats") Object.assign(part, { hold: { why: `Better as ducats: ${d.reason.charAt(0).toLowerCase()}${d.reason.slice(1)}`, takeDown: false }, rule: "prime.ducats", ruleText: "Ducats" });
        out.push(part);
      }
    }
  }

  // Weapon sets warframe.market trades whole (Mandonel, Lato Vandal, Necramechs).
  if (r.gear.on && r.gear.sellAs !== "parts") {
    for (const s of gearSetRows(m, index)) {
      if (s.sellable <= 0) continue;
      out.push({
        kind: "set",
        cat: "gear",
        name: `${s.name} Set`,
        unique: null,
        rank: null,
        quantity: s.sellable,
        why: s.mastered || s.ownedBuilt ? `${s.mastered ? "Mastered" : "Built"}: every complete set can go` : "A spare set: one is kept to build and master",
        rule: "gear.set",
        ruleText: "Spare set",
      });
    }
  }

  if (r.arcanes.on) {
    // Arcanes worth more dissolved for Vosfor stay off the market, like parts worth more as ducats.
    const rows = arcaneRows(m);
    const lens = advice.vosforLens ?? "need";
    const { perVosfor } = vosforWorth(packValues(m, rows), lens);
    const dissolve = new Set(spareArcanes(m, rows, perVosfor, { lens, minPrice: advice.minPlat }).filter((s) => s.verdict === "dissolve").map((s) => s.row.name));
    const k = r.arcanes.keepMaxed;
    for (const a of rows) {
      if (!a.tradable || dissolve.has(a.name)) continue;
      if (!r.arcanes.legendary && a.rarity === "Legendary") continue;
      const extra = Math.max(0, a.maxedCopies - k);
      if (extra > 0) out.push({ kind: "arcane", cat: "arcanes", name: a.name, unique: a.unique, rank: a.maxRank, quantity: extra, why: `${a.maxedCopies} maxed, ${k === 1 ? "one" : k} kept`, rule: "arcanes.maxed", ruleText: `Keep ${k} maxed` });
      const unranked = r.arcanes.which === "any" ? arcaneUnrankedSpare(a, k) : 0;
      if (unranked > 0) out.push({ kind: "arcane", cat: "arcanes", name: a.name, unique: a.unique, rank: 0, quantity: unranked, why: `${a.unranked} unranked, ${a.copies} copies in all: ${k * a.needed} kept for ${plural(k, "maxed one")}`, rule: "arcanes.any", ruleText: "Spare copies" });
    }
  }

  if (r.mods.on) {
    for (const mod of modRows(m)) {
      // Rivens aren't kept two to a name: veiled ones go under resources, unveiled ones by auction.
      if (!mod.tradable || / Riven Mod/.test(mod.name)) continue;
      const fam = modFamilyOf(mod);
      if (fam && !r.mods.families[fam].on) continue;
      // Common mods at a few platinum hardly ever move: by default, only the ones that trade daily.
      if (r.mods.dailyOnly && (mod.tradesPerDay ?? 0) < 1) continue;
      const k = modKeepOf(r, mod);
      const spares = modSpares({ ...mod, keep: k });
      if (!spares.length) continue;
      const best = mod.ranks[0];
      const installed = mod.ranks.reduce((n, x) => n + (x.installed ?? 0), 0);
      const lich = !!mod.keptFor;
      const why = lich
        ? `${mod.total} copies: ${mod.keptFor!.split(":")[0].replace(/^\d+ kept/, `${k} kept`)}`
        : k === 2 && !installed
          ? `${mod.total} copies: your best (R${best?.rank ?? 0}) and one to give away kept`
          : `${mod.total} copies: ${k} kept${installed ? `, ${installed} of them installed in a build` : `, your best (R${best?.rank ?? 0}) counted`}`;
      const label = fam ? (fam === "galvanized" && /^Archon /.test(mod.name) ? "Archon" : FAMILY_WORD[fam]) : null;
      for (const x of spares) {
        out.push({
          kind: "mod",
          cat: "mods",
          family: fam ?? "ordinary",
          name: mod.name,
          unique: mod.unique,
          rank: mod.maxRank != null ? x.rank : null,
          quantity: x.count,
          why,
          rule: fam ? `mods.${fam}` : "mods.keep",
          ruleText: label ? `${label} ${k}` : `Keep ${k}`,
        });
      }
    }
  }

  if (r.imprints.on) {
    // Every imprint you hold, by breed, less the ones kept: warframe.market lists them under the companion's path.
    const k = r.imprints.keep;
    for (const row of inventoryRows(m)) {
      if (row.kind !== "imprint" || !row.marketName || row.quantity - k <= 0) continue;
      out.push({ kind: "imprint", cat: "imprints", name: row.marketName, unique: row.unique, rank: null, quantity: row.quantity - k, why: k ? `${row.quantity} held, ${k} kept to breed` : `${row.quantity} held: an imprint only hatches a companion`, rule: k ? "imprints.keep" : "imprints.all", ruleText: k ? `Keep ${k}` : "Breeding only" });
    }
  }

  const looseGear = r.gear.on && r.gear.sellAs !== "sets";
  if (looseGear || r.relics.on || r.resources.on) {
    for (const row of spareRows(m, index, sell, rate, advice.squad ?? 1, drops)) {
      if (!otherSpare(row)) continue;
      const { cat, family } = spareCategoryOf(row);
      if (cat === "gear" ? !looseGear : cat === "relics" ? !r.relics.on : !r.resources.on || (family !== "veiled" && !r.resources.families[family as ResourceFamily])) continue;
      const kind: BulkKind = "other";
      const extra = extraKeepOf(r, row);
      const spare = rowSpareUnder(r, row);
      if (spare <= 0) {
        // Every copy waits for a set (a Lato Vandal part): a listing of yours for it comes down.
        if (row.spare <= 0 && row.forSet > 0 && row.keep === row.forSet) out.push({ kind, cat, family, name: row.name, unique: row.unique, rank: null, subtype: row.subtype, quantity: row.forSet, why: `${row.quantity} held`, hold: { why: row.why, takeDown: true }, rule: `${cat}.saving`, ruleText: "Saving for a set" });
        continue;
      }
      // Relics have no trade count of their own: what they sell for decides, and cracking may beat it.
      if (row.kind === "relic" ? row.crack != null && row.price != null && row.crack >= row.price : (row.tradesPerDay ?? 0) < 1) continue;
      // Copies that go out inside a whole set (weapon sets, then parts) aren't listed again on their own.
      const loose = spare - (cat === "gear" && r.gear.sellAs === "setsFirst" ? row.inSets : 0);
      if (loose <= 0) continue;
      const kept = row.keep + extra;
      const builds = cat === "gear" || family === "gems" || family === "other" || family === "lenses";
      const ruleText =
        cat === "relics" ? (extra ? `Keep ${extra}` : "Beats a crack")
        : family === "veiled" ? "Veiled riven"
        : extra ? (builds ? `Builds + ${extra}` : `Keep ${extra}`)
        : family === "captura" ? "One kept"
        : row.keep ? "Beyond builds"
        : builds ? "Builds don't need it" : "Not needed";
      out.push({
        kind,
        cat,
        family,
        name: row.name,
        // The game's path finds internally named parts; relics and veiled rivens go by name.
        unique: row.kind === "relic" || row.type === "Veiled riven" ? null : row.unique,
        rank: null,
        subtype: row.subtype,
        quantity: loose,
        crack: row.kind === "relic" ? row.crack : undefined,
        why: kept ? `${row.quantity} held, ${kept} kept: ${row.why}${extra ? ` (${extra} more on Sell spares)` : ""}` : `${row.quantity} held: ${row.why.charAt(0).toLowerCase()}${row.why.slice(1)}`,
        each: row.price,
        rule: cat === "relics" ? (extra ? "relics.keep" : "relics.crack") : `${cat}.${family ?? "spare"}`,
        ruleText,
      });
    }
  }

  // Never sold: held back in every category, a listing of yours for it left as you listed it.
  if (index && r.neverSell.length) {
    const never = new Set(r.neverSell.map((n) => n.id));
    for (const t of out) {
      if (t.hold && t.rule === "prime.ducats") continue;
      const it = resolve(index, t);
      if (it && never.has(it.id)) Object.assign(t, { hold: { why: NEVER_WHY, takeDown: false }, rule: "never", ruleText: "Never sold" });
    }
  }
  return out;
}

/** A count and its platinum: what a row, or one family in it, would put up. */
export interface Tally {
  listings: number;
  plat: number;
}
/** What a row of Sell spares would put up, what its price minimum leaves out, and by family. */
export interface CategoryTally extends Tally {
  /** Listings left out because they sell for under your minimum. */
  under: number;
  families: Partial<Record<SpareFamily, Tally>>;
}
export type SparesTally = Record<SpareCategory, CategoryTally>;

const emptyTally = (): SparesTally => Object.fromEntries(SPARE_CATEGORIES.map((c) => [c, { listings: 0, plat: 0, under: 0, families: {} }])) as unknown as SparesTally;
const addTo = (t: CategoryTally, family: SpareFamily | undefined, plat: number) => {
  t.listings++;
  t.plat += plat;
  if (!family) return;
  const f = (t.families[family] ??= { listings: 0, plat: 0 });
  f.listings++;
  f.plat += plat;
};

export interface PreviewContext extends SpareContext {
  advice: DucatOptions;
  minPrice: number;
  /** Category minimums, each replacing minPrice for its category (sparesRules.ts, minimumFor). */
  minByCategory?: MinByCategory;
}

/**
 * What each row of Sell spares would list before a plan is made: every row as if ticked (an
 * unticked row shows what ticking it would add), under its own options, at the daily medians. The
 * same targets the plan starts from; what the plan then leaves out at the cheapest price in game
 * (or the 100-listing limit) it says itself.
 */
export function sparesPreview(c: PreviewContext, rules: SparesRules): SparesTally {
  const out = emptyTally();
  const m = c.model;
  const seen = new Set<string>();
  for (const t of sellTargets(m, allOn(rules), c.advice, c.index, c.sell, c.drops)) {
    if (t.hold) continue;
    const cat = catOfTarget(t);
    const it = c.index ? resolve(c.index, t) : null;
    if (c.index && !it) continue;
    const rank = it ? (it.maxRank != null ? (t.rank ?? 0) : null) : t.rank;
    const subtype = t.subtype ?? it?.subtypes?.[0] ?? null;
    // Counted once, as the plan counts it.
    const key = `${it?.id ?? t.name}|${rank ?? ""}|${subtype ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const each = t.each ?? (it ? referencePrice(m, it, rank, subtype) : m.price(t.name));
    if (each == null) continue;
    if (it && (t.kind === "part" || t.kind === "set")) {
      const duc = ducatWorth(m, it, c.advice.platPerDucat);
      if (duc != null && ducatsBeat(each, duc)) continue;
    }
    if (t.crack != null && each <= t.crack) continue;
    // The item's own category decides, as repricing and the listing form judge it (minimumForItem).
    if (each < (it ? minimumForItem(c, m, it) : minimumFor(c, cat))) {
      out[cat].under++;
      continue;
    }
    addTo(out[cat], t.family, each * t.quantity);
  }
  return out;
}

/** The same, from a plan: its new and changed listings by row, and what its minimum left out. */
export function planTally(actions: BulkAction[]): SparesTally {
  const out = emptyTally();
  for (const a of actions) {
    if (!a.cat) continue;
    if (a.type === "create" || a.type === "update") addTo(out[a.cat], a.family, a.quantity * a.platinum);
    else if (a.type === "skip" && a.rule === "plan.min") out[a.cat].under++;
  }
  return out;
}

/**
 * When something's ducats are worth more to you than what it sells for, at your own ducat rate
 * (Prime parts, Your rates): why, in words. Null when platinum wins, or it has no ducats.
 */
/**
 * What a prime part, or a prime set (every part in it), is worth to you as ducats, in platinum at
 * your rate; null for anything else. A listing at or under it is better traded to Baro.
 */
export function ducatWorth(m: Model, it: MarketItem, platPerDucat: number): number | null {
  if (!(platPerDucat > 0)) return null;
  const part = m.partByName.get(it.name)?.[0];
  if (part?.ducats) return part.ducats * platPerDucat;
  if (it.tags?.includes("set") && it.gameRef) {
    const parts = m.partsByParent.get(it.gameRef);
    const ducats = parts?.reduce((n, p) => n + p.ducats * p.required, 0) ?? 0;
    return ducats > 0 ? ducats * platPerDucat : null;
  }
  return null;
}

/**
 * Platinum has to beat a prime part's or set's ducats clearly to be worth a trade: by a fifth of
 * their worth and at least 2p. Close to its ducats, it goes to Baro (no buyer to wait for, no
 * trade to spend).
 */
export const DUCAT_EDGE = 0.2;
export const DUCAT_EDGE_MIN = 2;
/** The least platinum that beats ducats worth `worth` to you, by the edge above. */
export const platToBeat = (worth: number) => worth + Math.max(DUCAT_EDGE_MIN, worth * DUCAT_EDGE);
/** The first whole price that beats ducats worth `worth` (a hair of float error forgiven: 33.000…01 is 33). */
const firstWholeAbove = (worth: number) => Math.ceil(platToBeat(worth) - 1e-9);
/**
 * Ducats worth `worth` to you win over selling at `plat`: worth more, or too close to call. Judged
 * by the same whole price aboveDucats gives, so the floor a listing is held at always passes.
 */
export const ducatsBeat = (plat: number, worth: number) => plat < firstWholeAbove(worth);
/** The least a prime part or set is listed or repriced at: the first whole price that beats its ducats. */
export const aboveDucats = (worth: number | null) => (worth == null ? null : firstWholeAbove(worth));

export function ducatsWin(plat: number | null, ducats: number, advice: DucatOptions): string | null {
  if (!ducats || plat == null || !(advice.platPerDucat > 0)) return null;
  const worth = ducats * advice.platPerDucat;
  const words = `${ducats} ducats are ~${Math.round(worth * 10) / 10}p to you, it sells for ${Math.round(plat * 10) / 10}p`;
  if (worth >= plat) return `Worth more as ducats: ${words}`;
  return ducatsBeat(plat, worth) ? `Close to its ducats, so kept for them: ${words}` : null;
}

const OTHER_TAGS = ["relic", "gem", "fish", "scene", "simulacrum", "ayatan_sculpture", "ayatan_star", "blueprint", "component", "lens"];

/** Which category a listing of yours belongs to, if any of the four. */
export function kindOfItem(m: Model, it: MarketItem): BulkKind | null {
  const tags = it.tags ?? [];
  // Imprints share the companion's path; MyOrbiter counts them apart from your companions.
  if (tags.includes("imprint")) return m.imprints ? "imprint" : null;
  // Only sets MyOrbiter knows the parts of: the rest it can't count, so it doesn't manage them.
  if (tags.includes("set")) return it.gameRef && (m.partsByParent.has(it.gameRef) || gearSetParts(m, it.gameRef)) ? "set" : null;
  if (tags.includes("arcane_enhancement")) return "arcane";
  if (/ \(Veiled\)$/.test(it.name)) return "other";
  if (tags.includes("mod")) return "mod";
  if (m.partByName.has(it.name)) return "part";
  // Everything else MyOrbiter counts: never built gear, which can't be traded once built.
  if (OTHER_TAGS.some((t) => tags.includes(t)) && !tags.includes("warframe") && !tags.includes("set")) return "other";
  return null;
}

/**
 * Which row of Sell spares a listing's item belongs to, by its kind and tags: prime sets and parts,
 * weapon sets and parts (anything else built from parts), relics, resources. Null when MyOrbiter
 * doesn't count it.
 */
export function catOfItem(m: Model, it: MarketItem, kind: BulkKind | null = kindOfItem(m, it)): SpareCategory | null {
  if (!kind) return null;
  if (kind === "set") return it.gameRef && m.partsByParent.has(it.gameRef) ? "prime" : "gear";
  if (kind !== "other") return CAT_OF_KIND[kind];
  const tags = it.tags ?? [];
  if (tags.includes("relic")) return "relics";
  if (/ \(Veiled\)$/.test(it.name) || ["gem", "fish", "scene", "simulacrum", "ayatan_sculpture", "ayatan_star", "lens"].some((t) => tags.includes(t))) return "resources";
  return tags.includes("component") || tags.includes("blueprint") ? "gear" : "resources";
}

/**
 * The lowest price MyOrbiter lists or reprices an item at: its Sell spares category's minimum,
 * or the global one (also for things outside every category).
 */
export function minimumForItem(s: { minPrice: number; minByCategory?: MinByCategory | null }, m: Model | null, it: MarketItem): number {
  return minimumFor(s, m ? catOfItem(m, it) : catOfTags(it));
}
/** Without a collection read: the categories warframe.market's tags settle alone (anything else, the global minimum). */
function catOfTags(it: MarketItem): SpareCategory | null {
  const tags = it.tags ?? [];
  if (tags.includes("relic")) return "relics";
  if (tags.includes("imprint")) return "imprints";
  if (tags.includes("arcane_enhancement")) return "arcanes";
  if (tags.includes("mod") && !/ \(Veiled\)$/.test(it.name)) return "mods";
  return null;
}

/**
 * Whether the plan looks after your listings of an item: its row is ticked, and for sets and parts
 * the row sells that way (Whole sets leaves part listings be; Parts only, set listings). Listings
 * you set to be left alone or hid are left alone whatever this says.
 */
export function managedBy(r: SparesRules, m: Model, it: MarketItem): boolean {
  const kind = kindOfItem(m, it);
  const cat = catOfItem(m, it, kind);
  if (!cat || !r[cat].on) return false;
  if (cat === "prime") return kind === "set" ? r.prime.sellAs !== "parts" : r.prime.sellAs !== "sets";
  if (cat === "gear") return kind === "set" ? r.gear.sellAs !== "parts" : r.gear.sellAs !== "sets";
  return true;
}

/**
 * Where a line of the plan belongs and the rule that decided it, for the review list: its row on
 * Sell spares (null for a listing MyOrbiter doesn't count), the family inside it, a rule id
 * ("mods.keep", "plan.min") and the rule in a few words ("Keep 2", "Under 10p").
 */
export interface Ruled {
  cat?: SpareCategory | null;
  family?: SpareFamily;
  rule?: string;
  ruleText?: string;
}

export type BulkAction = Ruled &
  (
    | { type: "create"; kind: BulkKind; item: MarketItem; rank: number | null; subtype: string | null; quantity: number; platinum: number; why: string; priceWhy: string }
    | { type: "update"; kind: BulkKind; item: MarketItem; order: MyOrder; quantity: number; platinum: number; why: string; priceWhy: string }
    | { type: "remove"; kind: BulkKind; item: MarketItem; order: MyOrder; why: string }
    | {
        type: "skip";
        kind: BulkKind;
        name: string;
        rank: number | null;
        why: string;
        subtype?: string | null;
        /** warframe.market's item, when it's known: what Never sell and Sell again go by. */
        itemId?: string;
        /** Copies that would have gone, and each at the price that decided it, when known. */
        quantity?: number;
        each?: number | null;
      }
  );

/**
 * One line of the plan, the same from one plan to the next: a new listing by its item, rank and
 * variant, a change or removal by the listing. What Skip this time remembers.
 */
export function actionKey(a: BulkAction): string {
  if (a.type === "create") return `c|${a.item.id}|${a.rank ?? ""}|${a.subtype ?? ""}`;
  if (a.type === "skip") return `s|${a.itemId ?? a.name}|${a.rank ?? ""}|${a.subtype ?? ""}`;
  return `${a.type === "update" ? "u" : "r"}|${a.order.id}`;
}
/** The item a line lists or changes, when known. */
export const actionItemId = (a: BulkAction): string | null => (a.type === "skip" ? (a.itemId ?? null) : a.item.id);

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
  /** Never list or keep a listing under this price, unless its category has its own minimum. */
  minPrice: number;
  /** Category minimums, each replacing minPrice for its category (sparesRules.ts, minimumFor). */
  minByCategory?: MinByCategory;
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

/**
 * The plan as Apply sends it: without the lines skipped this time (by actionKey), and without a
 * new or changed listing of anything on the never-sell list (put there while looking it over).
 */
export function toApply(actions: BulkAction[], skipped: ReadonlySet<string>, never: ReadonlySet<string>): BulkAction[] {
  return actions.filter((a) => !skipped.has(actionKey(a)) && !((a.type === "create" || a.type === "update") && never.has(a.item.id)));
}

/** One line per change, to tell whether two plans would do the same thing. */
export function planSignature(actions: BulkAction[]): string {
  return actions
    .filter((a) => a.type !== "skip")
    .map((a) => (a.type === "create" ? `c|${a.item.id}|${a.rank}|${a.quantity}|${a.platinum}` : a.type === "update" ? `u|${a.order.id}|${a.quantity}|${a.platinum}` : a.type === "remove" ? `r|${a.order.id}` : ""))
    .sort()
    .join("\n");
}

/** A line's rule when the plan decided it, not the category's keep rule. */
const PLAN_RULE = {
  market: { rule: "plan.market", ruleText: "Not on the market" },
  twice: { rule: "plan.twice", ruleText: "Counted once" },
  alone: { rule: "plan.alone", ruleText: "Left alone" },
  hidden: { rule: "plan.hidden", ruleText: "Hidden" },
  unread: { rule: "plan.unread", ruleText: "No prices" },
  noPrice: { rule: "plan.noprice", ruleText: "No price" },
  held: { rule: "plan.held", ruleText: "What you hold" },
  ducats: { rule: "prime.ducats", ruleText: "Ducats" },
  crack: { rule: "relics.crack", ruleText: "Worth cracking" },
  hard: { rule: "plan.hard", ruleText: "Always kept" },
  listed: { rule: "plan.listed", ruleText: "As you listed" },
  never: { rule: "never", ruleText: "Never sold" },
} as const;
const minRule = (min: number) => ({ rule: "plan.min", ruleText: `Under ${min}p` });

/**
 * The changes, for the ticked categories only, each with its row and the rule that decided it.
 * Listings you set to be left alone, or hid, are never touched; nor is one for something you never
 * sell, beyond lowering it to what you hold.
 */
export function bulkPlan(c: BulkContext, rules: PlanRules, targets: SellTarget[]): BulkAction[] {
  const r = rulesV2(rules);
  const never = new Set(r.neverSell.map((n) => n.id));
  // Never sold: a listing of yours for it is left as you listed it, even past the listing limit.
  const managed = (it: MarketItem) => managedBy(r, c.model, it) && !never.has(it.id);
  const actions: BulkAction[] = [];
  const claimed = new Set<string>();
  const planned = new Map<string, BulkKind>();
  const keyOf = (it: MarketItem, rank: number | null, subtype: string | null) => `${it.id}|${it.maxRank != null ? (rank ?? 0) : ""}|${subtype ?? it.subtypes?.[0] ?? ""}`;
  const orderKey = (o: MyOrder, it: MarketItem) => keyOf(it, o.rank, o.subtype);
  const spareCtx: SpareContext = { ...c, rules: r };
  /**
   * A listing of yours that a rule (your minimum, the copies MyOrbiter keeps) wouldn't have made:
   * it stays up as you listed it, only lowered to what you hold, and the plan says why.
   */
  const leaveListed = (kind: BulkKind, it: MarketItem, o: MyOrder, why: string, tag: Ruled) => {
    const held = heldFor(c.model, it, o);
    if (held != null && held <= 0) actions.push({ type: "remove", kind, item: it, order: o, why: "You don't hold any now", ...tag, ...PLAN_RULE.held });
    else if (held != null && held < o.quantity) actions.push({ type: "update", kind, item: it, order: o, quantity: held, platinum: o.platinum, why: `You hold ${held} now`, priceWhy: "price kept", ...tag, ...PLAN_RULE.held });
    else actions.push({ type: "skip", kind, name: it.name, itemId: it.id, rank: it.maxRank != null ? (o.rank ?? 0) : null, subtype: o.subtype, quantity: o.quantity, each: o.platinum, why: `${why}: ${AS_LISTED}`, ...tag });
  };

  for (const target of targets) {
    const cat = catOfTarget(target);
    const where: Ruled = { cat, family: target.family };
    const own: Ruled = { ...where, rule: target.rule ?? `${cat}.spare`, ruleText: target.ruleText ?? "Spare" };
    const it = resolve(c.index, target);
    if (!it) {
      actions.push({ type: "skip", kind: target.kind, name: target.name, rank: target.rank, quantity: target.quantity, why: "Not on warframe.market", ...where, ...PLAN_RULE.market });
      continue;
    }
    // Ranked on warframe.market: a rank always (unranked is 0), even when MyOrbiter's catalog
    // doesn't know the item has ranks (Quick Thinking), so in-game rank-0 sellers count.
    const t = { ...target, rank: it.maxRank != null ? (target.rank ?? 0) : null };
    const subtype = t.subtype ?? it.subtypes?.[0] ?? null;
    const key = keyOf(it, t.rank, subtype);
    const skip = (why: string, tag: Ruled, each: number | null = t.each ?? null): BulkAction => ({ type: "skip", kind: t.kind, name: it.name, itemId: it.id, rank: t.rank, subtype, quantity: t.quantity, each, why, ...where, ...tag });
    // One thing is counted under one category only: a second target for it (a mod turning up under
    // resources too) would list the same copies twice.
    const first = planned.get(key);
    if (first) {
      actions.push(skip(`Already counted under ${KIND_LABEL[first]}`, PLAN_RULE.twice));
      continue;
    }
    planned.set(key, t.kind);
    const existing = c.orders.find((o) => o.itemId === it.id && orderKey(o, it) === key) ?? null;
    if (existing) claimed.add(existing.id);
    if (existing && (c.paused[listingKey(existing)] || !existing.visible)) {
      actions.push(existing.visible ? skip("Your listing is set to be left alone", PLAN_RULE.alone) : skip("Your listing is hidden: left as it is", PLAN_RULE.hidden));
      continue;
    }
    // Never sold, whatever the category's rules say: a listing of yours for it stays as listed.
    const hold = never.has(it.id) && !(t.hold && t.rule === "never") ? { why: NEVER_WHY, takeDown: false } : t.hold;
    const holdTag = hold && never.has(it.id) ? { ...where, ...PLAN_RULE.never } : own;
    if (hold) {
      if (existing && hold.takeDown) actions.push({ type: "remove", kind: t.kind, item: it, order: existing, why: hold.why, ...holdTag });
      else if (existing) leaveListed(t.kind, it, existing, hold.why, holdTag);
      else actions.push(skip(hold.why, holdTag));
      continue;
    }
    // The item's own category decides, as repricing, the listing form and the last check judge it.
    const minCat = catOfItem(c.model, it);
    const min = minimumForItem(c, c.model, it);
    const minWords = minCat && c.minByCategory?.[minCat] != null ? `${min}p ${CATEGORY_WORD[minCat]} minimum` : `${min}p minimum`;
    const cheap = cheapByMedian(c.model, it, t.rank, min, subtype);
    if (cheap != null) {
      const why = `Sells for about ${Math.round(cheap)}p, under your ${minWords}`;
      if (existing) leaveListed(t.kind, it, existing, why, { ...where, ...minRule(min) });
      else actions.push(skip(why, minRule(min), cheap));
      continue;
    }
    const book = c.books[it.slug];
    if (!book) {
      actions.push(skip("Couldn't load its prices", PLAN_RULE.unread));
      continue;
    }
    // Prime parts and sets: what the price you'd list at would fetch against its ducats, at the
    // cheapest in-game price (it can be well under the daily median the targets were judged by).
    const duc = (t.kind === "part" || t.kind === "set") && c.advice ? ducatWorth(c.model, it, c.advice.platPerDucat) : null;
    const asked = priceFor(c, it, t.rank, subtype, book, existing, t.crack != null ? aboveCrack(t.crack) : null);
    if (duc != null && asked.price != null && ducatsBeat(asked.price, duc)) {
      const why = `At ${asked.price}p (${asked.why}) it's ${asked.price <= duc ? "worth more as ducats" : "too close to its ducats to sell"}: ~${Math.round(duc * 10) / 10}p to you`;
      if (existing) actions.push({ type: "remove", kind: t.kind, item: it, order: existing, why, ...where, ...PLAN_RULE.ducats });
      else actions.push(skip(why, PLAN_RULE.ducats, asked.price));
      continue;
    }
    const { price, why: priceWhy, value } = asked;
    // A relic that sells for no more than a crack of it is worth: crack it instead. What it
    // sells for is what sellers you could trade with ask, not a few lucky sales.
    const worth = value == null ? price : price == null ? value : Math.min(price, value);
    if (worth != null && t.crack != null && worth <= t.crack) {
      const ref = subtype ?? "intact";
      const why = `Goes for about ${Math.round(worth * 10) / 10}p, no more than ${/^[aeiou]/.test(ref) ? "an" : "a"} ${ref} crack is worth (about ${t.crack}p): kept to crack`;
      if (existing) leaveListed(t.kind, it, existing, why, { ...where, ...PLAN_RULE.crack });
      else actions.push(skip(why, PLAN_RULE.crack, worth));
      continue;
    }
    if (price == null || price < min) {
      const why = price == null ? "No price to go by" : `Sells for ${price}p, under your ${minWords}`;
      const tag = price == null ? PLAN_RULE.noPrice : minRule(min);
      if (existing) leaveListed(t.kind, it, existing, why, { ...where, ...tag });
      else actions.push(skip(why, tag, price));
      continue;
    }
    if (!existing) {
      actions.push({ type: "create", kind: t.kind, item: it, rank: it.maxRank != null ? t.rank : null, subtype, quantity: t.quantity, platinum: price, why: t.why, priceWhy, ...own });
    } else if (existing.quantity !== t.quantity || existing.platinum !== price) {
      actions.push({ type: "update", kind: t.kind, item: it, order: existing, quantity: t.quantity, platinum: price, why: t.why, priceWhy, ...own });
    }
  }

  // Other listings in a ticked category (ones you made yourself, or for spares that are gone):
  // never more than you hold. Removed when you hold none, lowered when you hold fewer, else kept.
  // One that lists copies the keep rules would hold back is your call: it stays, and the plan says so.
  for (const o of c.orders) {
    if (claimed.has(o.id) || !o.visible || c.paused[listingKey(o)]) continue;
    const it = c.index.byId.get(o.itemId);
    if (!it || !managed(it)) continue;
    const kind = kindOfItem(c.model, it)!;
    const where: Ruled = { cat: catOfItem(c.model, it, kind) };
    const held = heldFor(c.model, it, o);
    // null: MyOrbiter can't count it (a set it doesn't know the parts of, a renamed mod): leave it.
    if (held == null) continue;
    if (held <= 0) {
      actions.push({ type: "remove", kind, item: it, order: o, why: "You don't hold any now", ...where, ...PLAN_RULE.held });
      continue;
    }
    if (held < o.quantity) {
      actions.push({ type: "update", kind, item: it, order: o, quantity: held, platinum: o.platinum, why: `You hold ${held} now`, priceWhy: "price kept", ...where, ...PLAN_RULE.held });
      continue;
    }
    // A prime part or set now worth more to you as ducats than it sells for (at the price it's
    // listed at, or what it sells for if that's less): it comes down.
    const asDucats = c.advice && (kind === "part" || kind === "set") ? ducatsFor(c, kind, it, o) : null;
    if (asDucats) {
      actions.push({ type: "remove", kind, item: it, order: o, why: asDucats, ...where, ...PLAN_RULE.ducats });
      continue;
    }
    const rule = provenSpare(spareCtx, kind, it, o.rank, o.subtype);
    // Copies a hard rule holds back (Requiem mods while lich weapons are left, copies installed in a
    // build): a listing for them comes down to what can go, whoever made it. An earlier MyOrbiter
    // listed Requiem mods two to a name.
    if (rule?.cap != null && rule.cap < o.quantity) {
      if (rule.cap <= 0) actions.push({ type: "remove", kind, item: it, order: o, why: upper(rule.short), ...where, ...PLAN_RULE.hard });
      else actions.push({ type: "update", kind, item: it, order: o, quantity: rule.cap, platinum: o.platinum, why: `${upper(rule.short)}: lowered to the ${rule.cap} spare`, priceWhy: "price kept", ...where, ...PLAN_RULE.hard });
      continue;
    }
    if (rule && rule.spare < o.quantity) {
      actions.push({ type: "skip", kind, name: it.name, itemId: it.id, rank: it.maxRank != null ? (o.rank ?? 0) : null, subtype: o.subtype, quantity: o.quantity, each: o.platinum, why: `${upper(rule.kept)} would be kept: ${AS_LISTED}`, ...where, ...PLAN_RULE.listed });
    }
  }
  return fitLimit(c, managed, actions, r.priority ?? "plat");
}

const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A prime part's or set's ducats against what it sells for, at your rate: why it's better as
 * ducats, or null. A listing is judged at its own price when that's under the daily median (a set
 * listed at 5p sells for 5p, whatever the median says); a set by all its parts' ducats together.
 */
function ducatsFor(c: BulkContext, kind: BulkKind, it: MarketItem, o: MyOrder | null = null): string | null {
  if (!c.advice) return null;
  const median = c.model.price(it.name);
  const plat = o ? (median == null ? o.platinum : Math.min(o.platinum, median)) : median;
  if (kind === "part") {
    const part = c.model.partByName.get(it.name)?.[0];
    return part ? ducatsWin(plat, part.ducats, c.advice) : null;
  }
  const parts = it.gameRef ? c.model.partsByParent.get(it.gameRef) : undefined;
  if (!parts?.length) return null;
  return ducatsWin(plat, parts.reduce((n, p) => n + p.ducats * p.required, 0), c.advice);
}

/** What the keep rules are worked out from, for a plan or for one listing about to be made. */
export interface SpareContext {
  model: Model;
  index: MarketIndex | null;
  sell?: SellChoices;
  advice?: DucatOptions;
  drops?: ReadonlyMap<string, number>;
  /** The choices on Sell spares: their keep numbers, and what's never sold. Absent: the usual numbers. */
  rules?: SparesRules;
}

export interface ProvenSpare {
  /** Copies the keep rules leave you to sell, at this rank and variant. */
  spare: number;
  /** What's kept, in words ("your own copy and one to give away"). */
  kept: string;
  /** The rule, in a short sentence, for a notice ("Requiem mods are kept while Kuva and Tenet weapons are left"). */
  short: string;
  /**
   * The most a listing may keep up whoever made it, when a hard rule applies: Requiem and Antivirus
   * mods while lich weapons are left, copies installed in a build. Null: no hard rule.
   */
  cap: number | null;
}

/**
 * What the keep rules leave you to sell of an item at a rank and variant, or null when no rule
 * applies (MyOrbiter can't count it): a set and the parts to build anything unbuilt, two copies of
 * each mod (five of a Requiem or Antivirus mod while lich weapons are left, every one while that
 * isn't known), copies installed in a build never, the copies of your one maxed arcane.
 */
export function provenSpare(c: SpareContext, kind: BulkKind, it: MarketItem, rank: number | null, subtype: string | null): ProvenSpare | null {
  const m = c.model;
  if (kind === "mod") {
    const mod = modRows(m).find((r) => r.unique === it.gameRef) ?? modRows(m).find((r) => r.name === it.name);
    if (!mod) return null;
    const at = (r: { rank: number }) => it.maxRank == null || r.rank === (rank ?? 0);
    const keep = c.rules ? modKeepOf(c.rules, mod) : (mod.keep ?? MOD_KEEP);
    const spare = modSpares({ ...mod, keep }).filter(at).reduce((n, r) => n + r.count, 0);
    const installed = mod.ranks.filter(at).reduce((n, r) => n + (r.installed ?? 0), 0);
    const lich = /\/Immortal\/Antivirus/.test(mod.unique) ? "Antivirus mods are kept while Coda weapons are left to master" : "Requiem mods are kept while Kuva and Tenet weapons are left to master";
    const usual = keep === MOD_KEEP;
    const short = mod.keptFor
      ? keep === LICH_KEEP_ALL
        ? `${lich.split(" are kept")[0]} are all kept: which lich weapons you have left isn't known`
        : `${lich} (${keep} kept)`
      : installed
        ? `${installed} installed in a build; ${usual ? "your best copy and one to give away are kept" : `${keep} kept in all (Sell spares), one loose to give away`}`
        : usual ? "your best copy and one to give away are kept" : `${keep} of each are kept (Sell spares), your best counted`;
    // Installed copies: the count a listing was made from likely took them for loose ones.
    const kept = mod.keptFor ? mod.keptFor.split(":")[0].replace(/^\d+ kept/, `${keep} kept`) : installed ? `the ${installed} installed and one to give away` : usual ? "your own copy and one to give away" : `${keep} copies, your best counted`;
    return { spare, kept, short, cap: mod.keptFor || installed ? spare : null };
  }
  if (kind === "set") {
    const set = it.gameRef ? allSetRows(m, c.index).find((r) => r.unique === it.gameRef) : undefined;
    return set ? { spare: set.sellable, kept: "one set to build and master", short: "a set is kept while you still have it to build or master", cap: null } : null;
  }
  if (kind === "part") {
    const part = partRows(m, saveForSets(c.sell, c.advice?.platPerDucat ?? 0, c.drops)).find((r) => r.name === it.name);
    if (!part) return null;
    const build = part.keep - part.forSet;
    const keepN = c.rules?.prime.keep ?? 0;
    const spare = Math.max(0, Math.min(part.spare, part.quantity - keepN));
    const kept = [build ? `the ${build > 1 ? "copies" : "copy"} to build ${part.parentName}` : "", part.forSet ? `${part.forSet} saved for the ${part.parentName} Set` : "", keepN > part.keep ? `${keepN} in all (Sell spares)` : ""].filter(Boolean).join(" and ");
    return { spare, kept: kept || "nothing", short: kept ? `${kept} ${part.keep === 1 && keepN <= 1 ? "is" : "are"} kept` : "nothing is kept", cap: null };
  }
  if (kind === "imprint") {
    const held = it.gameRef ? (m.imprints?.get(it.gameRef) ?? 0) : 0;
    const keepN = c.rules?.imprints.keep ?? 0;
    if (!m.imprints) return null;
    return keepN ? { spare: Math.max(0, held - keepN), kept: `${keepN} of the breed`, short: `${keepN} of each breed are kept (Sell spares)`, cap: null } : { spare: held, kept: "nothing", short: "imprints are all spare", cap: null };
  }
  if (kind === "other") {
    const rows = spareRows(m, c.index, c.sell, c.advice?.platPerDucat ?? 0, c.advice?.squad ?? 1, c.drops).filter(otherSpare);
    const r = rows.find((x) => x.name === it.name && (x.subtype ?? "") === (subtype ?? it.subtypes?.[0] ?? "")) ?? rows.find((x) => x.name === it.name && !x.subtype);
    if (!r) return null;
    const extra = c.rules ? extraKeepOf(c.rules, r) : 0;
    const spare = c.rules ? rowSpareUnder(c.rules, r) : r.spare;
    const kept = r.keep + extra;
    const why = `${r.why.charAt(0).toLowerCase()}${r.why.slice(1)}${extra ? `, and ${extra} more (Sell spares)` : ""}`;
    return { spare, kept: kept ? `${kept} (${why})` : "nothing", short: kept ? `${kept} kept: ${why}` : "nothing is kept", cap: null };
  }
  const a = arcaneRows(m).find((r) => r.name === it.name);
  if (!a) return null;
  const r = rank ?? 0;
  const k = c.rules?.arcanes.keepMaxed ?? 1;
  const yours = k === 1 ? "your maxed copy" : `your ${k} maxed copies`;
  // Whole maxed ones still to fuse count too: a listing made for them (Arcanes' List button) stays.
  if (r >= a.maxRank) return { spare: Math.max(0, Math.floor(a.copies / a.needed) - k), kept: yours, short: `${yours} ${k === 1 ? "is" : "are"} kept`, cap: null };
  if (r === 0) {
    const kept = a.complete ? (k === 1 ? "the copies your maxed one needs" : `the copies your ${k} maxed ones need`) : `the copies toward a maxed one (${a.copies}/${a.needed})`;
    return { spare: a.complete ? Math.min(a.unranked, Math.max(0, a.copies - k * a.needed)) : 0, kept, short: `${kept} are kept`, cap: null };
  }
  return null;
}

/**
 * warframe.market takes at most 100 orders per account. When the plan would go over, the listings
 * worth the most platinum (quantity × price) win, or with `priority` "trades" the ones that sell
 * most often (trades a day, worth breaking ties): the rest of the new ones are left out, and the
 * rest of your existing ones in the ticked categories make way. Listings you set to be left
 * alone, hidden ones and ones outside the ticked categories are never moved: they just take a slot.
 */
export function fitLimit(c: BulkContext, managed: (it: MarketItem) => boolean, actions: BulkAction[], priority: BulkRules["priority"] = "plat"): BulkAction[] {
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
    if (!it || !kind || !managed(it) || !o.visible || c.paused[listingKey(o)]) {
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
    if (a.type === "create" && dropCreates.has(a)) out.push({ type: "skip", kind: a.kind, name: a.item.name, itemId: a.item.id, rank: a.rank, subtype: a.subtype, quantity: a.quantity, each: a.platinum, why: byTrades ? LIMIT_WHY_TRADES : LIMIT_WHY, cat: a.cat, family: a.family, rule: "plan.limit", ruleText: `Over ${limit} listings` });
    else if (a.type === "update" && dropOrders.has(a.order.id)) continue; // replaced by the removal below
    else out.push(a);
  }
  for (const f of dropOrders.values()) {
    out.push({ type: "remove", kind: f.kind!, item: f.item!, order: f.order!, why: `Makes room for listings ${byTrades ? "that sell more often" : "worth more"} (warframe.market allows ${limit})`, cat: catOfItem(c.model, f.item!, f.kind!), rule: "plan.room", ruleText: "Makes room" });
  }
  return out;
}
