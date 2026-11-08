<script lang="ts">
  // The label of a control that opens a link: "Opening…" in its place while the app starts the
  // browser (links.svelte.ts). Both sit in one grid cell, so the control keeps its width as they
  // swap. The control itself (its button, look and aria-busy) stays the caller's.
  import type { Snippet } from "svelte";
  import { links } from "../links.svelte";

  let { url, children }: { url: string; children: Snippet } = $props();
  const busy = $derived(links.isOpening(url));
</script>

<span class="opening"><span class:on={!busy}>{@render children()}</span><span class:on={busy}>Opening…</span></span>

<style>
  .opening { display: inline-grid; gap: inherit; }
  .opening > span { grid-area: 1 / 1; visibility: hidden; display: inline-flex; align-items: center; gap: inherit; white-space: nowrap; }
  .opening > span.on { visibility: visible; }
</style>
