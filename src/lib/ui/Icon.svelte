<script lang="ts" module>
  // One set of 16px line icons, drawn to sit together: square-cut, 1.3px strokes, Orokin
  // geometry (diamonds, hexagons, struck rings) rather than generic UI glyphs.
  const PATHS: Record<string, string> = {
    // Home: the orbiter itself, a ring around a core.
    home: "M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zM1.5 8c0-1.6 2.9-2.9 6.5-2.9S14.5 6.4 14.5 8 11.6 10.9 8 10.9 1.5 9.6 1.5 8z",
    // Sales: a coin with an upward tick.
    sales: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM5.4 9.6 7.4 7.6 8.8 9l2-2.2M9.4 6.8h1.4v1.4",
    // A void fissure: a diamond split down the middle by the rift.
    mission: "M8 1.2 14.8 8 8 14.8 1.2 8zM8.9 3.4 7.1 7.4 8.9 8.6 7.1 12.6",
    // A plan: a reticle over the relic's diamond.
    planner: "M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M8 4.8 11.2 8 8 11.2 4.8 8z",
    // A void relic: the capsule and its core.
    relics: "M6 1.5h4l2.5 3v7l-2.5 3H6l-2.5-3v-7zM8 5.2 10 8l-2 2.8L6 8z",
    // A storage crate: lid, body and its latch.
    inventory: "M2 6h12v7.5H2zM2.8 6 4 2.5h8L13.2 6M6.3 9h3.4",
    // Mastery: a chevron rising from its rank line.
    mastery: "M2.5 13.5h11M3.5 10.5 8 6l4.5 4.5M3.5 6.5 8 2l4.5 4.5",
    // Four parts that make a set.
    sets: "M2.5 2.5h4.6v4.6H2.5zM8.9 2.5h4.6v4.6H8.9zM2.5 8.9h4.6v4.6H2.5zM8.9 8.9h4.6v4.6H8.9z",
    // The Prime hexagon with its chevron.
    parts: "M8 1.5 13.5 4.6v6.8L8 14.5l-5.5-3.1V4.6zM5.4 9.6 8 5.6l2.6 4",
    // An arcane: a sigil, the triangle in its ring.
    arcanes: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM8 4.3l3.3 5.8H4.7z",
    // A mod card, top corner notched, with its polarity.
    mods: "M3.5 1.5h6.5l2.5 2.5v10.5h-9zM5.6 6.5 8 11.5l2.4-5",
    // Ducats: a stack of coins.
    ducats: "M2.5 4.5c0-1.4 2.5-2.5 5.5-2.5s5.5 1.1 5.5 2.5-2.5 2.5-5.5 2.5-5.5-1.1-5.5-2.5zM2.5 4.5v7c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-7M2.5 8c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5",
    // warframe.market: a price tag on a string.
    market: "M14.5 1.5 10 2 2 10l4 4 8-8zM11.2 4.8h.01M10.6 2 13 .9",
    guide: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4M8 11.2v.2",
    // A cog: six teeth around a hub.
    settings: "M6.9 1.5h2.2l.4 1.9 1.4.8 1.8-.6 1.1 1.9-1.4 1.3v1.6l1.4 1.3-1.1 1.9-1.8-.6-1.4.8-.4 1.9H6.9l-.4-1.9-1.4-.8-1.8.6-1.1-1.9 1.4-1.3V7.2L2.2 5.9l1.1-1.9 1.8.6 1.4-.8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    refresh: "M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3",
    close: "M3 3l10 10M13 3 3 13",
    // An event: a pennant carrying the Orokin diamond.
    event: "M3 14.5V1.5M3 2h10v7.5H3M8 3.6l2 2.1-2 2.1-2-2.1z",
    // A five-point star, for the wishlist.
    star: "M8 1.6l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.4l-4 2.2 1-4.4-3.4-3 4.5-.5z",
    // A bell, for alerts.
    bell: "M4 11.5V7a4 4 0 0 1 8 0v4.5l1.3 1.3H2.7zM6.6 14h2.8",
    external: "M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4",
    // A bug to report: a hexagonal shell split down the back, with its legs.
    bug: "M8 4.4 10.7 6.1v4.8L8 12.8 5.3 10.9V6.1zM8 4.4V12.8M6.6 4.6 8 2.8l1.4 1.8M5.3 7.6H2.5M10.7 7.6h2.8M5.3 10l-2.2 1.8M10.7 10l2.2 1.8M5.3 6.1 3.6 4.4M10.7 6.1l1.7-1.7",
    // Actions. Same pen as the pages above: 16 px, square ends, nothing filled.
    check: "M2.5 8.5 6.2 12.2 13.5 4",
    plus: "M8 2.5v11M2.5 8h11",
    minus: "M2.5 8h11",
    // A bin with its lid lifted: take something away for good.
    trash: "M2 4h12M6 4V2.2h4V4M3.6 4l.8 9.8h7.2l.8-9.8M6.6 6.6v4.6M9.4 6.6v4.6",
    // Back the way it came.
    undo: "M5.5 2.8 2.5 5.8l3 3M2.5 5.8h7.2a3.8 3.8 0 0 1 0 7.6H6",
    pencil: "M10.6 2.4 13.6 5.4 5.6 13.4H2.6v-3zM8.8 4.2l3 3",
    search: "M7 2.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6zM10.5 10.5 14 14",
    // Sold: the platinum coin, struck through with a tick.
    sold: "M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM5.1 8.2l2 2 3.8-4.2",
    // Sold several: a second coin behind the first.
    "sold-many": "M6.3 3.1a5 5 0 0 0 0 9.8M10 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM7.8 8.1l1.6 1.6 2.6-3",
    // Put it up on warframe.market: the price tag, and a plus.
    list: "M14.5 1.5 10 2 3.5 8.5l4 4L14 6zM11 5v.01M.7 12.8h5M3.2 10.3v5",
    // Already up: the tag, and a tick.
    listed: "M14.5 1.5 10 2 3.5 8.5l4 4L14 6zM11 5v.01M.8 12.8l1.9 1.9 3.3-3.3",
    // Kept: a padlock.
    lock: "M3.5 7.2h9v6.8h-9zM5.4 7.2V5a2.6 2.6 0 0 1 5.2 0v2.2M8 9.8v1.6",
    // Biggest first / smallest first: bars by length.
    "sort-desc": "M2.5 3.5h11M2.5 7h7.5M2.5 10.5h4.5M2.5 14h1.5",
    "sort-asc": "M2.5 2.5h1.5M2.5 6h4.5M2.5 9.5h7.5M2.5 13h11",
    // Cards or rows.
    cards: "M2.5 2.5h4.6v4.6H2.5zM8.9 2.5h4.6v4.6H8.9zM2.5 8.9h4.6v4.6H2.5zM8.9 8.9h4.6v4.6H8.9z",
    rows: "M2.5 3.5h11M2.5 8h11M2.5 12.5h11",
    // Bring in from outside: an arrow coming in from the left into an open box (export's sheet goes out).
    import: "M8.5 2.5h5v11h-5M1.8 8h8.4M7 4.8 10.2 8 7 11.2",
    // A sheet with rows going out: an export to a spreadsheet.
    export: "M3 1.8h6.5L13 5.3v8.9H3zM9.5 1.8v3.5H13M5.5 8h5M5.5 10.4h5M5.5 12.6h3",
    "sign-out": "M6.5 2.5h-4v11h4M10.2 4.8 13.4 8l-3.2 3.2M13.4 8H6",
    "arrow-right": "M2.5 8h10.5M9.2 4.3 13 8l-3.8 3.7",
    // A stop in a hexagon: take it off the market.
    stop: "M5.3 1.8h5.4l3.5 3.5v5.4l-3.5 3.5H5.3l-3.5-3.5V5.3zM5.6 8h4.8",
    // A price over time: a line rising over a baseline.
    chart: "M2 13.5h12M2.5 11 6 7l2.6 2.2L13.5 3.5",

    // Mission types, for fissures and alerts (the wiki has no set of these to borrow). Same pen.
    // Exterminate: a reticle.
    "m-exterminate": "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM8 1v4M8 11v4M1 8h4M11 8h4",
    // Survival: the hourglass running down.
    "m-survival": "M3.5 1.5h9M3.5 14.5h9M4.5 1.5c0 3.6 7 3.4 7 6.5s-7 2.9-7 6.5M11.5 1.5c0 3.6-7 3.4-7 6.5s7 2.9 7 6.5M6.2 13h3.6",
    // Defense: the shield.
    "m-defense": "M8 1.5 13.5 3.5v4c0 3.4-2.4 5.9-5.5 7-3.1-1.1-5.5-3.6-5.5-7v-4z",
    // Mobile Defense: the shield, moving on.
    "m-mobile-defense": "M8 1.5 13.5 3.5v4c0 3.4-2.4 5.9-5.5 7-3.1-1.1-5.5-3.6-5.5-7v-4zM5.6 9.4 8 7l2.4 2.4M5.6 6.6 8 4.2l2.4 2.4",
    // Interception: a tower's flag.
    "m-interception": "M3.5 14.5V1.5M3.5 2.5h9l-2.2 3 2.2 3h-9",
    // Capture: the cuffs.
    "m-capture": "M4.6 6.2a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8zM11.4 4a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8zM7.2 8.1l1.6-1",
    // Rescue: the cell's bars.
    "m-rescue": "M2.5 2.5h11v11h-11zM5.5 2.5v11M8 2.5v11M10.5 2.5v11",
    // Spy: the eye.
    "m-spy": "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
    // Sabotage: the blast.
    "m-sabotage": "M8 1.5l1.3 3.6 3.7-1.2-2 3.3 3.5 1.6-3.8.8.6 3.9L8 11.1l-3.3 2.4.6-3.9-3.8-.8 3.5-1.6-2-3.3 3.7 1.2z",
    // Excavation: the excavator's drill.
    "m-excavation": "M8 14.8 5 9h6zM5.8 9V5h4.4v4M4.5 5h7M8 5V1.5",
    // Disruption: a conduit's charge.
    "m-disruption": "M9.5 1.5 4 9h4l-1.5 5.5L12 7H8z",
    // Alchemy: the flask.
    "m-alchemy": "M6 1.5h4M6.8 1.5v4l-4 7.6c-.3.6.1 1.4.8 1.4h8.8c.7 0 1.1-.8.8-1.4l-4-7.6v-4M4.4 10.5h7.2",
    // Void Cascade, Flood and Armageddon: the Void's drop.
    "m-void": "M8 1.5S3.8 6.6 3.8 9.4a4.2 4.2 0 0 0 8.4 0C12.2 6.6 8 1.5 8 1.5zM6.2 10.2a1.8 1.8 0 0 0 1.8 1.8",
    // Assassination: the mark struck through.
    "m-assassination": "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6",
    // Hijack: the wheel.
    "m-hijack": "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 2v4M8 10v4M2 8h4M10 8h4",
    // Hive and other infestations: the cyst.
    "m-hive": "M8 2 13 5v6l-5 3-5-3V5zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  };
  export type IconName = keyof typeof PATHS;

  /** The glyph for a mission type ("Extermination", "Mobile Defense", "Void Cascade"…); the fissure's for anything else. */
  export function missionIcon(type: string | null | undefined): string {
    const t = (type ?? "").toLowerCase();
    if (t.startsWith("exterminat")) return "m-exterminate";
    if (t.includes("mobile defense")) return "m-mobile-defense";
    if (t.includes("survival")) return "m-survival";
    if (t.includes("defense") || t.includes("defence")) return "m-defense";
    if (t.includes("interception")) return "m-interception";
    if (t.startsWith("capture")) return "m-capture";
    if (t.startsWith("rescue")) return "m-rescue";
    if (t.startsWith("spy")) return "m-spy";
    if (t.startsWith("sabotage")) return "m-sabotage";
    if (t.startsWith("excavation")) return "m-excavation";
    if (t.startsWith("disruption")) return "m-disruption";
    if (t.startsWith("alchemy")) return "m-alchemy";
    if (t.startsWith("void")) return "m-void";
    if (t.startsWith("assassinat")) return "m-assassination";
    if (t.startsWith("hijack")) return "m-hijack";
    if (t.startsWith("hive") || t.includes("infest")) return "m-hive";
    return "mission";
  }
</script>

<script lang="ts">
  let { name, size = 14, title, stroke = 1.3 }: { name: string; size?: number; title?: string; stroke?: number } = $props();
</script>

<svg viewBox="0 0 16 16" width={size} height={size} aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined}>
  {#if title}<title>{title}</title>{/if}
  <path d={PATHS[name] ?? PATHS.guide} fill="none" stroke="currentColor" stroke-width={stroke} stroke-linejoin="miter" stroke-linecap="square" />
</svg>

<style>
  svg { flex: none; display: block; }
</style>
