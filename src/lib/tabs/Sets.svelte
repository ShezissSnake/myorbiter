<script lang="ts">
  import type { Model } from "../core/model";
  import type { SetRow } from "../core/views";
  import { allSetRows } from "../core/spares";
  import { ducatsWin } from "../core/bulk";
  import type { DucatOptions } from "../core/advice";
  import Browse from "../ui/Browse.svelte";
  import ItemCard from "../ui/ItemCard.svelte";
  import PartChip from "../ui/PartChip.svelte";
  import { collectionItem } from "../core/collection";
  import { details } from "../details.svelte";
  import { mkt } from "../marketStore.svelte";
  import P from "../ui/P.svelte";
  import Named from "../ui/Named.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import Avail from "../ui/Avail.svelte";
  import Chip from "../ui/Chip.svelte";
  import Seg from "../ui/Seg.svelte";
  import Stat from "../ui/Stat.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import { matches, type Column } from "../ui/table";
  import ListButton from "../ui/ListButton.svelte";
  import { marketUrl, openUrl } from "../backend";
  import { info } from "../hover.svelte";

  let { model, advice }: { model: Model; advice: DucatOptions } = $props();

  let mode = $state<"sell" | "close">("sell");
  let query = $state("");
  let keepOne = $state(true);
  let sort = $state({ key: "value", desc: true });
  // Each view opens on its own useful order (the sell view's sort key isn't a column in the other).
  $effect(() => {
    sort = mode === "sell" ? { key: "value", desc: true } : { key: "gain", desc: true };
  });

  // Prime sets, and the others warframe.market trades whole (Mandonel, Lato Vandal…), once its item list is in.
  const all = $derived(allSetRows(model, mkt.index.byId.size ? mkt.index : null));
  /** Worth more to you traded to Baro than sold: why, or null. */
  const forDucats = (r: SetRow) => (r.prime ? ducatsWin(r.setPrice, r.ducats, advice) : null);
  const sellableOf = (r: SetRow) => (keepOne ? r.sellable : r.completeSets);
  /** Parts still to get for the set, counting copies (2× Blade is two). */
  const missingN = (r: SetRow) => r.missing.reduce((n, m) => n + m.count, 0);
  const rows = $derived(
    all.filter((r) =>
      mode === "sell" ? sellableOf(r) > 0 && matches(query, r.name) : r.completeSets === 0 && missingN(r) <= 2 && matches(query, r.name),
    ),
  );
  /** Complete sets held back by "Keep one to build" (shown, or not shown because that was the only one). */
  const keptBack = $derived(keepOne ? all.filter((r) => r.keptForBuild && matches(query, r.name)).length : 0);
  const totalPlat = $derived(rows.reduce((n, r) => n + (mode === "sell" ? sellableOf(r) * (r.setPrice ?? 0) : 0), 0));
  const totalSets = $derived(rows.reduce((n, r) => n + sellableOf(r), 0));
  const missingCost = (r: SetRow) => (r.missing.every((m) => m.price != null) ? r.missing.reduce((n, m) => n + (m.price as number) * m.count, 0) : null);
  /** Buy the missing parts and sell a full set, against selling the parts you have loose. */
  const completeGain = (r: SetRow) => {
    const cost = missingCost(r);
    if (cost == null || r.setPrice == null) return null;
    let loose = 0;
    for (const p of r.parts) {
      const have = Math.min(p.required, Math.max(0, p.owned - r.completeSets * p.required));
      if (!have) continue;
      const price = model.price(p.name);
      if (price == null) return null;
      loose += have * price;
    }
    return Math.round(r.setPrice - cost - loose);
  };

  const worthFinishing = $derived(mode === "close" ? rows.filter((r) => (completeGain(r) ?? 0) > 0).length : 0);

  const sellCols: Column<SetRow>[] = $derived([
    { key: "name", label: "Set", value: (r) => r.name, defaultDesc: false, cell: nameCell },
    { key: "category", minor: true, label: "Type", value: (r) => r.category, muted: true, defaultDesc: false },
    { key: "sellable", label: "Sellable", value: (r) => sellableOf(r), align: "right", cell: sellCell, title: "Complete sets you can sell" },
    { key: "setPrice", label: "Set price", value: (r) => r.setPrice, align: "right", cell: setPriceCell },
    { key: "value", label: "Total", value: (r) => (r.setPrice == null ? null : r.setPrice * sellableOf(r)), align: "right", cell: totalCell },
    { key: "partsPrice", minor: true, label: "As parts", value: (r) => r.partsPrice, align: "right", cell: partsCell, title: "Selling the parts one by one" },
    { key: "ducats", label: "Ducats", value: (r) => r.ducats, align: "right", cell: ducatCell },
    { key: "trades", minor: true, label: "Trades/day", value: (r) => (r.tradesPerDay == null ? null : Math.round(r.tradesPerDay * 10) / 10), align: "right", muted: true, title: "How many of this set warframe.market completes per day" },
    { key: "vault", label: "Vault", value: (r) => (r.vaulted ? 1 : 0), cell: vaultCell, align: "center" },
    { key: "list", label: "", value: () => null, cell: listCell, sortable: false, align: "right" },
  ]);

  const closeCols: Column<SetRow>[] = [
    { key: "name", label: "Set", value: (r) => r.name, defaultDesc: false, cell: nameCell },
    { key: "missingN", label: "Missing", value: missingN, align: "right", defaultDesc: false },
    { key: "missingParts", label: "Parts to get", value: (r) => r.missing.map((m) => (m.count > 1 ? `${m.count}× ` : "") + m.name.replace(r.name + " ", "")).join(", "), cell: missingCell },
    { key: "cost", label: "Buy them", value: missingCost, align: "right", cell: costCell, defaultDesc: false },
    { key: "setPrice", label: "Set price", value: (r) => r.setPrice, align: "right", cell: setPriceCell },
    { key: "gain", label: "Finish & sell", value: completeGain, align: "right", cell: gainCell, title: "Set price, minus buying the missing parts, minus what the parts you have would sell for loose. Positive: completing the set and selling it earns more." },
    { key: "vault", label: "Vault", value: (r) => (r.vaulted ? 1 : 0), cell: vaultCell, align: "center" },
  ];
</script>

{#snippet nameCell(r: SetRow)}
  <Named file={model.imageOf(r.name)} name={r.name}>
    {#if r.mastered}<span class="tag ok">✓ mastered</span>{:else if r.ownedBuilt}<span class="tag" title="You own it built, not mastered yet">owned</span>{/if}
  </Named>
{/snippet}
{#snippet sellCell(r: SetRow)}
  <strong>{sellableOf(r)}</strong>{#if r.keptForBuild && keepOne}<span class="keep" title="Complete sets kept back to build: you haven't built or mastered it, or a weapon made from it (Akvasto Prime takes two Vasto Primes) needs it">+{r.completeSets - r.sellable} kept</span>{/if}
{/snippet}
{#snippet setPriceCell(r: SetRow)}<P v={r.setPrice} />{/snippet}
{#snippet totalCell(r: SetRow)}<P v={r.setPrice == null ? null : r.setPrice * sellableOf(r)} />{/snippet}
{#snippet partsCell(r: SetRow)}<P v={r.partsPrice} dim />{/snippet}
{#snippet ducatCell(r: SetRow)}{#if r.prime}<P v={r.ducats} d dim />{/if}{/snippet}
{#snippet costCell(r: SetRow)}<P v={missingCost(r)} />{/snippet}
{#snippet gainCell(r: SetRow)}{@const g = completeGain(r)}{#if g != null}<span class:pos={g > 0} class:neg={g <= 0}>{g > 0 ? "+" : ""}{g}p</span>{/if}{/snippet}
{#snippet listCell(r: SetRow)}<ListButton {model} name="{r.name} Set" req={{ quantity: sellableOf(r) }} />{/snippet}
{#snippet missingCell(r: SetRow)}
  <span class="miss">{#each r.missing as m, i (m.name)}<span class="mp" use:info={m.name}>{m.count > 1 ? `${m.count}× ` : ""}{m.name.replace(r.name + " ", "")}</span>{#if i < r.missing.length - 1}<span class="sep">,</span>{/if}{/each}</span>
{/snippet}
{#snippet vaultCell(r: SetRow)}{#if r.vaulted}<Avail v="vaulted" />{/if}{/snippet}

{#snippet card(r: SetRow, open: () => void)}
  {@const item = model.catalogByUnique.get(r.unique)}
  <!-- The set's pieces: tradable prime parts, or for other sets the blueprint and parts (not resources). -->
  {@const parts = item ? collectionItem(model, item).parts.filter((p) => (r.prime ? p.tradable : !p.resource)) : []}
  <ItemCard hover="{r.name} Set" title="{r.name} Set" sub={r.category} image={item?.imageName ?? model.imageOf(r.name)} owned={mode === "sell" ? sellableOf(r) > 0 : false} onopen={open}>
    <div class="chips">{#each parts as p, i (i)}<PartChip part={p} size={32} />{/each}</div>
    {#if mode === "sell"}
      <div class="line"><b class="mark big">×{sellableOf(r)}</b><span class="dim small">to sell{#if r.keptForBuild && keepOne} · {r.completeSets - r.sellable} kept to build{/if}</span></div>
    {:else}
      {@const g = completeGain(r)}
      <dl class="kv">
        <dt class="register">Buy</dt><dd>{@render missingCell(r)}</dd>
        <dt class="register">Cost</dt><dd><P v={missingCost(r)} /></dd>
        <dt class="register" title="Finish & sell: the set price, minus buying the missing parts, minus what the parts you have would sell for loose">Gain</dt><dd>{#if g != null}<span class="gain" class:pos={g > 0} class:neg={g <= 0}>{g > 0 ? "+" : ""}{g}p</span>{:else}<span class="dim">–</span>{/if}</dd>
      </dl>
    {/if}
    {#snippet foot()}
      {#if r.mastered}<span class="tag good" title="You've mastered it: nothing to keep a set back for">✓ Mastered</span>{:else if r.ownedBuilt}<span class="tag ok" title="You have it built: not mastered yet">Owned</span>{/if}
      {#if r.vaulted}<Avail v="vaulted" />{/if}
      {#if forDucats(r)}<span class="tag ok" title="{forDucats(r)}: orbiter won't put it on sale">for ducats</span>{/if}
      <span class="grow"></span>
      {#if r.prime}<P v={r.ducats} d dim />{/if}
      <P v={r.setPrice} />
      {#if mode === "sell"}<ListButton {model} name="{r.name} Set" req={{ quantity: sellableOf(r) }} />{/if}
    {/snippet}
  </ItemCard>
{/snippet}

{#snippet detail(r: SetRow)}
  <div class="parts">
    {#each r.parts as p (p.name)}
      <div class="set-part" class:short={p.owned - r.completeSets * p.required < p.required}>
        <span class="set-pn" use:info={p.name}><Thumb file={model.imageOf(p.name)} size={22} /> {p.name}</span><span class="dim">{p.owned}{p.required > 1 ? ` / ${p.required} per set` : ""}</span>
      </div>
    {/each}
  </div>
  <div class="actions">
    <button class="link" onclick={() => openUrl(marketUrl(`${r.name} Set`))}>warframe.market ↗</button>
  </div>
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead title="Sets" blurb="Complete sets you can sell, prime and the others warframe.market trades whole, and the ones almost done.">
    {#snippet band()}
      {#if mode === "sell"}
      <Stat label="Sets to sell" note={!keepOne ? "Every complete set, none kept back" : keptBack ? `${keptBack} more kept back to build and master` : "Nothing kept back to build"}>{totalSets}</Stat>
      <Stat label="At set price" note="warframe.market daily median"><P v={totalPlat} big /></Stat>
    {:else}
      <Stat label="Sets 1–2 parts away" note="Missing one or two parts">{rows.length}</Stat>
      <Stat label="Worth finishing" tone={worthFinishing ? "gold" : "dim"} note="Earn more as a set than sold loose">{worthFinishing}</Stat>
    {/if}
    {/snippet}
  </PageHead>

  <div class="bar">
  <Seg bind:value={mode} options={[{ v: "sell", label: "Sets you can sell", title: "Complete sets in your inventory, and what each sells for" }, { v: "close", label: "Almost complete", title: "Sets one or two parts short: what the missing parts cost, and what finishing and selling gains" }]} />
  {#if mode === "sell"}
    <Chip bind:on={keepOne} label="Keep one to build" title="Hold back one set of anything you have neither built nor mastered" />
  {/if}
  <input type="search" placeholder="Filter sets…" bind:value={query} />
  </div>

  <Browse
    id="sets"
    {rows}
    columns={mode === "sell" ? sellCols : closeCols}
    key={(r) => r.unique}
    bind:sort
    {detail}
    {card}
    title={(r) => `${r.name} Set`}
    onopen={(r) => details.open(r.unique)}
    min="21rem"
    empty={mode === "sell" ? "No complete sets to sell right now." : "No sets one or two parts away."}
  />
</div></div>

<style>
  .pos { color: var(--gold); font-weight: 600; }
  .neg { color: var(--platinum-deep); }
  .chips { display: flex; flex-wrap: wrap; gap: .4rem; }
  .line { display: flex; align-items: baseline; gap: .45rem; flex-wrap: wrap; }
  .big { font-size: 1.5rem; color: var(--gold); }
  .grow { flex: 1; }
  .kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .3rem .7rem; align-items: baseline; margin: 0; }
  .kv dt { font-size: .6rem; white-space: nowrap; }
  .kv dd { margin: 0; font-size: .84rem; min-width: 0; line-height: 1.35; }
  .gain { font-family: var(--face-mark); font-size: 1rem; }
  .miss { color: var(--platinum-dim); }
  .mp { cursor: default; border-bottom: 1px dotted var(--rule-control); }
  .mp:hover { color: var(--platinum); border-bottom-color: var(--platinum-dim); }
  .sep { color: var(--platinum-deep); margin-right: .35em; }
</style>
