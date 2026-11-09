<script lang="ts">
  // The tour's bar, along the bottom of the page while a tour is on (tour.svelte.ts): the change
  // shown now (its icon, title and line), how far along you are, Back, Next and End tour (on the
  // last change, Finish ends it and End tour goes). App opens
  // each change's page and lights its spot. Keys: → or Enter next, ← back, Esc ends it.
  import { tick } from "svelte";
  import { tour, tourStop, stepTour, endTour } from "../tour.svelte";
  import NewsIcon from "./NewsIcon.svelte";
  import Rich from "./Rich.svelte";
  import { leave } from "../motion";

  // go: a page named in the line (it opens; the tour stays on).
  let { go = null }: { go?: ((page: string) => void) | null } = $props();
  const stop = $derived(tourStop());
  const n = $derived(tour.stops.length);
  const last = $derived(tour.at === n - 1);
  let nextEl = $state<HTMLButtonElement | null>(null);
  let bar = $state<HTMLElement | null>(null);

  // Starting: the keyboard goes to Next, so Enter and the arrows work at once.
  let wasOn = false;
  $effect(() => {
    const on = !!stop;
    if (on && !wasOn) tick().then(() => nextEl?.focus({ preventScroll: true }));
    wasOn = on;
  });

  /** Keys the page itself uses: a field, a menu, tabs, a slider. */
  function pageOwns(el: EventTarget | null) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
    return !!el.closest('[role="tablist"], [role="radiogroup"], [role="toolbar"], [role="listbox"], [role="slider"], [role="menu"], [role="grid"]');
  }
  function onKey(e: KeyboardEvent) {
    if (!stop || e.ctrlKey || e.altKey || e.metaKey) return;
    // A dialog or panel over the page has the keyboard.
    if (document.querySelector('[aria-modal="true"]')) return;
    if (e.key === "Escape") {
      e.preventDefault();
      endTour();
      return;
    }
    if (pageOwns(e.target)) return;
    const loose = e.target === document.body || (e.target instanceof HTMLElement && e.target.id === "main");
    if (e.key === "ArrowRight" || (e.key === "Enter" && loose)) {
      e.preventDefault();
      stepTour(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepTour(-1);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if stop}
  <!-- Ended (End tour, Finish or Esc): the bar slides down off the page's edge as it fades. -->
  <div class="tour" role="region" aria-label="Tour of what's new" bind:this={bar} out:leave={{ y: 40 }}>
    <ol class="ticks" aria-hidden="true">{#each tour.stops as s, i (i)}<li class:on={i === tour.at} class:done={i < tour.at}></li>{/each}</ol>
    <span class="art" aria-hidden="true"><NewsIcon icon={stop.icon} size={26} /></span>
    <div class="words" aria-live="polite" aria-atomic="true">
      <span class="register count">{tour.at + 1} of {n}</span>
      <b class="t">{stop.title}</b>
      <span class="x"><Rich text={stop.text} {go} /></span>
    </div>
    <div class="ctl">
      <button type="button" class="back" disabled={tour.at === 0} title="The change before (←)" onclick={() => stepTour(-1)}>Back</button>
      <button type="button" class="stamp gold" bind:this={nextEl} title={last ? "The last change: end the tour (→ or Enter)" : "The next change, on its page (→ or Enter)"} onclick={() => stepTour(1)}>{last ? "Finish" : "Next"}</button>
      <!-- On the last change Finish ends it: End tour keeps its place, so Finish doesn't move. -->
      <button type="button" class="link quiet end" class:gone={last} aria-hidden={last ? "true" : undefined} title="End the tour here (Esc)" onclick={endTour}>End tour</button>
    </div>
  </div>
{/if}

<style>
  /* A slim bar on the page's bottom edge, over the page but not over the sidebar or Watching. */
  .tour {
    position: absolute; z-index: 30; left: 0; right: 0; bottom: 0;
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 1rem;
    padding: .6rem clamp(var(--step), 3vw, var(--field)) .65rem;
    background: rgb(11 13 16 / 96%); border-top: 1px solid var(--gold-dim);
    box-shadow: 0 -1rem 2rem rgb(0 0 0 / 45%);
  }
  /* How far along: one tick a change, the one shown lit. */
  .ticks { position: absolute; left: 0; right: 0; top: -1px; display: flex; gap: 2px; margin: 0; padding: 0; list-style: none; height: 2px; }
  .ticks li { flex: 1; background: var(--rule-bright); }
  .ticks li.done { background: var(--gold-dim); }
  .ticks li.on { background: var(--gold); }
  .art { width: 2.2rem; height: 2.2rem; display: grid; place-items: center; color: var(--platinum-dim); border: 1px solid var(--rule-bright); background: var(--plate); }
  .words { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: baseline; gap: .2rem .8rem; min-width: 0; }
  .count { color: var(--gold); white-space: nowrap; }
  .t { color: var(--platinum); font-size: .92rem; white-space: nowrap; }
  /* The line on one row, or up to three in a narrow window; the whole of it while you point at
     the bar or tab into its links (the bar grows upward). */
  .x { font-size: .82rem; color: var(--platinum-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .tour:hover .x, .x:focus-within { white-space: normal; display: block; -webkit-line-clamp: none; line-clamp: none; overflow: visible; }
  .ctl { display: flex; align-items: center; gap: .5rem; }
  .ctl .stamp { min-width: 5.5rem; }
  .ctl .end { white-space: nowrap; }
  .ctl .end.gone { visibility: hidden; }
  @media (max-width: 1400px) {
    .words { grid-template-columns: auto minmax(0, 1fr); }
    .x { grid-column: 1 / -1; white-space: normal; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; }
    .tour:hover .x, .x:focus-within { display: block; }
  }
</style>
