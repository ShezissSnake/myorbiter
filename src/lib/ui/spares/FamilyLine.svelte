<script lang="ts">
  // One kind of thing inside a category (Primed mods, Ayatan sculptures): its box, its name, how
  // many to keep when that's its own number, a few words on the rule, and what it would list. A
  // stack of these is a small table, so a category with seven kinds reads as one block, not seven
  // settings.
  import type { Snippet } from "svelte";
  import Stepper from "./Stepper.svelte";
  import P from "../P.svelte";
  import type { Tally } from "./types";

  let {
    on = $bindable(),
    keep = $bindable(),
    keepMin = 1,
    label,
    title,
    note = "",
    tally = null,
    estimate = true,
    extra,
    fixed = false,
    disabled = false,
  }: {
    /** Its category is off: shown greyed out, kept as it is. */
    disabled?: boolean;
    on: boolean;
    /** Always in while its category is: no box of its own (the category's box turns it off). */
    fixed?: boolean;
    /** Absent: this kind has no keep number of its own. */
    keep?: number;
    keepMin?: number;
    label: string;
    title?: string;
    note?: string;
    tally?: Tally | null;
    estimate?: boolean;
    /** A control of its own beside the keep number (Ayatan: empty or filled). */
    extra?: Snippet;
  } = $props();
</script>

<div class="line" class:off={!on} class:disabled>
  {#if fixed}<span aria-hidden="true"></span>{:else}<button type="button" class="box" class:on aria-pressed={on} aria-label="Sell {label}" {disabled} title={on ? `${label}: sold. Click to keep them all` : `${label}: all kept. Click to sell the spare ones`} onclick={() => (on = !on)}><i></i></button>{/if}
  <span class="name" title={title ?? label}>{label}</span>
  <span class="ctl">
    {#if keep !== undefined}<span class="kw">keep</span><Stepper bind:value={keep} min={keepMin} {disabled} label="{label}: copies to keep" title="{label}: copies of each kept, your best one counted" />{/if}
    {#if extra}{@render extra()}{/if}
    {#if note}<span class="note">{note}</span>{/if}
  </span>
  <span class="tally">
    {#if tally && tally.listings}<span class="n">{tally.listings}</span><span class="pl">{estimate ? "~" : ""}<P v={tally.plat} dim={!on} /></span>{:else}<span class="none">nothing</span>{/if}
  </span>
</div>

<style>
  .line { display: grid; grid-template-columns: 1.2rem minmax(9rem, 12rem) minmax(0, 1fr) 6.6rem; align-items: center; gap: .7rem; min-height: 34px; padding: .2rem 0; border-bottom: 1px solid var(--rule); }
  .line:last-child { border-bottom: 0; }
  .box { width: .8rem; height: .8rem; padding: 0; border: 1px solid var(--rule-control); background: transparent; display: grid; place-items: center; }
  .box i { width: 100%; height: 100%; }
  .box.on { border-color: var(--gold); }
  .box.on i { background: var(--gold); }
  .box:hover:not(:disabled) { border-color: var(--gold-dim); }
  .name { font-size: .84rem; color: var(--platinum); }
  .off .name { color: var(--platinum-deep); }
  .ctl { display: flex; align-items: center; gap: .5rem; min-width: 0; flex-wrap: wrap; }
  .kw { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  .note { flex: 1 1 12rem; min-width: 0; font-size: .76rem; color: var(--platinum-deep); line-height: 1.35; }
  .off .ctl { opacity: .55; }
  .tally { display: inline-flex; justify-content: flex-end; align-items: center; gap: .55rem; font-variant-numeric: tabular-nums; }
  .tally .n { font-family: var(--face-register); font-size: .74rem; color: var(--platinum-dim); }
  .tally .n::after { content: " ·"; color: var(--rule-control); }
  .pl { display: inline-flex; align-items: center; color: var(--platinum-deep); font-size: .8rem; }
  .off .tally { opacity: .5; }
  .disabled .name, .disabled .box { opacity: .55; }
  .none { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--rule-control); }
</style>
