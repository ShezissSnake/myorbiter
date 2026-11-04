<script lang="ts">
  // Inside a category's options, only when it has some: "Never sold: 4 mods", opening the list of
  // them with Sell again on each (and Sell all again for two or more). Selling one again takes it
  // off the list at once; it's back in the next plan.
  import { reveal, flip, leave } from "../../motion";
  import Icon from "../Icon.svelte";
  import type { NeverSell } from "../../core/sparesRules";

  let { entries, one, many, onsellagain }: { entries: NeverSell[]; one: string; many: string; onsellagain: (ids: string[]) => void } = $props();
  let open = $state(false);
  const id = `never-${Math.random().toString(36).slice(2, 8)}`;
</script>

{#if entries.length}
  <div class="never">
    <button type="button" class="link quiet head" aria-expanded={open} aria-controls={id} title="Things you said never to sell: they're left out of every plan, whatever the rules say" onclick={() => (open = !open)}>
      <Icon name="lock" size={12} />Never sold: {entries.length} {entries.length === 1 ? one : many}<span class="chev" aria-hidden="true">▾</span>
    </button>
    {#if open}
      <div class="reveal" transition:reveal {id}><div>
        <ul>
          {#each entries as n (n.id)}
            <li out:leave animate:flip><span class="nm">{n.name}</span><button type="button" class="link" title="Back in the plan: sold again when the rules say it's spare" onclick={() => onsellagain([n.id])}>Sell again</button></li>
          {/each}
        </ul>
        {#if entries.length > 1}<button type="button" class="link all" title="Every one of these back in the plan" onclick={() => onsellagain(entries.map((n) => n.id))}>Sell all {entries.length} again</button>{/if}
      </div></div>
    {/if}
  </div>
{/if}

<style>
  .never { display: grid; gap: .3rem; }
  .head { display: inline-flex; align-items: center; gap: .4rem; justify-self: start; text-transform: none; letter-spacing: 0; font-family: var(--face-text); font-size: .78rem; }
  .chev { font-size: .65rem; }
  ul { list-style: none; margin: .2rem 0 0; padding: .35rem .6rem; display: grid; gap: .1rem; border: 1px dashed var(--rule); max-height: 12rem; overflow: auto; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 26px; }
  .nm { font-family: var(--face-mark); font-weight: 700; text-transform: uppercase; font-size: .86rem; color: var(--platinum-dim); }
  .all { justify-self: start; margin-top: .2rem; }
</style>
