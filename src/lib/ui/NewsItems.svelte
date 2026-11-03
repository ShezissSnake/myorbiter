<script lang="ts">
  // One What's New entry: each change a card (its icon, a few words, a line on it with page names
  // and game words in their icons, and a button to where it is); an older entry's plain sentences
  // as a list, with the same icons in them.
  import type { NewsItem } from "../whatsNew";
  import { pageById, type PageId } from "../pages";
  import { parseTarget } from "../intent.svelte";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";
  import Rich from "./Rich.svelte";

  let { items, go = null }: { items: (string | NewsItem)[]; go?: ((to: string) => void) | null } = $props();
  const cards = $derived(items.filter((x): x is NewsItem => typeof x !== "string"));
  const lines = $derived(items.filter((x): x is string => typeof x === "string"));
  /** "Open Orders" for a link to a page; the page's own name. */
  const pageOf = (to: string) => pageById[parseTarget(to).page as PageId] ?? null;
</script>

{#if cards.length}
  <ul class="cards">
    {#each cards as c (c.title)}
      {@const pg = c.open ? pageOf(c.open) : null}
      <li class="card">
        <span class="art" aria-hidden="true">
          {#if "game" in c.icon}<GameIcon name={c.icon.game as GameIconName} size={30} />
          {:else if "line" in c.icon}<Icon name={c.icon.line} size={24} stroke={1.5} />
          {:else}{@const pi = pageById[c.icon.page as PageId]?.icon}{#if pi && "game" in pi}<GameIcon name={pi.game} size={30} />{:else if pi && "line" in pi}<Icon name={pi.line} size={24} stroke={1.5} />{/if}{/if}
        </span>
        <span class="body">
          <b class="t">{c.title}</b>
          <span class="x"><Rich text={c.text} go={go ? (page) => go(page) : null} /></span>
          {#if c.open && pg && go}<button type="button" class="link open" title="Open {pg.label}" onclick={() => go(c.open!)}>{pg.label} →</button>{/if}
        </span>
      </li>
    {/each}
  </ul>
{/if}
{#if lines.length}
  <ul class="lines">{#each lines as l (l)}<li><Rich text={l} go={go ? (page) => go(page) : null} /></li>{/each}</ul>
{/if}

<style>
  .cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: .6rem; }
  .card { display: flex; gap: .75rem; align-items: flex-start; padding: .75rem .85rem; border: 1px solid var(--rule); border-left: 2px solid var(--gold-dim); background: var(--plate); }
  .art { flex: none; width: 2.2rem; height: 2.2rem; display: grid; place-items: center; background: rgb(0 0 0 / 22%); color: var(--platinum-dim); }
  .body { display: grid; gap: .25rem; min-width: 0; }
  .t { color: var(--platinum); font-size: .92rem; }
  .x { font-size: .82rem; line-height: 1.5; color: var(--platinum-dim); }
  .open { justify-self: start; font-size: .64rem; margin-top: .1rem; }
  .lines { margin: 0; padding-left: 1.1rem; display: grid; gap: .45rem; line-height: 1.5; }
</style>
