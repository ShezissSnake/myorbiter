<script lang="ts">
  // Over every page (App puts it above the page, with the other banners), one line at a time, while
  // there is something to do about updates (`updates.banner`):
  // - a newer build on your channel: Update and restart downloads it (the button fills), installs
  //   it once its signature checks out and restarts MyOrbiter into it. Nothing installs without
  //   that click. A copy that can't replace its own file is told why instead, with no button.
  // - your channel has no build while another has this build or a newer one: Switch to it, in one
  //   click. A channel that follows the most stable build still does (it comes back by itself); a
  //   channel picked by hand, or kept from before, stays picked on the one switched to.
  // Later puts that build away (the line goes, and comes back for any other build); the version at
  // the top of the sidebar still has it, and so has Settings, Updates. Details opens that version's
  // panel.
  import { CHANNEL_LABEL, compareVersions, installNote, noteLines, switchAfter } from "./core/updates";
  import { updates, updatesPanel } from "./updates.svelte";
  import ProgressButton from "./ui/ProgressButton.svelte";

  const b = $derived(updates.banner);
  const running = $derived(updates.info?.version ?? "");
  const lines = $derived(b?.kind === "update" ? noteLines(b.offer.notes, 4) : []);
  const putOff = $derived(b ? (b.kind === "update" ? b.offer.version : b.version) : "");
</script>

{#if b}
  <div class="upd" role="status" aria-live="polite" data-banner={b.kind === "update" ? "update" : "update-switch"}>
    <span class="ic" aria-hidden="true">↑</span>
    {#if b.kind === "update"}
      <span class="msg" title={lines.length ? `What changed:\n${lines.join("\n")}` : undefined}><b>MyOrbiter {b.offer.version} is out</b> on {CHANNEL_LABEL[b.offer.channel]}; you have {running}.</span>
      {#if b.installs}
        <ProgressButton job={updates.installJob} tone="gold" label="Update and restart" sizer={["Downloading 100%", "Restarting", "Not installed"]} title="Download {b.offer.version}, check its signature, install it and restart MyOrbiter into it" onclick={() => updates.install()} status />
      {:else if updates.info}
        <span class="why">{installNote(updates.info.install)}</span>
      {/if}
    {:else}
      <span class="msg"><b>{CHANNEL_LABEL[b.from]} has no build yet</b>, so no update reaches this copy. {CHANNEL_LABEL[b.to]} has {b.version}{compareVersions(b.version, running) === 0 ? ", this build" : ""}.</span>
      <button type="button" class="stamp gold" data-field="updates.banner-switch" title={`Get updates from ${CHANNEL_LABEL[b.to]} from now on. ${switchAfter(b.from, b.to, updates.follows)}. Nothing installs without your click`} onclick={() => updates.switchTo(b.to)}>Switch to {CHANNEL_LABEL[b.to]}</button>
    {/if}
    <span class="more">
      <button type="button" class="link" title="Your version and channel, Check now, and the channel to choose" onclick={() => (updatesPanel.open = true)}>Details</button>
      <button type="button" class="link" title={`Hide this for ${putOff} only; any other build shows it again. The version at the top of the sidebar still has it`} disabled={updates.installJob.working} onclick={() => updates.later()}>Later</button>
    </span>
  </div>
{/if}

<style>
  /* One slim line across the top of the page, as the app's other banners, in gold: something to
     do, not something wrong. It wraps at the narrowest window rather than cutting its words. */
  .upd { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .9rem; padding: .4rem 1.4rem; font-size: .8rem; color: var(--platinum-dim); background: color-mix(in srgb, var(--gold) 8%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--gold) 50%, transparent); box-shadow: inset 3px 0 0 var(--gold); }
  .ic { font-weight: 700; color: var(--gold); margin-right: -.4rem; }
  .msg { flex: 1 1 16rem; min-width: 0; }
  .msg b { color: var(--platinum); font-weight: 600; font-variant-numeric: tabular-nums; }
  .why { flex: 1 1 14rem; font-size: .76rem; color: var(--platinum-deep); }
  .more { display: inline-flex; gap: .9rem; align-items: center; }
  .more .link { font-size: 11px; }
  .upd :global(.stamp) { padding-top: .25rem; padding-bottom: .25rem; font-size: 11px; }
</style>
