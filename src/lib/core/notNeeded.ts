// Gear you no longer need and can't trade: a weapon, frame or companion another version of
// which you own and does everything it does (the Dual Decurion once you have Prisma Dual
// Decurions), and extra copies of something mastered. Built gear can't be traded, so these go
// for credits (or, for a warframe, to the Helminth).
//
// Kept back, and said why: one you haven't mastered yet; one a recipe you haven't mastered takes
// (two Broncos for the Akbronco); one with its Incarnon Genesis installed when the better one
// has none; one you chose to keep. Versions side by side (a Prime and a Vandal, a Prime and an
// Umbra) aren't straight upgrades of each other: neither is offered.
import type { Model } from "./model";

/** One copy of a weapon, frame or companion, as the patched TennoScope read it from the game. */
export interface GearCopy {
  /** The item's path. */
  type: string;
  /** The game's feature bits: 1 Orokin Catalyst/Reactor, 2 Exilus, 8 gilded, 512 Incarnon Genesis installed. */
  f: number;
  /** Forma used on it. */
  p: number;
}

export const INCARNON = 512;
/**
 * Weapons an Incarnon Genesis fits (and so every version of them), as of November 2026: used only
 * to warn when orbiter can't see whether one is installed (a TennoScope without orbiter's patch).
 */
const GENESIS = new Set([
  "Ack & Brunt", "Angstrum", "Anku", "Atomos", "Ballistica", "Bo", "Boar", "Boltor", "Braton", "Bronco", "Burston", "Ceramic Dagger", "Cestra", "Dera", "Despair",
  "Destreza", "Dread", "Dual Ichor", "Furax", "Furis", "Gammacor", "Gorgon", "Gram", "Hate", "Hek", "Kronen", "Kunai", "Lato", "Latron", "Lex", "Magistar", "Miter",
  "Nami Solo", "Obex", "Okina", "Paris", "Sibear", "Sicarus", "Skana", "Soma", "Strun", "Stug", "Sybaris", "Torid", "Vasto", "Vectis", "Viper", "Zylok",
]);
const DOUBLED = 1;

export interface CanGo {
  unique: string;
  name: string;
  /** How many copies can go. */
  copies: number;
  /** Of how many you have. */
  of: number;
  why: string;
  /** What's in it, and what to do instead (Helminth, which copy to keep). */
  notes: string[];
  /** Something orbiter can't see that would keep it: check before selling. */
  check: string | null;
  frame: boolean;
}

export interface KeptBack {
  unique: string;
  name: string;
  why: string;
  /** You chose to keep it (Undo puts it back on the list). */
  yours: boolean;
}

/** The slots whose gear is compared: same slot, same family. Modular gear (kitguns, zaws, amps) isn't. */
const SLOTS = new Set(["LongGuns", "Pistols", "Melee", "Suits", "SpaceGuns", "SpaceMelee", "SpaceSuits", "SentinelWeapons", "Sentinels"]);
const LOWER = /^mk1-/i;
// Mutalist and Proboscis versions play differently from the plain ones: not counted as upgrades.
const PREFIX = /^(Prisma|Kuva|Tenet|Coda|Dex|Rakta|Sancti|Secura|Synoid|Telos|Vaykor|Ceti|Carmine|Mara) /;
const SUFFIX = / (Prime|Vandal|Wraith|Umbra)$/;

/**
 * An item's family and how it ranks in it: 0 for the MK1 version, 1 for the plain one, 2 for any
 * other (Prime, Prisma, Vandal, Wraith, Kuva, Tenet, a syndicate's). Names are compared without a
 * plural "s" ("Prisma Dual Decurions" is the Dual Decurion's).
 */
export function familyOf(name: string): { base: string; rank: number; key: string } {
  let base = name.trim();
  let rank = 1;
  if (LOWER.test(base)) {
    base = base.replace(LOWER, "");
    rank = 0;
  } else if (PREFIX.test(base) || SUFFIX.test(base)) {
    base = base.replace(PREFIX, "").replace(SUFFIX, "");
    rank = 2;
  }
  const key = base.toLowerCase().replace(/\s+/g, " ").replace(/s$/, "");
  return { base, rank, key };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function notNeeded(m: Model, gear: GearCopy[] | null, keep: ReadonlySet<string> = new Set()): { go: CanGo[]; kept: KeptBack[] } {
  // Built copies you hold (the foundry's aren't yours yet), by path.
  const held = new Map<string, { name: string; qty: number; slot: string; frame: boolean }>();
  for (const [unique, rows] of m.inventoryByBase) {
    const cat = m.catalogByUnique.get(unique);
    if (!cat?.masterable || !cat.productCategory || !SLOTS.has(cat.productCategory) || /Modular|InfKitGun/.test(unique)) continue;
    const qty = rows.filter((r) => r.category === "weapon" || r.category === "frame" || r.category === "companion").reduce((n, r) => n + r.quantity, 0);
    if (qty > 0) held.set(unique, { name: cat.name, qty, slot: cat.productCategory, frame: cat.productCategory === "Suits" });
  }
  // What recipes you haven't mastered (and haven't built) still take of each: two Broncos for the Akbronco.
  const needs = new Map<string, { qty: number; for: string[] }>();
  for (const cat of m.catalogByUnique.values()) {
    if (!cat.masterable || !cat.components?.length || m.isMastered(cat.uniqueName) || m.owned(cat.uniqueName) > 0) continue;
    const counts = new Map<string, number>();
    for (const c of cat.components) if (held.has(c.uniqueName)) counts.set(c.uniqueName, (counts.get(c.uniqueName) ?? 0) + (c.itemCount ?? 1));
    for (const [u, n] of counts) {
      const was = needs.get(u) ?? { qty: 0, for: [] };
      needs.set(u, { qty: was.qty + n, for: [...was.for, cat.name] });
    }
  }
  const copies = new Map<string, GearCopy[]>();
  for (const g of gear ?? []) copies.set(g.type, [...(copies.get(g.type) ?? []), g]);
  const incarnon = (u: string) => (copies.get(u) ?? []).some((c) => (c.f & INCARNON) !== 0);
  const families = new Map<string, string[]>();
  for (const [u, h] of held) {
    const k = `${familyOf(h.name).key}|${h.slot}`;
    families.set(k, [...(families.get(k) ?? []), u]);
  }
  const genesisFor = (base: string) => GENESIS.has(base) || m.catalogNames.has(`${base} Incarnon Genesis`);

  const go: CanGo[] = [];
  const kept: KeptBack[] = [];
  for (const [u, h] of held) {
    const fam = familyOf(h.name);
    const better = (families.get(`${fam.key}|${h.slot}`) ?? []).filter((o) => o !== u && familyOf(held.get(o)!.name).rank > fam.rank);
    const betterNames = better.map((o) => held.get(o)!.name);
    const mastered = m.isMastered(u);
    const need = needs.get(u);
    const superseded = better.length > 0;
    // How many copies to keep: one to level while it isn't mastered; what recipes still take; and
    // your own copy unless something better does its job.
    const keepN = !mastered ? Math.max(1, need?.qty ?? 0) : (need?.qty ?? 0) + (superseded ? 0 : 1);
    const extra = h.qty - keepN;
    if (extra <= 0) {
      if (superseded) {
        const why = !mastered ? `Not mastered yet: level it to 30 first (${list(betterNames)} would replace it after)` : need ? `${list(need.for)} ${need.for.length === 1 ? "takes" : "take"} it, and you haven't mastered ${need.for.length === 1 ? "it" : "them"}` : "";
        if (why) kept.push({ unique: u, name: h.name, why, yours: false });
      }
      continue;
    }
    // A spare Kuva, Tenet or Coda copy is worth fusing into the one you keep (Valence Fusion), not selling.
    if (!superseded && /^(Kuva|Tenet|Coda) /.test(h.name)) {
      kept.push({ unique: u, name: h.name, why: `You have ${h.qty}: fuse the spare into the one you keep (Valence Fusion) to raise its bonus, rather than selling it`, yours: false });
      continue;
    }
    if (keep.has(u)) {
      kept.push({ unique: u, name: h.name, why: "You chose to keep it", yours: true });
      continue;
    }
    // Its Incarnon Genesis is installed and the better one has none: keep it.
    if (superseded && gear && incarnon(u) && !better.some(incarnon)) {
      kept.push({ unique: u, name: h.name, why: `Its Incarnon Genesis is installed, and ${list(betterNames)} ${betterNames.length === 1 ? "has" : "have"} none`, yours: false });
      continue;
    }
    const mine = copies.get(u) ?? [];
    const notes: string[] = [];
    const forma = mine.reduce((n, c) => n + (c.p || 0), 0);
    const doubled = mine.some((c) => (c.f & DOUBLED) !== 0);
    if (forma || doubled) notes.push(`${[forma ? plural(forma, "Forma", "Forma") : "", doubled ? (h.frame ? "an Orokin Reactor" : "an Orokin Catalyst") : ""].filter(Boolean).join(" and ")} in ${h.qty > 1 ? "your copies" : "it"}`);
    if (!superseded && h.qty > 1 && mine.length > 1) notes.push("Keep the copy with the most in it");
    if (h.frame) notes.push("Or feed it to the Helminth, if you haven't subsumed its ability");
    if (need) notes.push(`Keep ${plural(need.qty, "copy", "copies")} for ${list(need.for)}`);
    const check = superseded && !gear && genesisFor(fam.base) ? `orbiter can't see installed Incarnons yet: if you put its Incarnon Genesis in, keep it` : null;
    go.push({
      unique: u,
      name: h.name,
      copies: extra,
      of: h.qty,
      why: superseded ? `${list(betterNames)} ${betterNames.length === 1 ? "does" : "do"} everything it does, and it's mastered` : `You have ${h.qty}, and it's mastered: one is enough`,
      notes,
      check,
      frame: h.frame,
    });
  }
  go.sort((a, b) => a.name.localeCompare(b.name));
  kept.sort((a, b) => Number(a.yours) - Number(b.yours) || a.name.localeCompare(b.name));
  return { go, kept };
}
