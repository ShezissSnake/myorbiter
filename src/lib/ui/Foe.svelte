<script lang="ts">
  // Who a mission is against: the faction's sigil as the star chart shows it, then its name (or
  // just the sigil, its name on hover). A faction without a sigil here (Crossfire) is its name.
  import GameIcon, { factionIcon } from "./GameIcon.svelte";

  let { enemy, size = 13, name = true }: { enemy: string; size?: number; name?: boolean } = $props();
  const icon = $derived(factionIcon(enemy));
</script>

<span class="foe" title={enemy}>{#if icon}<GameIcon name={icon} {size} />{/if}{#if name || !icon}<span class="n">{enemy.replace(/^The /, "")}</span>{/if}</span>

<style>
  .foe { display: inline-flex; align-items: center; gap: .28rem; min-width: 0; vertical-align: middle; }
  .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
