<script lang="ts">
  // The running version at the top of the sidebar, on every page, in both widths: a button that
  // opens the version's panel (UpdatesPanel: the channel, Check now, Follow, what is on offer). A
  // gold diamond beside it while there is something to do about updates (a newer build on the
  // channel, or an empty channel's switch), put off with Later or not. The channel is in its
  // tooltip; none is named while a new install hasn't settled one.
  import { CHANNEL_LABEL, buildNumber, type UpdateSettings } from "./core/updates";
  import { updates, updatesPanel } from "./updates.svelte";

  // `data-card`: the sidebar spot What's New's Show me lights (App.svelte's `goTo`).
  let { compact, settings, "data-card": card }: { compact: boolean; settings: () => UpdateSettings; "data-card"?: string } = $props();
  const info = $derived(updates.info);
  const ch = $derived(info && buildNumber(info.version) != null && settings().picked ? CHANNEL_LABEL[settings().channel] : null);
  const dot = $derived(updates.waiting);
</script>

{#if info}
  <button type="button" id="updates-chip" data-card={card} class="chip" class:compact class:on={updatesPanel.open} data-field="updates.chip" aria-haspopup="dialog" aria-expanded={updatesPanel.open} aria-controls={updatesPanel.open ? "updates-panel" : undefined} title={`MyOrbiter ${info.version}${ch ? ` on ${ch}` : ""}${dot ? ": an update is waiting" : ""}. Your channel, Check now and what is on offer`} onclick={() => (updatesPanel.open = !updatesPanel.open)}>
    <span class="v">{info.version}</span>{#if dot}<i class="dot" aria-label="An update is waiting"></i>{/if}
  </button>
{/if}

<style>
  /* The version as it was (small, muted), now a button: it lights on hover and while its panel is open. */
  .chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 1px 4px; margin-left: -5px; border: 1px solid transparent; background: transparent; font-family: var(--face-register); font-size: 11px; font-weight: 400; letter-spacing: .14em; line-height: 1.3; color: var(--platinum-deep); font-variant-numeric: tabular-nums; white-space: nowrap; text-transform: none; }
  .chip:hover, .chip.on, .chip:focus-visible { color: var(--platinum); border-color: var(--rule-bright); }
  .chip:active { transform: none; }
  .v { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .dot { flex: none; width: 6px; height: 6px; background: var(--gold); transform: rotate(45deg); }
  /* Folded: under the craft, tighter. */
  .chip.compact { margin: 0; padding: 1px 2px; font-size: 10px; letter-spacing: .04em; gap: 4px; }
</style>
