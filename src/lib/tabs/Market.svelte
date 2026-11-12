<script lang="ts">
  import { links, openUrl } from "../links.svelte";
  import Opening from "../ui/Opening.svelte";
  import Fold from "../ui/Fold.svelte";
  // Everything warframe.market trades, owned or not: browse by category, price and how often it
  // sells (the dearest Captura scenes, mods over 50p that sell daily…). Prices are what things sold
  // for lately; the buy order form shows the live order book.
  import type { Model } from "../core/model";
  import { CATEGORIES, categoryCounts, filterRows, marketRows, topPrice, type MarketCategory, type MarketRow } from "../core/browse";
  import { mkt } from "../marketStore.svelte";
  import { wikiUrl } from "../backend";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import HelpMark from "../ui/HelpMark.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Ticker, { type Tick } from "../ui/Ticker.svelte";
  import Named from "../ui/Named.svelte";
  import P from "../ui/P.svelte";
  import Chip from "../ui/Chip.svelte";
  import GameIcon, { kindIcon } from "../ui/GameIcon.svelte";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import { matches, type Column } from "../ui/table";
  import { takeIntent } from "../intent.svelte";
  import { whileShown } from "../pane.svelte";
  import { typed } from "../typed.svelte";
  import Kind from "../ui/Kind.svelte";

  let { model }: { model: Model } = $props();

  let category = $state<MarketCategory | "all">("all");
  let min = $state<number | null>(null);
  let max = $state<number | null>(null);
  let minTrades = $state<number | null>(null);
  let owned = $state(false);
  // On by default: the dearest things that "sold" once or twice lead with joke prices otherwise.
  let weekly = $state(true);
  let query = $state("");
  /** What the list is filtered on: the box, a moment later while you type (typed.svelte.ts). */
  const q = $derived.by(typed(() => query));
  let sort = $state({ key: "price", desc: true });
  // Ctrl+K asked for one item: every category, slow sellers too, searched for its name.
  $effect(() => {
    const want = takeIntent("browse");
    if (!want?.q) return;
    clear();
    weekly = false;
    query = want.q;
  });

  // warframe.market's item list: loaded once, shared with Orders and the buy order form.
  let loadError = $state<string | null>(null);
  // An empty answer is a failure too: without it the page would say "Loading…" for ever.
  const load = () =>
    mkt.ensureItems().then(
      () => (loadError = mkt.items.length ? null : "warframe.market sent an empty list"),
      (e) => (loadError = String(e).replace(/^Error: /, "")),
    );
  $effect(() => {
    if (!mkt.items.length) void load();
  });

  const all = $derived.by(whileShown("browse", () => marketRows(model, mkt.items)));
  /** The category the list is filtered on: the select shows a pick at once, the list a frame later (typed.svelte.ts). */
  const categoryNow = $derived.by(typed(() => category));
  const rows = $derived(filterRows(all, { category: categoryNow, min, max, minTrades, owned, weekly }).filter((r) => matches(q, r.name)));
  /** What "Sold weekly" is hiding from the rest of the filters. */
  const slowHidden = $derived(weekly ? filterRows(all, { category: categoryNow, min, max, minTrades, owned, weekly: false }).filter((r) => matches(q, r.name)).length - rows.length : 0);
  /** Beside each category in the menu: what picking it would show, under the other filters and the search. */
  const counts = $derived(categoryCounts(all.filter((r) => matches(q, r.name)), { category: "all", min, max, minTrades, owned, weekly }));
  const count = (c: MarketCategory | "all") => counts.get(c) ?? 0;
  const label = (c: MarketCategory) => CATEGORIES.find((x) => x.v === c)?.label ?? "";
  const daily = (t: number | null) => (t == null ? null : Math.round(t * 10) / 10);
  /** How often it sells, for the cards and the tooltips: sold/day as everywhere, by the week when it's under one a day. */
  const pace = (t: number | null) => (t == null ? "No recent sales" : t >= 1 ? `${daily(t)} sold/day` : t >= 1 / 7 ? `~${Math.round(t * 7)} sold/week` : "Sold rarely");
  const sellsDaily = $derived(rows.filter((r) => (r.tradesPerDay ?? 0) >= 1).length);
  const filtered = $derived(category !== "all" || min != null || max != null || minTrades != null || owned || !weekly || !!q.trim());
  // The ticker tape under the title: what's listed, what sells daily and what you hold of it, for
  // the items the filters show (it replaces the band's one figure).
  const heldCount = $derived(rows.filter((r) => (r.have ?? 0) > 0).length);
  const tape = $derived<Tick[]>(
    mkt.items.length
      ? [
          // What the filters show, of all warframe.market trades (Sold weekly, on to start, hides some).
          { key: "items", label: "Shown", value: rows.length, of: rows.length < all.length ? `/${all.length.toLocaleString("en")}` : undefined, title: `Shown: ${rows.length.toLocaleString("en")} of the ${all.length.toLocaleString("en")} items warframe.market trades${rows.length < all.length ? `, as the filters leave them${weekly ? ` (Sold weekly hides ${slowHidden.toLocaleString("en")} that sell less than once a week)` : ""}` : ""}` },
          // Said as the cards say how often a thing sells ("2.3 sold/day").
          { key: "daily", label: "1+ sold/day", value: sellsDaily, title: `1+ sold/day: of the ${rows.length.toLocaleString("en")} shown, the ones that sell at least once a day` },
          { key: "held", label: "You hold", value: heldCount, title: `You hold: of the ${rows.length.toLocaleString("en")} shown, the ones you have at least one of (You have shows only those)` },
        ]
      : [{ key: "items", label: "Items", value: null, text: loadError ? "couldn't load" : "loading…", tone: "dim", title: loadError ? `warframe.market's item list didn't load: ${loadError}` : "Loading warframe.market's item list" }],
  );
  function clear() {
    category = "all";
    min = max = minTrades = null;
    owned = false;
    weekly = true;
    query = "";
  }
  /** MyOrbiter's own art where it has some, else warframe.market's thumbnail. */
  // Relics: MyOrbiter files their art under the relic ("Axi S17"); the market has none.
  const art = (r: MarketRow) => model.imageOf(r.name) ?? (r.category === "relic" ? model.imageOf(r.name.replace(/ Relic$/, "")) : null) ?? r.thumb;
  const buy = (r: MarketRow) => mkt.startBuy(r.name, { unique: r.gameRef, known: r.price });

  const columns: Column<MarketRow>[] = [
    { key: "name", label: "Item", value: (r) => r.name, cell: nameCell, defaultDesc: false, width: "24rem" },
    { key: "kind", label: "Category", value: (r) => label(r.category), muted: true, defaultDesc: false, minor: true, cell: kindCell },
    { key: "price", label: "Price", value: (r) => r.price, sortValue: (r) => topPrice(r), align: "right", cell: priceCell, title: "What it sold for lately on warframe.market (the daily median). Mods and arcanes: unranked, then maxed" },
    { key: "trades", label: "Sold/day", value: (r) => daily(r.tradesPerDay), align: "right", muted: true, title: "How many sold a day on warframe.market lately (mods and arcanes: every rank together): below 1 sells slowly, blank hasn't sold lately" },
    { key: "ducats", label: "Ducats", value: (r) => r.ducats, align: "right", cell: ducatCell, minor: true, title: "What Baro gives for it" },
    { key: "have", label: "You have", value: (r) => r.have || null, align: "right", muted: true, minor: true, title: "How many you hold (sets: complete sets)" },
    { key: "buy", label: "", value: () => null, cell: buyCell, sortable: false, align: "right" },
  ];
</script>

{#snippet kindCell(r: MarketRow)}<Kind kind={r.category} label={label(r.category)} />{/snippet}
{#snippet nameCell(r: MarketRow)}<Named file={art(r)} name={r.name} />{/snippet}
{#snippet priceCell(r: MarketRow)}
  <span class="prices"><P v={r.price} />{#if r.priceMax != null}<span class="max" title="Maxed (rank {r.maxRank})"><P v={r.priceMax} dim /><span class="dim small">max</span></span>{/if}</span>
{/snippet}
{#snippet ducatCell(r: MarketRow)}{#if r.ducats}<P v={r.ducats} d dim />{/if}{/snippet}
{#snippet buyCell(r: MarketRow)}
  <button class="link" title="Open the buy order form for {r.name}: it shows the cheapest seller and best buyer right now, and posts nothing until you confirm" onclick={(e) => { e.stopPropagation(); buy(r); }}>Buy order</button>
{/snippet}
{#snippet card(r: MarketRow, open: () => void)}
  {#snippet foot()}
    <span class="dim small">{pace(r.tradesPerDay)}</span>
    <span class="grow"></span>
    {@render buyCell(r)}
  {/snippet}
  <!-- A box of its own only for the long names' style: display contents, so the grid still sees the card. -->
  <div class="mcard">
  <ItemCard hover={r.name} title={r.name} sub={label(r.category)} fallback={kindIcon(label(r.category), r.name)} image={art(r)} artSize={64} owned={!!r.have} ownedNote="You have {r.have}" onopen={open} {foot}>
    <div class="vals">
      <span><span class="register">Price</span><P v={r.price} /></span>
      {#if r.priceMax != null}<span><span class="register">Maxed</span><P v={r.priceMax} dim /></span>{/if}
      {#if r.ducats}<span><span class="register">Ducats</span><P v={r.ducats} d dim /></span>{/if}
      {#if r.have}<span><span class="register">You have</span><b class="mark">×{r.have}</b></span>{/if}
    </div>
  </ItemCard>
  </div>
{/snippet}
{#snippet detail(r: MarketRow)}
  <p class="small dim">
    {label(r.category)} · {r.price != null ? `sold for ${r.price.toLocaleString("en")}p lately` : "no recent price"}{#if r.priceMax != null}{" · "}{r.priceMax.toLocaleString("en")}p maxed{/if} · {pace(r.tradesPerDay).toLowerCase()}{#if r.have}{" · "}you have {r.have}{/if}
  </p>
  {#if r.tradesPerDay}
    <!-- Mods and arcanes: unranked and maxed copies sell apart, at different prices. -->
    <div class="hist"><PriceHistory name={r.name} unique={r.category === "relic" ? null : r.gameRef} rank={r.maxRank ? 0 : null} height={130} known={r.price != null} /></div>
    {#if r.maxRank}<div class="hist"><PriceHistory name={r.name} unique={r.gameRef} rank={r.maxRank} height={130} known={r.priceMax != null} /></div>{/if}
  {/if}
  <div class="actions">
    <button class="link" title="Open the buy order form: the cheapest seller and best buyer now; nothing is posted until you confirm" onclick={() => buy(r)}>Buy order</button>
    <button class="link" aria-busy={links.isOpening(`https://warframe.market/items/${r.slug}`)} onclick={() => openUrl(`https://warframe.market/items/${r.slug}`)}><Opening url={`https://warframe.market/items/${r.slug}`}>warframe.market ↗</Opening></button>
    <button class="link" aria-busy={links.isOpening(wikiUrl(r.name))} onclick={() => openUrl(wikiUrl(r.name))}><Opening url={wikiUrl(r.name)}>Wiki ↗</Opening></button>
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Browse market" brief="Everything on warframe.market, by price." blurb="Everything warframe.market trades: what it sold for lately, how often it sells." help={{ hero: "browse.ticker" }}>
    {#snippet hero()}<Ticker id="browse" label="The market, live" items={tape} />{/snippet}
  </PageHead>

  {#snippet filters()}
    <input type="search" title="Shows only what matches what you type" placeholder="Filter items…" bind:value={query} aria-label="Filter items by name" />
    <select bind:value={category} aria-label="Category" class="kinds" title="Only one kind of item, by warframe.market's own tags">
      <option value="all">All kinds ({count("all").toLocaleString("en")})</option>
      {#each CATEGORIES as c (c.v)}<option value={c.v}>{c.label} ({count(c.v).toLocaleString("en")})</option>{/each}
    </select>
    <Chip bind:on={weekly} label="Sold weekly" title="Only what sells at least once a week, on several different days. Off: everything, including prices from a sale or two, which can be jokes (a set &quot;sold&quot; for 80,000p)" />
    <Chip bind:on={owned} label="You have" title="Only what you hold" />
    <Fold active={(min != null ? 1 : 0) + (max != null ? 1 : 0) + (minTrades != null ? 1 : 0)} reset={() => { min = null; max = null; minTrades = null; }}>
    <span class="pair">
      <label class="min" title="Only what sold for at least this much lately (a mod or arcane counts at its maxed price). Empty: any.">
        <span class="register">Price ≥</span>
        <input type="number" min="0" step="1" placeholder="any" bind:value={min} aria-label="Minimum price" />
        <GameIcon name="platinum" size={14} />
      </label>
      <label class="min" title="Only what sold for at most this much lately (a mod or arcane counts unranked). Empty: any.">
        <span class="register">Price ≤</span>
        <input type="number" min="0" step="1" placeholder="any" bind:value={max} aria-label="Maximum price" />
        <GameIcon name="platinum" size={14} />
      </label>
    </span>
    <label class="min" title="Only what sells at least this many times a day on warframe.market (1: it actually sells). Empty: any.">
      <span class="register">Sold/day ≥</span>
      <input type="number" min="0" step="any" placeholder="any" bind:value={minTrades} aria-label="Minimum sold a day" />
    </label>
    </Fold>
    <HelpMark part="browse.filters" />
  {/snippet}

  {#if !mkt.items.length}
    <div class="bar">{@render filters()}</div>
    {#if loadError}
      <p class="dim">Couldn't load warframe.market's item list: {loadError}. <button class="link" onclick={() => { loadError = null; void load(); }}>Try again</button></p>
    {:else}
      <p class="dim">Loading warframe.market's item list…</p>
    {/if}
  {:else}
    <Browse {filters} id="market-browse" help={{ list: "browse.list", sheet: "browse.sheet" }} {rows} {columns} key={(r) => r.slug} bind:sort {detail} {card} title={(r) => r.name} min="16rem" clear={filtered ? clear : null} />
    {#if slowHidden}<p class="dim small more">{slowHidden.toLocaleString("en")} more sold too rarely for a steady price: theirs may not be real. <button class="link" onclick={() => (weekly = false)}>Show them</button></p>{/if}
  {/if}
</div></div>

<style>
  .mcard { display: contents; }
  /* A long name (Equilibrium (Steam Pinnacle Pack)) takes a second line rather than an ellipsis. */
  .mcard :global(.card h3) { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.05; }
  /* Its art and prices still line up with the cards beside it: they sit on the footer. */
  .mcard :global(.card .body) { align-self: end; }
  .kinds { min-width: 13rem; }
  .min { display: inline-flex; align-items: center; gap: .45rem; }
  .min .register { font-size: 11px; white-space: nowrap; }
  .min input { width: 4.6rem; }
  .prices { display: inline-flex; align-items: center; gap: .6rem; }
  .max { display: inline-flex; align-items: center; gap: .25rem; }
  .vals { display: flex; gap: 1rem; flex-wrap: wrap; }
  .vals > span { display: grid; gap: .15rem; }
  .vals .register { font-size: 11px; }
  .grow { flex: 1; }
  .hist { max-width: 46rem; margin: 0 0 .8rem; }
  .more { text-align: center; }
  /* Price at least / at most stay together when the bar wraps. */
  .pair { display: inline-flex; gap: inherit; flex-wrap: nowrap; }
</style>
