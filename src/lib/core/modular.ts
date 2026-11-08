// Modular gear: kitguns, zaws, amps, MOAs, hounds, Predasites and Vulpaphylas, K-Drives. Each is
// put together from parts, and the game gives mastery by one of them, once: a kitgun's chamber, a
// zaw's strike, an amp's prism, a MOA's or hound's model, a K-Drive's board (a revived Predasite or
// Vulpaphyla by its subspecies). Building the same one again gives nothing. All but K-Drives give
// it only for the ranks earned after gilding (Sirocco comes gilded, and isn't modular).
//
// What's here: which family a part belongs to, where it's put together and gilded, and so the next
// step for each one: assemble a part you hold, gild a build, or level a gilded one. Everything else
// (Foundry, Mastery, Wishlist, the rings) reads it from here.
import type { Group } from "./collection";

export type FamilyId = "kitgun" | "zaw" | "amp" | "moa" | "hound" | "creature" | "kdrive";

export interface Family {
  id: FamilyId;
  /** What you build: "kitgun", "MOA". */
  build: string;
  /** The part its mastery goes by: "chamber", "strike", "prism", "model", "subspecies", "board". */
  part: string;
  /** That part's path. */
  match: RegExp;
  /** Its Codex rings. A kitgun's chamber is a primary and a secondary, counted once. */
  groups: Group[];
  /** Where it's put together, with what; null when it comes whole (the Mote Amp, a revived Predasite). */
  assemble: string | null;
  /** Where it's gilded and what that takes; null when it never needs gilding (K-Drives). */
  gild: string | null;
  /** Who puts it together, in a word or two: "Legs", "Rude Zuud or Father"; null when it comes whole. */
  assembleAt: string | null;
  /** Who gilds it, in a word or two: "Hok", "Onkko or Little Duck". */
  gildAt: string | null;
  /** The sigil of who sells and gilds it. */
  icon: string;
}

const LEGS = "Legs in Fortuna (Solaris United, Doer: 10 Training Debt-Bonds and 5,000 standing)";
const ZUUD_GILD = "Rude Zuud in Fortuna (Solaris United, Doer: 10 Shelter Debt-Bonds and 5,000 standing)";
const FATHER_GILD = "Father in the Necralisk (25 Father Tokens and 5,000 Entrati standing)";
const AMP_GILD = "Onkko in Cetus (The Quills, Adherent) or Little Duck in Fortuna (Vox Solaris, Hand), for 5,000 standing";

/** Every family, by the part its mastery goes by. Conclave's twin zaw strikes (PvPVariant) give none. */
export const FAMILIES: Family[] = [
  // Either vendor puts any kitgun together and gilds it; each lists its own first.
  { id: "kitgun", build: "kitgun", part: "chamber", match: /\/SUModularSecondarySet\d+\/Barrel\/\w+Part$/, groups: ["secondary", "primary"], assemble: `Rude Zuud in Fortuna or Father in the Necralisk, with a grip and a loader (4,000 credits)`, gild: `${ZUUD_GILD} or ${FATHER_GILD}`, assembleAt: "Rude Zuud or Father", gildAt: "Rude Zuud or Father", icon: "solaris-united" },
  { id: "kitgun", build: "kitgun", part: "chamber", match: /\/InfKitGun\/Barrels\/\w+\/\w+Part$/, groups: ["secondary", "primary"], assemble: "Father in the Necralisk or Rude Zuud in Fortuna, with a grip and a loader (4,000 credits)", gild: `${FATHER_GILD} or ${ZUUD_GILD}`, assembleAt: "Father or Rude Zuud", gildAt: "Father or Rude Zuud", icon: "entrati" },
  { id: "zaw", build: "zaw", part: "strike", match: /\/ModularMelee(?:\d+|Infested)\/Tips?\/(?!PvPVariant)\w+$/, groups: ["melee"], assemble: "Hok in Cetus, with a grip and a link (4,000 credits)", gild: "Hok in Cetus (Ostron, Trusted: 2 Cetus Wisps and 5,000 standing)", assembleAt: "Hok", gildAt: "Hok", icon: "ostron" },
  { id: "amp", build: "amp", part: "prism", match: /\/Sentients\/OperatorAmplifiers\/Set\d+\/Barrel\/\w+$/, groups: ["amps"], assemble: "Onkko in Cetus or Little Duck in Fortuna, with a scaffold and a brace (4,000 credits)", gild: AMP_GILD, assembleAt: "Onkko or Little Duck", gildAt: "Onkko or Little Duck", icon: "quills" },
  { id: "amp", build: "amp", part: "prism", match: /\/Corpus\/OperatorAmplifiers\/Set\d+\/Barrel\/\w+$/, groups: ["amps"], assemble: "Little Duck in Fortuna or Onkko in Cetus, with a scaffold and a brace (4,000 credits)", gild: AMP_GILD, assembleAt: "Little Duck or Onkko", gildAt: "Little Duck or Onkko", icon: "vox-solaris" },
  // The Mote Amp comes built: the game holds it as the training amp (see MOTE_HELD_AS).
  { id: "amp", build: "amp", part: "prism", match: /\/SentTrainingAmplifier\/SentAmpTrainingBarrel$/, groups: ["amps"], assemble: null, gild: AMP_GILD, assembleAt: null, gildAt: "Onkko or Little Duck", icon: "quills" },
  { id: "moa", build: "MOA", part: "model", match: /\/MoaPetParts\/MoaPetHead\w+$/, groups: ["companions"], assemble: "Legs in Fortuna, with a core, a gyro and a bracket (4,000 credits)", gild: LEGS, assembleAt: "Legs", gildAt: "Legs", icon: "solaris-united" },
  { id: "hound", build: "hound", part: "model", match: /\/ZanukaPetParts\/ZanukaPetPartHead[A-Z]$/, groups: ["companions"], assemble: "Legs in Fortuna, with a core, a bracket and a stabilizer (4,000 credits)", gild: LEGS, assembleAt: "Legs", gildAt: "Legs", icon: "solaris-united" },
  // Revived with Son, not built: the game holds them as companions under the subspecies' own path.
  { id: "creature", build: "companion", part: "subspecies", match: /\/CreaturePets\/\w+(?:PredatorKubrow|InfestedCatbrow)PetPowerSuit$/, groups: ["companions"], assemble: null, gild: "Son in the Necralisk (Entrati, Associate: 10 Son Tokens and 5,000 standing)", assembleAt: null, gildAt: "Son", icon: "entrati" },
  { id: "kdrive", build: "K-Drive", part: "board", match: /\/Hoverboard\/HoverboardParts\/PartComponents\/\w+\/\w+Deck$/, groups: ["kdrives"], assemble: "Roky in Fortuna, with a reactor, a nose and a jet", gild: null, assembleAt: "Roky", gildAt: null, icon: "ventkids" },
];

/** The Mote Amp's prism, and the training amp the game holds it as. */
export const MOTE = "/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/SentAmpTrainingBarrel";
export const MOTE_HELD_AS = "/Lotus/Weapons/Sentients/OperatorAmplifiers/SentTrainingAmplifier/OperatorTrainingAmpWeapon";

const familyMemo = new Map<string, Family | null>();
/** The family of the part a modular item's mastery goes by; null for anything else (a grip, a Braton). */
export function familyOf(unique: string): Family | null {
  let f = familyMemo.get(unique);
  // A part's blueprint ("…MoaPetHeadParaBlueprint") is a blueprint, not the part.
  if (f === undefined) familyMemo.set(unique, (f = /Blueprint$/.test(unique) ? null : (FAMILIES.find((x) => x.match.test(unique)) ?? null)));
  return f;
}

/** The game's feature bit for a gilded copy. */
export const GILDED = 8;

/**
 * What you have of one modular item: parts you hold not yet put together, copies built, and of
 * those how many are gilded. `known`: MyOrbiter has read each copy (a patched TennoScope); without it
 * built kitguns, zaws, amps, MOAs, hounds and K-Drives can't be seen, nor gilding.
 */
export interface ModularHave {
  family: Family;
  loose: number;
  built: number;
  gilded: number;
  known: boolean;
  /** Where the built copies sit (LongGuns, Pistols…): a kitgun can be either. */
  sections: string[];
}

export type ModularStep = "assemble" | "gild" | "level";

export interface ModularNext {
  step: ModularStep;
  /** The step in a sentence, with where and what it takes, for How to get it. */
  how: string;
  /** The step in a short sentence, naming only who to see, for a card. */
  brief: string;
  /** The step in a few words, for a card's tag. */
  tag: string;
  icon: string;
}

/**
 * The next step for a modular item you haven't mastered, once you hold its part or have built it:
 * assemble the part, gild the build, or level the gilded one. Null before that (getting the part is
 * the researched how-to-get) and once mastered.
 */
export function modularNext(have: ModularHave | null, mastered: boolean): ModularNext | null {
  if (!have || mastered) return null;
  const f = have.family;
  const icon = f.icon;
  if (have.built > 0) {
    if (!f.gild) return { step: "level", how: `Level it: rank your ${f.build} to 30 for the mastery.`, brief: "Rank it to 30 for the mastery.", tag: "Owned · level it", icon: "mastery" };
    if (have.gilded > 0) return { step: "level", how: "Level it (gilded): rank it to 30 for the mastery.", brief: "Gilded: rank it to 30 for the mastery.", tag: "Gilded · level it", icon: "mastery" };
    // MyOrbiter can't see gilding without each copy's read: say both.
    if (!have.known) return { step: "level", how: `In your arsenal. If it isn't gilded yet, rank it to 30 and gild it at ${f.gild}. Then level it to 30: only the ranks after gilding give mastery.`, brief: `Not gilded yet? Rank it to 30, gild it at ${f.gildAt}, then level it to 30 again.`, tag: "Owned · gild, then level", icon: "mastery" };
    return { step: "gild", how: `Gild it at ${f.gild}, once it's rank 30; the ranks after gilding give its mastery.`, brief: `Rank it to 30, gild it at ${f.gildAt}, then level it to 30 again.`, tag: "Built · gild it", icon };
  }
  if (have.loose > 0 && f.assemble) {
    const then = f.gild ? `then rank it to 30 and gild it at ${f.gildAt}: only the ranks after gilding give mastery` : "then rank it to 30 for the mastery";
    const briefThen = f.gild ? `then rank it to 30 and gild it at ${f.gildAt}.` : "then rank it to 30.";
    return { step: "assemble", how: `Assemble it at ${f.assemble}; ${then}.`, brief: `Assemble it at ${f.assembleAt}, ${briefThen}`, tag: `${f.part[0].toUpperCase()}${f.part.slice(1)} in hand · assemble`, icon };
  }
  return null;
}
