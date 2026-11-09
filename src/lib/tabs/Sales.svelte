<script lang="ts">
  import { whileShown } from "../pane.svelte";
  import { localDayStart, salesByDay } from "../core/salesDays";
  // What you've sold and what it made, and how each sale compares with the market. Sales log
  // themselves from trades in the game log, or when you press Sold on a listing in Orders, or are
  // added here by hand for trades made outside warframe.market.
  import type { Model } from "../core/model";
  import type { Sale, Settings } from "../backend";
  import PageHead from "../ui/PageHead.svelte";
  import Ticker, { type Tick } from "../ui/Ticker.svelte";
  import Stat from "../ui/Stat.svelte";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import Seg from "../ui/Seg.svelte";
  import Metal from "../ui/Metal.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Chip from "../ui/Chip.svelte";
  import { heldFor, knownName, overListed } from "../core/market";
  import { exportFile, market as wfm } from "../backend";
  import { salesCsv } from "../core/exportCsv";
  import { importClosed } from "../core/closedOrders";
  import { mkt } from "../marketStore.svelte";
  import { imprintNaming } from "../core/trades";
  import { imprintSaleName } from "../core/imprints";
  import ProgressButton from "../ui/ProgressButton.svelte";
  import { Job } from "../job.svelte";
  import Count from "../ui/Count.svelte";
  import { arrive, flip, leave, reveal } from "../motion";

  let { model, settings = $bindable(), go }: { model: Model; settings: Settings; go: (t: string) => void } = $props();

  const sales = $derived(settings.market.sales);

  // Sales from warframe.market's side: the orders you've closed there (see closedOrders.ts).
  // Import and Export: each button turns or ticks as it goes; the line beside them says how it went.
  const importJob = new Job();
  const exportJob = new Job();
  const importing = $derived(importJob.working);
  let imported = $state<string | null>(null);
  /** The line beside the buttons is a failure (in oxblood). */
  let importFailed = $state(false);
  function exportSales() {
    void exportJob.run(async () => {
      try {
        imported = `Saved to ${await exportFile("sales", salesCsv(settings.market.sales))}`;
        importFailed = false;
        return "Saved";
      } catch (e) {
        imported = `Couldn't save the export (${String(e).replace(/^Error:\s*/, "")})`;
        importFailed = true;
        throw e;
      }
    });
  }
  function importFromMarket() {
    void importJob.run(async () => {
      await importSales();
      if (importFailed) throw new Error(imported ?? "Couldn't read your closed orders");
      return "Imported";
    });
  }
  async function importSales() {
    const me = mkt.me?.ingameName;
    if (!me) return;
    imported = null;
    importFailed = false;
    try {
      const closed = await wfm.closedOrders(me);
      const r = importClosed(settings.market.sales, closed);
      if (r.added || r.matched) settings.market.sales = r.sales.slice(0, 2000);
      const sells = closed.filter((c) => c.kind === "sell").length;
      imported = !sells ? "warframe.market has no closed sales on your profile." : r.added ? `Added ${r.added} sale${r.added === 1 ? "" : "s"} from warframe.market; the other ${sells - r.added} ${sells - r.added === 1 ? "was" : "were"} already logged.` : `All ${sells} closed sale${sells === 1 ? " on warframe.market was" : "s on warframe.market were"} already logged.`;
    } catch (e) {
      imported = `Couldn't read your closed orders: ${String(e).replace(/^Error:\s*/, "")}`;
      importFailed = true;
    }
  }
  const DAY = 86_400_000;
  // The page stays open for hours: "today" and the chart move on at midnight without a new sale.
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });
  /** Local midnight: changes once a day, so what depends on it isn't redone every minute. */
  const dayStart = $derived(localDayStart(now));
  const since = (t: number) => sales.filter((s) => s.at >= t);
  const plat = (xs: Sale[]) => xs.reduce((n, s) => n + s.quantity * s.platinum, 0);
  const trades = (xs: Sale[]) => xs.reduce((n, s) => n + s.quantity, 0);

  const today = $derived(since(dayStart));
  const week = $derived.by(whileShown("sales", () => since(now - 7 * DAY)));
  const month = $derived.by(whileShown("sales", () => since(now - 30 * DAY)));

  // The ticker tape under the title: today, the week and your best sale (the band keeps the month and after).
  const best = $derived.by(whileShown("sales", () => sales.reduce<Sale | null>((b, s) => (!b || s.quantity * s.platinum > b.quantity * b.platinum ? s : b), null)));
  const tape = $derived<Tick[]>([
    { key: "today", label: "Today", value: plat(today), plat: true, subN: trades(today), sub: "sold", title: `Today: ${trades(today)} sold since your local midnight (Trades left, on Home and Orders, counts from 00:00 UTC)` },
    { key: "week", label: "7 days", value: plat(week), plat: true, subN: trades(week), sub: "sold", title: `Last 7 days: ${trades(week)} sold` },
    best
      ? { key: "best", label: "Best sale", value: best.quantity * best.platinum, plat: true, sub: `${best.quantity > 1 ? `${best.quantity}× ` : ""}${best.item} · ${new Date(best.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`, title: `Best sale: the most platinum one sale brought, of everything logged: ${best.quantity > 1 ? `${best.quantity} × ${best.platinum}p for ` : ""}${best.item}` }
      : { key: "best", label: "Best sale", value: null, tone: "dim", title: "Best sale: the most platinum one sale brought, once you've logged some" },
  ]);
  let span = $state<"7" | "30" | "all">("30");
  /** Span picks so far: the chart's bars grow from nothing when a pick redraws them (not on load). */
  let picks = $state(0);
  const inSpan = $derived.by(whileShown("sales", () => span === "all" ? sales : since(now - Number(span) * DAY)));
  const top = $derived(
    [...inSpan.reduce((m, s) => m.set(s.item, { item: s.item, qty: (m.get(s.item)?.qty ?? 0) + s.quantity, plat: (m.get(s.item)?.plat ?? 0) + s.quantity * s.platinum }), new Map<string, { item: string; qty: number; plat: number }>()).values()]
      .sort((a, b) => b.plat - a.plat)
      .slice(0, 8),
  );
  // Platinum per day, for the bar chart. Days are calendar days (a clock change makes one 23 or 25 hours).
  const days = $derived.by(whileShown("sales", () => salesByDay(sales, dayStart, span === "7" ? 7 : 30)));
  const peak = $derived(Math.max(1, ...days.map((d) => d.plat)));

  // Adding one by hand.
  let item = $state("");
  let qty = $state<number | null>(null);
  let price = $state<number | null>(null);
  // Mods and arcanes sell at very different prices maxed and unranked: say which it was.
  let maxed = $state(false);
  /**
   * The item field's suggestions (every tradable name, two thousand or so), drawn the first time
   * it's focused rather than with the page: most visits never open the list.
   */
  let namesWanted = $state(false);
  const names = $derived([...new Set([...model.partByName.keys(), ...model.primeParents.map((p) => `${p.name} Set`), ...[...model.catalogByUnique.values()].filter((c) => c.tradable).map((c) => c.name)])].sort());
  // What you typed, in any case, as MyOrbiter spells it; something it doesn't know can still be logged.
  const known = $derived(knownName(names, item));
  const unknown = $derived(!!item.trim() && !known);
  // Some names have several catalog entries (Serration): the highest max rank is the one that trades.
  const ranked = $derived(known ? ([...model.catalogByUnique.values()].filter((c) => c.name === known && (c.maxRank ?? 0) > 0).sort((a, b) => (b.maxRank ?? 0) - (a.maxRank ?? 0))[0] ?? null) : null);
  /** Why Add is off, when it is. */
  const blocked = $derived(!item.trim() ? "Name the item sold" : qty != null && Math.round(qty) < 1 ? "Sold at least 1" : !price || price < 1 ? "Set the price each" : null);
  function add() {
    const n = Math.round(qty ?? 1);
    if (blocked || !price) return;
    const rank = ranked ? (maxed ? (ranked.maxRank ?? null) : 0) : null;
    const sale: Sale = { at: Date.now(), item: known ?? item.trim(), rank, quantity: n, platinum: Math.round(price) };
    // Stamped with today's median here, as App stamps every new sale: done now, the log changes once,
    // so its rows close up and the new one arrives (a second rewrite in the same moment loses that).
    const median = rank != null && rank > 0 ? (model.priceMax(sale.item) ?? model.price(sale.item)) : model.price(sale.item);
    if (median != null) sale.median = Math.round(median * 10) / 10;
    settings.market.sales = [sale, ...sales].slice(0, 2000);
    added = keyOf(sale);
    item = "";
    maxed = false;
    qty = null;
    price = null;
  }
  // The delete confirm sticks to its sale, not its row: a sale logged meanwhile shifts the rows.
  const keyOf = (s: Sale) => `${s.at}|${s.item}|${s.rank ?? ""}|${s.quantity}|${s.platinum}|${s.trade ?? ""}`;
  let removing = $state<string | null>(null);
  /** The sale you just added by hand: it arrives in the log with a gold wash. */
  let added = $state<string | null>(null);
  // The log, each row keyed by its sale (a sale logged meanwhile doesn't shift a row's state onto
  // another); two identical sales get a count after the second's key.
  const log = $derived.by(whileShown("sales", () => {
    const seen = new Map<string, number>();
    return sales.slice(0, 200).map((s) => {
      const k = keyOf(s);
      const n = seen.get(k) ?? 0;
      seen.set(k, n + 1);
      return { s, key: n ? `${k}#${n}` : k };
    });
  }));
  function drop(key: string) {
    const i = sales.findIndex((x) => keyOf(x) === key);
    if (i >= 0) settings.market.sales = sales.filter((_, j) => j !== i);
    removing = null;
  }

  const when = (t: number) => {
    const d = new Date(t);
    return t >= dayStart ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  const image = (name: string) => model.imageOf(name.replace(/ Set$/, ""));

  // An imprint sale logged by its pet's name ("Imprint of Biscuit", before MyOrbiter named imprints by
  // breed): the market item it is, when the inventory or the name says its breed. Else none, and no price.
  const naming = $derived(imprintNaming(mkt.index, settings.game.imprints));
  const itemOf = (s: Sale) => imprintSaleName(s.item, naming) ?? s.item;
  const unnamedImprint = (s: Sale) => /^\s*imprint of\s/i.test(s.item) && itemOf(s) === s.item;

  // Against the market: what each sale made next to the daily median for that item (the max-rank
  // price for a ranked arcane or mod).
  // The median when it sold, where MyOrbiter recorded one; older sales go by today's.
  const market = (s: Sale) => {
    const item = itemOf(s);
    return s.median ?? (s.rank != null && s.rank > 0 ? (model.priceMax(item) ?? model.price(item)) : model.price(item));
  };
  const UNDER = 0.8;
  const ratio = (s: Sale) => {
    const m = market(s);
    return m && m > 0 ? s.platinum / m : null;
  };
  const vsMonth = $derived.by(() => {
    let got = 0;
    let ref = 0;
    for (const s of month) {
      const m = market(s);
      if (!m) continue;
      got += s.platinum * s.quantity;
      ref += m * s.quantity;
    }
    return ref ? got / ref : null;
  });
  const underCount = $derived(month.filter((s) => (ratio(s) ?? 1) < UNDER).length);
  // What sold three or more times in 30 days: worth keeping listed, and listing more copies of.
  /** Listings for more than you hold now: Orders asks "Sold?" under each, and a Yes logs the sale here. */
  const over = $derived.by(whileShown("sales", () => overListed(mkt.orders, (o) => { const it = mkt.item(o.itemId); return it ? heldFor(model, it, o) : null; })));
  const maybeSold = $derived(over.shown.length + over.hidden.length);
  const OFTEN = 3;
  const fast = $derived(new Set([...month.reduce((m, s) => m.set(s.item, (m.get(s.item) ?? 0) + s.quantity), new Map<string, number>())].filter(([, n]) => n >= OFTEN).map(([k]) => k)));
</script>

<div class="page"><div class="page-inner">
  <!-- Nothing logged: no row of zeros, just how sales get here. -->
  <PageHead title="Sales" brief="What you've sold, and the platinum it made." blurb="What you've sold, and the platinum it made." band={sales.length ? band : undefined} hero={ticker} />
    {#snippet ticker()}<Ticker id="sales" label="Your sales, live" items={tape} />{/snippet}
    {#snippet band()}
      <Stat label="Last 30 days" note={`${trades(month)} sold`}><P v={plat(month)} big tick /></Stat>
      {#if vsMonth != null}<Stat label="Vs market, 30 days" tone={vsMonth < UNDER ? "gold" : "platinum"} note={underCount ? `${underCount} sale${underCount === 1 ? "" : "s"} under ${Math.round(UNDER * 100)}% of the median` : "Every sale near the daily median or better"}><Count value={Math.round(vsMonth * 100)} format={(n) => `${Math.round(n)}%`} /></Stat>{/if}
      <Stat label="All logged" note={sales.length ? `since ${new Date(Math.min(...sales.map((s) => s.at))).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : "Nothing yet"}><P v={plat(sales)} big tick /></Stat>
    {/snippet}

  <!-- The first sale logged, or the last one deleted: the empty card and the chart fold into each
       other (reveal), and the log folds away or in, rather than the page snapping. -->
  {#if !sales.length}
    <div class="reveal" transition:reveal><div>
    <section class="panel empty">
      <h2 class="mark">No sales logged yet</h2>
      {#if settings.market.platform !== "pc"}
      <p class="prose">Press <span class="ic"><Icon name="sold" size={13} /></span> on a listing in <button class="link" onclick={() => go("market")}>Orders</button> when it sells, or import your warframe.market sales below.</p>
      {:else}
      <p class="prose">Sales log themselves when you trade items for platinum in game. For anything else, press <span class="ic"><Icon name="sold" size={13} /></span> on a listing in <button class="link" onclick={() => go("market")}>Orders</button>, or add it below.</p>
      {/if}
      {#if maybeSold}<p><button class="link" title="Listings for more than you hold now: on Orders, answer Sold? and a Yes logs the sale here" onclick={() => go("market")}>{maybeSold} possible sale{maybeSold === 1 ? "" : "s"} waiting on Orders →</button></p>{/if}
    </section>
    </div></div>
  {:else}
    <div class="reveal" transition:reveal><div>
    <div class="grid">
      <section class="chart">
        <div class="head"><span class="register">Platinum per day</span>{#if days.some((d) => d.plat > 0)}<span class="dim small">best day <P v={peak} tick /></span>{/if}<span class="grow"></span><Seg bind:value={span} label="Span" onchange={() => picks++} options={[{ v: "7", label: "7 days", title: "The chart and best sellers over the last 7 days" }, { v: "30", label: "30 days", title: "The chart and best sellers over the last 30 days" }, { v: "all", label: "All", title: "Best sellers over everything logged; the chart shows 30 days" }]} /></div>
        <!-- A span picked redraws the bars growing up from the axis (scaleY, QUICK); a new sale just changes them. -->
        {#key picks}
        <div class="bars" class:grow={picks > 0} role="img" aria-label="Platinum made per day">
          {#each days as d (d.at)}
            <div class="col" title="{new Date(d.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: {d.plat}p">
              <div class="fill" style:height="{(d.plat / peak) * 100}%"></div>
            </div>
          {/each}
        </div>
        {/key}
        <div class="axis register"><span>{new Date(days[0].at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span><span>today</span></div>
      </section>
      <section class="top">
        <div class="register">Best sellers</div>
        {#each top as t (t.item)}
          <div class="trow"><Named file={image(t.item)} name={t.item} size={30}>{#if fast.has(t.item)}<span class="tag fast" title="Sold {OFTEN} or more times in the last 30 days: keep it listed, and list more copies if you have them">sells often</span>{/if}</Named><span class="dim small n">{t.qty}×</span><P v={t.plat} /></div>
        {:else}
          <p class="dim small">Nothing sold in this span.</p>
        {/each}
      </section>
    </div>
    </div></div>
  {/if}


  <div class="loghead">
    <div class="import">
      <h2 class="register">Sale log</h2>
      <ProgressButton stamp={false} icon="import" job={importJob} label="Import" working="Importing…" doneLabel="Imported" failLabel="Couldn't import" title={mkt.me?.ingameName ? "Import sales from warframe.market: every sale you marked sold there that isn't logged here yet" : "Import sales from warframe.market: sign in on Orders first"} disabled={!mkt.me?.ingameName} onclick={importFromMarket} />
      {#if sales.length}<ProgressButton variant="icon" icon="export" tone="quiet" job={exportJob} label="Export sales as CSV" doneLabel="Saved" failLabel="Couldn't save" title="Save every logged sale as a CSV file in your Downloads folder, for a spreadsheet" onclick={exportSales} />{/if}
      {#if importing}<span class="small dim" role="status">Reading warframe.market…</span>{:else if imported}<span class="small" class:dim={!importFailed} class:bad={importFailed} role="status">{imported}</span>{/if}
    </div>
    <form class="addsale" onsubmit={(e) => { e.preventDefault(); add(); }}>
      <input class="it" list="sale-names" placeholder="Add a sale by hand: item" title="The item you sold, as warframe.market names it (pick from the list as you type)" bind:value={item} onfocus={() => (namesWanted = true)} aria-label="Item sold" />
      {#if namesWanted}<datalist id="sale-names">{#each names as n (n)}<option value={n}></option>{/each}</datalist>{/if}
      {#if ranked}<Chip bind:on={maxed} label="Maxed" title="Sold at max rank (R{ranked.maxRank}), compared with the maxed price" />{/if}
      <input type="number" min="1" placeholder="Qty 1" title="How many you sold (1 if left empty)" bind:value={qty} aria-label="How many" />
      <span class="dim">×</span>
      <span class="plat"><input type="number" min="1" placeholder="Price" title="The platinum you got for each one" bind:value={price} aria-label="Platinum each" /><Metal kind="plat" size={14} /></span>
      <IconButton icon="plus" tone="gold" type="submit" label="Add sale" title={blocked ?? "Add it to the log"} disabled={!!blocked} />
    </form>
    {#if unknown}<p class="small warn note">Not an item MyOrbiter knows: it won't be compared with the market.</p>
    {:else if qty != null && Math.round(qty) < 1}<p class="small warn note">Quantity is at least 1.</p>{/if}
  </div>

  {#if sales.length}
    <div class="reveal" transition:reveal><div>
    <table class="log">
      <thead><tr><th>When</th><th>Item</th><th class="right">Qty</th><th class="right">Each</th><th class="right" title="The sale price next to the item's daily median on warframe.market when it sold (today's, for sales from before MyOrbiter recorded it)">Vs market</th><th class="right">Total</th><th></th></tr></thead>
      <tbody>
        {#each log as { s, key } (key)}
          <tr class:added={added === keyOf(s)} in:arrive out:leave animate:flip>
            <td class="dim when">{when(s.at)}</td>
            <td><Named file={image(itemOf(s))} name={itemOf(s)}>{#if s.rank != null}<span class="tag">R{s.rank}</span>{/if}</Named></td>
            <td class="right">{s.quantity}</td>
            <td class="right"><P v={s.platinum} dim /></td>
            <td class="right">{#if ratio(s) != null}{@const r = ratio(s) ?? 0}<span class="vs" class:under={r < UNDER} class:over={r >= 1.1} title="Median {Math.round(market(s) ?? 0)}p">{Math.round(r * 100)}%</span>{:else}<span class="dim" title={unnamedImprint(s) ? `${s.item}: an imprint, logged by its pet's name. Its breed isn't in the last inventory read or the name, so there's no market price to compare with.` : undefined}>–</span>{/if}</td>
            <td class="right"><P v={s.quantity * s.platinum} /></td>
            <td class="right">
              {#if removing === keyOf(s)}<span class="acts"><span class="ask register">Delete?</span><IconButton icon="trash" tone="danger" label="Delete it" onclick={() => drop(keyOf(s))} /><IconButton icon="close" tone="quiet" label="Keep" onclick={() => (removing = null)} /></span>
              {:else}<span class="del"><IconButton icon="trash" tone="danger quiet" label="Delete" title="Delete: take this sale out of the log (warframe.market isn't touched)" onclick={() => (removing = keyOf(s))} /></span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if sales.length > 200}<p class="dim small more">Showing the latest 200 of {sales.length}.</p>{/if}
    </div></div>
  {/if}
</div></div>

<style>
  .import { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .import .bad { color: var(--oxblood); }
  .ic { display: inline-grid; place-items: center; width: 1.3rem; height: 1.3rem; vertical-align: -.3rem; border: 1px solid var(--gold-dim); color: var(--gold); }
  .grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(18rem, 1fr); gap: 1.6rem; margin: var(--step) 0 var(--course); }
  /* Page area under 950 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt950"]) .grid { grid-template-columns: 1fr; }
  .chart, .top { border: 1px solid var(--rule); background: var(--plate); padding: 1rem 1.2rem; }
  .head { display: flex; align-items: center; margin-bottom: .8rem; gap: 1rem; }
  .head .small { display: inline-flex; align-items: center; gap: .4rem; }
  .bars { display: flex; align-items: flex-end; gap: 3px; height: 9rem; }
  .col { flex: 1; height: 100%; display: flex; align-items: flex-end; background: rgb(255 255 255 / 2%); }
  .fill { width: 100%; background: linear-gradient(var(--platinum), var(--platinum-deep)); transform-origin: bottom; }
  .grow .fill { animation: bar-grow var(--quick) var(--out) both; }
  @keyframes bar-grow { from { transform: scaleY(0); } }
  .col:hover .fill { background: var(--gold); }
  .col:hover { background: rgb(255 255 255 / 5%); }
  .axis { display: flex; justify-content: space-between; margin-top: .4rem; color: var(--platinum-deep); }
  .top { display: grid; gap: .55rem; align-content: start; }
  .top > .register { margin-bottom: .2rem; }
  .trow { display: grid; grid-template-columns: minmax(0, 1fr) 2.4rem 4rem; gap: .8rem; align-items: center; }
  .trow .n, .trow :global(.amt) { justify-self: end; }

  /* The log, headed by the hand-entry form. */
  .loghead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .8rem 1.5rem; padding-bottom: .8rem; }
  .loghead h2 { margin: 0; }
  .addsale { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }
  .addsale .it { min-width: 18rem; }
  .note { flex-basis: 100%; margin: 0; text-align: right; }
  .warn { color: var(--gold); }
  .addsale input[type="number"] { width: 5rem; }
  .addsale input, .addsale :global(.ib) { height: 36px; }
  .addsale :global(.ib) { --ib: 36px; }
  .plat { display: inline-flex; align-items: center; gap: .4rem; }
  .log { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; border-top: 1px solid var(--rule); }
  .log th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: .6rem .6rem; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  .log th.right { text-align: right; }
  .log td { padding: var(--row-pad) .6rem; border-bottom: 1px solid var(--rule); }
  /* The table is a plate (app.css): its first and last columns keep off the plate's edges. */
  .log th:first-child, .log td:first-child { padding-left: .6rem; }
  .log th:last-child, .log td:last-child { padding-right: .6rem; }
  .log tbody tr:hover td { background: rgb(255 255 255 / 1.5%); }
  /* Just added by hand: a gold wash that fades over a second (a colour, so it shows under reduced motion too). */
  .log tr.added td { animation: sale-added 1s ease-out; }
  @keyframes sale-added { 0%, 30% { background: color-mix(in srgb, var(--gold) 16%, transparent); } 100% { background: transparent; } }
  .when { white-space: nowrap; font-size: .84rem; }
  .right { text-align: right; }
  .vs { color: var(--platinum-dim); white-space: nowrap; }
  .vs.under { color: var(--oxblood); }
  /* "under" sits in its own fixed slot after the number, so the percentages stay in one column. */
  .vs::after { content: ""; display: inline-block; width: 3.6em; margin-left: .45em; text-align: left; font-family: var(--face-register); font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; }
  .vs.under::after { content: "under"; }
  .vs.over { color: var(--verdigris); }
  .fast { color: var(--verdigris); border-color: var(--verdigris); }
  .acts { display: inline-flex; align-items: center; gap: .35rem; }
  .ask { color: var(--oxblood); font-size: 11px; margin-right: .2rem; }
  /* Delete waits on its row: shown when you point at the row or tab to it. */
  tr .del { display: inline-flex; opacity: 0; transition: opacity .12s; }
  tr:hover .del, .del:focus-within { opacity: 1; }
  .more { margin-top: .6rem; }
</style>
