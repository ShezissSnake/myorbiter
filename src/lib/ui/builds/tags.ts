// Build tags by family, for grouping the chips (the tags themselves come from the builds' data).
// A tag not listed here goes under "Other". Matched without case.

export type TagFamily = "Survivability" | "Role" | "Content" | "Other";
export const TAG_FAMILIES: TagFamily[] = ["Role", "Content", "Survivability", "Other"];

export const TAG_FAMILY: Record<string, TagFamily> = {
  overguard: "Survivability",
  "shield gating": "Survivability",
  "health tank": "Survivability",
  "damage reduction": "Survivability",
  dps: "Role",
  support: "Role",
  tank: "Role",
  caster: "Role",
  "weapon platform": "Role",
  "melee platform": "Role",
  exalted: "Role",
  "star chart": "Content",
  "steel path": "Content",
  "level cap": "Content",
};

/** The tags offered in the editor, by family (any other can be typed). */
export const KNOWN_TAGS: Record<TagFamily, string[]> = {
  Role: ["DPS", "Support", "Tank", "Caster", "Weapon platform", "Melee platform", "Exalted"],
  Content: ["Star chart", "Steel Path", "Level cap"],
  Survivability: ["Overguard", "Shield gating", "Health tank", "Damage reduction"],
  Other: ["Crowd control", "Nuke", "Endurance", "Eidolon", "Archon", "Netracells", "Duviri", "Loot farming", "Solo", "Squad"],
};

export const familyOfTag = (tag: string): TagFamily => TAG_FAMILY[tag.trim().toLowerCase()] ?? "Other";

/** Tags grouped by family, in the families' order, families without any left out. */
export function byFamily(tags: readonly string[]): { family: TagFamily; tags: string[] }[] {
  return TAG_FAMILIES.map((family) => ({ family, tags: tags.filter((t) => familyOfTag(t) === family) })).filter((g) => g.tags.length);
}
