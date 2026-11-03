<script lang="ts">
  import Metal from "./Metal.svelte";
  import { numberFormat } from "./table";
  const one = numberFormat(1);
  const tenth = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // An amount in one of the two metals. A price nobody knows is a struck dash, never a guess.
  // Tenths only where they matter: 2.5p a part, not 75,883.2p of inventory. `tenths`: always one
  // decimal under 100, for a column of them (4.0 beside 5.2, not 4).
  let { v, d = false, dim = false, big = false, tenths = false }: { v: number | null | undefined; d?: boolean; dim?: boolean; big?: boolean; tenths?: boolean } = $props();
</script>

{#if v == null}<span class="none" title="No price">–</span>{:else}<span class="amt" class:d class:dim class:big><b>{Math.abs(v) >= 100 ? one.format(Math.round(v)) : (tenths ? tenth : one).format(v)}</b><Metal kind={d ? "ducat" : "plat"} size={big ? 22 : 12} /></span>{/if}

<style>
  .amt { display: inline-flex; align-items: center; gap: .28rem; white-space: nowrap; }
  b { font-family: var(--face-mark); font-weight: 700; font-size: .98rem; font-variant-numeric: tabular-nums; color: var(--platinum); }
  .d b { color: var(--gold); }
  .dim b { color: var(--platinum-dim); font-weight: 600; }
  .d.dim b { color: var(--gold-dim); }
  .big b { font-size: inherit; }
  /* Nothing here: quiet, but still readable (about 5:1). */
  .none { color: var(--platinum-deep); }
</style>
