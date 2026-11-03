<script lang="ts">
  // A What's New change's icon: the game's, one of orbiter's line icons, a page's own sidebar icon,
  // or the four sections' sigils, each in its colour (app.css, data-section).
  import type { NewsItem } from "../whatsNew";
  import { pageById, type PageId } from "../pages";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";

  let { icon, size = 30 }: { icon: NewsItem["icon"]; size?: number } = $props();
  // Line icons are drawn on a 16px grid: a little smaller than the game's, to look the same size.
  const line = $derived(Math.round(size * 0.8));
  const pi = $derived("page" in icon ? pageById[icon.page as PageId]?.icon : null);
</script>

{#if "sections" in icon}
  <span class="secs" style:--s="{size}px" aria-hidden="true">
    {#each ["Fissures", "Progress", "Collection", "Trade"] as s (s)}<i data-section={s}></i>{/each}
  </span>
{:else if "game" in icon}<GameIcon name={icon.game as GameIconName} {size} />
{:else if "line" in icon}<Icon name={icon.line} size={line} stroke={1.5} />
{:else if pi && "game" in pi}<GameIcon name={pi.game} {size} />
{:else if pi && "line" in pi}<Icon name={pi.line} size={line} stroke={1.5} />{/if}

<style>
  /* The four sigils two by two, each masked out of its section's colour. */
  .secs { display: grid; grid-template-columns: 1fr 1fr; gap: calc(var(--s) * .12); width: var(--s); height: var(--s); }
  .secs i { background: var(--sec); -webkit-mask: var(--sec-sigil) center / contain no-repeat; mask: var(--sec-sigil) center / contain no-repeat; }
</style>
