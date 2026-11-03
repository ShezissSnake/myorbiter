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
    | "railjack" | `faction-${Faction}`
    | `relic-${"lith" | "meso" | "neo" | "axi" | "requiem"}-${"intact" | "radiant"}`;

  type Faction = "grineer" | "corpus" | "infested" | "orokin" | "sentient" | "murmur" | "scaldra" | "techrot";

  const RELIC_ERAS = ["lith", "meso", "neo", "axi", "requiem"];
  /** A fissure's or relic's era as its relic; Omnia (which takes any) and eras without a picture here (Vanguard) as the Void tear. */
  export const eraIcon = (era: string): GameIconName => (RELIC_ERAS.includes(era.toLowerCase()) ? (`relic-${era.toLowerCase()}-intact` as GameIconName) : "void-tear");

  /**
   * An item kind as the Arsenal's tab for it shows ("Warframe", "Primary", "Arch-Gun", "Companion"…):
   * what stands in for an item's artwork when there's none. Null for kinds without one.
   */
  export function kindIcon(kind: string | null | undefined, name = ""): GameIconName | null {
    const k = (kind ?? "").toLowerCase();
    if (/plexus|railjack/i.test(name) || k.includes("railjack")) return "railjack";
    if (k.startsWith("warframe") || k === "necramech") return "warframes";
    if (k.startsWith("arch")) return "archwing";
    if (k.startsWith("primary")) return "primary";
    if (k.startsWith("secondary")) return "secondary";
    if (k.startsWith("melee")) return "melee";
    if (k.startsWith("compan") || k.startsWith("sentinel") || k.includes("pet")) return "companions";
    if (k.includes("relic")) return "void-tear";
    return null;
  }

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

<img class="gi" src="/game/{name}.png" width={size} height={size} alt={title ?? ""} {title} draggable="false" />

<style>
  .gi { display: inline-block; flex: none; object-fit: contain; vertical-align: middle; }
</style>
