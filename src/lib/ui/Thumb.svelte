<script lang="ts">
  import { imageUrl } from "../backend";
  import { info } from "../hover.svelte";
  import GameIcon from "./GameIcon.svelte";
  // An item's artwork in a sunk square; an empty well when there is none (a blueprint without
  // art shows the Foundry).
  // `name`: what it shows, for a hover card about it.
  let { file, size = 28, alt = "", tint, name }: { file: string | null | undefined; size?: number; alt?: string; tint?: string | null; name?: string | null } = $props();
  let failed = $state(false);
  // Until the picture has loaded, the well shows its fallback (the Foundry or the diamond) faintly,
  // rather than a dark square.
  let loaded = $state(false);
  $effect(() => {
    file;
    failed = false;
    loaded = false;
  });
  const blueprint = $derived(/\bBlueprint$/.test(name ?? alt));
</script>

<span class="thumb" use:info={name} style:width="{size}px" style:height="{size}px" style:border-color={tint ?? null}>
  {#if file && !failed}
    {#if !loaded}<span class="wait" aria-hidden="true">{#if blueprint}<span class="kind"><GameIcon name="foundry" size={Math.round(size * 0.7)} /></span>{:else}<i class="none"></i>{/if}</span>{/if}
    <img src={imageUrl(file)} {alt} loading="lazy" decoding="async" width={size} height={size} onload={() => (loaded = true)} onerror={() => (failed = true)} />
  {:else if blueprint}
    <span class="kind"><GameIcon name="foundry" size={Math.round(size * 0.7)} /></span>
  {:else}
    <i class="none" aria-hidden="true"></i>
  {/if}
</span>

<style>
  .thumb {
    display: inline-flex; align-items: center; justify-content: center; flex: none; vertical-align: middle;
    background: radial-gradient(circle at 50% 40%, #1b1d22, var(--well)); border: 1px solid var(--rule); overflow: hidden;
    box-shadow: var(--struck);
  }
  .kind { display: inline-flex; opacity: .6; }
  .thumb { position: relative; }
  .wait { position: absolute; inset: 0; display: grid; place-items: center; opacity: .5; pointer-events: none; }
  img { width: 100%; height: 100%; object-fit: contain; }
  /* No picture: a small Orokin diamond rather than an empty well. */
  .none { width: 32%; height: 32%; border: 1px solid var(--rule-control); transform: rotate(45deg); opacity: .6; }
</style>
