<script lang="ts">
  // Overframe's popular builds for the item, from the list bundled with MyOrbiter (overframeList.ts):
  // at most 5, the most voted updated in the last two years. Each row is what
  // Overframe's own list shows (title, author, votes, Forma, update, age) and opens the build on
  // overframe.gg in the browser, so its author gets the visit. No contents, no slot grid, no
  // missing check: Overframe allows showing its lists, not its builds. MyOrbiter never contacts it.
  import { links, openUrl } from "../../links.svelte";
  import Opening from "../Opening.svelte";
  import type { CatalogItem } from "../../core/types";
  import { loadOverframe, overframeBuildUrl, overframeFor, updatedAt, OVERFRAME_ORIGIN, OVERFRAME_SITE, type OverframeFile } from "../../core/builds";
  import { ago, dayOf, overframeUrl } from "../../core/buildsPage";
    import { arrive } from "../../motion";
  import Icon from "../Icon.svelte";

  let { item }: { item: CatalogItem } = $props();

  let file = $state<OverframeFile | null | undefined>(undefined);
  $effect(() => {
    let gone = false;
    void loadOverframe().then((f) => {
      if (!gone) file = f;
    });
    return () => (gone = true);
  });

  const now = Date.now();
  const found = $derived(overframeFor(file ?? null, item.uniqueName, { name: item.name, now }));
  const collected = $derived(file ? Date.parse(file.collected) : NaN);
</script>

<section class="ofl" data-card="popular" aria-label="Popular on {OVERFRAME_SITE}" aria-busy={file === undefined}>
  <header class="hd">
    <h2 class="register">Popular on {OVERFRAME_SITE}</h2>
    <span class="sub">Most voted builds for {item.name}, updated in the last two years</span>
    <span class="grow"></span>
    {#if Number.isFinite(collected)}<span class="when" title="MyOrbiter's copy of {OVERFRAME_SITE}'s build lists, read on {dayOf(collected)}. MyOrbiter never contacts {OVERFRAME_SITE}: a newer copy comes with an update">Collected {dayOf(collected)}</span>{/if}
  </header>
  <p class="credit">
    Builds by their authors on <button type="button" class="link out" title="Open overframe.gg in your browser" aria-busy={links.isOpening(OVERFRAME_ORIGIN)} onclick={() => openUrl(OVERFRAME_ORIGIN)}><Opening url={OVERFRAME_ORIGIN}>{OVERFRAME_SITE}<Icon name="external" size={10} /></Opening></button>. Each opens there, in your browser.
  </p>

  {#if file === undefined}
    <p class="state" role="status">Looking up {item.name} in MyOrbiter's copy of {OVERFRAME_SITE}'s lists…</p>
  {:else if file === null}
    <p class="state">MyOrbiter's copy of {OVERFRAME_SITE}'s lists is missing from this install. <button type="button" class="link out" title="Search {OVERFRAME_SITE} for {item.name}'s builds, in your browser" aria-busy={links.isOpening(overframeUrl(item.name))} onclick={() => openUrl(overframeUrl(item.name))}><Opening url={overframeUrl(item.name)}>Search {OVERFRAME_SITE}<Icon name="external" size={10} /></Opening></button></p>
  {:else if !found.builds.length}
    <p class="state">No popular {OVERFRAME_SITE} builds for this item in MyOrbiter's list. <button type="button" class="link out" title="Search {OVERFRAME_SITE} for {item.name}'s builds, in your browser" aria-busy={links.isOpening(overframeUrl(item.name))} onclick={() => openUrl(overframeUrl(item.name))}><Opening url={overframeUrl(item.name)}>Search {OVERFRAME_SITE}<Icon name="external" size={10} /></Opening></button></p>
  {:else}
    <ol class="rows" in:arrive={{ y: 0 }}>
      {#each found.builds as b (b.id)}
        {@const at = updatedAt(b)}
        <li>
          <button type="button" class="row" title="Open “{b.title}” by {b.author || 'its author'} on {OVERFRAME_SITE}, in your browser" aria-busy={links.isOpening(overframeBuildUrl(b.path))} onclick={() => openUrl(overframeBuildUrl(b.path))}>
            <span class="votes"><b>{b.score.toLocaleString("en")}</b><span class="vw">vote{b.score === 1 ? "" : "s"}</span></span>
            <span class="main">
              <span class="tt">{b.title}</span>
              <span class="meta">
                {#if b.author}<span>by {b.author}</span>{/if}
                <span>{b.formas} Forma</span>
                {#if b.patch}<span class="chip">{b.patch}</span>{/if}
                {#if Number.isFinite(at)}<span>updated {ago(at, now)}</span>{/if}
                {#if links.isOpening(overframeBuildUrl(b.path))}<span class="opening">Opening…</span>{/if}
              </span>
            </span>
            <span class="go" aria-hidden="true"><Icon name="external" size={12} /></span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .ofl { margin-top: var(--course); padding-top: var(--step); border-top: 1px solid var(--rule); }
  .hd { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .9rem; }
  .hd h2 { margin: 0; color: var(--sec); font-size: .7rem; }
  .sub { font-size: .82rem; color: var(--platinum-dim); }
  .grow { flex: 1; }
  .when { font-size: .74rem; color: var(--platinum-deep); }
  .credit { margin: .3rem 0 0; font-size: .78rem; color: var(--platinum-deep); }
  .out { display: inline-flex; align-items: center; gap: .2rem; }
  .state { display: flex; align-items: center; flex-wrap: wrap; gap: .3rem .6rem; margin: .7rem 0 0; font-size: .82rem; color: var(--platinum-dim); }

  .rows { list-style: none; margin: .7rem 0 0; padding: 0; display: grid; border-top: 1px solid var(--rule); }
  .rows > li { border-bottom: 1px solid var(--rule); }
  /* The whole row is the link: Overframe's list line, opened on overframe.gg. */
  .row {
    all: unset; box-sizing: border-box; cursor: pointer; width: 100%;
    display: grid; grid-template-columns: 4.2rem minmax(0, 1fr) auto; align-items: center; gap: .3rem 1rem;
    padding: .6rem .6rem .6rem 0;
    transition: background-color var(--snap) var(--out);
  }
  .row:hover { background: var(--plate); }
  .row:hover .tt { color: var(--platinum); text-decoration: underline; text-decoration-color: var(--sec-dim); text-underline-offset: 3px; }
  .row:hover .go { color: var(--sec); }
  .row:focus-visible { outline: 2px solid var(--sec); outline-offset: -2px; }
  .votes { display: grid; justify-items: center; line-height: 1.05; padding: .25rem 0; background: var(--well); border: 1px solid var(--rule); }
  .votes b { font-family: var(--face-figures); font-size: .95rem; font-weight: 600; color: var(--platinum); font-variant-numeric: tabular-nums; }
  .vw { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  .main { display: grid; gap: .22rem; min-width: 0; }
  .tt { font-size: .92rem; font-weight: 500; color: var(--platinum); overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: .1rem .8rem; font-size: .76rem; color: var(--platinum-deep); }
  .chip { padding: .02rem .4rem; border: 1px solid color-mix(in srgb, var(--sec) 40%, var(--rule)); color: var(--platinum-dim); font-family: var(--face-register); font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
  .go { color: var(--platinum-deep); padding-right: .2rem; transition: color var(--snap) var(--out); }
  :global(html[data-room~="lt760"]) .row { grid-template-columns: 3.6rem minmax(0, 1fr) auto; gap: .3rem .7rem; }
</style>
