<script lang="ts">
  import { numberFormat } from "./table";
  const one = numberFormat(1);
  const tenth = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // An amount in one of the two metals. A price nobody knows is a struck dash, never a guess.
  // Tenths only where they matter: 2.5p a part, not 75,883.2p of inventory. `tenths`: always one
  // decimal under 100, for a column of them (4.0 beside 5.2, not 4).
  let { v, d = false, dim = false, big = false, tenths = false }: { v: number | null | undefined; d?: boolean; dim?: boolean; big?: boolean; tenths?: boolean } = $props();
</script>

<!-- The metal's icon drawn here rather than with <Metal>: a table shows hundreds of these, and two
     components fewer each is most of what drawing one costs. The same picture, size and title. -->
{#if v == null}<span class="none" title="No price">–</span>{:else}<span class="amt" class:d class:dim class:big><b>{Math.abs(v) >= 100 ? one.format(Math.round(v)) : (tenths ? tenth : one).format(v)}</b><img class="gi {d ? 'ducats' : 'platinum'}" src="/game/{d ? 'ducats' : 'platinum'}.png" width={big ? 25 : 14} height={big ? 25 : 14} alt={d ? "ducats" : "platinum"} title={d ? "ducats" : "platinum"} draggable="false" /></span>{/if}

<style>
  .amt { display: inline-flex; align-items: center; gap: .28rem; white-space: nowrap; }
  /* As GameIcon draws it. */
  .gi { display: inline-block; flex: none; object-fit: contain; vertical-align: middle; }
  b { font-family: var(--face-mark); font-weight: 700; font-size: .98rem; font-variant-numeric: tabular-nums; color: var(--platinum); }
  .d b { color: var(--gold); }
  .dim b { color: var(--platinum-dim); font-weight: 600; }
  .d.dim b { color: var(--gold-dim); }
  .big b { font-size: inherit; }
  /* Nothing here: quiet, but still readable (about 5:1). */
  .none { color: var(--platinum-deep); }
</style>
