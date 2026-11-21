<script lang="ts" generics="T">
  // A page's list, as cards (the default) or as a table, with the same sort either way. The choice
  // is remembered per page on this computer. A click on a card or a row does whatever `onopen` does
  // (the item details sheet, for gear); where it declines (returns null or false), or there's no
  // `onopen`, the row's own details open instead: in a panel for a card, in place for a row.
  import { getContext, untrack, type Snippet } from "svelte";
  import { sortRows, type Column } from "./table";
  import Table from "./Table.svelte";
  import CardGrid from "./CardGrid.svelte";
  import Seg from "./Seg.svelte";
  import IconButton from "./IconButton.svelte";
  import Sheet from "./Sheet.svelte";
  import NoMatch from "./NoMatch.svelte";
  import { nearEnd } from "./nearEnd";
  import Count from "./Count.svelte";
  import { keepWhile, shownPage, whenIdle } from "../pane.svelte";
  import { PANE } from "../statusStrip.svelte";
  import { cardsAhead, cardsToKeep, foldStep } from "../core/cards";
  import { rowsFor } from "../core/progress";
  import { arrive, fresh } from "../motion";
  import HelpMark from "./HelpMark.svelte";
  import { inView, progressive } from "../progress.svelte";

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
    filters,
    fixed = false,
    count,
    opened = $bindable(null),
    help,
    heading = "The list",
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
    /** The page's filter controls: drawn at the left of the same row as the sort, count and layout switch, which wrap onto a second row only when the width runs out. */
    filters?: Snippet;
    /** The table's columns keep their widths for any rows (Table.svelte, `fixed`). */
    fixed?: boolean;
    /** The count's words, when "N items" would mislead (Sets: copies against kinds of set). */
    count?: (n: number) => string;
    /** The row whose details panel is open: the page can open one itself (the showcase above it). */
    opened?: T | null;
    /** The parts' ids for the "?": the list (its sort row) and a row's details panel; `<id>.list` and `<id>.sheet` unless given. */
    help?: { list?: string; sheet?: string };
    /** The list's heading, for a screen reader only: the cards' names are h3s, under the page's h1. */
    heading?: string;
  } = $props();
  const helpList = $derived(help?.list ?? `${id}.list`);
  const helpSheet = $derived(help?.sheet ?? `${id}.sheet`);

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
  // On the count, not the list: a sync brings a new list of the same rows, and reading `view` made
  // every sync fold a long list back to its first cards, to be drawn again on the next scroll.
  const rowCount = $derived(view.length);
  $effect(() => {
    rowCount;
    sort.key;
    sort.desc;
    shown = cardLimit;
  });

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

  // Cards and table: once you've seen both, both stay drawn and the one not chosen is hidden, as it
  // was, so switching back only shows it. While hidden it keeps its rows and sort; it catches up
  // with filters and sorting done meanwhile when it's shown again.
  let drawnList = $state(untrack(() => layout === "list"));
  let drawnCards = $state(untrack(() => layout === "cards"));
  $effect.pre(() => {
    if (layout === "list") drawnList = true;
    else drawnCards = true;
  });
  const listRows = $derived.by(keepWhile(() => layout === "list", () => view));
  const listSort = $derived.by(keepWhile(() => layout === "list", () => sort));
  const cardRows = $derived.by(keepWhile(() => layout === "cards", () => sorted));
  // The cards in sight drawn at once, the rest a few a frame after (lib/progress.svelte.ts).
  let grid = $state<HTMLElement | null>(null);
  /** The page the list is on (PaneId), if it's on one. */
  const pane = getContext<string | undefined>(PANE);
  const pageShown = () => pane == null || shownPage(pane);
  const cardView = inView(() => grid?.firstElementChild as HTMLElement | null, { min: 6, guess: 180, exact: true, measured: () => ahead() });
  /**
   * While the cards are in sight, each time the page scrolls: the cards down to the screen's
   * bottom and a screen and a half more (core/cards.ts, `cardsAhead`), so a scroll finds them
   * there. The ones on the screen are drawn at once, those below it a few at a time in idle
   * moments (progressive). `more`: the marker under the cards came near (a grid not measured yet).
   * Out of sight (a page or the table shown instead), nothing.
   */
  function ahead(more = false) {
    if (!pageShown() || layout !== "cards" || cardView.hidden()) return;
    const n = cardsAhead({ total: cardRows.length, shown, reach: cardView.count(), perRow: cardView.perRow(), screenful: cardView.screenful() }, { more });
    if (n !== shown) shown = n;
  }
  // Shown again (its page, or the cards after the table): measured, and drawn ahead from there.
  $effect(() => cardView.onShow(() => requestAnimationFrame(() => cardView.measure(true))));

  /** The card with the focus, or Tab's place in the grid (roving.ts): its index, -1 for none. */
  function focusAt(): number {
    const g = grid?.firstElementChild;
    if (!g) return -1;
    const kids = [...g.children];
    const a = document.activeElement;
    const has = a && g.contains(a) ? kids.findIndex((k) => k.contains(a)) : -1;
    const tab = g.querySelector(":scope > [tabindex='0']");
    return Math.max(has, tab ? kids.indexOf(tab) : -1);
  }
  /** How long a slice of a fold may take (ms), as for a list drawn out of sight (progress.svelte.ts). */
  const FOLD_BUDGET_MS = 12;
  /** The most cards a slice of a fold takes off. */
  const FOLD_MOST = 480;
  // Its page left: the cards below where the player was fold back (core/cards.ts, `cardsToKeep`), so
  // a page left with hundreds drawn below the screen doesn't carry them through every switch. A
  // slice at a time in idle moments (pane.svelte.ts, whenIdle), each sized by how long the last took.
  // Coming back shows the same cards in the same place: all of those above and on the screen stay,
  // and the card with the focus; the rest are drawn ahead again from there. Shown again mid-fold,
  // the fold stops.
  $effect(() => {
    if (pageShown()) return;
    let cancel = () => {};
    let gone = false;
    untrack(() => {
      if (layout !== "cards") return;
      const keep = cardsToKeep({ shown, reach: cardView.count(), perRow: cardView.perRow() }, focusAt(), cardLimit);
      let slice = Math.max(cardView.screenful(), 48);
      const next = () => {
        cancel = whenIdle(() => {
          const from = shown;
          if (gone || from <= keep) return;
          const t0 = performance.now();
          shown = foldStep(from, keep, slice);
          // The cards go in this task's microtasks (Svelte's flush), queued before these.
          queueMicrotask(() =>
            queueMicrotask(() => {
              if (gone) return;
              slice = rowsFor(performance.now() - t0, from - shown, FOLD_BUDGET_MS, FOLD_MOST, slice);
              if (shown > keep) next();
            }),
          );
        });
      };
      next();
    });
    return () => {
      gone = true;
      cancel();
    };
  });
  const cardsDrawn = $derived.by(progressive(() => cardRows.slice(0, shown), (r) => key(r), { first: cardView.count, step: 6, measure: cardView.measure, hidden: cardView.hidden, onShow: cardView.onShow }));
</script>

<!-- An h2 between the page's h1 and the cards' h3, so headings don't jump a level (a screen reader's
     list of them), and a section after the list doesn't read as part of its last card. -->
<h2 class="sr">{heading}</h2>
<div class="tools" class:bar={!!filters}>
  {#if filters}{@render filters()}{/if}
  {#if layout === "cards" && sortable.length}
    <label class="sort">
      <span class="register">Sort</span>
      <select value={sort.key} onchange={(e) => { const c = columns.find((x) => x.key === e.currentTarget.value); if (c) sort = { key: c.key, desc: c.defaultDesc ?? true }; }} aria-label="Sort by" title="What to put the cards in order by (the table sorts by any column)">
        {#each sortable as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
      </select>
      <IconButton icon="sort-desc" class={sort.desc ? "sortdir" : "sortdir asc"} label={sort.desc ? "Highest first" : "Lowest first"} title={`${sort.desc ? "Highest first" : "Lowest first"}: click to reverse`} onclick={() => (sort = { ...sort, desc: !sort.desc })} />
    </label>
  {/if}
  <!-- The count and the switch stay together: they go to the next row as a pair, or not at all. -->
  <div class="end">
    <span class="dim small nowrap"><Count value={view.length} format={(n) => (count ? count(Math.round(n)) : `${Math.round(n).toLocaleString("en")} ${Math.round(n) === 1 ? "item" : "items"}`)} /></span>
    <Seg bind:value={layout} onchange={remember} options={[{ v: "cards", label: "Cards", icon: "cards", title: "Show them as cards" }, { v: "list", label: "Table", icon: "rows", title: "Show them as a table you can sort by any column" }]} />
    {#if tools}{@render tools()}{/if}
  </div>
  <!-- One "?" for the row: with the page's filters in it, theirs (at the end, after the count and the switch) opens the walk-through that covers the list too. -->
  {#if !filters}<HelpMark part={helpList} />{/if}
</div>

{#snippet firstCell(r: T)}
  {@const c = columns[0]}
  <span class="rowkey" data-row-key={key(r)} hidden></span>{#if c.cell}{@render c.cell(r)}{:else}{@const v = c.value(r)}{#if v == null}<span class="nil" aria-label="none">–</span>{:else}{v}{/if}{/if}
{/snippet}

{#if drawnList}
  <div class="list swap" class:off={layout !== "list"} use:rowOpener use:fresh={layout === "list"} in:arrive={{ y: 0 }}><Table rows={listRows} columns={listColumns} {key} bind:sort={() => listSort, (v) => (sort = v)} {detail} {empty} {clear} {limit} {tint} {fixed} /></div>
{/if}
{#if drawnCards}
  <div class="cards swap" class:off={layout !== "cards"} bind:this={grid} use:cardView.watch use:fresh={layout === "cards"} in:arrive={{ y: 0 }}>
    {#if cardRows.length}
      <CardGrid {min}>
        {#each cardsDrawn as r (key(r))}{@render card(r, () => open(r))}{/each}
      </CardGrid>
      {#if cardRows.length > shown}<div class="more dim small" use:nearEnd={() => ahead(true)}>{cardRows.length - shown} more below</div>{/if}
    {:else}
      <p class="nothing">{#if clear}<NoMatch {clear} />{:else}{empty}{/if}</p>
    {/if}
  </div>
{/if}

{#if detail && opened != null}
  <Sheet bind:open={sheet.v} title={title ? title(opened) : ""} kicker={kicker?.(opened)} wide help={helpSheet}>
    {@render detail(opened)}
  </Sheet>
{/if}

<style>
  /* The layout not chosen: kept laid out but not drawn, so switching back is quick (where
     content-visibility isn't known, simply not there). */
  .off { display: none; }
  @supports (content-visibility: hidden) {
    .off { display: block; content-visibility: hidden; }
  }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; margin: 0; }
  /* The sort row: a plate, as the filter row above it is. */
  .tools.bar { margin-top: var(--step); }
  /* The "?" follows what's before it (the page's own beside its filters); the count and the switch are what go to the right. */
  .tools > :global(.helpmark) { margin-left: 0; }
  .tools.bar > :global(.helpmark) { order: 10; }
  .tools.bar > .end { order: 5; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem .8rem; margin: 0 0 .8rem; padding: .6rem; background: var(--plate); border: 1px solid var(--rule); }
  .end { display: flex; align-items: center; gap: .6rem .8rem; margin-left: auto; }
  .sort { display: inline-flex; align-items: center; gap: .5rem; }
  /* Highest or lowest first: one icon that turns over (QUICK) rather than swapping for another. */
  .sort :global(.sortdir svg) { transition: transform var(--quick) var(--out); }
  .sort :global(.sortdir.asc svg) { transform: rotateX(180deg); }
  .more { display: flex; justify-content: center; padding: 1.2rem 0; min-height: 3rem; }
  /* Nothing here: quiet, but still readable (about 5:1). */
  .nil { color: var(--platinum-deep); }
</style>
