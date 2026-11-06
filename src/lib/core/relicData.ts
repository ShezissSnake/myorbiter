// The official drop tables' relics (read by relicdata.rs from drops.warframestat.us), laid over
// TennoScope's relic list: what each relic holds and whether it drops anywhere come from the
// tables, which are current within a day or two of an update, while TennoScope's list can lag a
// Prime Access by weeks. What TennoScope knows and the tables don't (anything odd) stays.
import { splitRelicName } from "./model";
import type { Drop, RelicEntry, RelicReward } from "./types";
import type { BountyTable } from "./board";

export interface RelicData {
  hash: string;
  /** When the tables were last changed (ms), as the site says. */
  modified: number;
  /** When orbiter last checked (s). */
  checkedAt: number;
  relics: { name: string; rewards: RelicReward[] }[];
  /** Where each relic drops, by "Era Code" ("Lith A13"); a relic that drops nowhere is vaulted. */
  drops: Record<string, Drop[]>;
  /** In-game path → name ("Lith A13 Intact"), for relics TennoScope doesn't know yet. */
  paths: Record<string, string>;
  /** The Zariman's, Cavia's and Höllvania's bounty tiers and what each pays (see board.ts). */
  bounties?: BountyTable[];
  /** What the Sortie pays at the end: one reward from this table, best chance first. */
  sortie?: RelicReward[];
}

const keyOf = (name: string) => {
  const s = splitRelicName(name);
  return s ? `${s.base}|${s.refinement}` : null;
};

/**
 * Requiem relics are never vaulted: Requiem Eterna drops from Kuva Siphons and Floods (and Lich
 * thralls), and the retired Requiem I–IV are sold by Palladino for Riven Slivers.
 */
const alwaysThere = (base: string) => base.startsWith("Requiem ");

export function mergeRelics(theirs: RelicEntry[], data: RelicData | null | undefined): RelicEntry[] {
  if (!data?.relics?.length) return theirs;
  const byKey = new Map<string, RelicEntry>();
  for (const r of theirs) {
    const k = keyOf(r.name);
    if (k && !byKey.has(k)) byKey.set(k, r);
  }
  const pathOf = new Map<string, string>();
  for (const [path, name] of Object.entries(data.paths ?? {})) {
    const k = keyOf(name);
    if (k && !pathOf.has(k)) pathOf.set(k, path);
  }
  // A new relic's picture: one of its era's (they're the same few per era).
  const imageOfEra = new Map<string, string>();
  for (const r of theirs) {
    const era = r.name.split(" ")[0];
    if (r.imageName && !imageOfEra.has(era)) imageOfEra.set(era, r.imageName);
  }
  const out: RelicEntry[] = [];
  const done = new Set<string>();
  for (const r of data.relics) {
    const k = keyOf(r.name);
    if (!k || done.has(k)) continue;
    done.add(k);
    const base = k.split("|")[0];
    const old = byKey.get(k);
    const drops = data.drops?.[base] ?? [];
    out.push({
      uniqueName: old?.uniqueName ?? pathOf.get(k) ?? `drops:${r.name}`,
      name: old?.name ?? r.name,
      tradable: old?.tradable ?? true,
      imageName: old?.imageName ?? imageOfEra.get(base.split(" ")[0]),
      rewards: r.rewards,
      drops,
      vaulted: drops.length === 0 && !alwaysThere(base),
    });
  }
  for (const r of theirs) {
    const k = keyOf(r.name);
    if (!k || !done.has(k)) out.push(r);
  }
  return out;
}

