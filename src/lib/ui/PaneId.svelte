<script lang="ts">
  // Says which page a pane holds, to what's drawn inside it (the page head reads its section).
  import { setContext, type Snippet } from "svelte";
  import { PANE } from "../statusStrip.svelte";
  let { id, children }: { id: string; children: Snippet } = $props();
  // svelte-ignore state_referenced_locally
  setContext(PANE, id);
</script>

{@render children()}
