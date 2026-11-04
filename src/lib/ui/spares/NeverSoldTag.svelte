<script lang="ts">
  // In an item's details sheet and a Find anything result, for something on the never-sell list:
  // "Never sold · Sell again". Nothing shows for anything else (Never sell is set from the plan).
  import Icon from "../Icon.svelte";
  import { pulse } from "../../motion";
  let { name, onsellagain }: { name: string; onsellagain: () => void } = $props();
</script>

<span class="never" title="You said never to sell {name}: every spares plan leaves it out, whatever the rules say">
  <span class="tag"><Icon name="lock" size={11} />Never sold</span>
  <button type="button" class="link" title="Off the never-sell list: the next spares plan lists it when it's spare" onclick={(e) => { pulse(e.currentTarget.parentElement!); onsellagain(); }}>Sell again</button>
</span>

<style>
  .never { display: inline-flex; align-items: center; gap: .6rem; }
  .tag { display: inline-flex; align-items: center; gap: .3rem; margin: 0; color: var(--platinum); border-style: dashed; border-color: var(--rule-control); }
</style>
