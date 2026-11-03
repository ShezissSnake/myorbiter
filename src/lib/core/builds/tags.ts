// Build tags: what a build is for, in a word or two ("Steel Path", "Shield gating", "Nuke").
//
// For the UI (the Builds page's chips):
//   TAGS             the known tags by family, in display order (Role, Content, Survivability, Style,
//                    Weapon); any other tag a user types is family "Other".
//   TAG_FAMILY       lower-cased tag → family, for grouping chips: TAG_FAMILY["steel path"] === "Content".
//   TAG_FAMILIES     the families in display order, "Other" last.
//   familyOfTag(t)   a tag's family ("Other" when unknown); byFamily(tags) groups a list.
//   canonicalTag(t)  a typed or pasted spelling as orbiter writes it ("sp" → "Steel Path"), or the
//                    trimmed text when it isn't a known one.
//   tagsInText(text, title?) the known tags a pasted build names (parse.ts uses it).
//
// Vocabulary: noxsframe.com's build modes, verbatim where they overlap (read by hand on its
// /builds page, 3 Nov: "All-round", "Star Chart", "Steel Path", "Endurance", "Archon Hunt",
// "Farming"), then orbiter's own list (3 Nov) for roles, survivability and content Nox doesn't name.
// Pure: no I/O, no Svelte.

export type TagFamily = "Survivability" | "Role" | "Content" | "Style" | "Weapon" | "Other";
export const TAG_FAMILIES: TagFamily[] = ["Role", "Content", "Survivability", "Style", "Weapon", "Other"];

/** The known tags by family. Nox's modes are in Content, spelled as Nox spells them. */
export const TAGS: Record<Exclude<TagFamily, "Other">, string[]> = {
  Role: ["DPS", "Support", "Tank", "Caster", "Weapon platform", "Melee platform", "Exalted", "Crowd control"],
  Content: ["All-round", "Star Chart", "Steel Path", "Level cap", "Endurance", "Farming", "Archon Hunt", "Eidolon", "Netracells", "Archimedea", "Duviri", "Railjack"],
  Survivability: ["Overguard", "Shield gating", "Health tank", "Damage reduction", "Armor", "Evasion"],
  Style: ["Nuke", "Speed", "Solo", "Squad"],
  Weapon: ["Crit", "Status", "Hybrid", "Heavy attack"],
};

/** The tags noxsframe.com uses, verbatim (its /builds page's mode chips). */
export const NOX_TAGS = ["All-round", "Star Chart", "Steel Path", "Endurance", "Archon Hunt", "Farming"] as const;

/** Lower-cased tag → family. */
export const TAG_FAMILY: Record<string, TagFamily> = Object.fromEntries(
  (Object.entries(TAGS) as [TagFamily, string[]][]).flatMap(([family, tags]) => tags.map((t) => [t.toLowerCase(), family])),
);

const CANONICAL = new Map<string, string>(Object.values(TAGS).flat().map((t) => [t.toLowerCase(), t]));

// Other spellings, lower-cased, and the tag each means.
const ALIASES: Record<string, string> = {
  sp: "Steel Path",
  steelpath: "Steel Path",
  "steel-path": "Steel Path",
  starchart: "Star Chart",
  "normal star chart": "Star Chart",
  "normal mode": "Star Chart",
  levelcap: "Level cap",
  "level-cap": "Level cap",
  "lvl cap": "Level cap",
  "allround": "All-round",
  "all round": "All-round",
  "all-rounder": "All-round",
  allrounder: "All-round",
  "general purpose": "All-round",
  farm: "Farming",
  "loot farming": "Farming",
  "loot farm": "Farming",
  "archon hunts": "Archon Hunt",
  "archon hunting": "Archon Hunt",
  eidolons: "Eidolon",
  "eidolon hunt": "Eidolon",
  "eidolon hunting": "Eidolon",
  netracell: "Netracells",
  "deep archimedea": "Archimedea",
  "temporal archimedea": "Archimedea",
  "shield gate": "Shield gating",
  "shield-gating": "Shield gating",
  "shield gating": "Shield gating",
  shieldgate: "Shield gating",
  shieldgating: "Shield gating",
  "hp tank": "Health tank",
  dr: "Damage reduction",
  armour: "Armor",
  "armor tank": "Armor",
  "armour tank": "Armor",
  nuker: "Nuke",
  nuking: "Nuke",
  cc: "Crowd control",
  "gun platform": "Weapon platform",
  "weapons platform": "Weapon platform",
  mobility: "Speed",
  speedrun: "Speed",
  "speed run": "Speed",
  "heavy attacks": "Heavy attack",
  "heavy attack": "Heavy attack",
  critical: "Crit",
};

/** A tag as orbiter writes it: a known one in its own spelling, anything else trimmed. */
export function canonicalTag(tag: string): string {
  const t = tag.trim().replace(/\s+/g, " ");
  const k = t.toLowerCase();
  return CANONICAL.get(k) ?? ALIASES[k] ?? t;
}

export const familyOfTag = (tag: string): TagFamily => TAG_FAMILY[canonicalTag(tag).toLowerCase()] ?? "Other";

/** Tags grouped by family, in the families' order, families without any left out. */
export function byFamily(tags: readonly string[]): { family: TagFamily; tags: string[] }[] {
  return TAG_FAMILIES.map((family) => ({ family, tags: tags.filter((t) => familyOfTag(t) === family) })).filter((g) => g.tags.length);
}

// ---------------------------------------------------------------- tags in pasted text

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ -]/g, "[ -]?");
// Body text is full of mod names and stats ("Status Chance", "Armored Agility", "Archon Intensify"),
// so outside the title only phrases that can't be a mod's are read; in a title, every known tag.
const SAFE_IN_BODY = new Set(["Steel Path", "Star Chart", "Level cap", "Endurance", "Archon Hunt", "Eidolon", "Netracells", "Archimedea", "Shield gating", "Health tank", "Nuke", "Farming", "All-round", "Weapon platform", "Melee platform", "Heavy attack"]);
// The body's aliases that would also hit mod text are left out ("dr", "cc", "farm", "critical").
const BODY_ALIAS_SKIP = new Set(["dr", "cc", "farm", "critical", "armour", "mobility", "nuking"]);

interface Pattern {
  re: RegExp;
  tag: string;
}
const phrases = (): [string, string][] => [...[...CANONICAL].map(([k, v]) => [k, v] as [string, string]), ...Object.entries(ALIASES)];
const TITLE_PATTERNS: Pattern[] = phrases()
  .filter(([k]) => k !== "sp")
  .map(([k, tag]) => ({ re: new RegExp(`(^|[^a-z0-9])${esc(k)}($|[^a-z0-9])`, "i"), tag }));
const BODY_PATTERNS: Pattern[] = phrases()
  .filter(([k, tag]) => SAFE_IN_BODY.has(tag) && !BODY_ALIAS_SKIP.has(k) && k !== "sp")
  .map(([k, tag]) => ({ re: new RegExp(`(^|[^a-z0-9])${esc(k)}($|[^a-z0-9])`, "i"), tag }));
// "SP" on its own: any case in a title, upper case only in the body ("sp" is too common a fragment).
const SP_TITLE = /(^|[^a-z0-9])sp($|[^a-z0-9])/i;
const SP_BODY = /(^|[^A-Za-z0-9])SP($|[^A-Za-z0-9])/;

/**
 * The known tags a pasted build names, in TAGS order: every known tag (and alias) in its title,
 * and in the body only phrases no mod is called ("Steel Path", "Level cap", "SP" in capitals,
 * "Shield gating"…). A "Tags:" line is read whole by the parser, not here.
 */
export function tagsInText(text: string, title?: string): string[] {
  const found = new Set<string>();
  const t = title ?? "";
  for (const p of TITLE_PATTERNS) if (p.re.test(t)) found.add(p.tag);
  if (SP_TITLE.test(t)) found.add("Steel Path");
  for (const p of BODY_PATTERNS) if (p.re.test(text)) found.add(p.tag);
  if (SP_BODY.test(text)) found.add("Steel Path");
  const order = Object.values(TAGS).flat();
  return order.filter((x) => found.has(x));
}

/** Whether a run of words is only tags ("Steel Path nuke"), so the parser doesn't read it as a mod name. */
export function onlyTags(text: string): boolean {
  let rest = ` ${text.toLowerCase().replace(/[^a-z0-9 -]+/g, " ")} `;
  const keys = phrases().map(([k]) => k).sort((a, b) => b.length - a.length);
  for (const k of keys) rest = rest.replace(new RegExp(`(?<=[ ])${esc(k)}(?=[ ])`, "g"), " ");
  rest = rest.replace(/\b(build|builds|for|and|or|the|a|an|with|setup|variant|version|prime|\/)\b/g, " ");
  return rest.trim() === "" && text.trim() !== "";
}
