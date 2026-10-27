import type { Snippet } from "svelte";

// Building a number formatter is slow (toLocaleString makes a new one each call): keep one per precision.
const formats = new Map<number, Intl.NumberFormat>();
export function numberFormat(digits: number): Intl.NumberFormat {
  let f = formats.get(digits);
  if (!f) formats.set(digits, (f = new Intl.NumberFormat("en", { maximumFractionDigits: digits })));
  return f;
}

export interface Column<T> {
  key: string;
  label: string;
  value: (r: T) => string | number | null;
  /** Sort by this instead of `value` (e.g. a tier rank). */
  sortValue?: (r: T) => string | number | null;
  cell?: Snippet<[T]>;
  align?: "left" | "right" | "center";
  width?: string;
  title?: string;
  sortable?: boolean;
  defaultDesc?: boolean;
  muted?: boolean;
  /** Less important: hidden when the window is narrow. */
  minor?: boolean;
}

export const plat = (n: number | null | undefined) => (n == null ? null : `${Math.round(n * 10) / 10}p`);
export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? null : numberFormat(digits).format(n);

export function matches(query: string, ...fields: (string | null | undefined)[]) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** The colour a relic's era is drawn in ("Axi A1", "Lith C13 Radiant"...), for its artwork's frame. */
export function eraTint(relic: string): string | null {
  const era = relic.split(" ")[0]?.toLowerCase();
  return era && ["lith", "meso", "neo", "axi", "requiem"].includes(era) ? `var(--era-${era})` : null;
}

/** Rows in a column's order; blanks always last. Shared by tables and card grids. */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: { key: string; desc: boolean }): T[] {
  const col = columns.find((c) => c.key === sort.key) ?? columns[0];
  const get = col.sortValue ?? col.value;
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}
