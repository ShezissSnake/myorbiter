// Rivens, from the game's own fingerprints (passed through by the patched TennoScope): each stat's
// value as the game shows it, how good its roll is, and the riven's name.
//
// A stat's value is its base (per riven type and stat, from the catalog) × 10 × 1.5 × the
// weapon's disposition × the riven's buff/curse count factor × a roll between 0.9 and 1.1 ×
// (rank + 1). Since the 22 Oct 2026 hotfix every weapon's disposition is 1.2.
import type { Model } from "./model";
import type { CatalogItem } from "./types";

/** One stat on a riven as the game stores it: a tag and a roll from 0 to 0x3FFFFFFF. */
export interface RivenStatRaw {
  Tag: string;
  Value: number;
}

export interface RivenFingerprint {
  compat?: string;
  lim?: number;
  lvlReq?: number;
  lvl?: number;
  rerolls?: number;
  pol?: string;
  buffs?: RivenStatRaw[];
  curses?: RivenStatRaw[];
  [k: string]: unknown;
}

export interface RivenRaw {
  type: string;
  id: string;
  fp: RivenFingerprint;
}

export interface RivenStatDef {
  tag: string;
  value: number;
  locTag?: string | null;
  prefix?: string | null;
  suffix?: string | null;
}

/** Every weapon's riven disposition since the 22 Oct 2026 hotfix. */
export const DISPOSITION = 1.2;
const MAX = 0x3fffffff;
const BUFF_ATTEN = [0, 1, 0.66000003, 0.5, 0.40000001, 0.34999999];
const CURSE_BY_BUFFS = [0, 1, 0.33000001, 0.5, 1.25, 1.5];
const FACTION = /FactionDamage/;
const PLAIN = new Set(["WeaponMeleeComboInitialBonusMod", "ComboDurationMod", "WeaponMeleeRangeIncMod", "WeaponPunctureDepthMod", "WeaponMeleeParryAngleMod"]);

/**
 * The stats only Riven Splicing makes (Update 44.1, October 2026): two of a riven's stats fused
 * into one of these. They can't roll by cycling, so a riven with one has been spliced.
 */
export const SPLICED_TAGS = new Set([
  "WeaponGasDamageMod", "WeaponCorrosiveDamageMod", "WeaponViralDamageMod", "WeaponRadiationDamageMod", "WeaponBlastDamageMod", "WeaponMagneticDamageMod",
  "WeaponFactionDamageOrokin", "WeaponFactionDamageTechrot", "WeaponFactionDamageScaldra",
  "WeaponWeakpointDamage", "WeaponWeakpointCriticalChance", "WeaponAmmoEfficiency", "WeaponMagazineReloadHolstered", "WeaponStatusDamage",
  "WeaponMeleeHeavyAttackDamageMod", "WeaponMeleeHeavyAttackChargeMod", "WeaponMeleeParryAngleMod", "WeaponMeleeSlamDamageMod",
]);

export const RIVEN_KIND: Record<string, string> = {
  LotusRifleRandomModRare: "Rifle",
  LotusShotgunRandomModRare: "Shotgun",
  LotusPistolRandomModRare: "Pistol",
  PlayerMeleeWeaponRandomModRare: "Melee",
  LotusArchgunRandomModRare: "Archgun",
  LotusModularPistolRandomModRare: "Kitgun",
  LotusModularMeleeRandomModRare: "Zaw",
};

export interface RivenStat {
  tag: string;
  label: string;
  /** The number the game shows: a percentage, a multiplier (×1.45) or a plain amount. */
  display: string;
  value: number;
  buff: boolean;
  /** How the roll sits in its range, 0 (worst) to 1 (best); a smaller curse is better. */
  quality: number | null;
  grade: string;
  /** A stat only Riven Splicing makes. */
  spliced: boolean;
}

export interface Riven {
  id: string;
  type: string;
  kind: string;
  weapon: string;
  weaponUnique: string | null;
  image: string | null;
  name: string;
  rank: number;
  rerolls: number;
  mastery: number;
  polarity: string | null;
  stats: RivenStat[];
  /** Average roll quality of the buffs, 0..1. */
  quality: number | null;
  grade: string;
  /** Has a stat from Riven Splicing. */
  spliced: boolean;
}

/** Riven stat tables by riven type ("LotusRifleRandomModRare"), from the catalog. */
export function rivenTables(catalog: Iterable<CatalogItem>): Map<string, RivenStatDef[]> {
  const out = new Map<string, RivenStatDef[]>();
  for (const c of catalog) {
    const defs = (c as CatalogItem & { rivenStats?: RivenStatDef[] }).rivenStats;
    if (defs?.length) out.set(c.uniqueName.split("/").pop()!, defs);
  }
  return out;
}

/** A letter for a roll quality (0..1), like the game's community graders: S at the very top. */
export function gradeOf(quality: number): string {
  const v = -10 + 20 * quality;
  if (v < -11.5 || v > 11.5) return "?";
  if (v >= 9.5) return "S";
  if (v >= 7.5) return "A+";
  if (v >= 5.5) return "A";
  if (v >= 3.5) return "A−";
  if (v >= 1.5) return "B+";
  if (v >= -1.5) return "B";
  if (v >= -3.5) return "B−";
  if (v >= -5.5) return "C+";
  if (v >= -7.5) return "C";
  if (v >= -9.5) return "C−";
  return "F";
}

/** The multiplier for a stat's value before its base and roll. */
function factor(buff: boolean, nBuffs: number, nCurses: number, rank: number, disposition = DISPOSITION): number {
  const base = 10 * 1.5 * disposition * (rank + 1);
  return buff ? base * 1.25 ** nCurses * BUFF_ATTEN[Math.min(nBuffs, 5)] : -base * CURSE_BY_BUFFS[Math.min(nBuffs, 5)] * BUFF_ATTEN[Math.min(nCurses, 5)];
}

export function statValue(def: RivenStatDef, roll: number, buff: boolean, nBuffs: number, nCurses: number, rank: number, disposition = DISPOSITION): number {
  return def.value * factor(buff, nBuffs, nCurses, rank, disposition) * (0.9 + 0.2 * roll);
}

/** Where a value sits in its range (0..1): for grading a listing someone typed in. */
export function rollOf(def: RivenStatDef, value: number, buff: boolean, nBuffs: number, nCurses: number, rank: number, disposition = DISPOSITION): number {
  return (value / (def.value * factor(buff, nBuffs, nCurses, rank, disposition)) - 0.9) / 0.2;
}

/** As the game shows it, from the raw value (a fraction for percentages). */
export function displayValue(tag: string, value: number): string {
  if (FACTION.test(tag)) return `×${(1 + value).toFixed(2)}`;
  const sign = value > 0 ? "+" : "";
  if (PLAIN.has(tag)) return `${sign}${Math.round(value * 10) / 10}${tag === "ComboDurationMod" ? "s" : ""}`;
  return `${sign}${Math.round(value * 1000) / 10}%`;
}

export function statLabel(def: RivenStatDef | undefined, tag: string): string {
  // A stat the catalog doesn't know: its tag in words ("WeaponMultishotMod" → "Multishot").
  if (!def?.locTag) return tag.replace(/^Weapon/, "").replace(/Mod$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  const raw = def.locTag;
  return raw
    .replace(/<[A-Z_]+>/g, "")
    .replace(/\|(val|STAT1)\|%?s?\s*/g, "")
    .replace(/\s*\(x2 for Heavy Attacks\)/, "")
    .trim();
}

const POLARITY: Record<string, string> = { AP_ATTACK: "madurai", AP_DEFENSE: "vazarin", AP_TACTIC: "naramon", AP_POWER: "zenurik", AP_WARD: "unairu", AP_UMBRA: "umbra", AP_PRECEPT: "penjaga" };

/** One riven from the game's fingerprint, or null when it isn't an unveiled one. */
export function parseRiven(m: Model, tables: Map<string, RivenStatDef[]>, raw: RivenRaw): Riven | null {
  const type = raw.type.split("/").pop() ?? "";
  const fp = raw.fp ?? {};
  const buffs = fp.buffs ?? [];
  const curses = fp.curses ?? [];
  if (!buffs.length) return null;
  const table = tables.get(type) ?? [];
  const rank = fp.lvl ?? 0;
  const stats: RivenStat[] = [];
  for (const [list, buff] of [[buffs, true], [curses, false]] as const) {
    for (const s of list) {
      const def = table.find((d) => d.tag === s.Tag);
      const roll = s.Value / MAX;
      const ok = roll >= 0 && roll <= 1;
      const value = def ? statValue(def, ok ? roll : 0.5, buff, buffs.length, curses.length, rank) : 0;
      const quality = ok ? (buff ? roll : 1 - roll) : null;
      stats.push({ tag: s.Tag, label: statLabel(def, s.Tag), display: def ? displayValue(s.Tag, value) : "?", value, buff, quality, grade: quality == null ? "?" : gradeOf(quality), spliced: SPLICED_TAGS.has(s.Tag) });
    }
  }
  const qs = stats.filter((s) => s.buff && s.quality != null).map((s) => s.quality as number);
  const quality = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : null;
  const weaponItem = fp.compat ? m.catalogByUnique.get(fp.compat) : undefined;
  const weapon = weaponItem?.name ?? (fp.compat ? m.nameOf(fp.compat) : "Unknown weapon");
  return {
    id: raw.id,
    type,
    kind: RIVEN_KIND[type] ?? "Riven",
    weapon,
    weaponUnique: weaponItem?.uniqueName ?? fp.compat ?? null,
    image: weaponItem?.imageName ?? m.imageOf(weapon),
    name: rivenName(table, buffs),
    rank,
    rerolls: fp.rerolls ?? 0,
    mastery: fp.lvlReq ?? 0,
    polarity: fp.pol ? (POLARITY[fp.pol] ?? null) : null,
    stats,
    quality,
    grade: quality == null ? "?" : gradeOf(quality),
    spliced: stats.some((x) => x.spliced),
  };
}

/** The game's name for a riven: prefixes by the strongest buff, the last buff's suffix. */
export function rivenName(table: RivenStatDef[], buffs: RivenStatRaw[]): string {
  const syl = (tag: string) => table.find((d) => d.tag === tag);
  const sorted = [...buffs].sort((a, b) => b.Value - a.Value || (syl(a.Tag)?.value ?? 0) - (syl(b.Tag)?.value ?? 0));
  if (!sorted.length) return "";
  const parts = sorted.map((b, i) => (i === sorted.length - 1 ? (syl(b.Tag)?.suffix ?? "") : (syl(b.Tag)?.prefix ?? "")));
  const head = parts.slice(0, -1);
  const word = head.length ? `${head.join("-")}${parts[parts.length - 1]}` : parts[0];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ---------------------------------------------------------------- cycling

/** A riven's roll as orbiter saw it on one read. */
export interface RivenSnap {
  at: number;
  rerolls: number;
  buffs: RivenStatRaw[];
  curses: RivenStatRaw[];
}

/** Kuva for each cycle: 900 for the first, rising to 3,500 from the tenth on. */
export const KUVA_COSTS = [900, 1000, 1200, 1400, 1700, 2000, 2350, 2750, 3150, 3500];
/** What the next cycle costs after `done` of them. */
export const cycleCost = (done: number) => KUVA_COSTS[Math.min(done, KUVA_COSTS.length - 1)];
/** Kuva spent on a riven cycled `rerolls` times. */
export function kuvaSpent(rerolls: number): number {
  let t = 0;
  for (let i = 0; i < rerolls; i++) t += cycleCost(i);
  return t;
}

const sameRoll = (a: { buffs: RivenStatRaw[]; curses: RivenStatRaw[] }, b: { buffs: RivenStatRaw[]; curses: RivenStatRaw[] }) =>
  JSON.stringify([a.buffs, a.curses]) === JSON.stringify([b.buffs, b.curses]);

/** Adds each riven's roll to its history when it's new or was cycled. Null when nothing changed. */
export function recordRivens(hist: Record<string, RivenSnap[]>, raws: RivenRaw[], now = Date.now()): Record<string, RivenSnap[]> | null {
  const out: Record<string, RivenSnap[]> = {};
  let changed = false;
  for (const raw of raws) {
    const fp = raw.fp ?? {};
    if (!fp.buffs?.length) continue;
    const snap: RivenSnap = { at: now, rerolls: fp.rerolls ?? 0, buffs: fp.buffs, curses: fp.curses ?? [] };
    const list = hist[raw.id] ?? [];
    const last = list.at(-1);
    if (!last || last.rerolls !== snap.rerolls || !sameRoll(last, snap)) {
      out[raw.id] = [...list, snap].slice(-6);
      changed = true;
    } else out[raw.id] = list;
  }
  // Rivens you no longer have drop out.
  if (Object.keys(hist).some((k) => !(k in out))) changed = true;
  return changed ? out : null;
}

export interface RivenChange {
  /** The roll before the last cycle, at today's rank so the numbers compare. */
  prev: Riven;
  /** Cycled, but you kept the roll you had. */
  kept: boolean;
  at: number;
}

/** What the last cycle orbiter saw did to a riven. */
export function lastCycle(m: Model, tables: Map<string, RivenStatDef[]>, raw: RivenRaw, hist: Record<string, RivenSnap[]>): RivenChange | null {
  const list = hist[raw.id];
  if (!list || list.length < 2) return null;
  const before = list[list.length - 2];
  const now = list[list.length - 1];
  const prev = parseRiven(m, tables, { ...raw, fp: { ...raw.fp, buffs: before.buffs, curses: before.curses, rerolls: before.rerolls } });
  return prev ? { prev, kept: sameRoll(before, now), at: now.at } : null;
}

// ---------------------------------------------------------------- warframe.market

export interface RivenMeta {
  weapons: { slug: string; gameRef: string; name: string; group: string; rivenType: string }[];
  attributes: { slug: string; gameRef: string; name: string; unit?: string | null; positiveOnly?: boolean; negativeOnly?: boolean; exclusiveTo?: string[] | null }[];
}

/** Melee rivens use their own tags for a few stats warframe.market lists once. */
const MARKET_ALIAS: Record<string, string> = {
  WeaponMeleeDamageMod: "base_damage_/_melee_damage",
  WeaponMeleeFactionDamageCorpus: "damage_vs_corpus",
  WeaponMeleeFactionDamageGrineer: "damage_vs_grineer",
  WeaponMeleeFactionDamageInfested: "damage_vs_infested",
};

export const attributeSlug = (meta: RivenMeta, tag: string) => MARKET_ALIAS[tag] ?? meta.attributes.find((a) => a.gameRef === tag)?.slug ?? null;
/** A riven fits a weapon family: Rubico Prime takes a Rubico riven. */
export function weaponSlug(meta: RivenMeta, unique: string | null, name: string): string | null {
  const exact = meta.weapons.find((w) => w.gameRef === unique) ?? meta.weapons.find((w) => w.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact.slug;
  const n = name.toLowerCase();
  const family = meta.weapons.filter((w) => n.startsWith(`${w.name.toLowerCase()} `) || n.endsWith(` ${w.name.toLowerCase()}`)).sort((a, b) => b.name.length - a.name.length)[0];
  return family?.slug ?? null;
}

export interface RivenAuction {
  id: string;
  price: number | null;
  starting: number | null;
  name: string;
  rank: number;
  rerolls: number;
  mr: number;
  polarity: string;
  attributes: { url_name: string; value: number; positive: boolean }[];
  seller: string;
  status: string;
  updated: string;
}

/** A riven's buffs as market slugs, and its curse, to find comparable ones for sale. */
export function searchFor(meta: RivenMeta, r: Riven): { weapon: string | null; positive: string[]; negative: string | null } {
  const weapon = weaponSlug(meta, r.weaponUnique, r.weapon);
  const positive = r.stats.filter((s) => s.buff).map((s) => attributeSlug(meta, s.tag)).filter((x): x is string => !!x).slice(0, 3);
  const curse = r.stats.find((s) => !s.buff);
  return { weapon, positive, negative: curse ? attributeSlug(meta, curse.tag) : null };
}

/** What comparable rivens sell for: the cheapest, and the middle of the five cheapest. */
export function priceCheck(auctions: RivenAuction[]): { lowest: number | null; typical: number | null; count: number } {
  const prices = auctions.map((a) => a.price).filter((p): p is number => p != null && p > 0).sort((a, b) => a - b);
  const first = prices.slice(0, 5);
  return { lowest: prices[0] ?? null, typical: first.length ? first[Math.floor(first.length / 2)] : null, count: prices.length };
}

/** The game's riven type for a weapon warframe.market lists, to read its rivens' numbers. */
export function rivenTypeOf(meta: RivenMeta, slug: string): string | null {
  const w = meta.weapons.find((x) => x.slug === slug);
  if (!w) return null;
  if (w.group === "archgun") return "LotusArchgunRandomModRare";
  if (w.group === "kitgun") return "LotusModularPistolRandomModRare";
  if (w.group === "zaw") return "LotusModularMeleeRandomModRare";
  return { rifle: "LotusRifleRandomModRare", shotgun: "LotusShotgunRandomModRare", pistol: "LotusPistolRandomModRare", melee: "PlayerMeleeWeaponRandomModRare" }[w.rivenType] ?? null;
}

/** A market attribute slug back to the stat tag a riven of this type uses. */
export function tagFor(meta: RivenMeta, slug: string, type: string): string | null {
  if (type === "PlayerMeleeWeaponRandomModRare" || type === "LotusModularMeleeRandomModRare") {
    const melee = Object.entries(MARKET_ALIAS).find(([, s]) => s === slug);
    if (melee) return melee[0];
  }
  return meta.attributes.find((a) => a.slug === slug)?.gameRef ?? null;
}

/**
 * How well a listed riven rolled, from the numbers its seller typed: a grade per stat and overall.
 * Stats that fall outside anything the riven could roll (old listings from before dispositions
 * changed, typos) get "?" and don't count.
 */
export function gradeAuction(meta: RivenMeta, tables: Map<string, RivenStatDef[]>, weapon: string, a: RivenAuction): { grades: string[]; grade: string; quality: number | null } {
  const type = rivenTypeOf(meta, weapon);
  const table = type ? (tables.get(type) ?? []) : [];
  const nb = a.attributes.filter((x) => x.positive).length;
  const nc = a.attributes.length - nb;
  const qs: number[] = [];
  const grades = a.attributes.map((x) => {
    const tag = type ? tagFor(meta, x.url_name, type) : null;
    const def = tag ? table.find((d) => d.tag === tag) : undefined;
    if (!def || !tag) return "?";
    const unit = meta.attributes.find((m) => m.slug === x.url_name)?.unit;
    const raw = unit === "percent" ? x.value / 100 : unit === "multiply" ? x.value - 1 : x.value;
    const roll = rollOf(def, raw, x.positive, nb, nc, a.rank);
    if (!(roll >= -0.075 && roll <= 1.075)) return "?";
    const q = Math.min(1, Math.max(0, x.positive ? roll : 1 - roll));
    if (x.positive) qs.push(q);
    return gradeOf(q);
  });
  const quality = qs.length ? qs.reduce((p, q) => p + q, 0) / qs.length : null;
  return { grades, grade: quality == null ? "?" : gradeOf(quality), quality };
}

// ---------------------------------------------------------------- selling (auctions)

/** A riven as warframe.market's auction form takes it. */
export interface AuctionItem {
  type: "riven";
  weapon_url_name: string;
  name: string;
  attributes: { url_name: string; positive: boolean; value: number }[];
  mastery_level: number;
  mod_rank: number;
  re_rolls: number;
  polarity: string;
}

/** The number warframe.market shows for a stat: percentages as 93.8, multipliers as 1.45, plain amounts (range, combo time) as 1.23. */
export function marketValue(meta: RivenMeta, slug: string, value: number): number {
  const unit = meta.attributes.find((a) => a.slug === slug)?.unit;
  if (unit === "percent") return Math.round(value * 1000) / 10;
  if (unit === "multiply") return Math.round((1 + value) * 100) / 100;
  return Math.round(value * 100) / 100;
}

/** One of your rivens in warframe.market's auction form, or why it can't be listed. */
export function auctionItemFor(meta: RivenMeta, r: Riven): { item: AuctionItem } | { error: string } {
  const weapon = weaponSlug(meta, r.weaponUnique, r.weapon);
  if (!weapon) return { error: `warframe.market doesn't list rivens for ${r.weapon}` };
  const attributes: AuctionItem["attributes"] = [];
  for (const s of r.stats) {
    const slug = attributeSlug(meta, s.tag);
    if (!slug) return { error: `warframe.market has no stat for ${s.label}` };
    attributes.push({ url_name: slug, positive: s.buff, value: marketValue(meta, slug, s.value) });
  }
  if (!r.name) return { error: "The riven's name couldn't be worked out" };
  return {
    item: { type: "riven", weapon_url_name: weapon, name: r.name.toLowerCase(), attributes, mastery_level: r.mastery, mod_rank: r.rank, re_rolls: r.rerolls, polarity: r.polarity ?? "madurai" },
  };
}

/** One of your auctions on warframe.market. */
export interface MyAuction {
  id: string;
  weapon: string;
  name: string;
  starting: number;
  buyout: number | null;
  topBid: number | null;
  closed: boolean;
  visible: boolean;
  note: string;
  minRep: number;
  updated: string;
}

/** `v1/profile/auctions` → your riven auctions. */
export function parseMyAuctions(raw: unknown): MyAuction[] {
  if (!Array.isArray(raw)) return [];
  const out: MyAuction[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    const item = (a.item ?? {}) as Record<string, unknown>;
    if (item.type !== "riven" || typeof a.id !== "string") continue;
    out.push({
      id: a.id,
      weapon: String(item.weapon_url_name ?? ""),
      name: String(item.name ?? ""),
      starting: Number(a.starting_price ?? 0),
      buyout: a.buyout_price == null ? null : Number(a.buyout_price),
      topBid: a.top_bid == null ? null : Number(a.top_bid),
      closed: a.closed === true,
      visible: a.visible !== false,
      note: String(a.note_raw ?? a.note ?? ""),
      minRep: Number(a.minimal_reputation ?? 0),
      updated: String(a.updated ?? ""),
    });
  }
  return out;
}

/** Your open auction for this riven, if you have one: same weapon, same name. */
export function auctionOf(meta: RivenMeta, r: Riven, mine: MyAuction[]): MyAuction | undefined {
  const weapon = weaponSlug(meta, r.weaponUnique, r.weapon);
  const name = r.name.toLowerCase();
  return mine.find((a) => !a.closed && a.weapon === weapon && a.name === name);
}
