<script lang="ts">
  // The Codex rings atop Mastery, Foundry and Wishlist: a tile per category (Warframes, Primary,
  // Secondary, Melee, Companions, Archwing, Amps, K-Drives), its sigil in a ring of mastered against all,
  // the count and the category's name under it. Each is a button (a filter, or a jump), the page's
  // category lit. `all`: an "All" tile first, every category added up, lit when none is picked.
  // `marks`: a gold ★ count on a tile (what you starred in it). `line`: the next thing to do.
  import { onMount } from "svelte";
  import { ringTotal, type CodexRing } from "../core/codex";
  import type { Group } from "../core/collection";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";

  let {
    rings,
    lit = null,
    onpick,
    all = null,
    marks = {},
    line = null,
    action,
  }: {
    rings: CodexRing[];
    lit?: Group | null;
    onpick: (g: Group) => void;
    /** The "All" tile: what a click on it does (show every category); null: no such tile. */
    all?: { onpick: () => void; action: string } | null;
    marks?: Partial<Record<Group, number>>;
    line?: string | null;
    /** What a click on a ring does, for its tooltip: "Click to show only primary", say. */
    action: (r: CodexRing) => string;
  } = $props();

  // K-Drives under the Ventkids' sigil: Roky sells every board.
  const ICON: Record<Group, GameIconName> = { warframes: "warframes", primary: "primary", secondary: "secondary", melee: "melee", companions: "companions", archwing: "archwing", amps: "amp", kdrives: "ventkids", other: "foundry" };
  const R = 20;
  const C = 2 * Math.PI * R;
  // The rings fill once, as the page opens (at once with reduced motion: see the style).
  let shown = $state(false);
  onMount(() => {
    const f = requestAnimationFrame(() => (shown = true));
    return () => cancelAnimationFrame(f);
  });
  const n = (x: number) => x.toLocaleString("en");
  const pct = (m: number, t: number) => (t ? Math.floor((m / t) * 100) : 0);
  const starred = (g: Group) => marks[g] ?? 0;
  const tip = (r: CodexRing) =>
    `${r.label}: ${n(r.mastered)} of ${n(r.total)} mastered (${pct(r.mastered, r.total)}%)${starred(r.group) ? `, ${n(starred(r.group))} starred` : ""}. ${action(r)}`;
  const sum = $derived(ringTotal(rings));
</script>

<section class="codex" aria-label="Codex: mastered by category">
  <div class="rings">
    {#if all}
      {@const tipAll = `Every category: ${n(sum.mastered)} of ${n(sum.total)} mastered (${pct(sum.mastered, sum.total)}%). ${all.action}`}
      <button type="button" class="ring" class:lit={lit == null} aria-pressed={lit == null} aria-label={tipAll} title={tipAll} onclick={all.onpick}>
        {@render dial(sum.total ? sum.mastered / sum.total : 0, sum.mastered === sum.total, null)}
        <span class="count"><b>{n(sum.mastered)}</b><span class="of">/{n(sum.total)}</span></span>
        <span class="name">All</span>
      </button>
    {/if}
    {#each rings as r (r.group)}
      <button type="button" class="ring" class:lit={lit === r.group} aria-pressed={lit === r.group} aria-label={tip(r)} title={tip(r)} onclick={() => onpick(r.group)}>
        {@render dial(r.total ? r.mastered / r.total : 0, r.mastered === r.total, ICON[r.group])}
        <span class="count"><b>{n(r.mastered)}</b><span class="of">/{n(r.total)}</span></span>
        <span class="name">{r.label}</span>
        {#if starred(r.group)}<span class="mark-star" aria-hidden="true">★{starred(r.group)}</span>{/if}
      </button>
    {/each}
  </div>
  {#if line}<p class="next">{line}</p>{/if}
</section>

{#snippet dial(frac: number, full: boolean, icon: GameIconName | null)}
  <span class="dial" class:full>
    <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
      <circle class="track" cx="24" cy="24" r={R} />
      <circle class="arc" cx="24" cy="24" r={R} stroke-dasharray="{shown ? frac * C : 0} {C}" />
    </svg>
    <span class="gi-wrap"><GameIcon name={icon ?? "mastery"} size={icon ? 22 : 20} /></span>
  </span>
{/snippet}

<style>
  /* A row of tiles, as the Codex lays its categories out, then what to do next. */
  .codex { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem 1.6rem; padding: .5rem 0 .6rem; border-top: 1px solid var(--rule); }
  .rings { display: flex; flex-wrap: wrap; gap: .25rem; }
  .ring {
    all: unset; box-sizing: border-box; position: relative; display: grid; justify-items: center; align-content: start; gap: .2rem;
    width: 5.7rem; padding: .45rem .2rem .4rem; border: 1px solid transparent; cursor: pointer;
    transition: background-color .12s, border-color .12s;
  }
  .ring:hover { background: var(--raised); border-color: var(--rule-bright); }
  .ring:focus-visible { outline: 2px solid var(--sec); outline-offset: 2px; }
  /* The picked category: edged in the section's colour, as everywhere it's used. */
  .ring.lit { background: var(--raised); border-color: color-mix(in srgb, var(--sec) 60%, transparent); box-shadow: inset 0 -2px 0 var(--sec); }
  .dial { position: relative; display: inline-grid; place-items: center; width: 48px; height: 48px; }
  .dial svg { position: absolute; inset: 0; transform: rotate(-90deg); }
  circle { fill: none; stroke-width: 4; }
  /* The track darker than the slab's rules, the arc bright: 87% and 69% read apart. */
  .track { stroke: #1c1f24; }
  .arc { stroke: var(--sec); stroke-linecap: butt; opacity: .82; transition: stroke-dasharray .9s cubic-bezier(.2, .7, .2, 1); }
  .ring:hover .arc, .ring.lit .arc, .full .arc { opacity: 1; }
  .full .arc { filter: drop-shadow(0 0 3px color-mix(in srgb, var(--sec) 60%, transparent)); }
  @media (prefers-reduced-motion: reduce) { .arc, .ring { transition: none; } }
  .gi-wrap { display: inline-flex; opacity: .7; }
  .ring:hover .gi-wrap, .ring.lit .gi-wrap { opacity: 1; }
  .count { display: inline-flex; align-items: baseline; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .count b { font-family: var(--face-mark); font-weight: 700; font-size: 1.05rem; color: var(--platinum-dim); }
  .ring:hover .count b, .ring.lit .count b { color: var(--platinum); }
  .of { font-size: .7rem; color: var(--platinum-deep); }
  .name { max-width: 100%; font-family: var(--face-register); font-size: .58rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ring.lit .name { color: var(--sec); }
  /* Wishlist: how many you starred in the category, in gold at the tile's corner. */
  .mark-star { position: absolute; top: .25rem; right: .3rem; font-size: .66rem; font-weight: 600; color: var(--gold); font-variant-numeric: tabular-nums; }
  /* Under the tiles, as their caption. */
  .next { margin: 0; flex-basis: 100%; font-size: .82rem; color: var(--platinum-dim); }
  /* Less room: narrower tiles, so eight stay on one row. */
  :global(html[data-room~="lt950"]) .ring { width: 5.1rem; }
</style>
