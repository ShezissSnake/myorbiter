// Helpers the build-suggestion tests share: every tier or variant of a suggestion at once, and
// the names MyOrbiter's curated data files hold, to check against the catalog. The app itself asks
// for one tier and one variant at a time (core/builds/suggest.ts).
import { suggest, variantsFor, type Held, type ModIndex, type Owned, type RivenContext, type Suggestion, type Tier } from "../../src/lib/core/builds/suggest";
import type { CatalogItem } from "../../src/lib/core/types";
import frameRoles from "../../src/lib/data/frame-roles.json";
import synergies from "../../src/lib/data/loadout-synergies.json";

/** Every warframe MyOrbiter's frame table (frame-roles.json) has a line for. */
export const FRAME_NAMES: string[] = Object.keys((frameRoles as { frames: Record<string, unknown> }).frames);

/** Each of an item's variants (Star Chart, Steel Path…) at one tier. */
export function suggestVariants(item: CatalogItem, tier: Tier, owned: Owned, index: ModIndex, now = 0, held: Held | null = null, rivens: RivenContext | null = null): Suggestion[] {
  return variantsFor(item).map((v) => suggest(item, tier, owned, index, now, held, rivens, v.id));
}

/** An item's suggestion at every tier. */
export function suggestAll(item: CatalogItem, owned: Owned, index: ModIndex, now = 0, held: Held | null = null, rivens: RivenContext | null = null): Record<Tier, Suggestion> {
  return { low: suggest(item, "low", owned, index, now, held, rivens), medium: suggest(item, "medium", owned, index, now, held, rivens), high: suggest(item, "high", owned, index, now, held, rivens) };
}

type Syn = {
  arcanes: { effects: Record<string, unknown> };
  grimoire: { invocations: Record<string, { name: string }> };
  kitgun: { name: string };
  companions: Record<string, { mod: string }>;
  primers: Record<string, { mod: string; bond?: { name: string }; weapon?: { mod: string } }>;
  sets: Record<string, { pieces: { name: string }[] }>;
};

/** Every name in the loadout facts (loadout-synergies.json) that should be a catalog mod or arcane. */
export function loadoutModNames(): string[] {
  const SYN = synergies as unknown as Syn;
  const out = new Set<string>(Object.keys(SYN.arcanes.effects));
  for (const i of Object.values(SYN.grimoire.invocations)) out.add(i.name);
  out.add(SYN.kitgun.name);
  for (const c of Object.values(SYN.companions)) out.add(c.mod);
  for (const [n, p] of Object.entries(SYN.primers)) {
    if (n.startsWith("_")) continue;
    out.add(p.mod);
    if (p.bond) out.add(p.bond.name);
    if (p.weapon) out.add(p.weapon.mod);
  }
  for (const [n, d] of Object.entries(SYN.sets)) if (!n.startsWith("_")) for (const p of d.pieces) out.add(p.name);
  return [...out].sort();
}
