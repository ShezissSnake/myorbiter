<script lang="ts">
  import Fold from "../ui/Fold.svelte";
  // Everything you own, the way TennoScope's collection shows it: gear, parts, relics, mods,
  // arcanes, resources and blueprints, with what each is worth and a way to list it.
  import { splitRelicName, type Model } from "../core/model";
  import { info } from "../hover.svelte";
  import { inventoryRows, type InventoryItem, type InventoryKind } from "../core/views";
  import { inventoryValue, sellableCopies, spareRows, UNKNOWN_TRADES_PER_DAY, type SellChoices, type SpareRow } from "../core/spares";
  import { drops } from "../drops.svelte";
  import { mkt } from "../marketStore.svelte";
  import { marketUrl, openUrl, wikiUrl } from "../backend";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import ModCard from "../ui/ModCard.svelte";
  import Art from "../ui/Art.svelte";
  import { details } from "../details.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Named from "../ui/Named.svelte";
  import P from "../ui/P.svelte";
  import Seg from "../ui/Seg.svelte";
  import Chip from "../ui/Chip.svelte";
  import ListButton from "../ui/ListButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import GameIcon, { kindIcon } from "../ui/GameIcon.svelte";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import { matches, type Column } from "../ui/table";
  import NotNeeded from "../ui/NotNeeded.svelte";
  import { notNeeded, type GearCopy } from "../core/notNeeded";

  let { model, sell, platPerDucat = 0, squad = 1, gear = null, keepGear = $bindable([]) }: { model: Model; sell: SellChoices; platPerDucat?: number; squad?: number; gear?: GearCopy[] | null; keepGear?: string[] } = $props();
  // Gear you no longer need and can't trade (core/notNeeded.ts), shown above the list when asked.
  let letGo = $state(false);
  const unneeded = $derived(notNeeded(model, gear, new Set(keepGear)));
  const goCount = $derived(unneeded.go.length);

  let kind = $state<"all" | InventoryKind>("all");
  let tradableOnly = $state(false);
  /** Only what trades at least this often on warframe.market, and is worth at least this much a copy. Empty: any. */
  let minTrades = $state<number | null>(null);
  let minEach = $state<number | null>(null);
  let spareOnly = $state(false);
  let query = $state("");
  // What selling would bring first: 532 Thumpers at 4p each aren't where to start.
  let sort = $state({ key: "sellable", desc: true });

  // What you can spare of everything tradable, and why the rest is kept: a set's parts for
  // anything unbuilt, your best copy of each mod and one to give away, one maxed arcane, the parts,
  // blueprints and resources your unbuilt things take, one of each Captura scene (core/spares.ts).
  // The market's item list names things the game knows by internal names ("Tn Concrete Archgun Barrel").
  const ledger = $derived(new Map(spareRows(model, mkt.index, sell, platPerDucat, squad, drops.recent).map((x) => [x.key, x])));
  const spareOf = (r: InventoryItem): SpareRow | undefined => ledger.get(r.key);
  const spare = (r: InventoryItem) => spareOf(r)?.spare ?? 0;
  /** The market's name, where the game's own is an internal one. */
  const shown = (r: InventoryItem) => (spareOf(r)?.heldAs ? spareOf(r)!.name : r.name);
  /** Priced under the market's name where the game's own isn't one the market knows. */
  // Built gear can't be traded (only some unranked copies can, and those show as spare): no price.
  const priceOf = (r: InventoryItem) => (r.kind === "gear" && !spareOf(r) ? null : (spareOf(r)?.price ?? r.price));
  const worthOf = (r: InventoryItem) => {
    const p = priceOf(r);
    return p == null ? null : p * r.quantity;
  };
  const perDay = (r: InventoryItem) => spareOf(r)?.tradesPerDay ?? r.tradesPerDay;
  /** The spare copies at their price, no more than the market sells in a month (as You can spare counts them). */
  const sellable = (r: InventoryItem) => {
    const s = spareOf(r);
    return s && s.spare > 0 && s.price != null ? Math.round(s.price * sellableCopies(s.spare, perDay(r) ?? (r.kind === "relic" ? UNKNOWN_TRADES_PER_DAY : null))) || null : null;
  };
  /** The item's page, by the market's own slug when its item list is loaded ("…_(veiled)"). */
  const itemUrl = (name: string) => {
    const it = mkt.index.byName.get(name.toLowerCase());
    return it ? `https://warframe.market/items/${it.slug}` : marketUrl(name);
  };

  // Spare only and the folded filters, the kind and a search: what Clear puts back.
  const filtered = $derived(!!query.trim() || kind !== "all" || tradableOnly || minTrades != null || minEach != null || spareOnly);
  function clear() {
    query = "";
    kind = "all";
    tradableOnly = spareOnly = false;
    minTrades = minEach = null;
  }

  const all = $derived(inventoryRows(model));
  const rows = $derived(all.filter((r) => (kind === "all" || r.kind === kind) && (!tradableOnly || spareOf(r)) && (minTrades == null || (perDay(r) ?? 0) >= minTrades) && (minEach == null || (priceOf(r) ?? 0) >= minEach) && (!spareOnly || spare(r) > 0) && matches(query, r.name, r.type, shown(r), spareOf(r)?.type ?? "")));
  const pctOf = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 10) / 10}%`);
  const why = (r: InventoryItem) => spareOf(r)?.why ?? "Nothing to spare";

  const KINDS: { v: "all" | InventoryKind; label: string }[] = [
    { v: "all", label: "All" },
    { v: "gear", label: "Gear" },
    { v: "part", label: "Prime parts" },
    { v: "relic", label: "Relics" },
    { v: "mod", label: "Mods" },
    { v: "arcane", label: "Arcanes" },
    { v: "resource", label: "Resources" },
    { v: "blueprint", label: "Blueprints" },
    { v: "imprint", label: "Imprints" },
  ];
  const count = (k: "all" | InventoryKind) => (k === "all" ? all.length : all.filter((r) => r.kind === k).length);

  // The three figures, worked out as Stats and the selling pages do (core/spares.ts, inventoryValue).
  // Of what's shown: the kind and filters above narrow them too.
  const value = $derived(inventoryValue(rows, ledger));
  const KIND_WORD: Record<string, string> = { gear: "gear", part: "prime parts", relic: "relics", mod: "mods", arcane: "arcanes", resource: "resources", blueprint: "blueprints", imprint: "imprints", other: "other" };
  /** "mods 9,033 · prime parts 1,210 · …": where the spare figure comes from, biggest first. */
  const spareSplit = $derived([...value.byKind].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${KIND_WORD[k] ?? k} ${Math.round(v).toLocaleString("en")}p`).join(" · "));


  const columns: Column<InventoryItem>[] = [
    { key: "name", label: "Item", value: (r) => r.name, cell: nameCell, defaultDesc: false, width: "min(26rem, 40%)" },
    { key: "type", label: "Kind", value: (r) => spareOf(r)?.type ?? r.type, muted: true, defaultDesc: false, minor: true },
    { key: "qty", label: "Have", value: (r) => r.quantity, align: "right" },
    { key: "spare", label: "Spare", value: (r) => (spareOf(r) ? spare(r) : null), align: "right", cell: spareCell, title: "What you can sell: what you hold beyond what you keep (hover a number for why)" },
    { key: "price", label: "Each", value: (r) => priceOf(r), align: "right", cell: priceCell },
    { key: "worth", label: "Worth", value: (r) => worthOf(r), align: "right", cell: worthCell },
    { key: "sellable", label: "Spare sells for", value: (r) => sellable(r), align: "right", cell: sellableCell, title: "What your spare copies would bring: no more of them than the market sells in a month (the You can spare figure, item by item)" },
    { key: "ducats", label: "Ducats", value: (r) => (r.ducats == null ? null : r.ducats * r.quantity), align: "right", cell: ducatCell, minor: true },
    { key: "trades", spare: true, label: "Sold/day", value: (r) => { const t = perDay(r); return t == null ? null : Math.round(t * 10) / 10; }, align: "right", muted: true, title: "How quickly it sells on warframe.market" },
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
    {#if r.kind === "gear"}{#if r.mastered}<span class="tag good">✓ mastered</span>{:else}<span class="tag mastery" title="Not mastered: rank it up for its mastery">level it</span>{/if}{/if}
  </Named>
{/snippet}
{#snippet priceCell(r: InventoryItem)}<P v={priceOf(r)} dim />{/snippet}
{#snippet worthCell(r: InventoryItem)}<P v={worthOf(r)} />{/snippet}
{#snippet sellableCell(r: InventoryItem)}<P v={sellable(r)} />{/snippet}
{#snippet ducatCell(r: InventoryItem)}<P v={r.ducats == null ? null : r.ducats * r.quantity} d dim />{/snippet}
{#snippet listCell(r: InventoryItem, labelled = false)}
  {@const s = spareOf(r)}
  {#if s}
    {#if s.spare > 0}
      <ListButton {model} {labelled} name={s.name} req={{ unique: r.kind === "relic" || s.type === "Veiled riven" ? null : r.unique, rank: r.rank, subtype: r.subtype, quantity: s.spare }} />
    {:else}
      <span class="kept" role="img" aria-label="Kept" title={`Kept: ${why(r)}`}><Icon name="lock" /></span>
    {/if}
  {/if}
{/snippet}
{#snippet card(r: InventoryItem, open: () => void)}
  <!-- No footer at all when there's nothing for it: a resource with no market data. -->
  {#snippet foot()}
    {#if r.kind === "gear"}{#if r.mastered}<span class="tag good flush">✓ mastered</span>{:else}<span class="tag mastery flush" title="Not mastered: rank it up for its mastery">level it</span>{/if}{/if}
    {#if perDay(r) != null}<span class="dim small" title="How many times a day it trades on warframe.market">{Math.round(perDay(r)! * 10) / 10} sold/day</span>{:else if r.kind !== "gear"}<span class="dim small" title="warframe.market's daily statistics have no trades of it">no recent sales</span>{/if}
    <span class="grow"></span>
    {@render listCell(r, true)}
  {/snippet}
  <ItemCard hover={r.name} title={shown(r)} sub={spareOf(r)?.type ?? r.type} fallback={kindIcon(r.kind === "relic" ? "relic" : (spareOf(r)?.type ?? r.type), r.name)} image={model.imageOf(r.kind === "relic" ? (r.marketName ?? r.name).replace(/ Relic$/, "") : r.name) ?? model.imageOf(shown(r))} artSize={64} owned={r.kind === "gear" && !r.mastered} onopen={open} foot={r.kind === "gear" || perDay(r) != null || spareOf(r) ? foot : undefined}>
    {#snippet art()}
      {#if r.kind === "mod" || r.kind === "arcane"}
        {@const c = model.catalogByUnique.get(r.unique)}
        <ModCard arcane={r.kind === "arcane"} name={r.name} image={model.imageOf(r.name)} rarity={c?.rarity ?? ""} polarity={c?.polarity ?? null} drain={c?.baseDrain ?? null} maxRank={r.maxRank ?? c?.maxRank ?? null} rank={r.rank ?? 0} label={c?.compatName ?? ""} width={84} />
      {:else}
        <Art file={model.imageOf(r.kind === "relic" ? (r.marketName ?? r.name).replace(/ Relic$/, "") : r.name) ?? model.imageOf(shown(r))} size={64} alt="" fallback={kindIcon(r.kind === "relic" ? "relic" : (spareOf(r)?.type ?? r.type), r.name) ?? "foundry"} />
      {/if}
    {/snippet}
    <div class="have"><b class="mark qty">×{r.quantity.toLocaleString("en")}</b>{#if r.rank && r.maxRank}<span class="tag" class:ok={r.rank >= r.maxRank}>{r.rank >= r.maxRank ? "maxed" : `R${r.rank}`}</span>{/if}</div>
    {#if priceOf(r) != null || r.ducats}
      <div class="vals">
        {#if priceOf(r) != null}<span><span class="register">Each</span><P v={priceOf(r)} dim /></span>{/if}
        {#if r.quantity > 1 && worthOf(r) != null}<span><span class="register">All</span><P v={worthOf(r)} /></span>{/if}
        {#if spareOf(r) && spare(r) > 0}<span title={why(r)}><span class="register">Spare</span><b class="sp">{spare(r) === r.quantity ? "all" : `×${spare(r).toLocaleString("en")}`}</b></span>{/if}
        {#if sellable(r) != null}<span title="What your spare copies would bring: no more of them than the market sells in a month (the order the cards are in)"><span class="register">Sells for</span><P v={sellable(r)} /></span>{/if}
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
      {#each s.needs as n (n.item)}<span class="src" use:info={n.item}>{n.item}{#if n.count > 1}<span class="dim">{" "}×{n.count}</span>{/if}</span>{/each}
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
      <Stat label="You can spare" tone="gold" note="Beyond what you keep, no more of each than the market sells in a month" title={`You can spare: beyond what you keep, no more of each than the market sells in a month (slow sellers count only that).${spareSplit ? ` By kind: ${spareSplit}. Mods (with Actually sells off) counts its spares the same way; Prime parts leaves out the ones better traded to Baro for ducats.` : ""}`}><P v={value.spare} big /></Stat>
      <Stat extra label="Easy to sell" note="Everything you hold of what trades daily, kept copies too, no more of each than the market sells in a month"><P v={value.easy} big /></Stat>
      <Stat extra label="Market value" tone="dim" note="Every copy at the daily median, slow sellers included"><P v={value.market} big /></Stat>
    {/snippet}
  </PageHead>

  <div class="bar">
    <input type="search" placeholder="Filter items…" bind:value={query} />
    <select bind:value={kind} aria-label="Kind" class="kinds" title="Only one kind of item">
      {#each KINDS as k (k.v)}<option value={k.v}>{k.label} ({count(k.v).toLocaleString("en")})</option>{/each}
    </select>
    <Chip bind:on={spareOnly} label="Spare only" title="Only what you hold more of than you need: beyond what your unbuilt items take, two of each mod, one maxed arcane, one of each Captura scene" />
    <Fold active={(tradableOnly ? 1 : 0) + (minTrades != null ? 1 : 0) + (minEach != null ? 1 : 0)} reset={() => { tradableOnly = false; minTrades = null; minEach = null; }}>
      <Chip bind:on={tradableOnly} label="Tradable" title="Only things warframe.market trades" />
      <label class="min" title="Only what trades at least this many times a day on warframe.market (1: it actually sells). Empty: any.">
        <span class="register">Sold/day ≥</span>
        <input type="number" min="0" step="any" placeholder="any" bind:value={minTrades} aria-label="Minimum sold a day" />
      </label>
      <label class="min" title="Only what's worth at least this much a copy, at the daily median. Empty: any.">
        <span class="register">Each ≥</span>
        <input type="number" min="0" step="1" placeholder="any" bind:value={minEach} aria-label="Minimum platinum each" />
        <GameIcon name="platinum" size={14} />
      </label>
    </Fold>
    <span class="grow"></span>
    <!-- Not a filter: it opens the list of gear you can sell to the game for credits. -->
    <button type="button" class="letgo" class:on={letGo} aria-pressed={letGo} onclick={() => (letGo = !letGo)} title="Gear you can't trade and no longer need: a weapon, frame or companion once you've mastered it and own a better version of it (the Dual Decurion once you have Prisma Dual Decurions), and extra copies of something mastered. Sell them for credits in game">Gear to sell for credits · {goCount}</button>
  </div>

  {#if letGo}<NotNeeded {model} out={unneeded} incarnons={!!gear} bind:keep={keepGear} />{/if}

  <Browse id="inventory" {rows} {columns} key={(r) => r.key} bind:sort {detail} {card} title={(r) => r.name} onopen={(r) => (r.kind === "gear" && model.catalogByUnique.has(r.unique) ? details.open(r.unique) : null)} min="16rem" clear={filtered ? clear : null} empty="Nothing in your inventory yet." />
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
  /* Each figure in a column of its own width, so cards side by side line up and wrap the same way. */
  /* Two columns, always: "Sells for" never wraps onto a line of its own. */
  .vals { display: grid; grid-template-columns: repeat(2, minmax(0, max-content)); gap: .4rem 1.1rem; }
  .vals > span { display: grid; gap: .15rem; }
  .vals .register { font-size: .6rem; white-space: nowrap; }
  .grow { flex: 1; }
  .odds { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .45rem; margin: 0 0 .7rem; font-size: .8rem; }
  .odds .register { flex-basis: 100%; font-size: .6rem; }
  .src { padding: .12rem .45rem; border: 1px solid var(--rule-bright); }
  .src.vaulted { opacity: .7; border-style: dashed; }
  .min { display: inline-flex; align-items: center; gap: .45rem; }
  .min .register { font-size: .6rem; white-space: nowrap; }
  .min input { width: 4.6rem; }
  .letgo.on { border-color: var(--gold-dim); color: var(--platinum); }
</style>
