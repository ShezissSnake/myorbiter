// A line for recruiting chat to fill a squad for one relic: "H Axi C12 rad 4b4" is "hosting, Axi
// C12, radiant share, four by four" — everyone brings the same relic at the same refinement, and
// each picks the best of the four rewards. Intact relics share too ("int").

const SHORT: Record<string, string> = { Radiant: "rad", Flawless: "flaw", Exceptional: "exc", Intact: "int" };

/** `have`: players already in (you count as one); the line asks for the rest. */
export function recruitLine(base: string, refinement: string, have = 1): string {
  const r = SHORT[refinement] ?? refinement.toLowerCase();
  return `H ${base} ${r} ${Math.min(4, Math.max(1, have))}b4`;
}
