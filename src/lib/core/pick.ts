// Which reward to take on the void fissure reward screen.
//
// Each card gets four marks between 0 and 1, and the score is their weighted average (0–100):
//   plat      what it sells for, as a share of the best-selling card on the screen (at least 10p,
//             so 2p against 1p isn't treated like 40p against 20p)
//   needed    a part for something you haven't mastered or built, that you don't have enough of
//   ducats    its ducat value, out of 100 (the most a part is worth at Baro)
//   set       it finishes a set (1), or brings one to a single part away (0.5)
// The weights follow your priorities: plat, then unmastered, then ducats, then completing a set.

import type { Model } from "./model";
import { setRows } from "./views";

export interface PickWeights {
  plat: number;
  needed: number;
  ducats: number;
  set: number;
}

/** Each priority counts double the next: plat, then unmastered, then ducats, then completing a set. */
export const defaultPickWeights = (): PickWeights => ({ plat: 8, needed: 4, ducats: 2, set: 1 });

export interface PickCard {
  name: string;
  /** Where the name came from: TennoScope's reading of the screen, or the squad's relics. */
  price: number | null;
  ducats: number;
  needed: boolean;
  /** For what, when needed: "Kompressa Prime". */
  neededFor: string | null;
  /** 1: finishes a set, 0.5: leaves it one part short, 0: neither. */
  set: number;
  setName: string | null;
  marks: { plat: number; needed: number; ducats: number; set: number };
  score: number;
  /** Short reasons, most important first: "19p", "needed for Kompressa Prime", "45 ducats", "completes the set". */
  reasons: string[];
}

/** Below this, platinum differences between cards are small change. */
const PLAT_FLOOR = 10;

const norm = (s: string) => s.toLowerCase().replace(/\s+blueprint$/, "").replace(/\s+/g, " ").trim();

/** The model's name for a reward as TennoScope or a relic table spells it. */
export function resolveName(m: Model, raw: string): string {
  if (m.partByName.has(raw)) return raw;
  const want = norm(raw);
  for (const name of m.partByName.keys()) if (norm(name) === want) return name;
  return raw;
}

/** One more set's worth: what's missing, per prime item, after the sets you already have. */
function setGapsByPart(m: Model) {
  const byPart = new Map<string, { set: string; missing: number }>();
  for (const s of setRows(m)) {
    const missing = s.missing.reduce((n, x) => n + x.count, 0);
    if (missing === 0 || missing > 2) continue;
    for (const x of s.missing) byPart.set(x.name, { set: s.name, missing });
  }
  return byPart;
}

/**
 * `live`: prices by card name from the reward screen itself (what TennoScope's overlay shows,
 * checked on warframe.market moments ago). They win over the daily median, so the score and the
 * number on the card agree.
 */
export function scoreCards(m: Model, names: string[], w: PickWeights = defaultPickWeights(), live: Record<string, number> = {}): PickCard[] {
  const gaps = setGapsByPart(m);
  const base = names.map((raw) => {
    const name = resolveName(m, raw);
    const part = m.partByName.get(name)?.[0];
    const price = live[raw] ?? live[name] ?? m.price(name);
    const ducats = part?.ducats ?? 0;
    let needed = false;
    if (part) {
      const done = m.isMastered(part.parentUnique) || m.owned(part.parentUnique) > 0;
      needed = !done && m.partHave(name) < part.required;
    }
    const gap = gaps.get(name);
    const set = gap ? (gap.missing === 1 ? 1 : 0.5) : 0;
    return { name, price, ducats, needed, neededFor: needed && part ? part.parentName : null, set, setName: gap?.set ?? null };
  });
  const best = Math.max(0, ...base.map((c) => c.price ?? 0));
  const total = w.plat + w.needed + w.ducats + w.set || 1;
  return base.map((c) => {
    const marks = {
      plat: (c.price ?? 0) / Math.max(best, PLAT_FLOOR),
      needed: c.needed ? 1 : 0,
      ducats: Math.min(1, c.ducats / 100),
      set: c.set,
    };
    const score = Math.round((100 * (w.plat * marks.plat + w.needed * marks.needed + w.ducats * marks.ducats + w.set * marks.set)) / total);
    const reasons: string[] = [];
    if (c.price) reasons.push(`${Math.round(c.price)}p`);
    if (c.needed) reasons.push(`needed for ${c.neededFor}`);
    if (c.ducats) reasons.push(`${c.ducats} ducats`);
    if (c.set === 1) reasons.push(`completes ${c.setName}`);
    else if (c.set) reasons.push(`${c.setName} one part short`);
    return { ...c, marks, score, reasons };
  });
}

/** The card to take: highest score, then the better price. Null when there's nothing to choose. */
export function bestCard(cards: PickCard[]): number | null {
  let best: number | null = null;
  cards.forEach((c, i) => {
    if (best == null) return void (best = i);
    const b = cards[best];
    if (c.score > b.score || (c.score === b.score && (c.price ?? 0) > (b.price ?? 0))) best = i;
  });
  return best;
}
