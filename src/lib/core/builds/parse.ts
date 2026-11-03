// Reading a build from pasted text: a build page copied whole, a list in a message, a line in chat.
//
// The text is read line by line. Labels ("Aura:", "Exilus:", "Arcanes:", "Shards:", "Helminth:")
// say what follows; forma counts, "Orokin Reactor/Catalyst", adapters, Archon Shards, Helminth
// ("Nourish replacing Molt") and the game update are taken out wherever they are; what's left is
// split at commas, semicolons, bullets and the like, and each piece is read for mod and arcane
// names (longest first), with any rank next to them ("R10", "rank 5", "(3/5)", "[10]", "max").
// Pieces that look like a name but aren't one come back unmatched, with suggestions: nothing is
// guessed silently.

import type { CatalogItem } from "../types";
import { gearKindOf, slotLayout } from "./gear";
import { matchName, nameIndex, normName, type Matched, type NameIndex, type Unmatched } from "./match";
import { canonicalTag, onlyTags, tagsInText } from "./tags";
import { newBuildId, type Build, type BuildHelminth, type BuildShard, type BuildSourceRef, type GearKind, type ShardColour } from "./types";

export type SlotRole = "aura" | "exilus" | "stance" | "mod" | "arcane";

/** A name read and matched: where it went, at what rank (null: max). */
export type ReadName = Matched & { as: SlotRole; rank: number | null };

export interface PasteResult {
  /** The build as read: source "pasted" unless given, not saved anywhere yet. */
  build: Build;
  /** Every mod and arcane read, in order. */
  matched: ReadName[];
  /** Pieces that look like names but match nothing that fits (with suggestions). */
  unmatched: Unmatched[];
  /** Matched but not placed: a second aura, more mods than slots, a name given twice. */
  leftOut: { name: string; path: string; why: string }[];
  /** Things worth saying: what was assumed, what was skipped (a riven, notes). */
  notes: string[];
}

export interface PasteOptions {
  now?: number;
  /** The kind of gear, when the item's catalog entry doesn't say (an exalted weapon). */
  kind?: GearKind;
  title?: string;
  source?: BuildSourceRef;
  /** Copies you hold of a path (heldCount): between same-name catalog entries, the one you have wins. */
  held?: (path: string) => number;
}

const LABEL = /^\s*(?:[-*•·▪►>]+\s*|\d{1,2}\s*[.)]\s*)?(aura|exilus|stance|arcanes?|mods?|archon\s+shards?|shards?|helminth|subsumed?|slot\s*\d{1,2}|forma|notes?|description|tags?)\s*(?:\([^)]*\))?\s*[:\-–—=]\s*/i;
const BULLET = /^\s*(?:[-*•·▪►>]+|\d{1,2}\s*[.)])\s*/;
const RANK = /\b(?:r|rank|lvl|lv|level)\s*[:.]?\s*(\d{1,2})\b|\((\d{1,2})\s*\/\s*\d{1,2}\)|\[(\d{1,2})\]|\b(max(?:ed)?(?:\s+rank)?|unranked)\b/gi;
const SHARD = /(?:(\d)\s*[x×]\s*)?(tauforged\s+)?(crimson|azure|amber|violet|topaz|emerald)(?:\s+archon)?\s+shards?(?:\s*[x×]\s*(\d))?(?:\s*(?::|=|-|–|—|→|->|\(|\bfor\b)\s*([^,;()\n]*[^,;()\n\s]))?\)?/gi;
const SHARD_LOOSE = /(?:(\d)\s*[x×]\s*)?(tauforged\s+)?(crimson|azure|amber|violet|topaz|emerald)\b(?:\s*[x×]\s*(\d))?(?:\s*(?::|=|-|–|—|→|->|\()\s*([^,;()\n]*[^,;()\n\s]))?\)?/gi;
const HELMINTH = /([A-Za-z][\w'’ ]*?)\s+(?:replac(?:es|ing|ed)|in place of|instead of|over|on|→|->)\s+([A-Za-z0-9][\w'’ ]*?)(?=\s*(?:[,;.)(]|$))/i;
/** Words around names that aren't names. */
const FILLER = new Set(["and", "or", "the", "a", "an", "for", "with", "on", "in", "to", "of", "my", "your", "x", "slot", "slots", "mod", "mods", "arcane", "arcanes", "build", "optional", "alt", "alternative", "alternatively", "core", "recommended", "swap", "replace", "instead", "use", "using", "if", "you", "have", "need", "flex", "then", "also", "plus", "is", "it", "this", "can", "be", "any", "other", "e", "g", "eg", "i", "e.g", "etc", "no", "not", "yes", "maybe"]);

const blank = (s: string, start: number, end: number) => s.slice(0, start) + " ".repeat(end - start) + s.slice(end);

/** Takes out every match of `re` (global) from `s`, calling `f` for each; returns what's left. */
function takeAll(s: string, re: RegExp, f: (m: RegExpExecArray) => void): string {
  re.lastIndex = 0;
  let out = s;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    f(m);
    out = blank(out, m.index, m.index + m[0].length);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

interface Token {
  norm: string;
  start: number;
  end: number;
  cap: boolean;
}

function tokens(s: string): Token[] {
  const out: Token[] = [];
  const re = /[^\s()[\]{}:"“”,;|]+/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const parts = normName(m[0]).split(" ").filter(Boolean);
    for (const p of parts) out.push({ norm: p, start: m.index, end: m.index + m[0].length, cap: /^[A-Z0-9]/.test(m[0].replace(/^[^A-Za-z0-9]+/, "")) });
  }
  return out;
}

/** Whether a normalised phrase is a name (exactly, Flawed, or through an alias matchName knows). */
function known(phrase: string, idx: NameIndex): boolean {
  const k = phrase.startsWith("flawed ") ? phrase.slice(7) : phrase;
  if (idx.byName.has(k)) return true;
  if (/^prime (?!d)/.test(k) && idx.byName.has(k.replace(/^prime /, "primed "))) return true;
  if (/^umbra (?!l)/.test(k) && idx.byName.has(k.replace(/^umbra /, "umbral "))) return true;
  if (/^galv /.test(k) && idx.byName.has(k.replace(/^galv /, "galvanized "))) return true;
  if (/^galvanised /.test(k) && idx.byName.has(k.replace(/^galvanised /, "galvanized "))) return true;
  // "Energize" for Arcane Energize, but not one short common word on its own.
  if (k.length > 5 && idx.byName.get(`arcane ${k}`)?.some((c) => c.category === "Arcanes")) return true;
  return false;
}

const COLOURS: ShardColour[] = ["crimson", "azure", "amber", "violet", "topaz", "emerald"];

/** Reads pasted text into a build for `item`. `catalog`: the model's catalogByUnique (or the catalog list). */
export function parsePaste(text: string, item: CatalogItem, catalog: ReadonlyMap<string, CatalogItem> | readonly CatalogItem[], opts: PasteOptions = {}): PasteResult {
  const kind = opts.kind ?? gearKindOf(item);
  if (!kind) throw new Error(`${item.name} takes no build`);
  const idx = nameIndex(catalog);
  const ownWords = [item.name, item.name.replace(/\s+(Prime|Umbra|Vandal|Wraith|Prisma)$/, ""), ...(item.abilities ?? []).map((a) => a.name)].map(normName).filter(Boolean);
  const layout = slotLayout(kind);
  const now = opts.now ?? Date.now();
  const read: { m: Matched; role: SlotRole; rank: number | null }[] = [];
  const unmatched: Unmatched[] = [];
  const notes: string[] = [];
  const shards: BuildShard[] = [];
  let helminth: BuildHelminth | null = null;
  // Set inside callbacks: typed wide so the checker doesn't narrow them to their first value.
  let forma = null as number | null;
  let umbraForma = 0 as number;
  let catalyst = null as boolean | null;
  const adapters: { exilus?: boolean; arcane?: boolean } = {};
  let gameUpdate = undefined as string | undefined;
  const labelTags: string[] = [];

  const addShards = (m: RegExpExecArray) => {
    const n = Math.min(5, Math.max(1, Number(m[1] ?? m[4] ?? 1)));
    const colour = m[3].toLowerCase() as ShardColour;
    if (!COLOURS.includes(colour)) return;
    const stat = m[5]?.trim();
    for (let i = 0; i < n; i++) shards.push({ colour, tauforged: !!m[2], ...(stat ? { stat } : {}) });
  };

  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    if (!line.trim()) continue;
    let label: string | null = null;
    const lm = LABEL.exec(line);
    if (lm) {
      label = lm[1].toLowerCase().replace(/^archon\s+/, "").replace(/^(arcane|mod|shard)s$/, "$1").replace(/\s*\d+$/, "");
      line = line.slice(lm[0].length);
    }
    if (label === "note" || label === "notes" || label === "description") continue;
    if (label === "tag" || label === "tags") {
      for (const t of line.split(/[,;|]/)) if (t.trim()) labelTags.push(canonicalTag(t).slice(0, 40));
      continue;
    }

    // Taken out wherever they are.
    line = takeAll(line, /\b(?:update|u)\s*(\d{2}(?:\.\d{1,2}){0,2})\b/gi, (m) => (gameUpdate ??= m[1]));
    line = takeAll(line, /(\d{1,2})\s*[x×]?\s*(umbral?\s+)?formas?\b/gi, (m) => {
      if (m[2]) umbraForma = Math.max(umbraForma, Number(m[1]));
      else forma = Math.max(forma ?? 0, Number(m[1]));
    });
    line = takeAll(line, /\b(umbral?\s+)?formas?\s*[:x×]\s*(\d{1,2})\b/gi, (m) => {
      if (m[1]) umbraForma = Math.max(umbraForma, Number(m[2]));
      else forma = Math.max(forma ?? 0, Number(m[2]));
    });
    if (label === "forma") {
      const n = /^\s*(\d{1,2})\b/.exec(line);
      if (n) forma = Math.max(forma ?? 0, Number(n[1]));
      continue;
    }
    line = takeAll(line, /\b(?:no|without|w\/o|doesn'?t need(?: an?)?)\s+(?:an?\s+)?(?:orokin\s+)?(?:reactor|catalyst|potato)\b/gi, () => (catalyst = false));
    line = takeAll(line, /\b(?:orokin\s+)?(?:reactor|catalyst)\b|\bpotato(?:ed)?\b/gi, () => (catalyst ??= true));
    line = takeAll(line, /\bexilus\s+(?:warframe\s+|weapon\s+)?adapter\b/gi, () => (adapters.exilus = true));
    line = takeAll(line, /\b(?:(?:primary|secondary|melee|amp|arch-?gun)\s+)?arcane\s+adapter\b/gi, () => (adapters.arcane = true));
    line = takeAll(line, SHARD, addShards);
    if (label === "shard") {
      line = takeAll(line, SHARD_LOOSE, addShards);
      continue;
    }
    if (label === "helminth" || label === "subsume" || label === "subsumed" || /helminth|subsum|replac|instead of|in place of/i.test(line)) {
      const h = HELMINTH.exec(line);
      if (h) {
        const ability = h[1].replace(/^(?:helminth|subsume[ds]?|use|with)\s+/i, "").trim();
        const replaces = abilityName(item, h[2].trim());
        if (kind !== "warframe") notes.push(`Helminth (${ability}) is only for warframes: left out.`);
        else {
          helminth = { ability, replaces: replaces.name };
          if (!replaces.known && item.abilities?.length) notes.push(`${replaces.name} isn't one of ${item.name}'s abilities as orbiter knows them: check the Helminth line.`);
        }
        line = blank(line, h.index, h.index + h[0].length);
      } else if (label === "helminth" || label === "subsume" || label === "subsumed") {
        notes.push(`Couldn't read the Helminth line "${raw.trim()}": say it as "Ability replacing Ability".`);
        continue;
      }
    }

    const role: SlotRole | null = label === "aura" || label === "exilus" || label === "stance" ? label : label === "arcane" ? "arcane" : null;
    for (let chunk of line.split(/[,;|\t•·]|\s[-–—]\s|\s\/\s|\s\+\s/)) {
      chunk = chunk.replace(BULLET, "");
      if (!chunk.trim()) continue;
      let chunkRole = role;
      if (/\(\s*exilus\s*\)|\bexilus\b/i.test(chunk)) {
        chunkRole = "exilus";
        chunk = chunk.replace(/\(\s*exilus\s*\)|\bexilus\b/gi, (s) => " ".repeat(s.length));
      }
      if (/\briven\b/i.test(chunk)) {
        if (!notes.includes("A riven was listed: orbiter doesn't check rivens.")) notes.push("A riven was listed: orbiter doesn't check rivens.");
        continue;
      }
      // Ranks, by where they sit, then blanked so they aren't read as names.
      const ranks: { at: number; rank: number | null }[] = [];
      chunk = takeAll(chunk, RANK, (m) => ranks.push({ at: m.index, rank: m[4] ? (/unranked/i.test(m[4]) ? 0 : null) : Number(m[1] ?? m[2] ?? m[3]) }));
      const toks = tokens(chunk);
      if (!toks.length) continue;
      const prose = toks.length > 8 && !label;
      // Names, longest first from each word. A real name that doesn't fit this gear is still a
      // name: it's reported, and its words aren't read again.
      const spans: { from: number; to: number; m: Matched | null }[] = [];
      for (let i = 0; i < toks.length; ) {
        let len = Math.min(idx.maxWords + 2, toks.length - i);
        for (; len >= 1; len--) {
          const ws = toks.slice(i, i + len);
          // In a sentence, a one-word name counts only when it's written with a capital ("Rage", not "rage").
          if (prose && len === 1 && !ws[0].cap) continue;
          if (len === 1 && FILLER.has(ws[0].norm)) continue;
          if (known(ws.map((t) => t.norm).join(" "), idx)) break;
        }
        if (len < 1) {
          i++;
          continue;
        }
        const m = matchName(chunk.slice(toks[i].start, toks[i + len - 1].end), idx, item, kind, "any", opts.held);
        if (!m.ok) unmatched.push(m);
        spans.push({ from: i, to: i + len, m: m.ok ? m : null });
        i += len;
      }
      // What's left between names: unmatched if it looks like a name of its own.
      if (!prose) {
        let i = 0;
        const runs: Token[][] = [];
        let run: Token[] = [];
        for (const s of [...spans, { from: toks.length, to: toks.length, m: null }]) {
          for (; i < s.from; i++) run.push(toks[i]);
          if (run.length) runs.push(run);
          run = [];
          i = s.to;
        }
        for (const r of runs) {
          const words = r.filter((t) => !FILLER.has(t.norm) && /[a-z]/.test(t.norm));
          if (!words.length) continue;
          const looksLikeName = (spans.length === 0 && r.length <= 6) || (words.some((t) => t.cap) && r.length <= 5);
          if (!looksLikeName) continue;
          // The item's own name or one of its abilities: a title or a description, not a mod.
          const runText = ` ${r.map((t) => t.norm).join(" ")} `;
          if (ownWords.some((w) => runText.includes(` ${w} `))) continue;
          // Only tag words ("Steel Path nuke"): what the build is for, not a mod.
          if (onlyTags(chunk.slice(r[0].start, r[r.length - 1].end))) continue;
          // Without the filler at either end, or a trailing "?" or "!".
          const first = r.findIndex((t) => !FILLER.has(t.norm));
          const last = r.length - 1 - [...r].reverse().findIndex((t) => !FILLER.has(t.norm));
          const textRun = chunk.slice(r[first].start, r[last].end).trim().replace(/[?!.…]+$/, "");
          const m = matchName(textRun, idx, item, kind, "any", opts.held);
          if (!m.ok) unmatched.push(m);
          else spans.push({ from: toks.indexOf(r[0]), to: toks.indexOf(r[r.length - 1]) + 1, m });
        }
      }
      const found = spans.filter((s): s is { from: number; to: number; m: Matched } => !!s.m).sort((a, b) => a.from - b.from);
      for (const s of found) {
        const own = ranks.filter((r) => nearest(found, toks, r.at) === s);
        const rank = own.length ? own[own.length - 1].rank : null;
        const it = s.m.item;
        const r: SlotRole =
          it.category === "Arcanes" ? "arcane"
          : (it.compatName ?? "").toUpperCase() === "AURA" ? "aura"
          : it.type === "Stance Mod" ? "stance"
          : chunkRole === "exilus" ? "exilus"
          : "mod";
        read.push({ m: s.m, role: r, rank: rank != null && it.maxRank != null ? Math.min(rank, it.maxRank) : rank });
      }
    }
  }

  // Into slots, in the order read.
  const build: Build = {
    id: newBuildId(now),
    item: item.uniqueName,
    kind,
    mods: [],
    arcanes: [],
    shards: shards.slice(0, 5),
    source: opts.source ?? "pasted",
    importedAt: now,
  };
  if (opts.title) build.title = opts.title;
  // Tags: a "Tags:" line as written, then the tags the title and text name.
  const tags = [...labelTags, ...tagsInText(text, opts.title)].filter((t, k, all) => all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === k).slice(0, 12);
  if (tags.length) build.tags = tags;
  const leftOut: PasteResult["leftOut"] = [];
  const matched: ReadName[] = [];
  const used = new Set<string>();
  const place = (x: (typeof read)[number], as: SlotRole) => {
    const mod = x.rank == null ? { path: x.m.path } : { path: x.m.path, rank: x.rank };
    if (as === "aura" || as === "exilus" || as === "stance") build[as] = mod;
    else if (as === "arcane") build.arcanes.push(mod);
    else build.mods.push(mod);
    matched.push({ ...x.m, as, rank: x.rank });
  };
  const exilusFree = () => layout.exilus && !build.exilus;
  for (const x of read) {
    if (used.has(x.m.path)) {
      if (!leftOut.some((l) => l.path === x.m.path)) leftOut.push({ name: x.m.name, path: x.m.path, why: "listed twice" });
      continue;
    }
    used.add(x.m.path);
    const out = (why: string) => leftOut.push({ name: x.m.name, path: x.m.path, why });
    if (x.role === "aura") layout.aura && !build.aura ? place(x, "aura") : out(layout.aura ? "a second aura" : "no aura slot");
    else if (x.role === "stance") layout.stance && !build.stance ? place(x, "stance") : out(layout.stance ? "a second stance" : "no stance slot");
    else if (x.role === "arcane") build.arcanes.length < layout.arcanes ? place(x, "arcane") : out(layout.arcanes ? `only ${layout.arcanes} arcane slot${layout.arcanes === 1 ? "" : "s"}` : "no arcane slot");
    else if (x.role === "exilus" && exilusFree()) place(x, "exilus");
    else if (build.mods.length < layout.mods) place(x, "mod");
    else if (exilusFree()) {
      place(x, "exilus");
      notes.push(`More mods than ${layout.mods} slots: ${x.m.name} was put in the exilus slot. Check it's one that goes there.`);
    } else out(`no slot left (${layout.mods} mod slots)`);
  }
  while (build.mods.length < layout.mods) build.mods.push(null);
  if (forma != null || umbraForma) build.forma = (forma ?? 0) + umbraForma;
  if (umbraForma) notes.push(`${umbraForma} of the Forma ${umbraForma === 1 ? "is" : "are"} Umbra Forma.`);
  if (catalyst != null) build.catalyst = catalyst;
  if (adapters.exilus || adapters.arcane) build.adapters = adapters;
  if (helminth) build.helminth = helminth;
  if (gameUpdate) build.gameUpdate = gameUpdate;
  if (shards.length > 5) notes.push(`${shards.length} Archon Shards listed: a warframe takes five, the first five were kept.`);
  if (shards.length && kind !== "warframe") notes.push("Archon Shards go on warframes only.");
  return { build, matched, unmatched: dedupe(unmatched), leftOut, notes };
}

/** The matched name a rank at `at` belongs to: the closest one before it, else the first after. */
function nearest<T extends { from: number; to: number }>(spans: T[], toks: Token[], at: number): T | null {
  let before: T | null = null;
  let after: T | null = null;
  for (const s of spans) {
    const end = toks[s.to - 1].end;
    if (end <= at) before = s;
    else if (!after && toks[s.from].start >= at) after = s;
  }
  return before ?? after;
}

function dedupe(xs: Unmatched[]): Unmatched[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = normName(x.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** An ability of the item by name or number ("3", "third", "ability 2"), as the catalog writes it. */
function abilityName(item: CatalogItem, text: string): { name: string; known: boolean } {
  const abilities = item.abilities ?? [];
  const ord: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 };
  const n = /^(?:ability\s*)?(\d|first|second|third|fourth|1st|2nd|3rd|4th)(?:\s+ability)?$/i.exec(text);
  if (n) {
    const i = (ord[n[1].toLowerCase()] ?? Number(n[1])) - 1;
    if (abilities[i]) return { name: abilities[i].name, known: true };
  }
  const k = normName(text);
  const a = abilities.find((x) => normName(x.name) === k);
  return a ? { name: a.name, known: true } : { name: text, known: false };
}
