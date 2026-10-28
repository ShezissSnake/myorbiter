<script lang="ts">
  import type { Snippet } from "svelte";
  import { info } from "../hover.svelte";
  // One figure in a page's band: the number struck large, its label in register type. `hover` names
  // the item the note is about, for its hover card. `title`: what the figure means, on hover (the
  // label and note by default, which the band may cut short).
  let { label, note, tone = "platinum", hover = null, title = null, children }: { label: string; note?: string; tone?: "platinum" | "gold" | "dim"; hover?: string | null; title?: string | null; children: Snippet } = $props();
</script>

<div class="cell" title={title ?? (note ? `${label}: ${note}` : label)}>
  <div class="v mark t-{tone}">{@render children()}</div>
  <div class="register l">{label}</div>
  {#if note}<div class="note"><span use:info={hover}>{note}</span></div>{/if}
</div>

<style>
  .cell { padding: 1.1rem 1.2rem 1.2rem 0; min-width: 0; }
  .cell + :global(.cell) { padding-left: 1.2rem; border-left: 1px solid var(--rule); }
  .v { font-size: clamp(1.9rem, 3vw, 2.7rem); font-variant-numeric: tabular-nums; line-height: 1; display: flex; align-items: center; gap: .35rem; }
  .t-gold { color: var(--gold); }
  .v :global(.of) { color: var(--platinum-deep); font-size: .55em; align-self: flex-end; margin-bottom: .2em; }
  .t-dim { color: var(--platinum-dim); }
  .l { margin-top: .55rem; color: var(--platinum-dim); }
  .note { margin-top: .2rem; font-size: .74rem; color: var(--platinum-deep); }
  /* A short window: the same figures, tighter. */
  @media (max-height: 860px) {
    .cell { padding-top: .65rem; padding-bottom: .7rem; }
    .v { font-size: clamp(1.6rem, 2.4vw, 2.1rem); }
    .l { margin-top: .35rem; }
  }
</style>
