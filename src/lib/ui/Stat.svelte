<script lang="ts">
  import type { Snippet } from "svelte";
  import { info } from "../hover.svelte";
  // One figure in a page's band: the number struck large, its label in register type. `hover` names
  // the item the note is about, for its hover card. `title`: what the figure means, on hover (the
  // label and note by default, which the band may cut short).
  // With details off (lib/view.svelte.ts) the note goes to hover, unless `keep`: a note that is
  // the point (what to crack now, when it refreshes).
  // `extra`: a figure only Details shows (the page's main figures stay).
  // `spot`: its name for links that light it (App's goTo, "relics#traces").
  let { label, note, tone = "platinum", hover = null, title = null, keep = false, extra = false, spot = null, children }: { label: string; note?: string; tone?: "platinum" | "gold" | "dim"; hover?: string | null; title?: string | null; keep?: boolean; extra?: boolean; spot?: string | null; children: Snippet } = $props();
</script>

<div class="cell" class:extra data-card={spot} title={title ?? (note ? `${label}: ${note}` : label)}>
  <div class="v mark t-{tone}">{@render children()}</div>
  <div class="register l">{label}</div>
  {#if note}<div class="note" class:keep><span use:info={hover}>{note}</span></div>{/if}
</div>

<style>
  .cell { padding: .85rem 1.2rem .9rem 0; min-width: 0; }
  .cell + :global(.cell) { padding-left: 1.2rem; border-left: 1px solid var(--rule); }
  .v { font-size: clamp(1.9rem, 3vw, 2.7rem); font-variant-numeric: tabular-nums; line-height: 1; display: flex; align-items: center; gap: .35rem; }
  .t-gold { color: var(--gold); }
  .v :global(.of) { color: var(--platinum-deep); font-size: .55em; align-self: flex-end; margin-bottom: .2em; }
  .t-dim { color: var(--platinum-dim); }
  .l { margin-top: .55rem; color: var(--platinum-dim); }
  /* The note folds on its grid row when Details turns off or on (QUICK), so the page under the
     band slides rather than jumping; hidden for good (visibility) once folded. */
  .note {
    display: grid; grid-template-rows: 1fr; margin-top: .2rem; font-size: .74rem; color: var(--platinum-deep);
    transition: grid-template-rows var(--quick) var(--out), margin-top var(--quick) var(--out), opacity var(--quick) var(--out), visibility 0s;
  }
  .note > span { display: block; min-height: 0; overflow: hidden; }
  /* A short window: the same figures, tighter. */
  @media (max-height: 860px) {
    .cell { padding-top: .65rem; padding-bottom: .7rem; }
    .v { font-size: clamp(1.6rem, 2.4vw, 2.1rem); }
    .l { margin-top: .35rem; }
  }
  :global(html:not([data-details])) .note:not(.keep) { grid-template-rows: 0fr; margin-top: 0; opacity: 0; visibility: hidden; transition-delay: 0s, 0s, 0s, var(--quick); }
  :global(html:not([data-details])) .cell.extra { display: none; }
</style>
