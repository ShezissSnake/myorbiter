// Find anything (Ctrl+K): what matches the text typed, best first. A name that starts with it,
// then one with a word that does, then one that holds it anywhere; shorter names first in each.

export function lookupHits<T extends { name: string }>(all: readonly T[], text: string, max = 12): T[] {
  // A run of spaces typed or pasted counts as one, as in the list filters.
  const q = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!q) return [];
  const rank = (n: string) => {
    const l = n.toLowerCase();
    if (l.startsWith(q)) return 0;
    if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    return l.includes(q) ? 2 : 3;
  };
  return all
    .map((h) => ({ h, r: rank(h.name) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.h.name.length - b.h.name.length || a.h.name.localeCompare(b.h.name))
    .slice(0, max)
    .map((x) => x.h);
}
