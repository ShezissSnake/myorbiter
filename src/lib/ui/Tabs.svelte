<script lang="ts" generics="V extends string">
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  // A row of categories with the game's icons, the chosen one lit gold beneath.
  let {
    value = $bindable(),
    options,
    label,
  }: { value: V; options: { v: V; label: string; icon?: GameIconName; count?: number; title?: string }[]; label?: string } = $props();
</script>

<div class="tabs" role="tablist" aria-label={label}>
  {#each options as o (o.v)}
    <button role="tab" aria-selected={value === o.v} class:on={value === o.v} title={o.title ?? `${o.label}${o.count != null ? ` · ${o.count}` : ""}`} aria-label={o.label} onclick={() => (value = o.v)}>
      {#if o.icon}<GameIcon name={o.icon} size={18} />{/if}
      <span class:lbl={!!o.icon}>{o.label}</span>
      {#if o.count != null}<em>{o.count}</em>{/if}
    </button>
  {/each}
</div>

<style>
  .tabs { display: flex; flex-wrap: wrap; gap: .2rem; border-bottom: 1px solid var(--rule); }
  button {
    display: inline-flex; align-items: center; gap: .45rem; padding: .55rem .8rem .6rem; margin-bottom: -1px;
    border: 0; border-bottom: 2px solid transparent; background: none; color: var(--platinum-deep);
  }
  button :global(.gi) { opacity: .55; transition: opacity .12s; }
  button:hover:not(:disabled) { color: var(--platinum); border-bottom-color: var(--rule-control); }
  button:hover :global(.gi) { opacity: .9; }
  button.on { color: var(--platinum); border-bottom-color: var(--gold); }
  button.on :global(.gi) { opacity: 1; }
  em { font-style: normal; color: var(--platinum-deep); font-weight: 500; letter-spacing: .04em; }
  .on em { color: var(--gold); }
  /* Less room (half a wide screen, a Steam Deck): tighter, so a row of tabs stays one row. */
  :global(html[data-room~="lt1100"]) button { padding-left: .5rem; padding-right: .5rem; gap: .35rem; }
  /* Less still: the icons stay (they're what you look for) and the words go, but for the chosen tab's;
     each tab's name and count stay in its tooltip. */
  :global(html[data-room~="lt950"]) button:not(.on) .lbl, :global(html[data-room~="lt950"]) button:not(.on):has(.lbl) em { display: none; }
</style>
