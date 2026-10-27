// Everything tradable you hold more of than you need: not just prime parts, mods and arcanes but
// weapon parts and blueprints, relics, gems, fish, Captura scenes, Ayatan sculptures and veiled
// rivens. What you need is worked out from what you haven't built yet: every unmastered thing
// you don't own keeps the parts, blueprints and resources its recipe takes.
import { baseId, gearSetParts, heldCount, UNOBTAINABLE, type Model, type Refinement } from "./model";
import { findItem, type MarketIndex } from "./market";
import { arcaneRows, inventoryRows, MASTERY_CATEGORIES, modRows, modSpares, partRows, relicRows, setRows, type InventoryItem, type InventoryKind, type RelicRow, type SetRow } from "./views";
import { expectedBest } from "./advice";

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
  /** Each, at this rank or refinement. */
  price: number | null;
  /** The spare copies at that price. */
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
}

/**
 * For each item path, the unbuilt things whose recipes take it: everything masterable you haven't
 * mastered and don't own (built, or building in the foundry). The parts of a recipe only, not the
 * parts' own recipes (WFCD's catalog lists a warframe's Neuroptics, not what the Neuroptics take).
 */
export function needsByUnique(m: Model): Map<string, Need[]> {
  const out = new Map<string, Need[]>();
  for (const item of m.catalogByUnique.values()) {
    if (!item.masterable || !(item.category in MASTERY_CATEGORIES)) continue;
    if (UNOBTAINABLE.has(item.name) || m.isMastered(item.uniqueName) || m.owned(item.uniqueName) > 0) continue;
    for (const c of item.components ?? []) {
      const u = baseId(c.uniqueName);
      const list = out.get(u) ?? [];
      list.push({ item: item.name, count: c.itemCount ?? 1 });
      out.set(u, list);
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
export function gearSetRows(m: Model, index: MarketIndex | null, needs: Map<string, Need[]> = needsByUnique(m)): SetRow[] {
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

/** Every set you hold parts of: prime ones, and (with warframe.market's item list) the others it trades. */
export function allSetRows(m: Model, index: MarketIndex | null): SetRow[] {
  return [...setRows(m), ...gearSetRows(m, index)];
}

/** Display names for recipe parts the game knows by internal names ("Tn Concrete Archgun Barrel" is the Mandonel Barrel). */
function partNames(m: Model): Map<string, string> {
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
   * that's more) count as spare; relics that drop a part you still need are kept either way.
   * Off keeps every relic. (Named anew when it became conditional and on by default, so an older
   * "keep every relic" doesn't carry over.)
   */
  relicsWorthSelling: boolean;
}
export const defaultSellChoices = (): SellChoices => ({ veiledRivens: false, relicsWorthSelling: true });

/**
 * Modular gear: hounds, MOAs, kitguns, zaws and amps are built from parts, and each family's
 * masterable pieces (a hound's model, a kitgun's chamber, a zaw's strike) are mastered one by one.
 * Its parts aren't in any recipe, so they're kept while anything in the family is unmastered.
 */
const FAMILIES: { name: string; plural: string; part: RegExp; gear: RegExp }[] = [
  { name: "Hound", plural: "hounds", part: /ZanukaPet/, gear: /ZanukaPets\/ZanukaPetParts\/ZanukaPetPartHead/ },
  { name: "MOA", plural: "MOAs", part: /MoaPet/, gear: /MoaPets\/MoaPetParts\/MoaPetHead/ },
  { name: "Kitgun", plural: "kitguns", part: /SUModular|InfKitGun|KitGun/i, gear: /(SUModular(Primary|Secondary)Set\d+|InfKitGun)\/Barrel\// },
  { name: "Zaw", plural: "zaws", part: /ModularMelee|OstronMelee/, gear: /ModularMelee\d+\/Tip\// },
  { name: "Amp", plural: "amps", part: /OperatorAmplifiers|OperatorAmp|SentAmp/, gear: /OperatorAmplifiers\/.*Barrel/ },
];

/** For each family, how many of its masterable pieces you haven't mastered. */
function unmasteredByFamily(m: Model): Map<string, number> {
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

export function spareRows(m: Model, index: MarketIndex | null = null, sell: SellChoices = defaultSellChoices(), platPerDucat = 0, squad = 1): SpareRow[] {
  const families = unmasteredByFamily(m);
  const needs = needsByUnique(m);
  const display = partNames(m);
  const parts = new Map(partRows(m).map((p) => [p.name, p]));
  const mods = new Map(modRows(m).map((r) => [r.name, new Map(modSpares(r.ranks).map((x) => [x.rank, x.count]))]));
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
    if (r.kind === "part") {
      const p = parts.get(r.name);
      keep = p ? p.keep : 0;
      why = keep ? `${plural(keep, "copy", "copies")} to build ${p!.parentName}` : p?.parentMastered ? `${p.parentName} is mastered` : p?.parentOwned ? `${p.parentName} is built` : "";
    } else if (r.kind === "mod" && VEILED.test(r.unique)) {
      keep = sell.veiledRivens ? 0 : r.quantity;
      why = sell.veiledRivens ? "Veiled rivens all count as spare: unveil any you'd rather roll yourself first" : "You keep veiled rivens (Settings, Selling)";
    } else if (r.kind === "mod") {
      const spare = mods.get(r.name)?.get(r.rank ?? 0) ?? 0;
      keep = r.quantity - spare;
      why = keep ? "Your best copy and one to give away" : "";
    } else if (r.kind === "arcane") {
      const a = arcanes.get(r.name);
      const spare = !a ? 0 : r.rank != null && r.rank >= a.maxRank ? a.extraMaxed : r.rank === 0 ? Math.min(r.quantity, a.unranked, a.spare) : 0;
      keep = r.quantity - spare;
      why = keep ? (a?.complete ? "Your maxed copy" : `Toward a maxed one (${a?.copies ?? 0}/${a?.needed ?? 21})`) : "";
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
        why = "You keep relics (Settings, Selling)";
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
    } else if (SCENE.test(r.name) || SCENE.test(r.unique)) {
      keep = Math.min(1, r.quantity);
      why = "One to use in Captura";
    } else {
      need = [...(needs.get(baseId(r.unique)) ?? [])].sort((a, b) => b.count - a.count);
      const total = need.reduce((n, x) => n + x.count, 0);
      keep = Math.min(r.quantity, total);
      why = total ? `For ${listNeeds(need)}` : "Nothing you still need to build takes it";
    }
    keep = Math.max(0, Math.min(r.quantity, keep));
    const spare = r.quantity - keep;
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
      subtype: r.subtype,
      quantity: r.quantity,
      keep,
      spare,
      price,
      worth: price == null ? null : price * spare,
      tradesPerDay: r.kind === "relic" ? null : m.tradesPerDay(name),
      why,
      needs: need,
      crack,
      inSets: setsOf,
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
    had.worth = had.price == null ? null : had.price * had.spare;
  }
  return [...by.values()];
}

/** Relics (by base, "Axi A1") that drop a part you still need for something unbuilt, with those parts. */
export function relicsYouNeed(m: Model): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [parent, parts] of m.partsByParent) {
    if (m.isMastered(parent) || m.owned(parent) > 0) continue;
    for (const p of parts) {
      if (m.partHave(p.fullName) >= p.required) continue;
      for (const s of m.sourcesByReward.get(p.fullName) ?? []) {
        const list = out.get(s.base) ?? [];
        if (!list.includes(p.fullName)) list.push(p.fullName);
        out.set(s.base, list);
      }
    }
  }
  return out;
}
