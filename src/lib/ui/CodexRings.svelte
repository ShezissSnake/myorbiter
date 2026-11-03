<script lang="ts">
  // The Codex rings atop Mastery, Foundry and Wishlist: one sigil per category (Warframes, Primary,
  // Secondary, Melee, Companions, Archwing, Other) in a thin ring of mastered against all, the count
  // beside it. The page's category is lit; `onpick` makes each ring a button (a filter, or a jump).
  // `line`: the next thing to do, from the page's own figures.
  import { onMount } from "svelte";
  import type { CodexRing } from "../core/codex";
  import type { Group } from "../core/collection";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";

  let {
    rings,
    lit = null,
    onpick = null,
    line = null,
    what = "mastered",
    action = null,
  }: {
    rings: CodexRing[];
    lit?: Group | null;
    onpick?: ((g: Group) => void) | null;
    line?: string | null;
    /** What the ring counts: "mastered" (of all), or of what you starred. */
    what?: "mastered" | "starred";
    /** What a click does, for the tooltip: "show only Primary", say. */
    action?: ((r: CodexRing) => string) | null;
  } = $props();

  const ICON: Record<Group, GameIconName> = { warframes: "warframes", primary: "primary", secondary: "secondary", melee: "melee", companions: "companions", archwing: "archwing", other: "foundry" };
  const R = 21;
  const C = 2 * Math.PI * R;
  // The rings fill once, as the page opens (still with reduced motion: see the style).
  let shown = $state(false);
  onMount(() => {
    const f = requestAnimationFrame(() => (shown = true));
    return () => cancelAnimationFrame(f);
  });
  const n = (x: number) => x.toLocaleString("en");
  const tip = (r: CodexRing) =>
    `${r.label}: ${what === "starred" ? `${n(r.mastered)} of the ${n(r.total)} you starred mastered` : `${n(r.mastered)} of ${n(r.total)} mastered`}${action ? `. ${action(r)}` : ""}`;
</script>

<section class="codex" aria-label="Codex: {what === 'starred' ? 'what you starred, by category' : 'mastered by category'}">
  <div class="rings">
    {#each rings as r (r.group)}
      {@const frac = r.total ? r.mastered / r.total : 0}
      {#if onpick}
        <button type="button" class="ring" class:lit={lit === r.group} class:full={r.mastered === r.total} aria-pressed={lit === r.group} aria-label={tip(r)} title={tip(r)} onclick={() => onpick?.(r.group)}>{@render sigil(r, frac)}</button>
      {:else}
        <div class="ring" class:lit={lit === r.group} class:full={r.mastered === r.total} title={tip(r)}>{@render sigil(r, frac)}</div>
      {/if}
    {/each}
  </div>
  {#if line}<p class="next">{line}</p>{/if}
</section>

{#snippet sigil(r: CodexRing, frac: number)}
  <span class="dial">
    <svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">
      <circle class="track" cx="24" cy="24" r={R} />
      <circle class="arc" cx="24" cy="24" r={R} stroke-dasharray="{shown ? frac * C : 0} {C}" />
    </svg>
    <span class="gi-wrap"><GameIcon name={ICON[r.group]} size={22} /></span>
  </span>
  <span class="count"><b>{n(r.mastered)}</b><span class="of">/{n(r.total)}</span></span>
{/snippet}

<style>
  /* One line: the Codex's sigils, each in its ring, then what to do next. */
  .codex { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1.6rem; padding: .55rem 0 .6rem; border-top: 1px solid var(--rule); }
  .rings { display: flex; flex-wrap: wrap; gap: .2rem .4rem; }
  .ring {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: .45rem; padding: .25rem .6rem .25rem .25rem;
    border: 1px solid transparent;
  }
  button.ring { cursor: pointer; }
  button.ring:hover { background: var(--raised); }
  button.ring:focus-visible { outline: 2px solid var(--sec); outline-offset: 1px; }
  .dial { position: relative; display: inline-grid; place-items: center; width: 46px; height: 46px; flex: none; }
  .dial svg { position: absolute; inset: 0; transform: rotate(-90deg); }
  circle { fill: none; stroke-width: 2; }
  .track { stroke: var(--rule-bright); }
  .arc { stroke: var(--sec-dim); stroke-linecap: butt; transition: stroke-dasharray .9s cubic-bezier(.2, .7, .2, 1); }
  @media (prefers-reduced-motion: reduce) { .arc { transition: none; } }
  .gi-wrap { display: inline-flex; opacity: .62; }
  .count { display: inline-flex; align-items: baseline; font-variant-numeric: tabular-nums; }
  .count b { font-family: var(--face-mark); font-weight: 700; font-size: 1.15rem; color: var(--platinum-dim); }
  .of { font-size: .74rem; color: var(--platinum-deep); }
  /* The page's category: its ring and sigil lit in the section's teal. */
  .ring.lit { border-color: color-mix(in srgb, var(--sec) 45%, transparent); background: var(--raised); }
  .ring.lit .arc { stroke: var(--sec); }
  .ring.lit .gi-wrap { opacity: 1; }
  .ring.lit .count b { color: var(--platinum); }
  /* A category mastered to the last: a closed ring in full teal. */
  .ring.full .arc { stroke: var(--sec); }
  .next { margin: 0 0 0 auto; font-size: .82rem; color: var(--platinum-dim); max-width: 28rem; }
  :global(html[data-room~="lt1100"]) .next { margin-left: 0; max-width: none; flex-basis: 100%; }
</style>
