<script lang="ts">
  // In an item's details sheet and a Find anything result, for something the never-sell list holds
  // back: "Never sold · Sell again". On the list itself, or across a set (a set with a part on the
  // list, a part of a set on it): then it says which entry holds it, and Sell again takes that one
  // off, named before the click. Nothing shows for anything else (Never sell is set from the plan).
  import Icon from "../Icon.svelte";
  import { pulse } from "../../motion";
  import { neverNames, neverWhy, sellAgainTakes, type NeverHeld } from "../../core/bulk";
  let { name, held, onsellagain }: { name: string; held: NeverHeld; onsellagain: () => void } = $props();
</script>

<span class="never" title={held.self ? `You said never to sell ${name}: every spares plan leaves it out, whatever the rules say` : neverWhy(held)}>
  <span class="tag"><Icon name="lock" size={11} />Never sold</span>
  {#if !held.self}<span class="by small dim">by {neverNames(held)}</span>{/if}
  <button type="button" class="link" title="{sellAgainTakes(held, name)}: the next spares plan lists it when it's spare" onclick={(e) => { pulse(e.currentTarget.parentElement!); onsellagain(); }}>Sell again</button>
</span>

<style>
  .never { display: inline-flex; align-items: center; gap: .6rem; }
  .tag { display: inline-flex; align-items: center; gap: .3rem; margin: 0; color: var(--platinum); border-style: dashed; border-color: var(--rule-control); }
</style>
