// The game's clocks: the open worlds' cycles, the daily and weekly resets, and fissure alerts
// you set up yourself (an era, a mission type, a planet, Steel Path or not).
import type { Fissure, Live, WorldCycle } from "./types";

export const PLACE: Record<WorldCycle["key"], string> = {
  earth: "Earth",
  cetus: "Plains of Eidolon",
  vallis: "Orb Vallis",
  cambion: "Cambion Drift",
  zariman: "Zariman",
};

/** The next state each cycle turns to: what the timer counts down to. */
const NEXT: Record<string, string> = { day: "night", night: "day", warm: "cold", cold: "warm", fass: "vome", vome: "fass", corpus: "grineer", grineer: "corpus" };

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

/** How long each state lasts, in minutes, so a clock rolls on between worldstate refreshes (Earth: 4 h each; Plains: 100 min day, 50 night). */
const LENGTH: Record<string, number> = { warm: 400 / 60, cold: 20, fass: 100, vome: 50, corpus: 150, grineer: 150 };
const length = (key: WorldCycle["key"], state: string) =>
  key === "earth" ? 240 : key === "cetus" ? (state === "day" ? 100 : 50) : (LENGTH[state] ?? 0);

/** Each open world's state now: rolled forward past an expiry the worldstate hasn't caught up on. */
export function cycleTimers(live: Live, now = Date.now()): Timer[] {
  const out: Timer[] = [];
  for (const c of live.cycles ?? []) {
    let state = c.state;
    let ends = Date.parse(c.expiry);
    for (let i = 0; ends <= now && i < 50; i++) {
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
    { key: "daily", label: "Daily reset", state: "Standing caps, daily Nightwave, Steel Path", next: null, ends: nextDailyUtc(now) },
    { key: "weekly", label: "Weekly reset", state: "Archon Hunt, Circuit, Nightwave weeklies, traders", next: null, ends: weekly },
  ];
  if (live.sortie?.expiry && Date.parse(live.sortie.expiry) > now) out.push({ key: "sortie", label: "Sortie", state: live.sortie.boss, next: null, ends: live.sortie.expiry });
  return out;
}

// ---------------------------------------------------------------- fissure alerts

export const TIERS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Omnia"] as const;

export interface FissureRule {
  id: string;
  /** "any" or an era. */
  tier: string;
  /** "any" or a mission type ("Disruption"). */
  mission: string;
  /** "any" or a planet ("Jupiter"), matched against the node's "(Planet)". */
  planet: string;
  /** "any": normal or Steel Path, not Void Storms. */
  mode: "any" | "normal" | "steel" | "storm";
}

export const planetOf = (node: string) => node.match(/\(([^)]+)\)\s*$/)?.[1] ?? "";

export function ruleMatches(r: FissureRule, f: Fissure): boolean {
  if (r.tier !== "any" && f.tier !== r.tier) return false;
  if (r.mission !== "any" && f.missionType !== r.mission) return false;
  if (r.planet !== "any" && planetOf(f.node) !== r.planet) return false;
  // "any" is normal or Steel Path; Void Storms (Railjack) only when asked for.
  if (r.mode !== "storm" && f.isStorm) return false;
  if (r.mode === "normal" && f.isHard) return false;
  if (r.mode === "steel" && !f.isHard) return false;
  if (r.mode === "storm" && !f.isStorm) return false;
  return true;
}

/** An alert as words: "Steel Path Axi fissure", "Lith Capture on Sedna", "Any fissure". */
export function ruleLabel(r: FissureRule): string {
  const what = [r.mode === "steel" ? "Steel Path" : r.mode === "storm" ? "Void Storm" : r.mode === "normal" ? "Normal" : "", r.tier === "any" ? "" : r.tier, r.mission === "any" ? "" : r.mission].filter(Boolean).join(" ");
  const kind = !what ? "Any fissure" : r.mission === "any" ? `${what} fissure` : what;
  return r.planet === "any" ? kind : `${kind} on ${r.planet}`;
}

/** Two alerts for the same fissures. */
export const sameRule = (a: Omit<FissureRule, "id">, b: Omit<FissureRule, "id">) => a.tier === b.tier && a.mission === b.mission && a.planet === b.planet && a.mode === b.mode;

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
  const today = Math.floor(now / 86_400_000) * 86_400_000;
  const behind = Math.round((today - day) / 86_400_000) - 1;
  return behind >= 1 ? behind : null;
}
