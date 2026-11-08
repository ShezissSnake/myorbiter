<script lang="ts">
  // A link couldn't open: a card in the bottom right corner (above an update's, when both are up),
  // there until you dismiss it or a link opens. The reason is in the logs (Settings, Logs), which
  // its Logs button opens.
  import { arrive, leave } from "./motion";
  import { links } from "./links.svelte";
  import Icon from "./ui/Icon.svelte";

  // onlogs: opens Settings at Logs.
  let { onlogs }: { onlogs: () => void } = $props();
</script>

{#if links.trouble}
  <div class="trouble" role="alert" in:arrive|global={{ always: true }} out:leave|global>
    <span class="ic" aria-hidden="true"><Icon name="external" size={14} /></span>
    <span class="txt" title={links.trouble}>Couldn't open your browser; see Logs</span>
    <button type="button" class="link" title="Settings, Logs: what MyOrbiter did, and why the link didn't open" onclick={() => { links.dismiss(); onlogs(); }}>Logs</button>
    <button class="x" aria-label="Dismiss" title="Dismiss" onclick={() => links.dismiss()}><Icon name="close" size={11} /></button>
  </div>
{/if}

<style>
  .trouble { display: grid; grid-template-columns: 1.4rem 1fr auto auto; gap: .6rem; align-items: center; padding: .65rem .6rem .65rem .9rem; border: 1px solid var(--rule-bright); background: var(--plate); box-shadow: 0 10px 30px rgb(0 0 0 / 55%), inset 3px 0 0 var(--oxblood); clip-path: var(--cut); font-size: .84rem; color: var(--platinum); }
  .ic { display: grid; place-items: center; color: var(--oxblood); }
  .txt { min-width: 0; }
  .x { padding: .3rem; line-height: 0; border-color: transparent; background: transparent; color: var(--platinum-deep); }
  .x:hover { color: var(--platinum); }
</style>
