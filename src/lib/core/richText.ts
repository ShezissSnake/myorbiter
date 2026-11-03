// orbiter's own prose (What's New, the Guide) the way the wiki writes it: a page's name becomes a
// link to it, with its sidebar icon, and the game's currencies and resources carry their icon.
// Only the first mention of each in a block, so a paragraph doesn't turn into a row of icons.

export type RichPiece =
  | { kind: "text"; text: string }
  | { kind: "page"; text: string; page: string }
  | { kind: "icon"; text: string; icon: string };

/** Game words and the icon they carry (public/game). Case-sensitive unless marked. */
export const RICH_TERMS: { word: string; icon: string; any?: boolean }[] = [
  { word: "platinum", icon: "platinum", any: true },
  { word: "ducats", icon: "ducats", any: true },
  { word: "ducat", icon: "ducats", any: true },
  { word: "credits", icon: "credits", any: true },
  { word: "Endo", icon: "endo" },
  { word: "Kuva", icon: "kuva" },
  { word: "Regal Aya", icon: "regal-aya" },
  { word: "Aya", icon: "aya" },
  { word: "Void Traces", icon: "void-traces" },
  { word: "Vosfor", icon: "vosfor" },
  { word: "Steel Essence", icon: "steel-essence" },
  { word: "Archon Shard", icon: "archon-shard" },
  { word: "Archon Hunt", icon: "archon-hunt" },
  { word: "Mastery Rank", icon: "mastery" },
  { word: "Nightwave", icon: "nightwave" },
  { word: "Sortie", icon: "sortie" },
  { word: "Baro", icon: "baro" },
  { word: "Varzia", icon: "varzia" },
  { word: "Teshin", icon: "steel-essence" },
  { word: "Kahl's Garrison", icon: "kahl" },
  { word: "Duviri", icon: "duviri" },
  { word: "Archimedea", icon: "cavia" },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Splits text into plain runs, page links and icon words. `pages`: page labels and where each
 * goes ("Prime parts" → "parts"). A page's name only counts as a whole word, capitalised as the
 * sidebar has it, and "Mastery Rank" stays the game's word, not the Mastery page.
 */
export function richPieces(text: string, pages: { label: string; id: string }[]): RichPiece[] {
  const alts: { re: string; piece: (m: string) => RichPiece; key: string }[] = [];
  for (const t of RICH_TERMS) alts.push({ re: t.any ? `(?i:${esc(t.word)})` : esc(t.word), key: `icon:${t.icon}:${t.word.toLowerCase()}`, piece: (m) => ({ kind: "icon", text: m, icon: t.icon }) });
  for (const p of pages) alts.push({ re: esc(p.label), key: `page:${p.id}`, piece: (m) => ({ kind: "page", text: m, page: p.id }) });
  // Longest first, so "Regal Aya" wins over "Aya" and "Prime parts" over anything shorter.
  alts.sort((a, b) => b.re.length - a.re.length);
  // JavaScript has no inline (?i:…): case-insensitive words are matched by trying both cases of the first letter.
  const source = alts.map((a) => `(${a.re.replace(/^\(\?i:(.)(.*)\)$/, (_, f: string, r: string) => `[${f.toLowerCase()}${f.toUpperCase()}]${r}`)})`).join("|");
  const re = new RegExp(`(?<![\\w'])(?:${source})(?![\\w]|\\s+Rank\\b)`, "g");
  const out: RichPiece[] = [];
  const used = new Set<string>();
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.slice(1).findIndex((g) => g !== undefined);
    const alt = alts[i];
    if (!alt || used.has(alt.key)) continue;
    used.add(alt.key);
    if (m.index! > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    out.push(alt.piece(m[0]));
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}
