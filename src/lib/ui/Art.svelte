<script lang="ts">
  import { imageUrl } from "../backend";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import { marketThumb } from "../marketStore.svelte";
  // An item's artwork, large, in a lit picture well. Without it (none, or it didn't
  // load), warframe.market's thumbnail for `name` (a new arcane), then the game's icon for its kind
  // when the caller knows one, else a faint Orokin diamond.
  let { file, size = 120, dim = false, alt = "", fallback = null, name = null }: { file: string | null | undefined; size?: number; dim?: boolean; alt?: string; fallback?: GameIconName | null; name?: string | null } = $props();
  let failed = $state<string[]>([]);
  const src = $derived([file, marketThumb(name)].find((f): f is string => !!f && !failed.includes(f)) ?? null);
  // The 128 px copy where the slot needs no more than that in device pixels (a 64 px slot on a 2x
  // screen, a 128 px slot on a 1x one), the 400 px copy above: 10x the pixels to decode for every
  // card in a grid, and no sharper at that size.
  const large = $derived(size * (typeof devicePixelRatio === "number" ? devicePixelRatio : 1) > 128);
</script>

<span class="art" class:dim class:small={size < 56} style:width="{size}px">
  {#if src}
    <!-- A market thumbnail has no large copy. -->
    <img src={imageUrl(src, large && !src.startsWith("wfm."))} {alt} width={size} height={size} loading="lazy" decoding="async" onerror={() => src && (failed = [...failed, src])} />
  {:else if fallback}
    <span class="kind"><GameIcon name={fallback} size={Math.round(size * 0.55)} /></span>
  {:else}
    <i class="none" aria-hidden="true"></i>
  {/if}
</span>

<style>
  /* A picture well: sunk, lit softly from behind the item, a contact shadow under it, and corner
     brackets (brackets mean "a picture"). Gradients rather than a drop-shadow filter on the
     picture: a blurred filter is redrawn with every card on every scrolled frame, and on a long
     grid that was most of the cost of scrolling. */
  .art {
    /* Square at any width: a box narrowed by its container keeps its shape (and its light)
       instead of being squeezed into a tall strip. */
    position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none; aspect-ratio: 1; max-width: 100%;
    background: radial-gradient(ellipse 40% 9% at 50% 89%, rgb(0 0 0 / 60%), transparent 75%),
      radial-gradient(circle at 50% 46%, rgb(241 243 246 / 7%), transparent 62%),
      var(--well);
    box-shadow: inset 0 2px 10px rgb(0 0 0 / 60%);
  }
  .art::before {
    content: ""; position: absolute; inset: 6px; pointer-events: none;
    --b: var(--rule-control);
    background:
      linear-gradient(var(--b), var(--b)) left top / 10px 1px no-repeat, linear-gradient(var(--b), var(--b)) left top / 1px 10px no-repeat,
      linear-gradient(var(--b), var(--b)) right top / 10px 1px no-repeat, linear-gradient(var(--b), var(--b)) right top / 1px 10px no-repeat,
      linear-gradient(var(--b), var(--b)) left bottom / 10px 1px no-repeat, linear-gradient(var(--b), var(--b)) left bottom / 1px 10px no-repeat,
      linear-gradient(var(--b), var(--b)) right bottom / 10px 1px no-repeat, linear-gradient(var(--b), var(--b)) right bottom / 1px 10px no-repeat;
  }
  /* Too small for brackets to read as anything but noise. */
  .art.small::before { display: none; }
  img { max-width: 100%; max-height: 100%; object-fit: contain; }
  /* Mastered or out of reach: greyed and darker (a colour filter, no blur). */
  .dim img { filter: grayscale(.55) brightness(.75); }
  .kind { display: inline-flex; opacity: .6; }
  .none { width: 22%; height: 22%; border: 1px solid var(--rule-control); transform: rotate(45deg); opacity: .5; }
</style>
