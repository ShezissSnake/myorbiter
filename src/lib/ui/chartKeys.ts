// A chart's readings by keyboard (TimeChart): Left and Right step a day at a time, Home and End go
// to the first and the last reading. A chart may hold several readings a day (Stats) or one (price
// history): a step goes to the nearest reading at least a day away, or, with none that far, to the
// last reading on that side.

const DAY = 86_400_000;

/**
 * The reading a key moves to from reading `from` (an index into `at`, or null for none shown yet,
 * which starts at the latest): an index into `at` among `idx` (the readings the chart draws, in
 * time order), or null when the key moves nothing.
 */
export function chartKey(key: string, at: number[], idx: number[], from: number | null): number | null {
  if (!idx.length) return null;
  const first = idx[0];
  const last = idx[idx.length - 1];
  const moved = (to: number) => (to === from ? null : to);
  if (key === "Home") return moved(first);
  if (key === "End") return moved(last);
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  if (from == null || !idx.includes(from)) return last;
  const t = at[from];
  if (key === "ArrowRight") return moved(idx.find((i) => at[i] >= t + DAY) ?? last);
  let to = first;
  for (const i of idx) if (at[i] <= t - DAY) to = i;
  return moved(to);
}
