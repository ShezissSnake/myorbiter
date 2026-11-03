// What you're missing for a build, line by line, against your inventory.
//
// Inventory paths. Checked on 3 Nov 2026 against a real account's TennoScope database and its
// catalog:
// - Held there, so verified as inventory rows: Forma Blueprint, Omni (Aura) Forma and Stance Forma
//   and their blueprints, the Exilus Weapon Adapter blueprint, the Primary, Secondary and Amp Arcane
//   Adapters (the first two filed as "weapon"), Crimson, Azure and Amber shards and their Tauforged
//   ones, Tauforged Violet.
// - In TennoScope's catalog under these paths but not held on that account, so not yet seen as an
//   inventory row: Forma, Umbra Forma (and its blueprint), Orokin Catalyst and Reactor (and their
//   blueprints), the Exilus Warframe and Weapon Adapters (and the warframe one's blueprint), the
//   Melee and Archgun Arcane Adapters, Violet, Topaz and Emerald shards and the Tauforged Topaz and
//   Emerald.
// - Gear copies (`gear`): bit 1 Catalyst/Reactor and bit 2 Exilus are known; the arcane
//   adapter's bit (probably 32) is not verified, so it's read as unknown. `p` is the Forma count.
//   Shards installed on a frame, slot polarities and the Helminth aren't read yet (TennoScope patch).

import { copiesForRank, masteryRow } from "../views";
import { heldCount, type Model } from "../model";
import type { GearCopy } from "../notNeeded";
import type { CatalogItem } from "../types";
import { tierOf, type TierResult } from "./capacity";
import { usesReactor } from "./gear";
import type { Build, BuildShard, GearKind, ShardColour } from "./types";

const MISC = "/Lotus/Types/Items/MiscItems/";
const RECIPES = "/Lotus/Types/Recipes/Components/";
export const PATHS = {
  forma: `${MISC}Forma`,
  formaBlueprint: `${RECIPES}FormaBlueprint`,
  umbraForma: `${MISC}FormaUmbra`,
  umbraFormaBlueprint: `${RECIPES}UmbraFormaBlueprint`,
  omniForma: `${MISC}FormaAura`,
  stanceForma: `${MISC}FormaStance`,
  catalyst: `${MISC}OrokinCatalyst`,
  catalystBlueprint: `${RECIPES}OrokinCatalystBlueprint`,
  reactor: `${MISC}OrokinReactor`,
  reactorBlueprint: `${RECIPES}OrokinReactorBlueprint`,
  exilusWarframe: `${MISC}UtilityUnlocker`,
  exilusWarframeBlueprint: `${RECIPES}UtilityUnlockerBlueprint`,
  exilusWeapon: `${MISC}WeaponUtilityUnlocker`,
  exilusWeaponBlueprint: `${RECIPES}WeaponUtilityUnlockerBlueprint`,
  arcaneAdapter: {
    primary: `${MISC}WeaponPrimaryArcaneUnlocker`,
    secondary: `${MISC}WeaponSecondaryArcaneUnlocker`,
    melee: `${MISC}WeaponMeleeArcaneUnlocker`,
    archgun: `${MISC}WeaponArchGunArcaneUnlocker`,
    amp: `${MISC}WeaponAmpArcaneUnlocker`,
  } as Partial<Record<GearKind, string>>,
} as const;
const ADAPTER_NAME: Partial<Record<GearKind, string>> = { primary: "Primary Arcane Adapter", secondary: "Secondary Arcane Adapter", melee: "Melee Arcane Adapter", archgun: "Archgun Arcane Adapter", amp: "Amp Arcane Adapter" };

/** Archon Shard paths by colour; the Tauforged one adds "Mythic". */
export const SHARD_PATH: Record<ShardColour, string> = {
  crimson: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalAmar",
  azure: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalBoreal",
  amber: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalNira",
  violet: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalViolet",
  topaz: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalOrange",
  emerald: "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalGreen",
};
export const shardPath = (s: Pick<BuildShard, "colour" | "tauforged">) => SHARD_PATH[s.colour] + (s.tauforged ? "Mythic" : "");

// ---------------------------------------------------------------- Endo

/** Endo for each rarity's first rank; every rank after doubles it. */
export const ENDO_BASE: Record<string, number> = { Common: 10, Uncommon: 20, Rare: 30, Legendary: 40 };

/**
 * Endo to take a mod from one rank to another: base × (2^to − 2^from), base 10 Common, 20
 * Uncommon, 30 Rare, 40 Legendary (a Common mod to rank 10 is 10,230). Null for a rarity orbiter
 * doesn't know.
 */
export function endoCost(rarity: string | null | undefined, from: number, to: number): number | null {
  const base = ENDO_BASE[rarity ?? ""];
  if (base == null) return null;
  if (to <= from) return 0;
  return base * (2 ** to - 2 ** Math.max(0, from));
}

// ---------------------------------------------------------------- the report

/** ok: in hand (or on your copy); short: some, or buildable; missing: none; unknown: orbiter can't see it. */
export type Have = "ok" | "short" | "missing" | "unknown";

export type MissingKind = "item" | "part" | "mod" | "arcane" | "shard" | "catalyst" | "exilus" | "arcaneAdapter" | "forma" | "umbraForma" | "helminth";

export interface MissingLine {
  kind: MissingKind;
  /** What it is: "Serration", "Orokin Catalyst", "Tauforged Azure Archon Shard". */
  name: string;
  path?: string;
  have: Have;
  /** One sentence: what you hold against what's wanted, and what's left to do. */
  text: string;
  /** How to get it, when it's missing and orbiter knows ("Drops from …", a vendor). */
  how?: string | null;
  /** warframe.market's daily price for one (unranked), when known. */
  price?: number | null;
  /** Mods: the rank wanted and the best held (null: none), and the Endo between. */
  wantRank?: number;
  heldRank?: number | null;
  endo?: number | null;
  /** Counted things (copies of an arcane, shards, Forma): wanted, held now, blueprints, building. */
  need?: number;
  held?: number;
  blueprints?: number;
  building?: number;
  /** On your best copy: installed or not, Forma on it; null when orbiter can't see. */
  onCopy?: boolean | number | null;
}

export interface MissingReport {
  tier: TierResult;
  lines: MissingLine[];
  /** Lines that are short or missing. */
  todo: number;
  /** Endo to rank every mod as wanted. */
  endo: number;
  /** Your copy the Catalyst, adapters and Forma were checked on (null: none, or not read yet). */
  copy: GearCopy | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** The copy that's furthest along: Catalyst/Reactor first, then the most Forma. */
export function bestCopy(gear: GearCopy[] | null, path: string): GearCopy | null {
  const copies = (gear ?? []).filter((g) => g && g.type === path);
  return copies.sort((a, b) => (b.f & 1) - (a.f & 1) || (b.p || 0) - (a.p || 0))[0] ?? null;
}

/** Where a mod comes from, shortly: its best drop, and its price. */
function modHow(m: Model, c: CatalogItem): string | null {
  const drop = [...(c.drops ?? [])].sort((a, b) => b.chance - a.chance)[0];
  const price = m.price(c.name);
  const parts = [drop ? `Drops from ${drop.location.replace(/,\s*Rotation [ABC]$/, "")}` : "", price != null ? `about ${Math.round(price)} platinum on warframe.market` : ""].filter(Boolean);
  return parts.length ? `${parts.join("; or ")}.` : null;
}

/** A thing you use up: in stock, as blueprints, building; and on your copy when given. */
function consumable(m: Model, kind: MissingKind, name: string, path: string, blueprint: string | null, onCopy: boolean | null, how: string): MissingLine {
  const held = heldCount(m, path);
  const blueprints = blueprint ? heldCount(m, blueprint) : 0;
  const building = blueprint ? m.inFoundry(blueprint) : 0;
  const base = { kind, name, path, held, blueprints, building, onCopy };
  if (onCopy === true) return { ...base, have: "ok", text: `Already on your copy.` };
  if (held > 0) return { ...base, have: "ok", text: `${plural(held, "in stock", "in stock")}${onCopy === null ? " (orbiter can't see whether your copy has one already)" : ""}.` };
  if (building > 0) return { ...base, have: "short", text: `One is building in the Foundry.` };
  if (blueprints > 0) return { ...base, have: "short", text: `None built: you hold ${plural(blueprints, "blueprint")}, build one in the Foundry.` };
  if (onCopy === null) return { ...base, have: "unknown", text: `None in stock, and orbiter can't see whether your copy has one already.`, how };
  return { ...base, have: "missing", text: `None in stock.`, how };
}

/**
 * Each thing a build takes against what you hold: the item, its parts, mods (rank and Endo),
 * arcanes (copies), shards, the Catalyst/Reactor, adapters, Forma and the Helminth. The tier is
 * worked out here unless given (tierOf).
 */
export function missing(build: Build, m: Model, opts: { tier?: TierResult } = {}): MissingReport {
  const item = m.catalogByUnique.get(build.item);
  const tier = opts.tier ?? (item ? tierOf(build, item, m.catalogByUnique) : null);
  const lines: MissingLine[] = [];
  const copy = bestCopy(m.gear, build.item);
  const gearKnown = m.gear != null;

  // The item.
  if (!item) lines.push({ kind: "item", name: m.nameOf(build.item), path: build.item, have: "unknown", text: "orbiter doesn't know this item." });
  else if (m.owned(item.uniqueName) > 0) lines.push({ kind: "item", name: item.name, path: item.uniqueName, have: "ok", text: "You have it." });
  else lines.push({ kind: "item", name: item.name, path: item.uniqueName, have: "missing", text: "You don't have it yet.", how: masteryRow(m, item).acq.how });

  // Modular parts: held loose, or in a build of yours.
  for (const p of build.parts ?? []) {
    const name = m.nameOf(p);
    const inBuild = (m.gear ?? []).some((g) => Array.isArray(g.m) && g.m.includes(p));
    const held = heldCount(m, p);
    lines.push({ kind: "part", name, path: p, held, have: held > 0 || inBuild ? "ok" : "missing", text: inBuild ? "In a build of yours." : held > 0 ? `${plural(held, "held")}.` : "Not held." });
  }

  // Mods, at their rank.
  let endo = 0;
  const mods = [build.aura, build.stance, ...build.mods, build.exilus].filter((x): x is NonNullable<typeof x> => !!x);
  for (const x of mods) {
    const c = m.catalogByUnique.get(x.path);
    if (!c) {
      lines.push({ kind: "mod", name: m.nameOf(x.path), path: x.path, have: "unknown", text: "orbiter doesn't know this mod." });
      continue;
    }
    const max = c.maxRank ?? 0;
    const want = Math.max(0, Math.min(max, x.rank ?? max));
    const rows = (m.inventoryByBase.get(x.path) ?? []).filter((r) => r.quantity > 0);
    const heldRank = rows.length ? Math.max(...rows.map((r) => r.rank ?? 0)) : null;
    const cost = endoCost(c.rarity, heldRank ?? 0, want);
    if (cost) endo += cost;
    const endoText = cost == null ? "Endo unknown for its rarity" : `${plural(cost, "Endo", "Endo")} to rank it`;
    const base = { kind: "mod" as const, name: c.name, path: x.path, wantRank: want, heldRank, endo: cost, price: m.price(c.name) };
    if (heldRank == null) lines.push({ ...base, have: "missing", text: `Not held. Wanted at rank ${want}${want ? `: ${endoText} once you have it` : ""}.`, how: modHow(m, c) });
    else if (heldRank < want) lines.push({ ...base, have: "short", text: `Held at rank ${heldRank}, wanted at ${want}: ${endoText}.` });
    else lines.push({ ...base, have: "ok", text: heldRank === max ? `Held at max rank (${max}).` : `Held at rank ${heldRank} (wanted ${want}).` });
  }

  // Arcanes: copies toward the rank (rank r takes (r+1)(r+2)/2).
  for (const x of build.arcanes) {
    const c = m.catalogByUnique.get(x.path);
    const max = c?.maxRank && c.maxRank > 0 ? c.maxRank : 5;
    const want = Math.max(0, Math.min(max, x.rank ?? max));
    const need = copiesForRank(want);
    const rows = (m.inventoryByBase.get(x.path) ?? []).filter((r) => r.quantity > 0);
    const held = rows.reduce((n, r) => n + r.quantity * copiesForRank(r.rank ?? 0), 0);
    const name = c?.name ?? m.nameOf(x.path);
    const base = { kind: "arcane" as const, name, path: x.path, wantRank: want, need, held, price: m.price(name) };
    lines.push(held >= need ? { ...base, have: "ok", text: `${plural(held, "copy", "copies")} held: enough for rank ${want} (${need}).` } : { ...base, have: held ? "short" : "missing", text: `${held} of ${need} copies for rank ${want}: ${need - held} to go.` });
  }

  // Archon Shards, by colour: loose ones only (the ones on a frame aren't read yet).
  const want = new Map<string, { colour: ShardColour; tau: number; plain: number }>();
  for (const s of build.shards) {
    const w = want.get(s.colour) ?? { colour: s.colour, tau: 0, plain: 0 };
    if (s.tauforged) w.tau++;
    else w.plain++;
    want.set(s.colour, w);
  }
  for (const w of want.values()) {
    const heldTau = heldCount(m, shardPath({ colour: w.colour, tauforged: true }));
    const heldPlain = heldCount(m, shardPath({ colour: w.colour, tauforged: false }));
    // A Tauforged shard does a plain one's job, better.
    const tauOk = Math.min(w.tau, heldTau);
    const plainOk = Math.min(w.plain, heldPlain + heldTau - tauOk);
    const colour = w.colour[0].toUpperCase() + w.colour.slice(1);
    const wanted = [w.tau ? `${w.tau} Tauforged` : "", w.plain ? `${w.plain} plain` : ""].filter(Boolean).join(" and ");
    const ok = tauOk === w.tau && plainOk === w.plain;
    lines.push({
      kind: "shard",
      name: `${colour} Archon Shard`,
      path: SHARD_PATH[w.colour],
      need: w.tau + w.plain,
      held: heldTau + heldPlain,
      have: ok ? "ok" : heldTau + heldPlain ? "short" : "missing",
      text: `${wanted} wanted; you hold ${heldTau} Tauforged and ${heldPlain} plain loose.${ok ? "" : " Shards already on a frame can't be read yet."}`,
      how: ok ? null : "Archon Hunts each week.",
    });
  }

  if (tier) {
    const kind = build.kind;
    // The Catalyst or Reactor.
    if (tier.catalyst) {
      const reactor = usesReactor(kind);
      const name = kind === "exalted" ? "Orokin Reactor (on the frame)" : reactor ? "Orokin Reactor" : "Orokin Catalyst";
      const onCopy = !gearKnown ? null : copy ? (copy.f & 1) !== 0 : false;
      lines.push(consumable(m, "catalyst", name, reactor ? PATHS.reactor : PATHS.catalyst, reactor ? PATHS.reactorBlueprint : PATHS.catalystBlueprint, kind === "exalted" ? null : onCopy, "Nightwave, invasions and alerts, or 20 platinum in the in-game Market."));
    }
    if (tier.exilusAdapter) {
      const frame = kind === "warframe";
      const onCopy = !gearKnown ? null : copy ? (copy.f & 2) !== 0 : false;
      lines.push(consumable(m, "exilus", frame ? "Exilus Warframe Adapter" : "Exilus Weapon Adapter", frame ? PATHS.exilusWarframe : PATHS.exilusWeapon, frame ? PATHS.exilusWarframeBlueprint : PATHS.exilusWeaponBlueprint, onCopy, "Nightwave and other rewards, or the in-game Market."));
    }
    if (tier.arcaneAdapter) {
      const path = PATHS.arcaneAdapter[kind];
      // The arcane adapter's bit on a copy isn't verified: never read as installed or not.
      if (path) lines.push(consumable(m, "arcaneAdapter", ADAPTER_NAME[kind] ?? "Arcane Adapter", path, null, null, "Nightwave and other rewards."));
    }
    // Forma: what this tier takes, less what your copy has (assumed to be where this build wants it).
    const plain = tier.forma - tier.umbraForma;
    const formaLine = (kind2: "forma" | "umbraForma", need: number, path: string, blueprint: string) => {
      const onCopy = kind2 === "forma" ? (gearKnown ? (copy?.p ?? 0) : null) : null;
      const still = Math.max(0, need - (typeof onCopy === "number" ? onCopy : 0));
      const held = heldCount(m, path);
      const blueprints = heldCount(m, blueprint);
      const building = m.inFoundry(blueprint);
      const name = kind2 === "forma" ? "Forma" : "Umbra Forma";
      const base = { kind: kind2, name, path, need, held, blueprints, building, onCopy };
      const copyText = typeof onCopy === "number" && onCopy > 0 ? ` Your copy has ${onCopy} already (counted as where this build wants them).` : onCopy === null && kind2 === "forma" ? " orbiter can't see the Forma already on your copy." : "";
      if (still === 0) return lines.push({ ...base, have: "ok", text: `${plural(need, "Forma", "Forma")} wanted.${copyText}` });
      const parts = [`${still} still to put in`, `${held} in stock`, blueprints ? `${plural(blueprints, "blueprint")}` : "", building ? `${building} building` : ""].filter(Boolean).join(", ");
      const have: Have = held >= still ? "ok" : held + building + blueprints > 0 ? "short" : "missing";
      lines.push({ ...base, have, text: `${parts}.${copyText}`, how: have === "ok" ? null : kind2 === "forma" ? "Forma blueprints come from relics, Nightwave and other rewards." : "Teshin's Steel Path rotation, among other rewards." });
    };
    if (plain > 0) formaLine("forma", plain, PATHS.forma, PATHS.formaBlueprint);
    if (tier.umbraForma > 0) formaLine("umbraForma", tier.umbraForma, PATHS.umbraForma, PATHS.umbraFormaBlueprint);
  }

  // The Helminth: not read yet.
  if (build.helminth) lines.push({ kind: "helminth", name: build.helminth.ability, have: "unknown", text: `orbiter can't check the Helminth yet: ${build.helminth.ability} replaces ${build.helminth.replaces}.` });

  const fallback: TierResult = { tier: "low", fits: true, rank: 30, capacity: 30, drain: 0, catalyst: false, forma: 0, umbraForma: 0, formaPlan: [], exilusAdapter: false, arcaneAdapter: false, slots: [], reasons: ["orbiter doesn't know this item."], unknown: [] };
  return { tier: tier ?? fallback, lines, todo: lines.filter((l) => l.have === "short" || l.have === "missing").length, endo, copy };
}
