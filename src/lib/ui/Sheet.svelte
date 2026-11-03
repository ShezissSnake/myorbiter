<script lang="ts">
  // A panel that slides over the right side of the window: Settings, TennoScope, an item's details.
  // Esc or a click outside closes it. While it's open, Tab stays inside it; closed, the keyboard
  // goes back to what opened it.
  import type { Snippet } from "svelte";
  import { fly } from "svelte/transition";
  import { trap } from "./trap";
  import { ms, out, SETTLE, shade } from "../motion";
  // Opening slides in over SETTLE; closing slides off in 100 ms, as a dialog closes (nobody waits
  // to watch it go). With reduced motion they just appear and go. |global: an item's details mount
  // the sheet inside their own {#if} (Browse, ItemDetails), and it slides there too.

  let { open = $bindable(), title, kicker, wide = false, children }: { open: boolean; title: string; kicker?: string; wide?: boolean; children: Snippet } = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => (open = false)} in:shade|global={{ duration: SETTLE }} out:shade|global></div>
  <div class="sheet" class:wide role="dialog" in:fly|global={{ x: 40, opacity: 0, duration: ms(SETTLE), easing: out }} out:fly|global={{ x: 32, opacity: 0, duration: ms(100), easing: out }} aria-modal="true" aria-label={title} tabindex="-1" use:trap={{ onescape: () => (open = false) }}>
    <header>
      <div>
        {#if kicker}<div class="register">{kicker}</div>{/if}
        <h2 class="mark">{title}</h2>
      </div>
      <button class="close" aria-label="Close" title="Close (Esc)" onclick={() => (open = false)}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
    </header>
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; background: rgb(6 7 9 / 55%); }
  .sheet {
    position: fixed; z-index: 41; top: 0; right: 0; bottom: 0; width: min(36rem, 100vw);
    display: grid; grid-template-rows: auto 1fr; background: var(--plate);
    border-left: 1px solid var(--rule-bright); box-shadow: -1.5rem 0 4rem rgb(0 0 0 / 45%), inset 2px 0 0 var(--gold-dim);
    outline: none;
  }
  .sheet.wide { width: min(58rem, 100vw); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: 1.4rem 1.6rem 1.1rem; border-bottom: 1px solid var(--rule); }
  header .register { color: var(--gold); margin-bottom: .45rem; }
  h2 { font-size: 2.1rem; }
  .close { padding: .5rem; line-height: 0; }
  .body { overflow: auto; padding: 1.2rem 1.6rem 2rem; display: grid; gap: 1.6rem; align-content: start; }
</style>
