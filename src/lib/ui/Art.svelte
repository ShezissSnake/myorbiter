<script lang="ts">
  import { imageUrl } from "../backend";
  // An item's artwork, large, standing in a faint pool of light. An Orokin diamond when there's none.
  let { file, size = 120, dim = false, alt = "" }: { file: string | null | undefined; size?: number; dim?: boolean; alt?: string } = $props();
  let failed = $state(false);
  $effect(() => {
    file;
    failed = false;
  });
</script>

<span class="art" class:dim style:width="{size}px" style:height="{size}px">
  {#if file && !failed}
    <img src={imageUrl(file, true)} {alt} loading="lazy" decoding="async" onerror={() => (failed = true)} />
  {:else}
    <i class="none" aria-hidden="true"></i>
  {/if}
</span>

<style>
  .art {
    position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none;
    background: radial-gradient(ellipse 60% 22% at 50% 92%, rgb(214 174 74 / 13%), transparent 70%),
      radial-gradient(circle at 50% 45%, rgb(230 233 238 / 5%), transparent 62%);
  }
  img { max-width: 100%; max-height: 100%; object-fit: contain; filter: drop-shadow(0 6px 10px rgb(0 0 0 / 55%)); transition: transform .2s ease-out, filter .2s; }
  .dim img { filter: grayscale(.55) brightness(.75) drop-shadow(0 6px 10px rgb(0 0 0 / 55%)); }
  .none { width: 22%; height: 22%; border: 1px solid var(--rule-control); transform: rotate(45deg); opacity: .5; }
</style>
