// Sell spares, the choices: what each category sells and keeps, as one settings object
// (settings.market.spares, version 2), with its sanitising and the migration from the six switches
// it replaces (settings.market.bulk, BulkRules in bulk.ts). Pure: the page binds to it, the plan
// (bulk.ts) and the last check before a listing (listGuard.ts) read it.
//
// `legacyRules` turns these choices back into the old switches, saved beside them for an older
// build reading the same settings file. What each choice does is in the in-app Guide; why the
// page is built this way, and what warframe.market trades, is in docs/design/spares-plan.md.
import type { BulkRules } from "./bulk";

/** The categories the panel shows, one row each, in this order. */
export type SpareCategory = "prime" | "mods" | "arcanes" | "relics" | "gear" | "resources" | "imprints";
export const SPARE_CATEGORIES: readonly SpareCategory[] = ["prime", "mods", "arcanes", "relics", "gear", "resources", "imprints"];
export const CATEGORY_LABEL: Record<SpareCategory, string> = {
  prime: "Prime sets and parts",
  mods: "Mods",
  arcanes: "Arcanes",
  relics: "Relics",
  gear: "Weapon parts and sets",
  resources: "Resources and more",
  imprints: "Companion imprints",
};

/**
 * How parts that make whole sets go: as whole sets only, whole sets first and the rest as loose
 * parts, or every spare as a loose part.
 */
export type SellAs = "sets" | "setsFirst" | "parts";
export const SELL_AS: readonly SellAs[] = ["sets", "setsFirst", "parts"];

/** Mods with a keep number of their own; every other mod follows `mods.keep`. */
export type ModFamily = "primed" | "galvanized" | "augment" | "stance" | "requiem" | "antivirus";
export const MOD_FAMILIES: readonly ModFamily[] = ["primed", "galvanized", "augment", "stance", "requiem", "antivirus"];
export const MOD_FAMILY_LABEL: Record<ModFamily, string> = {
  primed: "Primed",
  galvanized: "Galvanized and Archon",
  augment: "Warframe augments",
  stance: "Stances",
  requiem: "Requiem",
  antivirus: "Antivirus",
};
/** Requiem and Antivirus keep their number only while a weapon they're for is left to master. */
export const LICH_FAMILIES: readonly ModFamily[] = ["requiem", "antivirus"];

/**
 * Tradable things that aren't gear, mods, arcanes or relics. Not here because warframe.market
 * doesn't trade them: Archon and Eidolon shards, fish parts, raw ores and gems, most resources.
 */
export type ResourceFamily = "gems" | "fish" | "ayatan" | "stars" | "captura" | "lenses" | "other";
export const RESOURCE_FAMILIES: readonly ResourceFamily[] = ["gems", "fish", "ayatan", "stars", "captura", "lenses", "other"];
export const RESOURCE_FAMILY_LABEL: Record<ResourceFamily, string> = {
  gems: "Refined gems",
  fish: "Whole fish",
  ayatan: "Ayatan sculptures",
  stars: "Ayatan stars",
  captura: "Captura scenes",
  lenses: "Focus lenses",
  other: "Keys and the rest",
};

/** One item the player never wants sold: by warframe.market's item id, every rank and variant. */
export interface NeverSell {
  id: string;
  /** For showing the list without warframe.market's item list loaded. */
  name: string;
  /** Which row's "Never sold" line it shows under; worked out again when the item list is there. */
  cat: SpareCategory | null;
}

export interface SparesRules {
  version: 2;
  prime: {
    on: boolean;
    sellAs: SellAs;
    /** Only sets whose every part drops from a relic you hold: what goes, you can crack again. */
    onlyRelicsHeld: boolean;
    /** Copies of each part held on to beyond what building and mastering take. */
    keep: number;
  };
  mods: {
    on: boolean;
    /** Copies of each mod kept, your best one counted: 2 is your own and one to give away. */
    keep: number;
    /** Only mods that sell at least once a day (common mods at a few platinum hardly ever move). */
    dailyOnly: boolean;
    families: Record<ModFamily, { on: boolean; keep: number }>;
  };
  arcanes: {
    on: boolean;
    /** Maxed copies only, or every spare copy (unranked ones too, beyond what one maxed takes). */
    which: "maxed" | "any";
    /** Legendary arcanes too (the rarest, slowest to replace). */
    legendary: boolean;
    /** Maxed copies kept. */
    keepMaxed: number;
  };
  relics: {
    on: boolean;
    /** Copies of each relic (each refinement) kept to crack. */
    keep: number;
  };
  gear: { on: boolean; sellAs: SellAs };
  resources: {
    on: boolean;
    families: Record<ResourceFamily, boolean>;
    /** How sculptures are listed: as they are (empty), or filled with spare stars you socket first. */
    ayatan: "empty" | "filled";
    /** Copies kept beyond what unmastered gear still takes to build (its parts' recipes too). */
    margin: number;
  };
  imprints: {
    on: boolean;
    /** Imprints of each breed kept for breeding. */
    keep: number;
  };
  /** Over warframe.market's 100 listings: the ones worth most, or the ones that sell most often. */
  priority: "plat" | "trades";
  neverSell: NeverSell[];
}

/** Keep numbers: the least each may be (mods and maxed arcanes never go below one) and the most. */
export const KEEP_MIN = { prime: 0, mods: 1, family: 1, arcanes: 1, relics: 0, imprints: 0, margin: 0 } as const;
export const KEEP_MAX = 99;
/** Requiem and Antivirus mods kept while lich weapons are left (views.ts, LICH_MOD_KEEP). */
export const LICH_KEEP = 5;
/** Mods kept: your best copy and one to give away (views.ts, MOD_KEEP). */
export const MODS_KEEP = 2;
/** More never-sell entries than anyone means to keep are dropped (a damaged settings file). */
export const NEVER_SELL_CAP = 5000;

const modFamilies = (keep = MODS_KEEP): SparesRules["mods"]["families"] =>
  Object.fromEntries(MOD_FAMILIES.map((f) => [f, { on: true, keep: LICH_FAMILIES.includes(f) ? LICH_KEEP : keep }])) as SparesRules["mods"]["families"];
const resourceFamilies = (on = true): Record<ResourceFamily, boolean> => Object.fromEntries(RESOURCE_FAMILIES.map((f) => [f, on])) as Record<ResourceFamily, boolean>;

/** The usual rules: what MyOrbiter did before the categories had options, for a new player. */
export const defaultSparesRules = (): SparesRules => ({
  version: 2,
  prime: { on: true, sellAs: "setsFirst", onlyRelicsHeld: false, keep: 0 },
  mods: { on: true, keep: MODS_KEEP, dailyOnly: true, families: modFamilies() },
  arcanes: { on: true, which: "maxed", legendary: true, keepMaxed: 1 },
  relics: { on: false, keep: 0 },
  gear: { on: true, sellAs: "sets" },
  resources: { on: false, families: resourceFamilies(), ayatan: "empty", margin: 0 },
  imprints: { on: true, keep: 0 },
  priority: "plat",
  neverSell: [],
});

// ---------------------------------------------------------------- reading settings

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
const count = (x: unknown, d: number, min: number, max = KEEP_MAX) => (typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : d);
const pick = <T extends string>(x: unknown, allowed: readonly T[], d: T): T => (typeof x === "string" && (allowed as readonly string[]).includes(x) ? (x as T) : d);
/** Printable text only, trimmed and capped: a name read from a settings file. */
const text = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, max) : "");

function neverSellOf(raw: unknown): NeverSell[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NeverSell[] = [];
  for (const x of raw) {
    if (!isObj(x)) continue;
    const id = text(x.id, 64);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const cat = typeof x.cat === "string" && (SPARE_CATEGORIES as readonly string[]).includes(x.cat) ? (x.cat as SpareCategory) : null;
    out.push({ id, name: text(x.name, 120) || id, cat });
    if (out.length >= NEVER_SELL_CAP) break;
  }
  return out;
}

function fromV2(raw: Obj): SparesRules {
  const d = defaultSparesRules();
  const o = (k: string) => (isObj(raw[k]) ? (raw[k] as Obj) : {});
  const prime = o("prime"), mods = o("mods"), arcanes = o("arcanes"), relics = o("relics"), gear = o("gear"), res = o("resources"), imp = o("imprints");
  const fams = isObj(mods.families) ? mods.families : {};
  const resFams = isObj(res.families) ? res.families : {};
  const modKeep = count(mods.keep, d.mods.keep, KEEP_MIN.mods);
  return {
    version: 2,
    prime: { on: bool(prime.on, d.prime.on), sellAs: pick(prime.sellAs, SELL_AS, d.prime.sellAs), onlyRelicsHeld: bool(prime.onlyRelicsHeld, false), keep: count(prime.keep, d.prime.keep, KEEP_MIN.prime) },
    mods: {
      on: bool(mods.on, d.mods.on),
      keep: modKeep,
      dailyOnly: bool(mods.dailyOnly, d.mods.dailyOnly),
      families: Object.fromEntries(
        MOD_FAMILIES.map((f) => {
          const x = isObj(fams[f]) ? (fams[f] as Obj) : {};
          const def = d.mods.families[f];
          return [f, { on: bool(x.on, def.on), keep: count(x.keep, def.keep, KEEP_MIN.family) }];
        }),
      ) as SparesRules["mods"]["families"],
    },
    arcanes: { on: bool(arcanes.on, d.arcanes.on), which: pick(arcanes.which, ["maxed", "any"] as const, d.arcanes.which), legendary: bool(arcanes.legendary, d.arcanes.legendary), keepMaxed: count(arcanes.keepMaxed, d.arcanes.keepMaxed, KEEP_MIN.arcanes) },
    relics: { on: bool(relics.on, d.relics.on), keep: count(relics.keep, d.relics.keep, KEEP_MIN.relics) },
    gear: { on: bool(gear.on, d.gear.on), sellAs: pick(gear.sellAs, SELL_AS, d.gear.sellAs) },
    resources: {
      on: bool(res.on, d.resources.on),
      families: Object.fromEntries(RESOURCE_FAMILIES.map((f) => [f, bool(resFams[f], true)])) as Record<ResourceFamily, boolean>,
      ayatan: pick(res.ayatan, ["empty", "filled"] as const, d.resources.ayatan),
      margin: count(res.margin, d.resources.margin, KEEP_MIN.margin),
    },
    imprints: { on: bool(imp.on, d.imprints.on), keep: count(imp.keep, d.imprints.keep, KEEP_MIN.imprints) },
    priority: pick(raw.priority, ["plat", "trades"] as const, d.priority),
    neverSell: neverSellOf(raw.neverSell),
  };
}

/** How two switches (sets, and its loose parts) say parts should go; null when both are off. */
const sellAsOf = (sets: boolean, loose: boolean): SellAs | null => (sets && loose ? "setsFirst" : sets ? "sets" : loose ? "parts" : null);

/**
 * The six switches before version 2, as the same choices: what was listed before is listed after.
 * - "Sets I don't need" covered prime sets and the other sets warframe.market trades whole;
 *   "Spare prime parts" the loose prime parts; "Everything else" weapon parts, relics, gems, fish,
 *   Captura, Ayatan, lenses and veiled rivens (those last under Settings, Selling, as they still are).
 * - Mods kept two (Requiem and Antivirus five while lich weapons are left), only daily sellers;
 *   arcanes one maxed copy, maxed copies only; imprints none.
 */
function fromV1(raw: Obj): SparesRules {
  const d = defaultSparesRules();
  const sets = bool(raw.sets, true);
  const parts = bool(raw.parts, true);
  const other = bool(raw.other, false);
  const prime = sellAsOf(sets, parts);
  const gear = sellAsOf(sets, other);
  return {
    ...d,
    prime: { ...d.prime, on: prime != null, sellAs: prime ?? d.prime.sellAs, keep: count(raw.partsKeep, 0, KEEP_MIN.prime) },
    mods: { ...d.mods, on: bool(raw.mods, true) },
    arcanes: { ...d.arcanes, on: bool(raw.arcanes, true) },
    relics: { ...d.relics, on: other },
    gear: { on: gear != null, sellAs: gear ?? d.gear.sellAs },
    resources: { ...d.resources, on: other },
    imprints: { ...d.imprints, on: bool(raw.imprints, true) },
    priority: pick(raw.priority, ["plat", "trades"] as const, "plat"),
  };
}

/** The choices from one saved object: version 2, the old switches (migrated), or nothing (the usual rules). */
export function sparesRulesOf(raw: unknown): SparesRules {
  if (!isObj(raw)) return defaultSparesRules();
  return raw.version === 2 ? fromV2(raw) : fromV1(raw);
}

/** The plan reads either: version 2 as it is, the old switches migrated (tests, an old caller). */
export type PlanRules = BulkRules | SparesRules;
export const rulesV2 = (r: PlanRules): SparesRules => ("version" in r && r.version === 2 ? r : sparesRulesOf(r));

/** The same choices with every category ticked: what each row would list, for its numbers while it's off. */
export function allOn(r: SparesRules): SparesRules {
  return { ...r, prime: { ...r.prime, on: true }, mods: { ...r.mods, on: true }, arcanes: { ...r.arcanes, on: true }, relics: { ...r.relics, on: true }, gear: { ...r.gear, on: true }, resources: { ...r.resources, on: true }, imprints: { ...r.imprints, on: true } };
}

// ---------------------------------------------------------------- for the plan as it is now

/**
 * The old switches for these choices, for bulk.ts until it reads version 2. What they can't say
 * is lost: keep numbers other than the usual, mod families and resource families left out, which
 * arcanes, relics or resources apart from each other, Ayatan filled, only sets your relics drop.
 * Gear "parts only" can't be told apart from "sets first" there (both lists the loose parts).
 */
export function legacyRules(r: SparesRules): BulkRules {
  return {
    sets: (r.prime.on && r.prime.sellAs !== "parts") || (r.gear.on && r.gear.sellAs !== "parts"),
    parts: r.prime.on && r.prime.sellAs !== "sets",
    partsKeep: r.prime.keep,
    arcanes: r.arcanes.on,
    mods: r.mods.on,
    imprints: r.imprints.on,
    other: r.resources.on || r.relics.on || (r.gear.on && r.gear.sellAs !== "sets"),
    priority: r.priority,
  };
}

/**
 * Where the choices live: version 2 under settings.market.spares, and the old switches kept up to
 * date under settings.market.bulk. Not version 2 under `bulk` itself: it shares names with the old
 * switches (mods, arcanes, imprints), and an older MyOrbiter (a Stable build behind an Experimental
 * one) would read `mods: { on: false }` as ticked. This way an older build reads the player's
 * choices as closely as the old switches can say them.
 */
export function sparesSettingsOf(market: { spares?: unknown; bulk?: unknown; sellable?: unknown } | null | undefined): SparesRules {
  const v2 = market?.spares;
  if (isObj(v2) && v2.version === 2) return fromV2(v2);
  const r = sparesRulesOf(market?.bulk);
  // Settings, Selling's "Sell relics worth more sold than cracked" is the Relics row now: off, it
  // kept every relic, so the row starts off.
  const sell = market?.sellable;
  if (isObj(sell) && sell.relicsWorthSelling === false) r.relics.on = false;
  return r;
}
/** What to save: both keys (see sparesSettingsOf). */
export const toStored = (r: SparesRules): { spares: SparesRules; bulk: BulkRules } => ({ spares: r, bulk: legacyRules(r) });

// ---------------------------------------------------------------- in words

/** What the lich families wait on: weapons still to master. */
export interface LichLeft {
  requiem: number;
  antivirus: number;
}

const SELL_AS_WORDS: Record<SellAs, string> = { sets: "Whole sets only", setsFirst: "Sets first, then loose parts", parts: "Loose parts only" };
const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * One line for a category's row, its choices in plain words, the ones that differ from what
 * anyone would expect said first: "Keep 2 · Requiem kept 5 while Kuva weapons are left · Primed left out".
 */
export function summaryOf(cat: SpareCategory, r: SparesRules, left: LichLeft = { requiem: 1, antivirus: 1 }): string {
  switch (cat) {
    case "prime": {
      const xs = [SELL_AS_WORDS[r.prime.sellAs]];
      if (r.prime.onlyRelicsHeld && r.prime.sellAs !== "parts") xs.push("only sets your relics drop");
      xs.push(r.prime.keep ? `keep ${r.prime.keep} of each part` : "keep what you build");
      return xs.join(" · ");
    }
    case "mods": {
      const xs = [`Keep ${r.mods.keep}`];
      const f = r.mods.families;
      const lich: string[] = [];
      if (f.requiem.on && left.requiem) lich.push(`Requiem ${f.requiem.keep}`);
      if (f.antivirus.on && left.antivirus) lich.push(`Antivirus ${f.antivirus.keep}`);
      if (lich.length) xs.push(`${join(lich)} while lich weapons are left`);
      const other = MOD_FAMILIES.filter((k) => f[k].on && !LICH_FAMILIES.includes(k) && f[k].keep !== r.mods.keep);
      if (other.length) xs.push(other.map((k) => `${MOD_FAMILY_LABEL[k]} ${f[k].keep}`).join(", "));
      const off = MOD_FAMILIES.filter((k) => !f[k].on);
      if (off.length) xs.push(`${join(off.map((k) => MOD_FAMILY_LABEL[k]))} left out`);
      if (!r.mods.dailyOnly) xs.push("slow sellers too");
      return xs.join(" · ");
    }
    case "arcanes":
      return [r.arcanes.which === "maxed" ? "Maxed extras" : "Every spare copy", `keep ${r.arcanes.keepMaxed} maxed`, r.arcanes.legendary ? "Legendary too" : "Legendary left out"].join(" · ");
    case "relics":
      return ["Only when it sells for more than a crack", r.relics.keep ? `keep ${r.relics.keep} of each` : "none kept"].join(" · ");
    case "gear":
      return SELL_AS_WORDS[r.gear.sellAs];
    case "resources": {
      const on = RESOURCE_FAMILIES.filter((k) => r.resources.families[k]);
      const names = on.length === RESOURCE_FAMILIES.length ? ["Every kind"] : on.length ? [join(on.map((k, i) => (i ? lower(RESOURCE_FAMILY_LABEL[k]) : RESOURCE_FAMILY_LABEL[k])))] : ["Nothing picked"];
      // Filled sculptures aren't offered yet (which ones hold stars isn't read): empty ones only.
      if (r.resources.families.ayatan) names.push("sculptures empty");
      names.push(r.resources.margin ? `keep what builds need + ${r.resources.margin}` : "keep what builds need");
      return names.join(" · ");
    }
    case "imprints":
      return r.imprints.keep ? `Keep ${r.imprints.keep} of each breed` : "Every imprint you hold";
  }
}

// ---------------------------------------------------------------- the usual rules, and never sell

/** Whether every choice is the usual one (never-sell items aside: those are the player's own). */
export function isUsual(r: SparesRules): boolean {
  const strip = (x: SparesRules) => JSON.stringify({ ...x, neverSell: [] });
  return strip(r) === strip(defaultSparesRules());
}
/** Back to the usual choices, keeping the never-sell list. */
export const usualKeeping = (r: SparesRules): SparesRules => ({ ...defaultSparesRules(), neverSell: r.neverSell });

export const neverSells = (r: SparesRules, id: string) => r.neverSell.some((n) => n.id === id);
export function withNeverSell(r: SparesRules, entry: NeverSell): SparesRules {
  return neverSells(r, entry.id) ? r : { ...r, neverSell: [...r.neverSell, entry].slice(-NEVER_SELL_CAP) };
}
export function withoutNeverSell(r: SparesRules, ids: Iterable<string>): SparesRules {
  const drop = new Set(ids);
  return { ...r, neverSell: r.neverSell.filter((n) => !drop.has(n.id)) };
}
/** The never-sell items a category's row lists ("Never sold: 4 mods"). */
export const neverSoldIn = (r: SparesRules, cat: SpareCategory) => r.neverSell.filter((n) => n.cat === cat);
