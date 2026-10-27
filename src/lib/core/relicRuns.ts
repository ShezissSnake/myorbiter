// Relic runs: every relic reward screen you've had, which card you took, and what that came to
// per hour of play.
//
// Screens come from two places. Live, from the cards a patched TennoScope reads off the screen
// (with your own relic's reward from EE.log, and what you held of each card's item right then).
// And from TennoScope's own log, which keeps every screen it read: that fills in history from
// before orbiter recorded them, and anything it missed while closed.
//
// Which card you took isn't written anywhere. It shows up in your inventory: once the mission
// ends, the next inventory read has one more of it than you held when the screen opened.

/** One relic reward screen. */
export interface RelicRun {
  /** Unix ms TennoScope read the screen. */
  at: number;
  /** The cards as read, in screen order; empty when the screen couldn't be read. */
  cards: string[];
  /** The squad's relics, as projection paths (the refinement is the last word). */
  relics: string[];
  mission?: string | null;
  /** The reward your own relic gave, which the game log names as the screen opens. */
  own?: string | null;
  /** The card you took, once an inventory read showed it arriving. */
  took?: string | null;
  /** What you held of each card's item when the screen opened, and the inventory read that's from (Unix ms). */
  before?: Record<string, number>;
  baseAt?: number;
  /** From TennoScope's log rather than seen live: which card you took can't be known. */
  imported?: boolean;
}

/** What TennoScope's log gives for a screen. */
export interface LoggedScreen {
  at: number;
  cards: string[];
  relics: string[];
}

/** Readings closer than this are the same screen (a second read while it stayed up). */
export const SAME_SCREEN_MS = 90_000;
/** A gap longer than this between screens ends a session. */
export const SESSION_GAP_MS = 15 * 60_000;
/** Kept: about a year of steady fissure runs. */
export const MAX_RUNS = 20_000;
/** How long after a screen an inventory read can still show which card you took. */
const PICK_WINDOW_MS = 2 * 86_400_000;

const sameScreen = (a: number, b: number) => Math.abs(a - b) < SAME_SCREEN_MS;

/** Index of the run within SAME_SCREEN_MS of `at`, searching from the newest (runs are oldest first). */
function near(runs: RelicRun[], at: number): number {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (sameScreen(runs[i].at, at)) return i;
    if (runs[i].at < at - SAME_SCREEN_MS) break;
  }
  return -1;
}

/**
 * A screen seen live. Updates the run already recorded for it (the cards are read again once
 * their prices are in, and the log names your reward a moment after the screen opens), or adds
 * it. Returns the new list, or null when nothing changed.
 */
export function recordScreen(runs: RelicRun[], s: { at: number; cards: string[]; relics: string[]; mission?: string | null; own?: string | null; before?: Record<string, number>; baseAt?: number }): RelicRun[] | null {
  const i = near(runs, s.at);
  if (i < 0) {
    const run: RelicRun = { at: s.at, cards: s.cards, relics: s.relics, mission: s.mission ?? null, own: s.own ?? null, before: s.before, baseAt: s.baseAt };
    const next = [...runs];
    // Almost always the newest; a clock change could put it anywhere.
    let j = next.length;
    while (j > 0 && next[j - 1].at > s.at) j--;
    next.splice(j, 0, run);
    return next.length > MAX_RUNS ? next.slice(next.length - MAX_RUNS) : next;
  }
  const old = runs[i];
  const run: RelicRun = {
    ...old,
    cards: s.cards.length ? s.cards : old.cards,
    relics: s.relics.length ? s.relics : old.relics,
    mission: s.mission ?? old.mission ?? null,
    own: s.own ?? old.own ?? null,
    // What you held when the screen first opened: a later reading could come after the reward landed.
    before: old.before ?? s.before,
    baseAt: old.baseAt ?? s.baseAt,
    imported: false,
  };
  if (JSON.stringify(run) === JSON.stringify(old)) return null;
  const next = [...runs];
  next[i] = run;
  return next;
}

/**
 * Screens from TennoScope's log that aren't recorded yet (by time: within SAME_SCREEN_MS of a
 * recorded one is that one). Returns the new list, or null when there was nothing to add.
 */
export function mergeLogged(runs: RelicRun[], logged: LoggedScreen[]): RelicRun[] | null {
  const add: RelicRun[] = [];
  const sorted = [...logged].sort((a, b) => a.at - b.at);
  let j = 0;
  for (const s of sorted) {
    // Runs are sorted: move to the first one that could be this screen.
    while (j < runs.length && runs[j].at <= s.at - SAME_SCREEN_MS) j++;
    if (j < runs.length && sameScreen(runs[j].at, s.at)) continue;
    if (add.length && sameScreen(add[add.length - 1].at, s.at)) continue;
    add.push({ at: s.at, cards: s.cards, relics: s.relics, imported: true });
  }
  if (!add.length) return null;
  const next = [...runs, ...add].sort((a, b) => a.at - b.at);
  return next.length > MAX_RUNS ? next.slice(next.length - MAX_RUNS) : next;
}

/**
 * Which card you took, from an inventory read made after the screen: the card whose item you
 * now hold more of than when the screen opened. Screens that started from the same count (the
 * rounds of one mission) share what arrived out oldest first, each claiming one copy. When two
 * cards both arrived, your own relic's reward is the one (you'd have it without choosing). Returns the
 * new list, or null when nothing was settled.
 */
export function resolvePicks(runs: RelicRun[], held: (name: string) => number, readAt: number, canon: (name: string) => string = (n) => n): RelicRun[] | null {
  const claimed = new Map<string, number>();
  let next: RelicRun[] | null = null;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.imported || !r.before || r.baseAt == null || !r.cards.length || readAt - r.at > PICK_WINDOW_MS) continue;
    // Claims are shared by screens that started from the same count of an item (the rounds of
    // one mission), whichever inventory read that count came from. Keys are the names `before`
    // holds: the canonical ones.
    const key = (n: string) => `${n}|${r.before![n] ?? 0}`;
    if (r.took) {
      // Settled by an earlier read: its copy is spoken for.
      const t = canon(r.took);
      claimed.set(key(t), (claimed.get(key(t)) ?? 0) + 1);
      continue;
    }
    if (r.baseAt >= readAt || r.at >= readAt) continue;
    const names = [...new Set(r.cards.map(canon))];
    const arrived = names.filter((n) => held(n) - (r.before![n] ?? 0) - (claimed.get(key(n)) ?? 0) > 0);
    const own = r.own ? canon(r.own) : null;
    const took = arrived.length === 1 ? arrived[0] : own && arrived.includes(own) ? own : null;
    if (!took) continue;
    claimed.set(key(took), (claimed.get(key(took)) ?? 0) + 1);
    next ??= [...runs];
    next[i] = { ...r, took };
  }
  return next;
}

// ---------------------------------------------------------------- what it came to

/** How a screen's value is known. */
export type Basis = "took" | "own" | "average" | "unread";

export interface ScoredRun {
  run: RelicRun;
  /** Each card's price (0 for what doesn't trade, like a Forma blueprint), in screen order. */
  values: number[];
  best: number;
  /** What the screen counts for: the card you took, else your own relic's reward, else the average card. */
  value: number;
  basis: Basis;
  /** The card that value is, when one is (took or own). */
  card: string | null;
}

export interface RunSession {
  start: number;
  end: number;
  runs: ScoredRun[];
  minutes: number;
  /** Platinum the screens came to (a screen that couldn't be read counts as the average one). */
  plat: number;
  /** What taking the best card every time would have come to. */
  best: number;
  perHour: number;
  /** Screens whose card you took isn't known, so the average card stands in. */
  estimated: number;
  unread: number;
}

export interface RunSummary {
  sessions: RunSession[];
  screens: number;
  hours: number;
  plat: number;
  best: number;
  perHour: number;
  bestPerHour: number;
  perScreen: number;
  screensPerHour: number;
  /** Typical time between screens, which a session's first screen is counted as (ms). */
  typical: number;
  estimated: number;
  unread: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A screen's worth: `price` gives a card's platinum (null for what doesn't trade). */
export function scoreRun(run: RelicRun, price: (name: string) => number | null): ScoredRun {
  const values = run.cards.map((c) => price(c) ?? 0);
  const best = values.length ? Math.max(...values) : 0;
  if (!values.length) return { run, values, best, value: 0, basis: "unread", card: null };
  if (run.took) return { run, values, best, value: price(run.took) ?? 0, basis: "took", card: run.took };
  if (run.own) return { run, values, best, value: price(run.own) ?? 0, basis: "own", card: run.own };
  return { run, values, best, value: mean(values), basis: "average", card: null };
}

/**
 * Screens grouped into play sessions (a gap over SESSION_GAP_MS ends one), newest first, with
 * what each came to and per hour. A session's time runs from its first screen to its last, plus
 * one typical gap for the round before the first screen.
 */
export function summarize(runs: RelicRun[], price: (name: string) => number | null): RunSummary {
  const scored = [...runs].sort((a, b) => a.at - b.at).map((r) => scoreRun(r, price));
  const groups: ScoredRun[][] = [];
  for (const s of scored) {
    const g = groups[groups.length - 1];
    if (g && s.run.at - g[g.length - 1].run.at <= SESSION_GAP_MS) g.push(s);
    else groups.push([s]);
  }
  const gaps = groups.flatMap((g) => g.slice(1).map((s, i) => s.run.at - g[i].run.at));
  // A screen every 1 to 8 minutes, whatever the data says: a lone screen is still a round played.
  const typical = Math.min(8 * 60_000, Math.max(60_000, median(gaps) || 4 * 60_000));
  const read = scored.filter((s) => s.basis !== "unread");
  const fillValue = mean(read.map((s) => s.value));
  const fillBest = mean(read.map((s) => s.best));
  const sessions = groups.map((g): RunSession => {
    const ms = g[g.length - 1].run.at - g[0].run.at + typical;
    const unread = g.filter((s) => s.basis === "unread").length;
    const plat = g.reduce((n, s) => n + (s.basis === "unread" ? fillValue : s.value), 0);
    const best = g.reduce((n, s) => n + (s.basis === "unread" ? fillBest : s.best), 0);
    return { start: g[0].run.at, end: g[g.length - 1].run.at, runs: g, minutes: ms / 60_000, plat, best, perHour: plat / (ms / 3_600_000), estimated: g.filter((s) => s.basis === "average").length, unread };
  });
  const hours = sessions.reduce((n, s) => n + s.minutes, 0) / 60;
  const plat = sessions.reduce((n, s) => n + s.plat, 0);
  const best = sessions.reduce((n, s) => n + s.best, 0);
  return {
    sessions: sessions.reverse(),
    screens: scored.length,
    hours,
    plat,
    best,
    perHour: hours ? plat / hours : 0,
    bestPerHour: hours ? best / hours : 0,
    perScreen: scored.length ? plat / scored.length : 0,
    screensPerHour: hours ? scored.length / hours : 0,
    typical,
    estimated: sessions.reduce((n, s) => n + s.estimated, 0),
    unread: sessions.reduce((n, s) => n + s.unread, 0),
  };
}

/** "T3VoidProjectionGyrePrimeCPlatinum" → "Radiant", the refinement a projection path carries. */
export function refinementOf(path: string): "Intact" | "Exceptional" | "Flawless" | "Radiant" | null {
  const m = /(Bronze|Silver|Gold|Platinum)$/.exec(path);
  return m ? ({ Bronze: "Intact", Silver: "Exceptional", Gold: "Flawless", Platinum: "Radiant" } as const)[m[1] as "Bronze"] : null;
}
