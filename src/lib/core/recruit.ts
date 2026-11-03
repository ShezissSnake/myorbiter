// A line for recruiting chat to fill a squad for one relic: "H Axi C12 rad 4b4" is "hosting, Axi
// C12, radiant share, four by four" — everyone brings the same relic at the same refinement, and
// each picks the best of the four rewards. Intact relics share too ("int").

const SHORT: Record<string, string> = { Radiant: "rad", Flawless: "flaw", Exceptional: "exc", Intact: "int" };

/** The line, and with `have` (players already in, you counting as one) the head count after it ("2/4"). */
export function recruitLine(base: string, refinement: string, have?: number): string {
  const r = SHORT[refinement] ?? refinement.toLowerCase();
  return `H ${base} ${r} 4b4${have != null ? ` ${Math.min(4, Math.max(1, have))}/4` : ""}`;
}
