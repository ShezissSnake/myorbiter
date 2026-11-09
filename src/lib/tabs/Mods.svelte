<script lang="ts">
  import Count from "../ui/Count.svelte";
  import PTick from "../ui/PTick.svelte";
  import Fold from "../ui/Fold.svelte";
  import { takeIntent } from "../intent.svelte";
  import { daysToTrade } from "../core/tradeLimit";
  import { sellableCopies } from "../core/spares";
  import { modsWorthSelling, worthTotal } from "../core/worthSelling";
  import { worthATrade } from "../core/advice";
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
  import Showcase, { type Exhibit } from "../ui/Showcase.svelte";
  import { pickShowcase } from "../core/showcase";
  import { whileShown } from "../pane.svelte";
  import { typed } from "../typed.svelte";

  let { model, masteryRank = null, minPlat = 5 }: { model: Model; masteryRank?: number | null; minPlat?: number } = $props();

  let query = $state("");

  /** What the list is filtered on: the box, a moment later while you type (typed.svelte.ts). */

  const q = $derived.by(typed(() => query));
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

  const all = $derived.by(whileShown("mods", () => modRows(model)));
  const rows = $derived(
    all.filter(
      (r) =>
        (!dupesOnly || r.extras > 0) &&
        (!tradableOnly || r.tradable) &&
        (!sellingOnly || (r.tradesPerDay ?? 0) >= 1) &&
        (rarity === "all" || r.rarity === rarity) &&
        matches(q, r.name, r.type),
    ),
  );
  const filtered = $derived(!!q.trim() || rarity !== "all" || !dupesOnly || !tradableOnly || !sellingOnly);
  /** What the folded filters keep to, both on to start ("tradable", "sold daily"). */
  const keepsTo = $derived([tradableOnly ? "tradable" : "", sellingOnly ? "sold daily" : ""].filter(Boolean));
  /**
   * The mods Tradable and Sold daily hide from what the other filters show. Being on to start, they
   * don't count in `filtered` (Clear puts them back on), so the list says what they hide, as Browse
   * market does for Sold weekly, and an empty list doesn't claim there are no spare copies at all.
   */
  const foldHidden = $derived(keepsTo.length ? all.filter((r) => (!dupesOnly || r.extras > 0) && (rarity === "all" || r.rarity === rarity) && matches(q, r.name, r.type)).length - rows.length : 0);
  function clear() {
    query = "";
    rarity = "all";
    dupesOnly = tradableOnly = sellingOnly = true;
  }
  const extras = $derived(rows.reduce((n, r) => n + r.extras, 0));
  /** Extras are your lowest-ranked copies: list those, never the one you keep. */
  const listReq = (r: ModRow) => {
    const lowest = modSpares(r).at(-1);
    return { unique: r.unique, rank: r.maxRank != null ? (lowest?.rank ?? 0) : null, quantity: lowest?.count ?? 0 };
  };
  // At most what the market takes in a month (sellableCopies): 393 spare Pressure Points don't all sell.
  /** A mod's spares at its price, but no more copies than the market takes in a month (531 Thumpers don't sell). */
  const worth = (r: ModRow) => (r.extrasValue == null ? null : (r.extrasValue / Math.max(1, r.extras)) * sellableCopies(r.extras, r.tradesPerDay));
  /** Each spare copy's price, and whether selling them is worth a trade ("Not worth a trade under Np", set on Prime parts, judged on up to six copies a trade). */
  const each = (r: ModRow) => (r.extrasValue == null ? null : r.extrasValue / Math.max(1, r.extras));
  const tradeWorthy = (r: ModRow) => worthATrade(each(r), r.extras, minPlat);
  /**
   * Worth selling, counted as Prime parts, Arcanes and Home's Ready to list count it
   * (core/worthSelling.ts): every mod's spares, whatever the filters show.
   */
  const value = $derived.by(whileShown("mods", () => worthTotal(modsWorthSelling(all, minPlat))));
  // The showcase: the five mods worth most in Worth selling, as their cards; with none to sell, the
  // dearest mods you hold (at max rank where it's priced).
  let opened = $state<ModRow | null>(null);
  const sellingBy = $derived.by(whileShown("mods", () => new Map(modsWorthSelling(all, minPlat).map((x) => [x.name, x]))));
  const shelf = $derived(pickShowcase(all, { spare: (r) => sellingBy.get(r.name)?.plat, held: (r) => (r.total > 0 ? (r.priceMax ?? r.price) : null), name: (r) => r.name, key: (r) => r.unique }));
  const exhibits = $derived(
    shelf.items.map(({ row: r, value }): Exhibit => {
      const c = model.catalogByUnique.get(r.unique);
      const w = sellingBy.get(r.name);
      return {
        key: r.unique,
        name: r.name,
        sub: w ? `×${w.copies.toLocaleString("en")} spare` : `×${r.total} held · ${r.priceMax != null ? "maxed, each" : "each"}`,
        value: Math.round(value),
        title: w ? `${r.name}: ${w.copies} spare at about ${Math.round(w.each)}p, ${Math.round(value).toLocaleString("en")}p in all (no more than the market sells in a month: its part of Worth selling). Click for its details` : `${r.name}: ${Math.round(value)}p each${r.priceMax != null ? " maxed" : ""}, ${r.total} held. Click for its details`,
        open: () => (opened = r),
        image: model.imageOf(r.name),
        look: "mod",
        card: { rarity: r.rarity, polarity: c?.polarity ?? null, drain: c?.baseDrain ?? null, maxRank: r.maxRank, rank: r.ranks[0]?.rank ?? 0, label: c?.compatName ?? "", does: c?.maxStats?.[0] ?? "" },
      };
    }),
  );
  /** Days of trades every spare copy takes at your rank (core/tradeLimit.ts). */
  const tradeDays = $derived(masteryRank != null && masteryRank >= 2 ? daysToTrade(extras, masteryRank) : null);


  const columns: Column<ModRow>[] = [
    { key: "name", label: "Mod", value: (r) => r.name, cell: nameCell, defaultDesc: false, width: "26rem" },
    { key: "rarity", minor: true, label: "Rarity", value: (r) => r.rarity || null, muted: true, defaultDesc: false },
    { key: "total", label: "Have", value: (r) => r.total, align: "right" },
    { key: "ranks", minor: true, label: "Ranked copies", value: (r) => r.ranks.filter((x) => x.rank > 0).map((x) => `R${x.rank}${x.count > 1 ? `×${x.count}` : ""}`).join(" ") || null, muted: true, sortable: false },
    { key: "price", label: "Price", value: (r) => r.price, align: "right", cell: priceCell },
    { key: "value", label: "Spares sell for", value: (r) => (tradeWorthy(r) ? worth(r) : null), align: "right", cell: valueCell, title: "Your spare copies at the daily median, counting no more copies than warframe.market sells in a month. Worth selling adds these up for the mods that sell daily" },
    { key: "priceMax", minor: true, label: "Maxed", value: (r) => r.priceMax, align: "right", cell: maxCell, title: "Price of a max-rank copy" },
    { key: "trades", label: "Sold/day", value: (r) => (r.tradesPerDay == null ? null : Math.round(r.tradesPerDay * 10) / 10), align: "right", muted: true, title: "How quickly it sells. Common mods at 2–5p rarely move." },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ];
</script>

{#snippet nameCell(r: ModRow)}<Named file={model.imageOf(r.name)} name={r.name}>{#if !r.tradable}<span class="tag">untradable</span>{/if}</Named>{/snippet}
{#snippet listCell(r: ModRow, labelled = false)}
  {#if r.tradable && r.extras > 0}<ListButton {model} {labelled} name={r.name} req={listReq(r)} />{/if}
{/snippet}
{#snippet priceCell(r: ModRow)}<P v={r.price} dim />{/snippet}
{#snippet valueCell(r: ModRow)}{#if worth(r) != null && !tradeWorthy(r)}<span class="small dim" title="Not worth a trade under {minPlat}p (set on Prime parts): {Math.round(each(r)! * 10) / 10}p a copy, {Math.min(r.extras, 6)} in one trade at most. Left out of Worth selling">under {minPlat}p a trade</span>{:else}<span title={worth(r) != null && worth(r)! < r.extrasValue! ? `All ${r.extras} would be ${Math.round(r.extrasValue!)}p, but the market takes about ${sellableCopies(r.extras, r.tradesPerDay)} a month` : undefined}><P v={worth(r)} /></span>{/if}{/snippet}
{#snippet maxCell(r: ModRow)}<P v={r.priceMax} dim />{/snippet}
{#snippet modCard(r: ModRow, width: number)}
  {@const c = model.catalogByUnique.get(r.unique)}
  <ModCard name={r.name} image={model.imageOf(r.name)} rarity={r.rarity} polarity={c?.polarity ?? null} drain={c?.baseDrain ?? null} maxRank={r.maxRank} rank={r.ranks[0]?.rank ?? 0} label={c?.compatName ?? ""} does={c?.maxStats?.[0] ?? ""} {width} />
{/snippet}
{#snippet card(r: ModRow, open: () => void)}
  <!-- Gold edge: copies to spare. With "Spares only" on that's every card, so it only marks them when it's off. -->
  <ItemCard hover={r.name} title={r.name} sub={r.type} image={model.imageOf(r.name)} owned={!dupesOnly && r.extras > 0} ownedNote="{r.extras} spare to sell" onopen={open}>
    {#snippet art()}{@render modCard(r, 104)}{/snippet}
    <div class="have" data-card={r.keptFor ? "liches" : undefined}><b class="mark qty">×{r.total}</b>{#if r.extras}<span class="dim small" title={r.keptFor ?? "Beyond your best copy and one to give away"}>{r.extras} spare</span>{:else if r.keptFor}<span class="dim small" title={r.keptFor}>kept, for liches</span>{/if}</div>
    <!-- Always there, empty when every copy is unranked, so cards side by side line up. -->
    <div class="ranks">{#each r.ranks.filter((x) => x.rank > 0) as x (x.rank)}<span class="rk">R{x.rank}{x.count > 1 ? ` ×${x.count}` : ""}</span>{/each}</div>
    <div class="prices">
      <span><span class="register">Each</span><P v={r.price} dim /></span>
      {#if r.extras}{#if worth(r) != null && !tradeWorthy(r)}<span class="dim small" title="Not worth a trade under {minPlat}p (set on Prime parts): {Math.round(each(r)! * 10) / 10}p a copy, {Math.min(r.extras, 6)} in one trade at most"><span class="register">Spares</span> under {minPlat}p a trade</span>{:else}<span title="No more copies than the market takes in a month"><span class="register">Spares</span><P v={worth(r)} /></span>{/if}{/if}
    </div>
    {#snippet foot()}
      <span class="rar rar-{r.rarity}">{r.rarity}</span>
      {#if !r.tradable}<span class="tag flush">untradable</span>{:else if r.tradesPerDay != null}<span class="dim small" title="How many times a day it trades on warframe.market">{Math.round(r.tradesPerDay * 10) / 10} sold/day</span>{/if}
      <span class="grow"></span>
      {@render listCell(r, true)}
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet detail(r: ModRow)}
  <UpgradeDetail {model} name={r.name} unique={r.unique} ranks={r.ranks} tradable={r.tradable}>
    {#if r.keptFor}<p class="small dim">{r.keptFor}.</p>{/if}
    {#if r.extras > 0}<p class="small dim">{r.extras} spare, beyond your best copy and one to give away{#if r.tradable}&nbsp;· <ListButton {model} name={r.name} req={listReq(r)} label="Sell spares" />{/if}</p>{/if}
  </UpgradeDetail>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Mods" brief="Spare mod copies to sell." blurb="Mods you have spare copies of. Your best copy and one to give away are always kept.">
    {#snippet hero()}
      <Showcase items={exhibits} caption={shelf.mode === "held" ? "Nothing worth selling: your dearest mods" : "Your most valuable spare mods"} note={shelf.mode === "held" ? "Each, at the daily median · click one for its details" : "By Worth selling · click one for its details"} empty="No mods read yet: press Sync while Warframe is running, and your spares go on display here." />
    {/snippet}
    {#snippet band()}
      <Stat label="Spare copies" note={tradeDays != null && tradeDays > 1 ? `Beyond your best copy and one to give away · ${tradeDays} days of trades to sell them all` : "Beyond your best copy and one to give away"} title={tradeDays != null ? `Beyond your best copy and one to give away. Trades a day are your Mastery Rank (${masteryRank}), up to 6 items each: selling every spare copy would take ${tradeDays} days of trading, at best` : null}><Count value={extras} /></Stat>
      <Stat label="Worth selling" tone="dim" note={`Mods that sell daily, no more of each than the market sells in a month; only what's worth ${minPlat}p a trade`} title={`Worth selling: the spare copies of tradable mods that sell at least daily (as Sell spares lists them), at the daily median, no more of each than the market sells in a month, and only what's worth ${minPlat}p a trade. The filters don't change it. Counted the same way on Prime parts, Arcanes and Home; Inventory's Spare value adds slow sellers and small change`}><PTick v={value} /></Stat>
    {/snippet}
  </PageHead>

  <div class="bar">
  <input type="search" aria-label="Filter mods by name" title="Shows only what matches what you type" placeholder="Filter mods…" bind:value={query} />
  <select bind:value={rarity} aria-label="Rarity" title="Only one rarity">
    <option value="all">All rarities</option>
    {#each ["Common", "Uncommon", "Rare", "Legendary"] as x (x)}<option value={x}>{x}</option>{/each}
  </select>
  <Chip bind:on={dupesOnly} label="Spare only" title="Three or more copies: more than your own and one to give away" />
  <Fold on={keepsTo.join(", ")} active={(tradableOnly ? 0 : 1) + (sellingOnly ? 0 : 1)} reset={() => { tradableOnly = true; sellingOnly = true; }}>
    <Chip bind:on={tradableOnly} label="Tradable" title="Only mods you can sell or trade (not Flawed ones, and the like)" />
    <Chip bind:on={sellingOnly} label="Sold daily" title="Only mods that sell at least once a day on warframe.market" />
  </Fold>
  </div>

  <Browse id="mods" bind:opened {rows} {columns} key={(r) => r.unique} bind:sort {detail} {card} title={(r) => r.name} min="18rem" clear={filtered ? clear : null} empty={foldHidden ? "No spare copies of tradable mods that sell daily." : "No spare mod copies: your best copy and one to give away are kept."} />
  {#if foldHidden}<p class="dim small more">{foldHidden.toLocaleString("en")} more {foldHidden === 1 ? "mod isn't" : "mods aren't"} {keepsTo.join(" or ")} (More filters). <button class="link" onclick={() => { tradableOnly = false; sellingOnly = false; }}>Show them</button></p>{/if}
</div></div>

<style>
  .flush { margin-left: 0; }
  .have { display: flex; align-items: baseline; gap: .5rem; }
  .qty { font-size: 1.45rem; }
  .ranks { display: flex; flex-wrap: wrap; gap: .3rem; min-height: 1.15rem; }
  .rk { font-family: var(--face-register); font-size: .72rem; letter-spacing: .06em; padding: .1rem .35rem; border: 1px solid var(--rule-bright); color: var(--platinum-dim); }
  .prices { display: flex; gap: 1rem; }
  .prices > span { display: grid; gap: .15rem; }
  .prices .register { font-size: 11px; }
  .rar { font-family: var(--face-register); font-size: .72rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-dim); }
  .rar-Common { color: var(--rarity-common); }
  .rar-Uncommon { color: var(--rarity-uncommon); }
  .rar-Rare { color: var(--rarity-rare); }
  .rar-Legendary { color: var(--rarity-legendary); }
  .grow { flex: 1; }
  .more { text-align: center; }
</style>
