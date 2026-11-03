// The ideal riven for a weapon, and how close the player's own rivens come to it. Pure: no I/O.
//
// Two sources, always labelled apart:
//  - "orbiter's rule": what a weapon of this kind and these stats wants, from its catalog numbers
//    (crit weapons want Critical Chance and Critical Damage; status weapons Multishot, Damage, an
//    element and Status Chance; melee adds Range and Attack Speed), and which negatives cost it
//    little (−Zoom, −Ammo, a physical damage type the weapon barely deals).
//  - "what players pay most for on warframe.market": the rivens listed for the weapon that orbiter
//    already read (the Rivens page's "Any … riven" search, kept in SavedRivenPrices): for each stat,
//    the middle asking price of listings with it and without it. Asking prices only, and only what
//    was listed; nothing is said with fewer than MIN_LISTED priced listings, and no price is made up.
//
// Dispositions: Hotfix 44.1.3 removed weapon-specific dispositions; every riven now rolls as a 1.2
// disposition did (orbiter's rivens.ts, DISPOSITION). The catalog's 1–5 dots predate that.

import type { CatalogItem } from "../types";
import { DISPOSITION, statWant, type Riven, type RivenAuction } from "../rivens";

/** A riven stat by its warframe.market slug: the label the game shows and the game's tags for it. */
interface StatDef {
  label: string;
  tags: string[];
}
const S = (label: string, ...tags: string[]): StatDef => ({ label, tags });

/** The stats orbiter reasons about (slugs and tags as in warframe.market's /v2/riven/attributes). */
export const RIVEN_STATS: Record<string, StatDef> = {
  critical_chance: S("Critical Chance", "WeaponCritChanceMod"),
  critical_damage: S("Critical Damage", "WeaponCritDamageMod"),
  multishot: S("Multishot", "WeaponFireIterationsMod"),
  "base_damage_/_melee_damage": S("Damage", "WeaponDamageAmountMod", "WeaponMeleeDamageMod"),
  status_chance: S("Status Chance", "WeaponStunChanceMod"),
  status_duration: S("Status Duration", "WeaponProcTimeMod"),
  "fire_rate_/_attack_speed": S("Fire Rate / Attack Speed", "WeaponFireRateMod"),
  toxin_damage: S("Toxin", "WeaponToxinDamageMod"),
  heat_damage: S("Heat", "WeaponFireDamageMod"),
  cold_damage: S("Cold", "WeaponFreezeDamageMod"),
  electric_damage: S("Electricity", "WeaponElectricityDamageMod"),
  range: S("Range", "WeaponMeleeRangeIncMod"),
  channeling_damage: S("Initial Combo", "WeaponMeleeComboInitialBonusMod"),
  critical_chance_on_slide_attack: S("Critical Chance for Slide Attack", "SlideAttackCritChanceMod"),
  combo_duration: S("Combo Duration", "ComboDurationMod"),
  channeling_efficiency: S("Heavy Attack Efficiency", "WeaponMeleeComboEfficiencyMod"),
  finisher_damage: S("Finisher Damage", "WeaponMeleeFinisherDamageMod"),
  zoom: S("Zoom", "WeaponZoomFovMod"),
  ammo_maximum: S("Ammo Maximum", "WeaponAmmoMaxMod"),
  recoil: S("Weapon Recoil", "WeaponRecoilReductionMod"),
  magazine_capacity: S("Magazine Capacity", "WeaponClipMaxMod"),
  reload_speed: S("Reload Speed", "WeaponReloadSpeedMod"),
  projectile_speed: S("Projectile Speed", "WeaponProjectileSpeedMod"),
  punch_through: S("Punch Through", "WeaponPunctureDepthMod"),
  impact_damage: S("Impact", "WeaponImpactDamageMod"),
  puncture_damage: S("Puncture", "WeaponArmorPiercingDamageMod"),
  slash_damage: S("Slash", "WeaponSlashDamageMod"),
  damage_vs_corpus: S("Damage to Corpus", "WeaponFactionDamageCorpus", "WeaponMeleeFactionDamageCorpus"),
  damage_vs_grineer: S("Damage to Grineer", "WeaponFactionDamageGrineer", "WeaponMeleeFactionDamageGrineer"),
  damage_vs_infested: S("Damage to Infested", "WeaponFactionDamageInfested", "WeaponMeleeFactionDamageInfested"),
};

/** Fewer priced listings than this and orbiter says nothing about the market. */
export const MIN_LISTED = 8;

export type RivenClass = "rifle" | "shotgun" | "pistol" | "melee" | "archgun";
export type RivenFocus = "crit" | "status" | "hybrid" | "base";

/** The rivens listed for a weapon, as the Rivens page keeps them: auctions, or [price, buff slugs]. */
export interface RivenMarketData {
  listed: (RivenAuction | [number, string[]])[];
  /** When they were read (unix ms), if the listings carry no date of their own. */
  at?: number | null;
}

/** What the market says about one stat, from the listings alone. */
export interface StatMarketView {
  /** Priced listings with it as a positive (or, for a negative, as the negative), and of all. */
  with: number;
  of: number;
  /** Middle asking price of listings with it, and without it (platinum, as listed). */
  withIt: number | null;
  without: number | null;
}

export interface IdealStat {
  /** The label the game shows ("Critical Chance"). */
  stat: string;
  /** warframe.market's slug. */
  slug: string;
  /** The game's tags for it, to match a riven's stats. */
  tags: string[];
  why: string;
  /** "rule": orbiter's rule; "market": what players pay most for on warframe.market; "both". */
  basis: "rule" | "market" | "both";
  market?: StatMarketView;
}

export interface IdealRiven {
  weapon: string;
  cls: RivenClass;
  focus: RivenFocus;
  /** The three positives worth most, best first. */
  positives: IdealStat[];
  /** Negatives that cost this weapon little, most harmless first. */
  negatives: IdealStat[];
  disposition: { value: number; note: string; source: string };
  basedOn: { auctions: number; since: string | null };
  /** One line on where it comes from, for the page to show. */
  label: string;
}

// ---------------------------------------------------------------- what the weapon is

/** Which riven family a weapon's stats read as (companion weapons by their game path). */
export function rivenClassOf(w: CatalogItem): RivenClass {
  if (w.category === "Melee" || w.type === "Melee") return "melee";
  if (w.category === "Arch-Gun" || w.productCategory === "SpaceGuns") return "archgun";
  if (w.type === "Shotgun" || w.type === "Shotgun Sidearm" || /Shotgun/i.test(w.uniqueName)) return "shotgun";
  if (w.category === "Secondary" || /Pistol/i.test(w.uniqueName)) return "pistol";
  if (w.productCategory === "SentinelWeapons" && (/Glaive|MeleeWeapon/i.test(w.uniqueName) || !w.trigger)) return "melee";
  return "rifle";
}

/** Built around crit, status, both or neither (the same thresholds as suggest.ts's focusOf). */
export function rivenFocusOf(w: CatalogItem, cls: RivenClass): RivenFocus {
  const crit = (w.criticalChance ?? 0) >= 0.2 && (w.criticalMultiplier ?? 0) >= 2;
  const status = (w.procChance ?? 0) >= (cls === "shotgun" ? 0.12 : 0.2);
  return crit && status ? "hybrid" : crit ? "crit" : status ? "status" : "base";
}

/** Each physical damage type's share of the weapon's damage, 0..1. */
function physicalShare(w: CatalogItem): Record<"impact" | "puncture" | "slash", number> {
  const d = ((w as { damage?: Record<string, number> }).damage ?? {}) as Record<string, number>;
  const total = Object.values(d).reduce((s, v) => s + (v > 0 ? v : 0), 0) || (w.totalDamage ?? 0);
  const share = (k: string) => (total > 0 ? (d[k] ?? 0) / total : 0);
  return { impact: share("impact"), puncture: share("puncture"), slash: share("slash") };
}

// ---------------------------------------------------------------- orbiter's rule

const ELEMENT_WHY = "an element on the riven frees a mod slot; orbiter names Toxin, which its builds start Viral and Corrosive from (swap for the element your build lacks).";

/** The positives the rule wants for this weapon, with a weight each (3 = what it's built around). */
function rulePositives(cls: RivenClass, focus: RivenFocus): [string, number, string][] {
  if (cls === "melee") {
    const base: Record<RivenFocus, [string, number, string][]> = {
      crit: [
        ["critical_chance", 3, "its base crit is high enough that more of it compounds with Blood Rush and the combo."],
        ["critical_damage", 3, "each crit is worth more, on a weapon built around crits."],
        ["base_damage_/_melee_damage", 2.4, "flat melee damage, on top of Pressure Point."],
        ["range", 1.8, "reach decides how many enemies each swing hits."],
        ["fire_rate_/_attack_speed", 1.6, "more swings, more crits."],
      ],
      status: [
        ["base_damage_/_melee_damage", 3, "flat melee damage scales every proc."],
        ["status_chance", 2.6, "more procs for Condition Overload and Weeping Wounds."],
        ["toxin_damage", 2.4, ELEMENT_WHY],
        ["fire_rate_/_attack_speed", 2, "more swings, more procs."],
        ["range", 1.8, "reach decides how many enemies each swing hits."],
      ],
      hybrid: [
        ["critical_chance", 3, "its base crit is high enough that more of it compounds with Blood Rush and the combo."],
        ["critical_damage", 2.8, "each crit is worth more."],
        ["base_damage_/_melee_damage", 2.6, "flat melee damage, on crits and procs alike."],
        ["status_chance", 2, "it procs too, so status chance pays."],
        ["range", 1.8, "reach decides how many enemies each swing hits."],
      ],
      base: [
        ["base_damage_/_melee_damage", 3, "neither crit nor status carries it, so raw damage does."],
        ["toxin_damage", 2.4, ELEMENT_WHY],
        ["range", 2, "reach decides how many enemies each swing hits."],
        ["fire_rate_/_attack_speed", 2, "more swings."],
      ],
    };
    return base[focus];
  }
  const ms: [string, number, string] = ["multishot", 2.8, "every extra projectile is a whole extra hit, crit and proc."];
  const dmg: [string, number, string] = ["base_damage_/_melee_damage", 2.6, "base damage multiplies everything else."];
  const by: Record<RivenFocus, [string, number, string][]> = {
    crit: [
      ["critical_chance", 3, "its base crit is high enough that more of it pays the most."],
      ["critical_damage", 3, "each crit is worth more, on a weapon built around crits."],
      ms,
      dmg,
      ["toxin_damage", 1.8, ELEMENT_WHY],
    ],
    status: [
      ["multishot", 3, "every extra projectile is a whole extra hit and proc."],
      ["base_damage_/_melee_damage", 2.8, "base damage scales every proc's damage."],
      ["status_chance", 2.4, "more procs, on a weapon built around them."],
      ["toxin_damage", 2.3, ELEMENT_WHY],
      ["fire_rate_/_attack_speed", 1.5, "more shots, more procs."],
    ],
    hybrid: [
      ["critical_chance", 3, "its base crit is high enough that more of it pays."],
      ["critical_damage", 2.9, "each crit is worth more."],
      ms,
      dmg,
      ["status_chance", 1.8, "it procs too, so status chance pays."],
    ],
    base: [
      ["multishot", 3, "every extra projectile is a whole extra hit."],
      ["base_damage_/_melee_damage", 3, "neither crit nor status carries it, so raw damage does."],
      ["toxin_damage", 2.4, ELEMENT_WHY],
      ["fire_rate_/_attack_speed", 1.5, "more shots."],
    ],
  };
  return by[focus];
}

/** Negatives the rule calls harmless for this weapon, most harmless first. */
function ruleNegatives(w: CatalogItem, cls: RivenClass): [string, string][] {
  const out: [string, string][] = [];
  const phys = physicalShare(w);
  if (cls !== "melee") {
    out.push(["zoom", "zoom only changes the scope's view."]);
    out.push(["ammo_maximum", "a smaller reserve rarely runs dry with ammo mutation in the exilus."]);
  }
  const low = (k: "impact" | "puncture" | "slash", slug: string, label: string) => {
    if (phys[k] < 0.25) out.push([slug, `${label} is ${Math.round(phys[k] * 100)}% of its damage, so less of it costs little.`]);
  };
  low("impact", "impact_damage", "Impact");
  low("puncture", "puncture_damage", "Puncture");
  low("slash", "slash_damage", "Slash");
  if (cls === "melee") {
    out.push(["finisher_damage", "finishers are a small part of melee damage."]);
    out.push(["channeling_efficiency", "costs only heavy-attack builds."]);
  } else {
    out.push(["recoil", "more kick, but no less damage."]);
  }
  out.push(["damage_vs_corpus", "costs only against the Corpus."]);
  out.push(["damage_vs_infested", "costs only against the Infested."]);
  return out;
}

// ---------------------------------------------------------------- the market

interface Listing {
  price: number;
  pos: string[];
  neg: string[];
  updated: string | null;
}

function listingsOf(data: RivenMarketData | null | undefined): Listing[] {
  const out: Listing[] = [];
  for (const x of data?.listed ?? []) {
    if (Array.isArray(x)) {
      if (typeof x[0] === "number" && x[0] > 0) out.push({ price: x[0], pos: x[1] ?? [], neg: [], updated: null });
    } else if (x && x.price != null && x.price > 0) {
      out.push({ price: x.price, pos: x.attributes.filter((a) => a.positive).map((a) => a.url_name), neg: x.attributes.filter((a) => !a.positive).map((a) => a.url_name), updated: x.updated || null });
    }
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function view(listed: Listing[], has: (l: Listing) => boolean): StatMarketView {
  const yes = listed.filter(has).map((l) => l.price);
  const no = listed.filter((l) => !has(l)).map((l) => l.price);
  return { with: yes.length, of: listed.length, withIt: median(yes), without: median(no) };
}

/** How much more listings with a stat ask, as a weight: 0 when there's too little to say. */
function lift(v: StatMarketView): number {
  if (v.with < 3 || v.withIt == null || v.without == null || v.without <= 0) return 0;
  return Math.max(-1, Math.min(2, Math.log2(v.withIt / v.without)));
}

const marketLine = (v: StatMarketView) => `On warframe.market, ${v.with} of ${v.of} listed rivens have it, asking ${v.withIt} platinum in the middle against ${v.without ?? "–"} without it.`;

// ---------------------------------------------------------------- the ideal

/**
 * The ideal riven for a weapon: the three positives worth most, the negatives that cost it
 * least, its disposition, and what the market part is based on. `data`: the rivens listed for it
 * that orbiter already read (none: the rule alone).
 */
export function idealRiven(weapon: CatalogItem, data: RivenMarketData | null = null): IdealRiven {
  const cls = rivenClassOf(weapon);
  const focus = rivenFocusOf(weapon, cls);
  const listed = listingsOf(data);
  const enough = listed.length >= MIN_LISTED;

  // Positives: the rule's weight, moved by what listings with the stat ask.
  const scored = new Map<string, { score: number; ruleWhy: string | null; market?: StatMarketView; lifted: number }>();
  for (const [slug, w, why] of rulePositives(cls, focus)) scored.set(slug, { score: w, ruleWhy: why, lifted: 0 });
  if (enough) {
    const seen = new Set(listed.flatMap((l) => l.pos));
    for (const slug of seen) {
      if (!RIVEN_STATS[slug]) continue;
      const v = view(listed, (l) => l.pos.includes(slug));
      const l = lift(v);
      const had = scored.get(slug);
      if (had) scored.set(slug, { ...had, score: had.score + 1.5 * l, market: v, lifted: l });
      else if (l > 0.5) scored.set(slug, { score: 1 + 1.5 * l, ruleWhy: null, market: v, lifted: l });
    }
  }
  const positives: IdealStat[] = [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 3)
    .map(([slug, s]) => {
      const def = RIVEN_STATS[slug];
      const sought = s.lifted > 0.5;
      const basis: IdealStat["basis"] = s.ruleWhy && sought ? "both" : s.ruleWhy ? "rule" : "market";
      const why = [s.ruleWhy ? `orbiter's rule: ${s.ruleWhy}` : null, s.market && sought ? `What players pay most for: ${marketLine(s.market)}` : null].filter(Boolean).join(" ");
      return { stat: def.label, slug, tags: def.tags, why, basis, ...(s.market ? { market: s.market } : {}) };
    });

  // Negatives: the rule's harmless ones, with listings that carry them as a check.
  const negatives: IdealStat[] = ruleNegatives(weapon, cls).map(([slug, why]) => {
    const def = RIVEN_STATS[slug];
    const v = enough ? view(listed, (l) => l.neg.includes(slug)) : null;
    const backed = !!v && v.with >= 3 && v.withIt != null && v.without != null && v.withIt >= v.without;
    return {
      stat: def.label,
      slug,
      tags: def.tags,
      why: `orbiter's rule: ${why}${backed ? ` On warframe.market, ${v!.with} listed rivens carry it and ask ${v!.withIt} platinum in the middle, no less than the rest (${v!.without}).` : ""}`,
      basis: backed ? "both" : "rule",
      ...(v && v.with ? { market: v } : {}),
    };
  });

  const dates = listed.map((l) => l.updated).filter((d): d is string => !!d).sort();
  const since = dates[0] ?? (data?.at ? new Date(data.at).toISOString() : null);
  return {
    weapon: weapon.name,
    cls,
    focus,
    positives,
    negatives,
    disposition: {
      value: DISPOSITION,
      note: "Hotfix 44.1.3 removed weapon-specific dispositions: every riven now rolls as a 1.2 disposition did.",
      source: "https://www.warframe.com/zh-hans/patch-notes/pc/44-1-3",
    },
    basedOn: { auctions: listed.length, since },
    label: enough
      ? `orbiter's rule for a ${focus === "base" ? "" : `${focus} `}${cls}, checked against what players pay most for on warframe.market (${listed.length} listed rivens).`
      : `orbiter's rule for a ${focus === "base" ? "" : `${focus} `}${cls}${listed.length ? ` (only ${listed.length} listed rivens read: too few to say what players pay most for)` : "; no listings read yet, so nothing from warframe.market"}.`,
  };
}

// ---------------------------------------------------------------- the player's rivens against it

export interface RivenFit {
  /** Wanted positives the riven has, of the ideal's (up to 3). */
  wanted: number;
  of: number;
  hits: string[];
  negative: "none" | "harmless" | "mild" | "hurts";
  /** The negative's label, if any. */
  curse: string | null;
  /** 0..1: wanted stats count most, then how little the negative costs. */
  score: number;
  /** "2 of 3 wanted stats, harmless negative (−Zoom)". */
  text: string;
}

/** How a riven compares with the ideal for its weapon. */
export function rivenFit(riven: Pick<Riven, "stats">, ideal: IdealRiven): RivenFit {
  const buffs = riven.stats.filter((s) => s.buff);
  const curse = riven.stats.find((s) => !s.buff) ?? null;
  const hits = ideal.positives.filter((p) => buffs.some((b) => p.tags.includes(b.tag))).map((p) => p.stat);
  const of = ideal.positives.length;
  let negative: RivenFit["negative"] = "none";
  if (curse) negative = ideal.negatives.some((n) => n.tags.includes(curse.tag)) ? "harmless" : statWant(curse.tag) >= 1.5 ? "hurts" : "mild";
  const negScore = { none: 1, harmless: 1, mild: 0.5, hurts: 0 }[negative];
  const score = Math.round(((of ? hits.length / of : 0) * 0.8 + negScore * 0.2) * 100) / 100;
  const curseLabel = curse ? curse.label : null;
  const negText = negative === "none" ? "no negative" : `${negative === "hurts" ? "a negative that hurts" : negative === "harmless" ? "harmless negative" : "a mild negative"} (−${curseLabel})`;
  return { wanted: hits.length, of, hits, negative, curse: curseLabel, score, text: `${hits.length} of ${of} wanted stats, ${negText}` };
}

/** Riven families: a riven for the Soma takes on the Soma Prime, a Hek's on a Kuva Hek. */
const VARIANT = /^(Prisma|Kuva|Tenet|Coda|Mk1-|Telos|Synoid|Sancti|Secura|Vaykor|Rakta|Dex)\s*|\s+(Prime|Vandal|Wraith)$/g;
export const rivenFamily = (name: string) => name.replace(VARIANT, "").replace(VARIANT, "").trim().toLowerCase();

/** The player's rivens that go on this weapon. */
export function rivensFor(weapon: CatalogItem, mine: Riven[]): Riven[] {
  const fam = rivenFamily(weapon.name);
  return mine.filter((r) => r.weaponUnique === weapon.uniqueName || rivenFamily(r.weapon) === fam);
}
