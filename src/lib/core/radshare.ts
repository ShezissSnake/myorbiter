// A "4b4" (radshare when all four are radiant), said "4×4" on screen: four players cracking the same
// relic at the same refinement, so the squad's four cards are four rolls on one table. When the
// squad's relics from EE.log don't all match, say which ones are off.

const ORDER = ["Radiant", "Flawless", "Exceptional", "Intact"];

export interface ShareCheck {
  /** All four are the same relic at the same refinement. */
  matched: boolean;
  /** "4×4: four radiant Axi A1", or "Not 4×4: 1 intact Lith C13 differs". */
  text: string;
  /** No two of the four alike. */
  allDiffer: boolean;
  /** The relic and refinement most of the squad brought: "radiant Axi A1". */
  main: string;
  /** The ones that differ from it, grouped: "1 intact Lith C13". */
  off: string[];
}

/**
 * Null unless there are exactly four relics. The squad's main relic is the most common relic and
 * refinement among them (a tie goes to the better refinement); the rest are the odd ones out.
 */
export function shareCheck(relics: { name: string; refinement: string }[]): ShareCheck | null {
  if (relics.length !== 4) return null;
  const groups = new Map<string, { name: string; refinement: string; n: number; first: number }>();
  relics.forEach((r, i) => {
    const k = `${r.refinement}|${r.name}`;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { name: r.name, refinement: r.refinement, n: 1, first: i });
  });
  const rank = (ref: string) => (ORDER.indexOf(ref) + 5) % 5; // unknown refinements last
  const sorted = [...groups.values()].sort((a, b) => b.n - a.n || rank(a.refinement) - rank(b.refinement) || a.first - b.first);
  const label = (g: { name: string; refinement: string }) => `${g.refinement.toLowerCase()} ${g.name}`;
  const [top, ...rest] = sorted;
  if (!rest.length) return { matched: true, text: `4×4: four ${label(top)}`, main: label(top), off: [], allDiffer: false };
  // The odd ones out in squad order.
  const off = rest.sort((a, b) => a.first - b.first).map((g) => `${g.n} ${label(g)}`);
  // No two alike: nothing to measure the rest against.
  if (top.n === 1) return { matched: false, text: "Not 4×4: the squad's relics differ", main: label(top), off, allDiffer: true };
  const n = rest.reduce((a, g) => a + g.n, 0);
  return { matched: false, text: `Not 4×4: ${off.join(", ")} ${n === 1 ? "differs" : "differ"}`, main: label(top), off, allDiffer: false };
}
