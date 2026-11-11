// The help list and its lookups: which walk-through a part's "?" opens, and at which page.

import type { HelpPage, Shot, Walkthrough } from "./types";
import { TRADE } from "./trade";
import { FISSURES } from "./fissures";
import { PENDING } from "./pending";

export type { HelpPage, Mark, Shot, Step, Walkthrough } from "./types";

/** Every walk-through, written ones first. */
export const WALKTHROUGHS: Walkthrough[] = [...TRADE, ...FISSURES, ...PENDING];

export const walkthroughById: Record<string, Walkthrough> = Object.fromEntries(WALKTHROUGHS.map((w) => [w.id, w]));

const byPart = new Map<string, { id: string; page: number }>();
for (const w of WALKTHROUGHS) for (const [part, page] of Object.entries(w.covers)) byPart.set(part, { id: w.id, page });

/** The walk-through a part's "?" opens and the page about that part (0-based), or null for an unknown part. */
export function forPart(part: string): { wt: Walkthrough; at: number } | null {
  const hit = byPart.get(part);
  if (!hit) return null;
  const wt = walkthroughById[hit.id];
  return { wt, at: Math.min(Math.max(0, hit.page - 1), wt.pages.length - 1) };
}

/** The file a page's picture is kept in, under public/help/. */
export const pictureFile = (wt: Walkthrough, i: number) => `${wt.id}-${i + 1}.webp`;

/** The limits every page keeps (tests/help.test.ts): short heading, few short lines. */
export const LIMITS = { titleWords: 6, lines: 4, lineWords: 16, pageWords: 60, marks: 4, pages: [1, 5] as const };

export const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

// The picture's definition, for the manifest: a page's picture is taken again whenever this
// changes. Only what the picture shows counts (where, the clicks, the piece, the marks, the
// window), not the words beside it. FNV-1a over the definition's canonical JSON, twice with
// different starts: 16 hex digits, the same in the app, the tests and the picture script.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
export function shotHash(shot: Shot): string {
  const s = canonical(shot);
  return fnv(s, 0x811c9dc5) + fnv(s, 0x2b2ae3a1);
}

/** Every page that has a picture, with its file and hash. */
export function pictures(): { wt: Walkthrough; i: number; page: HelpPage; shot: Shot; file: string; hash: string }[] {
  const out = [];
  for (const wt of WALKTHROUGHS) {
    for (const [i, page] of wt.pages.entries()) if (page.shot) out.push({ wt, i, page, shot: page.shot, file: pictureFile(wt, i), hash: shotHash(page.shot) });
  }
  return out;
}
