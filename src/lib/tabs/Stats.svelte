<script lang="ts">
  import HelpMark from "../ui/HelpMark.svelte";
  import { whileShown } from "../pane.svelte";
  import { exportFile } from "../backend";
  import { numberFormat } from "../ui/table";
  import { tradesCsv } from "../core/exportCsv";
  import ProgressButton from "../ui/ProgressButton.svelte";
  import { Job } from "../job.svelte";
  import { info } from "../hover.svelte";
  // Your account over time and every trade you've made. The charts get a point each time
  // TennoScope reads your inventory; the history comes from Warframe's own log of the trade window.
  import type { Model } from "../core/model";
  import type { Settings, TradeLogEntry } from "../backend";
  import { salesCoveredByTrades } from "../core/market";
  import PageHead from "../ui/PageHead.svelte";
  import Ticker, { type Tick } from "../ui/Ticker.svelte";
  import Stat from "../ui/Stat.svelte";
  import P from "../ui/P.svelte";
  import Seg from "../ui/Seg.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import TimeChart from "../ui/TimeChart.svelte";
  import RelicRuns from "../ui/RelicRuns.svelte";
  import RepButton from "../ui/RepButton.svelte";
  import GameIcon, { type GameIconName } from "../ui/GameIcon.svelte";
  import { dropTotals } from "../core/drops";
  import Count from "../ui/Count.svelte";
  import { reveal } from "../motion";

  let { model, settings }: { model: Model; settings: Settings } = $props();
  // Export: a tick on the button when saved, the reason in oxblood beside it when not.
  let exported = $state<string | null>(null);
  const exportJob = new Job();
  const whole = numberFormat(0);
  function exportTrades() {
    void exportJob.run(async () => {
      try {
        exported = `Saved to ${await exportFile("trades", tradesCsv(settings.market.trades))}`;
        return "Saved";
      } catch (e) {
        exported = `Couldn't save the export (${String(e).replace(/^Error:\s*/, "")})`;
        throw e;
      }
    });
  }

  const DAY = 86_400_000;
  // A month, like Sales: the span most questions are about.
  let span = $state<"30" | "90" | "all">("30");
  const since = $derived(span === "all" ? 0 : Date.now() - Number(span) * DAY);
  const hist = $derived.by(whileShown("stats", () => settings.game.valueHistory.filter((p) => p.at >= since)));
  const at = $derived(hist.map((p) => p.at));
  /** The read the figures beside the value chart's title are from. */
  const lastRead = $derived(settings.game.valueHistory.at(-1)?.at ?? null);
  // The ticker tape under the title: your inventory's value at the last read, and how far it moved
  // since the read before (the chart below draws every read).
  const reads = $derived(settings.game.valueHistory);
  const last = $derived(reads.at(-1) ?? null);
  const prev = $derived(reads.at(-2) ?? null);
  const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(Math.round(v)).toLocaleString("en")}`;
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const tape = $derived<Tick[]>([
    { key: "worth", label: "Inventory value", value: last ? Math.round(last.worth) : null, plat: true, title: "Inventory value: every copy you hold at the daily median (Market value), at the last inventory read" },
    { key: "change", label: "Change", value: last && prev ? Math.round(last.worth - prev.worth) : null, text: last && prev ? signed(last.worth - prev.worth) : "–", plat: !!(last && prev), sub: prev ? `since ${day(prev.at)}` : "shows after the next read", tone: last && prev && last.worth < prev.worth ? "dim" : undefined, title: last && prev ? `Change in inventory value between the read of ${day(prev.at)} and the last one, ${day(last.at)}` : "Change in inventory value: shows from the next inventory read" },
    { key: "liquid", label: "Quick-sale value", value: last ? Math.round(last.liquid) : null, plat: true, sub: last && prev ? signed(last.liquid - prev.liquid) : undefined, title: "Quick-sale value: everything you hold of what trades daily, kept copies too, no more of each than the market sells in a month, at the last read (beside it, the change since the read before)" },
    { key: "read", label: "Last read", value: last?.at ?? null, text: last ? day(last.at) : "none yet", still: true, tone: "dim", title: last ? `The last inventory read MyOrbiter worked these out at: ${new Date(last.at).toLocaleString()}` : "No inventory read yet: press Sync while Warframe is running" },
  ]);
  // CSS colours (app.css tokens): the chart draws its lines with them as styles.
  const GOLD = "var(--chart-gold)";

  /** Platinum, credits and Endo first; the other resources a click away. */
  let allCharts = $state(false);
  const CHARTS: { key: string; title: string; icon: GameIconName; get: (p: (typeof hist)[number]) => number | null | undefined }[] = [
    { key: "platinum", title: "Platinum", icon: "platinum", get: (p) => p.platinum },
    { key: "credits", title: "Credits", icon: "credits", get: (p) => p.credits },
    { key: "endo", title: "Endo", icon: "endo", get: (p) => p.endo },
    { key: "ducats", title: "Ducats", icon: "ducats", get: (p) => p.held?.ducats },
    { key: "aya", title: "Aya", icon: "aya", get: (p) => p.held?.aya },
    { key: "kuva", title: "Kuva", icon: "kuva", get: (p) => p.held?.kuva },
    { key: "traces", title: "Void Traces", icon: "void-traces", get: (p) => p.held?.traces },
    { key: "vosfor", title: "Vosfor", icon: "vosfor", get: (p) => p.held?.vosfor },
    { key: "relics", title: "Relics held", icon: "relic-axi-intact", get: (p) => p.held?.relics },
  ];

  // ---------------------------------------------------------------- parts you got
  // Every prime part (and other gear part) that turned up between inventory reads in this span,
  // trades left out (core/drops.ts), most first.
  const got = $derived.by(whileShown("stats", () => [...dropTotals(settings.game.drops, settings.market.trades, since)]
      .map(([name, n]) => ({ name, n, each: model.price(name) }))
      .sort((a, b) => b.n - a.n || (b.each ?? 0) * b.n - (a.each ?? 0) * a.n || a.name.localeCompare(b.name))));
  const gotWorth = $derived(got.reduce((s, g) => s + (g.each ?? 0) * g.n, 0));
  const gotCount = $derived(got.reduce((s, g) => s + g.n, 0));

  // ---------------------------------------------------------------- trades
  const trades = $derived.by(whileShown("stats", () => settings.market.trades.filter((t) => t.at >= since)));
  type Kind = "sale" | "purchase" | "trade";
  const kindOf = (t: TradeLogEntry): Kind => (t.platIn > 0 && !t.received.length ? "sale" : t.platOut > 0 && !t.offered.length ? "purchase" : "trade");
  let show = $state<"all" | Kind>("all");
  const shown = $derived(show === "all" ? trades : trades.filter((t) => kindOf(t) === show));

  // What an item counts as, for profit by type.
  type Group = "Prime parts" | "Sets" | "Arcanes" | "Mods" | "Relics" | "Rivens" | "Other";
  const ICON: Record<Group, GameIconName> = { "Prime parts": "ducats", Sets: "foundry", Arcanes: "vosfor", Mods: "endo", Relics: "relic-axi-intact", Rivens: "riven", Other: "market" };
  const categoryOf = $derived(new Map([...model.catalogByUnique.values()].map((c) => [c.name, c.category])));
  function groupOf(name: string): Group {
    if (/ Set$/.test(name)) return "Sets";
    if (/ Relic$|^(Lith|Meso|Neo|Axi|Requiem) [A-Z]+\d+$|^Requiem [A-Z][a-z]+$/.test(name)) return "Relics";
    if (/Riven/.test(name)) return "Rivens";
    if (model.partByName.has(name)) return "Prime parts";
    const c = categoryOf.get(name) ?? model.inventoryByName.get(name)?.[0]?.category;
    if (c === "Arcanes" || c === "arcane") return "Arcanes";
    if (c === "Mods" || c === "mod") return "Mods";
    return "Other";
  }
  const byType = $derived.by(whileShown("stats", () => {
    const out = new Map<Group, { revenue: number; spent: number }>();
    const add = (g: Group, k: "revenue" | "spent", v: number) => {
      const e = out.get(g) ?? { revenue: 0, spent: 0 };
      e[k] += v;
      out.set(g, e);
    };
    // Revenue and spent both come from the trade history, each trade's platinum shared out by
    // copies: sales over what you gave, purchases over what you got.
    for (const t of trades) {
      const k = kindOf(t);
      if (k === "trade") continue;
      const xs = k === "sale" ? t.offered : t.received;
      const n = xs.reduce((c, x) => c + x.count, 0) || 1;
      for (const x of xs) add(groupOf(x.name), k === "sale" ? "revenue" : "spent", ((k === "sale" ? t.platIn : t.platOut) * x.count) / n);
    }
    // Plus sales that no logged trade covers: a sale names its trade when one logged or matched
    // it; one logged by hand pairs with the nearest unclaimed trade of that item, within a day.
    const covered = salesCoveredByTrades(settings.market.sales, settings.market.trades.filter((t) => kindOf(t) === "sale"));
    for (const s of settings.market.sales) if (s.at >= since && !covered.has(s)) add(groupOf(s.item), "revenue", s.quantity * s.platinum);
    return [...out.entries()].map(([g, v]) => ({ group: g, revenue: Math.round(v.revenue), spent: Math.round(v.spent), profit: Math.round(v.revenue - v.spent) })).sort((a, b) => b.profit - a.profit);
  }));
  const revenue = $derived(byType.reduce((n, r) => n + r.revenue, 0));
  const spent = $derived(byType.reduce((n, r) => n + r.spent, 0));
  const partners = $derived(new Set(trades.map((t) => t.partner)).size);
  /** Players with your +rep (warframe.market takes one per player, so any trade with them counts). */
  const repGiven = $derived.by(whileShown("stats", () => new Set(settings.market.trades.filter((t) => settings.market.rep[t.key] === "given").map((t) => t.partner.toLowerCase()))));

  const when = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const img = (name: string) => model.imageOf(name.replace(/ Set$/, "").replace(/ Relic$/, ""));
</script>

{#snippet items(xs: TradeLogEntry["offered"], plat: number)}
  <span class="its">
    {#if plat}<span class="it plat"><GameIcon name="platinum" size={22} /><b>{plat}</b></span>{/if}
    <!-- One or two things: their names too (blueprints all look alike); more: pictures, names on hover. -->
    {#each xs.slice(0, 6) as x, i (i)}<span class="it" use:info={x.name}><Thumb file={img(x.name)} size={30} />{#if x.count > 1}<b>{x.count}</b>{/if}{#if xs.length <= 2}<span class="nm small">{x.name}</span>{/if}</span>{/each}
    {#if xs.length > 6}<span class="dim small">+{xs.length - 6}</span>{/if}
    {#if !plat && !xs.length}<span class="dim small">nothing</span>{/if}
  </span>
{/snippet}

<div class="page"><div class="page-inner">
  {#snippet ticker()}<Ticker id="stats" label="Your inventory's value, live" items={tape} />{/snippet}
  <PageHead help={{ band: "stats.band", hero: "stats.ticker" }} hero={ticker} title="Stats" brief="Your trades, relic runs and account over time." blurb="Your account over time, what your relic runs come to, the parts you got, and every trade you've made in game.">
    {#snippet band()}
      <Stat label="Revenue" note="Sales in this span: the game's trade log and Sales" title="Revenue: platinum from sales in this span, from the game's trade log (the trade window MyOrbiter read), plus sales logged on Sales that no logged trade covers"><P v={revenue} big tick /></Stat>
      <Stat label="Spent" tone="dim" note="Platinum paid for items"><P v={spent} big tick /></Stat>
      <Stat label="Profit" tone={revenue - spent >= 0 ? "gold" : "dim"} note="Revenue minus spent"><P v={revenue - spent} big tick /></Stat>
      <Stat label="Trades" note={trades.length ? `with ${partners} player${partners === 1 ? "" : "s"}` : "No trades in this span"}><Count value={trades.length} /></Stat>
    {/snippet}
  </PageHead>

  <div class="bar"><Seg bind:value={span} label="Span" options={[{ v: "30", label: "30 days", title: "Figures, charts and trades from the last 30 days" }, { v: "90", label: "90 days", title: "Figures, charts and trades from the last 90 days" }, { v: "all", label: "All", title: "Everything MyOrbiter has logged" }]} /><HelpMark part="stats.span" /></div>

  <div title="Worked out as Inventory does, at each inventory read. Market value: every copy at the daily median. Quick-sale value: everything you hold of what trades daily, kept copies too, no more of each than the market sells in a month. The figures by the title are from the last read">
    <TimeChart single={hist.length === 1 ? "" : undefined} title={lastRead ? `Inventory value · at last read, ${new Date(lastRead).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Inventory value"} {at} series={[{ label: "Market value", color: "var(--chart-plat)", values: hist.map((p) => p.worth) }, { label: "Quick-sale value", color: GOLD, values: hist.map((p) => p.liquid) }]} height={190} />
  </div>

  {#if hist.length === 1}<p class="dim small one" title="Each chart's line starts with the next read; the figures beside each title are from this one">One inventory read so far. The charts start with the next.</p>{/if}
  {#snippet chart(c: (typeof CHARTS)[number])}
    <TimeChart single="" title={c.title} {at} series={[{ label: c.title, color: GOLD, values: hist.map(c.get) }]} empty={c.key === "credits" || c.key === "endo" || c.key === "platinum" ? "Needs the patched TennoScope; fills in from its next reads." : undefined}>
      {#snippet icon()}<GameIcon name={c.icon} size={18} />{/snippet}
    </TimeChart>
  {/snippet}
  <!-- Platinum, credits and Endo; the rest unfold under them. -->
  <div class="chartset">
    <div class="charts">{#each CHARTS.slice(0, 3) as c (c.key)}{@render chart(c)}{/each}</div>
    {#if allCharts}<div id="more-charts" transition:reveal><div><div class="charts rest">{#each CHARTS.slice(3) as c (c.key)}{@render chart(c)}{/each}</div></div></div>{/if}
  </div>
  {#if CHARTS.length > 3}<button class="link more" aria-expanded={allCharts} aria-controls="more-charts" onclick={() => (allCharts = !allCharts)} title="Ducats, Aya, Kuva, Void Traces, Vosfor and relics held over time">{allCharts ? "Fewer" : `${CHARTS.length - 3} more: ${CHARTS.slice(3).map((c) => c.title.toLowerCase()).join(", ")}`} <span class="chev" aria-hidden="true">▾</span></button>{/if}

  <RelicRuns {model} runs={settings.game.relicRuns} {since} platPerDucat={settings.advice.platPerDucat} />

  <section class="got">
    <div class="hh">
      <h2 class="register" title="Parts that turned up in your inventory between two reads, from relics, missions or anything else; what a trade brought in is left out">Parts you got<HelpMark part="stats.parts-you-got" /></h2>
      {#if got.length}<span class="small dim">{gotCount} part{gotCount === 1 ? "" : "s"} · <P v={Math.round(gotWorth)} /> at today's prices</span>{/if}
    </div>
    {#if got.length}
      <ul class="gotl">
        {#each got.slice(0, 60) as g (g.name)}
          <li use:info={g.name}><Thumb file={model.imageOf(g.name)} name={g.name} size={26} /><span class="gn">{g.name}</span><b class="gq">×{g.n}</b><P v={g.each} dim /></li>
        {/each}
      </ul>
      {#if got.length > 60}<p class="dim small">The 60 you got most of, of {got.length}.</p>{/if}
    {:else}
      <p class="dim small">{settings.game.drops.at ? "Nothing new between inventory reads in this span yet." : "Counted from your next inventory reads: each one is compared with the one before."} Prime parts and the parts of other gear count, from relics, missions or anything else; what a trade brought in doesn't.</p>
    {/if}
  </section>

  <div class="split">
    <section class="types">
      <div class="hh"><h2 class="register" title="Revenue and spent by what was traded, from the game's trade log (plus sales on Sales that no logged trade covers)">Profit by type<HelpMark part="stats.profit-by-type" /></h2><span class="dim small">from the game's trade log and Sales</span></div>
      {#if byType.length}
        <table>
          <thead><tr><th>Type</th><th class="right">Revenue</th><th class="right">Spent</th><th class="right">Profit</th></tr></thead>
          <tbody>
            {#each byType as r (r.group)}
              <tr><td><span class="ty"><GameIcon name={ICON[r.group]} size={18} />{r.group}</span></td><td class="right"><P v={r.revenue || null} /></td><td class="right"><P v={r.spent || null} dim /></td><td class="right"><span class:pos={r.profit > 0} class:neg={r.profit < 0}>{r.profit > 0 ? "+" : ""}{whole.format(r.profit)}</span></td></tr>
            {/each}
          </tbody>
        </table>
      {:else}<p class="dim small">No sales or purchases in this span yet.</p>{/if}
    </section>

    <section class="history">
      <div class="hh">
        <h2 class="register">Trade history<HelpMark part="stats.trade-history" /></h2>
        {#if settings.market.trades.length}<ProgressButton variant="icon" icon="export" tone="quiet" job={exportJob} label="Export trades as CSV" doneLabel="Saved" failLabel="Couldn't save" title="Save every trade MyOrbiter read from the game as a CSV file in your Downloads folder, for a spreadsheet" onclick={exportTrades} />{/if}
        {#if exported}<span class="small" class:dim={exportJob.state !== "failed"} class:bad={exportJob.state === "failed"} role="status">{exported}</span>{/if}
        <Seg bind:value={show} label="Which trades" options={[{ v: "all", label: "All", title: "Every trade" }, { v: "sale", label: "Sales", title: "Trades where you gave items and got only platinum" }, { v: "purchase", label: "Purchases", title: "Trades where you gave only platinum for items" }, { v: "trade", label: "Swaps", title: "Everything else: items for items, items and platinum both ways, gifts" }]} />
      </div>
      {#if shown.length}
        <ul>
          {#each shown.slice(0, 150) as t (t.key)}
            {@const k = kindOf(t)}
            <li>
              <div class="who"><b class="name-mark">{t.partner}</b><span class="dim small">{when(t.at)}</span></div>
              <div class="swap" title="What you gave ⇄ what you got">{@render items(t.offered, t.platOut)}<span class="arrow" aria-label="for">⇄</span>{@render items(t.received, t.platIn)}</div>
              <span class="kind k-{k}">{k === "sale" ? "Sale" : k === "purchase" ? "Purchase" : "Swap"}</span>
              <RepButton partner={t.partner} text={settings.market.repText} given={repGiven.has(t.partner.toLowerCase())} ongiven={() => (settings.market.rep = { ...settings.market.rep, [t.key]: "given" })} />
            </li>
          {/each}
        </ul>
        {#if shown.length > 150}<p class="dim small">Showing the latest 150 of {shown.length}.</p>{/if}
      {:else if settings.market.trades.length}
        <!-- Trades are logged, just none in this span or of this kind: say so, and how to see them. -->
        <p class="dim small">No {show === "sale" ? "sales" : show === "purchase" ? "purchases" : show === "trade" ? "swaps" : "trades"} {span === "all" ? "logged yet" : `in the last ${span} days`}. <button type="button" class="link" title="Every trade MyOrbiter has logged (the figures and charts above go to All too)" onclick={() => ((show = "all"), (span = "all"))}>Show all {settings.market.trades.length}</button></p>
      {:else}
        <p class="dim small">Trades show up here as you make them: MyOrbiter reads each one from Warframe's log when the trade window closes.</p>
      {/if}
    </section>
  </div>
</div></div>

<style>
  .bad { color: var(--oxblood); }
  .one { margin: .4rem 0 0; }
  .got { margin: 0 0 var(--course); }
  .gotl { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(17rem, 100%), 1fr)); gap: .35rem 1.2rem; }
  .gotl li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: .5rem; align-items: center; min-width: 0; }
  .gn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: .88rem; }
  .gq { font-family: var(--face-mark); color: var(--gold); }
  .nm { color: var(--platinum-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 14rem; }
  .bar { margin-top: .2rem; }
  .chartset { margin: .8rem 0 var(--course); }
  .charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(19rem, 100%), 1fr)); gap: .8rem; }
  .charts.rest { padding-top: .8rem; }
  .split { display: grid; grid-template-columns: minmax(18rem, 2fr) minmax(0, 3fr); gap: 1.6rem; align-items: start; }
  /* Page area under 950 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt950"]) .split { grid-template-columns: 1fr; }
  h2 { margin: 0 0 .8rem; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: .45rem .5rem; border-bottom: 1px solid var(--rule); }
  td { padding: var(--row-pad) .5rem; border-bottom: 1px solid var(--rule); }
  .right { text-align: right; }
  .ty { display: inline-flex; align-items: center; gap: .5rem; }
  .pos { color: var(--verdigris); font-weight: 600; }
  .neg { color: var(--oxblood); font-weight: 600; }
  /* Both headings sit on the same line, whether or not a filter stands beside them. */
  .hh { display: flex; justify-content: space-between; align-items: center; gap: 1rem; min-height: 2rem; margin-bottom: .8rem; }
  .hh h2 { margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
  li { display: grid; grid-template-columns: minmax(9rem, 12rem) 1fr auto auto; gap: .8rem; align-items: center; padding: .6rem .8rem; border: 1px solid var(--rule); background: var(--plate); clip-path: var(--cut); }
  .who { display: grid; gap: .15rem; min-width: 0; }
  .who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; }
  .swap { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; min-width: 0; }
  .arrow { color: var(--platinum-deep); }
  .its { display: inline-flex; align-items: center; gap: .3rem; flex-wrap: wrap; }
  .it { position: relative; display: inline-flex; align-items: center; gap: .25rem; }
  .it b { position: absolute; right: -4px; bottom: -4px; font-size: .72rem; font-family: var(--face-register); background: var(--slab); border: 1px solid var(--rule-bright); padding: 0 3px; line-height: 1.3; }
  .it.plat b { position: static; font-family: var(--face-mark); font-size: 1rem; background: none; border: 0; padding: 0; }
  .kind { font-family: var(--face-register); font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; padding: .2rem .45rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); }
  .k-sale { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 45%, transparent); }
  .k-purchase { color: var(--gold); border-color: var(--gold-dim); }
  .more { display: block; margin: .4rem 0 1.4rem; }
</style>
