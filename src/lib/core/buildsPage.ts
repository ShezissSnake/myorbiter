// What the Builds page works out, kept out of Svelte so it can be tested: which items take a build
// (and what to call them), the item search, how a chosen item's builds sort into the three tiers,
// a build's age and source in words, the links out to Overframe and Nox's Frame, the whisper to the
// cheapest seller, and orbiter's suggestion's optional loadout as lines.
//
// The builds core (./builds) does the real work: tiers, what you're missing, parsing, matching.

import type { CatalogItem } from "./types";
import { buildDate, gearKindOf, slotLayout, type Build, type BuildSourceRef, type GearKind, type Tier, type TierResult } from "./builds";
import { recipeItem, type RecipeFamily } from "./recipes";
import { familyOf } from "./modular";
import { competitor, type BookOrder, type Me } from "./market";

export const TIERS: Tier[] = ["low", "medium", "high"];
/**
 * The tiers as player progression: what a new, an intermediate and a veteran
 * player can put in a build. The tab a build lands in is still the core's tier value (tierOf, from
 * capacity); its reasons show under each build as the capacity side of it.
 */
export const TIER_NAME: Record<Tier, string> = { low: "New player", medium: "Intermediate", high: "Veteran" };
/** A few words under the tab. */
export const TIER_MEANS: Record<Tier, string> = { low: "Basic mods", medium: "Catalyst, Forma, easy arcanes", high: "Everything" };
/** The tab's tooltip: what the tier allows. */
export const TIER_TIP: Record<Tier, string> = {
  low: "New player: basic mods only. No Orokin Catalyst or Reactor, no Forma, no Archon shards, no arcanes.",
  medium: "Intermediate: an Orokin Catalyst or Reactor, an Exilus Adapter, regular Forma, augments, corrupted mods, Lua and spy-vault mods, and easy arcanes (Molt Augmented and the like). No Primed, Archon or Umbral mods, no Umbra Forma, no shards, no hard arcanes.",
  high: "Veteran: everything, Primed, Archon and Umbral mods, Umbra Forma and Tauforged Archon shards included.",
};

export const KIND_LABEL: Record<GearKind, string> = {
  warframe: "Warframe",
  primary: "Primary",
  secondary: "Secondary",
  melee: "Melee",
  companion: "Companion",
  companionWeapon: "Companion weapon",
  archwing: "Archwing",
  archgun: "Arch-gun",
  archmelee: "Arch-melee",
  necramech: "Necramech",
  exalted: "Exalted weapon",
  amp: "Amp",
  kdrive: "K-Drive",
};
const FAMILY_LABEL: Record<RecipeFamily, string> = { kitgun: "Kitgun chamber", zaw: "Zaw strike", amp: "Amp prism", moa: "MOA", hound: "Hound", predasite: "Predasite", vulpaphyla: "Vulpaphyla" };

/**
 * The kind of build an item takes, or null: warframes and their exalted weapons, every weapon,
 * companions and their weapons, archwings, arch-guns and arch-melee, Necramechs and amps. Modular
 * gear goes by the part its recipe is for (a kitgun's chamber, a zaw's strike, an amp's prism, a
 * MOA's or Hound's model, a Predasite's or Vulpaphyla's subspecies); its other parts take no build
 * of their own. K-Drives are left out.
 */
export function buildKindOf(item: Pick<CatalogItem, "uniqueName" | "category" | "type" | "productCategory">): GearKind | null {
  const u = item.uniqueName;
  if (/Blueprint$/.test(u)) return null;
  if (item.type === "Exalted Weapon") return "exalted";
  if (item.productCategory === "OperatorAmps") return "amp";
  const fam = familyOf(u);
  // Modular parts (filed under Pistols whatever they are, or as Kitgun/Zaw components and amps).
  const modular = !!fam || item.type === "Kitgun Component" || item.type === "Zaw Component" || item.type === "Amp" || (item.productCategory === "Pistols" && item.category !== "Secondary");
  if (modular) {
    const r = recipeItem(u);
    if (!r) return null;
    return r.family === "kitgun" ? "secondary" : r.family === "zaw" ? "melee" : r.family === "amp" ? "amp" : "companion";
  }
  const k = gearKindOf(item);
  return k === "kdrive" ? null : k;
}

/** What to call an item's kind under its name: its gear kind, or what modular part it is. */
export function kindLabelOf(item: Pick<CatalogItem, "uniqueName" | "type">, kind: GearKind): string {
  const r = recipeItem(item.uniqueName);
  if (r) return FAMILY_LABEL[r.family];
  if (kind === "primary" || kind === "secondary" || kind === "melee") return item.type && item.type !== "Melee" && item.type !== kind ? `${KIND_LABEL[kind]} · ${item.type}` : KIND_LABEL[kind];
  return KIND_LABEL[kind];
}

export interface BuildableItem {
  unique: string;
  name: string;
  kind: GearKind;
  label: string;
  owned: boolean;
  /** Has a recipe (modular gear). */
  modular: boolean;
}

/**
 * Every item that takes a build, yours first, then by name. `owned`: copies you hold (the model's
 * owned()). One entry per name: where the catalog has two items of the same name, the one you hold
 * or else the first.
 */
export function buildableItems(catalog: Iterable<CatalogItem>, owned: (unique: string) => number): BuildableItem[] {
  const byName = new Map<string, BuildableItem>();
  for (const c of catalog) {
    if (!c.name || c.category === "Mods" || c.category === "Arcanes") continue;
    const kind = buildKindOf(c);
    if (!kind) continue;
    const x: BuildableItem = { unique: c.uniqueName, name: c.name, kind, label: kindLabelOf(c, kind), owned: owned(c.uniqueName) > 0, modular: !!recipeItem(c.uniqueName) };
    const had = byName.get(c.name);
    if (!had || (x.owned && !had.owned)) byName.set(c.name, x);
  }
  return [...byName.values()].sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name));
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Items whose name matches what's typed: names starting with it first, then a word starting with
 * it, then containing it; yours before the rest at each step, then by name.
 */
export function searchItems(items: readonly BuildableItem[], q: string, limit = 30): BuildableItem[] {
  const k = fold(q);
  if (!k) return items.slice(0, limit);
  const scored: { x: BuildableItem; s: number }[] = [];
  for (const x of items) {
    const n = fold(x.name);
    const s = n.startsWith(k) ? 0 : ` ${n}`.includes(` ${k}`) ? 1 : n.includes(k) || n.replace(/ /g, "").includes(k.replace(/ /g, "")) ? 2 : -1;
    if (s >= 0) scored.push({ x, s });
  }
  return scored
    .sort((a, b) => a.s - b.s || Number(b.x.owned) - Number(a.x.owned) || a.x.name.length - b.x.name.length || a.x.name.localeCompare(b.x.name))
    .slice(0, limit)
    .map((v) => v.x);
}

/** Recent items: the ones opened this session (newest first), then the ones with saved builds, newest first. */
export function recentItems(opened: readonly string[], builds: readonly Build[], limit = 8): string[] {
  const out: string[] = [];
  const add = (u: string) => !out.includes(u) && out.push(u);
  opened.forEach(add);
  [...builds].sort((a, b) => buildDate(b) - buildDate(a)).forEach((b) => add(b.item));
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- arranging the builds

/** Where a shown build stands: starred, saved by you (pasted or your own), from a site, orbiter's. */
export type Place = "favourite" | "saved" | "site" | "orbiter";

export interface Shown {
  build: Build;
  tier: TierResult;
  place: Place;
  /** In settings.builds (so it can be deleted or edited in place). */
  saved: boolean;
}

const isSite = (s: BuildSourceRef): s is { url: string; site: string } => typeof s === "object" && s !== null;

/**
 * One item's builds sorted into the three tiers by what each needs (tierOf), each tier in this
 * order: favourites first, then the ones you pasted or made, then a site's (most votes first), then
 * orbiter's suggestion, labelled. `saved`: the item's saved builds, already filtered by age.
 * `site`: builds a network source gave (any already saved are skipped). `suggestions`: orbiter's,
 * by the tier it was made for (it stays in that tab; a saved copy goes by its own tier).
 */
export function arrange(saved: readonly Build[], site: readonly Build[], suggestions: Partial<Record<Tier, Build>>, tierFor: (b: Build) => TierResult): Record<Tier, Shown[]> {
  const out: Record<Tier, Shown[]> = { low: [], medium: [], high: [] };
  const ids = new Set(saved.map((b) => b.id));
  const rank: Record<Place, number> = { favourite: 0, saved: 1, site: 2, orbiter: 3 };
  for (const b of saved) {
    const t = tierFor(b);
    const place: Place = b.favourite ? "favourite" : b.source === "orbiter" ? "orbiter" : isSite(b.source) ? "site" : "saved";
    out[t.tier].push({ build: b, tier: t, place, saved: true });
  }
  for (const b of site) {
    if (ids.has(b.id)) continue;
    ids.add(b.id);
    const t = tierFor(b);
    out[t.tier].push({ build: b, tier: t, place: b.source === "orbiter" ? "orbiter" : "site", saved: false });
  }
  for (const tier of TIERS) {
    const b = suggestions[tier];
    if (!b || ids.has(b.id)) continue;
    out[tier].push({ build: b, tier: tierFor(b), place: "orbiter", saved: false });
  }
  for (const tier of TIERS) {
    // Stable within a place: saved ones keep buildsFor's order (newest first); a site's by votes.
    const at = new Map(out[tier].map((s, i) => [s, i]));
    out[tier].sort((a, b) => rank[a.place] - rank[b.place] || (a.place === "site" && b.place === "site" ? (b.build.votes ?? 0) - (a.build.votes ?? 0) : 0) || at.get(a)! - at.get(b)!);
  }
  return out;
}

// ---------------------------------------------------------------- words

/** How long ago, in words: "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago", "2 years ago". */
export function ago(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30.44)} months ago`;
  const y = Math.floor(days / 365.25);
  return y <= 1 ? "a year ago" : `${y} years ago`;
}

/** A build's age in words: when its source last changed it, else when you added it. */
export function ageLine(b: Build, now = Date.now()): string {
  return b.updatedAt != null ? `updated ${ago(b.updatedAt, now)}` : `added ${ago(b.importedAt, now)}`;
}

/** Where a build came from, in a word or two. */
export function sourceName(s: BuildSourceRef): string {
  if (s === "pasted") return "Pasted";
  if (s === "mine") return "Yours";
  if (s === "orbiter") return "orbiter's suggestion";
  return s.site;
}

// ---------------------------------------------------------------- links out

/** URL path words: "Soma Prime" → "soma-prime", "Kuva Nukor" → "kuva-nukor". */
export const slugOf = (name: string) => fold(name.replace(/&/g, " and ")).replace(/ /g, "-");

const NOX_SECTION: Partial<Record<GearKind, string>> = {
  warframe: "warframes",
  primary: "primary-weapons",
  secondary: "secondary-weapons",
  melee: "melee-weapons",
  companion: "companions",
  archwing: "archwings",
  archgun: "arch-guns",
  archmelee: "arch-melee",
  necramech: "necramechs",
};

/**
 * The item's page on Nox's Frame (noxsframe.com/<section>/<name>, as its sitemap has them), which
 * lists its builds; its builds index for what it has no page for (modular parts, companion weapons,
 * exalted weapons). Opened in your browser: orbiter never fetches it.
 */
export function noxUrl(name: string, kind: GearKind, modular = false): string {
  const section = modular ? null : NOX_SECTION[kind];
  return section ? `https://noxsframe.com/${section}/${slugOf(name)}` : "https://noxsframe.com/builds";
}

/**
 * Overframe's page for the item. Its arsenal pages carry a number orbiter doesn't have, so this
 * asks DuckDuckGo for the first Overframe arsenal page with the name (its "\" jump straight to the
 * first result). Opened in your browser: orbiter never fetches Overframe, whose terms forbid it.
 */
export function overframeUrl(name: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(`\\site:overframe.gg/items/arsenal "${name}"`)}`;
}

// ---------------------------------------------------------------- the whisper

export interface Seller {
  name: string;
  platinum: number;
  /** In-game sellers at any price for the same rank. */
  sellers: number;
  whisper: string;
}

/** The game-chat whisper warframe.market's Buy copies, word for word (as Home's cheap buys). */
export function whisperLine(seller: string, item: string, platinum: number, rank: number | null): string {
  return `/w ${seller} Hi! I want to buy: "${item}${rank != null ? ` (rank ${rank})` : ""}" for ${platinum} platinum. (warframe.market)`;
}

/**
 * The cheapest seller in game now for one copy at `rank` (null for things without ranks), from an
 * order book read with a GET; null when nobody in game sells it. Signed out, `me` is null and every
 * seller counts (crossplay can't be checked).
 */
export function cheapestSeller(book: readonly BookOrder[], item: string, rank: number | null, me: Me | null, defaultSubtype: string | null = null): Seller | null {
  const c = competitor({ rank, subtype: null }, [...book], me ?? { id: "" }, defaultSubtype);
  if (!c.lowest?.name) return null;
  return { name: c.lowest.name, platinum: c.lowest.platinum, sellers: c.sellers, whisper: whisperLine(c.lowest.name, item, c.lowest.platinum, rank) };
}

// ---------------------------------------------------------------- the paste's fixes

/**
 * A draft with a picked name put in: an arcane in the first free arcane slot, a mod in the first
 * empty mod slot (or appended while there's room). Returns the same draft when there's no room.
 */
export function placeIn(b: Build, path: string, arcane: boolean): Build {
  const layout = slotLayout(b.kind);
  if (arcane) {
    if (b.arcanes.length >= layout.arcanes || b.arcanes.some((a) => a.path === path)) return b;
    return { ...b, arcanes: [...b.arcanes, { path }] };
  }
  if (b.mods.some((m) => m?.path === path)) return b;
  const mods = [...b.mods];
  const free = mods.findIndex((m) => !m);
  if (free >= 0) mods[free] = { path };
  else if (mods.length < layout.mods) mods.push({ path });
  else return b;
  return { ...b, mods };
}

// ---------------------------------------------------------------- the suggestion's loadout

/** A line of the loadout orbiter's suggestion may carry (shards, Helminth, support weapons…). */
export interface LoadoutLine {
  label: string;
  text: string;
}

const LOADOUT_LABEL: Record<string, string> = { shards: "Archon shards", helminth: "Helminth", support: "Support weapons", weapons: "Weapons", arcanes: "Arcanes", companion: "Companion", focus: "Focus school", operator: "Operator", notes: "Notes" };
const titleCase = (k: string) => (LOADOUT_LABEL[k] ?? k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()));

/** One value of the loadout in words, whatever shape it has: a name, a list, an object with a name. */
function said(v: unknown): string {
  if (v == null || v === false) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(said).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const head = said(o.name ?? o.ability ?? o.school ?? o.title ?? (o.colour ? `${o.tauforged ? "Tauforged " : ""}${String(o.colour).replace(/^./, (c) => c.toUpperCase())}` : null));
    const tail = [o.stat, o.replaces ? `replaces ${said(o.replaces)}` : null, o.why ?? o.reason].map(said).filter(Boolean).join(", ");
    return [head, tail].filter(Boolean).join(head && tail ? ": " : "");
  }
  return "";
}

/** orbiter's suggestion's `loadout` (when the engine gives one) as labelled lines; empty without one. */
export function loadoutLines(loadout: unknown): LoadoutLine[] {
  if (!loadout || typeof loadout !== "object" || Array.isArray(loadout)) return [];
  return Object.entries(loadout as Record<string, unknown>)
    .map(([k, v]) => ({ label: titleCase(k), text: said(v) }))
    .filter((l) => l.text);
}

// ---------------------------------------------------------------- tags

/** The tags on a set of builds, each once, in the order first seen. */
export function tagsIn(builds: readonly Pick<Build, "tags">[]): string[] {
  const out: string[] = [];
  for (const b of builds) for (const t of b.tags ?? []) if (!out.includes(t)) out.push(t);
  return out;
}

/** The builds carrying every tag picked (none picked: all of them). Tags compare without case. */
export function withTags<T extends { build: Pick<Build, "tags"> }>(rows: readonly T[], picked: readonly string[]): T[] {
  if (!picked.length) return [...rows];
  const want = picked.map((t) => t.toLowerCase());
  return rows.filter((r) => {
    const has = (r.build.tags ?? []).map((t) => t.toLowerCase());
    return want.every((t) => has.includes(t));
  });
}

/** Tags typed in a box ("Steel Path, support; Nuke") as a clean list: trimmed, each once, at most 12. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(/[,;\n]/)) {
    const v = t.trim().replace(/\s+/g, " ").slice(0, 40);
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, 12);
}
