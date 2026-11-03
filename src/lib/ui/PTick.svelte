<script lang="ts">
  // P's big figure (a page's band), rolling to its new value when a filter changes it (Count).
  // Only for a few figures at a time: a table's cells stay plain P.
  //   <Stat label="Spare value"><PTick v={value.spare} /></Stat>
  import Count from "./Count.svelte";
  import Metal from "./Metal.svelte";
  import { numberFormat } from "./table";
  const one = numberFormat(1);
  let { v, d = false, dim = false }: { v: number | null | undefined; d?: boolean; dim?: boolean } = $props();
  const fmt = (n: number) => (Math.abs(n) >= 100 ? one.format(Math.round(n)) : one.format(Math.round(n * 10) / 10));
</script>

{#if v == null}<span class="none" title="No price">–</span>{:else}<span class="amt" class:d class:dim><b><Count value={v} format={fmt} /></b><Metal kind={d ? "ducat" : "plat"} size={22} /></span>{/if}

<style>
  .amt { display: inline-flex; align-items: center; gap: .28rem; white-space: nowrap; }
  b { font-family: var(--face-mark); font-weight: 700; font-size: inherit; font-variant-numeric: tabular-nums; color: var(--platinum); }
  .d b { color: var(--gold); }
  .dim b { color: var(--platinum-dim); font-weight: 600; }
  .d.dim b { color: var(--gold-dim); }
  .none { color: var(--platinum-deep); }
</style>
