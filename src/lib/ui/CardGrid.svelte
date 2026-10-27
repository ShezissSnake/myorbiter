<script lang="ts">
  import type { Snippet } from "svelte";
  // Cards flowing into as many columns as fit.
  let { min = "17rem", children }: { min?: string; children: Snippet } = $props();
</script>

<div class="grid" style:--min={min}>{@render children()}</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--min), 100%), 1fr)); gap: .8rem; }
</style>
