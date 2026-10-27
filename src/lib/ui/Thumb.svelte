<script lang="ts">
  import { imageUrl } from "../backend";
  import { info } from "../hover.svelte";
  // An item's artwork in a sunk square; an empty well when there is none.
  // `name`: what it shows, for a hover card about it.
  let { file, size = 28, alt = "", tint, name }: { file: string | null | undefined; size?: number; alt?: string; tint?: string | null; name?: string | null } = $props();
  let failed = $state(false);
  $effect(() => {
    file;
    failed = false;
  });
</script>

<span class="thumb" use:info={name} style:width="{size}px" style:height="{size}px" style:border-color={tint ?? null}>
  {#if file && !failed}
    <img src={imageUrl(file)} {alt} loading="lazy" decoding="async" width={size} height={size} onerror={() => (failed = true)} />
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
  img { width: 100%; height: 100%; object-fit: contain; }
  /* No picture: a small Orokin diamond rather than an empty well. */
  .none { width: 32%; height: 32%; border: 1px solid var(--rule-control); transform: rotate(45deg); opacity: .6; }
</style>
