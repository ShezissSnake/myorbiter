<script lang="ts" generics="T">
  // A page's list, as cards (the default) or as a table, with the same sort either way. The choice
  // is remembered per page on this computer. A click on a card or a row does whatever `onopen` does
  // (the item details sheet, for gear); where it declines (returns null or false), or there's no
  // `onopen`, the row's own details open instead: in a panel for a card, in place for a row.
  import { untrack, type Snippet } from "svelte";
  import { sortRows, type Column } from "./table";
  import Table from "./Table.svelte";
  import CardGrid from "./CardGrid.svelte";
  import Seg from "./Seg.svelte";
  import IconButton from "./IconButton.svelte";
  import Sheet from "./Sheet.svelte";
  import NoMatch from "./NoMatch.svelte";
  import { nearEnd } from "./nearEnd";

  let {
    id,
    rows,
    columns,
    key,
    sort = $bindable(),
    detail,
    card,
    title,
    kicker,
    onopen,
    min = "19rem",
    empty = "Nothing matches these filters.",
    limit = 50,
    cardLimit = 24,
    tint,
    clear = null,
    tools,
    count,
  }: {
    /** Remembers the layout under this name. */
    id: string;
    rows: T[];
    columns: Column<T>[];
    key: (r: T) => string;
    sort: { key: string; desc: boolean };
    detail?: Snippet<[T]>;
    /** One row as a card. It's given an `open` callback to wire to the card's click. */
    card: Snippet<[T, () => void]>;
    /** The details panel's heading. */
    title?: (r: T) => string;
    /** The line over that heading (its kind), as the item details sheet has. */
    kicker?: (r: T) => string;
    /** A row's era colour in the table (see Table.svelte); cards take theirs from the page. */
    tint?: (r: T) => string | null;
    /** Opens a row its own way; null or false declines, and the row's `detail` opens instead. */
    onopen?: (r: T) => unknown;
    min?: string;
    empty?: string;
    limit?: number;
    cardLimit?: number;
    /** Set while a search or filter is on: an empty list then says so, with a Clear that calls this, rather than `empty`. */
    clear?: (() => void) | null;
    /** The page's own buttons, at the right end of the sort row (Rivens' Check prices). */
    tools?: Snippet;
    /** The count's words, when "N items" would mislead (Sets: copies against kinds of set). */
    count?: (n: number) => string;
  } = $props();

  const key_ = () => `orbiter-layout-${id}`;
  let layout = $state<"cards" | "list">(read());
  function read(): "cards" | "list" {
    try {
      return localStorage.getItem(key_()) === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  }
  function remember(v: "cards" | "list") {
    try {
      localStorage.setItem(key_(), v);
    } catch {
      // Not kept; the page still works.
    }
  }

  const sortable = $derived(columns.filter((c) => c.sortable !== false));
  // While you type in a filter the rows change on every key: redraw the cards for the first key at
  // once, then once the typing pauses, rather than for every letter.
  let view = $state.raw(untrack(() => rows));
  let lastSync = 0;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const next = rows;
    clearTimeout(syncTimer);
    const now = performance.now();
    if (now - lastSync > 250) {
      view = next;
      lastSync = now;
    } else {
      syncTimer = setTimeout(() => {
        view = next;
        lastSync = performance.now();
      }, 110);
    }
    return () => clearTimeout(syncTimer);
  });
  const sorted = $derived(sortRows(view, columns, sort));
  // A first screenful at once, then more as you scroll.
  let shown = $state(24);
  // Back to the first page when the sort or the filters change (not when the same rows refresh).
  $effect(() => {
    view.length;
    sort.key;
    sort.desc;
    shown = cardLimit;
  });

  let opened = $state<T | null>(null);
  /** Whether `onopen` took the row. */
  function took(r: T) {
    if (!onopen) return false;
    const v = onopen(r);
    return v !== null && v !== false;
  }
  function open(r: T) {
    if (!took(r) && detail) opened = r;
  }

  // In the list, a row `onopen` takes opens that way (the item sheet) rather than in place. Each row
  // carries its key in its first cell, so a click finds its row whatever the table's order.
  const listColumns = $derived(columns.map((c, i) => (i === 0 ? { ...c, cell: firstCell } : c)));
  function rowOpener(node: HTMLElement) {
    const handle = (e: Event) => {
      if (!onopen) return;
      const t = e.target as HTMLElement | null;
      const tr = t?.closest("tr");
      const k = tr?.querySelector<HTMLElement>(":scope > td [data-row-key]")?.dataset.rowKey;
      if (!tr || k == null) return;
      if (e instanceof KeyboardEvent && ((e.key !== "Enter" && e.key !== " ") || e.target !== tr)) return;
      // Buttons and links in the row do their own thing.
      const hit = t?.closest("button, a, input, select, label");
      if (hit && tr.contains(hit)) return;
      const r = view.find((x) => key(x) === k);
      if (r === undefined || !took(r)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    node.addEventListener("click", handle, true);
    node.addEventListener("keydown", handle, true);
    return {
      destroy() {
        node.removeEventListener("click", handle, true);
        node.removeEventListener("keydown", handle, true);
      },
    };
  }
  const sheet = { get v() { return opened != null; }, set v(x: boolean) { if (!x) opened = null; } };
</script>

<div class="tools">
  {#if layout === "cards" && sortable.length}
    <label class="sort">
      <span class="register">Sort</span>
      <select value={sort.key} onchange={(e) => { const c = columns.find((x) => x.key === e.currentTarget.value); if (c) sort = { key: c.key, desc: c.defaultDesc ?? true }; }} aria-label="Sort by">
        {#each sortable as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
      </select>
      <IconButton icon={sort.desc ? "sort-desc" : "sort-asc"} label={sort.desc ? "Highest first" : "Lowest first"} title={`${sort.desc ? "Highest first" : "Lowest first"}: click to reverse`} onclick={() => (sort = { ...sort, desc: !sort.desc })} />
    </label>
  {/if}
  <span class="grow"></span>
  <span class="dim small nowrap">{count ? count(view.length) : `${view.length.toLocaleString("en")} ${view.length === 1 ? "item" : "items"}`}</span>
  <Seg bind:value={layout} onchange={remember} options={[{ v: "cards", label: "Cards", icon: "cards", title: "Show them as cards" }, { v: "list", label: "Table", icon: "rows", title: "Show them as a table you can sort by any column" }]} />
  {#if tools}{@render tools()}{/if}
</div>

{#snippet firstCell(r: T)}
  {@const c = columns[0]}
  <span class="rowkey" data-row-key={key(r)} hidden></span>{#if c.cell}{@render c.cell(r)}{:else}{@const v = c.value(r)}{#if v == null}<span class="nil" aria-label="none">–</span>{:else}{v}{/if}{/if}
{/snippet}

{#if layout === "list"}
  <div class="list" use:rowOpener><Table rows={view} columns={listColumns} {key} bind:sort {detail} {empty} {clear} {limit} {tint} /></div>
{:else if sorted.length}
  <CardGrid {min}>
    {#each sorted.slice(0, shown) as r (key(r))}{@render card(r, () => open(r))}{/each}
  </CardGrid>
  {#if sorted.length > shown}<div class="more dim small" use:nearEnd={() => (shown += 48)}>{sorted.length - shown} more below</div>{/if}
{:else}
  <p class="nothing">{#if clear}<NoMatch {clear} />{:else}{empty}{/if}</p>
{/if}

{#if detail && opened != null}
  <Sheet bind:open={sheet.v} title={title ? title(opened) : ""} kicker={kicker?.(opened)} wide>
    {@render detail(opened)}
  </Sheet>
{/if}

<style>
  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem .8rem; margin: 0 0 .8rem; }
  .sort { display: inline-flex; align-items: center; gap: .5rem; }
  .more { display: flex; justify-content: center; padding: 1.2rem 0; min-height: 3rem; }
  /* Nothing here: quiet, but still readable (about 5:1). */
  .nil { color: var(--platinum-deep); }
</style>
