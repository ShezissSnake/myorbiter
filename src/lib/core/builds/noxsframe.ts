// Builds from Nox's Frame (noxsframe.com), a fan-made build planner by Senjunox.
//
// The Rust side (src-tauri/src/noxsframe.rs) reads its public pages: GET only, one request every
// 3 s across orbiter, each answer kept 7 days. This file maps what it reads to orbiter's Build and
// decides when to read: only when the user opens builds for an item (its list, top-voted first),
// and one build's page only when the user opens that build. Never in the background, never for
// other items. A build already opened shows from the cache with no request.
//
// A Nox's Frame build is a whole loadout (frame, weapons, companion…) keyed by the game's unique
// names; orbiter keeps the part for the item asked about. Paths not in orbiter's catalog, Helminth
// abilities and shard stats it can't name, rivens and valence bonuses go into the build's note,
// never guessed.

import type { CatalogItem } from "../types";
import { gearKindOf, slotLayout } from "./gear";
import { normName } from "./match";
import type { BuildSource, SourceContext, SourcePermission } from "./source";
import { withinAge } from "./store";
import { newBuildId, polarityOf, SHARD_COLOURS, type Build, type BuildMod, type BuildShard, type BuildSourceRef, type GearKind, type Polarity, type ShardColour } from "./types";

export const NOX_SITE = "Nox's Frame";
export const NOX_HOST = "noxsframe.com";
/** The terms, as read by hand. Ask Senjunox before orbiter is distributed more widely. */
export const NOX_PERMISSION: Extract<SourcePermission, { kind: "terms" }> = {
  kind: "terms",
  host: NOX_HOST,
  note: "Terms (Nov 2026) forbid only automated mass requests; read on demand, cached, spaced; ask Senjunox before wider distribution",
  checked: "2026-11-03",
};
/** The setting (`settings.buildsFromNox`), for Settings and the Builds page. */
export const NOX_SETTING = {
  label: "Read builds from Nox's Frame",
  help: "When you open builds for an item, orbiter reads that item's top-voted builds from noxsframe.com, a fan-made build planner, and a build's loadout when you open it. Nothing is read in the background or for other items. Each page is kept for a week, and orbiter waits 3 seconds between reads.",
};
/** The site's game modes (its build tags), key → label, verbatim from its pages (Nov 2026). */
export const NOX_MODES: Record<string, string> = {
  allround: "All-round",
  starchart: "Star Chart",
  steelpath: "Steel Path",
  endurance: "Endurance",
  archimedea: "Archimedea",
  netracells: "Netracells",
  archon: "Archon Hunt",
  eidolon: "Eidolon Hunt",
  duviri: "Duviri / Circuit",
  farming: "Farming",
  speedrun: "Speedrun",
};

// ---------------------------------------------------------------- what the Rust side returns

/** One build on an item's list (`nox_item_builds`), in the site's order: top-voted first. */
export interface NoxListing {
  /** `<id>-<slug>`: what `nox_build` takes. */
  path: string;
  url: string;
  title: string;
  /** The build's main item, as the card names it. */
  item: string;
  author: string;
  votes: number | null;
  /** The card's date, "YYYY-MM-DD" (the site doesn't say if it's published or updated). */
  date: string | null;
  /** Game modes, as the site labels them ("Steel Path"). */
  tags: string[];
}

/** One build's page (`nox_build`). `build` is its decoded build code. */
export interface NoxPage {
  id: string;
  path: string;
  url: string;
  title: string | null;
  description: string | null;
  author: string | null;
  item: string | null;
  published: string | null;
  modified: string | null;
  votes: number | null;
  up: number | null;
  down: number | null;
  modes: string[];
  tags: string[];
  code: string;
  build: unknown;
}

/** An answer from the Rust side: from the network, or the cache (stale: older than a week, served because the network failed, with `error`). */
export interface NoxAnswer<T> {
  fetchedAt: number;
  fromCache: boolean;
  stale: boolean;
  error?: string;
  data: T;
}

/** The Tauri commands, behind an interface (backend.ts's `noxFetcher`; tests use a fake). */
export interface NoxFetcher {
  list(item: string, refresh?: boolean): Promise<NoxAnswer<NoxListing[]>>;
  /** `cachedOnly`: null when the page isn't kept, and never the network. */
  build(path: string, opts?: { refresh?: boolean; cachedOnly?: boolean }): Promise<NoxAnswer<NoxPage> | null>;
  /** A pasted build code's JSON (no network). */
  decode(code: string): Promise<unknown>;
}

// ---------------------------------------------------------------- mapping

/** Nox's Frame's loadout sections, and the gear kind each is. */
const SECTIONS: [string, GearKind][] = [
  ["warframe", "warframe"],
  ["primary", "primary"],
  ["secondary", "secondary"],
  ["melee", "melee"],
  ["exalted", "exalted"],
  ["archgun", "archgun"],
  ["archmelee", "archmelee"],
  ["companion", "companion"],
  ["archwing", "archwing"],
  ["necramech", "necramech"],
];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const tail = (path: string) => path.split("/").pop() ?? path;

/** The items a decoded build code holds, by section: [section, unique name]. */
export function noxItems(raw: unknown): [string, string][] {
  const o = obj(raw);
  if (!o) return [];
  return SECTIONS.flatMap(([key]) => {
    const id = text(obj(o[key])?.itemId);
    return id ? [[key, id] as [string, string]] : [];
  });
}

/** The first paragraph of the author's text, short, for the note (the rest is on the site). */
function excerpt(s: string | null, max = 300): string | null {
  if (!s) return null;
  const first = s.split(/\n\s*\n/).map((p) => p.replace(/[#*_`>[\]]/g, "").replace(/\s+/g, " ").trim()).find((p) => p.length > 0);
  if (!first) return null;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export interface NoxMapped {
  build: Build;
  /** What orbiter couldn't carry over or name (also in the build's note). */
  notes: string[];
}

export interface NoxMapOptions {
  /** The page it came from; without one (a pasted code) the source is "pasted". */
  page?: NoxPage | null;
  now?: number;
}

/**
 * The part of a decoded Nox's Frame build code for `item`, as an orbiter Build; null when the code
 * has no section for it. Mods, arcanes and items are matched by path against the catalog;
 * anything not found goes into the note.
 */
export function noxToBuild(raw: unknown, item: CatalogItem, catalog: ReadonlyMap<string, CatalogItem>, opts: NoxMapOptions = {}): NoxMapped | null {
  const o = obj(raw);
  if (!o) return null;
  const found = SECTIONS.find(([key]) => obj(o[key])?.itemId === item.uniqueName);
  if (!found) return null;
  const [sectionKey, sectionKind] = found;
  const sec = obj(o[sectionKey]) as Obj;
  const kind: GearKind = sectionKind === "exalted" ? "exalted" : (gearKindOf(item) ?? sectionKind);
  const layout = slotLayout(kind);
  const notes: string[] = [];
  const unknownPolarities = new Set<string>();

  const pol = (v: unknown): Polarity | null => {
    const p = polarityOf(v);
    if (p == null && typeof v === "string" && v.trim()) unknownPolarities.add(v);
    return p;
  };
  /** A mod slot: the mod (matched by path, a mod in the catalog) and its polarity. */
  const slot = (v: unknown, where: string): { mod: BuildMod | null; polarity: Polarity | null } => {
    const s = obj(v);
    const polarity = pol(s?.polarity);
    const path = text(s?.modId);
    if (!path) return { mod: null, polarity };
    const c = catalog.get(path);
    if (!c || c.category !== "Mods") {
      notes.push(`${where}: ${c ? `${c.name} isn't a mod` : `${tail(path)} isn't in orbiter's catalog`} (${path})`);
      return { mod: null, polarity };
    }
    const rank = int(s?.rank);
    return { mod: rank != null && rank >= 0 ? { path, rank } : { path }, polarity };
  };
  const arcane = (v: unknown): BuildMod | null => {
    const a = obj(v);
    const path = text(a?.arcaneId);
    if (!path) return null;
    const c = catalog.get(path);
    if (!c || c.category !== "Arcanes") {
      notes.push(`Arcane: ${c ? `${c.name} isn't an arcane` : `${tail(path)} isn't in orbiter's catalog`} (${path})`);
      return null;
    }
    const rank = int(a?.rank);
    return rank != null && rank >= 0 ? { path, rank } : { path };
  };

  const b: Build = {
    id: opts.page ? `nox-${opts.page.id}-${kind}` : newBuildId(opts.now),
    item: item.uniqueName,
    kind,
    mods: [],
    arcanes: [],
    shards: [],
    source: (opts.page ? { url: opts.page.url, site: NOX_SITE } : "pasted") as BuildSourceRef,
    importedAt: opts.now ?? Date.now(),
  };
  const title = text(opts.page?.title) ?? text(o.name);
  if (title) b.title = title.slice(0, 120);

  const polarities: NonNullable<Build["polarities"]> = {};
  for (const k of ["aura", "exilus", "stance"] as const) {
    if (k === "aura" && !layout.aura) continue;
    if (k === "exilus" && !layout.exilus) continue;
    if (k === "stance" && !layout.stance) continue;
    if (!(k in sec)) continue;
    const s = slot(sec[k], k === "aura" ? "Aura" : k === "exilus" ? "Exilus" : "Stance");
    if (s.mod) b[k] = s.mod;
    polarities[k] = s.polarity;
  }
  const slots = Array.isArray(sec.slots) ? sec.slots : [];
  const read = slots.map((v, i) => slot(v, `Slot ${i + 1}`));
  b.mods = Array.from({ length: layout.mods }, (_, i) => read[i]?.mod ?? null);
  polarities.mods = Array.from({ length: layout.mods }, (_, i) => read[i]?.polarity ?? null);
  const extra = read.slice(layout.mods).filter((s) => s.mod);
  if (extra.length) notes.push(`${extra.length} more mod${extra.length > 1 ? "s" : ""} than orbiter has slots for here, left out`);
  const anyPolarity = [polarities.aura, polarities.exilus, polarities.stance, ...polarities.mods].some((p) => p != null);
  if (anyPolarity) b.polarities = polarities;
  if (unknownPolarities.size) notes.push(`Polarities orbiter doesn't know: ${[...unknownPolarities].join(", ")}`);

  const arcanes = Array.isArray(sec.arcanes) ? sec.arcanes : "arcane" in sec ? [sec.arcane] : [];
  const kept = arcanes.map(arcane).filter((a): a is BuildMod => !!a);
  b.arcanes = kept.slice(0, layout.arcanes);
  if (kept.length > layout.arcanes) notes.push(`${kept.length - layout.arcanes} more arcane${kept.length - layout.arcanes > 1 ? "s" : ""} than orbiter has slots for here, left out`);

  // Archon shards: colour and Tauforged. The stat is Nox's Frame's number for it, which orbiter can't name yet.
  if (Array.isArray(sec.shards)) {
    const stats: string[] = [];
    for (const v of sec.shards) {
      const s = obj(v);
      const colour = text(s?.color)?.toLowerCase();
      if (!colour) continue;
      if (!SHARD_COLOURS.includes(colour as ShardColour)) {
        notes.push(`Archon shard colour orbiter doesn't know: ${colour}`);
        continue;
      }
      const shard: BuildShard = { colour: colour as ShardColour, tauforged: s?.tauforged === true };
      b.shards.push(shard);
      if (int(s?.stat) != null) stats.push(`${colour}${shard.tauforged ? " (Tauforged)" : ""} #${int(s?.stat)}`);
    }
    b.shards = b.shards.slice(0, 5);
    if (stats.length) notes.push(`Shard stats, as Nox's Frame numbers them (orbiter can't name them yet): ${stats.join(", ")}`);
  }

  // The Helminth: the ability it replaces is the frame's own (by slot); the subsumed ability is
  // Nox's Frame's id, named only if it is plainly one of the catalog's ability names.
  const helminth = obj(sec.helminth);
  const abilityId = text(helminth?.ability);
  if (abilityId) {
    const slotIndex = int(helminth?.slot);
    const replaces = slotIndex != null ? item.abilities?.[slotIndex]?.name : undefined;
    const wanted = normName(abilityId.replace(/Ability$/, ""));
    let named: string | undefined;
    for (const c of catalog.values()) {
      const hit = c.abilities?.find((a) => normName(a.name) === wanted);
      if (hit) {
        named = hit.name;
        break;
      }
    }
    if (named && replaces) b.helminth = { ability: named, replaces };
    else notes.push(`Helminth: ${named ?? `Nox's Frame's ability "${abilityId}"`} replaces ${replaces ?? `ability ${slotIndex != null ? slotIndex + 1 : "?"}`} (orbiter can't name the ability yet)`);
    if (helminth?.offense != null || helminth?.utility != null) notes.push("Helminth invigorations are set on Nox's Frame (not carried over)");
  }

  const doubler = typeof sec.reactor === "boolean" ? sec.reactor : typeof sec.catalyst === "boolean" ? sec.catalyst : null;
  if (doubler != null) b.catalyst = doubler;
  if (int(sec.formaBudget) != null) notes.push(`Forma budget set on Nox's Frame: ${int(sec.formaBudget)}`);
  if (sec.riven != null) notes.push("Uses a riven mod (not carried over)");
  if (sec.valence != null) notes.push("A valence bonus is set on Nox's Frame (not carried over)");

  const page = opts.page;
  if (page) {
    const author = text(page.author);
    if (author) b.author = author.slice(0, 80);
    if (page.votes != null) b.votes = page.votes;
    const when = Date.parse(page.modified ?? page.published ?? "");
    if (Number.isFinite(when)) b.updatedAt = when;
  }
  const tags = page?.tags?.length ? page.tags : [];
  if (tags.length) b.tags = [...new Set(tags)].slice(0, 12);

  const author = excerpt(page?.description ?? text(o.notes));
  const note = [...notes, ...(author ? [`Author's notes: ${author}${page ? " (more on Nox's Frame)" : ""}`] : [])].join("\n");
  if (note) b.note = note.slice(0, 4000);
  return { build: b, notes };
}

// ---------------------------------------------------------------- reading on demand

const DAY = 86_400_000;
/** At most this many builds listed for an item (the first page, top-voted first). */
export const NOX_LISTED = 10;

export interface NoxListed extends NoxListing {
  /** Its page is kept: opening it needs no request. */
  opened: boolean;
}

export interface NoxListResult {
  entries: NoxListed[];
  /** Left out by the age filter (settings.buildsMaxAgeDays), by the card's date. */
  hiddenByAge: number;
  fetchedAt: number;
  fromCache: boolean;
  stale: boolean;
  error?: string;
}

export interface NoxOpened extends NoxMapped {
  fetchedAt: number;
  fromCache: boolean;
  stale: boolean;
  error?: string;
}

export interface Nox {
  /** For registerSource: its builds() gives the opened (kept) builds for an item, after reading the item's list. */
  source: BuildSource;
  /** An item's top builds on Nox's Frame. One request at most (none within the week), only when on. */
  listing(item: CatalogItem, ctx: SourceContext, opts?: { refresh?: boolean }): Promise<NoxListResult>;
  /** One build, for `item`: its page read now (spaced) unless it's kept. Throws with a message to show. */
  open(item: CatalogItem, path: string, ctx: SourceContext, opts?: { refresh?: boolean }): Promise<NoxOpened>;
}

const OFF = "Reading builds from Nox's Frame is off (Settings)";

/** Whether a listed build passes the age filter (settings.buildsMaxAgeDays, 0: no limit) by its card's date (no date: kept). */
export const noxListedWithinAge = (l: Pick<NoxListing, "date">, maxAgeDays: number, now: number): boolean => {
  if (!(maxAgeDays > 0) || !l.date) return true;
  const at = Date.parse(`${l.date}T00:00:00Z`);
  return !Number.isFinite(at) || now - at <= (maxAgeDays + 1) * DAY;
};

/**
 * Nox's Frame for the Builds page. `enabled` reads `settings.buildsFromNox` at call time.
 *
 *   const nox = makeNox(noxFetcher, () => settings.buildsFromNox);
 *   registerSource(nox.source);
 */
export function makeNox(fetcher: NoxFetcher, enabled: () => boolean): Nox {
  /** The list, and the pages already kept (read from the cache, never the network). */
  async function read(item: CatalogItem, ctx: SourceContext, refresh: boolean): Promise<[NoxListResult, Map<string, NoxAnswer<NoxPage>>]> {
    const kept = new Map<string, NoxAnswer<NoxPage>>();
    if (!gearKindOf(item)) return [{ entries: [], hiddenByAge: 0, fetchedAt: ctx.now, fromCache: true, stale: false }, kept];
    const answer = await fetcher.list(item.uniqueName, refresh);
    const all = (Array.isArray(answer.data) ? answer.data : []).slice(0, NOX_LISTED);
    const shown = all.filter((l) => noxListedWithinAge(l, ctx.maxAgeDays, ctx.now));
    const entries: NoxListed[] = [];
    for (const l of shown) {
      const page = await fetcher.build(l.path, { cachedOnly: true });
      if (page) kept.set(l.path, page);
      entries.push({ ...l, opened: !!page });
    }
    return [{ entries, hiddenByAge: all.length - shown.length, fetchedAt: answer.fetchedAt, fromCache: answer.fromCache, stale: answer.stale, ...(answer.error ? { error: answer.error } : {}) }, kept];
  }

  async function listing(item: CatalogItem, ctx: SourceContext, opts: { refresh?: boolean } = {}): Promise<NoxListResult> {
    if (!enabled()) throw new Error(OFF);
    return (await read(item, ctx, opts.refresh === true))[0];
  }

  async function open(item: CatalogItem, path: string, ctx: SourceContext, opts: { refresh?: boolean } = {}): Promise<NoxOpened> {
    if (!enabled()) throw new Error(OFF);
    const answer = await fetcher.build(path, { refresh: opts.refresh === true });
    if (!answer) throw new Error("Nox's Frame didn't return the build");
    const mapped = noxToBuild(answer.data.build, item, ctx.catalog, { page: answer.data, now: ctx.now });
    if (!mapped) throw new Error(`This build on Nox's Frame doesn't include ${item.name}`);
    return { ...mapped, fetchedAt: answer.fetchedAt, fromCache: answer.fromCache, stale: answer.stale, ...(answer.error ? { error: answer.error } : {}) };
  }

  const source: BuildSource = {
    id: NOX_HOST,
    label: NOX_SITE,
    network: true,
    permission: NOX_PERMISSION,
    async builds(item, ctx) {
      if (!enabled() || !gearKindOf(item)) return [];
      const [list, kept] = await read(item, ctx, false);
      const out: Build[] = [];
      for (const l of list.entries) {
        const answer = kept.get(l.path);
        const mapped = answer && noxToBuild(answer.data.build, item, ctx.catalog, { page: answer.data, now: ctx.now });
        if (mapped && withinAge(mapped.build, ctx.maxAgeDays, ctx.now)) out.push(mapped.build);
      }
      return out;
    },
  };

  return { source, listing, open };
}

// ---------------------------------------------------------------- pasted codes

export interface NoxCodeResult extends NoxMapped {
  /** The other items the code holds, by name (or path when the catalog lacks it). */
  others: string[];
}

/** Whether some text looks like a Nox's Frame build code (to offer reading it as one). */
export const looksLikeNoxCode = (s: string): boolean => /^\s*NFB\d+:[A-Za-z0-9_-]{8,}={0,2}\s*$/.test(s);

/**
 * A build code pasted from Nox's Frame ("Copy build code"), read for `item`. `decode` unpacks it
 * (backend.ts's `noxFetcher.decode`, no network). Throws with a message to show.
 */
export async function parseNoxCode(code: string, item: CatalogItem, catalog: ReadonlyMap<string, CatalogItem>, decode: (code: string) => Promise<unknown>, now = Date.now()): Promise<NoxCodeResult> {
  if (!looksLikeNoxCode(code)) throw new Error("That isn't a Nox's Frame build code (they start with NFB1:)");
  const raw = await decode(code.trim());
  const items = noxItems(raw);
  const others = items.filter(([, p]) => p !== item.uniqueName).map(([, p]) => catalog.get(p)?.name ?? p);
  const mapped = noxToBuild(raw, item, catalog, { now });
  if (!mapped) throw new Error(items.length ? `This build code has no ${item.name}; it has ${others.join(", ")}` : "This build code holds no gear");
  return { ...mapped, others };
}
