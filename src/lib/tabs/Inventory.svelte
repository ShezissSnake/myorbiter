<script lang="ts">
  // Everything you own, the way TennoScope's collection shows it: gear, parts, relics, mods,
  // arcanes, resources and blueprints, with what each is worth and a way to list it.
  import { splitRelicName, type Model } from "../core/model";
  import { info } from "../hover.svelte";
  import { inventoryRows, type InventoryItem, type InventoryKind } from "../core/views";
  import { spareRows, type SellChoices, type SpareRow } from "../core/spares";
  import { mkt } from "../marketStore.svelte";
  import { marketUrl, openUrl, wikiUrl } from "../backend";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import { details } from "../details.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Named from "../ui/Named.svelte";
  import P from "../ui/P.svelte";
  import Seg from "../ui/Seg.svelte";
  import Chip from "../ui/Chip.svelte";
  import ListButton from "../ui/ListButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import { matches, type Column } from "../ui/table";

  let { model, sell, platPerDucat = 0 }: { model: Model; sell: SellChoices; platPerDucat?: number } = $props();

  let kind = $state<"all" | InventoryKind>("all");
  let tradableOnly = $state(false);
  let sellingOnly = $state(false);
  let spareOnly = $state(false);
  let query = $state("");
  let sort = $state({ key: "worth", desc: true });

  // What you can spare of everything tradable, and why the rest is kept: a set's parts for
  // anything unbuilt, your best copy of each mod and one to give away, one maxed arcane, the parts,
  // blueprints and resources your unbuilt things take, one of each Captura scene (core/spares.ts).
  // The market's item list names things the game knows by internal names ("Tn Concrete Archgun Barrel").
  const ledger = $derived(new Map(spareRows(model, mkt.index, sell, platPerDucat).map((x) => [x.key, x])));
  const spareOf = (r: InventoryItem): SpareRow | undefined => ledger.get(r.key);
  const spare = (r: InventoryItem) => spareOf(r)?.spare ?? 0;
  /** The market's name, where the game's own is an internal one. */
  const shown = (r: InventoryItem) => (spareOf(r)?.heldAs ? spareOf(r)!.name : r.name);
  /** Priced under the market's name where the game's own isn't one the market knows. */
  const priceOf = (r: InventoryItem) => spareOf(r)?.price ?? r.price;
  const worthOf = (r: InventoryItem) => {
    const p = priceOf(r);
    return p == null ? null : p * r.quantity;
  };
  const perDay = (r: InventoryItem) => spareOf(r)?.tradesPerDay ?? r.tradesPerDay;
  /** The item's page, by the market's own slug when its item list is loaded ("…_(veiled)"). */
  const itemUrl = (name: string) => {
    const it = mkt.index.byName.get(name.toLowerCase());
    return it ? `https://warframe.market/items/${it.slug}` : marketUrl(name);
  };

  const all = $derived(inventoryRows(model));
  const rows = $derived(all.filter((r) => (kind === "all" || r.kind === kind) && (!tradableOnly || spareOf(r)) && (!sellingOnly || (spareOf(r)?.tradesPerDay ?? r.tradesPerDay ?? 0) >= 1) && (!spareOnly || spare(r) > 0) && matches(query, r.name, r.type, shown(r), spareOf(r)?.type ?? "")));
  const pctOf = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 10) / 10}%`);
  const why = (r: InventoryItem) => spareOf(r)?.why ?? "Nothing to spare";
  /** Of the spare copies of what's shown, what sells at least once a day (relics have no count: they do). */
  const spareLiquid = $derived(rows.filter((r) => (spareOf(r)?.tradesPerDay ?? (r.kind === "relic" ? 1 : 0)) >= 1).reduce((n, r) => n + (spareOf(r)?.worth ?? 0), 0));

  const KINDS: { v: "all" | InventoryKind; label: string }[] = [
    { v: "all", label: "All" },
    { v: "gear", label: "Gear" },
    { v: "part", label: "Prime parts" },
    { v: "relic", label: "Relics" },
    { v: "mod", label: "Mods" },
    { v: "arcane", label: "Arcanes" },
    { v: "resource", label: "Resources" },
    { v: "blueprint", label: "Blueprints" },
  ];
  const count = (k: "all" | InventoryKind) => (k === "all" ? all.length : all.filter((r) => r.kind === k).length);

  const worth = $derived(rows.reduce((n, r) => n + (worthOf(r) ?? 0), 0));
  /** What would realistically sell: things that trade at least once a day. 240 Thumpers don't. */
  const liquid = $derived(rows.filter((r) => spareOf(r) && (perDay(r) ?? 0) >= 1).reduce((n, r) => n + (worthOf(r) ?? 0), 0));


  const columns: Column<InventoryItem>[] = [
    { key: "name", label: "Item", value: (r) => r.name, cell: nameCell, defaultDesc: false, width: "26rem" },
    { key: "type", label: "Kind", value: (r) => spareOf(r)?.type ?? r.type, muted: true, defaultDesc: false, minor: true },
    { key: "qty", label: "Have", value: (r) => r.quantity, align: "right" },
    { key: "spare", label: "Spare", value: (r) => (spareOf(r) ? spare(r) : null), align: "right", cell: spareCell, title: "What you can sell: what you hold beyond what you keep (hover a number for why)" },
    { key: "price", label: "Each", value: (r) => priceOf(r), align: "right", cell: priceCell },
    { key: "worth", label: "Worth", value: (r) => worthOf(r), align: "right", cell: worthCell },
    { key: "ducats", label: "Ducats", value: (r) => (r.ducats == null ? null : r.ducats * r.quantity), align: "right", cell: ducatCell, minor: true },
    { key: "trades", label: "Trades/day", value: (r) => { const t = perDay(r); return t == null ? null : Math.round(t * 10) / 10; }, align: "right", muted: true, title: "How quickly it sells on warframe.market" },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ];
</script>

{#snippet spareCell(r: InventoryItem)}
  {@const s = spareOf(r)}
  {#if s}<span class="sp" class:none={!s.spare} title={s.keep ? `Keeps ${s.keep}: ${s.why}` : s.why}>{s.spare.toLocaleString("en")}</span>{/if}
{/snippet}
{#snippet nameCell(r: InventoryItem)}
  <Named file={model.imageOf(r.name) ?? model.imageOf(shown(r))} name={shown(r)}>
    {#if r.rank && r.maxRank}<span class="tag" class:ok={r.rank >= r.maxRank}>{r.rank >= r.maxRank ? "maxed" : `R${r.rank}`}</span>{/if}
    {#if r.kind === "gear"}{#if r.mastered}<span class="tag ok">✓ mastered</span>{:else}<span class="tag warn">level it</span>{/if}{/if}
  </Named>
{/snippet}
{#snippet priceCell(r: InventoryItem)}<P v={priceOf(r)} dim />{/snippet}
{#snippet worthCell(r: InventoryItem)}<P v={worthOf(r)} />{/snippet}
{#snippet ducatCell(r: InventoryItem)}<P v={r.ducats == null ? null : r.ducats * r.quantity} d dim />{/snippet}
{#snippet listCell(r: InventoryItem)}
  {@const s = spareOf(r)}
  {#if s}
    {#if s.spare > 0}
      <ListButton {model} name={s.name} req={{ unique: r.kind === "relic" || s.type === "Veiled riven" ? null : r.unique, rank: r.rank, subtype: r.subtype, quantity: s.spare }} />
    {:else}
      <span class="kept" role="img" aria-label="Kept" title={`Kept: ${why(r)}`}><Icon name="lock" /></span>
    {/if}
  {/if}
{/snippet}
{#snippet card(r: InventoryItem, open: () => void)}
  <!-- No footer at all when there's nothing for it: a resource with no market data. -->
  {#snippet foot()}
    {#if r.kind === "gear"}{#if r.mastered}<span class="tag ok flush">✓ mastered</span>{:else}<span class="tag warn flush">level it</span>{/if}{/if}
    {#if perDay(r) != null}<span class="dim small">{Math.round(perDay(r)! * 10) / 10}/day</span>{/if}
    <span class="grow"></span>
    {@render listCell(r)}
  {/snippet}
  <ItemCard hover={r.name} title={shown(r)} sub={spareOf(r)?.type ?? r.type} image={model.imageOf(r.kind === "relic" ? (r.marketName ?? r.name).replace(/ Relic$/, "") : r.name) ?? model.imageOf(shown(r))} artSize={64} owned={r.kind === "gear" && !r.mastered} onopen={open} foot={r.kind === "gear" || perDay(r) != null || spareOf(r) ? foot : undefined}>
    <div class="have"><b class="mark qty">×{r.quantity.toLocaleString("en")}</b>{#if r.rank && r.maxRank}<span class="tag" class:ok={r.rank >= r.maxRank}>{r.rank >= r.maxRank ? "maxed" : `R${r.rank}`}</span>{/if}</div>
    {#if priceOf(r) != null || r.ducats}
      <div class="vals">
        {#if priceOf(r) != null}<span><span class="register">Each</span><P v={priceOf(r)} dim /></span>{/if}
        {#if r.quantity > 1 && worthOf(r) != null}<span><span class="register">All</span><P v={worthOf(r)} /></span>{/if}
        {#if spareOf(r) && spare(r) > 0 && spare(r) < r.quantity}<span title={why(r)}><span class="register">Spare</span><b class="sp">{spare(r)}</b></span>{/if}
        {#if r.ducats}<span><span class="register">Ducats</span><P v={r.ducats * r.quantity} d dim /></span>{/if}
      </div>
    {/if}
  </ItemCard>
{/snippet}

{#snippet detail(r: InventoryItem)}
  {@const s = spareOf(r)}
  {@const price = s?.price ?? r.price}
  <p class="small dim">
    {r.quantity} held{r.rank != null ? ` at rank ${r.rank}` : ""}{price != null ? ` · ${price}p each on warframe.market` : " · no market price"}{#if s}{" · "}you keep {s.keep}, can spare {s.spare}{/if}{#if s?.heldAs}{" · "}listed as {s.name} (the game calls it {s.heldAs}){/if}
  </p>
  {#if s && (s.tradesPerDay ?? 1) > 0}<div class="hist"><PriceHistory name={s.name} unique={r.kind === "relic" || s.type === "Veiled riven" ? null : r.unique} rank={r.rank} subtype={r.subtype} height={130} /></div>{/if}
  {#if s}<p class="small why">{s.keep ? `Kept: ${s.why}.` : `${s.why}.`}{#if s.crack != null && r.kind === "relic"}{" "}A crack is worth about {Math.round(s.crack * 10) / 10}p on average.{/if}</p>{/if}
  {#if s && s.needs.length > 1 && r.kind !== "relic"}
    <div class="odds">
      <span class="register">What it's kept for</span>
      {#each s.needs as n (n.item)}<span class="src" use:info={n.item}>{n.item}{#if n.count > 1}<span class="dim"> ×{n.count}</span>{/if}</span>{/each}
    </div>
  {/if}
  {#if r.kind === "part"}
    {@const src = model.sourcesByReward.get(r.name) ?? []}
    {#if src.length}
      <div class="odds">
        <span class="register">Drops from (intact → radiant)</span>
        {#each src.slice(0, 8) as s (s.base)}<span class="src" class:vaulted={s.vaulted && !s.resurgence} use:info={s.base}>{s.base} <span class="dim">{s.rarity} · {pctOf(s.chanceIntact)} → {pctOf(s.chanceRadiant)}</span></span>{/each}
        {#if src.length > 8}<span class="dim small">+{src.length - 8} more</span>{/if}
      </div>
    {/if}
  {:else if r.kind === "relic"}
    {@const rel = splitRelicName(r.name)}
    {@const entry = rel ? model.relicGroups.get(rel.base)?.byRefinement[rel.refinement] : undefined}
    {#if rel && entry?.rewards.length}
      <div class="odds">
        <span class="register">{rel.refinement} odds</span>
        {#each entry.rewards as x, i (i)}<span class="src" use:info={x.name}>{x.name} <span class="dim">{pctOf(x.chance)}</span></span>{/each}
      </div>
    {/if}
  {/if}
  <div class="actions">
    {#if spareOf(r)}<button class="link" onclick={() => openUrl(itemUrl(spareOf(r)!.name))}>warframe.market ↗</button>{/if}
    <button class="link" onclick={() => openUrl(wikiUrl(r.kind === "relic" ? r.marketName ?? r.name : r.name))}>Wiki ↗</button>
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Inventory" blurb="Everything you own, with what it's worth on warframe.market.">
    {#snippet band()}
      <Stat label="You can spare" tone="gold" note="Beyond what you keep, and it sells at least once a day"><P v={spareLiquid} big /></Stat>
      <Stat label="Easy to sell" note="Everything you hold that trades at least once a day"><P v={liquid} big /></Stat>
      <Stat label="Market value" tone="dim" note="Every copy at the daily median, slow sellers included"><P v={worth} big /></Stat>
    {/snippet}
  </PageHead>

  <div class="bar">
    <select bind:value={kind} aria-label="Kind" class="kinds">
      {#each KINDS as k (k.v)}<option value={k.v}>{k.label} ({count(k.v)})</option>{/each}
    </select>
    <Chip bind:on={tradableOnly} label="On warframe.market" title="Only things warframe.market trades" />
    <Chip bind:on={sellingOnly} label="Actually sells" title="At least one trade a day on warframe.market" />
    <Chip bind:on={spareOnly} label="Spare only" title="Only what you hold more of than you need: beyond what your unbuilt items take, two of each mod, one maxed arcane, one of each Captura scene" />
    <input type="search" placeholder="Filter items…" bind:value={query} />
  </div>

  <Browse id="inventory" {rows} {columns} key={(r) => r.key} bind:sort {detail} {card} title={(r) => r.name} onopen={(r) => (r.kind === "gear" && model.catalogByUnique.has(r.unique) ? details.open(r.unique) : null)} min="16rem" empty="Nothing matches these filters." />
</div></div>

<style>
  .kinds { min-width: 12rem; }
  .sp { font-variant-numeric: tabular-nums; color: var(--gold); font-weight: 600; cursor: help; }
  .sp.none { color: var(--platinum-deep); font-weight: 400; }
  .hist { max-width: 46rem; margin: 0 0 .8rem; }
  .why { margin: -.3rem 0 .7rem; color: var(--platinum-dim); max-width: 80ch; }
  /* Kept: a padlock where the List button would be, the same size so the column lines up. */
  .kept { display: inline-grid; place-items: center; width: 30px; height: 30px; color: var(--platinum-deep); }
  .flush { margin-left: 0; }
  .have { display: flex; align-items: center; gap: .5rem; }
  .have .tag { margin-left: 0; }
  .qty { font-size: 1.3rem; }
  .vals { display: flex; gap: 1rem; flex-wrap: wrap; }
  .vals > span { display: grid; gap: .15rem; }
  .vals .register { font-size: .6rem; }
  .grow { flex: 1; }
  .odds { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .45rem; margin: 0 0 .7rem; font-size: .8rem; }
  .odds .register { flex-basis: 100%; font-size: .6rem; }
  .src { padding: .12rem .45rem; border: 1px solid var(--rule-bright); }
  .src.vaulted { opacity: .7; border-style: dashed; }
</style>
