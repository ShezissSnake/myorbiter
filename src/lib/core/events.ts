// Events running in game, from the worldstate: Tactical Alerts, operations, seasonal events.
import type { WorldEvent } from "./types";

export interface EventView {
  id: string;
  name: string;
  /** What to do, when the game says it in words (not a text key it forgot to fill in). */
  note: string | null;
  where: string | null;
  ends: string;
  /** What it pays, along the way and at the end ("Pumpkin Melee Dangle", "3 × Forma", "50,000 credits"). */
  rewards: string[];
  /** Community or personal progress, when it counts toward a goal. */
  progress: { at: number; of: number } | null;
}

/** The game's text keys sometimes come through untranslated: "Road To Tau Event Name". */
const untranslated = (s: string) => /\b(Event Name|Event Desc|Desc|Name)$/.test(s.trim());

const rewardsOf = (r: { items?: string[]; countedItems?: { type: string; count: number }[]; credits?: number } | undefined): string[] => [
  ...(r?.countedItems ?? []).map((c) => (c.count > 1 ? `${c.count.toLocaleString("en")} × ${c.type}` : c.type)),
  // Items carries the counted ones again, by name: only those it adds.
  ...(r?.items ?? []).filter((i) => !(r?.countedItems ?? []).some((c) => c.type === i)),
  ...(r?.credits ? [`${r.credits.toLocaleString("en")} credits`] : []),
];

export function eventViews(events: WorldEvent[] | null | undefined, now = Date.now()): EventView[] {
  return (events ?? [])
    .filter((e) => Date.parse(e.expiry) > now && (!e.activation || Date.parse(e.activation) <= now))
    .map((e) => {
      const name = e.description.replace(/\s+Event Name$/, "").trim();
      const rewards = [...new Set([...(e.interimSteps ?? []).flatMap((s) => rewardsOf(s.reward)), ...(e.rewards ?? []).flatMap(rewardsOf)])];
      const of = e.maximumScore ?? 0;
      return {
        id: e.id,
        name,
        note: e.tooltip && !untranslated(e.tooltip) ? e.tooltip : null,
        where: e.node && e.node !== "None" ? e.node : null,
        ends: e.expiry,
        rewards,
        progress: of > 1 ? { at: Math.min(e.currentScore ?? 0, of), of } : null,
      };
    })
    .sort((a, b) => Date.parse(a.ends) - Date.parse(b.ends));
}
