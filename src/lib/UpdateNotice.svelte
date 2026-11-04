<script lang="ts">
  // A newer build is out on your channel: a calm card in the bottom right corner, there until you
  // answer it. Update and restart downloads it (the button fills as it comes in), installs it once
  // its signature checks out and restarts orbiter; Later puts this version away until a newer one
  // is out. Nothing installs without the click.
  import { arrive, leave } from "./motion";
  import { CHANNEL_LABEL, noteLines } from "./core/updates";
  import { updates } from "./updates.svelte";
  import ProgressButton from "./ui/ProgressButton.svelte";
  import Icon from "./ui/Icon.svelte";

  // onsettings: opens Settings at Updates (the channel, Check now, the release page).
  let { onsettings }: { onsettings: () => void } = $props();
  const n = $derived(updates.notice);
  const lines = $derived(noteLines(n?.notes, 4));
</script>

{#if n}
  <div class="update" role="status" aria-live="polite" aria-label="Update available" in:arrive|global={{ always: true }} out:leave|global>
    <div class="head">
      <span class="ic" aria-hidden="true"><Icon name="refresh" size={14} /></span>
      <span class="txt">
        <b>orbiter {n.version} is out</b>
        <span class="dim">on {CHANNEL_LABEL[n.channel]}</span>
      </span>
      <button class="x" aria-label="Later" title="Later: hide this until a newer version is out (Settings, Updates still has it)" disabled={updates.installJob.working} onclick={() => updates.later()}><Icon name="close" size={11} /></button>
    </div>
    {#if lines.length}<ul class="notes">{#each lines as line, i (i)}<li>{line}</li>{/each}</ul>{/if}
    <div class="acts">
      <ProgressButton job={updates.installJob} tone="gold" label="Update and restart" sizer={["Downloading 100%", "Restarting", "Not installed"]} title="Download {n.version}, check its signature, install it and restart orbiter into it" onclick={() => updates.install()} status />
      <button type="button" class="link" title="Hide this until a newer version is out (Settings, Updates still has it)" disabled={updates.installJob.working} onclick={() => updates.later()}>Later</button>
      <button type="button" class="link" title="Settings, Updates: your channel, Check now and the release notes" onclick={onsettings}>Settings</button>
    </div>
  </div>
{/if}

<style>
  .update { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; width: min(22rem, calc(100vw - 2rem)); display: grid; gap: .65rem; padding: .8rem .9rem .9rem; border: 1px solid var(--rule-bright); background: var(--plate); box-shadow: 0 10px 30px rgb(0 0 0 / 55%), inset 3px 0 0 var(--gold); clip-path: var(--cut); }
  /* A side panel open: behind its shade, as the notifications go. */
  :global(html[data-scrim]) .update { z-index: 39; }
  .head { display: grid; grid-template-columns: 1.4rem 1fr auto; gap: .6rem; align-items: start; }
  .ic { display: grid; place-items: center; height: 1.3rem; color: var(--gold); }
  .txt { display: grid; gap: .15rem; font-size: .82rem; }
  .txt b { color: var(--platinum); font-weight: 600; font-size: .88rem; font-variant-numeric: tabular-nums; }
  .notes { margin: 0; padding-left: 2.9rem; display: grid; gap: .2rem; font-size: .78rem; color: var(--platinum-dim); line-height: 1.4; }
  .notes li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acts { display: flex; align-items: center; gap: .9rem; padding-left: 2rem; flex-wrap: wrap; }
  .x { padding: .3rem; line-height: 0; border-color: transparent; background: transparent; color: var(--platinum-deep); }
  .x:hover:not(:disabled) { color: var(--platinum); }
</style>
