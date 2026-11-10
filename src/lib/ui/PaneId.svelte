<script lang="ts">
  // Says which page a pane holds, to what's drawn inside it (the status strip under the page head
  // is drawn only on the page on screen).
  import { setContext, type Snippet } from "svelte";
  import { PANE } from "../statusStrip.svelte";
  let { id, children }: { id: string; children: Snippet } = $props();
  // svelte-ignore state_referenced_locally
  setContext(PANE, id);
</script>

{@render children()}
