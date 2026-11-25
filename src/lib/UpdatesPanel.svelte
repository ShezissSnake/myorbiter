<script lang="ts">
  // The version's panel, from any page in one click (the version at the top of the sidebar, or the
  // banner's Details): this build and its channel, the channel to choose, Follow the most stable
  // build, Check now with its answer, and what is on offer. Drawn fixed beside the sidebar's top, over
  // the page, never moving it; not modal. Esc, a click elsewhere or the window changing size closes
  // it. Settings, Updates has the same and the release notes.
  import { tick } from "svelte";
  import { CHANNEL_LABEL, CHANNELS, channelWord, followWords, installChecks, installInstalls, installNote, noteLines, type Channel, type UpdateSettings } from "./core/updates";
  import { updates, updatesPanel } from "./updates.svelte";
  import Seg from "./ui/Seg.svelte";
  import Switch from "./ui/Switch.svelte";
  import ProgressButton from "./ui/ProgressButton.svelte";
  import IconButton from "./ui/IconButton.svelte";

  // settings: the saved update settings (read, and changed only through the store); onsettings:
  // opens Settings at Updates.
  let { settings, onsettings }: { settings: () => UpdateSettings; onsettings: () => void } = $props();
  let panel = $state<HTMLDivElement | null>(null);
  let place = $state("");
  let now = $state(Date.now());

  const info = $derived(updates.info);
  const u = $derived(settings());
  const checks = $derived(!!info && installChecks(info.install));
  const installs = $derived(!!info && installInstalls(info.install));
  const offer = $derived(updates.offer);
  const sw = $derived(updates.switchOffer);
  const follow = $derived(info ? followWords(info.version, u) : null);

  const chip = () => document.getElementById("updates-chip");
  // Beside the sidebar, level with its top: the same spot in both widths, and when the sidebar waits.
  function measure() {
    const rail = document.querySelector<HTMLElement>(".rail")?.getBoundingClientRect();
    const left = (rail?.right ?? 0) + 8;
    place = `left: ${left}px; top: 10px; width: min(23rem, calc(100vw - ${left + 12}px));`;
  }
  function close(refocus: boolean) {
    updatesPanel.open = false;
    if (refocus) chip()?.focus();
  }
  $effect(() => {
    if (!updatesPanel.open) return;
    measure();
    now = Date.now();
    void tick().then(() => panel?.focus());
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!panel?.contains(t) && !chip()?.contains(t)) close(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const resize = () => measure();
    const tickNow = setInterval(() => (now = Date.now()), 30_000);
    window.addEventListener("keydown", esc, true);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", resize);
    return () => {
      clearInterval(tickNow);
      window.removeEventListener("keydown", esc, true);
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", resize);
    };
  });
</script>

{#if updatesPanel.open && info}
  <div bind:this={panel} id="updates-panel" class="upanel" role="dialog" aria-label="MyOrbiter's version and updates" tabindex="-1" style={place} data-field="updates.panel">
    <div class="head">
      <p class="ver"><b class="mono">MyOrbiter {info.version}</b> <span class="ch">{channelWord(info.version, u)}</span></p>
      <IconButton icon="close" tone="quiet" label="Close" onclick={() => close(true)} />
    </div>
    {#if installNote(info.install)}<p class="hint">{installNote(info.install)}</p>{/if}
    {#if checks}
      <!-- A new install that hasn't settled shows no channel as chosen here (Settings shows the one it starts on). -->
      <Seg label="Channel" value={u.picked ? u.channel : ("" as Channel)} options={CHANNELS.map((c) => ({ ...c }))} onchange={(c) => updates.setChannel(c)} />
      {#if updates.unsettled}<p class="hint">{updates.unsettled}</p>{:else if follow}<p class="hint" data-field="updates.follows">{follow}</p>{/if}
      {#if updates.followable && u.picked}
        <Switch name="updates.follow" label="Follow the most stable build" bind:on={() => u.follows, (v) => (v ? updates.follow() : updates.unfollow())}>
          The most stable channel whose build is this one or newer. Choosing a channel by hand turns it off.
        </Switch>
      {/if}
      <div class="row">
        <ProgressButton job={updates.checkJob} busy={updates.checking} label="Check now" sizer={["Up to date · 0.1.9999", "Experimental has 0.1.9999", "Couldn't check"]} title={`Look for a newer build on ${CHANNEL_LABEL[u.channel]} now${u.picked && u.follows ? ", and on the more stable channels" : ""}. MyOrbiter also looks when it starts and every 6 hours; nothing installs without your click.`} onclick={() => updates.checkNow()} />
      </div>
      <p class="hint" class:err={updates.outcome?.kind === "failed" && !updates.checking}>{updates.status(now)}</p>
      {#if offer && !updates.checking && updates.outcome?.kind !== "failed"}
        <div class="offer">
          {#if offer.older}
            <p>{CHANNEL_LABEL[offer.channel]}'s build is <b class="mono">{offer.version}</b>, older than this one. Switching installs it: a step back, so only when you click.</p>
          {:else}
            <p><b class="mono">{offer.version}</b> is out on {CHANNEL_LABEL[offer.channel]}.</p>
          {/if}
          {#if !offer.older && noteLines(offer.notes, 4).length}<ul class="notes">{#each noteLines(offer.notes, 4) as line, i (i)}<li>{line}</li>{/each}</ul>{/if}
          {#if installs}
            <ProgressButton job={updates.installJob} tone="gold" label={offer.older ? `Switch to ${CHANNEL_LABEL[offer.channel]}'s ${offer.version}` : "Update and restart"} sizer={["Downloading 100%", "Restarting", "Not installed"]} title={`Download ${offer.version}, check its signature, install it and restart MyOrbiter into it`} onclick={() => updates.install()} status />
          {/if}
        </div>
      {:else if sw && !updates.checking}
        <div class="offer">
          <p>{CHANNEL_LABEL[sw.from]} has no build yet. {CHANNEL_LABEL[sw.to]} has <b class="mono">{sw.version}</b>.</p>
          <button type="button" class="stamp gold" title={`Get updates from ${CHANNEL_LABEL[sw.to]} from now on${updates.follows ? `, still following the most stable build: back to ${CHANNEL_LABEL[sw.from]} by itself once it has this build or a newer one` : `; it stays until you choose again, or turn Follow on`}. Nothing installs without your click`} onclick={() => updates.switchTo(sw.to)}>Switch to {CHANNEL_LABEL[sw.to]}</button>
        </div>
      {/if}
    {/if}
    <div class="row foot"><button type="button" class="link" title="Settings, Updates: the same, the release notes and what MyOrbiter is" onclick={() => { close(false); onsettings(); }}>Settings, Updates</button></div>
  </div>
{/if}

<style>
  /* Over the page and a toast in the corner, as the sidebar's More menu. */
  .upanel {
    position: fixed; z-index: 61; display: grid; gap: .7rem; padding: .8rem .95rem .9rem;
    max-height: calc(100vh - 20px); overflow: auto;
    background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 14px 34px rgb(0 0 0 / 60%), 0 0 0 1px rgb(0 0 0 / 40%), inset 3px 0 0 var(--gold);
    outline: none; font-size: .85rem; color: var(--platinum-dim);
  }
  .head { display: flex; align-items: start; gap: .6rem; }
  .ver { flex: 1; margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .6rem; }
  .ver b { color: var(--platinum); font-weight: 600; }
  .ch { font-size: .78rem; color: var(--platinum-deep); }
  .hint { margin: 0; font-size: .78rem; line-height: 1.5; color: var(--platinum-deep); }
  .hint.err { color: var(--alert); }
  .row { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
  .foot { justify-content: flex-end; }
  .foot .link { font-size: 11px; }
  .offer { display: grid; gap: .5rem; padding: .6rem .7rem; border: 1px solid color-mix(in srgb, var(--gold) 45%, transparent); }
  .offer p { margin: 0; }
  .offer b { color: var(--platinum); }
  .notes { margin: 0; padding-left: 1.1rem; font-size: .78rem; color: var(--platinum-deep); }
</style>
