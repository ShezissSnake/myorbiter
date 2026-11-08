<script lang="ts">
  // Under every page head: the game, the inventory read (or the fissure under way), warframe.market
  // and platinum, with repricing in platinum's place on Trade's pages (by the pane's data-section),
  // and how fresh it all is on the right. Read from lib/statusStrip.svelte.ts.
  import { status } from "../statusStrip.svelte";
  const s = $derived(status());
</script>

{#if s}
  <div class="strip" role="group" aria-label="Status" data-card="status">
    {#each s.items as it (it.label)}
      <span class="it" title={it.title}><span class="register">{it.label}</span><b>{it.value}</b></span>
    {/each}
    {#if s.plat}<span class="it plat" title={s.plat.title}><span class="register">{s.plat.label}</span><b>{s.plat.value}</b></span>{/if}
    <span class="it rep" title={s.repricing.title}><span class="register">{s.repricing.label}</span><b>{s.repricing.value}</b></span>
    {#if s.updated}<span class="upd register">Updated {s.updated}</span>{/if}
  </div>
{/if}

<style>
  /* A slim lit plate: label and value pairs, wrapping onto a second line where the page is narrow. */
  .strip {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 28px; min-width: 0;
    margin: 0 0 var(--step); padding: 7px 14px;
    background: var(--plate-sheen), var(--plate); border: 1px solid var(--rule); box-shadow: var(--plate-light);
  }
  .it { display: inline-flex; align-items: baseline; gap: 8px; min-width: 0; max-width: 100%; }
  .it .register { flex: none; font-size: .72rem; }
  .it b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; font-weight: 600; color: var(--platinum); }
  .upd { margin-left: auto; font-size: .72rem; white-space: nowrap; }
  /* Trade's pages show repricing where the others show platinum. */
  .rep { display: none; }
  :global([data-section="Trade"]) .rep { display: inline-flex; }
  :global([data-section="Trade"]) .plat { display: none; }
</style>
