<script lang="ts">
  import Metal from "./Metal.svelte";
  import { numberFormat } from "./table";
  const one = numberFormat(1);
  // An amount in one of the two metals. A price nobody knows is a struck dash, never a guess.
  // Tenths only where they matter: 2.5p a part, not 75,883.2p of inventory.
  let { v, d = false, dim = false, big = false }: { v: number | null | undefined; d?: boolean; dim?: boolean; big?: boolean } = $props();
</script>

{#if v == null}<span class="none" title="No price">–</span>{:else}<span class="amt" class:d class:dim class:big><b>{one.format(Math.abs(v) >= 100 ? Math.round(v) : v)}</b><Metal kind={d ? "ducat" : "plat"} size={big ? 22 : 12} /></span>{/if}

<style>
  .amt { display: inline-flex; align-items: center; gap: .28rem; white-space: nowrap; }
  b { font-family: var(--face-mark); font-weight: 700; font-size: .98rem; font-variant-numeric: tabular-nums; color: var(--platinum); }
  .d b { color: var(--gold); }
  .dim b { color: var(--platinum-dim); font-weight: 600; }
  .d.dim b { color: var(--gold-dim); }
  .big b { font-size: inherit; }
  .none { color: var(--rule-control); opacity: .7; }
</style>
