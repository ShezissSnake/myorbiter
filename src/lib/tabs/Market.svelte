<script lang="ts">
  // Everything warframe.market trades, owned or not: browse by category, price and how often it
  // sells (the dearest Captura scenes, mods over 50p that sell daily…). Prices are what things sold
  // for lately; the buy order form shows the live order book.
  import type { Model } from "../core/model";
  import { CATEGORIES, filterRows, marketRows, topPrice, type MarketCategory, type MarketRow } from "../core/browse";
  import { mkt } from "../marketStore.svelte";
  import { openUrl, wikiUrl } from "../backend";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Named from "../ui/Named.svelte";
  import P from "../ui/P.svelte";
  import Chip from "../ui/Chip.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import { matches, type Column } from "../ui/table";

  let { model }: { model: Model } = $props();

  let category = $state<MarketCategory | "all">("all");
  let min = $state<number | null>(null);
  let max = $state<number | null>(null);
  let minTrades = $state<number | null>(null);
  let owned = $state(false);
  // On by default: the dearest things that "sold" once or twice lead with joke prices otherwise.
  let weekly = $state(true);
  let query = $state("");
  let sort = $state({ key: "price", desc: true });

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

  const all = $derived(marketRows(model, mkt.items));
  const rows = $derived(filterRows(all, { category, min, max, minTrades, owned, weekly }).filter((r) => matches(query, r.name)));
  /** What "Sells weekly" is hiding from the rest of the filters. */
  const slowHidden = $derived(weekly ? filterRows(all, { category, min, max, minTrades, owned, weekly: false }).filter((r) => matches(query, r.name)).length - rows.length : 0);
  const count = (c: MarketCategory | "all") => (c === "all" ? all.length : all.filter((r) => r.category === c).length);
  const label = (c: MarketCategory) => CATEGORIES.find((x) => x.v === c)?.label ?? "";
  const daily = (t: number | null) => (t == null ? null : Math.round(t * 10) / 10);
  /** How often it sells, in words, for the cards and the tooltips. */
  const pace = (t: number | null) => (t == null ? "No recent sales" : t >= 1 ? (daily(t) === 1 ? "Sells once a day" : `Sells ${daily(t)} times a day`) : t >= 1 / 7 ? `Sells about ${Math.round(t * 7)} times a week` : "Sells rarely");
  const sellsDaily = $derived(rows.filter((r) => (r.tradesPerDay ?? 0) >= 1).length);
  const filtered = $derived(category !== "all" || min != null || max != null || minTrades != null || owned || !weekly || !!query.trim());
  function clear() {
    category = "all";
    min = max = minTrades = null;
    owned = false;
    weekly = true;
    query = "";
  }
  /** orbiter's own art where it has some, else warframe.market's thumbnail. */
  const art = (r: MarketRow) => model.imageOf(r.name) ?? r.thumb;
  const buy = (r: MarketRow) => mkt.startBuy(r.name, { unique: r.gameRef });

  const columns: Column<MarketRow>[] = [
    { key: "name", label: "Item", value: (r) => r.name, cell: nameCell, defaultDesc: false, width: "24rem" },
    { key: "kind", label: "Category", value: (r) => label(r.category), muted: true, defaultDesc: false, minor: true },
    { key: "price", label: "Price", value: (r) => r.price, sortValue: (r) => topPrice(r), align: "right", cell: priceCell, title: "What it sold for lately on warframe.market (the daily median). Mods and arcanes: unranked, then maxed" },
    { key: "trades", label: "Trades/day", value: (r) => daily(r.tradesPerDay), align: "right", muted: true, title: "How many sell a day on warframe.market (mods and arcanes: every rank together): below 1 sells slowly, blank hasn't sold lately" },
    { key: "ducats", label: "Ducats", value: (r) => r.ducats, align: "right", cell: ducatCell, minor: true, title: "What Baro gives for it" },
    { key: "have", label: "You have", value: (r) => r.have || null, align: "right", muted: true, minor: true, title: "How many you hold (sets: complete sets)" },
    { key: "buy", label: "", value: () => null, cell: buyCell, sortable: false, align: "right" },
  ];
</script>

{#snippet nameCell(r: MarketRow)}<Named file={art(r)} name={r.name} />{/snippet}
{#snippet priceCell(r: MarketRow)}
  <span class="prices"><P v={r.price} />{#if r.priceMax != null}<span class="max" title="Maxed (rank {r.maxRank})"><P v={r.priceMax} dim /><span class="dim small">max</span></span>{/if}</span>
{/snippet}
{#snippet ducatCell(r: MarketRow)}{#if r.ducats}<P v={r.ducats} d dim />{/if}{/snippet}
{#snippet buyCell(r: MarketRow)}
  <button class="link" title="Post a buy order on warframe.market for {r.name}: the form shows the cheapest seller and best buyer right now" onclick={(e) => { e.stopPropagation(); buy(r); }}>Buy order</button>
{/snippet}
{#snippet card(r: MarketRow, open: () => void)}
  {#snippet foot()}
    <span class="dim small">{pace(r.tradesPerDay)}</span>
    <span class="grow"></span>
    {@render buyCell(r)}
  {/snippet}
  <ItemCard hover={r.name} title={r.name} sub={label(r.category)} image={art(r)} artSize={64} owned={!!r.have} onopen={open} {foot}>
    <div class="vals">
      <span><span class="register">Price</span><P v={r.price} /></span>
      {#if r.priceMax != null}<span><span class="register">Maxed</span><P v={r.priceMax} dim /></span>{/if}
      {#if r.ducats}<span><span class="register">Ducats</span><P v={r.ducats} d dim /></span>{/if}
      {#if r.have}<span><span class="register">You have</span><b class="mark">×{r.have}</b></span>{/if}
    </div>
  </ItemCard>
{/snippet}
{#snippet detail(r: MarketRow)}
  <p class="small dim">
    {label(r.category)} · {r.price != null ? `sold for ${r.price.toLocaleString("en")}p lately` : "no recent price"}{#if r.priceMax != null}{" · "}{r.priceMax.toLocaleString("en")}p maxed{/if} · {pace(r.tradesPerDay).toLowerCase()}{#if r.have}{" · "}you have {r.have}{/if}
  </p>
  {#if r.tradesPerDay}
    <!-- Mods and arcanes: unranked and maxed copies sell apart, at different prices. -->
    <div class="hist"><PriceHistory name={r.name} unique={r.category === "relic" ? null : r.gameRef} rank={r.maxRank ? 0 : null} height={130} /></div>
    {#if r.maxRank}<div class="hist"><PriceHistory name={r.name} unique={r.gameRef} rank={r.maxRank} height={130} /></div>{/if}
  {/if}
  <div class="actions">
    <button class="link" title="See the cheapest seller and best buyer now, and post a buy order" onclick={() => buy(r)}>Buy order</button>
    <button class="link" onclick={() => openUrl(`https://warframe.market/items/${r.slug}`)}>warframe.market ↗</button>
    <button class="link" onclick={() => openUrl(wikiUrl(r.name))}>Wiki ↗</button>
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Market" blurb="Everything warframe.market trades, yours or not: what it sold for lately and how often it sells.">
    {#snippet band()}
      <Stat label="Items shown" note={filtered ? `Of ${all.length.toLocaleString("en")} on warframe.market` : "Everything on warframe.market"}><b class="mark big">{rows.length.toLocaleString("en")}</b></Stat>
      <Stat label="Sell daily" tone="dim" note="Of those shown, ones that sell at least once a day"><b class="mark big">{sellsDaily.toLocaleString("en")}</b></Stat>
    {/snippet}
  </PageHead>

  <div class="bar">
    <select bind:value={category} aria-label="Category" class="kinds" title="Only one kind of item, by warframe.market's own tags">
      <option value="all">Everything ({count("all")})</option>
      {#each CATEGORIES as c (c.v)}<option value={c.v}>{c.label} ({count(c.v)})</option>{/each}
    </select>
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
      <span class="register">Trades/day ≥</span>
      <input type="number" min="0" step="any" placeholder="any" bind:value={minTrades} aria-label="Minimum trades a day" />
    </label>
    <Chip bind:on={weekly} label="Sells weekly" title="Only what sells at least once a week, on several different days. Off: everything, including prices from a sale or two, which can be jokes (a set &quot;sold&quot; for 80,000p)" />
    <Chip bind:on={owned} label="You have" title="Only what you hold" />
    <input type="search" placeholder="Filter items…" bind:value={query} aria-label="Filter items by name" />
  </div>

  {#if !mkt.items.length}
    {#if loadError}
      <p class="dim">Couldn't load warframe.market's item list: {loadError}. <button class="link" onclick={() => { loadError = null; void load(); }}>Try again</button></p>
    {:else}
      <p class="dim">Loading warframe.market's item list…</p>
    {/if}
  {:else}
    <Browse id="market-browse" {rows} {columns} key={(r) => r.slug} bind:sort {detail} {card} title={(r) => r.name} min="16rem" empty="Nothing matches these filters." />
    {#if slowHidden}<p class="dim small more">{slowHidden.toLocaleString("en")} more sold too rarely for a steady price: theirs may not be real. <button class="link" onclick={() => (weekly = false)}>Show them</button></p>
    {:else if !rows.length && filtered}<p class="dim more"><button class="link" onclick={clear}>Clear the filters</button></p>{/if}
  {/if}
</div></div>

<style>
  .kinds { min-width: 13rem; }
  .min { display: inline-flex; align-items: center; gap: .45rem; }
  .min .register { font-size: .6rem; white-space: nowrap; }
  .min input { width: 4.6rem; }
  .prices { display: inline-flex; align-items: center; gap: .6rem; }
  .max { display: inline-flex; align-items: center; gap: .25rem; }
  .vals { display: flex; gap: 1rem; flex-wrap: wrap; }
  .vals > span { display: grid; gap: .15rem; }
  .vals .register { font-size: .6rem; }
  .grow { flex: 1; }
  .hist { max-width: 46rem; margin: 0 0 .8rem; }
  .big { font-size: 1.9rem; }
  .more { text-align: center; }
  /* Price at least / at most stay together when the bar wraps. */
  .pair { display: inline-flex; gap: inherit; flex-wrap: nowrap; }
</style>
