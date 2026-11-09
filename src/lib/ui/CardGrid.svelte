<script lang="ts">
  import type { Snippet } from "svelte";
  import { roving } from "./roving";
  // Cards flowing into as many columns as fit. One Tab stop for the lot, the arrow keys between
  // the cards (roving.ts): a page of hundreds takes one Tab, not hundreds, to get past.
  let { min = "17rem", children }: { min?: string; children: Snippet } = $props();
</script>

<div class="grid" style:--min={min} use:roving>{@render children()}</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--min), 100%), 1fr)); gap: .8rem; }
</style>
