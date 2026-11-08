<script lang="ts">
  import type { Snippet } from "svelte";
  // A page's struck title, a line of what it is, and an optional band of figures beneath. The
  // Details switch shows or hides the detail every page keeps on hover (lib/view.svelte.ts): off,
  // the page's short `brief`, which fits one line; on, the whole `blurb`.
  import { view } from "../view.svelte";
  import { reveal } from "../motion";
  // hero: the section's signature (the reward screen, the Codex rings, the showcase, the ticker),
  // between the title and the figures.
  let { title, blurb, brief, band, hero }: { title: string; blurb?: string; brief?: string; band?: Snippet; hero?: Snippet } = $props();
  const line = $derived(view.details ? blurb : (brief ?? blurb));
</script>

<header class="head">
  <!-- The section's sigil and an engraved rule, struck in the section's colour for its first 72 px,
       across the head; then the section's icon and name (from app.css, by the pane's data-section). -->
  <span class="orn" aria-hidden="true"><i></i></span>
  <div>
    <span class="kicker register" aria-hidden="true"><i></i></span>
    <!-- tabindex -1: a page switch by keyboard puts the focus here (App.svelte, focusPage). -->
    <h1 class="mark" tabindex="-1">{title}</h1>
  </div>
  <div class="side">
    {#if line}<p class="prose" title={blurb}>{line}</p>{/if}
    <button type="button" class="details" class:on={view.details} aria-pressed={view.details} title={view.details ? "Details are showing: the sentence under each figure, every column. Click to keep just the essentials (the rest stays on hover)" : "Show details: the sentence under each figure and every column, on every page. Off, they're on hover"} onclick={() => view.set(!view.details)}><span class="box"></span>Details</button>
  </div>
</header>
<!-- data-card "hero": What's New's Show me lights a section's signature (page#hero). -->
{#if hero}<div class="hero" data-card="hero">{@render hero()}</div>{/if}
<!-- A band that comes or goes with the page's data (Sales' first or last sale) folds rather than snaps. -->
{#if band}<div class="reveal" transition:reveal><div><section class="band">{@render band()}</section></div></div>{/if}

<style>
  .head {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(14rem, 26rem); align-items: end; gap: 0 var(--course);
    padding: clamp(18px, 3vh, 34px) 0 calc(var(--step) * .8);
  }
  /* Struck large, but not so large the page starts halfway down a laptop screen. */
  h1 { font-size: clamp(2.2rem, 3.4vw, var(--title-size)); }
  /* Focused only to start the page there: no ring on a title you can't press. */
  h1:focus { outline: none; }
  /* At most three lines, so a long one doesn't push the title down (the whole of it on hover). */
  .head .prose { margin: 0; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  /* Details off: one short line (the whole blurb on hover). */
  :global(html:not([data-details])) .head .prose { -webkit-line-clamp: 1; line-clamp: 1; }
  .side { display: grid; gap: .5rem; justify-items: end; min-width: 0; }
  .side .prose { justify-self: stretch; }
  .details { display: inline-flex; align-items: center; gap: .45rem; padding: .25rem .55rem; font-size: .62rem; color: var(--platinum-deep); }
  .details .box { width: .55rem; height: .55rem; border: 1px solid var(--rule-control); }
  .details.on { color: var(--platinum); }
  .details.on .box { background: var(--gold); border-color: var(--gold); }
  /* The engraved rule above every title: a 9 px diamond in the section's colour, then a hairline
     struck in that colour for 72 px and plain after. Outside a section, neutral. */
  .orn { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .orn i { width: 9px; height: 9px; flex: none; background: var(--sec); transform: rotate(45deg); }
  .orn::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--sec) 0 72px, var(--rule) 72px); }
  /* The kicker: the section's icon (a void tear, the mastery mark, the Arsenal, the market) and
     name, in its colour. Only in a section. */
  .kicker { display: none; align-items: center; gap: 8px; margin-bottom: 6px; color: var(--sec); line-height: 1.2; }
  :global([data-section]) .kicker { display: flex; }
  .kicker i { width: 14px; height: 14px; flex: none; background: var(--sec); -webkit-mask: var(--sec-sigil) center / contain no-repeat; mask: var(--sec-sigil) center / contain no-repeat; }
  .kicker::after { content: var(--sec-name, ""); }
  .hero { margin: 0 0 var(--step); }
  .band {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    /* Engraved: the rule under the figures is cut twice. */
    box-shadow: 0 2px 0 var(--slab), 0 3px 0 var(--sec-dim);
    margin-bottom: var(--step);
  }
  /* Page area under 760 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt760"]) .head { grid-template-columns: 1fr; row-gap: .8rem; }
  /* Two a row, so four figures make two full rows rather than three and one left alone. */
  :global(html[data-room~="lt760"]) .band:has(> :global(:nth-child(4):last-child)) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* A short window (a Steam Deck's 800 px): a smaller title, so the page itself starts higher. */
  @media (max-height: 860px) {
    .head { padding: 18px 0 .6rem; }
    h1 { font-size: clamp(2.1rem, 3.2vw, 40px); }
    .orn { margin-bottom: 8px; }
  }
</style>
