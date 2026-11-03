<script lang="ts">
  // More filters: the controls most visits don't need, folded behind one button so the page
  // starts with what matters. `active`: how many of them are set away from their defaults, shown
  // on the button so a folded filter never hides why the list looks short. `reset` puts them back.
  // `on`: a few words for what the folded filters keep to now, defaults included ("Tradable, sells daily").
  import type { Snippet } from "svelte";
  let { label = "More filters", active = 0, reset = null, title, on = "", children }: { label?: string; active?: number; reset?: (() => void) | null; title?: string; on?: string; children: Snippet } = $props();
  let open = $state(false);
</script>

<span class="fold-wrap">
  <button type="button" class="fold" class:on={active > 0} aria-expanded={open} title={title ?? `${open ? "Hide" : "Show"} the rest of the filters${active ? ` (${active} set)` : ""}`} onclick={() => (open = !open)}>
    {label}{#if on}<span class="on-now">{on}</span>{/if}{#if active}<b class="n">{active}</b>{/if}<span class="chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
  </button>
  {#if active && reset && !open}<button type="button" class="link quiet clear" title="Put the folded filters back to their defaults" onclick={reset}>Clear</button>{/if}
</span>
{#if open}<div class="folded">{@render children()}</div>{/if}

<style>
  .fold-wrap { display: inline-flex; align-items: center; gap: .4rem; }
  .fold { display: inline-flex; align-items: center; gap: .45rem; }
  .fold.on { border-color: var(--gold-dim); color: var(--platinum); }
  .n { font-family: var(--face-mark); font-size: .8rem; color: var(--gold); }
  /* What the folded filters narrow to right now, so a short list never looks unexplained. */
  .on-now { font-family: var(--face-body); font-size: .74rem; letter-spacing: 0; text-transform: none; color: var(--platinum-deep); }
  .chev { font-size: .7rem; color: var(--platinum-deep); }
  .clear { font-size: .62rem; }
  /* The folded controls take a row of their own under the bar, wrapping like it. */
  .folded { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .7rem; padding: .55rem .7rem; border: 1px dashed var(--rule); background: rgb(255 255 255 / 1.5%); }
</style>
