// The game's clocks: the open worlds' cycles, the daily and weekly resets, and fissure alerts
// you set up yourself (an era, a mission type, a planet, Steel Path or not).
import type { Fissure, Live, WorldCycle } from "./types";

export const PLACE: Record<WorldCycle["key"], string> = {
  earth: "Earth",
  cetus: "Plains of Eidolon",
  vallis: "Orb Vallis",
  cambion: "Cambion Drift",
  zariman: "Zariman",
  duviri: "Duviri",
};

/** The next state each cycle turns to: what the timer counts down to. */
const NEXT: Record<string, string> = { day: "night", night: "day", warm: "cold", cold: "warm", fass: "vome", vome: "fass", corpus: "grineer", grineer: "corpus", joy: "anger", anger: "envy", envy: "sorrow", sorrow: "fear", fear: "joy" };

export interface Timer {
  key: string;
  label: string;
  state: string;
  next: string | null;
  ends: string;
}

export function nextDailyUtc(now = Date.now()): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

/** How long each state lasts, in minutes, so a clock rolls on between worldstate refreshes (Earth: 4 h each; Plains: 100 min day, 50 night; Duviri: 2 h each mood). */
const LENGTH: Record<string, number> = { warm: 400 / 60, cold: 20, fass: 100, vome: 50, corpus: 150, grineer: 150, joy: 120, anger: 120, envy: 120, sorrow: 120, fear: 120 };
const length = (key: WorldCycle["key"], state: string) =>
  key === "earth" ? 240 : key === "cetus" ? (state === "day" ? 100 : 50) : (LENGTH[state] ?? 0);

/** Each open world's state now: rolled forward past an expiry the worldstate hasn't caught up on. */
export function cycleTimers(live: Live, now = Date.now()): Timer[] {
  const out: Timer[] = [];
  for (const c of live.cycles ?? []) {
    let state = c.state;
    let ends = Date.parse(c.expiry);
    // A reading kept from yesterday: Orb Vallis turns over about 110 times a day.
    for (let i = 0; ends <= now && i < 400; i++) {
      const next = NEXT[state];
      const mins = next ? length(c.key, next) : 0;
      if (!next || !mins) break;
      state = next;
      ends += mins * 60_000;
    }
    if (ends <= now) continue;
    out.push({ key: c.key, label: PLACE[c.key], state, next: NEXT[state] ?? null, ends: new Date(ends).toISOString() });
  }
  return out;
}

/** Daily reset (standing caps, Steel Path alerts), the weekly reset, and the sortie. */
export function resetTimers(live: Live, now = Date.now()): Timer[] {
  const d = new Date(now);
  const days = (8 - d.getUTCDay()) % 7 || 7;
  const weekly = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)).toISOString();
  const out: Timer[] = [
    // What resets when, per the wiki's Reset page.
    { key: "daily", label: "Daily reset", state: "Standing caps, the trade limit, Focus cap, the daily Nightwave act, Steel Path Incursions, Daily Tribute", next: null, ends: nextDailyUtc(now) },
    { key: "weekly", label: "Weekly reset", state: "Archon Hunt, the Circuit's rewards, Nightwave weeklies, Deep and Temporal Archimedea, the Descendia, a new 1999 Calendar season, Break Narmer, Maroo's Ayatan hunt; Teshin's offer, Acrithis, Palladino, Bird 3's Archon Shard and Nightwave Cred offerings", next: null, ends: weekly },
  ];
  if (live.sortie?.expiry && Date.parse(live.sortie.expiry) > now) out.push({ key: "sortie", label: "Sortie", state: live.sortie.boss, next: null, ends: live.sortie.expiry });
  return out;
}

// ---------------------------------------------------------------- fissure alerts

export const TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"] as const;

export type FissureKind = "normal" | "steel" | "storm";
export const KIND_LABEL: Record<FissureKind, string> = { normal: "Normal", steel: "Steel Path", storm: "Void Storm" };
const KIND_ORDER: FissureKind[] = ["normal", "steel", "storm"];

/**
 * A fissure alert: each list holds the choices it accepts, any one of them; an empty list is any.
 * No kinds ticked is normal or Steel Path: Void Storms (Railjack) only when ticked.
 */
export interface FissureRule {
  id: string;
  kinds: FissureKind[];
  /** Eras ("Axi"). */
  tiers: string[];
  /** Mission types ("Mobile Defense"). */
  missions: string[];
  /** Planets ("Jupiter"), matched against the node's "(Planet)". */
  planets: string[];
}

export const planetOf = (node: string) => node.match(/\(([^)]+)\)\s*$/)?.[1] ?? "";

const kindOf = (f: Fissure): FissureKind => (f.isStorm ? "storm" : f.isHard ? "steel" : "normal");

export function ruleMatches(r: FissureRule, f: Fissure): boolean {
  const kind = kindOf(f);
  if (r.kinds.length ? !r.kinds.includes(kind) : kind === "storm") return false;
  if (r.tiers.length && !r.tiers.includes(f.tier)) return false;
  if (r.missions.length && !r.missions.includes(f.missionType)) return false;
  if (r.planets.length && !r.planets.includes(planetOf(f.node))) return false;
  return true;
}

/** "Axi or Neo", "Lith, Meso or Neo". */
const either = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** An alert as words: "Steel Path Axi fissure", "Lith Defense or Mobile Defense on Sedna", "Any fissure". */
export function ruleLabel(r: FissureRule): string {
  const kinds = r.kinds.length === 3 ? "" : either(KIND_ORDER.filter((k) => r.kinds.includes(k)).map((k) => KIND_LABEL[k]));
  const what = [kinds, either(r.tiers), either(r.missions)].filter(Boolean).join(" ");
  const kind = r.kinds.length === 3 && !what ? "Any fissure or Void Storm" : !what ? "Any fissure" : r.missions.length ? what : `${what} fissure`;
  return r.planets.length ? `${kind} on ${either(r.planets)}` : kind;
}

const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
/** Two alerts for the same fissures. */
export const sameRule = (a: Omit<FissureRule, "id">, b: Omit<FissureRule, "id">) => same(a.kinds, b.kinds) && same(a.tiers, b.tiers) && same(a.missions, b.missions) && same(a.planets, b.planets);

/**
 * An alert as it's kept: copies of the lists, kinds in their usual order, and Normal plus Steel
 * Path written as nothing ticked (the same fissures).
 */
export function tidyRule<R extends Omit<FissureRule, "id">>(r: R): Omit<FissureRule, "id"> {
  const kinds = KIND_ORDER.filter((k) => r.kinds.includes(k));
  return { kinds: kinds.length === 2 && !kinds.includes("storm") ? [] : kinds, tiers: [...r.tiers], missions: [...r.missions], planets: [...r.planets] };
}

/** A saved alert as this version keeps it; the first version's (one choice each, "any") carried over. Null when it isn't one. */
export function normalizeRule(raw: unknown): FissureRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown, one: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof one === "string" && one !== "any" && one ? [one] : [];
  const kinds = list(r.kinds, r.mode).filter((k): k is FissureKind => k === "normal" || k === "steel" || k === "storm");
  return { id: typeof r.id === "string" ? r.id : `${Date.now()}`, ...tidyRule({ kinds, tiers: list(r.tiers, r.tier), missions: list(r.missions, r.mission), planets: list(r.planets, r.planet) }) };
}

/** Open fissures that match any of your rules, with the first rule each matched. */
export function matchedFissures(rules: FissureRule[], fissures: Fissure[] | null, now = Date.now()): { fissure: Fissure; rule: FissureRule }[] {
  const out: { fissure: Fissure; rule: FissureRule }[] = [];
  for (const f of fissures ?? []) {
    if (Date.parse(f.expiry) <= now) continue;
    const rule = rules.find((r) => ruleMatches(r, f));
    if (rule) out.push({ fissure: f, rule });
  }
  return out;
}

/** When something kept was read, for a note beside it: "today 13:52", "yesterday 21:05", "3 days ago". */
export function checkedWhen(at: number, now: number): string {
  const day = (ms: number) => new Date(ms).toDateString();
  const time = new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (day(at) === day(now)) return `today ${time}`;
  if (day(at) === day(now - 86_400_000)) return `yesterday ${time}`;
  return `${Math.max(2, Math.round((now - at) / 86_400_000))} days ago`;
}

/**
 * How many days behind TennoScope's item prices are, when that's a day or more: null while they're
 * current. warframe.market publishes each day's figures the next day, so yesterday's (UTC) are the
 * newest there are; `dumpDate` is the day they cover ("2026-10-28").
 */
export function pricesBehind(dumpDate: string | null | undefined, now = Date.now()): number | null {
  if (!dumpDate || !/^\d{4}-\d{2}-\d{2}$/.test(dumpDate)) return null;
  const day = Date.parse(`${dumpDate}T00:00:00Z`);
  if (!Number.isFinite(day)) return null;
  // A day's figures come out early the next day (UTC): counted from 06:00, so the hours before
  // they're published don't read as a day behind.
  const today = Math.floor((now - 6 * 3_600_000) / 86_400_000) * 86_400_000;
  const behind = Math.round((today - day) / 86_400_000) - 1;
  return behind >= 1 ? behind : null;
}
