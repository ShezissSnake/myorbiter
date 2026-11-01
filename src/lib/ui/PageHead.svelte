<script lang="ts">
  import type { Snippet } from "svelte";
  // A page's struck title, a line of what it is, and an optional band of figures beneath.
  let { title, blurb, band }: { title: string; blurb?: string; band?: Snippet } = $props();
</script>

<header class="head">
  <div>
    <span class="orn" aria-hidden="true"><i></i></span>
    <h1 class="mark">{title}</h1>
  </div>
  {#if blurb}<p class="prose" title={blurb}>{blurb}</p>{/if}
</header>
{#if band}<section class="band">{@render band()}</section>{/if}

<style>
  .head {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(14rem, 26rem); align-items: end; gap: var(--course);
    padding: clamp(28px, 5vh, 56px) 0 var(--step);
  }
  h1 { font-size: clamp(2.6rem, 5.4vw, 4.6rem); }
  /* At most two lines, so a long one doesn't push the title down (the whole of it on hover). */
  .head .prose { margin: 0; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  /* The Orokin rule: a gold hairline struck from a small diamond, above every title. */
  .orn { display: flex; align-items: center; width: 4.5rem; margin-bottom: .9rem; }
  .orn i { width: .5rem; height: .5rem; flex: none; background: var(--gold); transform: rotate(45deg); }
  .orn::after { content: ""; flex: 1; height: 1px; margin-left: .35rem; background: linear-gradient(90deg, var(--gold-dim), transparent); }
  .band {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    /* Engraved: the rule under the figures is cut twice. */
    box-shadow: 0 2px 0 var(--slab), 0 3px 0 var(--rule);
    margin-bottom: var(--step);
  }
  /* Page area under 760 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt760"]) .head { grid-template-columns: 1fr; }
  /* Two a row, so four figures make two full rows rather than three and one left alone. */
  :global(html[data-room~="lt760"]) .band:has(> :global(:nth-child(4):last-child)) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* A short window (a Steam Deck's 800 px): a smaller title, so the page itself starts higher. */
  @media (max-height: 860px) {
    .head { padding: 18px 0 .6rem; }
    h1 { font-size: clamp(2.2rem, 4vw, 3.2rem); }
    .orn { margin-bottom: .5rem; }
  }
</style>
