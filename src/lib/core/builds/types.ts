// Builds: the shapes orbiter keeps in `settings.builds`, and their sanitiser.
//
// A build is orbiter's own JSON, whatever it came from: text the user pasted, the user's own
// editor, orbiter's suggestions, or later a permitted fetcher (see source.ts). Paths are the
// game's unique names, as the catalog has them.

/**
 * Slot polarities, in the catalog's words. "universal" is Omni (Aura Forma, Stance Forma): it
 * matches every mod but Umbra ones. The catalog also writes "aura" for a few slots; that is read
 * as Omni (see polarityOf).
 */
export type Polarity = "madurai" | "vazarin" | "naramon" | "zenurik" | "unairu" | "penjaga" | "umbra" | "universal";
export const POLARITIES: Polarity[] = ["madurai", "vazarin", "naramon", "zenurik", "unairu", "penjaga", "umbra", "universal"];
/** How players write them (Overframe and the in-game symbols). */
export const POLARITY_SYMBOL: Record<Polarity, string> = { madurai: "V", vazarin: "D", naramon: "—", zenurik: "=", unairu: "Ψ", penjaga: "Y", umbra: "U", universal: "Omni" };
export const POLARITY_LABEL: Record<Polarity, string> = { madurai: "Madurai", vazarin: "Vazarin", naramon: "Naramon", zenurik: "Zenurik", unairu: "Unairu", penjaga: "Penjaga", umbra: "Umbra", universal: "Omni" };

/** A catalog or user polarity in orbiter's words; null for none or one it doesn't know. */
export function polarityOf(v: unknown): Polarity | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  // "aura" in the catalog (Jade's and Sirius & Orion's aura slots, Vinquibus): the Omni icon. Unverified.
  if (s === "aura" || s === "any" || s === "omni") return "universal";
  return (POLARITIES as string[]).includes(s) ? (s as Polarity) : null;
}

/** What kind of gear a build is for: it decides the slots, the mods that fit and the words used. */
export type GearKind =
  | "warframe"
  | "primary"
  | "secondary"
  | "melee"
  | "companion"
  | "companionWeapon"
  | "archwing"
  | "archgun"
  | "archmelee"
  | "necramech"
  | "exalted"
  | "amp"
  | "kdrive";
export const GEAR_KINDS: GearKind[] = ["warframe", "primary", "secondary", "melee", "companion", "companionWeapon", "archwing", "archgun", "archmelee", "necramech", "exalted", "amp", "kdrive"];

/** A mod or arcane in a build. `rank` absent or null: max rank. */
export interface BuildMod {
  path: string;
  rank?: number | null;
}

export type ShardColour = "crimson" | "azure" | "amber" | "violet" | "topaz" | "emerald";
export const SHARD_COLOURS: ShardColour[] = ["crimson", "azure", "amber", "violet", "topaz", "emerald"];

export interface BuildShard {
  colour: ShardColour;
  tauforged: boolean;
  /** The stat it's set to, as written ("Energy max", "Ability Strength"). */
  stat?: string;
}

/** A Helminth ability on a warframe and the ability it replaces, by name. */
export interface BuildHelminth {
  ability: string;
  replaces: string;
}

/**
 * Where a build came from. A url source is a page the user opened and copied from, or (later)
 * a permitted fetcher's: orbiter never fetches Overframe or the wiki by itself.
 */
export type BuildSourceRef = "pasted" | "mine" | "orbiter" | { url: string; site: string };

export interface Build {
  id: string;
  /** The item's path (a warframe, weapon, companion…; a kitgun chamber or zaw strike for modular gear). */
  item: string;
  kind: GearKind;
  /** The build's own title, if it has one. */
  title?: string;
  aura?: BuildMod | null;
  exilus?: BuildMod | null;
  stance?: BuildMod | null;
  /** Mod slots in order: 8, 10 for companions, 12 for Necramechs. Null: empty. */
  mods: (BuildMod | null)[];
  /**
   * Slot polarities the build's author set, when the source says (the user's editor does).
   * Kept as stated; the tier engine works out its own minimal Forma from the item's innate ones.
   */
  polarities?: { aura?: Polarity | null; exilus?: Polarity | null; stance?: Polarity | null; mods?: (Polarity | null)[] };
  arcanes: BuildMod[];
  shards: BuildShard[];
  helminth?: BuildHelminth | null;
  /** The build uses an Orokin Catalyst/Reactor, as its source says; null: not said. */
  catalyst?: boolean | null;
  /** Adapters the source says it uses. */
  adapters?: { exilus?: boolean; arcane?: boolean };
  /** Forma the source says it took; null: not said. The tier engine works out its own. */
  forma?: number | null;
  /** Modular gear: the other parts (grip, loader, link, scaffold, brace…), by path. */
  parts?: string[];
  source: BuildSourceRef;
  author?: string;
  votes?: number | null;
  /** When the source last changed it (ms), if it says. */
  updatedAt?: number | null;
  /** When orbiter got it (ms). */
  importedAt: number;
  /** The game update it was made for ("39.1"), if known. */
  gameUpdate?: string;
  favourite?: boolean;
  note?: string;
  /** What it's for, in a word or two each ("Steel Path", "Shield gating", "Support"). */
  tags?: string[];
}

/** A fresh id for a build. */
export function newBuildId(now = Date.now()): string {
  return `b${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- sanitising

const MAX_BUILDS = 2000;
const MAX_TEXT = 4000;
const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rankOf = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 0 && n <= 99 ? Math.round(n) : null;
};

function modOf(v: unknown): BuildMod | null {
  const o = v as { path?: unknown; rank?: unknown } | null;
  if (!o || typeof o !== "object" || typeof o.path !== "string" || !o.path) return null;
  const rank = rankOf(o.rank);
  return rank == null ? { path: o.path } : { path: o.path, rank };
}

function sourceOf(v: unknown): BuildSourceRef {
  if (v === "pasted" || v === "mine" || v === "orbiter") return v;
  const o = v as { url?: unknown; site?: unknown } | null;
  if (o && typeof o === "object" && typeof o.url === "string" && /^https?:\/\//i.test(o.url)) {
    let host = "";
    try {
      host = new URL(o.url).hostname;
    } catch {
      return "pasted";
    }
    return { url: o.url.slice(0, 500), site: str(o.site, 80) ?? host };
  }
  return "pasted";
}

function shardOf(v: unknown): BuildShard | null {
  const o = v as { colour?: unknown; tauforged?: unknown; stat?: unknown } | null;
  if (!o || typeof o !== "object" || !SHARD_COLOURS.includes(o.colour as ShardColour)) return null;
  const stat = str(o.stat, 80);
  return { colour: o.colour as ShardColour, tauforged: o.tauforged === true, ...(stat ? { stat } : {}) };
}

/** One saved build if it's whole enough to use (an item and a kind), cleaned of anything odd. */
export function sanitizeBuild(v: unknown): Build | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.item !== "string" || !o.item || !GEAR_KINDS.includes(o.kind as GearKind)) return null;
  const pol = o.polarities as Record<string, unknown> | undefined;
  const helminth = o.helminth as { ability?: unknown; replaces?: unknown } | null | undefined;
  const adapters = o.adapters as { exilus?: unknown; arcane?: unknown } | undefined;
  const b: Build = {
    id: str(o.id, 60) ?? newBuildId(),
    item: o.item,
    kind: o.kind as GearKind,
    mods: Array.isArray(o.mods) ? o.mods.slice(0, 12).map(modOf) : [],
    arcanes: Array.isArray(o.arcanes) ? o.arcanes.map(modOf).filter((x): x is BuildMod => !!x).slice(0, 4) : [],
    shards: Array.isArray(o.shards) ? o.shards.map(shardOf).filter((x): x is BuildShard => !!x).slice(0, 5) : [],
    source: sourceOf(o.source),
    importedAt: num(o.importedAt) ?? Date.now(),
  };
  const title = str(o.title, 120);
  if (title) b.title = title;
  for (const k of ["aura", "exilus", "stance"] as const) {
    const m = modOf(o[k]);
    if (m) b[k] = m;
  }
  if (pol && typeof pol === "object") {
    b.polarities = {};
    for (const k of ["aura", "exilus", "stance"] as const) if (k in pol) b.polarities[k] = polarityOf(pol[k]);
    if (Array.isArray(pol.mods)) b.polarities.mods = pol.mods.slice(0, 12).map(polarityOf);
  }
  if (helminth && typeof helminth === "object" && typeof helminth.ability === "string" && typeof helminth.replaces === "string") b.helminth = { ability: helminth.ability.slice(0, 80), replaces: helminth.replaces.slice(0, 80) };
  if (typeof o.catalyst === "boolean") b.catalyst = o.catalyst;
  if (adapters && typeof adapters === "object") b.adapters = { ...(typeof adapters.exilus === "boolean" ? { exilus: adapters.exilus } : {}), ...(typeof adapters.arcane === "boolean" ? { arcane: adapters.arcane } : {}) };
  const forma = num(o.forma);
  if (forma != null && forma >= 0) b.forma = Math.min(99, Math.round(forma));
  if (Array.isArray(o.parts)) b.parts = o.parts.filter((p): p is string => typeof p === "string" && !!p).slice(0, 6);
  const author = str(o.author, 80);
  if (author) b.author = author;
  const votes = num(o.votes);
  if (votes != null) b.votes = Math.round(votes);
  const updatedAt = num(o.updatedAt);
  if (updatedAt != null) b.updatedAt = updatedAt;
  const gameUpdate = str(o.gameUpdate, 20);
  if (gameUpdate) b.gameUpdate = gameUpdate;
  if (o.favourite === true) b.favourite = true;
  const note = str(o.note, MAX_TEXT);
  if (note) b.note = note;
  if (Array.isArray(o.tags)) {
    const tags = [...new Set(o.tags.map((t) => str(t, 40)?.trim()).filter((t): t is string => !!t))].slice(0, 12);
    if (tags.length) b.tags = tags;
  }
  return b;
}

/** `settings.builds` as saved: the whole builds kept (ids made unique), anything broken dropped. */
export function sanitizeBuilds(raw: unknown): Build[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Build[] = [];
  for (const v of raw.slice(0, MAX_BUILDS)) {
    const b = sanitizeBuild(v);
    if (!b) continue;
    if (seen.has(b.id)) b.id = newBuildId();
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

/** `settings.buildsMaxAgeDays`: whole days, 0 for no limit; 365 when unset or odd. */
export const DEFAULT_BUILDS_MAX_AGE_DAYS = 365;
export function sanitizeMaxAgeDays(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(36500, Math.round(v)) : DEFAULT_BUILDS_MAX_AGE_DAYS;
}
