// Everything tradable you hold more of than you need: not just prime parts, mods and arcanes but
// weapon parts and blueprints, relics, gems, fish, Captura scenes, Ayatan sculptures and veiled
// rivens. What you need is worked out from what you haven't built yet: every unmastered thing
// you don't own keeps the parts, blueprints and resources its recipe takes.
import { baseId, gearSetParts, heldCount, UNOBTAINABLE, type Model, type Refinement } from "./model";
import { craftVariantOf, findItem, type MarketIndex } from "./market";
import { copyValue } from "./vosfor";
import { idOf, perModel } from "./memo";
import { dropsVersion } from "./drops";
import { arcaneRows, inventoryRows, MASTERY_CATEGORIES, modRows, modSpares, partNeeded, partRows, relicRows, saveForSets, savedLine, saveSource, setRows, setSaves, worthSaving, type SaveForSets, type SetSave, type InventoryItem, type InventoryKind, type RelicRow, type SetRow } from "./views";
import { expectedBest } from "./advice";
import { isResource } from "./collection";

/** Something unbuilt that a held item goes into, and how many of it the recipe takes. */
export interface Need {
  item: string;
  count: number;
}

export interface SpareRow {
  key: string;
  /** The name warframe.market lists it under (the game calls some parts by internal names). */
  name: string;
  /** What TennoScope calls it, when that differs. */
  heldAs: string | null;
  unique: string;
  kind: InventoryKind;
  /** "Weapon part", "Gem", "Captura scene"…: what it is, in words. */
  type: string;
  rank: number | null;
  subtype: string | null;
  quantity: number;
  keep: number;
  spare: number;
  /** Each, at this rank or refinement: the market's price, as every page shows it. */
  price: number | null;
  /**
   * What each spare copy counts for in Spare value: the price, except unranked arcanes, which count
   * as their share of a maxed one when that's lower (a pile of them rarely fetches their own price).
   */
  spareEach: number | null;
  /** The spare copies at `spareEach`. */
  worth: number | null;
  tradesPerDay: number | null;
  /** Why the kept copies are kept, or why everything can go. */
  why: string;
  /** What you'd build with the kept copies, biggest first. */
  needs: Need[];
  /** Relics: what one crack is worth on average, solo, at this refinement (intact odds for exceptional and flawless). */
  crack: number | null;
  /** Spare copies that make up whole sets you can sell (a Mandonel Barrel in a spare Mandonel Set): better sold as the set. */
  inSets: number;
  /** Copies waiting for a set worth more whole (Sell spares), counted in `keep`. */
  forSet: number;
}

/**
 * For each item path, the unbuilt things whose recipes take it: everything masterable you haven't
 * mastered and don't own (built, or building in the foundry). The recipe's own parts and resources,
 * and one level down, what each part not built yet takes to build: WFCD's catalog lists a
 * warframe's Neuroptics, not the 40 Purged Dagonic the Neuroptics take, so those come from the
 * Foundry recipes (Model.recipes, the data buildPlan reads), for every copy of the part still to
 * build. A part held as a blueprint or not held at all counts the same: either way it's still to build.
 */
export const needsByUnique = perModel(needsByUniqueFresh, () => "");
function needsByUniqueFresh(m: Model): Map<string, Need[]> {
  const out = new Map<string, Need[]>();
  const add = (u: string, need: Need) => {
    const list = out.get(u) ?? [];
    list.push(need);
    out.set(u, list);
  };
  const recipes = m.recipes?.recipes;
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable || !(item.category in MASTERY_CATEGORIES)) continue;
    if (UNOBTAINABLE.has(item.name) || m.isMastered(item.uniqueName) || m.owned(item.uniqueName) > 0) continue;
    for (const c of item.components ?? []) {
      const count = c.itemCount ?? 1;
      add(baseId(c.uniqueName), { item: item.name, count });
      // The part's own recipe (not the item's blueprint, whose recipe is this list; not a resource).
      const recipe = recipes?.[c.uniqueName];
      if (!recipe || c.name === "Blueprint" || isResource(c)) continue;
      // Built copies, one building in the foundry counted (Model.owned).
      const left = count - m.owned(c.uniqueName);
      if (left <= 0) continue;
      const what = c.name.startsWith(item.name) ? c.name : `${item.name} ${c.name}`;
      for (const [path, n] of recipe.i) add(baseId(path), { item: what, count: n * left });
    }
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Sets that aren't prime but that warframe.market trades whole: Mandonel, Lato Vandal, the Wraith
 * and Vandal weapons, archguns, necramechs. Complete sets of their blueprint and parts, beyond what
 * you keep to build something unbuilt. It takes warframe.market's item list to know which sets
 * exist, so without it there are none.
 */
export const gearSetRows = perModel(gearSetRowsFresh, (index = null, needs = undefined) => `${idOf(index)}|${idOf(needs)}`);
function gearSetRowsFresh(m: Model, index: MarketIndex | null, needs: Map<string, Need[]> = needsByUnique(m)): SetRow[] {
  if (!index) return [];
  const rows: SetRow[] = [];
  const seen = new Set<string>();
  for (const it of index.byId.values()) {
    const tags = it.tags ?? [];
    if (!it.gameRef || !tags.includes("set") || tags.includes("prime") || seen.has(it.gameRef)) continue;
    const item = m.catalogByUnique.get(it.gameRef);
    const parts = item ? gearSetParts(m, it.gameRef) : null;
    if (!item || !parts) continue;
    seen.add(it.gameRef);
    const owned = parts.map((p) => heldCount(m, p.unique));
    if (owned.every((n) => n === 0)) continue;
    const keep = parts.map((p, i) => Math.min(owned[i], sum((needs.get(p.unique) ?? []).map((x) => x.count))));
    const complete = Math.min(...parts.map((p, i) => Math.floor(owned[i] / p.required)));
    const sellable = Math.max(0, Math.min(...parts.map((p, i) => Math.floor((owned[i] - keep[i]) / p.required))));
    const prices = parts.map((p) => m.price(p.name));
    rows.push({
      name: it.name.replace(/ Set$/, ""),
      unique: it.gameRef,
      category: item.category,
      completeSets: complete,
      sellable,
      keptForBuild: complete > sellable,
      mastered: m.isMastered(it.gameRef),
      ownedBuilt: m.owned(it.gameRef) > 0,
      setPrice: m.price(it.name),
      partsPrice: prices.every((x) => x != null) ? sum(parts.map((p, i) => (prices[i] as number) * p.required)) : null,
      ducats: 0,
      vaulted: false,
      tradesPerDay: m.tradesPerDay(it.name),
      missing: parts.map((p, i) => ({ name: p.name, count: Math.max(0, p.required - (owned[i] - complete * p.required)), price: prices[i] })).filter((x) => x.count > 0),
      parts: parts.map((p, i) => ({ name: p.name, owned: owned[i], required: p.required })),
      prime: false,
    });
  }
  return rows;
}

/**
 * The other sets warframe.market trades whole (Lato Vandal, Mandonel…) your loose parts wait for,
 * by the set's path: worth clearly more whole than as parts (worthSaving), and every missing part one you've been
 * getting lately (core/drops.ts) or that a relic still drops. Copies held are the loose ones, after
 * what building takes and the complete sets you can sell, enough for one more set.
 */
export function gearSetSaves(m: Model, index: MarketIndex | null, opts: SaveForSets, needs: Map<string, Need[]> = needsByUnique(m)): Map<string, SetSave> {
  const out = new Map<string, SetSave>();
  for (const s of gearSetRows(m, index, needs)) {
    if (s.setPrice == null || s.partsPrice == null || !worthSaving(s.setPrice, s.partsPrice)) continue;
    const parts = gearSetParts(m, s.unique) ?? [];
    const held: SetSave["held"] = [];
    const missing: SetSave["missing"] = [];
    let gettable = true;
    for (const p of parts) {
      const owned = heldCount(m, p.unique);
      const keep = Math.min(owned, sum((needs.get(p.unique) ?? []).map((x) => x.count)));
      const have = Math.min(Math.max(0, owned - keep - s.sellable * p.required), p.required);
      if (have) held.push({ name: p.name, count: have });
      if (have >= p.required) continue;
      const from = saveSource(m, p.name, opts.drops);
      if (!from) gettable = false;
      else missing.push({ name: p.name, count: p.required - have, from, got: opts.drops.get(p.name) ?? 0 });
    }
    if (!gettable || !held.length || !missing.length) continue;
    out.set(s.unique, { set: s.name, unique: s.unique, setPrice: s.setPrice, partsPrice: s.partsPrice, held, missing, prime: false });
  }
  return out;
}

/** Every set your loose parts wait for, prime and the others (Sets → Saving up). */
export function allSetSaves(m: Model, index: MarketIndex | null, opts: SaveForSets): Map<string, SetSave> {
  return new Map([...setSaves(m, opts), ...gearSetSaves(m, index, opts)]);
}

/** Every set you hold parts of: prime ones, and (with warframe.market's item list) the others it trades. */
export function allSetRows(m: Model, index: MarketIndex | null): SetRow[] {
  return [...setRows(m), ...gearSetRows(m, index)];
}

/** Display names for recipe parts the game knows by internal names ("Tn Concrete Archgun Barrel" is the Mandonel Barrel). */
const partNames = perModel(partNamesFresh, () => "");
function partNamesFresh(m: Model): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of m.catalogByUnique.values()) {
    for (const c of item.components ?? []) {
      const u = baseId(c.uniqueName);
      if (out.has(u) || !u.includes("/Recipes/")) continue;
      out.set(u, c.name.startsWith(item.name) ? c.name : `${item.name} ${c.name}`);
    }
  }
  return out;
}

const SCENE = /(Scene|Simulacrum)$|\/(PhotoBooth|Photobooth|DangerRoom)/;
/** Veiled rivens are `…/Randomized/Raw…RandomMod`; the game files unveiled ones under the same names (Rivens handles those, by auction). */
const VEILED = /\/Randomized\/Raw/;
const UNVEILED = /\/Randomized\/(?!Raw)/;

function typeOf(r: InventoryItem, tradeName: string): string {
  if (r.kind === "part") return "Prime part";
  if (r.kind === "relic") return "Relic";
  if (r.kind === "arcane") return "Arcane";
  if (r.kind === "imprint") return "Imprint";
  if (r.kind === "mod") return VEILED.test(r.unique) ? "Veiled riven" : "Mod";
  const u = r.unique;
  if (SCENE.test(r.name) || SCENE.test(u)) return /Simulacrum$|DangerRoom/.test(`${r.name}${u}`) ? "Simulacrum" : "Captura scene";
  if (/FusionTreasures/.test(u)) return /Ornament/.test(u) ? "Ayatan star" : "Ayatan sculpture";
  if (/\/Gems\//.test(u)) return "Gem";
  if (/\/Fish\//.test(u)) return "Fish";
  if (/\/Focus\//.test(u)) return "Focus lens";
  if (/Mechs\//.test(u)) return "Necramech part";
  if (/LandingCraftRecipes/.test(u)) return "Ship part blueprint";
  if (/WeaponParts\//.test(u)) return / Blueprint$/.test(tradeName) ? "Weapon part blueprint" : "Weapon part";
  if (r.kind === "blueprint") return "Blueprint";
  return "Resource";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Things you choose to keep whatever the rules say (Settings): off means never counted as spare. */
export interface SellChoices {
  veiledRivens: boolean;
  /**
   * Relics worth more sold than cracked (each reward at its price, or its ducats at your rate when
   * that's more) count as spare; relics that drop a part you still need (partNeeded: for a prime
   * still to build, or for a weapon made from it, as Akvasto Prime takes two Vasto Primes) are kept
   * either way.
   * Off keeps every relic. (Named anew when it became conditional and on by default, so an older
   * "keep every relic" doesn't carry over.)
   */
  relicsWorthSelling: boolean;
  /**
   * Loose prime parts of a set worth more whole, whose missing parts you can get, wait for the set
   * instead of being sold one by one (views.ts, setSaves).
   */
  saveForSets: boolean;
}
export const defaultSellChoices = (): SellChoices => ({ veiledRivens: false, relicsWorthSelling: true, saveForSets: true });

/**
 * Modular gear: hounds, MOAs, kitguns, zaws and amps are built from parts, and each family's
 * masterable pieces (a hound's model, a kitgun's chamber, a zaw's strike) are mastered one by one.
 * Its parts aren't in any recipe, so they're kept while anything in the family is unmastered.
 */
const FAMILIES: { name: string; plural: string; part: RegExp; gear: RegExp }[] = [
  { name: "Hound", plural: "hounds", part: /ZanukaPet/, gear: /ZanukaPets\/ZanukaPetParts\/ZanukaPetPartHead/ },
  { name: "MOA", plural: "MOAs", part: /MoaPet/, gear: /MoaPets\/MoaPetParts\/MoaPetHead/ },
  { name: "Kitgun", plural: "kitguns", part: /SUModular|InfKitGun|KitGun/i, gear: /(SUModular(Primary|Secondary)Set\d+|InfKitGun)\/Barrels?\// },
  { name: "Zaw", plural: "zaws", part: /ModularMelee|OstronMelee/, gear: /ModularMelee(\d+|Infested)\/Tips?\// },
  { name: "Amp", plural: "amps", part: /OperatorAmplifiers|OperatorAmp|SentAmp/, gear: /OperatorAmplifiers\/.*Barrel/ },
];

/** For each family, how many of its masterable pieces you haven't mastered. */
const unmasteredByFamily = perModel(unmasteredByFamilyFresh, () => "");
function unmasteredByFamilyFresh(m: Model): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable || m.isMastered(item.uniqueName)) continue;
    const f = FAMILIES.find((x) => x.gear.test(item.uniqueName));
    if (f) out.set(f.name, (out.get(f.name) ?? 0) + 1);
  }
  return out;
}

/** "Carmine Penta, Mandonel and 3 more". */
function listNeeds(needs: Need[]): string {
  const names = needs.map((n) => (n.count > 1 ? `${n.item} (${n.count})` : n.item));
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * Every tradable thing you hold, with how many you keep and why, and how many can go. `index`
 * (warframe.market's item list) names things the game calls something else; without it, only
 * what the price table knows by the game's name or the recipe's part name is found.
 */
/**
 * What one crack of a relic is worth at a refinement: each reward at its price (or its ducats at
 * your rate, when that's more), at that refinement's own odds. Solo, or the best of four cards
 * when you crack in radshares (`squad`, your Solo/Radshare choice on Relics). Null when a prime
 * part among its rewards has no price yet.
 */
export function crackValue(row: RelicRow | undefined, refinement: Refinement, squad = 1): number | null {
  const at = row?.byRefinement[refinement];
  if (!at || at.ev == null) return null;
  return Math.round((squad > 1 ? expectedBest(at.out, squad) : at.ev) * 10) / 10;
}

/** Relic rows by base, per model and ducat rate, so a price check can ask what a crack is worth. */
const relicCache = new WeakMap<Model, Map<number, Map<string, RelicRow>>>();
/**
 * What a crack of a listed relic is worth, by warframe.market's name and refinement ("Axi A1
 * Relic", "radiant"); null when it isn't a relic or isn't known. A relic listing is never priced
 * at or under it: cracking would be worth more.
 */
export function relicCrackFor(m: Model, name: string, subtype: string | null, platPerDucat = 0, squad = 1): number | null {
  if (!/ Relic$/.test(name)) return null;
  let byRate = relicCache.get(m);
  if (!byRate) relicCache.set(m, (byRate = new Map()));
  let rows = byRate.get(platPerDucat);
  if (!rows) byRate.set(platPerDucat, (rows = new Map(relicRows(m, { includeUnowned: true, platPerDucat }).map((r) => [r.base, r]))));
  const refinement = (subtype ? subtype.charAt(0).toUpperCase() + subtype.slice(1) : "Intact") as Refinement;
  return crackValue(rows.get(name.replace(/ Relic$/, "")), refinement, squad);
}

/** The lowest whole price that beats a crack worth `crack`. */
export const aboveCrack = (crack: number | null) => (crack == null ? null : Math.floor(crack) + 1);

export const spareRows = perModel(spareRowsFresh, (index = null, sell = undefined, platPerDucat = 0, squad = 1, drops = undefined) => `${idOf(index)}|${sell ? JSON.stringify(sell) : "-"}|${platPerDucat}|${squad}|${dropsVersion(drops)}`, (r: SpareRow) => r.key);
function spareRowsFresh(m: Model, index: MarketIndex | null = null, sell: SellChoices = defaultSellChoices(), platPerDucat = 0, squad = 1, drops: ReadonlyMap<string, number> = new Map()): SpareRow[] {
  const families = unmasteredByFamily(m);
  const needs = needsByUnique(m);
  const display = partNames(m);
  const save = saveForSets(sell, platPerDucat, drops);
  const parts = new Map(partRows(m, save).map((p) => [p.name, p]));
  const modList = modRows(m);
  const modKept = new Map(modList.filter((r) => r.keptFor).map((r) => [r.name, r.keptFor!]));
  const mods = new Map(modList.map((r) => [r.name, new Map(modSpares(r).map((x) => [x.rank, x.count]))]));
  const arcanes = new Map(arcaneRows(m).map((a) => [a.name, a]));
  const relicKeep = relicsYouNeed(m);
  // A crack counts each reward at its price, or its ducats at your rate when that's more.
  const relicEv = new Map(relicRows(m, { platPerDucat }).map((r) => [r.base, r]));
  // Parts that go out inside whole sets you can sell.
  const inSets = new Map<string, number>();
  for (const s of gearSetRows(m, index, needs)) {
    if (s.sellable <= 0) continue;
    for (const p of gearSetParts(m, s.unique) ?? []) inSets.set(p.unique, (inSets.get(p.unique) ?? 0) + s.sellable * p.required);
  }
  // Loose parts of other gear sets waiting for the set (Sell spares), by path.
  const gearSaved = new Map<string, { count: number; save: SetSave }>();
  if (save) {
    for (const g of gearSetSaves(m, index, save, needs).values()) {
      for (const p of gearSetParts(m, g.unique) ?? []) {
        const h = g.held.find((x) => x.name === p.name);
        if (h) gearSaved.set(p.unique, { count: h.count, save: g });
      }
    }
  }
  const keyWants = new Map(KEYS.map((k) => [k.mission, partsStillNeededFrom(m, k.mission)]));
  const damaged = damagedPartNeeds(m);
  const out: SpareRow[] = [];

  for (const r of inventoryRows(m)) {
    if (r.kind === "gear" || r.type === "Built part") continue;
    if (r.kind === "mod" && UNVEILED.test(r.unique)) continue;
    // The name warframe.market lists it under, and so its price.
    let name = r.marketName;
    let price = r.price;
    if (!name && r.kind === "mod" && VEILED.test(r.unique)) {
      const veiled = `${r.name} (Veiled)`;
      if (m.price(veiled) != null || index?.byName.has(veiled.toLowerCase())) {
        name = veiled;
        price = m.price(veiled);
      }
    }
    // Sold as the blueprint or built (Ambassador Barrel, Cinta Lower Limb Blueprint): the market's
    // item, as the variant this copy is.
    let variant: string | null = null;
    if ((r.kind === "resource" || r.kind === "blueprint") && index) {
      const v = craftVariantOf(index, r.unique);
      if (v) {
        name = v.item.name;
        variant = v.subtype;
        // The daily price is for the first variant only.
        price = v.item.subtypes?.[0] === v.subtype ? m.price(name) : null;
      }
    }
    if (!name && (r.kind === "resource" || r.kind === "blueprint")) {
      const shown = display.get(baseId(r.unique)) ?? r.name;
      const listed = index ? findItem(index, shown, r.unique) : null;
      // A listing for something else entirely (the built weapon, a whole set) isn't this.
      const fits = listed && !listed.tags?.includes("set") && !(listed.tags?.includes("weapon") && !listed.tags?.includes("component") && !listed.tags?.includes("blueprint"));
      if (fits) name = listed.name;
      else if (m.price(shown) != null) name = shown;
      if (name) price = m.price(name);
    }
    if (!name) continue;

    let keep = 0;
    let why = "";
    let need: Need[] = [];
    let crack: number | null = null;
    // What a spare copy counts for, when it isn't the price (unranked arcanes).
    let spareEach: number | null | undefined;
    if (r.kind === "part" && parts.has(r.name)) {
      // A part the market prices but the catalog has no ducats for isn't here: it falls through to
      // what still needs it, at the end.
      const p = parts.get(r.name)!;
      keep = p.keep;
      const build = p.keep - p.forSet;
      why = build ? `${plural(build, "copy", "copies")} to build ${p.keptFor === p.parentName ? p.parentName : `${p.parentName} for ${p.keptFor}`}` : p.parentMastered ? `${p.parentName} is mastered` : p.parentOwned ? `${p.parentName} is built` : "";
      if (p.saving) why = `${why}${why ? ". " : ""}${savedLine(p.forSet, p.saving)}`;
    } else if (r.kind === "mod" && VEILED.test(r.unique)) {
      keep = sell.veiledRivens ? 0 : r.quantity;
      why = sell.veiledRivens ? "Veiled rivens all count as spare: unveil any you'd rather roll yourself first" : "You keep veiled rivens (Sell spares, Sell veiled rivens)";
    } else if (r.kind === "mod") {
      const spare = mods.get(r.name)?.get(r.rank ?? 0) ?? 0;
      keep = r.quantity - spare;
      why = keep ? (mods.get(r.name) && modKept.get(r.name)) || "Your best copy and one to give away" : "";
    } else if (r.kind === "arcane") {
      const a = arcanes.get(r.name);
      const spare = !a ? 0 : r.rank != null && r.rank >= a.maxRank ? a.extraMaxed : r.rank === 0 ? Math.min(r.quantity, a.unranked, a.spare) : 0;
      keep = r.quantity - spare;
      why = keep ? (a?.complete ? "Your maxed copy" : `Toward a maxed one (${a?.copies ?? 0}/${a?.needed ?? 21})`) : "";
      // Spare unranked copies count as their share of a maxed one: their own median, from a few
      // copies at a time, overstates what a pile of them fetches (vosfor.ts, copyValue). Only in
      // Spare value: Each stays the unranked price every other page shows.
      if (a && r.rank === 0 && a.priceMax != null) {
        const each = copyValue(m, a.name, a);
        if (price == null || each < price) {
          spareEach = Math.round(each * 10) / 10;
          if (spare) why = `${why ? `${why}; ` : ""}spare copies count as 1/${a.needed} of a maxed one (${a.priceMax}p) in Spare value`;
        }
      }
    } else if (r.kind === "relic") {
      const base = r.marketName?.replace(/ Relic$/, "") ?? "";
      const wanted = relicKeep.get(base);
      // Each refinement is its own thing to sell: its own odds, so its own crack value, against
      // what that refinement sells for. Never the intact price standing in for a radiant one.
      const refinement = (r.subtype ? r.subtype.charAt(0).toUpperCase() + r.subtype.slice(1) : "Intact") as Refinement;
      crack = crackValue(relicEv.get(base), refinement, squad);
      price = m.relicPrice(base, refinement);
      const words = refinement.toLowerCase();
      const aWords = `${/^[aeiou]/.test(words) ? "an" : "a"} ${words}`;
      if (wanted) {
        keep = r.quantity;
        need = wanted.map((w) => ({ item: w, count: 1 }));
        why = `Drops ${listNeeds(need)}, which you still need`;
      } else if (!sell.relicsWorthSelling) {
        keep = r.quantity;
        why = "You keep relics (Sell spares, Relics)";
      } else if (crack == null || price == null) {
        // Only sold when it's sure to beat cracking: without both numbers, it's kept.
        keep = r.quantity;
        why = price == null ? `Too few ${words} ones sold lately to price it: kept to crack` : "What a crack is worth isn't known: kept to crack";
      } else if (crack >= price) {
        keep = r.quantity;
        why = `Worth more cracked: about ${round1(crack)}p ${aWords} crack${squad > 1 ? " in a radshare" : ""}, ${price}p sold`;
      } else {
        why = `Sells for more than ${aWords} crack is worth (about ${round1(crack)}p${squad > 1 ? " in a radshare" : ""}, ${price}p sold)`;
      }
    } else if (FAMILIES.some((f) => f.part.test(r.unique)) && (r.kind === "resource" || r.kind === "blueprint")) {
      const f = FAMILIES.find((x) => x.part.test(r.unique))!;
      const left = families.get(f.name) ?? 0;
      keep = left ? r.quantity : 0;
      why = left ? `${f.name} part: you have ${plural(left, f.plural.replace(/s$/, ""), f.plural)} still to master` : `Every ${f.name.toLowerCase()} piece is mastered`;
    } else if (DAMAGED.test(r.unique)) {
      // Necramech and Entrati arch-gun components are each built from one damaged part.
      const wanted = damaged.get(damagedSlot(r.unique)) ?? [];
      keep = Math.min(r.quantity, wanted.length);
      why = wanted.length ? `To build ${listNeeds(wanted.map((item) => ({ item, count: 1 })))}` : "Nothing you still need to build takes it";
    } else if (KEYS.some((k) => k.test.test(r.unique) || k.test.test(r.name)) && (r.kind === "resource" || r.kind === "blueprint")) {
      // A key, or what you make one from: kept while the fight it opens drops a part you still need.
      const k = KEYS.find((x) => x.test.test(r.unique) || x.test.test(r.name))!;
      const wanted = keyWants.get(k.mission) ?? [];
      keep = wanted.length ? r.quantity : 0;
      why = wanted.length ? `Opens ${k.label}, which drops ${listNeeds(wanted.slice(0, 3).map((item) => ({ item, count: 1 })))}, still to get` : `Nothing ${k.label} drops is still needed`;
    } else if (r.kind === "imprint") {
      // An imprint only hatches a companion: one you'd breed you keep by not listing it.
      why = "Only good for breeding: sell the ones you won't hatch";
    } else if (SCENE.test(r.name) || SCENE.test(r.unique)) {
      keep = Math.min(1, r.quantity);
      why = "One to use in Captura";
    } else {
      // A part's blueprint (…DuviriRifleBarrelBlueprint) builds the part the recipe lists
      // (…DuviriRifleBarrel): kept for it, less the built copies you already hold.
      const base = baseId(r.unique);
      // Warframe parts are listed as …ChassisComponent, weapon parts as …Barrel.
      const stem = base.replace(/Blueprint$/, "");
      const part = !needs.has(base) && /.Blueprint$/.test(base) ? ([stem, `${stem}Component`].find((u) => needs.has(u)) ?? stem) : null;
      need = [...(needs.get(part ?? base) ?? [])].sort((a, b) => b.count - a.count);
      const total = need.reduce((n, x) => n + x.count, 0);
      const built = part ? m.owned(part) : 0;
      keep = Math.min(r.quantity, Math.max(0, total - built));
      why = !total ? "Nothing you still need to build takes it" : keep || !built ? `For ${listNeeds(need)}` : `You already hold the built part for ${listNeeds(need)}`;
    }
    keep = Math.max(0, Math.min(r.quantity, keep));
    // Shared out between rows of the same thing (the set counts every copy held).
    const waits = gearSaved.get(baseId(r.unique));
    let forSet = 0;
    if (waits && waits.count > 0 && keep < r.quantity) {
      forSet = Math.min(waits.count, r.quantity - keep);
      waits.count -= forSet;
      keep += forSet;
      why = `${why}${why ? ". " : ""}${savedLine(forSet, waits.save)}`;
    }
    const spare = r.quantity - keep;
    const counted = spareEach === undefined ? price : spareEach;
    if (!why) why = spare === r.quantity ? "Nothing keeps it" : "";
    const setsOf = Math.min(spare, inSets.get(baseId(r.unique)) ?? 0);
    if (setsOf) why = `${why}${why ? ". " : ""}${setsOf} of the spare ones make whole sets: better sold as the set (Sets)`;
    out.push({
      key: r.key,
      name,
      heldAs: name === r.name || r.kind === "relic" ? null : r.name,
      unique: r.unique,
      kind: r.kind,
      type: typeOf(r, name),
      rank: r.rank,
      subtype: variant ?? r.subtype,
      quantity: r.quantity,
      keep,
      spare,
      price,
      spareEach: counted,
      worth: counted == null ? null : counted * spare,
      tradesPerDay: r.kind === "relic" ? null : m.tradesPerDay(name),
      why,
      needs: need,
      crack,
      inSets: setsOf,
      forSet,
    });
  }
  return merge(out);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One row per listing: the game can hold one thing under two paths (two kinds of veiled rifle riven). */
function merge(rows: SpareRow[]): SpareRow[] {
  const by = new Map<string, SpareRow>();
  for (const r of rows) {
    const k = `${r.name}|${r.rank ?? ""}|${r.subtype ?? ""}`;
    const had = by.get(k);
    if (!had) {
      by.set(k, { ...r });
      continue;
    }
    had.quantity += r.quantity;
    had.keep += r.keep;
    had.spare += r.spare;
    had.inSets += r.inSets;
    had.forSet += r.forSet;
    had.worth = had.spareEach == null ? null : had.spareEach * had.spare;
  }
  return [...by.values()];
}

/**
 * Relics (by base, "Axi A1") that drop a part you still need, with those parts: the rule Prime
 * parts keeps copies by and Relics tags "need" by (partNeeded), so a Lex Prime Barrel counts while
 * Aklex Prime still wants a second Lex Prime, not only while Lex Prime is unbuilt.
 */
export const relicsYouNeed = perModel(relicsYouNeedFresh, () => "");
function relicsYouNeedFresh(m: Model): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const parts of m.partsByParent.values()) {
    for (const p of parts) {
      if (!partNeeded(m, p)) continue;
      for (const s of m.sourcesByReward.get(p.fullName) ?? []) {
        const list = out.get(s.base) ?? [];
        if (!list.includes(p.fullName)) list.push(p.fullName);
        out.set(s.base, list);
      }
    }
  }
  return out;
}

/** How long a pile of copies may take to sell and still count: a month of the whole market's sales. */
export const SELL_WITHIN_DAYS = 30;
/** The pace assumed for relics, whose sales warframe.market's figures never give: about one a day. */
export const UNKNOWN_TRADES_PER_DAY = 1;
/**
 * Of `count` copies, how many the market could take in SELL_WITHIN_DAYS at its pace (trades a
 * day): 232 copies of a mod that trades twice a day are 60 that count, not 232. No pace known:
 * none (nothing says it sells); relics pass UNKNOWN_TRADES_PER_DAY instead.
 */
export function sellableCopies(count: number, tradesPerDay: number | null | undefined, days = SELL_WITHIN_DAYS): number {
  if (tradesPerDay == null) return 0;
  return Math.min(count, Math.max(0, Math.ceil(tradesPerDay * days)));
}

/** One row's share of Inventory's figures (inventoryValue). */
export interface RowValue {
  market: number;
  easy: number;
  spare: number;
}

/** Inventory's three figures, and the spare one by kind. */
export interface ValueTotals {
  market: number;
  easy: number;
  spare: number;
  /** Spare value by kind (mods, prime parts…), so the pages' own totals can be traced back to it. */
  byKind: Map<InventoryKind, number>;
}

/**
 * What your inventory comes to on warframe.market, worked out one way for every page that shows it
 * (Inventory's figures and rows, the value chart on Stats):
 * - market: every tradable copy at the daily median, slow sellers included;
 * - easy (Quick-sale value): copies of what trades at least daily, kept ones too, no more of each
 *   item than the market sells in a month;
 * - spare (Spare value): the copies beyond what you keep, slow sellers too, no more of each item
 *   than the market sells in a month (a part that sells twice a week counts its 8 or 9, not all 40).
 * The month is per item, not per row: a mod held at two ranks, or a relic at two refinements, shares
 * one month of sales, and each row gets its share of the item's figure by platinum, so the rows add
 * up to the totals. Built gear has no price here: it can't be traded. Items warframe.market reports
 * no sales for count toward market but not toward easy or spare; relics, whose sales it never
 * reports, count about one a day.
 */
export function inventoryValue(rows: InventoryItem[], ledger: Map<string, SpareRow>): ValueTotals & { rows: Map<string, RowValue> } {
  type Member = { key: string; market: number; spare: number };
  const items = new Map<string, { pace: number | null; copies: number; plat: number; spareCopies: number; sparePlat: number; members: Member[] }>();
  for (const r of rows) {
    const s = ledger.get(r.key);
    const price = r.kind === "gear" && !s ? null : (s?.price ?? r.price);
    if (price == null) continue;
    const pace = s?.tradesPerDay ?? r.tradesPerDay ?? (r.kind === "relic" ? UNKNOWN_TRADES_PER_DAY : null);
    const k = `${r.kind}|${s?.name ?? r.name}`;
    const g = items.get(k) ?? { pace, copies: 0, plat: 0, spareCopies: 0, sparePlat: 0, members: [] };
    g.pace ??= pace;
    g.copies += r.quantity;
    g.plat += price * r.quantity;
    const each = s ? (s.spareEach ?? s.price) : null;
    const spare = s && s.spare > 0 && each != null ? each * s.spare : 0;
    if (s && s.spare > 0 && each != null) {
      g.spareCopies += s.spare;
      g.sparePlat += spare;
    }
    g.members.push({ key: r.key, market: price * r.quantity, spare });
    items.set(k, g);
  }
  const out = new Map<string, RowValue>();
  for (const g of items.values()) {
    const easy = (g.pace ?? 0) >= 1 && g.copies ? (g.plat / g.copies) * sellableCopies(g.copies, g.pace) : 0;
    const spare = g.spareCopies ? (g.sparePlat / g.spareCopies) * sellableCopies(g.spareCopies, g.pace) : 0;
    for (const x of g.members) {
      out.set(x.key, { market: x.market, easy: g.plat ? (easy * x.market) / g.plat : 0, spare: g.sparePlat ? (spare * x.spare) / g.sparePlat : 0 });
    }
  }
  return { ...valueTotals(rows, out), rows: out };
}

/**
 * The totals of some of the rows inventoryValue worked out (the ones a filter shows): their shares
 * added up, so the figures are always the sum of the rows beneath them.
 */
export function valueTotals(rows: InventoryItem[], values: Map<string, RowValue>): ValueTotals {
  let market = 0;
  let easy = 0;
  let spare = 0;
  const byKind = new Map<InventoryKind, number>();
  for (const r of rows) {
    const v = values.get(r.key);
    if (!v) continue;
    market += v.market;
    easy += v.easy;
    spare += v.spare;
    if (v.spare) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + v.spare);
  }
  return { market: Math.round(market), easy: Math.round(easy), spare: Math.round(spare), byKind };
}

/**
 * Keys to boss fights, and what they're made from, by path or name: the fight's name as the drop
 * tables call it. Mutalist Alad V (Mesa's parts) takes a crafted Mutalist Alad V Nav Coordinate,
 * made from Mutalist Nav Coordinates; Jordas Golem (Atlas) a Jordas Precept.
 */
const KEYS: { test: RegExp; mission: string; label: string }[] = [
  { test: /InfestedAlad|Mutalist (Alad V )?Nav Coordinate/i, mission: "Mutalist Alad V", label: "the Mutalist Alad V fight" },
  { test: /Jordas Precept|GolemKey/i, mission: "Jordas Golem", label: "the Jordas Golem fight" },
];

/** Parts you still need (for something you haven't mastered or built) that drop in a mission. */
export const partsStillNeededFrom = perModel(partsStillNeededFromFresh, (mission) => mission);
function partsStillNeededFromFresh(m: Model, mission: string): string[] {
  const out: string[] = [];
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable || m.isMastered(item.uniqueName) || m.owned(item.uniqueName) > 0) continue;
    for (const c of item.components ?? []) {
      if (!(c.drops ?? []).some((d) => d.location?.includes(mission))) continue;
      // Held as the part (…SystemsComponent), as its blueprint (…SystemsBlueprint: what the boss
      // drops), or crafting in the foundry.
      const bp = c.uniqueName.replace(/(Component)?$/, "").replace(/Blueprint$/, "") + "Blueprint";
      const have = m.owned(c.uniqueName) + (bp !== c.uniqueName ? m.owned(bp) : 0) + m.inFoundry(bp);
      if (have < (c.itemCount ?? 1)) out.push(`${item.name} ${c.name}`);
    }
  }
  return out;
}

/** Damaged Necramech parts, by path: each one goes into one Necramech or Entrati arch-gun component. */
const DAMAGED = /\/Resources\/Mechs\/DamagedMech/;
/** Which component a damaged part builds: "PartChassisItem" (a casing), "BarrelItem" and so on. */
const damagedSlot = (unique: string) => unique.replace(/^.*\/DamagedMech(Weapon)?/, "");

/**
 * The components still to build from damaged parts, by slot: for Necramechs and Entrati arch-guns
 * you haven't mastered or built, each component you don't hold. The catalog lists these
 * components but not what they're made from, so the slot names tie the two together.
 */
export const damagedPartNeeds = perModel(damagedPartNeedsFresh, () => "");
function damagedPartNeedsFresh(m: Model): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable || m.isMastered(item.uniqueName) || m.owned(item.uniqueName) > 0) continue;
    for (const c of item.components ?? []) {
      if (!c.uniqueName.includes("/Resources/Mechs/") || m.owned(c.uniqueName) > 0) continue;
      const slot = c.uniqueName.match(/(Part\w+Item|(Barrel|Receiver|Stock)Item)$/)?.[0];
      if (slot) out.set(slot, [...(out.get(slot) ?? []), c.name]);
    }
  }
  return out;
}
