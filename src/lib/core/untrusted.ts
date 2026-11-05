// Text orbiter didn't write: build titles and authors from Overframe's list and Nox's Frame's
// pages, names from warframe.market, what a player types into a bug report. Svelte shows it as text
// (never as HTML), so it can't run; these keep it from hiding anything either. Characters that
// draw nothing (zero-width, the Unicode "tag" block) or reorder what's around them (bidi overrides
// and isolates) can make a title read differently from what it holds, or carry text nobody sees.

/**
 * Zero-width and joiners, bidi embeddings, overrides and isolates, word joiner and invisible
 * operators, BOM, soft hyphen, Mongolian vowel separator, combining grapheme joiner, Hangul
 * fillers, the "tag" block and the supplementary variation selectors. Emoji keep their variation
 * selector (U+FE0F); the zero-width joiner stays only between two emoji (LONE_ZWJ).
 */
export const HIDDEN_CHARS = /[\u00AD\u034F\u115F\u1160\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
/** The zero-width joiner, kept between two emoji (it joins them into one, as in a family emoji) and removed anywhere else. */
const LONE_ZWJ = /(?<!\p{Extended_Pictographic}\uFE0F?)\u200D|\u200D(?!\p{Extended_Pictographic})/gu;
/** C0 and C1 controls but tab and newline. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Half of a surrogate pair on its own: no character at all. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * The text with every hidden and control character taken out (newlines and tabs stay). Lone
 * surrogate halves go first, and it repeats until nothing changes: otherwise a zero-width
 * character between the two halves of a hidden one (U+E0041 as \uDB40 \u200B \uDC41) would
 * join them back into it as it's taken out.
 */
export function stripHidden(s: string): string {
  let out = s.replace(/\r\n?/g, "\n");
  for (;;) {
    const next = out.replace(LONE_SURROGATE, "").replace(HIDDEN_CHARS, "").replace(LONE_ZWJ, "").replace(CONTROL, "");
    if (next === out) return out;
    out = next;
  }
}

/** Whether the text holds a character `stripHidden` would take out. */
export const hasHidden = (s: string): boolean => stripHidden(s) !== s.replace(/\r\n?/g, "\n");

/**
 * A one-line field from outside: a string, cleaned of hidden characters, its whitespace folded to
 * single spaces, trimmed and cut to `max` characters (by code point, so an emoji is never split).
 * Null when it isn't a string or nothing is left.
 */
export function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = stripHidden(v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : s;
}

/** Like `cleanLine`, keeping line breaks (at most two blank lines in a row). */
export function cleanBlock(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = stripHidden(v).replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim();
  if (!s) return null;
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : s;
}

/**
 * HTML comments, which a page that renders Markdown hides (an unfinished one hides the rest).
 * Taken out until none is left: removing one can join the text around it into another
 * ("<!<!-- x -->-- y -->"). Hidden characters inside "<!--" have to go first (stripHidden).
 */
export function stripHtmlComments(s: string): string {
  for (;;) {
    const next = s.replace(/<!--[\s\S]*?(-->|$)/g, "");
    if (next === s) return s;
    s = next;
  }
}
