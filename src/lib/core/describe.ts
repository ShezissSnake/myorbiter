// What a hover card shows for anything with a name: a relic's rewards, where a part drops and what
// it's worth, a warframe's or weapon's key stats and parts, what a mod or arcane does, a set's
// parts. Lookups are built once per model.
import { collectionItem, type CollectionItem } from "./collection";
import { splitRelicName, type Model } from "./model";
import type { CatalogItem } from "./types";
import { arcaneRows, modRows, partAvailability, relicRows, type ArcaneRow, type ModRow, type RelicRow } from "./views";

export type HoverInfo =
  | { kind: "relic"; row: RelicRow | null; base: string; image: string | null; vaulted: boolean }
  | { kind: "part"; name: string; parent: string; parentUnique: string; image: string | null; held: number; price: number | null; ducats: number; tradesPerDay: number | null; availability: string; relics: { base: string; rarity: string; chanceIntact: number; chanceRadiant: number; vaulted: boolean; owned: number }[]; parentMastered: boolean }
  | { kind: "set"; name: string; parentUnique: string; image: string | null; price: number | null; parts: CollectionItem["parts"] }
  | { kind: "gear"; item: CatalogItem; c: CollectionItem }
  | { kind: "mod"; item: CatalogItem | null; row: ModRow | null; name: string; image: string | null; price: number | null; priceMax: number | null }
  | { kind: "arcane"; item: CatalogItem | null; row: ArcaneRow | null; name: string; image: string | null }
  | { kind: "other"; name: string; image: string | null; held: number; price: number | null; tradesPerDay: number | null };

interface Index {
  /** The ducat rate the relic values were worked out at. */
  rate: number;
  relics: Map<string, RelicRow>;
  byName: Map<string, CatalogItem[]>;
  mods: Map<string, ModRow>;
  arcanes: Map<string, ArcaneRow>;
}
const cache = new WeakMap<Model, Index>();
function index(m: Model, rate: number): Index {
  let ix = cache.get(m);
  if (ix && ix.rate === rate) return ix;
  const byName = new Map<string, CatalogItem[]>();
  for (const c of m.catalogByUnique.values()) {
    const list = byName.get(c.name);
    if (list) list.push(c);
    else byName.set(c.name, [c]);
  }
  ix = {
    rate,
    relics: new Map(relicRows(m, { includeUnowned: true, platPerDucat: rate }).map((r) => [r.base, r])),
    byName,
    mods: new Map(modRows(m).map((r) => [r.name, r])),
    arcanes: new Map(arcaneRows(m).map((r) => [r.name, r])),
  };
  cache.set(m, ix);
  return ix;
}

/** "Axi A22", "Axi A22 Relic", "Axi A22 Radiant", "Axi A22 Relic (Radiant)" → "Axi A22". */
export function relicBase(name: string): string | null {
  const plain = name.replace(/ Relic( \((Intact|Exceptional|Flawless|Radiant)\))?$/, "");
  const split = splitRelicName(plain);
  const base = split?.base ?? plain;
  return /^(Lith|Meso|Neo|Axi|Requiem|Vanguard) ([A-Z]+\d+|[IVX]+)$/.test(base) ? base : null;
}

/** The catalog entry a name most likely means: the one you hold, else the full (not Flawed) version. */
function pick(m: Model, items: CatalogItem[] | undefined, unique?: string | null): CatalogItem | null {
  if (!items?.length) return null;
  if (unique) {
    const u = items.find((i) => i.uniqueName === unique);
    if (u) return u;
  }
  return items.find((i) => m.owned(i.uniqueName) > 0) ?? items.find((i) => !/\/(Beginner|Intermediate|Expert)\//.test(i.uniqueName)) ?? items[0];
}

const held = (m: Model, name: string) => (m.inventoryByName.get(name) ?? []).reduce((n, r) => n + r.quantity, 0);

/** `platPerDucat`: your ducat rate, so a relic's crack counts a reward's ducats when they're worth more than its price. */
export function describe(m: Model, name: string, unique?: string | null, platPerDucat = 0): HoverInfo | null {
  if (!name) return null;
  const ix = index(m, platPerDucat);
  const base = relicBase(name);
  if (base) {
    const row = ix.relics.get(base) ?? null;
    const group = m.relicGroups.get(base);
    return { kind: "relic", row, base, image: m.imageOf(base), vaulted: group?.vaulted ?? row?.vaulted ?? false };
  }
  const part = m.partByName.get(name)?.[0];
  if (part) {
    return {
      kind: "part",
      name,
      parent: part.parentName,
      parentUnique: part.parentUnique,
      image: m.imageOf(name),
      held: m.ownedPartQty.get(name) ?? 0,
      price: m.price(name),
      ducats: part.ducats,
      tradesPerDay: m.tradesPerDay(name),
      availability: partAvailability(m, name),
      relics: (m.sourcesByReward.get(name) ?? [])
        .map((s) => ({ ...s, owned: m.ownedRelicCount.get(s.base) ?? 0 }))
        .sort((a, b) => b.owned - a.owned || Number(a.vaulted) - Number(b.vaulted) || b.chanceRadiant - a.chanceRadiant),
      parentMastered: m.isMastered(part.parentUnique),
    };
  }
  if (/ Set$/.test(name)) {
    const item = pick(m, ix.byName.get(name.replace(/ Set$/, "")));
    if (item) {
      const c = collectionItem(m, item);
      // Prime sets: the tradable parts. Gear sets the catalog doesn't mark tradable (Broken War's
      // blade and hilt): every part that isn't a resource.
      const tradable = c.parts.filter((p) => p.tradable);
      return { kind: "set", name, parentUnique: item.uniqueName, image: c.image, price: m.price(name), parts: tradable.length ? tradable : c.parts.filter((p) => !p.resource) };
    }
  }
  const item = pick(m, ix.byName.get(name), unique);
  if (item?.category === "Arcanes" || ix.arcanes.has(name)) return { kind: "arcane", item, row: ix.arcanes.get(name) ?? null, name, image: item?.imageName ?? m.imageOf(name) };
  if (item?.category === "Mods" || ix.mods.has(name)) return { kind: "mod", item, row: ix.mods.get(name) ?? null, name, image: item?.imageName ?? m.imageOf(name), price: m.price(name), priceMax: m.priceMax(name) };
  if (item?.masterable && item.category !== "Mods") return { kind: "gear", item, c: collectionItem(m, item) };
  if (!item && !m.inventoryByName.has(name) && m.price(name) == null) return null;
  return { kind: "other", name, image: item?.imageName ?? m.imageOf(name), held: held(m, name), price: m.price(name), tradesPerDay: m.tradesPerDay(name) };
}

/** A mod's or arcane's max-rank text, without the lines that only repeat an earlier one. */
/**
 * A drop location the way players say it: "Eris/Zabala (Survival), Rotation B" → "Zabala, Eris ·
 * Survival B". Anything else ("Mutalist Alad V Assassinate") comes back as it is.
 */
export function placeName(loc: string): string {
  const m = loc.match(/^([^/]+)\/(.+?) \(([^)]+)\)(?:, Rotation ([ABC]))?$/);
  if (m) return `${m[2]}, ${m[1]} · ${m[3]}${m[4] ? ` ${m[4]}` : ""}`;
  return loc.replace(/^([^/]+)\/(.+)$/, "$2, $1").replace(/, Rotation ([ABC])$/, " · rotation $1");
}

/** Game text without its markup: colour tags like <DT_FIRE_COLOR> and stray doubled spaces. */
export const cleanText = (t: string) => t.replace(/<\/?[A-Z0-9_]+>/g, "").replace(/[ \t]{2,}/g, " ").trim();

export function effectLines(item: CatalogItem | null): string[] {
  const lines = (item?.maxStats ?? []).map(cleanText).filter(Boolean);
  return lines.filter((l, i) => !lines.slice(0, i).some((p) => p.includes(l)));
}
