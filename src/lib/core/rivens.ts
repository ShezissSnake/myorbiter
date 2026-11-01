// Rivens, from the game's own fingerprints (passed through by the patched TennoScope): each stat's
// value as the game shows it, how good its roll is, and the riven's name.
//
// A stat's value is its base (per riven type and stat, from the catalog) × 10 × 1.5 × the
// weapon's disposition × the riven's buff/curse count factor × a roll between 0.9 and 1.1 ×
// (rank + 1). Since the 22 Oct 2026 hotfix every weapon's disposition is 1.2.
import type { Model } from "./model";
import type { CatalogItem } from "./types";
export { checkedWhen } from "./timers";

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
  /** Mid-cycle: the new roll on offer, waiting for you to keep the old one or take it. */
  pending?: RivenFingerprint;
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
  /** For a companion's weapon (a sentinel's or MOA's gun, a hound's claws…). */
  companion: boolean;
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
  const weaponItem = fp.compat ? compatWeapon(m, fp.compat) : undefined;
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
    companion: !!fp.compat && (weaponItem?.type === "Companion Weapon" || /\/SentinelWeapons\//.test(fp.compat)),
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

/**
 * How much players want each stat on a riven, 0 to 3: what makes a riven sell is crit, multishot,
 * damage and the elements; reload, zoom or punch through add little. A curse on a stat nobody
 * uses (zoom, a physical damage the weapon barely has) costs nothing.
 */
const WANT: [RegExp, number][] = [
  [/SlideAttackCrit|MeleeHeavyAttack|MeleeComboInitialBonus|ComboDuration|MeleeRangeInc|MeleeSlam/, 1.5],
  [/Weakpoint|Faction|ProcTime|AmmoEfficiency|ImpactDamage|ArmorPiercing|SlashDamage/, 1],
  [/CritChance|CritDamage|FireIterations|WeaponDamageAmount|WeaponMeleeDamage/, 3],
  [/(Toxin|Fire|Freeze|Electricity|Viral|Corrosive|Radiation|Gas|Blast|Magnetic)Damage/, 2.5],
  [/StunChance|StatusDamage|FireRate/, 2],
  [/Clip|AmmoMax|Reload|PunctureDepth|ProjectileSpeed|Recoil|ZoomFov|ParryAngle|Finisher|ComboEfficiency|ComboPointsOnHit|ComboBonusOnHit/, 0.4],
];
export const statWant = (tag: string) => WANT.find(([re]) => re.test(tag))?.[1] ?? 1;

/**
 * A roll's worth for keep-or-take, on its own: each buff by how much it's wanted and how well it
 * rolled, more stats being better, and a curse counted against by how much it hurts (a curse on
 * zoom or recoil is free).
 */
export function rollScore(r: Riven): number {
  let s = 0;
  for (const x of r.stats) {
    const want = statWant(x.tag);
    const q = x.quality ?? 0.5;
    if (x.buff) s += want * (0.75 + 0.5 * q);
    else s -= want >= 1.5 ? want * (0.6 + 0.4 * (1 - q)) : 0;
  }
  return Math.round(s * 10) / 10;
}

export interface RollChoice {
  /** The roll it has now. */
  current: Riven;
  /** The roll on offer. */
  next: Riven;
  /** keep: the one it has; take: the new one; close: too close to call on the stats alone. */
  verdict: "keep" | "take" | "close";
  why: string;
}

/** One cycle of one riven: the riven, the cycle count and the roll on offer. */
export const cycleKey = (raw: RivenRaw) => `${raw.id}|${raw.pending?.rerolls ?? ""}|${JSON.stringify(raw.pending?.buffs ?? [])}`;

/** A riven mid-cycle: the roll it has and the one on offer, side by side, and which to keep. */
export function rollChoice(m: Model, tables: Map<string, RivenStatDef[]>, raw: RivenRaw): RollChoice | null {
  if (!raw.pending?.buffs?.length) return null;
  const current = parseRiven(m, tables, raw);
  // The new roll's own curses: none when it has none, never the old roll's.
  const next = parseRiven(m, tables, { ...raw, fp: { ...raw.fp, ...raw.pending, curses: raw.pending.curses ?? [] } });
  if (!current || !next) return null;
  const a = rollScore(current);
  const b = rollScore(next);
  const best = (r: Riven) => r.stats.filter((x) => x.buff).sort((x, y) => statWant(y.tag) - statWant(x.tag))[0]?.label ?? "";
  const curse = (r: Riven) => r.stats.find((x) => !x.buff);
  const curseWord = (r: Riven) => (curse(r) ? (statWant(curse(r)!.tag) >= 1.5 ? `, though its ${curse(r)!.label} curse hurts` : `, and its ${curse(r)!.label} curse costs nothing`) : ", with no curse");
  if (Math.abs(a - b) < 0.6) return { current, next, verdict: "close", why: "About as good either way on the stats: what similar rivens sell for decides." };
  return b > a
    ? { current, next, verdict: "take", why: `The new roll is better: ${best(next)} leads it${curseWord(next)}.` }
    : { current, next, verdict: "keep", why: `The one it has is better: ${best(current)} leads it${curseWord(current)}.` };
}

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

/**
 * The weapon a riven's `compat` names. Usually the weapon's own path; for some families the game
 * names a shared base instead (the Hek's rivens say `.../Shotgun/QuadShotgunBase`), so a path
 * ending in Base is the family's plain weapon beside it: the shortest path that starts with it.
 */
export function compatWeapon(m: Model, compat: string): CatalogItem | undefined {
  const exact = m.catalogByUnique.get(compat);
  if (exact || !/Base$/.test(compat)) return exact;
  const stem = compat.replace(/Base$/, "");
  const folder = compat.slice(0, compat.lastIndexOf("/") + 1);
  const leaf = stem.slice(folder.length);
  let best: CatalogItem | undefined;
  for (const c of m.catalogByUnique.values()) {
    if (!c.masterable) continue;
    const u = c.uniqueName;
    // In the same folder (QuadShotgun) or a folder of its own under it (QuadShotgun/QuadShotgun).
    if (!(u === stem || u.startsWith(`${stem}/`) || (u.startsWith(folder) && u.slice(folder.length).startsWith(leaf)))) continue;
    if (!best || u.length < best.uniqueName.length) best = c;
  }
  return best;
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

/** One of a riven's buffs against what's listed for its weapon. */
export interface StatMarket {
  tag: string;
  slug: string;
  /** Share of the weapon's listed rivens with it as a buff, 0..1. */
  share: number;
  /** Median asking price of listings with it, and without it. */
  withIt: number | null;
  without: number | null;
  /** Listings with it ask clearly more (half again or more): a stat buyers pay for. */
  sought: boolean;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * What each of a riven's buffs is worth on the market for its weapon, from the rivens listed for it
 * (any stats): how many of them carry it, and what they ask with it and without it. Asking prices,
 * and only what's listed, so a hint, not a valuation; nothing is said with fewer than 8 listings.
 */
export function statMarket(meta: RivenMeta, r: Riven, listed: RivenAuction[]): StatMarket[] | null {
  const priced = listed.filter((a) => a.price != null && a.price > 0);
  if (priced.length < 8) return null;
  const out: StatMarket[] = [];
  for (const s of r.stats.filter((x) => x.buff)) {
    const slug = attributeSlug(meta, s.tag);
    if (!slug) continue;
    const has = (a: RivenAuction) => a.attributes.some((x) => x.positive && x.url_name === slug);
    const yes = priced.filter(has).map((a) => a.price!);
    const no = priced.filter((a) => !has(a)).map((a) => a.price!);
    const withIt = median(yes);
    const without = median(no);
    out.push({ tag: s.tag, slug, share: yes.length / priced.length, withIt, without, sought: yes.length >= 3 && withIt != null && without != null && withIt >= without * 1.5 && withIt - without >= 20 });
  }
  return out;
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

// ---------------------------------------------------------------- what rivens traded for in game

/**
 * Digital Extremes' weekly figures for riven trades completed in game (www-static.warframe.com,
 * weeklyRivensPC.json and the like, refreshed each Monday): per riven kind and weapon, cycled or
 * not, what they went for. Trades for 1p are left out. Unlike warframe.market's listings, these
 * are sales; they don't say which stats sold.
 */
export interface RivenTrade {
  /** "Rifle", "Melee"… as the riven kinds go. */
  kind: string;
  /** The weapon ("Rubico" for a Rubico Prime too); null for veiled rivens of the kind. */
  weapon: string | null;
  rerolled: boolean;
  median: number | null;
  avg: number;
  min: number;
  max: number;
  /** DE's measure of how often they traded, relative to the rest. */
  pop: number;
}

/** The weekly file's platform names. */
export const TRADE_FILE: Record<string, string> = { pc: "PC", ps4: "PS4", xbox: "XB1", switch: "SWI", mobile: "PC" };
export const tradeUrl = (platform: string) => `https://www-static.warframe.com/repos/weeklyRivens${TRADE_FILE[platform] ?? "PC"}.json`;

/** Reads the weekly file: a JavaScript literal (bare keys, single quotes) as much as JSON. */
export function parseWeeklyRivens(text: string): RivenTrade[] {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      let s = "";
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\" && i + 1 < text.length) {
          s += text[i + 1];
          i += 2;
        } else s += text[i++];
      }
      i++;
      out += JSON.stringify(s);
    } else if (/[A-Za-z_]/.test(ch)) {
      let w = "";
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) w += text[i++];
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      out += text[j] === ":" ? JSON.stringify(w) : w;
    } else {
      out += ch;
      i++;
    }
  }
  const raw = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>[];
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return raw
    .filter((r) => typeof r.itemType === "string")
    .map((r) => ({
      kind: String(r.itemType).replace(/ Riven Mod$/, ""),
      weapon: typeof r.compatibility === "string" ? r.compatibility.replace(/ \((Melee|Primary|Secondary)\)$/, "") : null,
      rerolled: r.rerolled === true,
      median: num(r.median),
      avg: num(r.avg) ?? 0,
      min: num(r.min) ?? 0,
      max: num(r.max) ?? 0,
      pop: num(r.pop) ?? 0,
    }));
}

/**
 * Last week's trades for rivens like this one: same kind and weapon (a Rubico Prime riven is a
 * Rubico one), cycled or never cycled as it is; `other` is the other way round.
 */
export function tradesFor(trades: RivenTrade[], kind: string, weapon: string, rerolled: boolean): { same: RivenTrade | null; other: RivenTrade | null } {
  const ofKind = trades.filter((t) => t.kind === kind && t.weapon);
  const w = weapon.toLowerCase();
  const exact = ofKind.filter((t) => t.weapon!.toLowerCase() === w);
  const family = exact.length
    ? exact
    : (() => {
        const fits = ofKind.filter((t) => {
          const n = t.weapon!.toLowerCase();
          return w.startsWith(`${n} `) || w.endsWith(` ${n}`);
        });
        const longest = Math.max(0, ...fits.map((t) => t.weapon!.length));
        return fits.filter((t) => t.weapon!.length === longest);
      })();
  return { same: family.find((t) => t.rerolled === rerolled) ?? null, other: family.find((t) => t.rerolled !== rerolled) ?? null };
}

// ---------------------------------------------------------------- price checks kept between runs

/**
 * The last price check of each of your rivens, kept on disk so the next start shows them at once
 * (warframe.market answers slowly when asked about many rivens) until they're checked again.
 * Only what the cards use: asking prices of the similar rivens, and for each weapon the price and
 * buffs of the rivens listed for it.
 */
export interface SavedRivenPrices {
  v: 1;
  platform: string;
  /** Per riven: the search it was checked with (a cycled riven's new roll is a new search). */
  rivens: Record<string, { key: string; at: number; prices: number[] }>;
  /** Per weapon: [asking price, buff slugs] of the rivens listed for it. */
  weapons: Record<string, { at: number; listed: [number, string[]][] }>;
}

/** How long a kept check is worth keeping at all: a riven sold since drops out after this. */
const KEEP_FOR = 30 * 86_400_000;

export const searchKey = (weapon: string, positive: string[]) => `${weapon}|${[...positive].sort().join(",")}`;

export const packPrices = (auctions: RivenAuction[]): number[] => auctions.map((a) => a.price).filter((p): p is number => p != null && p > 0);
export const packListed = (auctions: RivenAuction[]): [number, string[]][] =>
  auctions.filter((a) => a.price != null && a.price > 0).map((a) => [a.price!, a.attributes.filter((x) => x.positive).map((x) => x.url_name)]);

const kept = (price: number, buffs: string[] = []): RivenAuction => ({
  id: "",
  price,
  starting: null,
  name: "",
  rank: 0,
  rerolls: 0,
  mr: 0,
  polarity: "",
  attributes: buffs.map((url_name) => ({ url_name, value: 0, positive: true })),
  seller: "",
  status: "",
  updated: "",
});
export const unpackPrices = (prices: number[]): RivenAuction[] => prices.map((p) => kept(p));
export const unpackListed = (listed: [number, string[]][]): RivenAuction[] => listed.map(([p, buffs]) => kept(p, buffs));

/** A file read back: anything malformed, or for another platform, counts as nothing kept. */
export function readSavedPrices(raw: unknown, platform: string): SavedRivenPrices {
  const empty: SavedRivenPrices = { v: 1, platform, rivens: {}, weapons: {} };
  const s = raw as SavedRivenPrices | null;
  if (!s || s.v !== 1 || s.platform !== platform || typeof s.rivens !== "object" || typeof s.weapons !== "object") return empty;
  const nums = (xs: unknown): xs is number[] => Array.isArray(xs) && xs.every((x) => typeof x === "number");
  const rivens: SavedRivenPrices["rivens"] = {};
  for (const [id, r] of Object.entries(s.rivens ?? {})) if (r && typeof r.key === "string" && typeof r.at === "number" && nums(r.prices)) rivens[id] = r;
  const weapons: SavedRivenPrices["weapons"] = {};
  for (const [w, x] of Object.entries(s.weapons ?? {}))
    if (x && typeof x.at === "number" && Array.isArray(x.listed) && x.listed.every((l) => Array.isArray(l) && typeof l[0] === "number" && Array.isArray(l[1]))) weapons[w] = x;
  return { v: 1, platform, rivens, weapons };
}

/** The kept checks with this one added, and ones older than a month gone. */
export function withSaved(s: SavedRivenPrices, now: number, riven?: { id: string; key: string; prices: number[] }, weapon?: { slug: string; listed: [number, string[]][] }): SavedRivenPrices {
  const old = now - KEEP_FOR;
  const rivens = Object.fromEntries(Object.entries(s.rivens).filter(([, r]) => r.at >= old));
  const weapons = Object.fromEntries(Object.entries(s.weapons).filter(([, w]) => w.at >= old));
  if (riven) rivens[riven.id] = { key: riven.key, at: now, prices: riven.prices };
  if (weapon) weapons[weapon.slug] = { at: now, listed: weapon.listed };
  return { ...s, rivens, weapons };
}
