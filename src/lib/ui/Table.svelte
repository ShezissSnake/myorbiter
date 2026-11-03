<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { sortRows, type Column } from "./table";
  import { nearEnd } from "./nearEnd";
  import NoMatch from "./NoMatch.svelte";
  import { inView, progressive } from "../progress.svelte";

  let {
    rows,
    columns,
    key,
    sort = $bindable(),
    detail,
    empty = "Nothing matches these filters.",
    limit = 50,
    tint,
    clear = null,
  }: {
    rows: T[];
    columns: Column<T>[];
    key: (r: T) => string;
    sort: { key: string; desc: boolean };
    detail?: Snippet<[T]>;
    empty?: string;
    limit?: number;
    /** A row's era colour (table.ts, eraTint): drawn as a faint wash (app.css, .era-wash). */
    tint?: (r: T) => string | null;
    /** Set while a search or filter is on: an empty table then says so, with a Clear, rather than `empty`. */
    clear?: (() => void) | null;
  } = $props();

  let open = $state<string | null>(null);
  // A first screenful of rows at once, then more as you scroll.
  let shown = $state(50);
  $effect(() => {
    rows;
    shown = limit;
  });

  const sorted = $derived(sortRows(rows, columns, sort));
  // The rows in sight drawn at once, the rest a slice a frame after (lib/progress.svelte.ts): a
  // re-sort or a filter waits only for the screenful you see.
  let body = $state<HTMLElement | null>(null);
  const view = inView(() => body);
  const drawn = $derived.by(progressive(() => sorted.slice(0, shown), (r) => key(r), { first: view.count, measure: view.measure, hidden: view.hidden, onShow: view.onShow }));

  function setSort(c: Column<T>) {
    if (c.sortable === false) return;
    if (sort.key === c.key) sort = { key: c.key, desc: !sort.desc };
    else sort = { key: c.key, desc: c.defaultDesc ?? true };
  }
</script>

<div class="wrap" use:view.watch>
  <table>
    <thead>
      <tr>
        {#each columns as c (c.key)}
          <th
            class:right={c.align === "right"}
            class:center={c.align === "center"}
            class:sortable={c.sortable !== false}
            class:minor={c.minor} class:spare={c.spare}
            style:width={c.width}
            title={c.title}
            aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
            tabindex={c.sortable !== false ? 0 : undefined}
            onclick={() => setSort(c)}
            onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSort(c))}
          >
            {c.label}{#if sort.key === c.key}<span class="arrow" class:up={!sort.desc} aria-hidden="true">▾</span>{/if}
          </th>
        {/each}
        {#if detail}<th class="chev" aria-label="Details"></th>{/if}
      </tr>
    </thead>
    <tbody bind:this={body}>
      {#each drawn as r (key(r))}
        {@const k = key(r)}
        {@const t = tint?.(r) ?? null}
        <tr
          class:era-wash={!!t}
          style:--tint={t}
          class:clickable={!!detail}
          class:open={open === k}
          tabindex={detail ? 0 : undefined}
          aria-expanded={detail ? open === k : undefined}
          onclick={() => detail && (open = open === k ? null : k)}
          onkeydown={(e) => detail && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), (open = open === k ? null : k))}
        >
          {#each columns as c (c.key)}
            <td class:right={c.align === "right"} class:center={c.align === "center"} class:muted={c.muted} class:minor={c.minor} class:spare={c.spare}>
              {#if c.cell}{@render c.cell(r)}{:else}{@const v = c.value(r)}{#if v == null}<span class="nil" aria-label="none">–</span>{:else}{v}{/if}{/if}
            </td>
          {/each}
          {#if detail}<td class="chev" aria-hidden="true"><span>›</span></td>{/if}
        </tr>
        {#if detail && open === k}
          <tr class="detail"><td colspan={columns.length + 1}>{@render detail(r)}</td></tr>
        {/if}
      {:else}
        <tr><td class="nothing" colspan={columns.length + (detail ? 1 : 0)}>{#if clear}<NoMatch {clear} />{:else}{empty}{/if}</td></tr>
      {/each}
    </tbody>
  </table>
  {#if sorted.length > shown}
    <div class="more dim small" use:nearEnd={() => (shown += 120)}>{sorted.length - shown} more below</div>
  {/if}
</div>

<style>
  /* Painted on its own: a fold opening above it, a row hovered or a figure rolling elsewhere on the
     page doesn't repaint the whole table, nor a row changing the rest of the page. */
  .wrap { border-top: 1px solid var(--rule); contain: paint; }
  /* A narrow page: a table wider than it scrolls sideways rather than running off the window. */
  :global(html[data-room~="lt1100"]) .wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th {
    position: sticky; top: 0; z-index: 1; background: var(--slab); text-align: left;
    font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .15em; text-transform: uppercase;
    color: var(--platinum-deep); padding: .7rem .75rem; border-bottom: 1px solid var(--rule); white-space: nowrap;
    user-select: none;
  }
  th.sortable { cursor: pointer; }
  th.sortable:focus-visible { outline: none; box-shadow: inset 0 -2px 0 var(--gold); color: var(--platinum); }
  th.sortable:hover { color: var(--platinum); }
  th[aria-sort] { color: var(--platinum); }
  /* The sort's arrow turns over when the order flips (QUICK); a header sinks as it's pressed (app.css). */
  .arrow { display: inline-block; margin-left: .3rem; color: var(--gold); transition: transform var(--quick) var(--out); }
  .arrow.up { transform: rotate(180deg); }
  td { padding: .5rem .75rem; border-bottom: 1px solid var(--rule); vertical-align: middle; font-size: .84rem; }
  td:first-child, th:first-child { padding-left: 0; }
  .right { text-align: right; }
  .center { text-align: center; }
  .muted { color: var(--platinum-dim); font-size: .8rem; }
  tr.clickable { cursor: pointer; }
  /* A row that opens shows a gold edge on hover; the open one and its detail keep it. */
  tr.clickable:hover td:first-child, tr.open td:first-child { box-shadow: inset 2px 0 0 var(--gold-dim); }
  tr.clickable td:first-child { padding-left: .6rem; }
  th:first-child { padding-left: .6rem; }
  tbody tr:hover td { background: rgb(230 233 238 / 2.5%); }
  tr.open td { background: var(--plate); border-bottom-color: transparent; }
  tr.detail td { background: var(--plate); padding: .4rem 1rem 1.2rem .6rem; cursor: default; border-bottom: 1px solid var(--rule-bright); box-shadow: inset 2px 0 0 var(--gold-dim); }
  tr.detail:hover td { background: var(--plate); }
  .more { margin: 1.2rem auto; display: block; text-align: center; min-height: 2rem; }
  /* Nothing here: quiet, but still readable (about 5:1). */
  .nil { color: var(--platinum-deep); }
  /* Page area under 1100 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt1100"]) .minor { display: none; }
  /* Details off (Settings, or the switch by the page title): the minor columns go at any width. */
  :global(html:not([data-details])) .minor { display: none; }
  :global(html[data-room~="lt760"]) .spare { display: none; }
  /* Little room (half a small screen): headings wrap onto two lines rather than widen their columns. */
  :global(html[data-room~="lt760"]) th { white-space: normal; line-height: 1.35; }
  .chev { width: 1.6rem; padding-right: 0; text-align: center; color: var(--platinum-deep); }
  .chev span { display: inline-block; font-size: 1.1rem; transition: transform var(--quick) var(--out); }
  tr.open .chev span { transform: rotate(90deg); color: var(--gold); }
  tr.clickable:hover .chev span { color: var(--platinum); }
  tr.clickable:focus-visible { outline: 1px solid var(--gold); outline-offset: -1px; }
</style>
