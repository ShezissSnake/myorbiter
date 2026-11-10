// The Arsenal's slots, as the kind icons draw them (ui/Kind.svelte): every kind label ("Primary ·
// Rifle", "Warframe", "Arch-Gun", "Sentinel") carries its slot's icon. One icon a slot, the same
// set wherever kinds are listed.

export const SLOTS = ["warframe", "primary", "secondary", "melee", "companion", "archwing", "necramech", "amp"] as const;
export type Slot = (typeof SLOTS)[number];

/** How a slot is named in a list of kinds (Browse by kind). */
export const SLOT_LABEL: Record<Slot, string> = {
  warframe: "Warframes", primary: "Primary", secondary: "Secondary", melee: "Melee",
  companion: "Companions", archwing: "Archwing", necramech: "Necramechs", amp: "Amps",
};

/**
 * The slot a kind belongs to, from any of the names the app gives kinds: a label ("Primary ·
 * Rifle", "Warframes"), an item type ("Rifle", "Pistol", "Sentinel", "Arch-Gun"), or a builds kind
 * ("archgun", "companionWeapon", "exalted"). Null for kinds that aren't gear (mods, relics, parts…).
 */
export function kindSlot(kind: string | null | undefined): Slot | null {
  const k = (kind ?? "").split(" · ")[0].trim().toLowerCase();
  if (!k) return null;
  if (/\b(mods?|arcanes?|relics?|blueprint|resource|fish|gems?|shards?)\b/.test(k)) return null;
  if (k.startsWith("necramech")) return "necramech";
  if (k.startsWith("amp") || k === "operator amp") return "amp";
  if (/^arch(wing|-?gun|-?melee)/.test(k)) return "archwing";
  if (k.startsWith("warframe") || k === "exalted") return "warframe";
  if (/^(compan|sentinel|pet|kubrow|kavat|moa|hound|predasite|vulpaphyla|beast)/.test(k)) return "companion";
  if (/^(primary|rifle|shotgun|bow|sniper|launcher|speargun|kitgun)/.test(k)) return "primary";
  if (/^(secondary|pistol|dual pistols|thrown|tome)/.test(k)) return "secondary";
  if (/^(melee|zaw|glaive|sword|polearm|scythe|whip|hammer|fist|claws|dagger|nikana|staff|tonfa|machete|rapier|sparring|gunblade|warfan|blade and whip)/.test(k)) return "melee";
  return null;
}
