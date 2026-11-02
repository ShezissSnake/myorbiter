<script lang="ts">
  // A mission type as its glyph (Icon.svelte, missionIcon): what tells two fissure cards of one
  // era apart at a glance. A Railjack mission (a Void Storm's Skirmish, Volatile, Orphix) is the
  // Railjack's wings.
  import Icon, { missionIcon } from "./Icon.svelte";
  import GameIcon from "./GameIcon.svelte";

  let { type, storm = false, size = 14 }: { type: string; storm?: boolean; size?: number } = $props();
  const railjack = $derived(storm || /^(skirmish|volatile|orphix)/i.test(type));
</script>

<span class="mi" title={type}>{#if railjack}<GameIcon name="railjack" {size} />{:else}<Icon name={missionIcon(type)} {size} />{/if}</span>

<style>
  .mi { display: inline-flex; flex: none; color: inherit; }
</style>
