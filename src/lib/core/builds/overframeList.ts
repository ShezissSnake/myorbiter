// Overframe's popular builds, as a bundled list: what Overframe's build list pages show (title,
// item, author, votes, Forma count, game update, dates, link), collected by hand in a browser and
// shipped with MyOrbiter, dated. Never a build page's contents (mods, arcanes, shards).
//
// Permission: Overframe's team, by email (3 Nov 2026), allows taking its lists of
// popular builds and showing that information, not the build pages themselves, and suggested a
// browser-collected copy kept in MyOrbiter's own data. So MyOrbiter never contacts Overframe: the file
// is public/data/overframe/popular.json (how to refresh it: README.md beside it), loaded at run
// time from the app's own assets. Every entry links to its build on overframe.gg, so the authors
// get the visits.
//
// The rule: at most 5 builds per item, the most voted among those updated in the
// last two years. Fixed, not the age setting: Overframe's list has no "older hidden: show".

import { normName } from "./match";
import { cleanLine } from "../untrusted";

export const OVERFRAME_SITE = "Overframe";
export const OVERFRAME_ORIGIN = "https://overframe.gg";
/** Where the lists were read. */
export const OVERFRAME_SOURCE = "https://overframe.gg/builds/";
export const OVERFRAME_PERMISSION = "Overframe team, by email, 3 Nov 2026: lists only";
/** Where the app finds the file: its own assets (public/), never the web. */
export const OVERFRAME_FILE = "/data/overframe/popular.json";
/** Overframe's list pages read (its Companions tab is "sentinels"). */
export const OVERFRAME_CATEGORIES = ["warframes", "primary-weapons", "secondary-weapons", "melee-weapons", "archwing", "sentinels"] as const;
export type OverframeCategory = (typeof OVERFRAME_CATEGORIES)[number];
/** This many per item at most… */
export const OVERFRAME_SHOWN = 5;
/** …updated within this many days. */
export const OVERFRAME_MAX_AGE_DAYS = 730;

/** One build as Overframe's list shows it. */
export interface OverframeListed {
  id: number;
  /** The build's path on overframe.gg ("/build/374539/revenant-prime/…/"). */
  path: string;
  title: string;
  /** The item's name, as the list shows it. */
  item: string;
  /** MyOrbiter's catalog path for the item, when its name matched one. */
  uniqueName?: string;
  author: string;
  /** Votes. */
  score: number;
  formas: number;
  /** "YYYY-MM-DD". */
  created: string;
  updated: string;
  /** The update chip, as the list shows it ("Update 44.0"). */
  patch: string;
  category: OverframeCategory;
}

export interface OverframeFile {
  /** When the lists were read (ISO). */
  collected: string;
  source: string;
  permission: string;
  categories?: string[];
  builds: OverframeListed[];
}

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The file is third-party text shipped with the app: every string is cleaned of hidden characters
// and capped (core/untrusted.ts), and every link must be a build page on overframe.gg.
const str = (v: unknown, max: number): string | null => cleanLine(v, max);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
/** A catalog path, as the game writes them. */
const UNIQUE = /^\/Lotus(\/[A-Za-z0-9_]+){1,12}$/;

/**
 * A path on overframe.gg that is a build's page (the only links MyOrbiter makes to it):
 * `/build/<id>/` and slug segments, nothing that could leave the page once the browser reads it
 * (no empty, `.` or `..` segments, backslashes, `%`, query, fragment, spaces or hidden characters), and the
 * URL it makes stays on overframe.gg under /build/.
 */
export function isBuildPath(p: string): boolean {
  if (typeof p !== "string" || p.length > 400 || !/^\/build\/\d{1,10}\/[^?#%\\\s]*$/.test(p) || cleanLine(p, 400) !== p) return false;
  if (p.includes("//") || p.split("/").some((seg) => seg === "." || seg === "..")) return false;
  try {
    const u = new URL(overframeBuildUrl(p));
    return u.origin === OVERFRAME_ORIGIN && u.pathname.startsWith("/build/") && !u.search && !u.hash;
  } catch {
    return false;
  }
}
/** The build's page on overframe.gg, opened in the browser. */
export const overframeBuildUrl = (path: string): string => `${OVERFRAME_ORIGIN}${path}`;

/** The file, checked: entries without a build path, title or valid dates are dropped. Null when it isn't one. */
export function parseOverframeFile(raw: unknown): OverframeFile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const collected = str(o.collected, 40);
  if (!collected || !Number.isFinite(Date.parse(collected)) || !Array.isArray(o.builds)) return null;
  const cats = new Set<string>(OVERFRAME_CATEGORIES);
  const builds: OverframeListed[] = [];
  const seen = new Set<number>();
  for (const v of o.builds) {
    if (!v || typeof v !== "object") continue;
    const b = v as Record<string, unknown>;
    const id = count(b.id);
    const path = typeof b.path === "string" ? b.path : null;
    const title = str(b.title, 200);
    const item = str(b.item, 80);
    const created = str(b.created, 10);
    const updated = str(b.updated, 10);
    const category = str(b.category, 30);
    if (id == null || seen.has(id) || !path || !isBuildPath(path) || !title || !item || !created || !DATE.test(created) || !updated || !DATE.test(updated) || !category || !cats.has(category)) continue;
    seen.add(id);
    const unique = typeof b.uniqueName === "string" && UNIQUE.test(b.uniqueName) ? b.uniqueName : null;
    builds.push({
      id,
      path,
      title,
      item,
      ...(unique ? { uniqueName: unique } : {}),
      author: str(b.author, 80) ?? "",
      score: count(b.score) ?? 0,
      formas: count(b.formas) ?? 0,
      created,
      updated,
      patch: str(b.patch, 30) ?? "",
      category: category as OverframeCategory,
    });
  }
  return { collected, source: str(o.source, 200) ?? OVERFRAME_SOURCE, permission: str(o.permission, 200) ?? OVERFRAME_PERMISSION, builds };
}

/** When a listed build was last updated, as a time. */
export const updatedAt = (b: Pick<OverframeListed, "updated">): number => Date.parse(`${b.updated}T00:00:00Z`);

/** Whether it was updated within `maxAgeDays` (0: no limit), counting whole days. */
export function overframeWithinAge(b: Pick<OverframeListed, "updated">, maxAgeDays: number, now: number): boolean {
  if (!(maxAgeDays > 0)) return true;
  const at = updatedAt(b);
  return Number.isFinite(at) && now - at <= (maxAgeDays + 1) * DAY;
}

/** Fewest votes for a build to show as popular. */
export const OVERFRAME_MIN_VOTES = 10;

export interface OverframeOptions {
  /** Default 730 (two years); 0: no limit. */
  maxAgeDays?: number;
  /** Default 5. */
  limit?: number;
  /** Fewest votes to count as popular. Default 10. */
  minVotes?: number;
  /** The item's name: also takes the builds whose item matched no catalog path, by name. */
  name?: string;
  now?: number;
}

export interface OverframeResult {
  /** At most `limit`, the most voted first. */
  builds: OverframeListed[];
  /** The item's builds in the list, any age. */
  total: number;
  /** Left out for their age. */
  older: number;
}

/** The item's builds in the list: the most voted of those updated within the age limit, at most `limit`. */
export function overframeFor(file: OverframeFile | null, itemPath: string, opts: OverframeOptions = {}): OverframeResult {
  if (!file) return { builds: [], total: 0, older: 0 };
  const maxAgeDays = opts.maxAgeDays ?? OVERFRAME_MAX_AGE_DAYS;
  const limit = Math.max(0, opts.limit ?? OVERFRAME_SHOWN);
  const now = opts.now ?? Date.now();
  const byName = opts.name ? normName(opts.name) : null;
  const mine = file.builds.filter((b) => b.uniqueName === itemPath || (!b.uniqueName && byName != null && normName(b.item) === byName));
  const fresh = mine.filter((b) => overframeWithinAge(b, maxAgeDays, now));
  // Only popular ones: a build with hardly any votes isn't one, however recent.
  const minVotes = Math.max(0, opts.minVotes ?? OVERFRAME_MIN_VOTES);
  const builds = [...fresh].filter((b) => b.score >= minVotes).sort((a, b) => b.score - a.score || updatedAt(b) - updatedAt(a) || a.id - b.id).slice(0, limit);
  return { builds, total: mine.length, older: mine.length - fresh.length };
}

/** The share of builds whose item matched a catalog path (0–1). */
export const matchRate = (file: OverframeFile): number => (file.builds.length ? file.builds.filter((b) => !!b.uniqueName).length / file.builds.length : 0);

let loading: Promise<OverframeFile | null> | null = null;

/**
 * The bundled file, read once from the app's own assets (never the web). Null when it's missing or
 * unreadable (the page then says so). `get` is for tests.
 */
export function loadOverframe(get: (url: string) => Promise<unknown> = (u) => fetch(u).then((r) => (r.ok ? r.json() : null))): Promise<OverframeFile | null> {
  if (!loading) {
    loading = get(OVERFRAME_FILE).then(
      (raw) => parseOverframeFile(raw),
      () => null,
    );
  }
  return loading;
}
/** Forgets the loaded file (tests). */
export const resetOverframe = (): void => {
  loading = null;
};
