<script lang="ts">
  // A toggle: a small square that fills white when on, and its label (after the game's icon for
  // it, when there is one: what kind of thing it turns on). `locked`: it stays as it is (the last
  // of a set that must keep one on), and says so to a screen reader; its title says why.
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";
  let { on = $bindable(), label, title, game, line, locked = false, onchange }: { on: boolean; label: string; title?: string; game?: GameIconName; line?: string; locked?: boolean; onchange?: (on: boolean) => void } = $props();
</script>

<button type="button" class="chip" class:on class:locked aria-pressed={on} aria-disabled={locked || undefined} {title} onclick={() => { if (locked) return; on = !on; onchange?.(on); }}><span class="box"></span>{#if game}<GameIcon name={game} size={14} />{:else if line}<Icon name={line} size={13} />{/if}{label}</button>

<style>
  .chip { display: inline-flex; align-items: center; gap: .5rem; }
  .box { width: .62rem; height: .62rem; border: 1px solid var(--rule-control); flex: none; }
  /* On reads at a glance: the whole chip lit, not just its square. */
  .chip.on { color: var(--platinum); border-color: var(--platinum-dim); background: rgb(241 243 246 / 6%); }
  .chip.on .box { background: var(--platinum); border-color: var(--platinum); }
  .chip.locked { cursor: default; }
</style>
