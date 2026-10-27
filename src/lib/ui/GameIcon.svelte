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
    | `relic-${"lith" | "meso" | "neo" | "axi" | "requiem"}-${"intact" | "radiant"}`;
</script>

<script lang="ts">
  let { name, size = 16, title }: { name: GameIconName; size?: number; title?: string } = $props();
</script>

<img class="gi" src="/game/{name}.png" width={size} height={size} alt={title ?? ""} {title} draggable="false" />

<style>
  .gi { display: inline-block; flex: none; object-fit: contain; vertical-align: middle; }
</style>
