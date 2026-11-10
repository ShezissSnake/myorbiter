<script lang="ts">
  // A kind label with its slot's icon at the left, in the section's colour: "Primary · Rifle",
  // "Warframe", "Sentinel". One icon a slot (core/kinds.ts); a kind that isn't gear (a mod, a
  // relic) shows its words alone. The text keeps the look of where it sits (a label, a cell).
  //   <Kind kind={item.type} />   <Kind kind="archgun" label="Arch-Gun · Heavy" />
  import { kindSlot } from "../core/kinds";
  import Icon from "./Icon.svelte";

  let { kind, label, size = 14, title }: { kind: string | null | undefined; label?: string; size?: number; title?: string } = $props();
  const slot = $derived(kindSlot(kind));
</script>

<span class="kind" {title}>{#if slot}<span class="ki"><Icon name="kind-{slot}" {size} stroke={1.4} /></span>{/if}{label ?? kind ?? ""}</span>

<style>
  .kind { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
  .ki { display: inline-flex; flex: none; color: var(--sec); }
</style>
