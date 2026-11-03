// The Collection pages' showcase (ui/Showcase.svelte): the few things a page puts on display, the
// way the Arsenal shows gear. Its most valuable spares, by the page's own figure (Worth selling,
// Spare value); with nothing spare, the most valuable things you hold, so the stage is never bare.

export type ShowcaseMode = "spares" | "held" | "empty";

export interface ShowcasePick<T> {
  /** The row that stands for the item (of several rows of one item, the one with the most spare). */
  row: T;
  /** What its spares are worth (spares), or the figure it was picked by (held). */
  value: number;
}

export interface ShowcaseOptions<T> {
  /** What the row's spares are worth on the page; null or under 1 is nothing to show. */
  spare: (r: T) => number | null | undefined;
  /** With no spares at all, what a row is ranked by among the things you hold; null: not held. */
  held?: (r: T) => number | null | undefined;
  /** For ties, and as the item when `key` isn't given. */
  name: (r: T) => string;
  /** Rows of one item (a mod at two ranks, an arcane's maxed and loose copies): one place on the stage, their spares added up. */
  key?: (r: T) => string;
  /** How many places on the stage. */
  n?: number;
}

/** The pieces on display, and whether they're spares or, with none, what you hold. */
export function pickShowcase<T>(rows: readonly T[], o: ShowcaseOptions<T>): { mode: ShowcaseMode; items: ShowcasePick<T>[] } {
  const n = o.n ?? 5;
  const key = o.key ?? o.name;
  const rank = (get: (r: T) => number | null | undefined, sum: boolean): ShowcasePick<T>[] => {
    const by = new Map<string, { row: T; best: number; value: number }>();
    for (const r of rows) {
      const v = get(r);
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      const k = key(r);
      const g = by.get(k);
      if (!g) by.set(k, { row: r, best: v, value: v });
      else {
        g.value = sum ? g.value + v : Math.max(g.value, v);
        if (v > g.best) {
          g.best = v;
          g.row = r;
        }
      }
    }
    return [...by.values()]
      .filter((g) => !sum || g.value >= 1)
      .sort((a, b) => b.value - a.value || o.name(a.row).localeCompare(o.name(b.row)))
      .slice(0, n)
      .map((g) => ({ row: g.row, value: g.value }));
  };
  const spares = rank(o.spare, true);
  if (spares.length) return { mode: "spares", items: spares };
  const held = o.held ? rank(o.held, false) : [];
  return held.length ? { mode: "held", items: held } : { mode: "empty", items: [] };
}
