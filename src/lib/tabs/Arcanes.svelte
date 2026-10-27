<script lang="ts">
  import type { Model } from "../core/model";
  import { arcaneRows, type ArcaneRow } from "../core/views";
  import type { Tier } from "../backend";
  import { marketUrl, openUrl, wikiUrl } from "../backend";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import { mkt } from "../marketStore.svelte";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import Seg from "../ui/Seg.svelte";
  import Stat from "../ui/Stat.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import { matches, type Column } from "../ui/table";
  import ListButton from "../ui/ListButton.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import type { AdviceSettings } from "../backend";
  import { packValues, spareArcanes, vosforHeld, vosforWorth, type SpareArcane } from "../core/vosfor";
  import { info } from "../hover.svelte";

  let { model, tiers = $bindable(), advice = $bindable() }: { model: Model; tiers: Record<string, Tier>; advice: AdviceSettings } = $props();

  const TIERS: Tier[] = ["S", "A", "B", "C", "D"];
  const tierOrder = (r: ArcaneRow) => {
    const t = tiers[r.name];
    return t ? TIERS.indexOf(t) : 9;
  };

  let query = $state("");
  /** Unfinished: still collecting. Spares: copies beyond the one you keep, to sell or dissolve. */
  let show = $state<"unfinished" | "spares" | "all">("unfinished");
  let owned = $state<"all" | "owned" | "unowned">("all");
  let type = $state("all");
  let sort = $state({ key: "priceMax", desc: true });

  const all = $derived(arcaneRows(model));
  const types = $derived([...new Set(all.map((r) => r.type))].sort());
  const rows = $derived(
    all.filter(
      (r) =>
        (show === "all" || !r.complete) &&
        (owned === "all" || (owned === "owned") === r.copies > 0) &&
        (type === "all" || r.type === type) &&
        matches(query, r.name, r.type),
    ),
  );
  const completeCount = $derived(all.filter((r) => r.complete).length);
  /** Loose unranked copies you can sell without touching the one you max. */
  const looseSpare = (r: ArcaneRow) => Math.min(r.unranked, r.spare);

  // ---------------------------------------------------------------- sell or dissolve
  const lens = $derived(advice.vosforLens ?? "need");
  const packs = $derived(packValues(model, all));
  const worth = $derived(vosforWorth(packs, lens));
  const spares = $derived(spareArcanes(model, all, worth.perVosfor, { lens, minPrice: advice.minPlat }));
  const spareRows = $derived(spares.filter((x) => matches(query, x.row.name, x.row.type) && (type === "all" || x.row.type === type)));
  const toSell = $derived(spares.filter((x) => x.verdict === "sell"));
  const toDissolve = $derived(spares.filter((x) => x.verdict === "dissolve"));
  const held = $derived(vosforHeld(model));
  const gain = $derived(toDissolve.reduce((n, x) => n + (x.vosfor ?? 0), 0));
  const rankedPacks = $derived([...packs].sort((a, b) => (lens === "need" ? b.needPlat - a.needPlat || b.needCopies - a.needCopies : b.plat - a.plat)));
  const short = (pack: string) => pack.replace(/ Arcane Collection$/, "");
  /** The usual reasons go without saying on every row; the hover still has them. */
  const PLAIN = new Set(["Sells for more than its Vosfor is worth", "Worth more as packs toward arcanes you're collecting", "Worth more as Vosfor packs"]);
  let spareSort = $state({ key: "best", desc: true });
  const spareColumns: Column<SpareArcane>[] = [
    { key: "name", label: "Arcane", value: (x) => x.row.name, defaultDesc: false, cell: spareName },
    { key: "have", label: "Spare", value: (x) => x.maxed * 1000 + x.unranked, cell: spareHave, align: "right", title: "Maxed copies beyond the one you keep, and loose unranked copies" },
    { key: "sell", label: "Sell for", value: (x) => x.sellPlat, cell: sellCell, align: "right", title: "Maxed copies at the max-rank price, loose ones at the unranked price (daily median)" },
    { key: "vosfor", label: "Dissolve for", value: (x) => x.vosfor, cell: vosforCell, align: "right", title: "Vosfor from Loid's Arcane Dissolution, and what it's worth through the best pack" },
    { key: "best", label: "Best as", value: (x) => x.verdict, sortValue: (x) => (x.verdict === "sell" ? (x.sellPlat ?? 0) : (x.dissolvePlat ?? 0)), cell: verdictCell },
    { key: "trades", minor: true, label: "Trades/day", value: (x) => (x.row.tradesPerDay == null ? null : Math.round(x.row.tradesPerDay * 10) / 10), align: "right", muted: true },
    { key: "list", label: "", value: () => null, cell: spareList, sortable: false, align: "right" },
  ];

  /** Beside the copies bar on a card: how far along your best copy is, or what's beyond the one you keep. */
  const note = (r: ArcaneRow) => (r.complete ? (r.extraMaxed ? `+${r.extraMaxed} extra maxed` : "") : r.highestRank ? `best copy R${r.highestRank}` : "");

  function setTier(name: string, t: Tier | "") {
    const next = { ...tiers };
    if (t) next[name] = t;
    else delete next[name];
    tiers = next;
  }

  // Spare only has numbers for arcanes you've finished, so they show with those.
  const columns: Column<ArcaneRow>[] = $derived(([
    { key: "tier", label: "Tier", value: (r) => tiers[r.name] ?? null, sortValue: tierOrder, cell: tierCell, defaultDesc: false, width: "4.5rem" },
    { key: "name", label: "Arcane", value: (r) => r.name, defaultDesc: false, cell: nameCell },
    // All arcanes needs the room for Spare and List; the slot filter and the hover card still say it.
    ...(show === "all" ? [] : [{ key: "type", minor: true, label: "Slot", value: (r: ArcaneRow) => r.type, muted: true, defaultDesc: false }] as Column<ArcaneRow>[]),
    { key: "progress", label: "Collection", value: (r) => r.copies / r.needed, cell: progressCell, title: "Rank-0 copies you hold (fused ones counted at what they cost) out of what a maxed one needs" },
    { key: "price", minor: true, label: "R0 price", title: "Price of an unranked copy", value: (r) => r.price, align: "right", cell: priceCell },
    { key: "priceMax", label: "Max price", value: (r) => r.priceMax, align: "right", cell: maxCell },
    { key: "cost", label: "To finish", value: (r) => (r.complete ? null : r.costToFinish), align: "right", cell: costCell, defaultDesc: false, title: "Cheapest of buying the missing copies or one maxed copy" },
    ...(show !== "all" ? [] : [{ key: "spare", label: "Spare", value: (r: ArcaneRow) => r.extraMaxed * 1000 + looseSpare(r) || null, cell: rowSpare, align: "right", title: "Maxed copies beyond the one you keep, and loose unranked copies beyond what it needs" }] as Column<ArcaneRow>[]),
    { key: "trades", minor: true, label: "Trades/day", value: (r) => (r.tradesPerDay == null ? null : Math.round(r.tradesPerDay * 10) / 10), align: "right", muted: true, title: "Demand on warframe.market" },
    // Still collecting has nothing spare, so nothing to list.
    ...(show !== "all" ? [] : [{ key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" }] as Column<ArcaneRow>[]),
  ] as Column<ArcaneRow>[]));
</script>

{#snippet tierSelect(r: ArcaneRow)}
  <select class="tier t-{tiers[r.name] ?? 'none'}" value={tiers[r.name] ?? ""} onchange={(e) => setTier(r.name, e.currentTarget.value as Tier | "")} aria-label="Your tier for {r.name}">
    <option value="">–</option>
    {#each TIERS as t (t)}<option value={t}>{t}</option>{/each}
  </select>
{/snippet}
{#snippet tierCell(r: ArcaneRow)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <span onclick={(e) => e.stopPropagation()}>{@render tierSelect(r)}</span>
{/snippet}
{#snippet progressCell(r: ArcaneRow)}
  <div class="prog" title="{r.copies} / {r.needed}{r.highestRank != null ? ` · best copy R${r.highestRank}` : ''}">
    <div class="track"><div class="fill" class:done={r.complete} style:width="{Math.min(100, (r.copies / r.needed) * 100)}%"></div></div>
    <span class="dim small">{r.complete ? "maxed" : `${r.copies}/${r.needed}`}</span>
  </div>
{/snippet}
{#snippet listCell(r: ArcaneRow)}
  {#if r.tradable && r.extraMaxed > 0}
    <ListButton {model} name={r.name} label="List R{r.maxRank}" req={{ unique: r.unique, rank: r.maxRank, quantity: r.extraMaxed }} />
  {:else if r.tradable && looseSpare(r) > 0}
    <ListButton {model} name={r.name} req={{ unique: r.unique, rank: 0, quantity: looseSpare(r) }} />
  {/if}
{/snippet}
{#snippet nameCell(r: ArcaneRow)}<Named file={model.imageOf(r.name)} name={r.name} />{/snippet}
{#snippet priceCell(r: ArcaneRow)}<P v={r.price} dim />{/snippet}
{#snippet maxCell(r: ArcaneRow)}<P v={r.priceMax} />{/snippet}
{#snippet costCell(r: ArcaneRow)}{#if !r.complete}<P v={r.costToFinish} />{/if}{/snippet}
{#snippet spareName(x: SpareArcane)}<Named file={model.imageOf(x.row.name)} name={x.row.name} />{/snippet}
{#snippet rowSpare(r: ArcaneRow)}
  {#if r.extraMaxed || looseSpare(r)}<span class="have" title="{r.extraMaxed ? `${r.extraMaxed} maxed` : ''}{r.extraMaxed && looseSpare(r) ? ' and ' : ''}{looseSpare(r) ? `${looseSpare(r)} unranked` : ''} beyond the one you keep">{#if r.extraMaxed}<b>{r.extraMaxed}</b> <span class="dim small">R{r.maxRank}</span>{/if}{#if r.extraMaxed && looseSpare(r)}<span class="dim">&nbsp;·&nbsp;</span>{/if}{#if looseSpare(r)}<b>{looseSpare(r)}</b> <span class="dim small">R0</span>{/if}</span>{:else}<span class="nil" aria-label="none">–</span>{/if}
{/snippet}
{#snippet spareHave(x: SpareArcane)}
  <span class="have">{#if x.maxed}<b>{x.maxed}</b> <span class="dim small">maxed</span>{/if}{#if x.maxed && x.unranked}<span class="dim">&nbsp;·&nbsp;</span>{/if}{#if x.unranked}<b>{x.unranked}</b> <span class="dim small">unranked</span>{/if}</span>
{/snippet}
{#snippet sellCell(x: SpareArcane)}<P v={x.sellPlat} dim={x.verdict !== "sell"} />{/snippet}
{#snippet vosforCell(x: SpareArcane)}
  {#if x.vosfor == null}<span class="dim small">can't</span>
  {:else}<span class="vf" class:dim={x.verdict !== "dissolve"}><b>{x.vosfor.toLocaleString("en")}</b><GameIcon name="vosfor" size={14} /><span class="dim small">≈ {Math.round(x.dissolvePlat ?? 0)}p</span></span>{/if}
{/snippet}
{#snippet verdictCell(x: SpareArcane)}<span class="vc" title={x.why}><span class="verdict v-{x.verdict}">{x.verdict === "sell" ? "Sell" : "Dissolve"}</span>{#if !PLAIN.has(x.why)}<span class="why">{x.why}</span>{/if}</span>{/snippet}
{#snippet spareList(x: SpareArcane)}
  {#if x.verdict === "sell" && x.row.tradable && x.maxed > 0}
    <ListButton {model} name={x.row.name} label="List R{x.row.maxRank}" req={{ unique: x.row.unique, rank: x.row.maxRank, quantity: x.maxed }} />
  {:else if x.verdict === "sell" && x.row.tradable && x.unranked > 0}
    <ListButton {model} name={x.row.name} req={{ unique: x.row.unique, rank: 0, quantity: x.unranked }} />
  {/if}
{/snippet}

{#snippet card(r: ArcaneRow, open: () => void)}
  <ItemCard hover={r.name} title={r.name} sub={r.type} image={model.imageOf(r.name)} artSize={84} owned={r.complete} onopen={open}>
    <div class="coll">
      <div class="ch"><span class="register">Copies</span>{#if note(r)}<span class="register note">{note(r)}</span>{/if}</div>
      {@render progressCell(r)}
    </div>
    <div class="prices">
      <span><span class="register">R0</span><P v={r.price} dim /></span>
      <span><span class="register">R{r.maxRank}</span><P v={r.priceMax} /></span>
      {#if !r.complete && r.costToFinish != null}<span title="Cheapest of buying the missing copies or one maxed copy"><span class="register">To finish</span><P v={r.costToFinish} /></span>{/if}
    </div>
    {#snippet foot()}
      <label class="tierpick" title="Your own ranking. Sort by it in List."><span class="register">Tier</span>{@render tierSelect(r)}</label>
      {#if r.tradesPerDay != null}<span class="dim small">{Math.round(r.tradesPerDay * 10) / 10}/day</span>{/if}
      <span class="grow"></span>
      {@render listCell(r)}
    {/snippet}
  </ItemCard>
{/snippet}
{#snippet spareCard(x: SpareArcane, open: () => void)}
  <ItemCard hover={x.row.name} title={x.row.name} sub={x.row.type} image={model.imageOf(x.row.name)} artSize={84} owned={x.verdict === "sell"}>
    {@render spareHave(x)}
    <div class="choice">
      <span class:win={x.verdict === "sell"}><span class="register">Sell</span>{@render sellCell(x)}</span>
      <span class:win={x.verdict === "dissolve"}><span class="register">Dissolve</span>{@render vosforCell(x)}</span>
    </div>
    {#if !PLAIN.has(x.why)}<p class="why small">{x.why}</p>{/if}
    {#snippet foot()}
      <span class="verdict v-{x.verdict}" title={x.why}>{x.verdict === "sell" ? "Sell" : "Dissolve at Loid"}</span>
      <span class="grow"></span>
      {@render spareList(x)}
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet detail(r: ArcaneRow)}
  <p class="small">Max rank {r.maxRank}{r.highestRank != null ? ` · your best copy is R${r.highestRank}` : " · you have none"}{r.maxedCopies ? ` · ${r.maxedCopies} maxed` : ""}{r.unranked ? ` · ${r.unranked} unranked` : ""}{r.rarity ? ` · ${r.rarity}` : ""}</p>
  <div class="links">
    <button class="link" onclick={() => openUrl(wikiUrl(r.name))}>Wiki ↗</button>
    {#if r.tradable && r.extraMaxed > 0 && looseSpare(r) > 0}<button class="stamp" onclick={(e) => { e.stopPropagation(); mkt.startListing(model, r.name, { unique: r.unique, rank: 0, quantity: looseSpare(r) }); }}>List {looseSpare(r)} unranked</button>{/if}
    {#if r.tradable}<button class="link" onclick={() => openUrl(marketUrl(r.name))}>warframe.market ↗</button>{/if}
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Arcanes" blurb="What each arcane is worth, and how close you are to maxing it.">
    {#snippet band()}
      <Stat label="Maxed" note="Arcanes you have at max rank">{completeCount}<span class="of">/{all.length}</span></Stat>
      <Stat label="Spares to sell" note={`${toSell.length} arcanes worth more sold`}><P v={toSell.reduce((n, x) => n + (x.sellPlat ?? 0), 0)} big /></Stat>
      <Stat label="Vosfor held" note={gain ? `+${gain.toLocaleString("en")} from the ${toDissolve.length} marked Dissolve` : "Nothing marked Dissolve"}><GameIcon name="vosfor" size={30} />{held.toLocaleString("en")}</Stat>
    {/snippet}
  </PageHead>

  <div class="bar">
  <Seg bind:value={show} options={[
    { v: "unfinished", label: "Still collecting", title: "Arcanes you haven't maxed (or got enough copies to max)" },
    { v: "spares", label: "Sell or dissolve", title: "Copies beyond the one you keep: sell them, or dissolve them for Vosfor" },
    { v: "all", label: "All arcanes" },
  ]} />
  {#if show !== "spares"}<Seg bind:value={owned} options={[{ v: "all", label: "All" }, { v: "owned", label: "Started" }, { v: "unowned", label: "None yet" }]} />{/if}
  <select bind:value={type} aria-label="Slot">
    <option value="all">All slots</option>
    {#each types as t (t)}<option value={t}>{t}</option>{/each}
  </select>
  <input type="search" placeholder="Filter arcanes…" bind:value={query} />
  </div>

  {#if show === "spares"}
    <section class="vosfor">
      <header>
        <span class="register"><GameIcon name="vosfor" size={18} /> Loid's arcane packs · 200 Vosfor each</span>
        <Seg label="Value Vosfor by" bind:value={advice.vosforLens} options={[
          { v: "need", label: "Arcanes I'm collecting", title: "A pack is worth the arcanes in it you haven't finished, at what buying those copies would cost" },
          { v: "market", label: "Market price", title: "A pack is worth all three arcanes at their unranked market price" },
        ]} />
      </header>
      <p class="small dim">You hold <b>{held.toLocaleString("en")}</b> Vosfor{gain ? `, ${(held + gain).toLocaleString("en")} after dissolving what's marked Dissolve` : ""}: {Math.floor((held + gain) / 200)} pack{Math.floor((held + gain) / 200) === 1 ? "" : "s"}. Best pack {lens === "need" ? "for what you're collecting" : "by market value"}: <b>{worth.best ? short(worth.best.name) : "none"}</b>, about {worth.perVosfor ? (worth.perVosfor * 200).toFixed(0) : 0}p a pack.</p>
      <p class="small dim" title="The wiki lists Vosfor per unranked arcane and doesn't say how rank changes it">A ranked copy is counted as the copies it's made of (a maxed one is 21, or 10 for arcanes that max at R3). Loid shows the exact Vosfor before you confirm a dissolution.</p>
      <div class="packs">
        {#each rankedPacks as p (p.name)}
          <div class="pack" class:best={p === worth.best}>
            <div class="ph"><b class="mark">{short(p.name)}</b>{#if lens === "market"}<span class="dim small" title="All three arcanes at their unranked market price">≈ {Math.round(p.plat)}p / pack</span>{:else if p.needCopies}<span class="dim small" title="On average {p.needCopies.toFixed(1)} of a pack's three arcanes are ones you're still collecting, worth what buying those copies would cost">{p.needPlat < 0.5 ? "under 1p" : `≈ ${Math.round(p.needPlat)}p`} / pack</span>{/if}</div>
            {#if p.wanted.length}
              <div class="wanted">{#each p.wanted.slice(0, 4) as w (w.name)}<span use:info={w.name}><Thumb file={model.imageOf(w.name)} size={18} />{w.name}</span>{/each}{#if p.wanted.length > 4}<span class="dim small" title={p.wanted.slice(4).map((w) => w.name).join(", ")}>+{p.wanted.length - 4}</span>{/if}</div>
            {:else}<span class="dim small">Nothing you still need</span>{/if}
          </div>
        {/each}
      </div>
    </section>
    <Browse id="arcane-spares" rows={spareRows} columns={spareColumns} key={(x) => x.row.unique} bind:sort={spareSort} card={spareCard} min="18rem" empty="No spare arcanes: you keep one of each and have nothing extra." />
  {:else}
    <Browse id="arcanes" {rows} {columns} key={(r) => r.unique} bind:sort {detail} {card} title={(r) => r.name} min="18rem" />
  {/if}
</div></div>

<style>
  .have { white-space: nowrap; }
  .have b { font-family: var(--face-mark); font-size: 1rem; }
  .coll { display: grid; gap: .3rem; }
  .ch { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
  .ch .register { font-size: .6rem; }
  .ch .note { color: var(--platinum-dim); }
  .tierpick { display: inline-flex; align-items: center; gap: .45rem; cursor: pointer; }
  .tierpick .register { font-size: .6rem; }
  .prices, .choice { display: flex; gap: 1rem; flex-wrap: wrap; }
  .prices > span, .choice > span { display: grid; gap: .15rem; }
  .prices .register, .choice .register { font-size: .6rem; }
  .choice > span { padding: .3rem .5rem; border: 1px solid var(--rule); }
  .choice > span.win { border-color: var(--gold-dim); }
  .grow { flex: 1; }
  .vf { display: inline-flex; align-items: center; gap: .3rem; white-space: nowrap; }
  .vf b { font-family: var(--face-mark); font-size: .98rem; color: var(--platinum); }
  .vf.dim b { color: var(--platinum-dim); }
  .vc { display: grid; justify-items: start; gap: .15rem; }
  .verdict { display: inline-block; padding: .18rem .5rem; font-family: var(--face-register); font-size: .6rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; border: 1px solid currentColor; }
  .v-sell { color: var(--platinum); }
  .v-dissolve { color: var(--verdigris); }
  .why { font-size: .74rem; color: var(--platinum-deep); }
  .vosfor { border: 1px solid var(--rule); background: rgb(17 19 23 / 70%); padding: 1rem 1.2rem; margin-bottom: var(--step); display: grid; gap: .7rem; }
  .vosfor header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .vosfor header .register { display: inline-flex; align-items: center; gap: .5rem; color: var(--platinum); }
  .vosfor p { margin: 0; }
  .vosfor p b { color: var(--platinum); font-weight: 600; }
  .packs { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: .5rem; }
  .pack { border: 1px solid var(--rule); padding: .55rem .7rem; display: grid; gap: .45rem; align-content: start; background: var(--well); }
  .pack.best { border-color: var(--verdigris); box-shadow: inset 3px 0 0 var(--verdigris); }
  .ph { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
  .ph b { font-size: 1rem; }
  .wanted { display: flex; flex-wrap: wrap; gap: .25rem .7rem; font-size: .78rem; color: var(--platinum-dim); }
  .wanted span { display: inline-flex; align-items: center; gap: .3rem; cursor: default; }
  .wanted span:hover { color: var(--platinum); }
  .prog { display: flex; align-items: center; gap: 0.5rem; min-width: 9rem; }
  .prog .small { min-width: 2.6rem; text-align: right; font-variant-numeric: tabular-nums; }
  .track { flex: 1; height: 6px; background: var(--rule); border-radius: 0; overflow: hidden; }
  .fill { height: 100%; background: var(--platinum); }
  .fill.done { background: var(--platinum); }
  /* A small picker: a dash and the chevron until you set one, then the letter in its colour. */
  .tier { width: 3.3rem; padding: .12rem 1.2rem .12rem .5rem; background-position: right .45rem center; font-family: var(--face-mark); font-size: .92rem; font-weight: 700; letter-spacing: 0; line-height: 1.2; color: var(--platinum-deep); }
  .tier:not(.t-none) { border-color: color-mix(in srgb, currentColor 55%, transparent); }
  .tier:hover, .tier:focus-visible { border-color: var(--rule-control); }
  .tier:not(.t-none):hover { border-color: currentColor; }
  .t-S, .t-S:hover { color: #ff7a7a; } .t-A, .t-A:hover { color: #ffb36b; } .t-B, .t-B:hover { color: #f3dc6b; } .t-C, .t-C:hover { color: #8fd18f; } .t-D, .t-D:hover { color: #8fb8e6; }
  .links { display: flex; gap: 1rem; }
  .nil { color: var(--rule-control); opacity: .7; }
</style>
