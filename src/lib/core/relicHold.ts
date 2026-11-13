// Your relics by era, for the relic plate on Relics and the Planner: how many you hold, and how
// many of them are radiant. Every relic in the inventory counts, ones the relic data doesn't know yet too:
// those are named from their path, so the era (and Radiant, for a Platinum one) is read from the path.
import { eraOfPath, ERAS, splitRelicName, type Model } from "./model";

export interface EraHold {
  era: string;
  total: number;
  radiant: number;
}

/**
 * Lith, Meso, Neo, Axi always (a zero says you have none); Requiem and Vanguard when you hold any.
 * A relic with neither a name nor a path that says its era is the one thing left out.
 */
export function relicsByEra(m: Model): EraHold[] {
  const by = new Map<string, EraHold>(ERAS.map((e) => [e, { era: e, total: 0, radiant: 0 }]));
  for (const [unique, rows] of m.inventoryByBase) {
    for (const r of rows) {
      if (r.category !== "relic" || r.quantity <= 0) continue;
      const split = splitRelicName(r.name);
      const e = (split && by.get(split.base.split(" ")[0])) || by.get(eraOfPath(unique) ?? "");
      if (!e) continue;
      e.total += r.quantity;
      if (split ? split.refinement === "Radiant" : /Platinum$/.test(unique)) e.radiant += r.quantity;
    }
  }
  return [...by.values()].filter((e) => e.total > 0 || ["Lith", "Meso", "Neo", "Axi"].includes(e.era));
}
