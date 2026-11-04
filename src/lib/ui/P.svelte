<script lang="ts" module>
  import { numberFormat } from "./table";
  // Made once for every figure: a table shows hundreds of these, and a formatter each was a
  // noticeable part of drawing one (WebKitGTK builds them slowly).
  const one = numberFormat(1);
  const tenth = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
</script>

<script lang="ts">
  import Count from "./Count.svelte";
  // An amount in one of the two metals. A price nobody knows is a struck dash, never a guess.
  // Tenths only where they matter: 2.5p a part, not 75,883.2p of inventory. `tenths`: always one
  // decimal under 100, for a column of them (4.0 beside 5.2, not 4). `tick`: a total that rolls to
  // its new value when it changes (Count), as a span or a filter changes it.
  let { v, d = false, dim = false, big = false, tenths = false, tick = false }: { v: number | null | undefined; d?: boolean; dim?: boolean; big?: boolean; tenths?: boolean; tick?: boolean } = $props();
  const fmt = (n: number) => (Math.abs(n) >= 100 ? one.format(Math.round(n)) : (tenths ? tenth : one).format(n));
  // Rolling between whole amounts stays whole (no 56.3 on the way from 0 to 500).
  const rolled = (n: number) => fmt(v != null && Number.isInteger(v) ? Math.round(n) : n);
</script>

<!-- The metal's icon drawn here rather than with <Metal>: a table shows hundreds of these, and two
     components fewer each is most of what drawing one costs. The same picture, size and title. -->
{#if v == null}<span class="none" title="No price">–</span>{:else}<span class="amt" class:d class:dim class:big><b>{#if tick}<Count value={v} format={rolled} />{:else}{fmt(v)}{/if}</b><img class="gi {d ? 'ducats' : 'platinum'}" src="/game/{d ? 'ducats' : 'platinum'}.png" width={big ? 25 : 14} height={big ? 25 : 14} alt={d ? "ducats" : "platinum"} title={d ? "ducats" : "platinum"} draggable="false" /></span>{/if}

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
