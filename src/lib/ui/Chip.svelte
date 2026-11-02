<script lang="ts">
  // A toggle: a small square that fills with gold when on, and its label (after the game's icon for
  // it, when there is one: what kind of thing it turns on).
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";
  let { on = $bindable(), label, title, game, line, onchange }: { on: boolean; label: string; title?: string; game?: GameIconName; line?: string; onchange?: (on: boolean) => void } = $props();
</script>

<button type="button" class="chip" class:on aria-pressed={on} {title} onclick={() => { on = !on; onchange?.(on); }}><span class="box"></span>{#if game}<GameIcon name={game} size={14} />{:else if line}<Icon name={line} size={13} />{/if}{label}</button>

<style>
  .chip { display: inline-flex; align-items: center; gap: .5rem; }
  .box { width: .62rem; height: .62rem; border: 1px solid var(--rule-control); flex: none; }
  .chip.on { color: var(--platinum); border-color: var(--rule-control); }
  .chip.on .box { background: var(--gold); border-color: var(--gold); }
</style>
