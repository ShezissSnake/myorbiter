<script lang="ts">
  // One category of Sell spares: its box (sell these or not), its name, its choices in
  // a line of plain words, and what it would put up. The rest of the row opens its options below
  // it (one row open at a time: the panel says which). Closed, a row is one line.
  import type { Snippet } from "svelte";
  import GameIcon, { type GameIconName } from "../GameIcon.svelte";
  import Icon from "../Icon.svelte";
  import P from "../P.svelte";
  import Count from "../Count.svelte";
  import { reveal } from "../../motion";
  import type { CategoryPreview } from "./types";

  let {
    id,
    on = $bindable(),
    open,
    ontoggle,
    label,
    icon,
    summary,
    preview,
    always = "",
    children,
  }: {
    id: string;
    on: boolean;
    open: boolean;
    ontoggle: () => void;
    label: string;
    icon: GameIconName;
    summary: string;
    preview?: CategoryPreview;
    /** What this category always keeps, whatever the options: said at the foot of its options. */
    always?: string;
    children: Snippet;
  } = $props();
  const est = $derived(preview?.estimate ? "~" : "");
</script>

<section class="cat" class:on class:open {id} data-cat={id}>
  <div class="head">
    <button type="button" class="box" class:on aria-pressed={on} aria-label="Sell {label}" title={on ? `${label}: in the plan. Click to leave every one alone` : `${label}: not in the plan. Click to sell the spare ones`} onclick={() => (on = !on)}><i></i></button>
    <button type="button" class="rowbtn" aria-expanded={open} aria-controls="{id}-opts" title={open ? `Close ${label}'s options` : `${label}: ${on ? summary : "not sold"}. Click to choose what goes and what's kept`} onclick={ontoggle}>
      <span class="nm"><GameIcon name={icon} size={16} />{label}</span>
      <span class="sum">{on ? summary : "Not sold"}</span>
      <span class="fig" class:dim={!on} class:stale={preview?.stale} title={!preview ? "Working out what it would list" : preview.estimate ? "What it would list at the daily prices; the plan reads the cheapest in-game price for each" : "From the plan: its new and changed listings"}>
        {#if preview && preview.listings}
          <span class="n"><b><Count value={preview.listings} /></b> listing{preview.listings === 1 ? "" : "s"}</span>
          <span class="pl">{est}<P v={Math.round(preview.plat)} dim={!on} /></span>
        {:else if preview}<span class="n none">nothing to list</span>{:else}<span class="n none">…</span>{/if}
      </span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>
  </div>
  {#if open}
    <div class="reveal" transition:reveal id="{id}-opts"><div>
      <div class="body">
        <p class="offnote small" class:ghost={on}>Off: none of these is sold, and the choices below wait as they are. Tick the box to sell them.</p>
        {#if preview?.note}<p class="small warn">{preview.note}</p>{/if}
        {@render children()}
        {#if always}<p class="always"><Icon name="lock" size={12} /><span>{always}</span></p>{/if}
      </div>
    </div></div>
  {/if}
</section>

<style>
  /* The figures column has one width, whatever it says ("…", "nothing to list", "1,234 listings ~12,345p"), so ticking a box or a plan arriving changes no row's layout. */
  .cat { --fig-w: 13.5rem; border-bottom: 1px solid var(--rule); }
  .cat.open { background: rgb(255 255 255 / 1.6%); box-shadow: inset 2px 0 0 var(--gold-dim); }
  .head { display: grid; grid-template-columns: 2.1rem minmax(0, 1fr); align-items: stretch; }
  .box { align-self: center; justify-self: center; width: .85rem; height: .85rem; padding: 0; border: 1px solid var(--rule-control); background: transparent; display: grid; }
  .box i { width: 100%; height: 100%; }
  .box.on { border-color: var(--gold); }
  .box.on i { background: var(--gold); }
  .box:hover:not(:disabled) { border-color: var(--gold-dim); }
  /* The rest of the line opens the options: one wide, quiet button. */
  .rowbtn {
    all: unset; box-sizing: border-box; cursor: pointer; min-width: 0;
    display: grid; grid-template-columns: minmax(12rem, 15.5rem) minmax(0, 1fr) var(--fig-w) 1rem; align-items: center; gap: 1rem;
    padding: .62rem .9rem .62rem 0;
  }
  .rowbtn:focus-visible { outline: 1px solid var(--select); outline-offset: -1px; }
  .rowbtn:active .nm { transform: translateY(1px); }
  .nm { display: inline-flex; align-items: center; gap: .5rem; font-family: var(--face-mark); font-weight: 700; font-size: .98rem; text-transform: uppercase; letter-spacing: .005em; color: var(--platinum-dim); white-space: nowrap; transition: transform var(--snap) var(--out); }
  .on .nm, .rowbtn:hover .nm { color: var(--platinum); }
  .sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .8rem; color: var(--platinum-dim); }
  .cat:not(.on) .sum { color: var(--platinum-deep); }
  .fig { display: flex; align-items: center; gap: .7rem; justify-content: flex-end; min-width: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .fig .n { font-size: .78rem; color: var(--platinum-deep); }
  .fig .n b { font-family: var(--face-mark); font-size: 1rem; color: var(--platinum); margin-right: .1rem; }
  .fig.dim .n b { color: var(--platinum-deep); }
  .fig .none { font-family: var(--face-register); font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; }
  .pl { display: inline-flex; align-items: center; min-width: 4.2rem; justify-content: flex-end; color: var(--platinum-deep); font-size: .8rem; }
  .chev { color: var(--platinum-deep); font-size: .72rem; justify-self: end; transition: transform var(--quick) var(--out); }
  .open .chev { transform: rotate(180deg); }
  /* Out of date: greyed by colour, not opacity, so it stays above 4.5:1. */
  .fig.stale, .fig.stale .n, .fig.stale .pl, .fig.stale :global(b), .fig.stale :global(.amt) { color: var(--platinum-deep); }
  /* A narrow page: the choices in words go on a line of their own under the name and figures. */
  :global(html[data-room~="lt900"]) .rowbtn { grid-template-columns: minmax(0, 1fr) var(--fig-w) 1rem; row-gap: .15rem; }
  :global(html[data-room~="lt900"]) .sum { grid-column: 1 / -1; grid-row: 2; }
  .body { display: grid; gap: .8rem; padding: .2rem .9rem 1rem 2.1rem; }
  /* Always there, drawn only while the row is off: ticking the box changes no height. */
  .offnote { margin: 0; color: var(--platinum-deep); }
  .offnote.ghost { visibility: hidden; }
  .warn { margin: 0; color: var(--alert); }
  .warn::before { content: "! "; font-weight: 700; }
  .always { margin: 0; display: flex; gap: .45rem; align-items: baseline; font-size: .76rem; color: var(--platinum-deep); line-height: 1.5; }
  .always :global(svg) { flex: none; transform: translateY(1px); }
</style>
