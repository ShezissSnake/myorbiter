<script lang="ts">
  // The running version at the top of the sidebar, on every page: with its channel in the full
  // sidebar ("0.2.141 · Beta"), alone when folded. A gold dot while there is something to do about
  // updates (a newer build on the channel, or an empty channel's switch), put off with Later or
  // not. A click opens the version's panel (UpdatesPanel): the channel, Check now, Follow.
  import { CHANNEL_LABEL, buildNumber, type UpdateSettings } from "./core/updates";
  import { updates, updatesPanel } from "./updates.svelte";

  let { compact, settings }: { compact: boolean; settings: () => UpdateSettings } = $props();
  const info = $derived(updates.info);
  const ch = $derived(info && buildNumber(info.version) != null && settings().picked ? CHANNEL_LABEL[settings().channel] : null);
  const dot = $derived(updates.waiting);
</script>

{#if info}
  <button type="button" class="chip" class:compact class:on={updatesPanel.open} id="updates-chip" data-field="updates.chip" aria-haspopup="dialog" aria-expanded={updatesPanel.open} aria-controls={updatesPanel.open ? "updates-panel" : undefined} title={`MyOrbiter ${info.version}${ch ? ` on ${ch}` : ""}${dot ? ": an update is waiting" : ""}. The channel, Check now and what is on offer`} onclick={() => (updatesPanel.open = !updatesPanel.open)}>
    <span class="v">{info.version}</span>{#if ch && !compact}<span class="c">· {ch}</span>{/if}{#if dot}<i class="dot" aria-label="An update is waiting"></i>{/if}
  </button>
{/if}

<style>
  /* The version as it was (small, muted), now a button: it lights on hover, and gold for a dot. */
  .chip { display: inline-flex; align-items: center; gap: 5px; min-width: 0; padding: 1px 4px; margin-left: -4px; border: 1px solid transparent; background: transparent; font-family: var(--face-register); font-size: 11px; letter-spacing: .14em; line-height: 1.3; color: var(--platinum-deep); font-variant-numeric: tabular-nums; white-space: nowrap; text-transform: none; }
  .chip:hover, .chip.on, .chip:focus-visible { color: var(--platinum); border-color: var(--rule-bright); }
  .chip:active { transform: none; }
  .v, .c { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .c { letter-spacing: .06em; }
  .dot { flex: none; width: 6px; height: 6px; background: var(--gold); transform: rotate(45deg); }
  /* Folded: the version alone, tighter, centred under the craft. */
  .chip.compact { margin: 0; padding: 1px 2px; font-size: 10px; letter-spacing: .04em; gap: 3px; }
</style>
