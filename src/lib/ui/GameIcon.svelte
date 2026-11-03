<script lang="ts" module>
  // Warframe's own icons, bundled with the app (public/game, sources in SOURCES.json): platinum,
  // ducats, credits, relics by era, syndicate sigils, Baro, Varzia. Recognisable at a glance in a
  // way a drawn glyph isn't.
  export type GameIconName =
    | "platinum" | "ducats" | "credits" | "endo" | "kuva" | "aya" | "void-traces" | "vosfor" | "mastery"
    | "void-tear" | "market" | "dojo" | "baro" | "varzia" | "invasion" | "steel-essence" | "sortie" | "archon-shard"
    | "ostron" | "solaris-united" | "vox-solaris" | "entrati" | "cavia" | "holdfasts" | "necraloid" | "simaris"
    | "ventkids" | "quills" | "kahl" | "nightwave" | "conclave" | "hexis" | "suda" | "steel-meridian" | "new-loka"
    | "perrin" | "red-veil"
    | "warframes" | "primary" | "secondary" | "melee" | "companions" | "archwing" | "foundry" | "riven" | "cycles"
    | "railjack" | "plexus" | "amp" | "duviri" | "hex" | "bounty" | "daily-reset" | "archon-hunt" | "regal-aya"
    | "archon-shard-azure" | "archon-shard-amber" | `faction-${Faction}`
    | `relic-${"lith" | "meso" | "neo" | "axi" | "requiem"}-${"intact" | "exceptional" | "flawless" | "radiant"}`;

  type Faction = "grineer" | "corpus" | "infested" | "orokin" | "sentient" | "murmur" | "scaldra" | "techrot";

  const RELIC_ERAS = ["lith", "meso", "neo", "axi", "requiem"];
  /** A fissure's or relic's era as its relic; Omnia (which takes any) and eras without a picture here (Vanguard) as the Void tear. */
  export const eraIcon = (era: string): GameIconName => (RELIC_ERAS.includes(era.toLowerCase()) ? (`relic-${era.toLowerCase()}-intact` as GameIconName) : "void-tear");

  /** A relic's picture at a refinement ("Intact", "Exceptional", "Flawless", "Radiant"), bundled; null for an era without one. */
  export function relicIcon(era: string, refinement = "intact"): GameIconName | null {
    const e = era.toLowerCase();
    const r = refinement.toLowerCase();
    if (!RELIC_ERAS.includes(e) || !["intact", "exceptional", "flawless", "radiant"].includes(r)) return null;
    return `relic-${e}-${r}` as GameIconName;
  }

  /** This week's Archon shard by its colour ("Crimson", "Azure", "Amber"; crimson when unknown). */
  export function shardIcon(shard: string | null | undefined): GameIconName {
    const s = (shard ?? "").toLowerCase();
    return s.includes("azure") ? "archon-shard-azure" : s.includes("amber") ? "archon-shard-amber" : "archon-shard";
  }

  /**
   * An item kind as the Arsenal's tab for it shows ("Warframe", "Primary", "Arch-Gun", "Companion"…):
   * what stands in for an item's artwork when there's none. Weapon classes go to their slot (a bow
   * is a primary, a pistol a secondary, a zaw melee); mods show Endo, blueprints the Foundry.
   * Null for kinds without one.
   */
  export function kindIcon(kind: string | null | undefined, name = ""): GameIconName | null {
    const k = (kind ?? "").toLowerCase();
    if (/plexus/i.test(name) || k.includes("plexus")) return "plexus";
    if (/railjack/i.test(name) || k.includes("railjack")) return "railjack";
    if (/\bmods?\b/.test(k)) return "endo";
    if (k.includes("blueprint")) return "foundry";
    if (k.startsWith("amp") || k.includes("operator")) return "amp";
    if (k.startsWith("warframe") || k === "necramech") return "warframes";
    if (k.startsWith("arch")) return "archwing";
    if (k.startsWith("primary") || /^(rifle|shotgun|bow|sniper|launcher|kitgun)/.test(k)) return "primary";
    if (k.startsWith("secondary") || k.startsWith("pistol")) return "secondary";
    if (k.startsWith("melee") || k.startsWith("zaw")) return "melee";
    if (k.startsWith("compan") || k.startsWith("sentinel") || k.includes("pet")) return "companions";
    if (k.includes("relic")) return "void-tear";
    return null;
  }

  // The plural category names the item data uses, as one of them is called ("Warframes" → "Warframe").
  const SINGULAR: Record<string, string> = { warframes: "Warframe", sentinels: "Sentinel", pets: "Companion", mods: "Mod", arcanes: "Arcane", companions: "Companion", relics: "Relic" };
  /** An item kind in the singular, the same on every page. */
  export const kindLabel = (kind: string): string => SINGULAR[kind.toLowerCase()] ?? kind;

  /**
   * The enemy's faction sigil, as the game's star chart shows it: "Grineer", "Corpus", "Corrupted"
   * or "Orokin", "The Murmur"... Crossfire (two factions), Narmer and anything new get none.
   */
  export function factionIcon(enemy: string | null | undefined): GameIconName | null {
    const e = (enemy ?? "").toLowerCase().replace(/^the\s+/, "");
    const f: Faction | null =
      e.startsWith("grineer") || e === "kuva grineer" ? "grineer"
      : e.startsWith("corpus") ? "corpus"
      : e.startsWith("infest") ? "infested"
      : e === "orokin" || e === "corrupted" ? "orokin"
      : e.startsWith("sentient") ? "sentient"
      : e === "murmur" ? "murmur"
      : e === "scaldra" ? "scaldra"
      : e === "techrot" ? "techrot"
      : null;
    return f ? `faction-${f}` : null;
  }
</script>

<script lang="ts">
  let { name, size = 16, title }: { name: GameIconName; size?: number; title?: string } = $props();
</script>

<img class="gi {name}" class:sigil={name.startsWith("faction-")} src="/game/{name}.png" width={size} height={size} alt={title ?? ""} {title} draggable="false" />

<style>
  .gi { display: inline-block; flex: none; object-fit: contain; vertical-align: middle; }
  /* Faction sigils, coloured or white, all on the same faint light disc, so a dark one (Grineer's
     deep red) reads on a dark plate as well as Scaldra's white does, and the set looks like one. */
  .sigil { border-radius: 50%; padding: 1px; background: radial-gradient(circle, rgb(230 233 238 / 17%) 0 52%, rgb(230 233 238 / 0) 71%); }
  .faction-grineer { filter: brightness(1.9) saturate(1.15); }
</style>
