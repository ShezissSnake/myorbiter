<script lang="ts">
  // What's New changes as a list of rows, as on the update screen and the Guide: each change's
  // icon, a few words, a line on it (page names and game words in their icons) and Show me, to the
  // spot on its page. An older entry's plain sentences are rows of their own, without an icon.
  import type { NewsItem } from "../whatsNew";
  import { pageById, type PageId } from "../pages";
  import { parseTarget } from "../intent.svelte";
  import NewsIcon from "./NewsIcon.svelte";
  import Rich from "./Rich.svelte";

  let { items, go = null }: { items: (string | NewsItem)[]; go?: ((to: string) => void) | null } = $props();
  const pageOf = (to: string) => pageById[parseTarget(to).page as PageId] ?? null;
</script>

<ul class="rows">
  {#each items as c, i (i)}
    {#if typeof c === "string"}
      <li class="row plain"><span class="art" aria-hidden="true"><i class="pip"></i></span><span class="x"><Rich text={c} go={go ? (page) => go(page) : null} /></span></li>
    {:else}
      {@const pg = c.open ? pageOf(c.open) : null}
      <li class="row">
        <span class="art" aria-hidden="true"><NewsIcon icon={c.icon} size={26} /></span>
        <b class="t">{c.title}</b>
        <span class="x"><Rich text={c.text} go={go ? (page) => go(page) : null} /></span>
        {#if c.open && pg && go}<button type="button" class="show" title="Show me: open {pg.label} at what changed" onclick={() => go(c.open!)}>Show me</button>{/if}
      </li>
    {/if}
  {/each}
</ul>

<style>
  /* Rows, not cards: icon, title, line and Show me on one line when there's room, hairlines between. */
  .rows { list-style: none; margin: 0; padding: 0; container-type: inline-size; border-top: 1px solid var(--rule); }
  .row {
    display: grid; grid-template-columns: 2.4rem minmax(0, 12.5rem) minmax(0, 1fr) 5.5rem; gap: .2rem 1rem; align-items: baseline;
    padding: .6rem .2rem .65rem 0; border-bottom: 1px solid var(--rule);
  }
  .art { align-self: start; width: 2.4rem; height: 1.35rem; display: grid; place-items: center; color: var(--platinum-dim); }
  .t { color: var(--platinum); font-size: .9rem; font-weight: 600; line-height: 1.35; }
  .x { font-size: .84rem; line-height: 1.5; color: var(--platinum-dim); }
  .show { justify-self: end; padding: .2rem .55rem; font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--gold); border-color: var(--gold-dim); background: transparent; white-space: nowrap; }
  .show::after { content: " →"; }
  .show:hover:not(:disabled) { color: var(--slab); background: var(--gold); border-color: var(--gold); }
  .plain .x { grid-column: 2 / -1; }
  .pip { width: .36rem; height: .36rem; background: var(--platinum-deep); transform: rotate(45deg); }
  /* Narrower: the title over its line, Show me under them. */
  @container (max-width: 44rem) {
    .row { grid-template-columns: 2.4rem minmax(0, 1fr) auto; }
    .art { grid-row: 1 / span 2; }
    .t { grid-column: 2; }
    .x { grid-column: 2 / -1; grid-row: 2; }
    .show { grid-column: 3; grid-row: 1; }
  }
</style>
