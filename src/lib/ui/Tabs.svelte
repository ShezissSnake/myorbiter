<script lang="ts" generics="V extends string">
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  // A row of categories with the game's icons, the chosen one lit gold beneath. The gold line
  // slides to the tab you pick (QUICK, transform only); it's placed without moving on first draw.
  let {
    value = $bindable(),
    options,
    label,
  }: { value: V; options: { v: V; label: string; icon?: GameIconName; count?: number; title?: string }[]; label?: string } = $props();

  let row = $state<HTMLElement | null>(null);
  let line = $state<HTMLElement | null>(null);
  // The line goes under the chosen tab (its left, foot and width), measured once it's drawn.
  function place(moving: boolean) {
    if (!line) return;
    const on = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!on || !on.offsetWidth) {
      line.style.opacity = "0";
      return;
    }
    line.classList.toggle("moving", moving);
    line.style.opacity = "1";
    line.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop + on.offsetHeight - 2}px) scaleX(${on.offsetWidth})`;
  }
  let placed = false;
  $effect(() => {
    void value;
    void options;
    // Measured just before the frame is drawn, once the page under the tabs has redrawn too, so
    // reading the layout doesn't make the browser lay it out twice.
    const moving = placed;
    placed = true;
    const f = requestAnimationFrame(() => place(moving));
    return () => cancelAnimationFrame(f);
  });
  // The row rewraps, a count changes width, or a hidden page is shown: follow, without sliding.
  $effect(() => {
    void options;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(row);
    for (const b of row.querySelectorAll("button")) ro.observe(b);
    return () => ro.disconnect();
  });
</script>

<div class="tabs" role="tablist" aria-label={label} bind:this={row}>
  {#each options as o (o.v)}
    <button role="tab" aria-selected={value === o.v} class:on={value === o.v} title={o.title ?? `${o.label}${o.count != null ? ` · ${o.count}` : ""}`} aria-label={o.count != null ? `${o.label}, ${o.count}` : o.label} onclick={() => (value = o.v)}>
      {#if o.icon}<GameIcon name={o.icon} size={18} />{/if}
      <span class:lbl={!!o.icon}>{o.label}</span>
      {#if o.count != null}<em>{o.count.toLocaleString("en")}</em>{/if}
    </button>
  {/each}
  <i class="line" bind:this={line} aria-hidden="true"></i>
</div>

<style>
  .tabs { position: relative; display: flex; flex-wrap: wrap; gap: .2rem; border-bottom: 1px solid var(--rule); }
  button {
    display: inline-flex; align-items: center; gap: .45rem; padding: .55rem .8rem .6rem; margin-bottom: -1px;
    border: 0; border-bottom: 2px solid transparent; background: none; color: var(--platinum-deep);
  }
  button :global(.gi) { opacity: .55; transition: opacity var(--quick); }
  button:hover:not(:disabled) { color: var(--platinum); border-bottom-color: var(--rule-control); }
  button.on:hover:not(:disabled) { border-bottom-color: transparent; }
  button:hover :global(.gi) { opacity: .9; }
  button.on { color: var(--platinum); }
  button.on :global(.gi) { opacity: 1; }
  /* The chosen tab's gold line: one bar 1 px wide, scaled to the tab and moved under it. */
  .line { position: absolute; left: 0; top: 0; width: 1px; height: 2px; background: var(--gold); transform-origin: 0 0; opacity: 0; pointer-events: none; }
  .line:global(.moving) { transition: transform var(--quick) var(--out); }
  em { font-style: normal; color: var(--platinum-deep); font-weight: 500; letter-spacing: .04em; }
  .on em { color: var(--gold); }
  /* Less room (half a wide screen, a Steam Deck): tighter, so a row of tabs stays one row. */
  :global(html[data-room~="lt1100"]) button { padding-left: .5rem; padding-right: .5rem; gap: .35rem; }
  /* Less still: the icons and counts stay (they're what you look for) and the words go, but for the
     chosen tab's; each tab's name stays in its tooltip. */
  :global(html[data-room~="lt950"]) button:not(.on) .lbl { display: none; }
</style>
