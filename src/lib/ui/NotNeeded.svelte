<script lang="ts">
  // Gear you no longer need and can't trade (core/notNeeded.ts): what can go, and what's kept
  // back and why. Keep takes one off the list for good; Undo puts it back.
  import type { Model } from "../core/model";
  import { notNeeded, type GearCopy } from "../core/notNeeded";
  import { info } from "../hover.svelte";
  import Thumb from "./Thumb.svelte";

  let { model, gear, keep = $bindable() }: { model: Model; gear: GearCopy[] | null; keep: string[] } = $props();

  const out = $derived(notNeeded(model, gear, new Set(keep)));
  let showKept = $state(false);
</script>

<section class="nn" aria-label="Not needed anymore">
  <p class="lead dim small">
    Built gear can't be traded: sell these for credits in game (Arsenal or Inventory → Sell){out.go.some((g) => g.frame) ? ", or feed a warframe to the Helminth" : ""}. Kept back: what you haven't mastered, what a recipe you haven't mastered takes{gear ? ", one with its Incarnon installed when the better one has none" : ""}, and versions that aren't straight upgrades of each other (a Prime and a Vandal).
  </p>
  {#if out.go.length}
    <ul class="go">
      {#each out.go as g (g.unique)}
        <li>
          <Thumb file={model.imageOf(g.name)} size={34} />
          <div class="t">
            <span class="nm"><b class="mark" use:info={g.name}>{g.name}</b>{#if g.of > 1}<span class="dim small">{g.copies} of your {g.of}</span>{/if}</span>
            <span class="small">{g.why}</span>
            {#each g.notes as n (n)}<span class="dim small">{n}</span>{/each}
            {#if g.check}<span class="check small">{g.check}</span>{/if}
          </div>
          <button class="link" title="Keep it: it leaves this list (Kept back has Undo)" onclick={() => (keep = [...keep, g.unique])}>Keep</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="dim">Nothing to let go: everything you hold is the best version you have of it, or still needed.</p>
  {/if}
  {#if out.kept.length}
    <button class="link" aria-expanded={showKept} onclick={() => (showKept = !showKept)}>{showKept ? "Hide" : "Show"} what's kept back ({out.kept.length})</button>
    {#if showKept}
      <ul class="kept">
        {#each out.kept as k (k.unique)}
          <li><b use:info={k.name}>{k.name}</b><span class="dim small">{k.why}</span>{#if k.yours}<button class="link" title="Put it back on the list" onclick={() => (keep = keep.filter((u) => u !== k.unique))}>Undo</button>{/if}</li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .nn { display: grid; gap: .7rem; margin: 0 0 1rem; padding: .9rem 1.1rem; border: 1px solid var(--rule); background: rgb(17 19 23 / 72%); justify-items: start; }
  .lead { margin: 0; max-width: 90ch; }
  .go { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr)); gap: .8rem 1.6rem; width: 100%; }
  .go li { display: flex; gap: .7rem; align-items: flex-start; min-width: 0; }
  .t { display: grid; gap: .15rem; flex: 1; min-width: 0; }
  .nm { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .6rem; }
  .check { color: var(--gold); }
  .kept { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
  .kept li { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .7rem; font-size: .85rem; }
</style>
