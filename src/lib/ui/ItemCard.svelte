<script lang="ts">
  import type { Snippet } from "svelte";
  import Art from "./Art.svelte";
  import GameIcon, { kindIcon, type GameIconName } from "./GameIcon.svelte";
  import { info } from "../hover.svelte";
  // An item as a card: its name, its artwork, whatever the page shows beside it (part chips,
  // rewards, prices), and a footer of tags. A gold edge means you own it.
  let {
    title,
    sub,
    image,
    artSize = 116,
    owned = false,
    done = false,
    dimArt = false,
    fav,
    onfav,
    onopen,
    hover,
    children,
    foot,
    art,
    fallback = null,
    tint = null,
  }: {
    title: string;
    sub?: string;
    image: string | null | undefined;
    artSize?: number;
    /** Gold edge: you have it. */
    owned?: boolean;
    /** Finished with it (mastered): quieter. */
    done?: boolean;
    dimArt?: boolean;
    fav?: boolean;
    onfav?: () => void;
    onopen?: () => void;
    /** The name the hover card describes when pointing at the art or the title. */
    hover?: string | null;
    children?: Snippet;
    foot?: Snippet;
    /** Drawn instead of the artwork: a mod or arcane as its in-game card. */
    art?: Snippet;
    /** Without artwork: the game's icon for its kind (a relic's era, Primary, Companion…) instead of an empty frame. */
    fallback?: GameIconName | null;
    /** A relic's era colour (table.ts, eraTint): a faint wash of it over the card. */
    tint?: string | null;
  } = $props();

  // A kind the Arsenal has a tab for ("Warframe", "Primary Mod", "Companion") gets that tab's icon.
  const subIcon = $derived(kindIcon(sub));

  // Buttons on the card (List, the star) do their own thing; anywhere else opens the details.
  function click(e: MouseEvent) {
    const hit = (e.target as HTMLElement).closest("button, a, input, select, label, [role=dialog]");
    if (hit && hit !== e.currentTarget) return;
    onopen?.();
  }
  function key(e: KeyboardEvent) {
    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
      e.preventDefault();
      onopen?.();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<article class="card" class:owned class:done class:tinted={!!tint} style:--tint={tint} class:open={!!onopen} tabindex={onopen ? 0 : undefined} role={onopen ? "button" : undefined} aria-label={onopen ? `${title}: details` : undefined} onclick={click} onkeydown={key}>
  <header>
    <div class="t">
      <h3 class="mark" title={hover ? undefined : title} use:info={hover ?? null}>{title}</h3>
      {#if sub}<span class="register sub">{#if subIcon}<GameIcon name={subIcon} size={11} />{/if}{sub}</span>{/if}
    </div>
    {#if onfav}
      <button class="star" class:on={fav} aria-pressed={fav} aria-label={fav ? `Remove ${title} from your wishlist` : `Add ${title} to your wishlist`} title={fav ? "On your wishlist (click to remove)" : "Add to your wishlist"} onclick={(e) => { e.stopPropagation(); onfav(); }}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.6l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.4l-4 2.2 1-4.4-3.4-3 4.5-.5z" /></svg>
      </button>
    {/if}
  </header>
  <div class="body">
    <span class="pic" use:info={hover ?? null}>{#if art}{@render art()}{:else if !image && fallback}<span class="kind-art" style:width="{artSize}px" style:height="{artSize}px"><GameIcon name={fallback} size={Math.round(artSize * 0.55)} /></span>{:else}<Art file={image} size={artSize} dim={dimArt} alt="" />{/if}</span>
    {#if children}<div class="side">{@render children()}</div>{/if}
  </div>
  {#if foot}<footer>{@render foot()}</footer>{/if}
</article>

<style>
  .card {
    position: relative; display: grid; grid-template-rows: auto 1fr auto; min-width: 0;
    background: linear-gradient(180deg, #14161a, var(--plate) 40%);
    border: 1px solid var(--rule); clip-path: var(--cut);
    padding: .75rem .85rem .65rem; gap: .4rem;
    transition: border-color .15s, background .15s, transform .15s;
    /* Off-screen cards skip layout and paint until scrolled near: big grids switch in and scroll smoothly. */
    content-visibility: auto;
    contain-intrinsic-size: auto 13rem;
  }
  .card.open { cursor: pointer; }
  .card.open:hover { border-color: var(--rule-control); background: linear-gradient(180deg, #181a1f, #121418 50%); }
  .card.open:hover :global(.art img) { transform: translateY(-2px) scale(1.03); }
  .card:focus-visible { outline: none; box-shadow: inset 0 0 0 1px var(--gold); }
  /* Owned: a gold rule along the top and a warm edge. */
  .card.owned { border-color: color-mix(in srgb, var(--gold) 38%, var(--rule)); background: linear-gradient(180deg, #1a1810, var(--plate) 45%); }
  .card.owned::before { content: ""; position: absolute; left: 7px; right: 0; top: 0; height: 2px; background: linear-gradient(90deg, var(--gold), transparent 85%); }
  /* A relic's era: its colour washes in from the top (the gold line still says you own it). */
  .card.tinted { background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 11%, #14161a), var(--plate) 60%); border-color: color-mix(in srgb, var(--tint) 22%, var(--rule)); }
  .card.done { opacity: .78; }
  .card.done:hover { opacity: 1; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; min-width: 0; }
  .t { min-width: 0; display: grid; gap: .25rem; }
  h3 { font-size: 1.12rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1; padding-top: .1rem; }
  .t .register { font-size: .6rem; }
  /* 28 px to click, though the star itself stays small. */
  .star { display: grid; place-items: center; width: 28px; height: 28px; margin: -6px -6px 0 0; padding: 0; border: 0; background: none; line-height: 0; color: var(--platinum-deep); }
  .star:active:not(:disabled) { background: none; }
  .star svg { fill: none; stroke: currentColor; stroke-width: 1.2; }
  .star:hover { color: var(--gold); }
  .star.on { color: var(--gold); }
  .star.on svg { fill: var(--gold); }
  .body { display: flex; align-items: center; gap: .7rem; min-width: 0; }
  /* A real box (not display: contents), so the hover card has something to point at. */
  .pic { display: block; flex: none; line-height: 0; }
  .side { flex: 1; min-width: 0; display: grid; gap: .45rem; align-content: center; }
  footer { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; min-height: 1.4rem; padding-top: .45rem; border-top: 1px solid var(--rule); font-size: .78rem; }
  footer:empty { display: none; }
  .kind-art { display: inline-flex; align-items: center; justify-content: center; opacity: .6; background: radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--platinum) 6%, transparent), transparent 65%); }
  .sub { display: inline-flex; align-items: center; gap: .3rem; }
  .sub :global(.gi) { opacity: .75; }
</style>
