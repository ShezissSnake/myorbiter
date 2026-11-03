<script lang="ts">
  // A box that ticks something off: ticking it, the check draws itself in (a stroke, SNAP) and the
  // box pops; unticking clears it at once. Reduced motion: the check is simply there.
  // With `onclick` it's a toggle button (Home's weekly chores); without, a mark that only shows a
  // state (Start here's steps). `drawn`: draw the check as it first appears (a row that turns up
  // already done, as a sent change in Put my spares on sale); otherwise nothing moves on mount.
  //   <Tick on={done} label="Netracells done" title="…" onclick={toggle} />
  //   <Tick on={x.done} size={1.05} />
  import { pop } from "../motion";

  let { on, label, title, onclick, size = 1.3, drawn = false }: { on: boolean; label?: string; title?: string; onclick?: () => void; size?: number; drawn?: boolean } = $props();
</script>

{#snippet mark()}
  <svg viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d="M2.5 8.5 6.2 12.2 13.5 4" /></svg>
{/snippet}

{#if onclick}
  <button type="button" class="tick" class:on style:--tk="{size}rem" aria-pressed={on} aria-label={label} {title} {onclick} use:pop={on}>{@render mark()}</button>
{:else}
  <span class="tick" class:on class:drawn style:--tk="{size}rem" aria-hidden="true" {title}>{@render mark()}</span>
{/if}

<style>
  /* Not all: unset, which would also take away the pop (app.css, [data-pop]). */
  .tick {
    box-sizing: border-box; flex: none; display: inline-grid; place-items: center; margin: 0; padding: 0;
    width: var(--tk); height: var(--tk); border: 1px solid var(--rule-control); background: transparent; color: var(--verdigris);
    line-height: 0; transition: border-color var(--quick) var(--out), background-color var(--quick) var(--out);
  }
  button.tick { cursor: pointer; }
  button.tick:hover:not(:disabled) { border-color: var(--gold-dim); color: var(--verdigris); }
  button.tick:active:not(:disabled) { transform: scale(.92); background: transparent; }
  button.tick:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  .tick.on, button.tick.on:hover:not(:disabled), button.tick.on:active:not(:disabled) { border-color: var(--verdigris); background: color-mix(in srgb, var(--verdigris) 16%, transparent); }
  svg { width: 72%; height: 72%; overflow: visible; }
  /* The check: a stroke drawn from its short end. Off, it's wiped at once; on, it draws over SNAP. */
  path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: square; stroke-linejoin: miter; stroke-dasharray: 1; stroke-dashoffset: 1; }
  .on path { stroke-dashoffset: 0; transition: stroke-dashoffset var(--snap) var(--out); }
  .drawn.on path { animation: tick-draw var(--snap) var(--out) both; }
</style>
