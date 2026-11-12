<script lang="ts">
  import { scrim } from "./scrim";
  // A panel that slides over the right side of the window: Settings, TennoScope, an item's details.
  // Esc or a click outside closes it. While it's open, Tab stays inside it; closed, the keyboard
  // goes back to what opened it.
  import type { Snippet } from "svelte";
  import { fly } from "svelte/transition";
  import { trap } from "./trap";
  import { sheetBuilt } from "../timing";
  import { moving, ms, out, SETTLE, shade } from "../motion";
  import Kind from "./Kind.svelte";
  // Opening slides in over SETTLE; closing slides off in 100 ms, as a dialog closes (nobody waits
  // to watch it go). With reduced motion they just appear and go. |global: an item's details mount
  // the sheet inside their own {#if} (Browse, ItemDetails), and it slides there too.
  //
  // `keep`: a panel that's costly to build (Settings) is built on its first open and then stays in
  // the DOM, hidden and inert, so the next open is a class change: it slides on a CSS transform
  // transition, not a Svelte transition, and its blurred shadow comes only once it has settled
  // (a blur repainted every frame of the slide made the window redraw): a transition of no length
  // that waits out the slide, so no timer and no class change lands on the page a frame later.

  import HelpMark from "./HelpMark.svelte";
  // `help`: the panel's part id, for its "?" beside Close.
  let { open = $bindable(), title, kicker, kind, wide = false, keep = false, help, children }: { open: boolean; title: string; kicker?: string; /** The kicker names this kind: its slot's icon leads it. */ kind?: string; wide?: boolean; keep?: boolean; help?: string; children: Snippet } = $props();

  let seen = $state(false);
  $effect.pre(() => {
    if (open) seen = true;
  });
  let body = $state<HTMLElement>();
  $effect(() => {
    if (!keep || !open) return;
    // Opens at the top, as a freshly built one did.
    if (body) body.scrollTop = 0;
    moving(ms(SETTLE));
  });
</script>

{#snippet panel()}
  <header>
    <div>
      {#if kicker}<div class="register">{#if kind}<Kind {kind} label={kicker} size={12} />{:else}{kicker}{/if}</div>{/if}
      <h2 class="mark">{title}</h2>
    </div>
    {#if help}<HelpMark part={help} />{/if}
    <button class="close" aria-label="Close" title="Close (Esc)" onclick={() => (open = false)}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="1.5" /></svg>
    </button>
  </header>
  <div class="body" bind:this={body}>{@render children()}</div>
{/snippet}

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" use:scrim onclick={() => (open = false)} in:shade|global={{ duration: SETTLE }} out:shade|global></div>
{/if}
{#if !keep}
  {#if open}
    <div class="sheet" class:wide role="dialog" in:fly|global={{ x: 40, opacity: 0, duration: ms(SETTLE), easing: out }} out:fly|global={{ x: 32, opacity: 0, duration: ms(100), easing: out }} aria-modal="true" aria-label={title} tabindex="-1" use:sheetBuilt use:trap={{ onescape: () => (open = false) }}>
      {@render panel()}
    </div>
  {/if}
{:else if seen}
  <div class="sheet keep" class:wide class:on={open} role="dialog" inert={!open} aria-modal={open ? "true" : undefined} aria-label={title} tabindex="-1" use:sheetBuilt use:trap={{ onescape: () => (open = false), active: open }}>
    {@render panel()}
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 40; background: rgb(6 7 9 / 55%); }
  .sheet {
    position: fixed; z-index: 41; top: 0; right: 0; bottom: 0; width: min(36rem, 100vw);
    display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr); background: var(--plate);
    border-left: 1px solid var(--rule-bright); box-shadow: -1.5rem 0 4rem rgb(0 0 0 / 45%), inset 2px 0 0 var(--rule-control);
    outline: none;
  }
  .sheet.wide { width: min(58rem, 100vw); }
  /* Kept: shut, it's invisible and takes no clicks (visibility turns off once the slide-out ends). */
  .sheet.keep { transform: translateX(40px); opacity: 0; visibility: hidden; box-shadow: inset 2px 0 0 var(--rule-control); transition: transform 100ms var(--out), opacity 100ms var(--out), visibility 0s linear 100ms; }
  .sheet.keep.on { transform: none; opacity: 1; visibility: visible; box-shadow: -1.5rem 0 4rem rgb(0 0 0 / 45%), inset 2px 0 0 var(--rule-control); transition: transform var(--settle) var(--out), opacity var(--settle) var(--out), visibility 0s, box-shadow 0s linear var(--settle); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; padding: 1.4rem 1.6rem 1.1rem; border-bottom: 1px solid var(--rule); }
  header .register { color: var(--platinum-dim); margin-bottom: .45rem; }
  /* The title takes the room, so the "?" sits beside Close at the right end. */
  header > div:first-child { flex: 1; min-width: 0; }
  header > :global(.helpmark) { align-self: center; }
  h2 { font-size: 2.1rem; }
  .close { padding: .5rem; line-height: 0; }
  /* One column no wider than the sheet: a long unbreakable line (a path) can't widen every section
     past the sheet's edge; it wraps, ellipsises or scrolls inside its own box instead. */
  .body { overflow: auto; padding: 1.2rem 1.6rem 2rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.6rem; align-content: start; }
</style>
