<script lang="ts">
  import { imageUrl } from "../backend";
  import { info } from "../hover.svelte";
  import GameIcon, { eraIcon, kindIcon, type GameIconName } from "./GameIcon.svelte";
  import { marketThumb } from "../marketStore.svelte";
  // An item's artwork in a sunk square. Without art in the game data, warframe.market's thumbnail
  // for it (a new arcane); without any, the game's icon for its kind (a blueprint the Foundry, a
  // relic its era), else a small Orokin diamond.
  // `name`: what it shows, for a hover card about it and to find its art or kind.
  // `of`: what it shows, to find its art or kind, without a hover card (Named has its own).
  // `fallback`: the kind's icon when the caller knows it better than the name says.
  let { file, size = 28, alt = "", tint, name, of = null, fallback = null }: { file: string | null | undefined; size?: number; alt?: string; tint?: string | null; name?: string | null; of?: string | null; fallback?: GameIconName | null } = $props();
  // Each picture that didn't load (none in the image cache, or offline): the next one is tried.
  let failed = $state<string[]>([]);
  const src = $derived([file, marketThumb(name ?? of ?? alt)].find((f): f is string => !!f && !failed.includes(f)) ?? null);
  const what = $derived(name ?? of ?? alt);
  const relic = $derived(/^(Lith|Meso|Neo|Axi|Requiem) [A-Z]\d+\b/.exec(what ?? ""));
  // Until the picture has loaded, the well shows its fallback icon faintly, not a dark square.
  let loaded = $state(false);
  $effect(() => {
    src;
    loaded = false;
  });
  const icon = $derived<GameIconName | null>(fallback ?? (/\bBlueprint$/.test(what ?? "") ? "foundry" : relic ? eraIcon(relic[1]) : kindIcon(null, what ?? "")));
</script>

<span class="thumb" use:info={name} style:width="{size}px" style:height="{size}px" style:border-color={tint ?? null}>
  {#if src}
    {#if !loaded}<span class="wait" aria-hidden="true">{#if icon}<span class="kind"><GameIcon name={icon} size={Math.round(size * 0.7)} /></span>{:else}<i class="none"></i>{/if}</span>{/if}
    <img src={imageUrl(src)} {alt} loading="lazy" decoding="async" width={size} height={size} onload={() => (loaded = true)} onerror={() => src && (failed = [...failed, src])} />
  {:else if icon}
    <span class="kind"><GameIcon name={icon} size={Math.round(size * 0.7)} /></span>
  {:else}
    <i class="none" aria-hidden="true"></i>
  {/if}
</span>

<style>
  .thumb {
    display: inline-flex; align-items: center; justify-content: center; flex: none; vertical-align: middle;
    background: radial-gradient(circle at 50% 40%, var(--raised), var(--well)); border: 1px solid var(--rule); overflow: hidden;
    box-shadow: var(--struck);
  }
  .kind { display: inline-flex; opacity: .6; }
  .thumb { position: relative; }
  .wait { position: absolute; inset: 0; display: grid; place-items: center; opacity: .5; pointer-events: none; }
  img { width: 100%; height: 100%; object-fit: contain; }
  /* No picture: a small Orokin diamond rather than an empty well. */
  .none { width: 32%; height: 32%; border: 1px solid var(--rule-control); transform: rotate(45deg); opacity: .6; }
</style>
