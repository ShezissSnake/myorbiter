<script lang="ts">
  // A panel that slides over the right side of the window: Settings, TennoScope, an item's details.
  // Esc or a click outside closes it. While it's open, Tab stays inside it; closed, the keyboard
  // goes back to what opened it.
  import { tick, untrack, type Snippet } from "svelte";

  let { open = $bindable(), title, kicker, wide = false, children }: { open: boolean; title: string; kicker?: string; wide?: boolean; children: Snippet } = $props();

  let panel = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!open) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    // After this render, so the panel is there to take it.
    tick().then(() => untrack(() => panel)?.focus());
    // Closed (or gone, when what it showed went away): focus back where it was, unless something
    // else took it meanwhile.
    return () => {
      setTimeout(() => {
        const now = document.activeElement;
        if (opener?.isConnected && (!now || now === document.body)) opener.focus();
      });
    };
  });

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  function focusables(root: HTMLElement) {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      open = false;
      return;
    }
    if (e.key !== "Tab" || !panel) return;
    const target = e.target instanceof Node ? e.target : null;
    const inside = !!target && panel.contains(target);
    // Another dialog over this one (the listing form) has the keyboard.
    if (!inside && [...document.querySelectorAll('[aria-modal="true"]')].some((d) => d !== panel)) return;
    const els = focusables(panel);
    if (!els.length) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && (target === first || target === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && target === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => (open = false)}></div>
  <div class="sheet" class:wide role="dialog" aria-modal="true" aria-label={title} tabindex="-1" bind:this={panel}>
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
  .scrim { position: fixed; inset: 0; z-index: 40; background: rgb(6 7 9 / 55%); animation: fade .15s ease-out; }
  .sheet {
    position: fixed; z-index: 41; top: 0; right: 0; bottom: 0; width: min(36rem, 100vw);
    display: grid; grid-template-rows: auto 1fr; background: var(--plate);
    border-left: 1px solid var(--rule-bright); box-shadow: -1.5rem 0 4rem rgb(0 0 0 / 45%), inset 2px 0 0 var(--gold-dim);
    animation: slide .18s cubic-bezier(.16, 1, .3, 1); outline: none;
  }
  .sheet.wide { width: min(58rem, 100vw); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: 1.4rem 1.6rem 1.1rem; border-bottom: 1px solid var(--rule); }
  header .register { color: var(--gold); margin-bottom: .45rem; }
  h2 { font-size: 2.1rem; }
  .close { padding: .5rem; line-height: 0; }
  .body { overflow: auto; padding: 1.2rem 1.6rem 2rem; display: grid; gap: 1.6rem; align-content: start; }
  @keyframes slide { from { transform: translateX(2rem); opacity: 0; } }
  @keyframes fade { from { opacity: 0; } }
</style>
