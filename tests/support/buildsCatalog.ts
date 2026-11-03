// A small catalog for the builds tests, shaped like the real one (orbiter-data's catalog.json):
// mods with their Flawed (Beginner), Intermediate, Expert and Conclave (PvPMods) twins, auras, a
// stance, Umbral mods, arcanes, and a few frames and weapons with their innate polarities.
import type { CatalogItem } from "../../src/lib/core/types";
import { gearKindOf, slotLayout } from "../../src/lib/core/builds/gear";
import type { Build, BuildMod } from "../../src/lib/core/builds/types";

const mod = (uniqueName: string, name: string, type: string, polarity: string, baseDrain: number, maxRank: number, rarity: string, compatName: string | undefined, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  uniqueName, name, category: "Mods", type, polarity, baseDrain, maxRank, rarity, ...(compatName ? { compatName } : {}), tradable: true, ...extra,
});
const arcane = (uniqueName: string, name: string, type: string): CatalogItem => ({ uniqueName, name, category: "Arcanes", type, maxRank: 5, rarity: "Legendary", tradable: true });

export const P = {
  rhino: "/Lotus/Powersuits/Rhino/RhinoPrime",
  braton: "/Lotus/Weapons/Tenno/Rifle/Rifle",
  hek: "/Lotus/Weapons/Tenno/Shotgun/QuadShotgun",
  lex: "/Lotus/Weapons/Tenno/Pistols/PrimeLex/PrimeLex",
  bramma: "/Lotus/Weapons/Grineer/Bows/GrnBow/GrnBowWeapon",
  nikana: "/Lotus/Weapons/Tenno/Melee/Swords/PrimeKatana/PrimeNikana",
  voidrig: "/Lotus/Powersuits/EntratiMech/NechroTech",
  helios: "/Lotus/Types/Sentinels/SentinelPowersuits/MeleePetPowerSuit",
  serration: "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod",
  serrationFlawed: "/Lotus/Upgrades/Mods/Rifle/Beginner/WeaponDamageAmountModBeginner",
  serrationMid: "/Lotus/Upgrades/Mods/Rifle/Intermediate/WeaponDamageAmountModIntermediate",
  splitChamber: "/Lotus/Upgrades/Mods/Rifle/WeaponFireIterationsMod",
  vitalSense: "/Lotus/Upgrades/Mods/Rifle/WeaponCritDamageMod",
  pointStrike: "/Lotus/Upgrades/Mods/Rifle/WeaponCritChanceMod",
  pointStrikePvp: "/Lotus/Upgrades/Mods/PvPMods/Rifle/WeaponCritChanceMod",
  hellfire: "/Lotus/Upgrades/Mods/Rifle/WeaponFireDamageMod",
  infectedClip: "/Lotus/Upgrades/Mods/Rifle/WeaponToxinDamageMod",
  stormbringer: "/Lotus/Upgrades/Mods/Rifle/WeaponElectricityDamageMod",
  vigilante: "/Lotus/Upgrades/Mods/Sets/Vigilante/WeaponVigilanteMod",
  hornetStrike: "/Lotus/Upgrades/Mods/Pistol/WeaponDamageAmountMod",
  pointBlank: "/Lotus/Upgrades/Mods/Shotgun/WeaponDamageAmountMod",
  primedContinuity: "/Lotus/Upgrades/Mods/Warframe/Expert/AvatarAbilityDurationModExpert",
  continuity: "/Lotus/Upgrades/Mods/Warframe/AvatarAbilityDurationMod",
  intensify: "/Lotus/Upgrades/Mods/Warframe/AvatarAbilityStrengthMod",
  vitality: "/Lotus/Upgrades/Mods/Warframe/AvatarHealthMaxMod",
  streamline: "/Lotus/Upgrades/Mods/Warframe/AvatarAbilityEfficiencyMod",
  hellsChamber: "/Lotus/Upgrades/Mods/Shotgun/WeaponFireIterationsMod",
  umbralVitality: "/Lotus/Upgrades/Mods/Sets/Umbra/WarframeUmbraModA",
  umbralFiber: "/Lotus/Upgrades/Mods/Sets/Umbra/WarframeUmbraModB",
  umbralIntensify: "/Lotus/Upgrades/Mods/Sets/Umbra/WarframeUmbraModC",
  adaptation: "/Lotus/Upgrades/Mods/Warframe/AvatarResistanceOnDamageMod",
  adaptationNemesis: "/Lotus/Upgrades/Mods/Nemesis/AvatarSentientArmourMod",
  ironShrapnel: "/Lotus/Powersuits/Rhino/IronSkinAugmentCard",
  steelCharge: "/Lotus/Upgrades/Mods/Aura/PlayerMeleeAuraMod",
  corrosiveProjection: "/Lotus/Upgrades/Mods/Aura/EnemyArmorReductionAuraMod",
  crimsonDervish: "/Lotus/Weapons/Tenno/Melee/MeleeTrees/KatanaCmbOneMeleeTree",
  pressurePoint: "/Lotus/Upgrades/Mods/Melee/WeaponMeleeDamageMod",
  necramechVitality: "/Lotus/Upgrades/Mods/Necramech/NecramechHealthMod",
  energize: "/Lotus/Upgrades/CosmeticEnhancers/Utility/GolemArcaneRadialEnergyOnEnergyPickup",
  grace: "/Lotus/Upgrades/CosmeticEnhancers/Defensive/HealthRegenOnDamage",
  merciless: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/PrimaryCritOnKill",
  moltAugmented: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/PowerStrengthOnKill",
};

export const CATALOG: CatalogItem[] = [
  {
    uniqueName: P.rhino, name: "Rhino Prime", category: "Warframes", type: "Warframe", productCategory: "Suits", masterable: true,
    polarities: ["vazarin", "vazarin", "naramon"], aura: "madurai",
    abilities: [{ name: "Rhino Charge" }, { name: "Iron Skin" }, { name: "Roar" }, { name: "Rhino Stomp" }],
  },
  { uniqueName: P.braton, name: "Braton", category: "Primary", type: "Rifle", productCategory: "LongGuns", masterable: true, exilusPolarity: "naramon" },
  { uniqueName: P.hek, name: "Hek", category: "Primary", type: "Shotgun", productCategory: "LongGuns", masterable: true, polarities: ["madurai"] },
  { uniqueName: P.lex, name: "Lex Prime", category: "Secondary", type: "Pistol", productCategory: "Pistols", masterable: true, polarities: ["madurai"] },
  { uniqueName: P.bramma, name: "Kuva Bramma", category: "Primary", type: "Bow", productCategory: "LongGuns", masterable: true, polarities: ["madurai"] },
  { uniqueName: P.nikana, name: "Nikana Prime", category: "Melee", type: "Melee", productCategory: "Melee", masterable: true, polarities: ["madurai", "vazarin"] },
  { uniqueName: P.voidrig, name: "Voidrig", category: "Warframes", type: "Necramech", productCategory: "MechSuits", masterable: true, polarities: ["madurai", "vazarin", "naramon"] },
  { uniqueName: P.helios, name: "Helios", category: "Sentinels", type: "Sentinel", productCategory: "Sentinels", masterable: true, polarities: ["penjaga", "penjaga"] },

  mod(P.serration, "Serration", "Primary Mod", "madurai", 4, 10, "Uncommon", "Rifle"),
  mod(P.serrationFlawed, "Serration", "Primary Mod", "madurai", 2, 3, "Uncommon", "Rifle"),
  mod(P.serrationMid, "Serration", "Primary Mod", "madurai", 4, 5, "Uncommon", "Rifle"),
  mod(P.splitChamber, "Split Chamber", "Primary Mod", "madurai", 5, 5, "Rare", "Rifle"),
  mod(P.vitalSense, "Vital Sense", "Primary Mod", "madurai", 4, 5, "Rare", "Rifle"),
  mod(P.pointStrike, "Point Strike", "Primary Mod", "madurai", 4, 5, "Common", "Rifle"),
  mod(P.pointStrikePvp, "Point Strike", "Primary Mod", "madurai", 4, 5, "Common", "Rifle"),
  mod(P.hellfire, "Hellfire", "Primary Mod", "naramon", 6, 5, "Uncommon", "Rifle"),
  mod(P.infectedClip, "Infected Clip", "Primary Mod", "naramon", 6, 5, "Uncommon", "Rifle"),
  mod(P.stormbringer, "Stormbringer", "Primary Mod", "naramon", 6, 5, "Uncommon", "Rifle"),
  mod(P.vigilante, "Vigilante Armaments", "Primary Mod", "naramon", 4, 5, "Rare", "Rifle"),
  mod(P.hornetStrike, "Hornet Strike", "Secondary Mod", "madurai", 4, 10, "Uncommon", "Pistol"),
  mod(P.pointBlank, "Point Blank", "Shotgun Mod", "madurai", 4, 5, "Common", "Shotgun"),
  mod(P.hellsChamber, "Hell's Chamber", "Shotgun Mod", "madurai", 6, 5, "Rare", "Shotgun"),
  mod(P.primedContinuity, "Primed Continuity", "Warframe Mod", "madurai", 4, 10, "Legendary", "WARFRAME"),
  mod(P.continuity, "Continuity", "Warframe Mod", "madurai", 2, 5, "Rare", "WARFRAME"),
  mod(P.intensify, "Intensify", "Warframe Mod", "madurai", 4, 5, "Rare", "WARFRAME"),
  mod(P.vitality, "Vitality", "Warframe Mod", "vazarin", 2, 10, "Common", "WARFRAME", { drops: [{ location: "Lancer", chance: 0.0101, rarity: "Common" }] }),
  mod(P.streamline, "Streamline", "Warframe Mod", "naramon", 4, 5, "Rare", "WARFRAME"),
  mod(P.umbralVitality, "Umbral Vitality", "Warframe Mod", "umbra", 6, 10, "Legendary", "WARFRAME"),
  mod(P.umbralFiber, "Umbral Fiber", "Warframe Mod", "umbra", 6, 10, "Legendary", "WARFRAME"),
  mod(P.umbralIntensify, "Umbral Intensify", "Warframe Mod", "umbra", 6, 10, "Legendary", "WARFRAME"),
  mod(P.adaptation, "Adaptation", "Warframe Mod", "vazarin", 2, 10, "Rare", "WARFRAME"),
  mod(P.adaptationNemesis, "Adaptation", "Warframe Mod", "vazarin", 2, 10, "Rare", "WARFRAME"),
  mod(P.ironShrapnel, "Iron Shrapnel", "Warframe Mod", "madurai", 6, 3, "Rare", "Rhino"),
  mod(P.steelCharge, "Steel Charge", "Warframe Mod", "madurai", -4, 5, "Uncommon", "AURA"),
  mod(P.corrosiveProjection, "Corrosive Projection", "Warframe Mod", "naramon", -2, 5, "Uncommon", "AURA"),
  mod(P.crimsonDervish, "Crimson Dervish", "Stance Mod", "madurai", -2, 3, "Rare", "Swords"),
  mod(P.pressurePoint, "Pressure Point", "Melee Mod", "madurai", 4, 5, "Common", "Melee"),
  mod(P.necramechVitality, "Necramech Vitality", "Necramech Mod", "vazarin", 4, 10, "Rare", "Necramech"),
  mod("/Lotus/Upgrades/Focus/Power/Active/SomeFocus", "Lightning Dash", "Focus Way", "zenurik", 4, 3, "Rare", undefined),

  arcane(P.energize, "Arcane Energize", "Warframe Arcane"),
  arcane(P.grace, "Arcane Grace", "Warframe Arcane"),
  arcane(P.merciless, "Primary Merciless", "Primary Arcane"),
  arcane(P.moltAugmented, "Molt Augmented", "Warframe Arcane"),
];

export const CAT = new Map(CATALOG.map((c) => [c.uniqueName, c]));
export const item = (path: string) => CAT.get(path)!;

export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 10, 3);

/** A build for tests: mods by path (max rank unless given), padded to the gear's slots. */
export function build(itemPath: string, mods: (string | BuildMod)[], extra: Partial<Build> = {}): Build {
  const kind = gearKindOf(item(itemPath))!;
  const list = mods.map((m) => (typeof m === "string" ? { path: m } : m));
  const slots = slotLayout(kind).mods;
  return { id: "t", item: itemPath, kind, mods: [...list, ...Array(Math.max(0, slots - list.length)).fill(null)], arcanes: [], shards: [], source: "mine", importedAt: NOW, ...extra };
}
