// Matching mod and arcane names, as people write them, against the catalog.
//
// Names are compared normalised (case, accents, apostrophes, punctuation and spacing). Several
// catalog entries can share a name: the Flawed version (…/Beginner/), unreleased Intermediate and
// Expert ones, Conclave's (…/PvPMods/). The plain PvE one wins; "Flawed X" asks for the Beginner
// one. Primed, Umbral, Archon, Galvanized and Amalgam mods have names of their own. Nothing is
// guessed silently: a name that isn't found, or only fits other gear, comes back unmatched with
// suggestions.

import type { CatalogItem } from "../types";
import { arcaneFits, modFits, modRole } from "./gear";
import type { GearKind } from "./types";

/** A name compared without case, accents, apostrophes, punctuation or extra spaces; "&" is "and". */
export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mod types that never go in a gear build (Focus, Railjack, Parazon, set bonuses, rivens). */
const NOT_IN_BUILDS = /^(Focus Way|Plexus Mod|Railjack Mod|Tektolyst Artifact Mod|Parazon Mod|Mod Set Mod|Transmutation Mod|Posture Mod|.*Riven Mod)$/;

export interface NameIndex {
  /** Normalised name → every catalog mod and arcane with it. */
  byName: Map<string, CatalogItem[]>;
  /** The longest name, in words. */
  maxWords: number;
  /** Whether the catalog marks exilus mods (`isUtility`); without it, any mod goes in the exilus slot. */
  utilityKnown: boolean;
}

const indexMemo = new WeakMap<object, NameIndex>();

/** The mods and arcanes in a catalog by normalised name. Kept per catalog map (or array). */
export function nameIndex(catalog: ReadonlyMap<string, CatalogItem> | readonly CatalogItem[]): NameIndex {
  const hit = indexMemo.get(catalog);
  if (hit) return hit;
  const byName = new Map<string, CatalogItem[]>();
  let maxWords = 1;
  let utilityKnown = false;
  const items = Array.isArray(catalog) ? (catalog as readonly CatalogItem[]) : [...(catalog as ReadonlyMap<string, CatalogItem>).values()];
  for (const c of items) {
    if (c.category !== "Mods" && c.category !== "Arcanes") continue;
    if (c.category === "Mods" && NOT_IN_BUILDS.test(c.type ?? "")) continue;
    if (c.isUtility) utilityKnown = true;
    const k = normName(c.name);
    if (!k) continue;
    const list = byName.get(k);
    if (list) list.push(c);
    else byName.set(k, [c]);
    maxWords = Math.max(maxWords, k.split(" ").length);
  }
  const idx = { byName, maxWords, utilityKnown };
  indexMemo.set(catalog, idx);
  return idx;
}

/** Prefixes people shorten or misspell, read as the catalog's word (the match says so: via "alias"). */
const PREFIX_ALIAS: [RegExp, string][] = [
  [/^prime (?!d)/, "primed "],
  [/^umbra (?!l)/, "umbral "],
  [/^galv /, "galvanized "],
  [/^galvanised /, "galvanized "],
];

/** What a name was read as: exactly, through a spelling alias, or as the Flawed version. */
export type MatchVia = "exact" | "alias" | "flawed";

export interface Matched {
  ok: true;
  /** The text as given. */
  text: string;
  path: string;
  name: string;
  item: CatalogItem;
  via: MatchVia;
  /** Other catalog entries with the same name that fit too (the pick is the plain PvE one). */
  alternatives: string[];
  /** Something to tell the user ("fits only some companions", "Conclave only"). */
  note?: string;
}

export interface Unmatched {
  ok: false;
  text: string;
  /**
   * unknown: no such name; wrong-gear: a real mod or arcane for other gear; wrong-slot: a mod that
   * fits but goes in another slot (an aura in a mod slot); no-flawed: no Flawed version.
   */
  reason: "unknown" | "wrong-gear" | "wrong-slot" | "no-flawed";
  /** What it is, when it's a real name for other gear ("a rifle mod") or for another slot ("an aura, not a regular mod"). */
  why?: string;
  /** Close names that would fit, best first (at most three). */
  suggestions: { name: string; path: string }[];
}

export type MatchResult = Matched | Unmatched;

// ---------------------------------------------------------------- which entry a name means

// The one rule for "which catalog entry does this name mean", used wherever a name becomes a path:
// pasted text and the editor (matchName), the editor's list of names, and MyOrbiter's suggestions
// (suggest.ts's modIndex). Lower is likelier the one players mean.

/**
 * A stat line left as the game's raw label, not written out for players ("+120% COMBO COUNT
 * CHANCE"): an entry the game doesn't show. The item data has two "Pressure Point" entries, the
 * plain one (top rank 5) and `WeaponMeleeDamageOnHeavyKillMod` (top rank 10), and this line is the
 * only field that tells the second apart.
 */
const RAW_LABEL = /^[+-]?\d[\d.]*%? [A-Z]{2,}(?: [A-Z]{2,})+$/;

/** How unlikely an entry is to be the one a name means: the plain PvE one 0, the Flawed one when asked. */
export function entryPenalty(c: CatalogItem, flawed = false): number {
  const u = c.uniqueName;
  let p = 0;
  if (/\/PvPMods\//.test(u)) p += 100;
  if (/\/Beginner\//.test(u)) p += flawed ? -200 : 50;
  if (/\/Intermediate\//.test(u)) p += 40;
  if (/\/Expert\//.test(u)) p += 30;
  if (c.excludeFromCodex) p += 5;
  // Placeholder text ("|ARMOUR| Armor") or a raw label: an entry the game hasn't released or doesn't show.
  if ((c.maxStats ?? []).some((x) => /\|[A-Z_]+\|/.test(x) || RAW_LABEL.test(x.trim()))) p += 20;
  // Copies kept for a system of their own (the Sentient "Nemesis" Adaptation, the Tau one).
  if (/\/(Nemesis|Tau)\//.test(u)) p += 3;
  return p;
}

/**
 * Same-name entries, likeliest first: by entryPenalty; between equals, the one the player holds
 * (`held`), then the shortest path, then the path's order.
 */
export function rankEntries<T extends CatalogItem>(list: readonly T[], opts: { flawed?: boolean; held?: (path: string) => number } = {}): T[] {
  const flawed = opts.flawed ?? false;
  const held = opts.held ?? (() => 0);
  return [...list].sort((a, b) => entryPenalty(a, flawed) - entryPenalty(b, flawed) || Number(held(b.uniqueName) > 0) - Number(held(a.uniqueName) > 0) || a.uniqueName.length - b.uniqueName.length || a.uniqueName.localeCompare(b.uniqueName));
}

/** The entry a name means among same-name entries (see rankEntries), or undefined for none. */
export function entryFor<T extends CatalogItem>(list: readonly T[], opts: { flawed?: boolean; held?: (path: string) => number } = {}): T | undefined {
  return rankEntries(list, opts)[0];
}

const penalty = entryPenalty;

function fitOf(c: CatalogItem, item: CatalogItem, kind: GearKind) {
  return c.category === "Arcanes" ? arcaneFits(c, item, kind) : modFits(c, item, kind);
}

/**
 * What a name is looked up for: anything (pasted text, read by what each name is), mods or arcanes,
 * or one of the editor's slots, which takes only its own kind of mod: an aura, a stance, a regular
 * mod, or, in the exilus slot, a regular mod the catalog marks for it (any, where it marks none).
 */
export type MatchWant = "any" | "mod" | "arcane" | "aura" | "stance" | "exilus";

const wantsKind = (want: MatchWant, c: CatalogItem) => want === "any" || (want === "arcane" ? c.category === "Arcanes" : c.category === "Mods");

/** Whether a mod goes in the slot `want` names: null when it does, else what it is. */
function slotMismatch(want: MatchWant, c: CatalogItem, idx: NameIndex): string | null {
  if (want === "any" || want === "arcane") return null;
  const role = modRole(c);
  const what = role === "aura" ? "an aura" : role === "stance" ? "a stance" : "a regular mod";
  if (want === "aura") return role === "aura" ? null : `${what}, not an aura`;
  if (want === "stance") return role === "stance" ? null : `${what}, not a stance`;
  if (role !== "mod") return `${what}: it goes in the ${role} slot`;
  if (want === "exilus" && idx.utilityKnown && !c.isUtility) return "not an exilus mod";
  return null;
}

/** Whether a mod already in the editor's slot `want` (a pasted or saved build) is that slot's kind. */
export const fitsSlot = (want: MatchWant, c: CatalogItem, idx: NameIndex): boolean => slotMismatch(want, c, idx) === null;

/**
 * One name against the catalog, for an item. `want` limits it to mods or arcanes (the editor's
 * slot); by default either. `held` (copies you hold of a path) breaks ties between same-name
 * entries in favour of the one you have.
 */
export function matchName(text: string, idx: NameIndex, item: CatalogItem, kind: GearKind, want: MatchWant = "any", held: (path: string) => number = () => 0): MatchResult {
  let key = normName(text);
  let via: MatchVia = "exact";
  let flawed = false;
  if (key.startsWith("flawed ")) {
    key = key.slice(7);
    flawed = true;
    via = "flawed";
  }
  const kinds = (c: CatalogItem) => wantsKind(want, c);
  let found = (idx.byName.get(key) ?? []).filter(kinds);
  if (!found.length) {
    for (const [re, to] of PREFIX_ALIAS) {
      if (!re.test(key)) continue;
      const k = key.replace(re, to);
      const f = (idx.byName.get(k) ?? []).filter(kinds);
      if (f.length) {
        key = k;
        found = f;
        if (!flawed) via = "alias";
        break;
      }
    }
  }
  // Arcanes are often written without the word ("Energize" for Arcane Energize).
  if (!found.length && (want === "any" || want === "arcane")) {
    const f = (idx.byName.get(`arcane ${key}`) ?? []).filter((c) => c.category === "Arcanes");
    if (f.length) {
      key = `arcane ${key}`;
      found = f;
      if (!flawed) via = "alias";
    }
  }
  if (!found.length) return { ok: false, text, reason: "unknown", suggestions: suggest(key, idx, item, kind, want) };
  if (flawed && !found.some((c) => /\/Beginner\//.test(c.uniqueName))) return { ok: false, text, reason: "no-flawed", suggestions: [] };
  const fitting = found.map((c) => ({ c, fit: fitOf(c, item, kind) })).filter((x) => x.fit.fits !== false);
  if (!fitting.length) {
    const why = fitOf(found[0], item, kind).why;
    return { ok: false, text, reason: "wrong-gear", why, suggestions: suggest(key, idx, item, kind, want) };
  }
  // A mod that fits the item but not this slot (the editor's slots; pasted text reads every name).
  const inSlot = fitting.filter((x) => !slotMismatch(want, x.c, idx));
  if (!inSlot.length) {
    const why = slotMismatch(want, fitting[0].c, idx)!;
    return { ok: false, text, reason: "wrong-slot", why, suggestions: suggest(key, idx, item, kind, want) };
  }
  fitting.splice(0, fitting.length, ...inSlot);
  // The plain PvE one; between equals, the one you hold, then the shortest path (rankEntries).
  const order = rankEntries(fitting.map((x) => x.c), { flawed, held });
  fitting.sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
  const pick = fitting[0];
  const best = penalty(pick.c, flawed);
  const notes: string[] = [];
  if (pick.fit.fits === "maybe") notes.push(pick.c.type === "Stance Mod" ? "a stance: check it's for this weapon's class" : "MyOrbiter can't tell whether it fits this one");
  if (/\/PvPMods\//.test(pick.c.uniqueName)) notes.push("a Conclave mod");
  return {
    ok: true,
    text,
    path: pick.c.uniqueName,
    name: flawed ? `Flawed ${pick.c.name}` : pick.c.name,
    item: pick.c,
    via,
    // Same-name entries as plausible as the pick (none of the Flawed/Expert/Conclave ones).
    alternatives: fitting.slice(1).filter((x) => penalty(x.c, flawed) === best).map((x) => x.c.uniqueName),
    ...(notes.length ? { note: notes.join("; ") } : {}),
  };
}

/** A slot the editor offers names for. */
export type NameSlot = "aura" | "stance" | "mod" | "exilus" | "arcane";

/**
 * What each of the editor's slots offers for an item: the names that fit it, each read as the entry
 * the name means (entryFor), sorted. `arcanes`: whether the item takes arcanes at all.
 */
export function slotNames(idx: NameIndex, item: CatalogItem, kind: GearKind, arcanes: boolean): Record<NameSlot, string[]> {
  const out: Record<NameSlot, Set<string>> = { aura: new Set(), stance: new Set(), mod: new Set(), exilus: new Set(), arcane: new Set() };
  for (const list of idx.byName.values()) {
    const c = entryFor(list)!;
    if (c.category === "Arcanes") {
      if (arcanes && arcaneFits(c, item, kind).fits !== false) out.arcane.add(c.name);
      continue;
    }
    if (modFits(c, item, kind).fits === false) continue;
    const role = modRole(c);
    if (role === "aura") out.aura.add(c.name);
    else if (role === "stance") out.stance.add(c.name);
    else {
      out.mod.add(c.name);
      if (!slotMismatch("exilus", c, idx)) out.exilus.add(c.name);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()])) as Record<NameSlot, string[]>;
}

/** Edit distance, stopping early past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Names close to `key` that fit the item: a typo away, or sharing its words. */
export function suggest(key: string, idx: NameIndex, item: CatalogItem, kind: GearKind, want: MatchWant = "any"): { name: string; path: string }[] {
  if (!key) return [];
  const max = key.length < 6 ? 1 : key.length < 12 ? 2 : 3;
  const words = new Set(key.split(" ").filter((w) => w.length > 2 && w !== "the" && w !== "and" && w !== "mod" && w !== "arcane"));
  const scored: { name: string; path: string; score: number }[] = [];
  for (const [k, list] of idx.byName) {
    const fitting = list.filter((c) => wantsKind(want, c) && !slotMismatch(want, c, idx) && fitOf(c, item, kind).fits !== false && !/\/PvPMods\//.test(c.uniqueName));
    if (!fitting.length) continue;
    const d = distance(key, k, max);
    const shared = k.split(" ").filter((w) => words.has(w)).length;
    if (d > max && !shared) continue;
    const c = entryFor(fitting)!;
    scored.push({ name: c.name, path: c.uniqueName, score: d <= max ? d : 10 - shared });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(({ name, path }) => ({ name, path }));
}
