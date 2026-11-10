<script lang="ts">
  // More filters: the controls most visits don't need, folded behind one button so the page
  // starts with what matters. `active`: how many of them are set away from their defaults, shown
  // on the button so a folded filter never hides why the list looks short. `reset` puts them back.
  // `on`: a few words for what the folded filters keep to now, defaults included ("Tradable, sells daily").
  import type { Snippet } from "svelte";
  import { reveal } from "../motion";
  let { label = "More filters", active = 0, reset = null, title, on = "", children }: { label?: string; active?: number; reset?: (() => void) | null; title?: string; on?: string; children: Snippet } = $props();
  let open = $state(false);

  // The body is a line of its own in the bar, so the bar's row gap above it would stay while the
  // fold closes and then snap shut (a flex line never goes below 0). The body carries that gap
  // inside (under the controls, where it folds with them), and the bar gives it back with a
  // negative bottom margin while a body is there, so open and closed both look as before.
  const held = new WeakMap<HTMLElement, { n: number; was: string }>();
  function gap(node: HTMLElement) {
    const bar = node.parentElement;
    const g = bar ? getComputedStyle(bar).rowGap : "";
    if (!bar || !/^[\d.]+px$/.test(g) || parseFloat(g) === 0) return;
    node.style.setProperty("--gap", g);
    const h = held.get(bar) ?? { n: 0, was: bar.style.marginBottom };
    if (!h.n) h.was = bar.style.marginBottom;
    held.set(bar, h);
    const base = getComputedStyle(bar).marginBottom;
    const set = () => (bar.style.marginBottom = h.n ? `calc(${h.was || base} - ${h.n} * ${g})` : h.was);
    h.n++;
    set();
    return { destroy: () => { h.n--; set(); } };
  }
</script>

<span class="fold-wrap">
  <button type="button" class="fold" class:on={active > 0} aria-expanded={open} title={title ?? `${open ? "Hide" : "Show"} the rest of the filters${active ? ` (${active} set)` : ""}`} onclick={() => (open = !open)}>
    {label}{#if on}<span class="on-now">{on}</span>{/if}{#if active}<b class="n">{active}</b>{/if}<span class="chev" aria-hidden="true">▾</span>
  </button>
  {#if active && reset && !open}<button type="button" class="link quiet clear" title="Put the folded filters back to their defaults" onclick={reset}>Clear</button>{/if}
</span>
{#if open}<div class="reveal fold-body" use:gap transition:reveal><div><div class="folded">{@render children()}</div></div></div>{/if}

<style>
  .fold-wrap { display: inline-flex; align-items: center; gap: .4rem; }
  .fold { display: inline-flex; align-items: center; gap: .45rem; }
  .fold.on { border-color: var(--platinum-dim); color: var(--platinum); }
  /* A count: neutral, never gold. */
  .n { font-family: var(--face-mark); font-size: .8rem; color: var(--platinum-dim); }
  /* What the folded filters narrow to right now, so a short list never looks unexplained. */
  .on-now { font-family: var(--face-text); font-size: .74rem; letter-spacing: 0; text-transform: none; color: var(--platinum-deep); }
  .chev { font-size: .7rem; color: var(--platinum-deep); }
  .clear { font-size: 11px; }
  /* The folded controls take a row of their own under the bar, wrapping like it; they unfold on
     the grid row (motion.ts, reveal) as the chevron turns over (app.css). */
  .fold-body { flex-basis: 100%; }
  .folded { margin-bottom: var(--gap, 0px); display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .7rem; padding: .55rem .7rem; border: 1px dashed var(--rule); background: rgb(255 255 255 / 1.5%); }
</style>
