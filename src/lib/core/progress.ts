// A long list redrawn a slice at a time. When a table's rows change (a re-sort, a filter, a page
// opened), redrawing all fifty rows at once is one long task: the click waits for all of it, though
// only the first screenful is in sight. So the list moves to its new rows in steps: first the rows
// that fill the screen, then a few more each frame. Between steps, the rows below the new ones are
// those already drawn (still among the new rows, in their old places), so nothing below the screen
// is torn down only to be built again a frame later; the last step is exactly the new rows.

/**
 * The rows to draw on the way from `drawn` to `target`: target's first `upto` rows, then the rows
 * already drawn that are still in `target` and not among those, in the order they were drawn, never
 * more rows than `target` has. Once `upto` covers `target`, `target` itself. Returns `drawn` itself
 * when that's what it would draw anyway, so an unchanged list doesn't redraw.
 */
export function stepRows<T>(target: readonly T[], drawn: readonly T[], key: (r: T) => string, upto: number): readonly T[] {
  if (upto >= target.length) return same(target, drawn) ? drawn : target;
  const head = target.slice(0, Math.max(0, upto));
  const inHead = new Set(head.map(key));
  const wanted = new Set<string>();
  for (const r of target) wanted.add(key(r));
  const out = head;
  for (const r of drawn) {
    if (out.length >= target.length) break;
    const k = key(r);
    if (!inHead.has(k) && wanted.has(k)) out.push(r);
  }
  return same(out, drawn) ? drawn : out;
}

/** Whether a step drew everything: what's drawn is the target, row for row. */
export const settled = <T,>(target: readonly T[], drawn: readonly T[]) => same(target, drawn);

function same<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * How many rows fill the screen from a list whose top is at `top` (px from the window's top; less
 * than 0 once scrolled into it), at `rowHeight` a row, in a window `viewport` px tall: at least `min`.
 * A list out of sight (below the window, or not laid out: height 0) gets `min`.
 */
export function rowsInView(top: number, rowHeight: number, viewport: number, min = 8, laidOut = true): number {
  if (!laidOut || !(rowHeight > 0) || top >= viewport) return min;
  return Math.max(min, Math.ceil((viewport - top) / rowHeight) + 2);
}
