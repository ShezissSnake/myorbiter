<script lang="ts">
  import Fold from "../ui/Fold.svelte";
  import { takeIntent } from "../intent.svelte";
  import { daysToTrade } from "../core/tradeLimit";
  import { sellableCopies } from "../core/spares";
  import type { Model } from "../core/model";
  import { modRows, modSpares, type ModRow } from "../core/views";
  import UpgradeDetail from "../ui/UpgradeDetail.svelte";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import ModCard from "../ui/ModCard.svelte";
  import { mkt } from "../marketStore.svelte";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import Chip from "../ui/Chip.svelte";
  import Seg from "../ui/Seg.svelte";
  import Stat from "../ui/Stat.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import { matches, type Column } from "../ui/table";
  import ListButton from "../ui/ListButton.svelte";

  let { model, masteryRank = null }: { model: Model; masteryRank?: number | null } = $props();

  let query = $state("");
  let dupesOnly = $state(true);
  let tradableOnly = $state(true);
  // Common mods at 2–5p rarely move: by default only the ones that trade at least daily.
  let sellingOnly = $state(true);
  // Ctrl+K asked for one mod: every mod, searched for it.
  $effect(() => {
    const want = takeIntent("mods");
    if (!want?.q) return;
    query = want.q;
    dupesOnly = false;
    sellingOnly = false;
    tradableOnly = false;
    rarity = "all";
  });
  let rarity = $state("all");
  let sort = $state({ key: "value", desc: true });

  const all = $derived(modRows(model));
  const rows = $derived(
    all.filter(
      (r) =>
        (!dupesOnly || r.extras > 0) &&
        (!tradableOnly || r.tradable) &&
        (!sellingOnly || (r.tradesPerDay ?? 0) >= 1) &&
        (rarity === "all" || r.rarity === rarity) &&
        matches(query, r.name, r.type),
    ),
  );
  const extras = $derived(rows.reduce((n, r) => n + r.extras, 0));
  /** Extras are your lowest-ranked copies: list those, never the one you keep. */
  const listReq = (r: ModRow) => {
    const lowest = modSpares(r.ranks).at(-1);
    return { unique: r.unique, rank: r.maxRank != null ? (lowest?.rank ?? 0) : null, quantity: lowest?.count ?? 0 };
  };
  // At most what the market takes in a month (sellableCopies): 393 spare Pressure Points don't all sell.
  /** A mod's spares at its price, but no more copies than the market takes in a month (531 Thumpers don't sell). */
  const worth = (r: ModRow) => (r.extrasValue == null ? null : (r.extrasValue / Math.max(1, r.extras)) * sellableCopies(r.extras, r.tradesPerDay));
  const value = $derived(rows.reduce((n, r) => n + (worth(r) ?? 0), 0));
  /** Days of trades every spare copy takes at your rank (core/tradeLimit.ts). */
  const tradeDays = $derived(masteryRank != null && masteryRank >= 2 ? daysToTrade(extras, masteryRank) : null);


  const columns: Column<ModRow>[] = [
    { key: "name", label: "Mod", value: (r) => r.name, cell: nameCell, defaultDesc: false, width: "26rem" },
    { key: "rarity", minor: true, label: "Rarity", value: (r) => r.rarity || null, muted: true, defaultDesc: false },
    { key: "total", label: "Have", value: (r) => r.total, align: "right" },
    { key: "ranks", minor: true, label: "Ranked copies", value: (r) => r.ranks.filter((x) => x.rank > 0).map((x) => `R${x.rank}${x.count > 1 ? `×${x.count}` : ""}`).join(" ") || null, muted: true, sortable: false },
    { key: "price", label: "Price", value: (r) => r.price, align: "right", cell: priceCell },
    { key: "value", label: "Spares worth", value: (r) => worth(r), align: "right", cell: valueCell, title: "Your spare copies at the daily median, counting no more copies than warframe.market sells in a month" },
    { key: "priceMax", minor: true, label: "Maxed", value: (r) => r.priceMax, align: "right", cell: maxCell, title: "Price of a max-rank copy" },
    { key: "trades", label: "Trades/day", value: (r) => (r.tradesPerDay == null ? null : Math.round(r.tradesPerDay * 10) / 10), align: "right", muted: true, title: "How quickly it sells. Common mods at 2–5p rarely move." },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ];
</script>

{#snippet nameCell(r: ModRow)}<Named file={model.imageOf(r.name)} name={r.name}>{#if !r.tradable}<span class="tag">untradable</span>{/if}</Named>{/snippet}
{#snippet listCell(r: ModRow)}
  {#if r.tradable && r.extras > 0}<ListButton {model} name={r.name} req={listReq(r)} />{/if}
{/snippet}
{#snippet priceCell(r: ModRow)}<P v={r.price} dim />{/snippet}
{#snippet valueCell(r: ModRow)}<span title={worth(r) != null && worth(r)! < r.extrasValue! ? `All ${r.extras} would be ${Math.round(r.extrasValue!)}p, but the market takes about ${sellableCopies(r.extras, r.tradesPerDay)} a month` : undefined}><P v={worth(r)} /></span>{/snippet}
{#snippet maxCell(r: ModRow)}<P v={r.priceMax} dim />{/snippet}
{#snippet modCard(r: ModRow, width: number)}
  {@const c = model.catalogByUnique.get(r.unique)}
  <ModCard name={r.name} image={model.imageOf(r.name)} rarity={r.rarity} polarity={c?.polarity ?? null} drain={c?.baseDrain ?? null} maxRank={r.maxRank} rank={r.ranks[0]?.rank ?? 0} label={c?.compatName ?? ""} does={c?.maxStats?.[0] ?? ""} {width} />
{/snippet}
{#snippet card(r: ModRow, open: () => void)}
  <!-- Gold edge: copies to spare. With "Spares only" on that's every card, so it only marks them when it's off. -->
  <ItemCard hover={r.name} title={r.name} sub={r.type} image={model.imageOf(r.name)} owned={!dupesOnly && r.extras > 0} onopen={open}>
    {#snippet art()}{@render modCard(r, 104)}{/snippet}
    <div class="have"><b class="mark qty">×{r.total}</b>{#if r.extras}<span class="dim small" title="Beyond your best copy and one to give away">{r.extras} spare</span>{/if}</div>
    <!-- Always there, empty when every copy is unranked, so cards side by side line up. -->
    <div class="ranks">{#each r.ranks.filter((x) => x.rank > 0) as x (x.rank)}<span class="rk">R{x.rank}{x.count > 1 ? ` ×${x.count}` : ""}</span>{/each}</div>
    <div class="prices">
      <span><span class="register">Each</span><P v={r.price} dim /></span>
      {#if r.extras}<span title="No more copies than the market takes in a month"><span class="register">Spares</span><P v={worth(r)} /></span>{/if}
    </div>
    {#snippet foot()}
      <span class="rar rar-{r.rarity}">{r.rarity}</span>
      {#if !r.tradable}<span class="tag flush">untradable</span>{:else if r.tradesPerDay != null}<span class="dim small" title="How many times a day it trades on warframe.market">{Math.round(r.tradesPerDay * 10) / 10} sold/day</span>{/if}
      <span class="grow"></span>
      {@render listCell(r)}
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet detail(r: ModRow)}
  <UpgradeDetail {model} name={r.name} unique={r.unique} ranks={r.ranks} tradable={r.tradable}>
    {#if r.extras > 0}<p class="small dim">{r.extras} spare, beyond your best copy and one to give away{#if r.tradable}&nbsp;· <ListButton {model} name={r.name} req={listReq(r)} label="List spares" />{/if}</p>{/if}
  </UpgradeDetail>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Mods" blurb="Mods you have spare copies of. Your best copy and one to give away are always kept.">
    {#snippet band()}
      <Stat label="Spare copies" note={tradeDays != null && tradeDays > 1 ? `Beyond your best copy and one to give away · ${tradeDays} days of trades to sell them all` : "Beyond your best copy and one to give away"} title={tradeDays != null ? `Beyond your best copy and one to give away. Trades a day are your Mastery Rank (${masteryRank}), up to 6 items each: selling every spare copy would take ${tradeDays} days of trading, at best` : null}>{extras.toLocaleString("en")}</Stat>
      <Stat label="Spares worth" tone="dim" note={sellingOnly ? "Mods that sell daily, no more of each than the market sells in a month" : "Slow sellers too, no more of each than the market sells in a month (as Inventory counts)"}><P v={value} big /></Stat>
    {/snippet}
  </PageHead>

  <div class="bar">
  <input type="search" placeholder="Filter mods…" bind:value={query} />
  <select bind:value={rarity} aria-label="Rarity" title="Only one rarity">
    <option value="all">All rarities</option>
    {#each ["Common", "Uncommon", "Rare", "Legendary"] as x (x)}<option value={x}>{x}</option>{/each}
  </select>
  <Chip bind:on={dupesOnly} label="Spare only" title="Three or more copies: more than your own and one to give away" />
  <Fold active={(tradableOnly ? 0 : 1) + (sellingOnly ? 0 : 1)} reset={() => { tradableOnly = true; sellingOnly = true; }}>
    <Chip bind:on={tradableOnly} label="Tradable" title="Only mods you can sell or trade (not Flawed ones, and the like)" />
    <Chip bind:on={sellingOnly} label="Sells daily" title="At least one trade a day on warframe.market" />
  </Fold>
  </div>

  <Browse id="mods" {rows} {columns} key={(r) => r.unique} bind:sort {detail} {card} title={(r) => r.name} min="18rem" />
</div></div>

<style>
  .flush { margin-left: 0; }
  .have { display: flex; align-items: baseline; gap: .5rem; }
  .qty { font-size: 1.45rem; }
  .ranks { display: flex; flex-wrap: wrap; gap: .3rem; min-height: 1.15rem; }
  .rk { font-family: var(--face-register); font-size: .6rem; letter-spacing: .06em; padding: .1rem .35rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); }
  .prices { display: flex; gap: 1rem; }
  .prices > span { display: grid; gap: .15rem; }
  .prices .register { font-size: .6rem; }
  .rar { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-dim); }
  .rar-Common { color: #b08a63; }
  .rar-Rare { color: var(--gold); }
  .rar-Legendary { color: var(--platinum); }
  .grow { flex: 1; }
</style>
