<script lang="ts">
  // The "?" on every part of the app: a square control at the right end of the part's head bar
  // (or, with `corner`, at its top right corner where a bar wouldn't fit). Quiet until hovered or
  // focused; a click opens, over the page, the walk-through that covers the part at the page about
  // it (help/help.svelte.ts, HelpDialog). Never on hover, and no setting hides it.
  import Icon from "./Icon.svelte";
  import { help } from "../help/help.svelte";
  import { forPart } from "../help/index";

  let { part, corner = false }: { part: string; corner?: boolean } = $props();
  const hit = $derived(forPart(part));
  const about = $derived(hit ? hit.wt.pages[hit.at].title : "");
  const name = $derived(hit ? (hit.wt.pending ? hit.wt.title : about) : "");
</script>

<!-- data-pending: its walk-through isn't written yet; data-unknown: no walk-through covers the part (the sweep fails on it). -->
<button type="button" class="helpmark" class:corner data-help={part} data-pending={hit?.wt.pending ? "" : undefined} data-unknown={hit ? undefined : ""} aria-haspopup="dialog" aria-label={`How to use this: ${name}`} title={`How to use this: ${name}`} onclick={(e) => help.open(part, e.currentTarget)}><Icon name="help" size={14} stroke={1.5} /></button>
